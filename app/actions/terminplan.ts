'use server'

import { createClient } from '@/lib/supabase/server'

export interface LphSchedule {
  lph_id: string
  lph_number: number
  budget_eur: number
  start_kw: number | null
  end_kw: number | null
  plan_year: number
}

export interface Milestone {
  id: string
  lph_id: string
  lph_number: number
  kw: number
  year: number
  type: 'external' | 'internal'
  description: string
}

// Alle LPH-Termine + Meilensteine für ein Projekt laden
export async function loadTerminplan(projectId: string): Promise<{
  schedules: LphSchedule[]
  milestones: Milestone[]
}> {
  const supabase = await createClient()

  const { data: lphData, error: lphError } = await supabase
    .from('project_lph_budgets')
    .select('id, lph_number, budget_eur, start_kw, end_kw, plan_year')
    .eq('project_id', projectId)
    .order('lph_number')

  if (lphError) throw new Error(lphError.message)

  const { data: msData, error: msError } = await supabase
    .from('milestones')
    .select('id, lph_id, kw, year, type, description, project_lph_budgets(lph_number)')
    .eq('project_id', projectId)
    .order('kw')

  if (msError) throw new Error(msError.message)

  const schedules: LphSchedule[] = (lphData ?? []).map((l) => ({
    lph_id: l.id,
    lph_number: l.lph_number,
    budget_eur: l.budget_eur,
    start_kw: l.start_kw,
    end_kw: l.end_kw,
    plan_year: l.plan_year ?? 2026,
  }))

  const milestones: Milestone[] = (msData ?? []).map((m) => {
    const lphRow = m.project_lph_budgets
    const lphNum = Array.isArray(lphRow) ? lphRow[0]?.lph_number : (lphRow as { lph_number: number } | null)?.lph_number
    return {
      id: m.id,
      lph_id: m.lph_id,
      lph_number: lphNum ?? 0,
      kw: m.kw,
      year: m.year,
      type: m.type as 'external' | 'internal',
      description: m.description,
    }
  })

  return { schedules, milestones }
}

// LPH-Termine speichern
export async function saveLphSchedule(
  lphId: string,
  startKw: number | null,
  endKw: number | null,
  planYear: number
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('project_lph_budgets')
    .update({ start_kw: startKw, end_kw: endKw, plan_year: planYear })
    .eq('id', lphId)

  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Gespeichert' }
}

// Meilenstein upserten
export async function saveMilestone(
  projectId: string,
  lphId: string,
  kw: number,
  year: number,
  type: 'external' | 'internal',
  description: string
): Promise<{ success: boolean; id: string | null; message: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('milestones')
    .insert({ project_id: projectId, lph_id: lphId, kw, year, type, description })
    .select('id')
    .single()

  if (error) return { success: false, id: null, message: error.message }
  return { success: true, id: data.id, message: 'Meilenstein gespeichert' }
}

// Meilenstein löschen
export async function deleteMilestone(
  milestoneId: string
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('milestones')
    .delete()
    .eq('id', milestoneId)

  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Gelöscht' }
}
