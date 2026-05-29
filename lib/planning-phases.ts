// Planungsschritte — zentrale Definition (kein 'use server'!)
export const PLANNING_PHASES = [
  { key: 'basic',       label: 'Basic Design',  lph: [1, 2, 3, 4] },
  { key: 'detail',      label: 'Detail Design', lph: [5, 6, 7] },
  { key: 'ausfuehrung', label: 'Ausführung',    lph: [8] },
] as const

export type PhaseKey = typeof PLANNING_PHASES[number]['key']