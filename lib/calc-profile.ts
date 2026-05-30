// Kalkulationsprofil je Projekt (Paket 6B / Ergaenzung A1).
// Zentrale, geteilte Definition — KEIN 'use server'! Wird sowohl von der
// Server Action (Validierung) als auch von der UI (Auswahlfeld) genutzt.
//
// Das Profil ist im MVP nur ein Schalter fuer spaetere, optionale Funktionen
// (TGA-Budgetbereiche, HOAI-Rechner, Soll-Kapazitaet). Es veraendert KEINE
// Budgets, Allocations, Meilensteine oder Gewerke.

export const CALC_PROFILES = ['frei', 'TGA', 'Architektur', 'Statik'] as const

export type CalcProfile = (typeof CALC_PROFILES)[number]

// Anzeige-Labels fuer das Auswahlfeld.
export const CALC_PROFILE_LABELS: Record<CalcProfile, string> = {
  frei: 'Frei / manuell',
  TGA: 'TGA',
  Architektur: 'Architektur',
  Statik: 'Statik',
}

// Laufzeit-Guard: schuetzt Server Action und UI vor ungueltigen Werten und
// faengt Altdaten/NULL ab (z. B. falls die Spalte noch nicht gepatcht ist).
export function isCalcProfile(value: unknown): value is CalcProfile {
  return typeof value === 'string' && (CALC_PROFILES as readonly string[]).includes(value)
}
