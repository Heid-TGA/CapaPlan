'use server'

import { createClient } from '@/lib/supabase/server'

export interface LphSchedule {
  lph_number: number
  start_kw: number
  start_year: number
  end_kw: number
  end_year: number
}

export interface Milestone {
  id?: string
  lph_number: number
  kw: number
  year: number
  type: 'external' | 'internal'
  description: string
}

export async function loadSchedule(projectId: string): Promise<{
  schedules: LphSchedule[]
  milestones: Milestone[]
}> {
  const supabase = await createClient()

  const [{ data: schedules }, { data: milestones }] = await Promise.all([
    supabase
      .from('lph_schedules')
      .select('lph_number, start_kw, start_year, end_kw, end_year')
      .eq('project_id', projectId)
      .order('lph_number'),
    supabase
      .from('milestones')
      .select('id, lph_number, kw, year, type, description')
      .eq('project_id', projectId)
      .order('kw'),
  ])

  return {
    schedules: (schedules ?? []) as LphSchedule[],
    milestones: (milestones ?? []) as Milestone[],
  }
}

export async function upsertSchedule(
  projectId: string,
  schedule: LphSchedule
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('lph_schedules')
    .upsert(
      {
        project_id: projectId,
        lph_number: schedule.lph_number,
        start_kw: schedule.start_kw,
        start_year: schedule.start_year,
        end_kw: schedule.end_kw,
        end_year: schedule.end_year,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,lph_number' }
    )

  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Terminplan gespeichert.' }
}

export async function upsertMilestone(
  projectId: string,
  milestone: Milestone
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient()

  const payload = {
    project_id: projectId,
    lph_number: milestone.lph_number,
    kw: milestone.kw,
    year: milestone.year,
    type: milestone.type,
    description: milestone.description,
  }

  const { error } = milestone.id
    ? await supabase.from('milestones').update(payload).eq('id', milestone.id)
    : await supabase.from('milestones').insert(payload)

  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Meilenstein gespeichert.' }
}

export async function deleteMilestone(
  milestoneId: string
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('milestones').delete().eq('id', milestoneId)
  if (error) return { success: false, message: error.message }
  return { success: true, message: 'Meilenstein gelöscht.' }
}
