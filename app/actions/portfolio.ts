'use server'

import { createClient } from '@/lib/supabase/server'
import { buildWeekWindow } from '@/lib/calendar-weeks'

// ── Portfolio-Daten (read-only) ──────────────────────────────────────────────
// Stufe 1: liefert die Rohdaten für die TL-Portfolio-Übersicht (Projekte ×
// 12 KW) in EINEM Aufruf — vermeidet das N+1 von loadTerminplan (pro Projekt).
// Keine Schreibfunktion, kein RPC, kein hourly_rate_eur. Status/Ampel werden
// client-seitig aus diesen Rohdaten berechnet (PortfolioView).

export interface PortfolioWeek {
  year: number
  week: number
  isCurrent: boolean
}

export interface PortfolioProject {
  id: string
  project_number: string
  name: string
}

// LPH-Terminplan direkt aus project_lph_budgets (start_kw/end_kw/plan_year).
// start_kw/end_kw sind nullable → Projekt ohne Terminplan hat überall null.
export interface PortfolioLphSchedule {
  project_id: string
  lph_number: number
  start_kw: number | null
  end_kw: number | null
  plan_year: number
}

export interface PortfolioEmployee {
  id: string
  name: string
  role_type: string
  department: string
  weekly_capacity_hours: number
}

export interface PortfolioAllocation {
  project_id: string
  employee_id: string
  lph_number: number
  calendar_week: number
  year: number
  allocated_hours: number
  source: string
}

export interface PortfolioData {
  weeks: PortfolioWeek[]
  projects: PortfolioProject[]
  lphSchedule: PortfolioLphSchedule[]
  employees: PortfolioEmployee[]
  allocations: PortfolioAllocation[]
}

// ── Embedding-Helfer (analog heatmap.ts) ─────────────────────────────────────

type LphRow = { lph_number: number } | { lph_number: number }[] | null

function extractLph(l: LphRow): number {
  if (!l) return 0
  if (Array.isArray(l)) return l[0]?.lph_number ?? 0
  return l.lph_number
}

// ── Haupt-Action ─────────────────────────────────────────────────────────────

export async function loadPortfolioData(
  refYear: number,
  refWeek: number,
  horizon = 12
): Promise<PortfolioData> {
  const supabase = await createClient()

  const weeks = buildWeekWindow({ year: refYear, week: refWeek }, horizon)
  const years = [...new Set(weeks.map((w) => w.year))]
  const weekNumbers = [...new Set(weeks.map((w) => w.week))]
  const windowKeys = new Set(weeks.map((w) => `${w.year}-${w.week}`))

  // Projekte — TL sieht alle (RLS).
  const { data: projects, error: projError } = await supabase
    .from('projects')
    .select('id, project_number, name')
    .order('project_number')
  if (projError) throw new Error(projError.message)

  // LPH-Terminplan gebündelt für ALLE Projekte (start_kw/end_kw/plan_year).
  const { data: lphRows, error: lphError } = await supabase
    .from('project_lph_budgets')
    .select('project_id, lph_number, start_kw, end_kw, plan_year')
    .order('lph_number')
  if (lphError) throw new Error(lphError.message)

  // Mitarbeiter — ausschließlich employees_public (kein hourly_rate_eur).
  const { data: employees, error: empError } = await supabase
    .from('employees_public')
    .select('id, name, role_type, department, weekly_capacity_hours')
    .order('department')
    .order('name')
  if (empError) throw new Error(empError.message)

  // Allocations im Fenster. .in() überfetcht das Kreuzprodukt (year × week);
  // anschließend exakt auf die Fenster-Paare (year, week) filtern.
  const { data: allocRows, error: allocError } = await supabase
    .from('allocations')
    .select(`
      project_id,
      employee_id,
      calendar_week,
      year,
      allocated_hours,
      source,
      project_lph_budgets ( lph_number )
    `)
    .in('year', years)
    .in('calendar_week', weekNumbers)
  if (allocError) throw new Error(allocError.message)

  const allocations: PortfolioAllocation[] = (allocRows ?? [])
    .filter((a) => windowKeys.has(`${a.year}-${a.calendar_week}`))
    .map((a) => ({
      project_id: a.project_id,
      employee_id: a.employee_id,
      lph_number: extractLph(a.project_lph_budgets as LphRow),
      calendar_week: a.calendar_week,
      year: a.year,
      allocated_hours: a.allocated_hours,
      source: a.source,
    }))

  const lphSchedule: PortfolioLphSchedule[] = (lphRows ?? []).map((l) => ({
    project_id: l.project_id,
    lph_number: l.lph_number,
    start_kw: l.start_kw,
    end_kw: l.end_kw,
    plan_year: l.plan_year ?? refYear,
  }))

  return {
    weeks,
    projects: projects ?? [],
    lphSchedule,
    employees: employees ?? [],
    allocations,
  }
}
