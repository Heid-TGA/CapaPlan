// Portfolio-Status-/Ampel-Logik (Stufe 1) — reine TypeScript-Helfer.
// KEIN 'use server', KEINE DB-Zugriffe, KEINE Schreibfunktionen.
// Verarbeitet ausschließlich die Rohdaten aus app/actions/portfolio.ts.

import { PLANNING_PHASES, type PhaseKey } from './planning-phases'
import type {
  PortfolioData,
  PortfolioProject,
  PortfolioWeek,
  PortfolioLphSchedule,
  PortfolioEmployee,
  PortfolioAllocation,
} from '@/app/actions/portfolio'

// ── Zentrale Schwellenwerte (hier zentral änderbar) ──────────────────────────

/** Mind. so viele zusammenhängende Leerwochen in der laufenden Phase → „unvollständig". */
export const INCOMPLETE_GAP_WEEKS = 2

/** Globale Auslastung über diesem Anteil → Engpass (rot). 1.05 = 105 %. */
export const OVERLOAD_THRESHOLD = 1.05

/** Globale Auslastung ab diesem Anteil (bis einschließlich OVERLOAD) → Beobachten (gelb). */
export const WATCH_THRESHOLD = 0.9

// ── Typen ────────────────────────────────────────────────────────────────────

/** KPI-/Filter-Bucket. Grau-Fälle (kein Terminplan / ohne Zuweisung) landen in „nicht_terminiert". */
export type PortfolioStatus = 'engpass' | 'beobachten' | 'nicht_terminiert' | 'ok'

export interface PhaseSpan {
  key: PhaseKey
  label: string
  startKw: number
  endKw: number
  planYear: number
}

export interface ProjectStatusResult {
  status: PortfolioStatus
  /** Feines Label inkl. Nuance („Nicht terminiert" vs. „Ohne Zuweisung"). */
  label: string
  /** Klartext-Gründe für Tooltip. */
  reasons: string[]
}

export interface PortfolioRow {
  project: PortfolioProject
  spans: PhaseSpan[]
  currentPhaseLabel: string
  status: PortfolioStatus
  statusLabel: string
  reasons: string[]
}

// ── Wochen-/Phasen-Helfer ────────────────────────────────────────────────────

function ywRank(year: number, week: number): number {
  return year * 100 + week
}

function weekInSpan(w: PortfolioWeek, s: PhaseSpan): boolean {
  return w.year === s.planYear && w.week >= s.startKw && w.week <= s.endKw
}

/** Phasen-Spannen (Basic/Detail/Ausführung) aus den LPH-Terminzeilen eines Projekts. */
export function computePhaseSpans(lph: PortfolioLphSchedule[]): PhaseSpan[] {
  const spans: PhaseSpan[] = []
  for (const phase of PLANNING_PHASES) {
    const rows = lph.filter(
      (l) => phase.lph.includes(l.lph_number as never) && l.start_kw != null && l.end_kw != null,
    )
    if (rows.length === 0) continue

    // Start = kleinste start_kw; deren plan_year bestimmt das Jahr der Spanne.
    let startRow = rows[0]
    for (const r of rows) {
      if ((r.start_kw as number) < (startRow.start_kw as number)) startRow = r
    }
    spans.push({
      key: phase.key,
      label: phase.label,
      startKw: startRow.start_kw as number,
      endKw: Math.max(...rows.map((r) => r.end_kw as number)),
      planYear: startRow.plan_year,
    })
  }
  return spans
}

/** Spalten-Indizes (im 12-KW-Fenster), die eine Spanne abdeckt — auf das Fenster geclippt. */
export function spanToColumns(
  span: PhaseSpan,
  weeks: PortfolioWeek[],
): { startIdx: number; endIdx: number } | null {
  let startIdx = -1
  let endIdx = -1
  weeks.forEach((w, i) => {
    if (weekInSpan(w, span)) {
      if (startIdx < 0) startIdx = i
      endIdx = i
    }
  })
  return startIdx < 0 ? null : { startIdx, endIdx }
}

/** Die aktuell laufende Phase (Spanne, die die Heute-KW enthält) — oder null. */
function currentSpan(spans: PhaseSpan[], weeks: PortfolioWeek[]): PhaseSpan | null {
  const today = weeks.find((w) => w.isCurrent) ?? weeks[0]
  if (!today) return null
  return spans.find((s) => weekInSpan(today, s)) ?? null
}

/** Anzeige-Label für die „aktuelle Phase" einer Projektzeile. */
export function currentPhaseLabel(spans: PhaseSpan[], weeks: PortfolioWeek[]): string {
  if (spans.length === 0) return 'Nicht terminiert'
  const today = weeks.find((w) => w.isCurrent) ?? weeks[0]
  if (!today) return 'Nicht terminiert'

  const running = spans.find((s) => weekInSpan(today, s))
  if (running) return running.label

  const todayRank = ywRank(today.year, today.week)
  const upcoming = spans
    .filter((s) => ywRank(s.planYear, s.startKw) > todayRank)
    .sort((a, b) => ywRank(a.planYear, a.startKw) - ywRank(b.planYear, b.startKw))[0]
  if (upcoming) return `ab KW ${upcoming.startKw}: ${upcoming.label}`

  return 'Abgeschlossen'
}

// ── Globale Auslastung ───────────────────────────────────────────────────────

/** Map „empId|year|week" → globaler Auslastungsanteil (über ALLE Projekte). */
export function buildGlobalLoad(
  allocations: PortfolioAllocation[],
  employees: PortfolioEmployee[],
): Map<string, number> {
  const capacity = new Map(employees.map((e) => [e.id, e.weekly_capacity_hours]))
  const hours = new Map<string, number>()
  for (const a of allocations) {
    const key = `${a.employee_id}|${a.year}|${a.calendar_week}`
    hours.set(key, (hours.get(key) ?? 0) + a.allocated_hours)
  }
  const load = new Map<string, number>()
  for (const [key, h] of hours) {
    const empId = key.slice(0, key.indexOf('|'))
    const cap = capacity.get(empId) ?? 0
    load.set(key, cap > 0 ? h / cap : 0)
  }
  return load
}

// ── Status-/Ampel-Berechnung ─────────────────────────────────────────────────

export function computeProjectStatus(args: {
  weeks: PortfolioWeek[]
  spans: PhaseSpan[]
  projectAllocations: PortfolioAllocation[]
  globalLoad: Map<string, number>
  employeeNames: Map<string, string>
}): ProjectStatusResult {
  const { weeks, spans, projectAllocations, globalLoad, employeeNames } = args
  const reasons: string[] = []

  // 1) Grau — kein Terminplan.
  if (spans.length === 0) {
    return { status: 'nicht_terminiert', label: 'Nicht terminiert', reasons: ['Kein Terminplan hinterlegt'] }
  }

  // 2) Grau — terminiert, aber keine Zuweisung im Zeitraum.
  if (projectAllocations.length === 0) {
    return { status: 'nicht_terminiert', label: 'Ohne Zuweisung', reasons: ['Keine Zuweisung im Zeitraum'] }
  }

  const assigned = [...new Set(projectAllocations.map((a) => a.employee_id))]
  const spanWeeks = weeks.filter((w) => spans.some((s) => weekInSpan(w, s)))

  // 3) Rot — ein zugewiesener MA innerhalb der Phase global > 105 %.
  //    Gleichzeitig 90–105 % für die spätere Gelb-Entscheidung merken.
  let watchLoad = false
  for (const empId of assigned) {
    for (const w of spanWeeks) {
      const load = globalLoad.get(`${empId}|${w.year}|${w.week}`) ?? 0
      if (load > OVERLOAD_THRESHOLD) {
        reasons.push(`${employeeNames.get(empId) ?? 'MA'} · KW ${w.week}: ${Math.round(load * 100)} %`)
      } else if (load >= WATCH_THRESHOLD) {
        watchLoad = true
      }
    }
  }
  if (reasons.length > 0) {
    return { status: 'engpass', label: 'Engpass', reasons }
  }

  // 4a) Gelb — Stunden außerhalb der Terminphase (bereits ab 1 KW).
  let outside = false
  for (const a of projectAllocations) {
    const inSomeSpan = spans.some(
      (s) => s.planYear === a.year && a.calendar_week >= s.startKw && a.calendar_week <= s.endKw,
    )
    if (a.allocated_hours > 0 && !inSomeSpan) {
      outside = true
      reasons.push(`Stunden außerhalb Phase · KW ${a.calendar_week}`)
      break
    }
  }

  // 4b) Gelb — ≥ INCOMPLETE_GAP_WEEKS zusammenhängende Leerwochen in der laufenden Phase.
  let gap = false
  const running = currentSpan(spans, weeks)
  if (running) {
    const hoursByWeek = new Map<string, number>()
    for (const a of projectAllocations) {
      const key = `${a.year}|${a.calendar_week}`
      hoursByWeek.set(key, (hoursByWeek.get(key) ?? 0) + a.allocated_hours)
    }
    let run = 0
    for (const w of weeks.filter((x) => weekInSpan(x, running))) {
      const h = hoursByWeek.get(`${w.year}|${w.week}`) ?? 0
      if (h === 0) {
        run++
        if (run >= INCOMPLETE_GAP_WEEKS) gap = true
      } else {
        run = 0
      }
    }
    if (gap) reasons.push(`≥ ${INCOMPLETE_GAP_WEEKS} Leerwochen in laufender Phase`)
  }

  if (watchLoad) reasons.unshift('Auslastung 90–105 %')

  if (watchLoad || outside || gap) {
    return { status: 'beobachten', label: 'Beobachten', reasons }
  }

  // 5) Grün.
  return { status: 'ok', label: 'OK', reasons: ['Terminiert, Zuweisung ohne Auffälligkeit'] }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/** Baut die fertigen Portfolio-Zeilen. Reihenfolge = Eingabereihenfolge (projects),
 *  „nicht terminiert" wird NICHT ans Ende sortiert. */
export function buildPortfolioRows(data: PortfolioData): PortfolioRow[] {
  const { weeks, projects, lphSchedule, employees, allocations } = data
  const globalLoad = buildGlobalLoad(allocations, employees)
  const employeeNames = new Map(employees.map((e) => [e.id, e.name]))

  return projects.map((project) => {
    const lph = lphSchedule.filter((l) => l.project_id === project.id)
    const projectAllocations = allocations.filter((a) => a.project_id === project.id)
    const spans = computePhaseSpans(lph)
    const result = computeProjectStatus({ weeks, spans, projectAllocations, globalLoad, employeeNames })

    return {
      project,
      spans,
      currentPhaseLabel: currentPhaseLabel(spans, weeks),
      status: result.status,
      statusLabel: result.label,
      reasons: result.reasons,
    }
  })
}
