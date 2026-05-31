// Gemeinsame Feld-Definitionen fuer die manuelle Mitarbeiterpflege (Paket 11).
//
// Bewusst KEIN 'use server' — dieses Modul wird sowohl vom Client-Modal als auch
// von der Server-Action importiert. Aus 'use server'-Modulen duerfen nur async
// functions exportiert werden, daher liegen diese Konstanten hier.

// Erlaubte Bereiche/Gewerke fuer MANUELL gepflegte Mitarbeiter.
//
// Hinweis: reine APPLIKATIONS-Validierung. Die DB-Spalte employees.department
// bleibt freier Text (kein CHECK), damit der Abacus-Import beliebige Bereiche
// schreiben und Bestandsdaten nicht verletzt werden.
export const EMPLOYEE_DEPARTMENTS = ['HLKS', 'Elektro', 'Sonstige'] as const
export type EmployeeDepartment = (typeof EMPLOYEE_DEPARTMENTS)[number]

// Sinnvoller Bereich fuer Wochenstunden (weekly_capacity_hours).
export const MIN_WEEKLY_HOURS = 0
export const MAX_WEEKLY_HOURS = 60

export function isEmployeeDepartment(v: unknown): v is EmployeeDepartment {
  return typeof v === 'string' && (EMPLOYEE_DEPARTMENTS as readonly string[]).includes(v)
}
