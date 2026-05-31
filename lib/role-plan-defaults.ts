// Default-Rollenverteilungen je LPH-Gruppe (Paket 7C).
// Zentrale, geteilte Definition — KEIN 'use server'! Wird von der Server Action
// (Validierung/Mapping) UND von der UI (Modal, Projektplanung) genutzt.
//
// Reine Vorlagen: keine Mitarbeiterzuweisung, keine allocations, keine Budgets,
// keine Mitarbeiter-Stundensaetze.

export const ROLE_PLAN_DEFAULT_GROUPS = ['lph_1_5', 'lph_6_7', 'lph_8_9'] as const

export type RolePlanDefaultGroup = (typeof ROLE_PLAN_DEFAULT_GROUPS)[number]

// Anzeige-Labels fuer die drei Gruppen.
export const ROLE_PLAN_DEFAULT_GROUP_LABELS: Record<RolePlanDefaultGroup, string> = {
  lph_1_5: 'LPH 1–5',
  lph_6_7: 'LPH 6–7',
  lph_8_9: 'LPH 8–9',
}

// Laufzeit-Guard fuer den group_key (schuetzt Action und UI vor Fehlwerten).
export function isRolePlanDefaultGroup(value: unknown): value is RolePlanDefaultGroup {
  return typeof value === 'string' && (ROLE_PLAN_DEFAULT_GROUPS as readonly string[]).includes(value)
}

// Mappt eine LPH-Nummer auf ihre Default-Gruppe.
//   LPH 1–5 -> lph_1_5 · LPH 6–7 -> lph_6_7 · LPH 8–9 -> lph_8_9
// Ausserhalb 1..9 -> null (keine Gruppe).
export function groupKeyForLph(lphNumber: number): RolePlanDefaultGroup | null {
  if (lphNumber >= 1 && lphNumber <= 5) return 'lph_1_5'
  if (lphNumber >= 6 && lphNumber <= 7) return 'lph_6_7'
  if (lphNumber >= 8 && lphNumber <= 9) return 'lph_8_9'
  return null
}
