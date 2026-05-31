'use server'

// Server Actions: Rollenkatalog + interne Planungssaetze (public.planning_roles)
// (Paket 6B-1).
//
// SICHERHEIT / ABGRENZUNG (nicht verhandelbar):
//   * rate_eur_per_hour ist ein ABSTRAKTER interner Planungssatz je Rolle.
//   * KEINE Verbindung zu employees / employees_public / hourly_rate_eur.
//   * KEINE Verbindung zu allocations / project_lph_budgets / Budget-RPCs.
//   * Diese Actions sprechen ausschliesslich public.planning_roles an.
//
// Normaler Supabase-Server-Client (anon key + Cookies) -> RLS greift. Keine
// Service-Role. TL darf schreiben; PL kann nur aktive Rollen lesen (RLS).

import { createClient } from '@/lib/supabase/server'

export interface PlanningRole {
  id: string
  name: string
  rate_eur_per_hour: number
  sort_order: number
  active: boolean
}

interface CreatePlanningRoleInput {
  name: string
  rate_eur_per_hour: number
  sort_order?: number
  active?: boolean
}

interface UpdatePlanningRolePatch {
  name?: string
  rate_eur_per_hour?: number
  sort_order?: number
  active?: boolean
}

const SELECT_COLS = 'id, name, rate_eur_per_hour, sort_order, active'

const SMALLINT_MIN = -32768
const SMALLINT_MAX = 32767

// ── Validierungs-Helfer ─────────────────────────────────────────────────────
function validName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
function validRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}
function validSortOrder(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= SMALLINT_MIN && v <= SMALLINT_MAX
}

// Rollen laden. RLS entscheidet ueber die Sichtbarkeit: TL sieht alle,
// PL nur aktive. Sortiert nach sort_order, dann name.
export async function loadPlanningRoles(): Promise<{
  success: boolean
  data: PlanningRole[]
  message: string
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('planning_roles')
    .select(SELECT_COLS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: (data ?? []) as PlanningRole[], message: 'OK' }
}

// Rolle anlegen. RLS erlaubt das nur einem TL; ein PL-Versuch schlaegt fehl.
export async function createPlanningRole(
  payload: CreatePlanningRoleInput
): Promise<{ success: boolean; data?: PlanningRole; message: string }> {
  if (!validName(payload?.name)) return { success: false, message: 'Name fehlt.' }
  if (!validRate(payload?.rate_eur_per_hour)) {
    return { success: false, message: 'Planungssatz muss groesser als 0 sein.' }
  }
  if (payload.sort_order !== undefined && !validSortOrder(payload.sort_order)) {
    return { success: false, message: 'Ungueltige Sortierung.' }
  }
  if (payload.active !== undefined && typeof payload.active !== 'boolean') {
    return { success: false, message: 'Ungueltiger Wert fuer aktiv.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('planning_roles')
    .insert({
      name: payload.name.trim(),
      rate_eur_per_hour: payload.rate_eur_per_hour,
      sort_order: payload.sort_order ?? 0,
      active: payload.active ?? true,
    })
    .select(SELECT_COLS)
    .single()

  if (error) return { success: false, message: error.message }
  return { success: true, data: data as PlanningRole, message: 'Rolle gespeichert.' }
}

// Rolle aktualisieren (nur uebergebene Felder). RLS: nur TL. Ueber .select()
// wird ein durch RLS blockiertes Update (0 Zeilen) ehrlich als Fehler gemeldet.
export async function updatePlanningRole(
  id: string,
  patch: UpdatePlanningRolePatch
): Promise<{ success: boolean; data?: PlanningRole; message: string }> {
  if (!id) return { success: false, message: 'Rollen-ID fehlt.' }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (patch.name !== undefined) {
    if (!validName(patch.name)) return { success: false, message: 'Name fehlt.' }
    update.name = patch.name.trim()
  }
  if (patch.rate_eur_per_hour !== undefined) {
    if (!validRate(patch.rate_eur_per_hour)) {
      return { success: false, message: 'Planungssatz muss groesser als 0 sein.' }
    }
    update.rate_eur_per_hour = patch.rate_eur_per_hour
  }
  if (patch.sort_order !== undefined) {
    if (!validSortOrder(patch.sort_order)) return { success: false, message: 'Ungueltige Sortierung.' }
    update.sort_order = patch.sort_order
  }
  if (patch.active !== undefined) {
    if (typeof patch.active !== 'boolean') return { success: false, message: 'Ungueltiger Wert fuer aktiv.' }
    update.active = patch.active
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('planning_roles')
    .update(update)
    .eq('id', id)
    .select(SELECT_COLS)

  if (error) return { success: false, message: error.message }
  if (!data || data.length === 0) {
    return { success: false, message: 'Nicht gespeichert (keine Berechtigung oder nicht gefunden).' }
  }
  return { success: true, data: data[0] as PlanningRole, message: 'Gespeichert.' }
}

// Rolle loeschen. RLS: nur TL.
export async function deletePlanningRole(
  id: string
): Promise<{ success: boolean; message: string }> {
  if (!id) return { success: false, message: 'Rollen-ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('planning_roles')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) return { success: false, message: error.message }
  if (!data || data.length === 0) {
    return { success: false, message: 'Nicht geloescht (keine Berechtigung oder nicht gefunden).' }
  }
  return { success: true, message: 'Geloescht.' }
}
