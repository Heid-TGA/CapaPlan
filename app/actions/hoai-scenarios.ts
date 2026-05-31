'use server'

// HOAI-Dummy-Szenarien (Paket 6B / Ergaenzung A2b).
//
// Persistiert NUR die Eingaben eines Dummy-Szenarios (label, anrechenbare
// Kosten, honorar_pct). LPH-Verteilung/Euro-Werte werden NICHT gespeichert,
// sondern clientseitig aus lib/hoai-dummy.ts abgeleitet.
//
// ABGRENZUNG (nicht verhandelbar):
//   * Schreibt/liest ausschliesslich public.hoai_calc_scenarios.
//   * KEIN Schreibpfad zu project_lph_budgets / allocations / employees.
//   * Normaler Server-Client -> RLS greift (keine Service Role).
//   * is_dummy bleibt immer true (kein echtes/rechtsverbindliches HOAI-Ergebnis).

import { createClient } from '@/lib/supabase/server'
import {
  HOAI_AG_LPH_NUMBERS,
  HOAI_AG_LPH_DEFAULT_PCT,
  grundhonorar,
  round2 as round2Ag,
} from '@/lib/hoai-ag'
import { AG_NUMBERS } from '@/lib/anlagengruppen'

export interface HoaiScenario {
  id: string
  project_id: string
  label: string
  anrechenbare_kosten: number
  honorar_pct: number
  is_dummy: boolean
  is_active: boolean
  area_id: string | null
  created_at: string
}

interface CreateHoaiScenarioInput {
  label: string
  anrechenbare_kosten: number
  honorar_pct: number
  area_id?: string | null
}

interface UpdateHoaiScenarioPatch {
  label?: string
  anrechenbare_kosten?: number
  honorar_pct?: number
  is_active?: boolean
  area_id?: string | null
}

const SELECT_COLS =
  'id, project_id, label, anrechenbare_kosten, honorar_pct, is_dummy, is_active, area_id, created_at'

// ── Validierungs-Helfer ────────────────────────────────────────────────────
function validLabel(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
function validKosten(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}
function validPct(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100
}

// Prueft, dass ein Budgetbereich existiert UND zum erwarteten Projekt gehoert.
// Damit kann kein fremder Bereich (auch kein eigener aus einem anderen Projekt)
// an ein Szenario gehaengt werden. RLS erzwingt diese Projektgleichheit nicht,
// deshalb hier explizit. Liefert ok=false mit Meldung bei Verstoss.
async function areaBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  areaId: string,
  projectId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('project_budget_areas')
    .select('id, project_id')
    .eq('id', areaId)
    .maybeSingle()

  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'Budgetbereich nicht gefunden oder kein Zugriff.' }
  if (data.project_id !== projectId) {
    return { ok: false, message: 'Budgetbereich gehoert nicht zu diesem Projekt.' }
  }
  return { ok: true }
}

// Alle Szenarien eines Projekts laden (RLS beschraenkt auf erlaubte Projekte).
export async function loadHoaiScenarios(
  projectId: string
): Promise<{ success: boolean; data: HoaiScenario[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('hoai_calc_scenarios')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: (data ?? []) as HoaiScenario[], message: 'OK' }
}

// Szenario anlegen. RLS entscheidet ueber die Berechtigung (TL alles, PL nur
// eigene Projekte). is_dummy wird serverseitig fest auf true gesetzt.
export async function createHoaiScenario(
  projectId: string,
  payload: CreateHoaiScenarioInput
): Promise<{ success: boolean; data?: HoaiScenario; message: string }> {
  if (!projectId) return { success: false, message: 'Projekt-ID fehlt.' }
  if (!validLabel(payload?.label)) return { success: false, message: 'Bezeichnung fehlt.' }
  if (!validKosten(payload?.anrechenbare_kosten)) {
    return { success: false, message: 'Anrechenbare Kosten muessen groesser als 0 sein.' }
  }
  if (!validPct(payload?.honorar_pct)) {
    return { success: false, message: 'Honorarsatz muss zwischen 0 und 100 liegen.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nicht angemeldet.' }

  // area_id ist optional. Wenn gesetzt, muss der Bereich zum SELBEN Projekt
  // gehoeren (sonst Ablehnung). null/undefined -> keine Zuordnung.
  const areaId = payload.area_id ?? null
  if (areaId !== null) {
    if (typeof areaId !== 'string') return { success: false, message: 'Ungueltige area_id.' }
    const check = await areaBelongsToProject(supabase, areaId, projectId)
    if (!check.ok) return { success: false, message: check.message }
  }

  const { data, error } = await supabase
    .from('hoai_calc_scenarios')
    .insert({
      project_id: projectId,
      label: payload.label.trim(),
      anrechenbare_kosten: payload.anrechenbare_kosten,
      honorar_pct: payload.honorar_pct,
      is_dummy: true, // immer Dummy — kein rechtsverbindliches HOAI-Ergebnis
      area_id: areaId,
      created_by: user.id,
    })
    .select(SELECT_COLS)
    .single()

  if (error) return { success: false, message: error.message }
  return { success: true, data: data as HoaiScenario, message: 'Szenario gespeichert.' }
}

// Szenario aktualisieren (nur uebergebene Felder). is_dummy bleibt unveraendert
// true und kann ueber diese Action NICHT abgeschaltet werden.
export async function updateHoaiScenario(
  id: string,
  patch: UpdateHoaiScenarioPatch
): Promise<{ success: boolean; data?: HoaiScenario; message: string }> {
  if (!id) return { success: false, message: 'Szenario-ID fehlt.' }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (patch.label !== undefined) {
    if (!validLabel(patch.label)) return { success: false, message: 'Bezeichnung fehlt.' }
    update.label = patch.label.trim()
  }
  if (patch.anrechenbare_kosten !== undefined) {
    if (!validKosten(patch.anrechenbare_kosten)) {
      return { success: false, message: 'Anrechenbare Kosten muessen groesser als 0 sein.' }
    }
    update.anrechenbare_kosten = patch.anrechenbare_kosten
  }
  if (patch.honorar_pct !== undefined) {
    if (!validPct(patch.honorar_pct)) {
      return { success: false, message: 'Honorarsatz muss zwischen 0 und 100 liegen.' }
    }
    update.honorar_pct = patch.honorar_pct
  }
  if (patch.is_active !== undefined) {
    if (typeof patch.is_active !== 'boolean') return { success: false, message: 'Ungueltiger Wert.' }
    update.is_active = patch.is_active
  }

  const supabase = await createClient()

  // area_id optional. null -> Zuordnung entfernen. Bei gesetztem Wert muss der
  // Bereich zum Projekt DIESES Szenarios gehoeren -> Szenario erst laden, um
  // dessen project_id zu erhalten (RLS-gescoped: PL sieht fremde Zeilen nicht).
  if (patch.area_id !== undefined) {
    const areaId = patch.area_id
    if (areaId === null) {
      update.area_id = null
    } else if (typeof areaId !== 'string') {
      return { success: false, message: 'Ungueltige area_id.' }
    } else {
      const { data: scenario, error: selErr } = await supabase
        .from('hoai_calc_scenarios')
        .select('project_id')
        .eq('id', id)
        .maybeSingle()
      if (selErr) return { success: false, message: selErr.message }
      if (!scenario) return { success: false, message: 'Szenario nicht gefunden oder kein Zugriff.' }
      const check = await areaBelongsToProject(supabase, areaId, scenario.project_id)
      if (!check.ok) return { success: false, message: check.message }
      update.area_id = areaId
    }
  }

  const { data, error } = await supabase
    .from('hoai_calc_scenarios')
    .update(update)
    .eq('id', id)
    .select(SELECT_COLS)

  if (error) return { success: false, message: error.message }
  if (!data || data.length === 0) {
    return { success: false, message: 'Nicht gespeichert (keine Berechtigung oder nicht gefunden).' }
  }
  return { success: true, data: data[0] as HoaiScenario, message: 'Gespeichert.' }
}

// Szenario loeschen (RLS beschraenkt auf erlaubte Projekte). Die Child-Zeilen
// (hoai_scenario_ag / hoai_scenario_ag_lph) verschwinden per ON DELETE CASCADE.
export async function deleteHoaiScenario(
  id: string
): Promise<{ success: boolean; message: string }> {
  if (!id) return { success: false, message: 'Szenario-ID fehlt.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('hoai_calc_scenarios')
    .delete()
    .eq('id', id)

  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Geloescht.' }
}

// ── Paket 10.4: AG-/LPH-Detailszenarien ──────────────────────────────────────
//
// Ein DETAIL-Szenario (mode='ag') ergaenzt den Header um zwei Child-Tabellen:
//   * hoai_scenario_ag      : je AG 1–5 -> enabled, anrechenbare_kosten, honorar_pct
//   * hoai_scenario_ag_lph  : je (AG, LPH 1–9) -> selected, pct
// Das je AG feste Grundhonorar und die LPH-Honorare werden NICHT gespeichert,
// sondern aus diesen Eingaben abgeleitet (lib/hoai-ag.ts). Der Header behaelt
// repraesentative Aggregatwerte (anrechenbare_kosten = Σ aktive AG-Kosten,
// honorar_pct = gewichteter Satz), damit seine NOT-NULL/CHECK-Constraints
// erfuellt bleiben. is_dummy bleibt immer true.

export interface HoaiScenarioAgLphDetail {
  lph_number: number
  selected: boolean
  pct: number
}
export interface HoaiScenarioAgDetail {
  ag_number: number
  enabled: boolean
  anrechenbare_kosten: number
  honorar_pct: number
  lphs: HoaiScenarioAgLphDetail[]
}
export interface HoaiScenarioDetail {
  id: string
  project_id: string
  label: string
  area_id: string | null
  mode: string
  ags: HoaiScenarioAgDetail[]
}

interface SaveHoaiDetailAgInput {
  ag_number: number
  enabled: boolean
  anrechenbare_kosten: number
  honorar_pct: number
  lphs: { lph_number: number; selected: boolean; pct: number }[]
}
interface SaveHoaiDetailInput {
  id?: string | null
  label: string
  area_id?: string | null
  ags: SaveHoaiDetailAgInput[]
}

// Detail (Header + AG- + LPH-Zeilen) eines Szenarios laden. Liefert IMMER eine
// vollstaendige AG-1–5 / LPH-1–9-Matrix; fehlende Zeilen werden mit Defaults
// (deaktiviert, Default-Prozente) aufgefuellt. RLS beschraenkt auf erlaubte
// Projekte (PL nur eigene). Alt-Szenarien (mode='simple') liefern eine
// Default-Matrix (keine Child-Zeilen vorhanden) und behalten ihren Header.
export async function loadHoaiScenarioDetail(
  scenarioId: string
): Promise<{ success: boolean; data?: HoaiScenarioDetail; message: string }> {
  if (!scenarioId) return { success: false, message: 'Szenario-ID fehlt.' }

  const supabase = await createClient()

  const { data: header, error: hErr } = await supabase
    .from('hoai_calc_scenarios')
    .select('id, project_id, label, area_id, mode')
    .eq('id', scenarioId)
    .maybeSingle()
  if (hErr) return { success: false, message: hErr.message }
  if (!header) return { success: false, message: 'Szenario nicht gefunden oder kein Zugriff.' }

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
  if (agErr) return { success: false, message: agErr.message }
  if (lphErr) return { success: false, message: lphErr.message }

  const agByNum = new Map((agRows ?? []).map((r) => [Number(r.ag_number), r]))
  const lphByKey = new Map(
    (lphRows ?? []).map((r) => [`${Number(r.ag_number)}:${Number(r.lph_number)}`, r])
  )

  const ags: HoaiScenarioAgDetail[] = AG_NUMBERS.map((ag) => {
    const a = agByNum.get(ag)
    const lphs: HoaiScenarioAgLphDetail[] = HOAI_AG_LPH_NUMBERS.map((n) => {
      const l = lphByKey.get(`${ag}:${n}`)
      return {
        lph_number: n,
        selected: l ? Boolean(l.selected) : true,
        pct: l ? Number(l.pct) : (HOAI_AG_LPH_DEFAULT_PCT[n] ?? 0),
      }
    })
    return {
      ag_number: ag,
      enabled: a ? Boolean(a.enabled) : false,
      anrechenbare_kosten: a ? Number(a.anrechenbare_kosten) : 0,
      honorar_pct: a ? Number(a.honorar_pct) : 12,
      lphs,
    }
  })

  return {
    success: true,
    data: {
      id: header.id,
      project_id: header.project_id,
      label: header.label,
      area_id: header.area_id ?? null,
      mode: header.mode ?? 'simple',
      ags,
    },
    message: 'OK',
  }
}

// AG-/LPH-Detailszenario speichern (anlegen ODER aktualisieren).
//   * id gesetzt  -> Header aktualisieren (muss zum Projekt gehoeren).
//   * id leer     -> neues Szenario anlegen (mode='ag', is_dummy=true).
//   * Child-Zeilen werden vollstaendig ERSETZT (delete + reinsert je scenario_id):
//       AG 1–5 (alle 5 Zeilen) + LPH 1–9 je AG (45 Zeilen).
//   * Mindestens eine AKTIVE AG mit anrechenbaren Kosten > 0 und positivem
//     Grundhonorar ist erforderlich (sonst koennte der Header-CHECK nicht
//     erfuellt werden).
//   * Schreibt NICHT in project_lph_budgets / project_ag_budgets (die Uebernahme
//     in AG-Budgets erfolgt separat ueber deriveAgBudgetsFromHoaiScenario).
export async function saveHoaiScenarioDetail(
  projectId: string,
  payload: SaveHoaiDetailInput
): Promise<{ success: boolean; data?: HoaiScenarioDetail; message: string }> {
  if (!projectId) return { success: false, message: 'Projekt-ID fehlt.' }
  if (!validLabel(payload?.label)) return { success: false, message: 'Bezeichnung fehlt.' }
  if (!Array.isArray(payload?.ags) || payload.ags.length === 0) {
    return { success: false, message: 'Keine Anlagengruppen uebergeben.' }
  }

  // ── Eingaben normalisieren/validieren (AG 1–5, LPH 1–9) ───────────────────
  const agInputByNum = new Map<number, SaveHoaiDetailAgInput>()
  for (const a of payload.ags) {
    if (typeof a?.ag_number !== 'number' || !AG_NUMBERS.includes(a.ag_number as 1 | 2 | 3 | 4 | 5)) {
      return { success: false, message: `Ungueltige Anlagengruppe: ${String(a?.ag_number)}.` }
    }
    if (typeof a.anrechenbare_kosten !== 'number' || !Number.isFinite(a.anrechenbare_kosten) || a.anrechenbare_kosten < 0) {
      return { success: false, message: `Anrechenbare Kosten (AG ${a.ag_number}) muessen >= 0 sein.` }
    }
    if (typeof a.honorar_pct !== 'number' || !Number.isFinite(a.honorar_pct) || a.honorar_pct < 0 || a.honorar_pct > 100) {
      return { success: false, message: `Honorarsatz (AG ${a.ag_number}) muss zwischen 0 und 100 liegen.` }
    }
    agInputByNum.set(a.ag_number, a)
  }

  // Repraesentative Header-Werte aus den AKTIVEN AG berechnen.
  let totalKosten = 0
  let totalGrund = 0
  for (const ag of AG_NUMBERS) {
    const a = agInputByNum.get(ag)
    if (!a || !a.enabled) continue
    totalKosten += a.anrechenbare_kosten
    totalGrund += grundhonorar(a.anrechenbare_kosten, a.honorar_pct)
  }
  if (totalKosten <= 0 || totalGrund <= 0) {
    return {
      success: false,
      message: 'Mindestens eine aktive AG mit anrechenbaren Kosten > 0 und Honorarsatz > 0 erforderlich.',
    }
  }
  const headerKosten = round2Ag(totalKosten)
  const headerPct = Math.min(100, Math.max(0.01, round2Ag((totalGrund / totalKosten) * 100)))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nicht angemeldet.' }

  // area_id optional; wenn gesetzt, muss der Bereich zum SELBEN Projekt gehoeren.
  const areaId = payload.area_id ?? null
  if (areaId !== null) {
    if (typeof areaId !== 'string') return { success: false, message: 'Ungueltige area_id.' }
    const check = await areaBelongsToProject(supabase, areaId, projectId)
    if (!check.ok) return { success: false, message: check.message }
  }

  // ── Header anlegen oder aktualisieren ─────────────────────────────────────
  let scenarioId: string
  if (payload.id) {
    const { data, error } = await supabase
      .from('hoai_calc_scenarios')
      .update({
        label: payload.label.trim(),
        anrechenbare_kosten: headerKosten,
        honorar_pct: headerPct,
        mode: 'ag',
        area_id: areaId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payload.id)
      .eq('project_id', projectId)
      .select('id')
    if (error) return { success: false, message: error.message }
    if (!data || data.length === 0) {
      return { success: false, message: 'Szenario nicht gefunden oder keine Berechtigung.' }
    }
    scenarioId = data[0].id
  } else {
    const { data, error } = await supabase
      .from('hoai_calc_scenarios')
      .insert({
        project_id: projectId,
        label: payload.label.trim(),
        anrechenbare_kosten: headerKosten,
        honorar_pct: headerPct,
        is_dummy: true,
        mode: 'ag',
        area_id: areaId,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) return { success: false, message: error.message }
    scenarioId = data.id
  }

  // ── Child-Zeilen vollstaendig ersetzen (delete + reinsert) ────────────────
  const { error: delAgErr } = await supabase
    .from('hoai_scenario_ag').delete().eq('scenario_id', scenarioId)
  if (delAgErr) return { success: false, message: delAgErr.message }
  const { error: delLphErr } = await supabase
    .from('hoai_scenario_ag_lph').delete().eq('scenario_id', scenarioId)
  if (delLphErr) return { success: false, message: delLphErr.message }

  const nowIso = new Date().toISOString()
  const agPayload: Record<string, unknown>[] = []
  const lphPayload: Record<string, unknown>[] = []
  for (const ag of AG_NUMBERS) {
    const a = agInputByNum.get(ag)
    agPayload.push({
      scenario_id: scenarioId,
      ag_number: ag,
      enabled: a ? Boolean(a.enabled) : false,
      anrechenbare_kosten: a ? round2Ag(a.anrechenbare_kosten) : 0,
      honorar_pct: a ? round2Ag(a.honorar_pct) : 12,
      updated_at: nowIso,
    })
    const lphByNum = new Map((a?.lphs ?? []).map((l) => [Number(l.lph_number), l]))
    for (const n of HOAI_AG_LPH_NUMBERS) {
      const l = lphByNum.get(n)
      const pct = l && Number.isFinite(l.pct) ? Math.min(100, Math.max(0, l.pct)) : (HOAI_AG_LPH_DEFAULT_PCT[n] ?? 0)
      lphPayload.push({
        scenario_id: scenarioId,
        ag_number: ag,
        lph_number: n,
        selected: l ? Boolean(l.selected) : false,
        pct: round2Ag(pct),
        updated_at: nowIso,
      })
    }
  }

  const { error: insAgErr } = await supabase.from('hoai_scenario_ag').insert(agPayload)
  if (insAgErr) return { success: false, message: insAgErr.message }
  const { error: insLphErr } = await supabase.from('hoai_scenario_ag_lph').insert(lphPayload)
  if (insLphErr) return { success: false, message: insLphErr.message }

  return loadHoaiScenarioDetail(scenarioId)
}
