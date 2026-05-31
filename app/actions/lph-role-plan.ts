'use server'

// Server Actions: Rollenverteilung je LPH (public.lph_role_plan)
// (Paket 6B-2A).
//
// ABGRENZUNG (nicht verhandelbar):
//   Reines Soll-/Planungsmodell. Diese Actions
//     * schreiben NICHT in allocations, erzeugen keine Mitarbeiterstunden,
//     * veraendern keine Budget-RPCs / Teamkapazitaet,
//     * haben KEINE Verbindung zu employees / employees_public / hourly_rate_eur.
//   Bezug ausschliesslich zu project_lph_budgets (lph_id), planning_roles
//   (role_id) und optional project_budget_areas (area_id).
//
// Normaler Supabase-Server-Client (anon key + Cookies) -> RLS greift. Keine
// Service-Role. TL darf alles; PL nur eigene Projekte (RLS ueber lph_id).
//
// Zusatzsicherung in den Actions (nicht in RLS):
//   * area_id muss zum SELBEN Projekt gehoeren wie lph_id.
//   * role_id muss existieren und aktiv sein.

import { createClient } from '@/lib/supabase/server'

// Eine Zeile inkl. Rollendaten (fuer die spaetere UI/Berechnung).
export interface LphRoleShare {
  id: string
  lph_id: string
  role_id: string
  area_id: string | null
  share_pct: number
  role_name: string
  role_rate_eur_per_hour: number
  role_active: boolean
}

const SELECT_COLS =
  'id, lph_id, role_id, area_id, share_pct, planning_roles(name, rate_eur_per_hour, active)'

// Supabase-Embed kann Objekt ODER Array liefern -> robust normalisieren.
interface RawRow {
  id: string
  lph_id: string
  role_id: string
  area_id: string | null
  share_pct: number
  planning_roles:
    | { name: string; rate_eur_per_hour: number; active: boolean }
    | { name: string; rate_eur_per_hour: number; active: boolean }[]
    | null
}

function mapRow(r: RawRow): LphRoleShare {
  const role = Array.isArray(r.planning_roles) ? r.planning_roles[0] : r.planning_roles
  return {
    id: r.id,
    lph_id: r.lph_id,
    role_id: r.role_id,
    area_id: r.area_id,
    share_pct: Number(r.share_pct),
    role_name: role?.name ?? '',
    role_rate_eur_per_hour: role ? Number(role.rate_eur_per_hour) : 0,
    role_active: role?.active ?? false,
  }
}

// ── Validierungs-Helfer ─────────────────────────────────────────────────────
function validShare(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
}

// Loest das Projekt einer LPH auf (RLS-gescoped: PL sieht fremde LPH nicht).
async function projectOfLph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lphId: string
): Promise<{ ok: true; projectId: string } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('project_lph_budgets')
    .select('project_id')
    .eq('id', lphId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'LPH nicht gefunden oder kein Zugriff.' }
  return { ok: true, projectId: data.project_id }
}

// Prueft, dass ein Bereich zum erwarteten Projekt gehoert (RLS-gescoped).
async function areaInProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  areaId: string,
  projectId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('project_budget_areas')
    .select('project_id')
    .eq('id', areaId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'Budgetbereich nicht gefunden oder kein Zugriff.' }
  if (data.project_id !== projectId) {
    return { ok: false, message: 'Budgetbereich gehoert nicht zum selben Projekt wie die LPH.' }
  }
  return { ok: true }
}

// ── 1. Laden: Verteilung einer LPH (optional je Bereich) ─────────────────────
// areaId === undefined: alle Zeilen der LPH (inkl. mit/ohne Bereich).
// areaId === null:      nur die Gesamt-Zeilen (area_id IS NULL).
// areaId === '<uuid>':  nur die Zeilen dieses Bereichs.
export async function loadLphRolePlan(
  lphId: string,
  areaId?: string | null
): Promise<{ success: boolean; data: LphRoleShare[]; message: string }> {
  if (!lphId) return { success: false, data: [], message: 'LPH-ID fehlt.' }

  const supabase = await createClient()
  let query = supabase.from('lph_role_plan').select(SELECT_COLS).eq('lph_id', lphId)

  if (areaId === null) query = query.is('area_id', null)
  else if (typeof areaId === 'string' && areaId) query = query.eq('area_id', areaId)

  const { data, error } = await query
  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: ((data ?? []) as RawRow[]).map(mapRow), message: 'OK' }
}

// ── 2. Laden: alle Verteilungen eines Projekts gebuendelt ────────────────────
// Vermeidet N+1 in der spaeteren UI. RLS liefert PL nur eigene Projekte.
export async function loadProjectRolePlans(
  projectId: string
): Promise<{ success: boolean; data: LphRoleShare[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()

  // LPH-IDs des Projekts holen (RLS-gescoped).
  const { data: lphRows, error: lphErr } = await supabase
    .from('project_lph_budgets')
    .select('id')
    .eq('project_id', projectId)
  if (lphErr) return { success: false, data: [], message: lphErr.message }

  const lphIds = (lphRows ?? []).map((r) => r.id)
  if (lphIds.length === 0) return { success: true, data: [], message: 'OK' }

  const { data, error } = await supabase
    .from('lph_role_plan')
    .select(SELECT_COLS)
    .in('lph_id', lphIds)
  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: ((data ?? []) as RawRow[]).map(mapRow), message: 'OK' }
}

// ── 3. Upsert eines Rollenanteils ────────────────────────────────────────────
// Legt an oder aktualisiert (Schluessel: lph_id + role_id + area_id, wobei
// area_id NULL einen eigenen Schluessel bildet). Validiert share_pct, aktive
// Rolle und Projektgleichheit von area_id.
export async function upsertLphRoleShare(
  lphId: string,
  roleId: string,
  sharePct: number,
  areaId?: string | null
): Promise<{ success: boolean; data?: LphRoleShare; message: string }> {
  if (!lphId) return { success: false, message: 'LPH-ID fehlt.' }
  if (!roleId) return { success: false, message: 'Rollen-ID fehlt.' }
  if (!validShare(sharePct)) return { success: false, message: 'Anteil muss zwischen 0 und 100 liegen.' }

  const normAreaId = areaId ?? null
  if (normAreaId !== null && typeof normAreaId !== 'string') {
    return { success: false, message: 'Ungueltige area_id.' }
  }

  const supabase = await createClient()

  // Projekt der LPH bestimmen (auch fuer area-Konsistenz).
  const proj = await projectOfLph(supabase, lphId)
  if (!proj.ok) return { success: false, message: proj.message }

  // Rolle muss existieren und aktiv sein (RLS: PL sieht ohnehin nur aktive).
  const { data: role, error: roleErr } = await supabase
    .from('planning_roles')
    .select('id, active')
    .eq('id', roleId)
    .maybeSingle()
  if (roleErr) return { success: false, message: roleErr.message }
  if (!role) return { success: false, message: 'Rolle nicht gefunden oder kein Zugriff.' }
  if (!role.active) return { success: false, message: 'Rolle ist inaktiv.' }

  // area_id muss zum selben Projekt gehoeren.
  if (normAreaId !== null) {
    const areaCheck = await areaInProject(supabase, normAreaId, proj.projectId)
    if (!areaCheck.ok) return { success: false, message: areaCheck.message }
  }

  const { data: { user } } = await supabase.auth.getUser()

  // Vorhandene Zeile finden (NULL-sicher: .is() vs .eq()).
  let findQ = supabase
    .from('lph_role_plan')
    .select('id')
    .eq('lph_id', lphId)
    .eq('role_id', roleId)
  findQ = normAreaId === null ? findQ.is('area_id', null) : findQ.eq('area_id', normAreaId)
  const { data: existing, error: findErr } = await findQ.maybeSingle()
  if (findErr) return { success: false, message: findErr.message }

  if (existing) {
    const { data, error } = await supabase
      .from('lph_role_plan')
      .update({ share_pct: sharePct, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select(SELECT_COLS)
    if (error) return { success: false, message: error.message }
    if (!data || data.length === 0) {
      return { success: false, message: 'Nicht gespeichert (keine Berechtigung oder nicht gefunden).' }
    }
    return { success: true, data: mapRow(data[0] as RawRow), message: 'Gespeichert.' }
  }

  const { data, error } = await supabase
    .from('lph_role_plan')
    .insert({
      lph_id: lphId,
      role_id: roleId,
      area_id: normAreaId,
      share_pct: sharePct,
      created_by: user?.id ?? null,
    })
    .select(SELECT_COLS)
    .single()
  if (error) return { success: false, message: error.message }
  return { success: true, data: mapRow(data as RawRow), message: 'Gespeichert.' }
}

// ── 4. Loeschen einer Verteilungszeile ───────────────────────────────────────
export async function deleteLphRoleShare(
  id: string
): Promise<{ success: boolean; message: string }> {
  if (!id) return { success: false, message: 'ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('lph_role_plan')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) return { success: false, message: error.message }
  if (!data || data.length === 0) {
    return { success: false, message: 'Nicht geloescht (keine Berechtigung oder nicht gefunden).' }
  }
  return { success: true, message: 'Geloescht.' }
}

// ── 5. Optional: komplette Verteilung einer LPH/eines Bereichs speichern ──────
// Bequemer Sammel-Upsert fuer die spaetere UI. Validiert jede Zeile einzeln.
// Summe 100 % wird BEWUSST NICHT hart erzwungen; stattdessen wird die Summe
// im Ergebnis zurueckgegeben (sumPct), damit die UI sie pruefen/anzeigen kann.
export async function saveLphRolePlan(
  lphId: string,
  areaId: string | null,
  shares: { roleId: string; sharePct: number }[]
): Promise<{ success: boolean; data: LphRoleShare[]; sumPct: number; message: string }> {
  if (!lphId) return { success: false, data: [], sumPct: 0, message: 'LPH-ID fehlt.' }
  if (!Array.isArray(shares)) return { success: false, data: [], sumPct: 0, message: 'Ungueltige Verteilung.' }

  const results: LphRoleShare[] = []
  for (const s of shares) {
    const res = await upsertLphRoleShare(lphId, s.roleId, s.sharePct, areaId)
    if (!res.success || !res.data) {
      return { success: false, data: results, sumPct: 0, message: res.message }
    }
    results.push(res.data)
  }

  const sumPct = results.reduce((acc, r) => acc + r.share_pct, 0)
  return { success: true, data: results, sumPct, message: 'Gespeichert.' }
}
