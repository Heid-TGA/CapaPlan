'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Gibt den Budget-Status einer LPH zurück (LEGACY: lookup über project_id + lph_number).
 * hourly_rate_eur wird NIEMALS ans Frontend übergeben.
 *
 * Hinweis (Paket 8D): Sobald ein Projekt LPH getrennt nach Budgetbereichen
 * (HLKS/ELT) führt, ist (project_id, lph_number) mehrdeutig. Für eine konkrete
 * LPH-Zeile daher bevorzugt getLphBudgetStatusById(lphId) nutzen. Diese Variante
 * bleibt für reine area_id = NULL-Projekte korrekt.
 */
export async function getLphBudgetStatus(
  projectId: string,
  lphNumber: number
) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_lph_budget_status', {
    p_project_id: projectId,
    p_lph_number: lphNumber,
  })
  if (error) throw new Error(error.message)
  return data[0] as {
    lph_number: number
    budget_eur: number
    allocated_eur: number
    remaining_eur: number
    utilization_pct: number
    total_hours: number
  }
}

/**
 * Gibt den Budget-Status einer LPH-Zeile EINDEUTIG über ihre id zurück
 * (project_lph_budgets.id). Verträgt mehrere Bereichszeilen (HLKS/ELT) je
 * (project_id, lph_number) und ist daher der bevorzugte Lookup ab Paket 8D.
 *
 * Nutzt die additive RPC get_lph_budget_status_by_id (Patch 8C). Solange der
 * SQL-Patch nicht ausgeführt ist, fehlt diese RPC in der DB und der Aufruf
 * wirft zur Laufzeit — der Build ist davon nicht betroffen.
 * hourly_rate_eur wird NIEMALS ans Frontend übergeben.
 */
export async function getLphBudgetStatusById(lphId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_lph_budget_status_by_id', {
    p_lph_id: lphId,
  })
  if (error) throw new Error(error.message)
  return data[0] as {
    lph_number: number
    budget_eur: number
    allocated_eur: number
    remaining_eur: number
    utilization_pct: number
    total_hours: number
  } | undefined
}

/**
 * Weist einem Mitarbeiter Stunden zu und gibt das neue Budget-Delta zurück.
 * Der Stundensatz wird ausschließlich serverseitig (SECURITY DEFINER RPC) verrechnet.
 */
export async function upsertAllocation(
  projectId: string,
  lphId: string,
  employeeId: string,
  calendarWeek: number,
  year: number,
  hours: number,
  source: 'H&I' | 'Manuell_PL' = 'Manuell_PL'
) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    'upsert_allocation_and_get_delta',
    {
      p_project_id: projectId,
      p_lph_id: lphId,
      p_employee_id: employeeId,
      p_calendar_week: calendarWeek,
      p_year: year,
      p_hours: hours,
      p_source: source,
    }
  )
  if (error) throw new Error(error.message)
  // Rückgabe enthält KEIN hourly_rate_eur
  return data[0] as {
    remaining_eur: number
    delta_eur: number
    utilization_pct: number
  }
}
