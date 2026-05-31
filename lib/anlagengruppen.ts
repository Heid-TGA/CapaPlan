// Anlagengruppen (AG 1–5) fuer die TGA-Budgetlogik (Paket 10.1).
//
// Reine TypeScript-Konstanten/Helfer — KEIN 'use server', KEINE DB-Zugriffe.
// Liegt bewusst in lib/, damit sowohl Server Actions
// (app/actions/project-budget-source.ts) als auch Client-Komponenten
// (ProjectPlanningView) dieselbe AG-Struktur teilen.
//
// AG 6–8 sind BEWUSST NICHT enthalten (Paket-10.1-Grenze).

export type Gewerk = 'HLKS' | 'Elektro'

export interface Anlagengruppe {
  ag: number       // 1..5
  label: string    // vollstaendige Bezeichnung (DIN 276 / HOAI Anlage 15, TGA)
  gewerk: Gewerk   // HLKS (AG 1–3) | Elektro (AG 4–5)
}

// Vollstaendige AG-Liste mit Gewerk-Zuordnung.
export const ANLAGENGRUPPEN: Anlagengruppe[] = [
  { ag: 1, label: 'AG 1: Abwasser-, Wasser- und Gasanlagen', gewerk: 'HLKS' },
  { ag: 2, label: 'AG 2: Wärmeversorgungsanlagen', gewerk: 'HLKS' },
  { ag: 3, label: 'AG 3: Lufttechnische Anlagen', gewerk: 'HLKS' },
  { ag: 4, label: 'AG 4: Starkstromanlagen', gewerk: 'Elektro' },
  { ag: 5, label: 'AG 5: Fernmelde- und informationstechnische Anlagen', gewerk: 'Elektro' },
]

// AG-Nummern als feste Sequenz (fuer Iteration in UI/Actions).
export const AG_NUMBERS = [1, 2, 3, 4, 5] as const

// Gewerk-Aggregation: HLKS = AG 1–3, Elektro = AG 4–5.
export const HLKS_AGS = [1, 2, 3] as const
export const ELEKTRO_AGS = [4, 5] as const

export const GEWERK_GROUPS: { name: Gewerk; ags: readonly number[]; span: string }[] = [
  { name: 'HLKS', ags: HLKS_AGS, span: 'AG 1–3' },
  { name: 'Elektro', ags: ELEKTRO_AGS, span: 'AG 4–5' },
]

// Gewerk einer AG-Nummer (null = ausserhalb AG 1–5).
export function gewerkForAg(ag: number): Gewerk | null {
  if (ag >= 1 && ag <= 3) return 'HLKS'
  if (ag >= 4 && ag <= 5) return 'Elektro'
  return null
}

// Gewerkbudgets aus einer AG-Budget-Tabelle (ag_number -> budget_eur):
//   HLKS = AG 1 + AG 2 + AG 3   ·   Elektro = AG 4 + AG 5
// Fehlende/undefinierte AGs zaehlen als 0. Reine Aggregation der in Paket 10.1
// gespeicherten AG-Budgets — KEINE neue Budgetquelle, KEIN Abacus-/LPH-Zugriff.
export function gewerkBudgetsFromAg(
  budgetByAg: Record<number, number>
): Record<Gewerk, number> {
  return {
    HLKS: HLKS_AGS.reduce((s, ag) => s + (budgetByAg[ag] ?? 0), 0),
    Elektro: ELEKTRO_AGS.reduce((s, ag) => s + (budgetByAg[ag] ?? 0), 0),
  }
}

// Label einer AG-Nummer (Fallback "AG n", falls ausserhalb 1–5).
export function agLabel(ag: number): string {
  return ANLAGENGRUPPEN.find((a) => a.ag === ag)?.label ?? `AG ${ag}`
}

// ── DUMMY-Verteilung des HOAI-Gesamthonorars auf AG 1–5 (Paket 10.1) ─────────
// TRANSPARENT / UNVERBINDLICH: rein heuristische TGA-Aufteilung, KEINE
// rechtsverbindliche oder normbasierte Zuordnung. Dient nur dazu, aus einem
// HOAI-Dummy-Szenario AG-Budgets VORZUBELEGEN. Der User kann die Werte danach
// jederzeit manuell ueberschreiben. Summe der Prozente = 100.
//   HLKS (AG 1–3) = 65 %  ·  Elektro (AG 4–5) = 35 %
export const HOAI_DUMMY_AG_SPLIT: { ag: number; pct: number }[] = [
  { ag: 1, pct: 15 },
  { ag: 2, pct: 25 },
  { ag: 3, pct: 25 },
  { ag: 4, pct: 25 },
  { ag: 5, pct: 10 },
]

// Summe der Split-Prozente (zur Anzeige/Validierung).
export const HOAI_DUMMY_AG_SPLIT_SUM = HOAI_DUMMY_AG_SPLIT.reduce((s, r) => s + r.pct, 0)
