'use server'

import { createClient } from '@/lib/supabase/server'

export interface HeatmapAllocation {
  employee_id: string
  employee_name: string
  project_number: string
  project_name: string
  lph_number: number
  calendar_week: number
  year: number
  allocated_hours: number
  source: string
}

export interface HeatmapEmployee {
  id: string
  name: string
  role_type: string
  department: string
  weekly_capacity_hours: number
}

type ProjectRow = { project_number: string; name: string } | { project_number: string; name: string }[] | null
type LphRow = { lph_number: number } | { lph_number: number }[] | null

function extractProject(p: ProjectRow): { project_number: string; name: string } | null {
  if (!p) return null
  if (Array.isArray(p)) return p[0] ?? null
  return p
}

function extractLph(l: LphRow): { lph_number: number } | null {
  if (!l) return null
  if (Array.isArray(l)) return l[0] ?? null
  return l
}

export async function loadHeatmapData(
  year: number,
  weeks: number[]
): Promise<{ employees: HeatmapEmployee[]; allocations: HeatmapAllocation[] }> {
  const supabase = await createClient()

  const { data: employees, error: empError } = await supabase
    .from('employees_public')
    .select('id, name, role_type, department, weekly_capacity_hours')
    .order('department')
    .order('name')

  if (empError) throw new Error(empError.message)

  const { data: allocations, error: allocError } = await supabase
    .from('allocations')
    .select(`
      employee_id,
      calendar_week,
      year,
      allocated_hours,
      source,
      projects ( project_number, name ),
      project_lph_budgets ( lph_number )
    `)
    .in('year', [year, year - 1])
    .in('calendar_week', weeks)

  if (allocError) throw new Error(allocError.message)

  const empMap = new Map((employees ?? []).map((e) => [e.id, e.name]))

  const mapped: HeatmapAllocation[] = (allocations ?? []).map((a) => {
    const proj = extractProject(a.projects as ProjectRow)
    const lph = extractLph(a.project_lph_budgets as LphRow)
    return {
      employee_id: a.employee_id,
      employee_name: empMap.get(a.employee_id) ?? '—',
      project_number: proj?.project_number ?? '—',
      project_name: proj?.name ?? '—',
      lph_number: lph?.lph_number ?? 0,
      calendar_week: a.calendar_week,
      year: a.year,
      allocated_hours: a.allocated_hours,
      source: a.source,
    }
  })

  return { employees: employees ?? [], allocations: mapped }
}

export async function loadProjectAllocations(
  projectId: string,
  year: number,
  weeks: number[]
): Promise<{ employee_id: string; lph_number: number; calendar_week: number; allocated_hours: number; source: string }[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('allocations')
    .select(`
      employee_id,
      calendar_week,
      allocated_hours,
      source,
      project_lph_budgets ( lph_number )
    `)
    .eq('project_id', projectId)
    .in('year', [year, year - 1])
    .in('calendar_week', weeks)

  if (error) throw new Error(error.message)

  return (data ?? []).map((a) => {
    const lph = extractLph(a.project_lph_budgets as LphRow)
    return {
      employee_id: a.employee_id,
      lph_number: lph?.lph_number ?? 0,
      calendar_week: a.calendar_week,
      allocated_hours: a.allocated_hours,
      source: a.source,
    }
  })
}