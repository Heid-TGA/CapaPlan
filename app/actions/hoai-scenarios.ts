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

export interface HoaiScenario {
  id: string
  project_id: string
  label: string
  anrechenbare_kosten: number
  honorar_pct: number
  is_dummy: boolean
  is_active: boolean
  created_at: string
}

interface CreateHoaiScenarioInput {
  label: string
  anrechenbare_kosten: number
  honorar_pct: number
}

interface UpdateHoaiScenarioPatch {
  label?: string
  anrechenbare_kosten?: number
  honorar_pct?: number
  is_active?: boolean
}

const SELECT_COLS =
  'id, project_id, label, anrechenbare_kosten, honorar_pct, is_dummy, is_active, created_at'

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

  const { data, error } = await supabase
    .from('hoai_calc_scenarios')
    .insert({
      project_id: projectId,
      label: payload.label.trim(),
      anrechenbare_kosten: payload.anrechenbare_kosten,
      honorar_pct: payload.honorar_pct,
      is_dummy: true, // immer Dummy — kein rechtsverbindliches HOAI-Ergebnis
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

// Szenario loeschen (RLS beschraenkt auf erlaubte Projekte).
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
