'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export default function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="
        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
        text-slate-400 hover:text-red-500 hover:bg-red-50
        transition-all duration-150
      "
    >
      <LogOut className="h-4 w-4 shrink-0" />
      Abmelden
    </button>
  )
}
