// HOAI-DUMMY-Rechner (Paket 6B / Ergaenzung A2).
// Reine TypeScript-Helfer — KEIN 'use server', KEINE DB-Zugriffe.
//
// WICHTIG: Dies ist ein DUMMY-/Planungsrechner, KEINE rechtsverbindliche
// HOAI-Berechnung. Die Prozentwerte und der Honorarsatz sind vereinfachte
// Platzhalter fuer das MVP und beziehen sich ausschliesslich auf TGA.
//
// Ergebnisse sind reine SZENARIO-Werte. Sie fliessen NICHT in
// project_lph_budgets, allocations, Meilensteine oder Gewerke ein und werden
// im MVP NICHT persistiert.

// Dummy-Gesamthonorar als Prozentsatz der anrechenbaren Kosten.
export const HOAI_DUMMY_HONORAR_PCT = 12

// Dummy-Verteilung des Gesamthonorars auf die Leistungsphasen 1–9.
// Summe der Prozentwerte: exakt 100 (siehe HOAI_DUMMY_SPLIT_SUM).
export const HOAI_DUMMY_LPH_SPLIT: { lph: number; pct: number }[] = [
  { lph: 1, pct: 2 },   // Grundlagenermittlung
  { lph: 2, pct: 9 },   // Vorplanung
  { lph: 3, pct: 17 },  // Entwurfsplanung
  { lph: 4, pct: 2 },   // Genehmigungsplanung
  { lph: 5, pct: 22 },  // Ausfuehrungsplanung
  { lph: 6, pct: 6 },   // Vorbereitung der Vergabe
  { lph: 7, pct: 4 },   // Mitwirkung bei der Vergabe
  { lph: 8, pct: 32 },  // Objektueberwachung
  { lph: 9, pct: 6 },   // Objektbetreuung
]

// Summe der Split-Prozente (zur Anzeige/Validierung in der UI).
export const HOAI_DUMMY_SPLIT_SUM = HOAI_DUMMY_LPH_SPLIT.reduce((s, r) => s + r.pct, 0)

export interface HoaiDummyRow {
  lph: number
  pct: number
  honorar: number
}

export interface HoaiDummyResult {
  anrechenbareKosten: number
  honorarPct: number
  totalHonorar: number
  rows: HoaiDummyRow[]
}

// Berechnet das Dummy-Honorar und dessen LPH-Verteilung.
// totalHonorar = anrechenbareKosten × honorarPct / 100
// honorar(LPH) = totalHonorar × pct(LPH) / 100
// honorarPct ist optional (Default = HOAI_DUMMY_HONORAR_PCT), damit gespeicherte
// Szenarien (A2b) mit eigenem Satz korrekt nachgerechnet werden koennen.
// Negative/ungueltige Eingaben werden auf 0 geklemmt; honorarPct auf 0..100.
export function calcHoaiDummy(
  anrechenbareKosten: number,
  honorarPct: number = HOAI_DUMMY_HONORAR_PCT
): HoaiDummyResult {
  const kosten = Number.isFinite(anrechenbareKosten) && anrechenbareKosten > 0
    ? anrechenbareKosten
    : 0
  const pct = Number.isFinite(honorarPct) ? Math.min(100, Math.max(0, honorarPct)) : 0
  const totalHonorar = (kosten * pct) / 100
  const rows = HOAI_DUMMY_LPH_SPLIT.map((r) => ({
    lph: r.lph,
    pct: r.pct,
    honorar: (totalHonorar * r.pct) / 100,
  }))
  return { anrechenbareKosten: kosten, honorarPct: pct, totalHonorar, rows }
}
