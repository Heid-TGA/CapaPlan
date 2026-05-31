'use server'

// Server Actions: Projektweite Budgetquelle + Anlagengruppen-Budgets
// (Paket 10.1). Sprechen ausschliesslich an:
//   * public.project_budget_source  (EINE Zeile je Projekt)
//   * public.project_ag_budgets     (EINE Zeile je Projekt + AG 1–5)
//
// FACHLICHE KETTE
//   Budgetquelle -> Projektbudget -> Budget nach Anlagengruppen -> HLKS/Elektro.
//
// ABGRENZUNG (nicht verhandelbar):
//   * KEIN Schreibpfad zu project_lph_budgets.budget_eur (Abacus-/Importbudget
//     bleibt unberuehrt). HOAI-/manuelle Werte ueberschreiben es NICHT.
//   * KEINE Verbindung zu allocations / employees / employees_public /
//     hourly_rate_eur / Budget-RPCs.
//   * KEINE Aenderung an Abacus-/H&I-Importlogik.
//   * lph_budget_basis wird hier NICHT verwendet.
//   * Normaler Supabase-Server-Client (anon key + Cookies) -> RLS greift.
//     Keine Service-Role. TL/PL-Rechte kommen aus den Tabellen-Policies.
//
// HOAI-ABLEITUNG ist DUMMY/TRANSPARENT: das Gesamthonorar eines gespeicherten
// HOAI-Dummy-Szenarios wird ueber HOAI_DUMMY_AG_SPLIT auf AG 1–5 verteilt.
// Keine rechtsverbindliche HOAI-Berechnung.

import { createClient } from '@/lib/supabase/server'
import { calcHoaiDummy } from '@/lib/hoai-dummy'
import { HOAI_DUMMY_AG_SPLIT, AG_NUMBERS } from '@/lib/anlagengruppen'
import { grundhonorar, lphHonorar } from '@/lib/hoai-ag'

export type BudgetSourceType = 'abacus' | 'hoai' | 'manual'

export interface ProjectBudgetSource {
  project_id: string
  source_type: BudgetSourceType
  hoai_scenario_id: string | null
}

export interface AgBudget {
  ag_number: number
  budget_eur: number
  source_type: BudgetSourceType
}

interface SaveBudgetSourceInput {
  source_type: BudgetSourceType
  hoai_scenario_id?: string | null
}

interface AgBudgetInput {
  ag_number: number
  budget_eur: number
  source_type: BudgetSourceType
}

const SOURCE_COLS = 'project_id, source_type, hoai_scenario_id'
const AG_COLS = 'ag_number, budget_eur, source_type'

// ── Validierungs-Helfer ──────────────────────────────────────────────────────
function isSourceType(v: unknown): v is BudgetSourceType {
  return v === 'abacus' || v === 'hoai' || v === 'manual'
}
function isAgNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5
}
function isBudgetEur(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}
// Auf 2 Nachkommastellen runden (numeric(12,2)).
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Prueft, dass ein HOAI-Szenario existiert UND zum erwarteten Projekt gehoert.
// RLS erzwingt die Projektgleichheit nicht, deshalb hier explizit.
async function scenarioBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scenarioId: string,
  projectId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('hoai_calc_scenarios')
    .select('id, project_id')
    .eq('id', scenarioId)
    .maybeSingle()

  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'HOAI-Szenario nicht gefunden oder kein Zugriff.' }
  if (data.project_id !== projectId) {
    return { ok: false, message: 'HOAI-Szenario gehoert nicht zu diesem Projekt.' }
  }
  return { ok: true }
}

// ── Budgetquelle ──────────────────────────────────────────────────────────────

// Budgetquelle eines Projekts laden. Existiert KEINE Zeile, gilt der Default
// 'abacus' (es wird bewusst keine 'abacus'-Zeile erzwungen).
export async function loadProjectBudgetSource(
  projectId: string
): Promise<{ success: boolean; data: ProjectBudgetSource; message: string }> {
  const fallback: ProjectBudgetSource = {
    project_id: projectId,
    source_type: 'abacus',
    hoai_scenario_id: null,
  }
  if (!projectId) return { success: false, data: fallback, message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('project_budget_source')
    .select(SOURCE_COLS)
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) return { success: false, data: fallback, message: error.message }
  if (!data) return { success: true, data: fallback, message: 'Default (abacus).' }
  return { success: true, data: data as ProjectBudgetSource, message: 'OK' }
}

// Budgetquelle setzen/speichern (Upsert ueber unique(project_id)).
//   * source_type wird validiert.
//   * hoai_scenario_id wird NUR bei source_type='hoai' uebernommen (und muss dann,
//     falls gesetzt, zum SELBEN Projekt gehoeren). Bei 'abacus'/'manual' -> null.
//   * Schreibt NICHT in project_lph_budgets.
export async function saveProjectBudgetSource(
  projectId: string,
  payload: SaveBudgetSourceInput
): Promise<{ success: boolean; data: ProjectBudgetSource; message: string }> {
  const fallback: ProjectBudgetSource = {
    project_id: projectId,
    source_type: 'abacus',
    hoai_scenario_id: null,
  }
  if (!projectId) return { success: false, data: fallback, message: 'Projekt-ID fehlt.' }
  if (!isSourceType(payload?.source_type)) {
    return { success: false, data: fallback, message: 'Ungueltige Budgetquelle.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, data: fallback, message: 'Nicht angemeldet.' }

  // hoai_scenario_id nur bei 'hoai' relevant; sonst hart auf null.
  let scenarioId: string | null = null
  if (payload.source_type === 'hoai') {
    const raw = payload.hoai_scenario_id ?? null
    if (raw !== null) {
      if (typeof raw !== 'string') {
        return { success: false, data: fallback, message: 'Ungueltige Szenario-ID.' }
      }
      const check = await scenarioBelongsToProject(supabase, raw, projectId)
      if (!check.ok) return { success: false, data: fallback, message: check.message }
      scenarioId = raw
    }
  }

  const { data, error } = await supabase
    .from('project_budget_source')
    .upsert(
      {
        project_id: projectId,
        source_type: payload.source_type,
        hoai_scenario_id: scenarioId,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' }
    )
    .select(SOURCE_COLS)
    .single()

  if (error) return { success: false, data: fallback, message: error.message }
  return { success: true, data: data as ProjectBudgetSource, message: 'Budgetquelle gespeichert.' }
}

// ── AG-Budgets ─────────────────────────────────────────────────────────────────

// AG-Budgets eines Projekts laden (nur gespeicherte Zeilen; fehlende AGs
// behandelt die UI als "—"/0). Sortiert nach ag_number.
export async function loadProjectAgBudgets(
  projectId: string
): Promise<{ success: boolean; data: AgBudget[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('project_ag_budgets')
    .select(AG_COLS)
    .eq('project_id', projectId)
    .order('ag_number', { ascending: true })

  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: (data ?? []) as AgBudget[], message: 'OK' }
}

// AG-Budgets speichern (Upsert je (project_id, ag_number)).
//   * Jede Zeile: ag_number 1–5, budget_eur >= 0, gueltiger source_type.
//   * Schreibt NICHT in project_lph_budgets.
//   * Gibt anschliessend den vollstaendigen, aktuellen Stand zurueck.
export async function saveProjectAgBudgets(
  projectId: string,
  rows: AgBudgetInput[]
): Promise<{ success: boolean; data: AgBudget[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, data: [], message: 'Keine AG-Budgets uebergeben.' }
  }

  // Validierung + Deduplizierung (letzte Zeile je AG gewinnt).
  const byAg = new Map<number, AgBudgetInput>()
  for (const r of rows) {
    if (!isAgNumber(r?.ag_number)) {
      return { success: false, data: [], message: `Ungueltige Anlagengruppe: ${String(r?.ag_number)}.` }
    }
    if (!isBudgetEur(r?.budget_eur)) {
      return { success: false, data: [], message: `Budget (AG ${r.ag_number}) muss >= 0 sein.` }
    }
    if (!isSourceType(r?.source_type)) {
      return { success: false, data: [], message: `Ungueltige Quelle (AG ${r.ag_number}).` }
    }
    byAg.set(r.ag_number, r)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, data: [], message: 'Nicht angemeldet.' }

  const nowIso = new Date().toISOString()
  const payload = [...byAg.values()].map((r) => ({
    project_id: projectId,
    ag_number: r.ag_number,
    budget_eur: round2(r.budget_eur),
    source_type: r.source_type,
    created_by: user.id,
    updated_at: nowIso,
  }))

  const { error } = await supabase
    .from('project_ag_budgets')
    .upsert(payload, { onConflict: 'project_id,ag_number' })

  if (error) return { success: false, data: [], message: error.message }
  return loadProjectAgBudgets(projectId)
}

// AG-Budgets aus einem gespeicherten HOAI-Szenario VORBELEGEN.
//   * Szenario muss zum Projekt gehoeren.
//   * source_type der erzeugten Zeilen = 'hoai'. Schreibt NICHT in project_lph_budgets.
//
// Zwei Faelle abhaengig vom Szenario-Modus (Paket 10.4):
//   * mode='ag'  -> AG-Budget = Σ der AUSGEWAEHLTEN LPH-Honorare dieser AG
//                   (lph_honorar = grundhonorar × pct/100; grundhonorar =
//                   anrechenbare_kosten × honorar_pct/100). Deaktivierte AG -> 0.
//                   Das ist die fachlich genaue Uebernahme.
//   * mode='simple' (Alt, Paket 6B) -> Gesamthonorar (Dummy) ueber
//                   HOAI_DUMMY_AG_SPLIT auf AG 1–5 verteilt (transparent/unverbindlich).
export async function deriveAgBudgetsFromHoaiScenario(
  projectId: string,
  scenarioId: string
): Promise<{ success: boolean; data: AgBudget[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }
  if (!scenarioId) return { success: false, data: [], message: 'Szenario-ID fehlt.' }

  const supabase = await createClient()
  const check = await scenarioBelongsToProject(supabase, scenarioId, projectId)
  if (!check.ok) return { success: false, data: [], message: check.message }

  const { data: scenario, error } = await supabase
    .from('hoai_calc_scenarios')
    .select('anrechenbare_kosten, honorar_pct, mode')
    .eq('id', scenarioId)
    .maybeSingle()

  if (error) return { success: false, data: [], message: error.message }
  if (!scenario) return { success: false, data: [], message: 'HOAI-Szenario nicht gefunden.' }

  // ── AG-Detailszenario: Σ ausgewaehlte LPH-Honorare je AG ──────────────────
  if (scenario.mode === 'ag') {
    const [{ data: agRows, error: agErr }, { data: lphRows, error: lphErr }] = await Promise.all([
      supabase
        .from('hoai_scenario_ag')
        .select('ag_number, enabled, anrechenbare_kosten, honorar_pct')
        .eq('scenario_id', scenarioId),
      supabase
        .from('hoai_scenario_ag_lph')
        .select('ag_number, lph_number, selected, pct')
        .eq('scenario_id', scenarioId),
    ])
    if (agErr) return { success: false, data: [], message: agErr.message }
    if (lphErr) return { success: false, data: [], message: lphErr.message }

    // Grundhonorar je AKTIVER AG (deaktivierte AG -> kein Eintrag -> 0 Budget).
    const grundByAg = new Map<number, number>()
    for (const a of agRows ?? []) {
      if (!a.enabled) continue
      grundByAg.set(Number(a.ag_number), grundhonorar(Number(a.anrechenbare_kosten), Number(a.honorar_pct)))
    }
    const budgetByAg = new Map<number, number>()
    for (const l of lphRows ?? []) {
      if (!l.selected) continue
      const grund = grundByAg.get(Number(l.ag_number))
      if (grund == null) continue
      budgetByAg.set(
        Number(l.ag_number),
        (budgetByAg.get(Number(l.ag_number)) ?? 0) + lphHonorar(grund, Number(l.pct))
      )
    }
    const rows: AgBudgetInput[] = AG_NUMBERS.map((ag) => ({
      ag_number: ag,
      budget_eur: round2(budgetByAg.get(ag) ?? 0),
      source_type: 'hoai',
    }))
    return saveProjectAgBudgets(projectId, rows)
  }

  // ── Alt-Szenario (simple): Dummy-Gesamthonorar ueber HOAI_DUMMY_AG_SPLIT ──
  const total = calcHoaiDummy(
    Number(scenario.anrechenbare_kosten),
    Number(scenario.honorar_pct)
  ).totalHonorar

  // Vollstaendige AG-1–5-Belegung; nicht im Split aufgefuehrte AGs -> 0.
  const splitByAg = new Map(HOAI_DUMMY_AG_SPLIT.map((s) => [s.ag, s.pct]))
  const rows: AgBudgetInput[] = AG_NUMBERS.map((ag) => ({
    ag_number: ag,
    budget_eur: round2((total * (splitByAg.get(ag) ?? 0)) / 100),
    source_type: 'hoai',
  }))

  return saveProjectAgBudgets(projectId, rows)
}
