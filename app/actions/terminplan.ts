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

// LPH-Budgetzeile sicherstellen (idempotent).
// Erlaubt das Hinzufügen einer LPH OHNE Budget im Terminplan: legt bei Bedarf eine
// Zeile mit budget_eur = 0 an, damit die LPH eine echte lph_id bekommt (Terminbalken,
// Meilensteine). Eine bereits vorhandene Zeile wird NICHT überschrieben — weder Budget
// noch start_kw/end_kw/plan_year. plan_year nutzt beim Anlegen den DB-Default (2026).
// Abacus kann diese 0-Euro-Zeile später via upsert(onConflict: project_id,lph_number)
// mit echtem budget_eur aktualisieren, ohne die Terminplanfelder zu verlieren.
export async function ensureLphBudgetRow(
  projectId: string,
  lphNumber: number
): Promise<{ success: boolean; message: string; row: LphSchedule | null }> {
  if (!Number.isInteger(lphNumber) || lphNumber < 1 || lphNumber > 9) {
    return { success: false, message: 'lph_number muss zwischen 1 und 9 liegen', row: null }
  }

  const supabase = await createClient()

  // 1. Bereits vorhanden? Dann unverändert zurückgeben (nichts überschreiben).
  const { data: existing, error: selError } = await supabase
    .from('project_lph_budgets')
    .select('id, lph_number, budget_eur, start_kw, end_kw, plan_year')
    .eq('project_id', projectId)
    .eq('lph_number', lphNumber)
    .maybeSingle()

  if (selError) return { success: false, message: selError.message, row: null }

  if (existing) {
    return {
      success: true,
      message: 'Bereits vorhanden',
      row: {
        lph_id: existing.id,
        lph_number: existing.lph_number,
        budget_eur: existing.budget_eur,
        start_kw: existing.start_kw,
        end_kw: existing.end_kw,
        plan_year: existing.plan_year ?? 2026,
      },
    }
  }

  // 2. Nicht vorhanden → neue 0-Euro-Zeile. start_kw/end_kw bleiben NULL (noch kein Balken).
  const { data: created, error: insError } = await supabase
    .from('project_lph_budgets')
    .insert({ project_id: projectId, lph_number: lphNumber, budget_eur: 0 })
    .select('id, lph_number, budget_eur, start_kw, end_kw, plan_year')
    .single()

  if (insError) return { success: false, message: insError.message, row: null }

  return {
    success: true,
    message: 'Angelegt',
    row: {
      lph_id: created.id,
      lph_number: created.lph_number,
      budget_eur: created.budget_eur,
      start_kw: created.start_kw,
      end_kw: created.end_kw,
      plan_year: created.plan_year ?? 2026,
    },
  }
}
