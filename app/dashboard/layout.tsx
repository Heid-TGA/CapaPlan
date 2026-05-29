import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/sidebar'
import DashboardHeader from '@/components/DashboardHeader'
import DebugPanel from '@/components/DebugPanel'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('name, role')
    .eq('id', user.id)
    .single()

  const userName = profile?.name ?? user.email ?? '—'
  const userRole = (profile?.role ?? '—') as 'TL' | 'PL' | '—'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar userName={userName} userRole={userRole} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <DashboardHeader userName={userName} userRole={userRole} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1600px] mx-auto p-6">
            {children}
          </div>
        </main>
      </div>

      {/* Debug-Panel — nur für TL sichtbar */}
      {userRole === 'TL' && <DebugPanel />}
    </div>
  )
}