'use server'

import { createClient } from '@/lib/supabase/server'
import { isCalcProfile } from '@/lib/calc-profile'

// Paket 7B — Manuelle Projektanlage durch TL.
//
// - Nutzt den NORMALEN Supabase Server Client -> RLS greift (keine Service Role).
//   INSERT auf public.projects ist per Policy proj_tl_insert nur fuer TL erlaubt;
//   ein PL-Versuch wird von RLS blockiert.
// - Beruehrt AUSSCHLIESSLICH public.projects (project_number, name, pl_id,
//   calc_profile). KEINE LPH-Budgets, KEINE Allocations, KEIN Import.
// - Keine Mitarbeiteranlage, keine Rollenverteilung, keine HOAI-Logik.

/**
 * Laedt moegliche Projektleiter fuer das Auswahlfeld.
 *
 * Gibt ALLE Nutzer (PL und TL) zurueck, PL zuerst. Begruendung, warum auch TL
 * waehlbar ist:
 *   - projects.pl_id ist nur ein FK auf users(id); jede gueltige User-ID ist zulaessig.
 *   - Der bestehende Abacus-Import setzt pl_id auf den aktuellen TL, wenn kein
 *     PL-Name matcht -> TL-als-PL ist bereits ein unterstuetzter Zustand.
 *   - Verhindert ein unbenutzbares, leeres Auswahlfeld, solange noch kein PL
 *     angelegt ist.
 * RLS: users_select_tl erlaubt dem TL das Lesen aller users-Zeilen.
 */
export async function loadProjectLeads(): Promise<{
  success: boolean
  data: { id: string; name: string; role: string }[]
  message?: string
}> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, name, role')
    .order('role', { ascending: true }) // 'PL' vor 'TL'
    .order('name', { ascending: true })

  if (error) {
    return { success: false, data: [], message: error.message }
  }

  return { success: true, data: data ?? [] }
}

/**
 * Legt manuell ein Projekt in public.projects an (nur TL).
 *
 * Validierung:
 *   - Projektnummer nicht leer
 *   - Projektname nicht leer
 *   - PL angegeben und in public.users vorhanden
 *   - Projektnummer noch nicht vergeben (Vorpruefung + Unique-Constraint-Fallback)
 *   - calc_profile optional; default 'frei', muss gueltig sein
 */
export async function createManualProject(payload: {
  projectNumber: string
  name: string
  plId: string
  calcProfile?: string
}): Promise<{
  success: boolean
  message: string
  project?: { id: string; project_number: string; name: string; calc_profile: string }
}> {
  const projectNumber = (payload?.projectNumber ?? '').trim()
  const name = (payload?.name ?? '').trim()
  const plId = (payload?.plId ?? '').trim()
  const calcProfile = payload?.calcProfile ?? 'frei'

  if (!projectNumber) {
    return { success: false, message: 'Bitte eine Projektnummer angeben.' }
  }
  if (!name) {
    return { success: false, message: 'Bitte einen Projektnamen angeben.' }
  }
  if (!plId) {
    return { success: false, message: 'Bitte einen Projektleiter auswählen.' }
  }
  if (!isCalcProfile(calcProfile)) {
    return { success: false, message: 'Ungültiges Kalkulationsprofil.' }
  }

  const supabase = await createClient()

  // PL muss existieren (RLS: TL darf alle users lesen).
  const { data: lead, error: leadError } = await supabase
    .from('users')
    .select('id')
    .eq('id', plId)
    .maybeSingle()

  if (leadError) {
    return { success: false, message: leadError.message }
  }
  if (!lead) {
    return { success: false, message: 'Der gewählte Projektleiter existiert nicht.' }
  }

  // Doppelte Projektnummer freundlich abfangen (Vorpruefung).
  const { data: existing, error: existingError } = await supabase
    .from('projects')
    .select('id')
    .eq('project_number', projectNumber)
    .maybeSingle()

  if (existingError) {
    return { success: false, message: existingError.message }
  }
  if (existing) {
    return { success: false, message: `Projektnummer „${projectNumber}" ist bereits vergeben.` }
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      project_number: projectNumber,
      name,
      pl_id: plId,
      calc_profile: calcProfile,
    })
    .select('id, project_number, name, calc_profile')
    .single()

  if (error) {
    // 23505 = unique_violation: Race zwischen Vorpruefung und Insert.
    if (error.code === '23505') {
      return { success: false, message: `Projektnummer „${projectNumber}" ist bereits vergeben.` }
    }
    // Leere Zeile / Policy-Block -> RLS verbietet INSERT (kein TL).
    return {
      success: false,
      message: error.message || 'Projekt konnte nicht angelegt werden (fehlende Berechtigung?).',
    }
  }

  if (!data) {
    return {
      success: false,
      message: 'Projekt konnte nicht angelegt werden (keine Berechtigung oder unbekannter Fehler).',
    }
  }

  return {
    success: true,
    message: `Projekt „${data.project_number} – ${data.name}" wurde angelegt.`,
    project: data,
  }
}
