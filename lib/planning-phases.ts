// Planungsschritte — zentrale Definition (kein 'use server'!)
export const PLANNING_PHASES = [
  { key: 'basic',       label: 'Basic Design',  lph: [1, 2, 3, 4] },
  { key: 'detail',      label: 'Detail Design', lph: [5, 6, 7] },
  { key: 'ausfuehrung', label: 'Ausführung',    lph: [8] },
] as const

export type PhaseKey = typeof PLANNING_PHASES[number]['key']

// Alle Leistungsphasen 1–9 mit vollem Namen (HOAI).
export const ALL_LPH = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export const LPH_LABELS: Record<number, string> = {
  1: 'Grundlagenermittlung',
  2: 'Vorplanung',
  3: 'Entwurfsplanung',
  4: 'Genehmigungsplanung',
  5: 'Ausführungsplanung',
  6: 'Vorbereitung der Vergabe',
  7: 'Mitwirkung bei der Vergabe',
  8: 'Objektüberwachung',
  9: 'Objektbetreuung',
}