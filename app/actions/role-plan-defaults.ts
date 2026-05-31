'use server'

// Server Actions: Default-Rollenverteilungen je LPH-Gruppe
// (public.role_plan_defaults, Paket 7C).
//
// ABGRENZUNG (nicht verhandelbar):
//   Reine VORLAGEN. Diese Actions
//     * erzeugen KEINE Mitarbeiterzuweisungen, schreiben NICHT in allocations,
//     * veraendern KEINE Budget-RPCs / Teamkapazitaet,
//     * lesen KEINE Mitarbeiterdaten, beruehren NIEMALS employees.hourly_rate_eur.
//   Einziger Fremdschluessel: role_id -> planning_roles(id).
//
// Normaler Supabase-Server-Client (anon key + Cookies) -> RLS greift. Keine
// Service-Role. TL darf schreiben; PL darf nur lesen (RLS).

import { createClient } from '@/lib/supabase/server'
import { isRolePlanDefaultGroup, groupKeyForLph } from '@/lib/role-plan-defaults'

// Eine gespeicherte Default-Zeile inkl. Rollendaten (fuer die UI).
export interface RolePlanDefault {
  id: string
  group_key: string
  role_id: string
  share_pct: number
  role_name: string
  role_active: boolean
  role_sort_order: number
}

const SELECT_COLS =
  'id, group_key, role_id, share_pct, planning_roles(name, active, sort_order)'

// Supabase-Embed kann Objekt ODER Array liefern -> robust normalisieren.
interface RawRow {
  id: string
  group_key: string
  role_id: string
  share_pct: number
  planning_roles:
    | { name: string; active: boolean; sort_order: number }
    | { name: string; active: boolean; sort_order: number }[]
    | null
}

function mapRow(r: RawRow): RolePlanDefault {
  const role = Array.isArray(r.planning_roles) ? r.planning_roles[0] : r.planning_roles
  return {
    id: r.id,
    group_key: r.group_key,
    role_id: r.role_id,
    share_pct: Number(r.share_pct),
    role_name: role?.name ?? '',
    role_active: role?.active ?? false,
    role_sort_order: role?.sort_order ?? 0,
  }
}

function validShare(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
}

// ── 1. Laden: alle Default-Zeilen (alle Gruppen) ─────────────────────────────
export async function loadRolePlanDefaults(): Promise<{
  success: boolean
  data: RolePlanDefault[]
  message: string
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_plan_defaults')
    .select(SELECT_COLS)

  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: ((data ?? []) as RawRow[]).map(mapRow), message: 'OK' }
}

// ── 2. Speichern: komplette Verteilung einer Gruppe (Sammel-Upsert) ──────────
// Schluessel: (group_key, role_id). Summe 100 % wird BEWUSST NICHT erzwungen;
// die Summe wird im Ergebnis (sumPct) zurueckgegeben. RLS: nur TL.
export async function saveRolePlanDefaultGroup(
  groupKey: string,
  shares: { roleId: string; sharePct: number }[]
): Promise<{ success: boolean; data: RolePlanDefault[]; sumPct: number; message: string }> {
  if (!isRolePlanDefaultGroup(groupKey)) {
    return { success: false, data: [], sumPct: 0, message: 'Ungueltige Gruppe.' }
  }
  if (!Array.isArray(shares)) {
    return { success: false, data: [], sumPct: 0, message: 'Ungueltige Verteilung.' }
  }

  const supabase = await createClient()
  const results: RolePlanDefault[] = []

  for (const s of shares) {
    if (!s?.roleId) {
      return { success: false, data: results, sumPct: 0, message: 'Rollen-ID fehlt.' }
    }
    if (!validShare(s.sharePct)) {
      return { success: false, data: results, sumPct: 0, message: 'Anteil muss zwischen 0 und 100 liegen.' }
    }

    // Rolle muss existieren und aktiv sein (RLS: PL sieht ohnehin nur aktive).
    const { data: role, error: roleErr } = await supabase
      .from('planning_roles')
      .select('id, active')
      .eq('id', s.roleId)
      .maybeSingle()
    if (roleErr) return { success: false, data: results, sumPct: 0, message: roleErr.message }
    if (!role) return { success: false, data: results, sumPct: 0, message: 'Rolle nicht gefunden oder kein Zugriff.' }
    if (!role.active) return { success: false, data: results, sumPct: 0, message: 'Rolle ist inaktiv.' }

    // Vorhandene Zeile finden (Schluessel group_key + role_id).
    const { data: existing, error: findErr } = await supabase
      .from('role_plan_defaults')
      .select('id')
      .eq('group_key', groupKey)
      .eq('role_id', s.roleId)
      .maybeSingle()
    if (findErr) return { success: false, data: results, sumPct: 0, message: findErr.message }

    if (existing) {
      const { data, error } = await supabase
        .from('role_plan_defaults')
        .update({ share_pct: s.sharePct, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select(SELECT_COLS)
      if (error) return { success: false, data: results, sumPct: 0, message: error.message }
      if (!data || data.length === 0) {
        return { success: false, data: results, sumPct: 0, message: 'Nicht gespeichert (keine Berechtigung).' }
      }
      results.push(mapRow(data[0] as RawRow))
    } else {
      const { data, error } = await supabase
        .from('role_plan_defaults')
        .insert({ group_key: groupKey, role_id: s.roleId, share_pct: s.sharePct })
        .select(SELECT_COLS)
        .single()
      if (error) return { success: false, data: results, sumPct: 0, message: error.message }
      results.push(mapRow(data as RawRow))
    }
  }

  const sumPct = results.reduce((acc, r) => acc + r.share_pct, 0)
  return { success: true, data: results, sumPct, message: 'Gespeichert.' }
}

// ── 3. Optional: Default-Gruppe + Werte fuer eine konkrete LPH laden ──────────
// Liefert den passenden group_key (LPH 1–5/6–7/8–9) und die gespeicherten
// Anteile. Genutzt von „Default anwenden" in der Projektplanung; das eigentliche
// Schreiben in die LPH erfolgt dort ueber das bestehende saveLphRolePlan.
export async function getDefaultGroupForLph(lphNumber: number): Promise<{
  success: boolean
  groupKey: string | null
  data: { role_id: string; share_pct: number }[]
  message: string
}> {
  const groupKey = groupKeyForLph(lphNumber)
  if (!groupKey) {
    return { success: true, groupKey: null, data: [], message: 'Keine Default-Gruppe fuer diese LPH.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_plan_defaults')
    .select('role_id, share_pct')
    .eq('group_key', groupKey)

  if (error) return { success: false, groupKey, data: [], message: error.message }

  const shares = (data ?? []).map((r) => ({
    role_id: r.role_id as string,
    share_pct: Number(r.share_pct),
  }))
  return { success: true, groupKey, data: shares, message: 'OK' }
}
