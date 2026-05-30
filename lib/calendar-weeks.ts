// Zentrale ISO-Kalenderwochen-Helfer (Phase 1).
// KEIN 'use server', KEINE DB-Zugriffe — reine TypeScript-Helfer.
// Alles datumsbasiert in UTC, damit Zeitzonen-Drift und Jahreswechsel/KW 53
// korrekt behandelt werden.

export interface WeekRef {
  year: number
  week: number
}

export interface WindowWeek extends WeekRef {
  isCurrent: boolean
}

// ── Grundfunktionen ──────────────────────────────────────────────────────────

/** Montag (00:00 UTC) der angegebenen ISO-Woche. */
export function mondayOfIsoWeek(year: number, week: number): Date {
  // Jan 4 liegt per ISO 8601 immer in KW 1.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Dow = (jan4.getUTCDay() + 6) % 7 // 0 = Montag
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Dow)
  const monday = new Date(mondayWeek1)
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7)
  return monday
}

/** ISO-Jahr und ISO-Woche eines Datums. */
export function isoWeekOf(date: Date): WeekRef {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Montag
  // Donnerstag dieser Woche bestimmt das ISO-Jahr.
  d.setUTCDate(d.getUTCDate() - dow + 3)
  const isoYear = d.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const ftDow = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDow + 3)
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return { year: isoYear, week }
}

/** Anzahl ISO-Wochen eines Jahres (52 oder 53). */
export function isoWeeksInYear(year: number): 52 | 53 {
  // Das Jahr hat 53 Wochen, wenn der 28. Dezember in KW 53 fällt
  // (der 28.12. liegt immer in der letzten ISO-Woche des Jahres).
  return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week === 53 ? 53 : 52
}

/** Aktuelle ISO-Woche (ersetzt die bisherigen getCurrentWeek()/getFullYear()-Kombis). */
export function currentIsoWeek(): WeekRef {
  return isoWeekOf(new Date())
}

/** Wochen-Arithmetik mit korrektem Jahr-Rollover (auch rückwärts, auch über KW 53). */
export function addWeeks(ref: WeekRef, delta: number): WeekRef {
  const monday = mondayOfIsoWeek(ref.year, ref.week)
  monday.setUTCDate(monday.getUTCDate() + delta * 7)
  return isoWeekOf(monday)
}

// ── Fenster ──────────────────────────────────────────────────────────────────

/** Fortlaufendes Fenster aus `horizon` ISO-Wochen ab `start` (inkl. isCurrent-Markierung). */
export function buildWeekWindow(start: WeekRef, horizon = 12): WindowWeek[] {
  const today = currentIsoWeek()
  const weeks: WindowWeek[] = []
  for (let i = 0; i < horizon; i++) {
    const { year, week } = addWeeks(start, i)
    weeks.push({ year, week, isCurrent: year === today.year && week === today.week })
  }
  return weeks
}

// ── Convenience für Action-Queries ───────────────────────────────────────────

/** Distinct KW-Nummern eines Fensters. */
export function weekNumbers(window: WeekRef[]): number[] {
  return [...new Set(window.map((w) => w.week))]
}

/** Distinct Jahre eines Fensters. */
export function yearsOf(window: WeekRef[]): number[] {
  return [...new Set(window.map((w) => w.year))]
}
