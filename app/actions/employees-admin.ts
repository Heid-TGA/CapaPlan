'use server'

// Server Actions: manuelle Mitarbeiterpflege (Paket 11) — NUR fuer TL.
//
// SICHERHEIT (nicht verhandelbar):
//   * hourly_rate_eur wird hier NIEMALS gelesen oder geschrieben.
//     - SELECT listet die Spalten explizit auf (kein select('*')).
//     - INSERT setzt hourly_rate_eur NICHT; die DB nutzt den Platzhalter-Default 0
//       (siehe 03_Patch/supabase_patch_employee_manual_fields.sql). Abacus bleibt
//       fuehrend und ueberschreibt den echten Satz beim Import.
//     - UPDATE erlaubt nur eine Whitelist von Feldern (kein hourly_rate_eur).
//   * Normaler Supabase-Server-Client (anon key + Cookies) -> RLS greift. Keine
//     Service-Role. Nur TL darf lesen/schreiben (emp_tl_*-Policies, public.is_tl()).
//
// Abgrenzung: keine Aenderung an allocations, Budgets oder am Importformat.

import { createClient } from '@/lib/supabase/server'
import {
  EMPLOYEE_DEPARTMENTS,
  MIN_WEEKLY_HOURS,
  MAX_WEEKLY_HOURS,
  isEmployeeDepartment,
} from '@/lib/employee-fields'

export interface EmployeeAdmin {
  id: string
  name: string
  role_type: string
  department: string
  weekly_capacity_hours: number
  active: boolean
}

// hourly_rate_eur ist hier bewusst NICHT enthalten.
const SELECT_COLS = 'id, name, role_type, department, weekly_capacity_hours, active'

interface CreateEmployeeInput {
  name: string
  role_type: string
  department: string
  weekly_capacity_hours: number
  active?: boolean
}

interface UpdateEmployeePatch {
  name?: string
  role_type?: string
  department?: string
  weekly_capacity_hours?: number
  active?: boolean
}

// ── Validierungs-Helfer ──────────────────────────────────────────────────────
function validName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
function validRole(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
function validHours(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= MIN_WEEKLY_HOURS &&
    v <= MAX_WEEKLY_HOURS
  )
}

const DEPT_HINT = `Bereich muss einer von ${EMPLOYEE_DEPARTMENTS.join(', ')} sein.`
const HOURS_HINT = `Wochenstunden muessen zwischen ${MIN_WEEKLY_HOURS} und ${MAX_WEEKLY_HOURS} liegen.`

// Friendly-Message u. a. fuer den UNIQUE(name)-Verstoss.
function mapError(message: string): string {
  if (/duplicate key|unique/i.test(message)) {
    return 'Ein Mitarbeiter mit diesem Namen existiert bereits.'
  }
  return message
}

// Mitarbeiter laden. RLS: nur TL erhaelt Zeilen (PL -> leere Liste). Ohne
// hourly_rate_eur. Sortiert nach Bereich, dann Name.
export async function loadEmployeesAdmin(): Promise<{
  success: boolean
  data: EmployeeAdmin[]
  message: string
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employees')
    .select(SELECT_COLS)
    .order('department', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: (data ?? []) as EmployeeAdmin[], message: 'OK' }
}

// Mitarbeiter anlegen. RLS erlaubt das nur einem TL. hourly_rate_eur wird NICHT
// gesetzt -> DB-Default 0 (Platzhalter).
export async function createEmployeeManual(
  payload: CreateEmployeeInput
): Promise<{ success: boolean; data?: EmployeeAdmin; message: string }> {
  if (!validName(payload?.name)) return { success: false, message: 'Name fehlt.' }
  if (!validRole(payload?.role_type)) return { success: false, message: 'Rolle fehlt.' }
  if (!isEmployeeDepartment(payload?.department)) return { success: false, message: DEPT_HINT }
  if (!validHours(payload?.weekly_capacity_hours)) return { success: false, message: HOURS_HINT }
  if (payload.active !== undefined && typeof payload.active !== 'boolean') {
    return { success: false, message: 'Ungueltiger Wert fuer aktiv.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employees')
    .insert({
      name: payload.name.trim(),
      role_type: payload.role_type.trim(),
      department: payload.department,
      weekly_capacity_hours: payload.weekly_capacity_hours,
      active: payload.active ?? true,
    })
    .select(SELECT_COLS)
    .single()

  if (error) return { success: false, message: mapError(error.message) }
  return { success: true, data: data as EmployeeAdmin, message: 'Mitarbeiter gespeichert.' }
}

// Mitarbeiter aktualisieren (nur uebergebene Felder; Whitelist ohne
// hourly_rate_eur). RLS: nur TL. Ueber .select() wird ein durch RLS blockiertes
// Update (0 Zeilen) ehrlich als Fehler gemeldet.
export async function updateEmployeeManual(
  employeeId: string,
  patch: UpdateEmployeePatch
): Promise<{ success: boolean; data?: EmployeeAdmin; message: string }> {
  if (!employeeId) return { success: false, message: 'Mitarbeiter-ID fehlt.' }

  const update: Record<string, unknown> = {}

  if (patch.name !== undefined) {
    if (!validName(patch.name)) return { success: false, message: 'Name fehlt.' }
    update.name = patch.name.trim()
  }
  if (patch.role_type !== undefined) {
    if (!validRole(patch.role_type)) return { success: false, message: 'Rolle fehlt.' }
    update.role_type = patch.role_type.trim()
  }
  if (patch.department !== undefined) {
    if (!isEmployeeDepartment(patch.department)) return { success: false, message: DEPT_HINT }
    update.department = patch.department
  }
  if (patch.weekly_capacity_hours !== undefined) {
    if (!validHours(patch.weekly_capacity_hours)) return { success: false, message: HOURS_HINT }
    update.weekly_capacity_hours = patch.weekly_capacity_hours
  }
  if (patch.active !== undefined) {
    if (typeof patch.active !== 'boolean') return { success: false, message: 'Ungueltiger Wert fuer aktiv.' }
    update.active = patch.active
  }

  if (Object.keys(update).length === 0) {
    return { success: false, message: 'Keine Aenderung uebergeben.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employees')
    .update(update)
    .eq('id', employeeId)
    .select(SELECT_COLS)

  if (error) return { success: false, message: mapError(error.message) }
  if (!data || data.length === 0) {
    return { success: false, message: 'Nicht gespeichert (keine Berechtigung oder nicht gefunden).' }
  }
  return { success: true, data: data[0] as EmployeeAdmin, message: 'Gespeichert.' }
}

// Mitarbeiter deaktivieren (active = false). Bewusst KEIN Hard-Delete: employees
// werden von allocations referenziert; Deaktivieren ist daten-sicher und
// reversibel (Reaktivierung ueber updateEmployeeManual({ active: true })).
export async function deactivateEmployee(
  employeeId: string
): Promise<{ success: boolean; data?: EmployeeAdmin; message: string }> {
  return updateEmployeeManual(employeeId, { active: false })
}
