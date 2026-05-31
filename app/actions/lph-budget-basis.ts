'use server'

// Server Actions: Flexible Budgetbasis je LPH (public.lph_budget_basis)
// (Paket 9B-1).
//
// ZWECK
//   Eigener SOLLPLANUNGS-LAYER. Legt pro konkreter LPH-Zeile fest, welche
//   Budgetbasis fuer die Sollplanung gilt:
//     * 'abacus' -> project_lph_budgets.budget_eur (Import-/Basisbudget)
//     * 'hoai'   -> gespeichertes HOAI-Szenario (hoai_calc_scenarios)
//     * 'manual' -> manuell eingetragener LPH-Betrag (manual_budget_eur)
//   Existiert KEINE Zeile, gilt der Default 'abacus' (loadLphBudgetBasis liefert
//   dann ein synthetisches abacus-Objekt mit is_default = true; KEIN DB-Write).
//
// ABGRENZUNG (nicht verhandelbar)
//   * SCHREIBT NIEMALS in project_lph_budgets.budget_eur.
//   * Aendert KEINE Sollstunden-Berechnung (das macht ProjectPlanningView NICHT
//     in diesem Paket) -- hier nur Datenmodell + Actions.
//   * Erzeugt KEINE Allocations / Mitarbeiterstunden / Teamkapazitaet.
//   * KEINE Verbindung zu employees / employees_public / hourly_rate_eur.
//   * Bezug ausschliesslich zu project_lph_budgets (lph_id) und optional
//     hoai_calc_scenarios (hoai_scenario_id).
//
// Normaler Supabase-Server-Client (anon key + Cookies) -> RLS greift. Keine
// Service-Role. TL darf alles; PL nur eigene Projekte (RLS ueber lph_id).
//
// Zusatzsicherung in den Actions (nicht in RLS):
//   * HOAI-Szenario muss zum SELBEN Projekt wie die LPH gehoeren.
//   * Bereich passend: hat das Szenario eine area_id, muss sie der area_id der
//     LPH entsprechen. Ein bereichsweites Szenario (area_id IS NULL) gilt fuer
//     jede LPH des Projekts.

import { createClient } from '@/lib/supabase/server'

export type BudgetBasisSource = 'abacus' | 'hoai' | 'manual'

// Eine aufgeloeste Budgetbasis. id/created_at/updated_at sind null, wenn die
// Zeile NICHT existiert und der Default 'abacus' synthetisch geliefert wird
// (is_default = true).
export interface LphBudgetBasis {
  id: string | null
  lph_id: string
  source_type: BudgetBasisSource
  hoai_scenario_id: string | null
  manual_budget_eur: number | null
  is_default: boolean
  created_at: string | null
  updated_at: string | null
}

export interface SaveLphBudgetBasisInput {
  source_type: BudgetBasisSource
  hoai_scenario_id?: string | null
  manual_budget_eur?: number | null
}

const SELECT_COLS =
  'id, lph_id, source_type, hoai_scenario_id, manual_budget_eur, created_at, updated_at'

interface RawRow {
  id: string
  lph_id: string
  source_type: BudgetBasisSource
  hoai_scenario_id: string | null
  manual_budget_eur: number | string | null
  created_at: string | null
  updated_at: string | null
}

function mapRow(r: RawRow): LphBudgetBasis {
  return {
    id: r.id,
    lph_id: r.lph_id,
    source_type: r.source_type,
    hoai_scenario_id: r.hoai_scenario_id ?? null,
    manual_budget_eur: r.manual_budget_eur === null ? null : Number(r.manual_budget_eur),
    is_default: false,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
  }
}

// Synthetischer Default, wenn keine Zeile existiert.
function abacusDefault(lphId: string): LphBudgetBasis {
  return {
    id: null,
    lph_id: lphId,
    source_type: 'abacus',
    hoai_scenario_id: null,
    manual_budget_eur: null,
    is_default: true,
    created_at: null,
    updated_at: null,
  }
}

// ── Validierungs-Helfer ─────────────────────────────────────────────────────
function validSource(v: unknown): v is BudgetBasisSource {
  return v === 'abacus' || v === 'hoai' || v === 'manual'
}

// Loest Projekt + Bereich einer LPH auf (RLS-gescoped: PL sieht fremde LPH nicht).
async function lphInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lphId: string
): Promise<
  | { ok: true; projectId: string; areaId: string | null }
  | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from('project_lph_budgets')
    .select('project_id, area_id')
    .eq('id', lphId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'LPH nicht gefunden oder kein Zugriff.' }
  return { ok: true, projectId: data.project_id, areaId: data.area_id ?? null }
}

// Prueft, dass ein HOAI-Szenario existiert, zum SELBEN Projekt gehoert und
// (falls es bereichsgebunden ist) zum Bereich der LPH passt. RLS-gescoped.
async function scenarioFitsLph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioId: string,
  lphProjectId: string,
  lphAreaId: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('hoai_calc_scenarios')
    .select('project_id, area_id')
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'HOAI-Szenario nicht gefunden oder kein Zugriff.' }
  if (data.project_id !== lphProjectId) {
    return { ok: false, message: 'HOAI-Szenario gehoert nicht zum selben Projekt wie die LPH.' }
  }
  // Bereichsgebundenes Szenario darf nur zur LPH desselben Bereichs passen.
  // Bereichsweites Szenario (area_id IS NULL) gilt fuer jede LPH des Projekts.
  if (data.area_id !== null && data.area_id !== lphAreaId) {
    return { ok: false, message: 'HOAI-Szenario gehoert zu einem anderen Budgetbereich als die LPH.' }
  }
  return { ok: true }
}

// ── 1. Laden: Budgetbasis einer LPH (mit Default 'abacus') ───────────────────
export async function loadLphBudgetBasis(
  lphId: string
): Promise<{ success: boolean; data: LphBudgetBasis | null; message: string }> {
  if (!lphId) return { success: false, data: null, message: 'LPH-ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('lph_budget_basis')
    .select(SELECT_COLS)
    .eq('lph_id', lphId)
    .maybeSingle()
  if (error) return { success: false, data: null, message: error.message }

  // Keine Zeile -> Default 'abacus'.
  return {
    success: true,
    data: data ? mapRow(data as RawRow) : abacusDefault(lphId),
    message: 'OK',
  }
}

// ── 2. Laden: alle Budgetbasen eines Projekts gebuendelt ─────────────────────
// Liefert NUR tatsaechlich gespeicherte Zeilen (kein synthetischer Default je
// LPH). Die UI ergaenzt fehlende LPH selbst mit 'abacus'. Vermeidet N+1.
export async function loadProjectBudgetBases(
  projectId: string
): Promise<{ success: boolean; data: LphBudgetBasis[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()

  const { data: lphRows, error: lphErr } = await supabase
    .from('project_lph_budgets')
    .select('id')
    .eq('project_id', projectId)
  if (lphErr) return { success: false, data: [], message: lphErr.message }

  const lphIds = (lphRows ?? []).map((r) => r.id)
  if (lphIds.length === 0) return { success: true, data: [], message: 'OK' }

  const { data, error } = await supabase
    .from('lph_budget_basis')
    .select(SELECT_COLS)
    .in('lph_id', lphIds)
  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: ((data ?? []) as RawRow[]).map(mapRow), message: 'OK' }
}

// ── 3. Speichern (Upsert): Budgetbasis einer LPH ─────────────────────────────
// Genau eine Zeile je LPH (unique(lph_id)) -> vorhandene Zeile wird aktualisiert,
// sonst angelegt. Validiert quellenabhaengig und nullt nicht passende Felder.
export async function saveLphBudgetBasis(
  lphId: string,
  payload: SaveLphBudgetBasisInput
): Promise<{ success: boolean; data?: LphBudgetBasis; message: string }> {
  if (!lphId) return { success: false, message: 'LPH-ID fehlt.' }
  if (!validSource(payload?.source_type)) {
    return { success: false, message: 'Ungueltige Budgetbasis (abacus | hoai | manual).' }
  }

  const supabase = await createClient()

  // Projekt + Bereich der LPH bestimmen (auch fuer Szenario-Konsistenz).
  const info = await lphInfo(supabase, lphId)
  if (!info.ok) return { success: false, message: info.message }

  // Quellenabhaengige Felder aufbauen (nicht passende Felder werden genullt).
  let hoaiScenarioId: string | null = null
  let manualBudgetEur: number | null = null

  if (payload.source_type === 'hoai') {
    const scenarioId = payload.hoai_scenario_id
    if (typeof scenarioId !== 'string' || !scenarioId) {
      return { success: false, message: 'HOAI-Szenario fehlt.' }
    }
    const fit = await scenarioFitsLph(supabase, scenarioId, info.projectId, info.areaId)
    if (!fit.ok) return { success: false, message: fit.message }
    hoaiScenarioId = scenarioId
  } else if (payload.source_type === 'manual') {
    const v = payload.manual_budget_eur
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { success: false, message: 'Manuelles Budget muss eine Zahl >= 0 sein.' }
    }
    manualBudgetEur = Math.round(v * 100) / 100
  }
  // source_type === 'abacus': beide Felder bleiben null.

  const { data: { user } } = await supabase.auth.getUser()

  // Vorhandene Zeile? (unique(lph_id))
  const { data: existing, error: findErr } = await supabase
    .from('lph_budget_basis')
    .select('id')
    .eq('lph_id', lphId)
    .maybeSingle()
  if (findErr) return { success: false, message: findErr.message }

  if (existing) {
    const { data, error } = await supabase
      .from('lph_budget_basis')
      .update({
        source_type: payload.source_type,
        hoai_scenario_id: hoaiScenarioId,
        manual_budget_eur: manualBudgetEur,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(SELECT_COLS)
    if (error) return { success: false, message: error.message }
    if (!data || data.length === 0) {
      return { success: false, message: 'Nicht gespeichert (keine Berechtigung oder nicht gefunden).' }
    }
    return { success: true, data: mapRow(data[0] as RawRow), message: 'Gespeichert.' }
  }

  const { data, error } = await supabase
    .from('lph_budget_basis')
    .insert({
      lph_id: lphId,
      source_type: payload.source_type,
      hoai_scenario_id: hoaiScenarioId,
      manual_budget_eur: manualBudgetEur,
      created_by: user?.id ?? null,
    })
    .select(SELECT_COLS)
    .single()
  if (error) return { success: false, message: error.message }
  return { success: true, data: mapRow(data as RawRow), message: 'Gespeichert.' }
}

// ── 4. Reset: Budgetbasis loeschen -> faellt auf Default 'abacus' zurueck ─────
// Loescht ueber lph_id. Kein Treffer (keine Zeile) ist KEIN Fehler -- die LPH
// gilt dann ohnehin schon als 'abacus'.
export async function resetLphBudgetBasis(
  lphId: string
): Promise<{ success: boolean; data: LphBudgetBasis; message: string }> {
  if (!lphId) {
    return { success: false, data: abacusDefault(''), message: 'LPH-ID fehlt.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('lph_budget_basis')
    .delete()
    .eq('lph_id', lphId)
  if (error) return { success: false, data: abacusDefault(lphId), message: error.message }

  return { success: true, data: abacusDefault(lphId), message: 'Auf Abacus-Budget zurueckgesetzt.' }
}
