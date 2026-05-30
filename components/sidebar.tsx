'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Flame, FolderKanban, ChevronRight } from 'lucide-react'
import LogoutButton from './logout-button'

interface SidebarProps {
  userName: string
  userRole: 'TL' | 'PL' | '—'
}

const NAV_PL = [
  { href: '/dashboard/pl', label: 'Projekte', icon: FolderKanban },
]

const NAV_TL = [
  { href: '/dashboard/tl', label: 'Cockpit', icon: Flame },
  { href: '/dashboard/pl', label: 'Projekte', icon: FolderKanban },
]

export default function Sidebar({ userName, userRole }: SidebarProps) {
  const pathname = usePathname()
  const nav = userRole === 'TL' ? NAV_TL : NAV_PL

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-slate-200 py-5">
      {/* Wordmark */}
      <div className="px-5 mb-8">
        <p className="text-[9px] tracking-[0.25em] uppercase text-slate-400 mb-0.5">
          Planungsbüro
        </p>
        <p className="text-[15px] font-semibold text-slate-800 tracking-tight">
          Kapazität<span className="text-slate-400 font-normal">svorschau</span>
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        <p className="text-[9px] tracking-[0.2em] uppercase text-slate-400 px-2 mb-2">
          Navigation
        </p>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150
                ${active
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                }
              `}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="h-3 w-3 text-slate-400" />}
            </Link>
          )
        })}
      </nav>

      {/* User Footer */}
      <div className="px-3 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="h-7 w-7 rounded-lg bg-slate-200 flex items-center justify-center text-[10px] font-semibold text-slate-600 shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">{userName}</p>
            <p className="text-[10px] text-slate-400">{userRole}</p>
          </div>
        </div>
        <LogoutButton />
      </div>
    </aside>
  )
}
