// HOAI-Rechner je Anlagengruppe (Paket 10.4).
//
// Reine TypeScript-Helfer — KEIN 'use server', KEINE DB-Zugriffe. Liegt bewusst
// in lib/, damit Server Actions (app/actions/hoai-scenarios.ts,
// app/actions/project-budget-source.ts) UND Client-Komponenten
// (HoaiCalculatorModal, ProjectPlanningView) dieselbe AG-/LPH-Logik teilen.
//
// ABGRENZUNG (nicht verhandelbar):
//   * Vereinfachter Planungs-/Dummy-Rechner, KEINE rechtsverbindliche
//     HOAI-Berechnung.
//   * NUR AG 1–5 (Gewerk-Zuordnung über lib/anlagengruppen.ts), AG 6–8 bewusst
//     nicht modelliert.
//   * NUR LPH 1–7 (LPH 8/9 sind hier kein Bestandteil — die Summe der
//     LPH-Anteile ist daher < 100 %).
//   * Begriff: das je AG feste „Grundhonorar" = anrechenbare Kosten × Honorar-%.
//     Die je LPH ausgewählte Summe ist die EFFEKTIVE Planungsbasis (≤ Grundhonorar).
//
// WICHTIG: lib/hoai-dummy.ts (Paket 6B) bleibt unverändert und wird weiterhin
// für die EINFACHE (Nicht-AG-)Verteilung genutzt; dieses Modul ist additiv.

import { type Gewerk, gewerkForAg, AG_NUMBERS } from './anlagengruppen'

// LPH 1–7 (LPH 8/9 bewusst ausgeschlossen).
export const HOAI_AG_LPH_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const

// Fachlich richtige Default-Anteile je LPH (HOAI, TGA). Bleiben als Default,
// sind aber pro AG editierbar. Summe = 62 % (kein Voll-100 %, da ohne LPH 8/9).
export const HOAI_AG_LPH_DEFAULT_PCT: Record<number, number> = {
  1: 2,   // Grundlagenermittlung
  2: 9,   // Vorplanung
  3: 17,  // Entwurfsplanung
  4: 2,   // Genehmigungsplanung
  5: 22,  // Ausführungsplanung
  6: 6,   // Vorbereitung der Vergabe
  7: 4,   // Mitwirkung bei der Vergabe
}

export const HOAI_AG_LPH_DEFAULT_SUM = HOAI_AG_LPH_NUMBERS.reduce(
  (s, n) => s + (HOAI_AG_LPH_DEFAULT_PCT[n] ?? 0),
  0
)

export interface HoaiAgLphConfig {
  lph_number: number
  selected: boolean
  pct: number
}

export interface HoaiAgConfig {
  ag_number: number
  enabled: boolean
  anrechenbare_kosten: number
  honorar_pct: number
  lphs: HoaiAgLphConfig[]
}

// Auf 2 Nachkommastellen runden (numeric(.,2) / Euro).
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Klemmt einen Prozentwert auf 0..100 (ungueltig -> 0).
function clampPct(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
}

// Grundhonorar einer AG = anrechenbare Kosten × Honorar-% / 100. FEST,
// unabhängig davon, welche LPH angehakt sind. Negative/ungueltige Eingaben -> 0.
export function grundhonorar(anrechenbareKosten: number, honorarPct: number): number {
  const k = Number.isFinite(anrechenbareKosten) && anrechenbareKosten > 0 ? anrechenbareKosten : 0
  return (k * clampPct(honorarPct)) / 100
}

// Honorar einer einzelnen LPH = Grundhonorar × Anteil / 100.
export function lphHonorar(grund: number, pct: number): number {
  const g = Number.isFinite(grund) && grund > 0 ? grund : 0
  return (g * clampPct(pct)) / 100
}

// Default-LPH-Konfiguration (alle LPH 1–7 ausgewählt, Default-Prozente).
export function defaultLphConfigs(): HoaiAgLphConfig[] {
  return HOAI_AG_LPH_NUMBERS.map((n) => ({
    lph_number: n,
    selected: true,
    pct: HOAI_AG_LPH_DEFAULT_PCT[n] ?? 0,
  }))
}

// Default-Konfiguration einer AG (deaktiviert, 0 € Kosten, 12 % Honorar).
export function defaultAgConfig(ag: number): HoaiAgConfig {
  return {
    ag_number: ag,
    enabled: false,
    anrechenbare_kosten: 0,
    honorar_pct: 12,
    lphs: defaultLphConfigs(),
  }
}

// Vollständige Default-Konfiguration für AG 1–5.
export function defaultAgConfigs(): HoaiAgConfig[] {
  return AG_NUMBERS.map((ag) => defaultAgConfig(ag))
}

// Summen einer AG-Tabelle:
//   * grund      = Grundhonorar (fest)
//   * pctSum     = Summe der AUSGEWÄHLTEN LPH-Prozente (nicht zwingend 100 %)
//   * honorarSum = Summe der AUSGEWÄHLTEN LPH-Honorare (= effektives AG-Budget)
export function agSelectedSums(ag: HoaiAgConfig): {
  grund: number
  pctSum: number
  honorarSum: number
} {
  const grund = grundhonorar(ag.anrechenbare_kosten, ag.honorar_pct)
  let pctSum = 0
  let honorarSum = 0
  for (const l of ag.lphs) {
    if (!l.selected) continue
    pctSum += clampPct(l.pct)
    honorarSum += lphHonorar(grund, l.pct)
  }
  return { grund, pctSum, honorarSum }
}

// AG-Budget = Summe der AUSGEWÄHLTEN LPH-Honorare dieser AG.
// Deaktivierte AG -> 0. (Quelle für project_ag_budgets, source_type 'hoai'.)
export function agBudgetFromConfig(ag: HoaiAgConfig): number {
  if (!ag.enabled) return 0
  return round2(agSelectedSums(ag).honorarSum)
}

// Gewerk-/LPH-Budgetmatrix aus AG-Konfigurationen ableiten:
//   HLKS LPH n = Σ ausgewählte LPH-n-Honorare aus AG 1, 2, 3
//   Elektro LPH n = Σ ausgewählte LPH-n-Honorare aus AG 4, 5
// Nur AKTIVIERTE AG und AUSGEWÄHLTE LPH zählen. Keine Vermischung der Gewerke.
export function gewerkLphBudgetsFromConfigs(
  configs: HoaiAgConfig[]
): Record<Gewerk, Record<number, number>> {
  const out: Record<Gewerk, Record<number, number>> = { HLKS: {}, Elektro: {} }
  for (const ag of configs) {
    if (!ag.enabled) continue
    const g = gewerkForAg(ag.ag_number)
    if (!g) continue
    const grund = grundhonorar(ag.anrechenbare_kosten, ag.honorar_pct)
    for (const l of ag.lphs) {
      if (!l.selected) continue
      out[g][l.lph_number] = round2((out[g][l.lph_number] ?? 0) + lphHonorar(grund, l.pct))
    }
  }
  return out
}

// Gewerkbudget (Σ über LPH 1–7) aus der Gewerk-/LPH-Matrix.
export function gewerkBudgetFromLphMap(lphMap: Record<number, number>): number {
  return round2(HOAI_AG_LPH_NUMBERS.reduce((s, n) => s + (lphMap[n] ?? 0), 0))
}
