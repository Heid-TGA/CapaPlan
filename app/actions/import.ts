'use server'

import { createClient } from '@/lib/supabase/server'

// ── Planungsschritte ───────────────────────────────────────────────────────────
// Basic Design  = LPH 1–4
// Detail Design = LPH 5–7
// Ausführung    = LPH 8
// LPH 9 wird ignoriert


// ── Helpers ────────────────────────────────────────────────────────────────────

function isObject(e: unknown): e is Record<string, unknown> {
  return typeof e === 'object' && e !== null
}

// Stunden aus Prozent + Wochenkapazität berechnen
// H&I gibt immer Tages-Prozent (25/50/75/100) aus.
// Tagesstunden = weekly_capacity_hours / 5 Arbeitstage
function calcHoursFromPercentage(percentage: number, weeklyCapacityHours: number): number {
  const hoursPerDay = weeklyCapacityHours / 5
  return Math.round((percentage / 100) * hoursPerDay * 10) / 10
}

// ── MyAbacus Import ────────────────────────────────────────────────────────────

export async function importAbacusBudgets(
  data: unknown
): Promise<{ success: boolean; message: string }> {
  if (!isObject(data)) {
    return { success: false, message: 'Datei muss ein JSON-Objekt mit "mitarbeiter" und "projekte" enthalten.' }
  }

  const supabase = await createClient()
  const log: string[] = []

  // ── 1. Mitarbeiter upserten ────────────────────────────────────────────────
  if (Array.isArray(data.mitarbeiter)) {
    let maCount = 0
    for (const ma of data.mitarbeiter as unknown[]) {
      if (!isObject(ma)) continue
      if (
        typeof ma.name !== 'string' ||
        typeof ma.role_type !== 'string' ||
        typeof ma.department !== 'string' ||
        typeof ma.weekly_capacity_hours !== 'number' ||
        typeof ma.hourly_rate_eur !== 'number'
      ) continue

      const { error } = await supabase
        .from('employees')
        .upsert(
          {
            name: ma.name,
            role_type: ma.role_type,
            department: ma.department,
            weekly_capacity_hours: ma.weekly_capacity_hours,
            hourly_rate_eur: ma.hourly_rate_eur,
          },
          { onConflict: 'name' }
        )

      if (error) {
        return { success: false, message: `Fehler bei Mitarbeiter "${ma.name}": ${error.message}` }
      }
      maCount++
    }
    log.push(`${maCount} Mitarbeiter`)
  }

  // ── 2. Projekte + LPH-Budgets upserten ────────────────────────────────────
  if (Array.isArray(data.projekte)) {
    const { data: users } = await supabase.from('users').select('id, name')
    const userMap = new Map(users?.map((u) => [u.name, u.id]) ?? [])
    const { data: { user: authUser } } = await supabase.auth.getUser()

    let projCount = 0
    let lphCount = 0

    for (const proj of data.projekte as unknown[]) {
      if (!isObject(proj)) continue
      if (typeof proj.project_number !== 'string' || typeof proj.name !== 'string') continue

      const plId =
        (typeof proj.pl_name === 'string' ? userMap.get(proj.pl_name) : undefined) ??
        authUser?.id

      if (!plId) continue

      const { data: upsertedProj, error: projError } = await supabase
        .from('projects')
        .upsert(
          { project_number: proj.project_number, name: proj.name, pl_id: plId },
          { onConflict: 'project_number' }
        )
        .select('id')
        .single()

      if (projError) {
        return { success: false, message: `Fehler bei Projekt "${proj.project_number}": ${projError.message}` }
      }

      projCount++

      // LPH-Budgets — LPH 9 ignorieren
      if (Array.isArray(proj.lph_budgets) && upsertedProj?.id) {
        for (const lph of proj.lph_budgets as unknown[]) {
          if (!isObject(lph)) continue
          if (typeof lph.lph_number !== 'number' || typeof lph.budget_eur !== 'number') continue
          if (lph.lph_number === 9) continue // LPH 9 wird nicht verwendet

          const { error: lphError } = await supabase
            .from('project_lph_budgets')
            .upsert(
              {
                project_id: upsertedProj.id,
                lph_number: lph.lph_number,
                budget_eur: lph.budget_eur,
                synced_at: new Date().toISOString(),
              },
              { onConflict: 'project_id,lph_number' }
            )

          if (lphError) {
            return { success: false, message: `Fehler bei LPH ${lph.lph_number} in "${proj.project_number}": ${lphError.message}` }
          }
          lphCount++
        }
      }
    }
    log.push(`${projCount} Projekte`, `${lphCount} LPH-Budgets`)
  }

  if (log.length === 0) {
    return { success: false, message: 'Keine gültigen Daten gefunden. Prüfe das Format.' }
  }

  return { success: true, message: `Importiert: ${log.join(', ')}.` }
}

// ── H&I Import ─────────────────────────────────────────────────────────────────
// Format: Array von Tageseinträgen mit employee_name (Klartext) + percentage
// Stunden = percentage/100 × (weekly_capacity_hours / 5)

export async function importHiAllocations(
  data: unknown
): Promise<{ success: boolean; message: string }> {
  if (!Array.isArray(data)) {
    return { success: false, message: 'Datei muss ein JSON-Array enthalten.' }
  }

  const entries = (data as unknown[]).filter((e): e is Record<string, unknown> => {
    if (!isObject(e)) return false
    return (
      typeof e.employee_name === 'string' &&
      typeof e.project_number === 'string' &&
      typeof e.lph_number === 'number' &&
      typeof e.calendar_week === 'number' &&
      typeof e.year === 'number' &&
      typeof e.percentage === 'number'  // percentage ist jetzt Pflichtfeld
    )
  })

  if (entries.length === 0) {
    return {
      success: false,
      message: 'Keine gültigen Einträge gefunden. Pflichtfelder: employee_name, project_number, lph_number, calendar_week, year, percentage.',
    }
  }

  const supabase = await createClient()

  // Mitarbeiter mit Wochenkapazität laden (für Stunden-Berechnung)
  const { data: employees } = await supabase
    .from('employees')
    .select('id, name, weekly_capacity_hours')

  const employeeMap = new Map(
    employees?.map((e) => [e.name.toLowerCase().trim(), e]) ?? []
  )

  const { data: projects } = await supabase
    .from('projects')
    .select('id, project_number')

  const projectMap = new Map(projects?.map((p) => [p.project_number, p.id]) ?? [])

  const { data: lphBudgets } = await supabase
    .from('project_lph_budgets')
    .select('id, project_id, lph_number')

  // Tageseinträge zu KW-Summen aggregieren
  // Stunden = percentage/100 × (weekly_capacity_hours / 5 Tage)
  type AggKey = string
  const aggregated = new Map<AggKey, {
    employeeId: string
    employeeName: string
    projectNumber: string
    lphNumber: number
    calendarWeek: number
    year: number
    totalHours: number
  }>()

  let unresolved = 0

  for (const entry of entries) {
    const name = (entry.employee_name as string).toLowerCase().trim()
    const employee = employeeMap.get(name)

    if (!employee) {
      unresolved++
      continue
    }

    // Stunden aus Prozent + Tageskapazität berechnen
    const hours = calcHoursFromPercentage(
      entry.percentage as number,
      employee.weekly_capacity_hours
    )

    const key: AggKey = `${employee.id}|${entry.project_number}|${entry.lph_number}|${entry.calendar_week}|${entry.year}`
    const existing = aggregated.get(key)

    if (existing) {
      existing.totalHours = Math.round((existing.totalHours + hours) * 10) / 10
    } else {
      aggregated.set(key, {
        employeeId: employee.id,
        employeeName: entry.employee_name as string,
        projectNumber: entry.project_number as string,
        lphNumber: entry.lph_number as number,
        calendarWeek: entry.calendar_week as number,
        year: entry.year as number,
        totalHours: hours,
      })
    }
  }

  let imported = 0
  let skipped = 0

  for (const agg of aggregated.values()) {
    const projectId = projectMap.get(agg.projectNumber)
    if (!projectId) { skipped++; continue }

    const lph = lphBudgets?.find(
      (l) => l.project_id === projectId && l.lph_number === agg.lphNumber
    )
    if (!lph) { skipped++; continue }

    const { error } = await supabase
      .from('allocations')
      .upsert(
        {
          project_id: projectId,
          lph_id: lph.id,
          employee_id: agg.employeeId,
          calendar_week: agg.calendarWeek,
          year: agg.year,
          allocated_hours: agg.totalHours,
          source: 'H&I',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'lph_id,employee_id,calendar_week,year' }
      )

    if (error) {
      return {
        success: false,
        message: `Fehler bei "${agg.employeeName}" KW ${agg.calendarWeek}: ${error.message}`,
      }
    }
    imported++
  }

  const warnings: string[] = []
  if (unresolved > 0) warnings.push(`${unresolved} Einträge ohne Mitarbeiter-Match (zuerst Abacus importieren!)`)
  if (skipped > 0) warnings.push(`${skipped} Projekt/LPH nicht in DB`)

  return {
    success: imported > 0,
    message: `${imported} Zuweisung${imported !== 1 ? 'en' : ''} importiert${warnings.length > 0 ? ' · ' + warnings.join(', ') : ''}.`,
  }
}