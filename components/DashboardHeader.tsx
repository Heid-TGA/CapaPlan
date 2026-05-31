'use client'

import { useState } from 'react'
import { UploadCloud, CalendarDays, SlidersHorizontal } from 'lucide-react'
import DataImport from './DataImport'
import PlanningRolesModal from './PlanningRolesModal'

interface DashboardHeaderProps {
  userName: string
  userRole: 'TL' | 'PL' | '—'
}

type ImportType = 'abacus' | 'hi' | null

export default function DashboardHeader({ userName, userRole }: DashboardHeaderProps) {
  const [activeImport, setActiveImport] = useState<ImportType>(null)
  const [showRoles, setShowRoles] = useState(false)

  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  return (
    <>
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-6">
        {/* Links: Datum */}
        <p className="text-sm text-slate-400 hidden sm:block">{today}</p>

        {/* Rechts: Buttons + User */}
        <div className="flex items-center gap-2 ml-auto">

          {/* Import-Buttons — nur für TL */}
          {userRole === 'TL' && (
            <>
              {/* Button 1: Abacus */}
              <button
                onClick={() => setActiveImport('abacus')}
                className="
                  inline-flex items-center gap-2 px-3.5 py-2 rounded-lg
                  text-sm font-medium text-slate-600
                  border border-slate-200 bg-white
                  hover:bg-slate-50 hover:border-slate-300
                  transition-all duration-150 active:scale-[0.98]
                  whitespace-nowrap
                "
              >
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                Abacus-Daten
                <span className="hidden lg:inline text-slate-400 font-normal">
                  (Urlaub, Projekte)
                </span>
              </button>

              {/* Button 2: H&I */}
              <button
                onClick={() => setActiveImport('hi')}
                className="
                  inline-flex items-center gap-2 px-3.5 py-2 rounded-lg
                  text-sm font-medium text-white
                  bg-slate-800
                  hover:bg-slate-700
                  transition-all duration-150 active:scale-[0.98]
                  whitespace-nowrap
                "
              >
                <UploadCloud className="h-3.5 w-3.5" />
                H&amp;I Einsatzplanung
              </button>

              {/* Button 3: Planungsrollen (interne Planungssätze) */}
              <button
                onClick={() => setShowRoles(true)}
                className="
                  inline-flex items-center gap-2 px-3.5 py-2 rounded-lg
                  text-sm font-medium text-slate-600
                  border border-slate-200 bg-white
                  hover:bg-slate-50 hover:border-slate-300
                  transition-all duration-150 active:scale-[0.98]
                  whitespace-nowrap
                "
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                Planungsrollen
              </button>
            </>
          )}

          {/* Divider */}
          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* User-Info */}
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-700 leading-tight">{userName}</p>
            <p className="text-[10px] text-slate-400 leading-tight">{userRole}</p>
          </div>
        </div>
      </header>

      {/* Import-Modal */}
      {activeImport && (
        <DataImport
          initialTab={activeImport}
          onClose={() => setActiveImport(null)}
        />
      )}

      {/* Planungsrollen-Modal — nur für TL erreichbar (Button oben) */}
      {showRoles && (
        <PlanningRolesModal onClose={() => setShowRoles(false)} />
      )}
    </>
  )
}
