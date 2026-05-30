'use server'

import { createClient } from '@/lib/supabase/server'
import { isCalcProfile, type CalcProfile } from '@/lib/calc-profile'

/**
 * Setzt das Kalkulationsprofil eines Projekts (Paket 6B / Ergaenzung A1).
 *
 * - Nutzt den NORMALEN Supabase Server Client -> RLS greift (keine Service Role).
 * - Aktualisiert AUSSCHLIESSLICH die Spalte projects.calc_profile,
 *   keine weiteren Projektfelder.
 * - Beruehrt KEINE Budgets, Allocations, Meilensteine oder Gewerke.
 *
 * Hinweis zu RLS: Aktuell darf nur ein TL projects updaten. Ein PL-Versuch
 * wird von RLS blockiert und aktualisiert 0 Zeilen -> wir geben das ueber
 * .select() ehrlich als Fehler zurueck, statt scheinbaren Erfolg zu melden.
 */
export async function updateProjectCalcProfile(
  projectId: string,
  calcProfile: CalcProfile
): Promise<{ success: boolean; message: string }> {
  if (!projectId) {
    return { success: false, message: 'Projekt-ID fehlt.' }
  }
  if (!isCalcProfile(calcProfile)) {
    return { success: false, message: 'Ungueltiges Kalkulationsprofil.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('projects')
    .update({ calc_profile: calcProfile })
    .eq('id', projectId)
    .select('id')

  if (error) {
    return { success: false, message: error.message }
  }
  if (!data || data.length === 0) {
    return {
      success: false,
      message: 'Profil konnte nicht gespeichert werden (keine Berechtigung oder Projekt nicht gefunden).',
    }
  }

  return { success: true, message: 'Kalkulationsprofil gespeichert.' }
}
