'use server'

// Server Actions: TGA-Budgetbereiche (public.project_budget_areas)
// (Paket 6B / Ergaenzung A3A).
//
// Budgetbereiche sind ein reiner PLANUNGS-/ANGEBOTSLAYER. Diese Actions
// sprechen AUSSCHLIESSLICH public.project_budget_areas an:
//   * KEIN Schreibpfad zu project_lph_budgets / Abacus.
//   * KEINE Verbindung zu allocations / employees / hourly_rate_eur.
//   * Einziger fachlicher Bezug ist project_id.
//
// Sicherheit: normaler Supabase-Server-Client (anon key + Cookies) -> RLS
// greift. Keine Service-Role. TL/PL-Rechte kommen aus den Policies der Tabelle.

import { createClient } from '@/lib/supabase/server'

export interface BudgetArea {
  id: string
  project_id: string
  name: string
  sort_order: number
}

// Default-Bereiche fuer TGA-Projekte (Reihenfolge = sort_order).
// 8C: fachliche Benennung HLKS (AG 1–3) / ELT (AG 4–5) / Sonstige.
const DEFAULT_BUDGET_AREAS = ['HLKS', 'ELT', 'Sonstige'] as const

const SELECT_COLS = 'id, project_id, name, sort_order'

// Alle Budgetbereiche eines Projekts laden (RLS beschraenkt auf erlaubte Projekte).
export async function loadProjectBudgetAreas(
  projectId: string
): Promise<{ success: boolean; data: BudgetArea[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('project_budget_areas')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { success: false, data: [], message: error.message }
  return { success: true, data: (data ?? []) as BudgetArea[], message: 'OK' }
}

// Stellt fuer ein (TGA-)Projekt die drei Standard-Budgetbereiche sicher.
// Idempotent: bereits vorhandene Bereiche werden NICHT ueberschrieben
// (ON CONFLICT DO NOTHING ueber unique(project_id, name)). Der Aufrufer ist
// dafuer verantwortlich, diese Action nur fuer TGA-Projekte zu nutzen.
export async function ensureDefaultBudgetAreas(
  projectId: string
): Promise<{ success: boolean; data: BudgetArea[]; message: string }> {
  if (!projectId) return { success: false, data: [], message: 'Projekt-ID fehlt.' }

  const supabase = await createClient()

  const rows = DEFAULT_BUDGET_AREAS.map((name, i) => ({
    project_id: projectId,
    name,
    sort_order: i,
  }))

  // ignoreDuplicates: true -> ON CONFLICT DO NOTHING. Vorhandene Bereiche
  // (inkl. ihrer sort_order) bleiben unveraendert. RLS entscheidet ueber die
  // Schreibberechtigung; bei fehlender Berechtigung schlaegt das INSERT fehl.
  const { error: upsertError } = await supabase
    .from('project_budget_areas')
    .upsert(rows, { onConflict: 'project_id,name', ignoreDuplicates: true })

  if (upsertError) return { success: false, data: [], message: upsertError.message }

  // Anschliessend den vollstaendigen, aktuellen Stand zurueckgeben.
  return loadProjectBudgetAreas(projectId)
}
