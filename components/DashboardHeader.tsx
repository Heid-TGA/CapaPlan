'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  UploadCloud,
  Users,
  Settings,
  FolderPlus,
  ChevronDown,
  Pencil,
  FileJson,
  SlidersHorizontal,
  ListChecks,
} from 'lucide-react'
import DataImport from './DataImport'
import PlanningRolesModal from './PlanningRolesModal'
import ManualProjectModal from './ManualProjectModal'
import RolePlanDefaultsModal from './RolePlanDefaultsModal'

interface DashboardHeaderProps {
  userName: string
  userRole: 'TL' | 'PL' | '—'
}

type ImportType = 'abacus' | 'hi' | null
type OpenMenu = 'projekt' | 'einstellungen' | null

const btnSecondary = `
  inline-flex items-center gap-2 px-3.5 py-2 rounded-lg
  text-sm font-medium text-slate-600
  border border-slate-200 bg-white
  hover:bg-slate-50 hover:border-slate-300
  transition-all duration-150 active:scale-[0.98]
  whitespace-nowrap
`

export default function DashboardHeader({ userName, userRole }: DashboardHeaderProps) {
  const router = useRouter()
  const [activeImport, setActiveImport] = useState<ImportType>(null)
  const [showRoles, setShowRoles] = useState(false)
  const [showDefaults, setShowDefaults] = useState(false)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [showManual, setShowManual] = useState(false)

  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  const closeMenu = () => setOpenMenu(null)

  return (
    <>
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-6">
        {/* Links: Datum */}
        <p className="text-sm text-slate-400 hidden sm:block">{today}</p>

        {/* Rechts: Buttons + User */}
        <div className="flex items-center gap-2 ml-auto">

          {/* Aktions-Buttons — nur für TL */}
          {userRole === 'TL' && (
            <>
              {/* Button 1: Projekt einfügen (Dropdown) */}
              <div className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === 'projekt' ? null : 'projekt')}
                  className={btnSecondary}
                >
                  <FolderPlus className="h-3.5 w-3.5 text-slate-400" />
                  Projekt einfügen
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </button>

                {openMenu === 'projekt' && (
                  <div className="absolute right-0 mt-1.5 w-56 z-50 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                    <button
                      onClick={() => {
                        closeMenu()
                        setShowManual(true)
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5 text-slate-400" />
                      Manuell
                    </button>
                    <button
                      onClick={() => {
                        closeMenu()
                        setActiveImport('abacus')
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <FileJson className="h-3.5 w-3.5 text-slate-400" />
                      Abacus-Import
                    </button>
                  </div>
                )}
              </div>

              {/* Button 2: Mitarbeiterdaten */}
              <button
                onClick={() => setActiveImport('abacus')}
                className={btnSecondary}
              >
                <Users className="h-3.5 w-3.5 text-slate-400" />
                Mitarbeiterdaten
              </button>

              {/* Button 3: H&I Einsatzplanung */}
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

              {/* Button 4: Einstellungen (Dropdown) */}
              <div className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === 'einstellungen' ? null : 'einstellungen')}
                  className={btnSecondary}
                >
                  <Settings className="h-3.5 w-3.5 text-slate-400" />
                  Einstellungen
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </button>

                {openMenu === 'einstellungen' && (
                  <div className="absolute right-0 mt-1.5 w-56 z-50 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                    <button
                      onClick={() => {
                        closeMenu()
                        setShowRoles(true)
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                      Mitarbeiterrollen
                    </button>
                    <button
                      onClick={() => {
                        closeMenu()
                        setShowDefaults(true)
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <ListChecks className="h-3.5 w-3.5 text-slate-400" />
                      Default-Rollenverteilung
                    </button>
                  </div>
                )}
              </div>
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

      {/* Klick-außerhalb schließt offene Dropdowns */}
      {openMenu && (
        <div className="fixed inset-0 z-40" onClick={closeMenu} />
      )}

      {/* Import-Modal (Abacus / H&I) */}
      {activeImport && (
        <DataImport
          initialTab={activeImport}
          onClose={() => setActiveImport(null)}
        />
      )}

      {/* Planungsrollen-Verwaltung (UI: „Mitarbeiterrollen") */}
      {showRoles && (
        <PlanningRolesModal onClose={() => setShowRoles(false)} />
      )}

      {/* Default-Rollenverteilung (Paket 7C) */}
      {showDefaults && (
        <RolePlanDefaultsModal onClose={() => setShowDefaults(false)} />
      )}

      {/* Manuelle Projektanlage (Paket 7B) */}
      {showManual && (
        <ManualProjectModal
          onClose={() => setShowManual(false)}
          onCreated={() => router.refresh()}
        />
      )}
    </>
  )
}
