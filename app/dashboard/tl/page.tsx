import { createClient } from '@/lib/supabase/server'
import TlDashboardClient from '@/components/TlDashboardClient'

export default async function TlDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('users')
    .select('name')
    .eq('id', user!.id)
    .single()

  // Alle Projekte laden (TL sieht alle)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, project_number, name')
    .order('project_number')

  // Mitarbeiter laden (TL darf employees_public nutzen)
  const { data: employees } = await supabase
    .from('employees_public')
    .select('id, name, role_type, department, weekly_capacity_hours')
    .order('name')

  const firstName = profile?.name?.split(' ')[0] ?? 'TL'

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-1">
          Teamleiter
        </p>
        <h1 className="text-2xl font-semibold text-slate-800">
          Guten Morgen, {firstName}
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Projekt-Planung und Ressourcenübersicht deines Teams.
        </p>
      </div>

      <TlDashboardClient
        projects={projects ?? []}
        employees={employees ?? []}
      />
    </div>
  )
}
