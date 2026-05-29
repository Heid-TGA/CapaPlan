import { createClient } from '@/lib/supabase/server'
import ProjectPlanningView from '@/components/ProjectPlanningView'

export default async function PlDashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('users')
    .select('name')
    .eq('id', user!.id)
    .single()

  // Projekte dieses PL laden
  const { data: projects } = await supabase
    .from('projects')
    .select('id, project_number, name')
    .eq('pl_id', user!.id)
    .order('project_number')

  // Mitarbeiter laden (ohne Stundensatz — employees_public View)
  const { data: employees } = await supabase
    .from('employees_public')
    .select('id, name, role_type, department, weekly_capacity_hours')
    .order('name')

  const firstName = profile?.name?.split(' ')[0] ?? 'PL'

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <p className="text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-1">
          Projektleiter
        </p>
        <h1 className="text-2xl font-semibold text-slate-800">
          Guten Morgen, {firstName}
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Weise deinen Projekten Stunden zu und verfolge das Budget live.
        </p>
      </div>

      <ProjectPlanningView
        projects={projects ?? []}
        employees={employees ?? []}
      />
    </div>
  )
}
