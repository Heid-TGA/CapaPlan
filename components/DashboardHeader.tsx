'use client'

import { useState } from 'react'
import {
  UploadCloud,
  Users,
  Settings,
  FolderPlus,
  ChevronDown,
  Pencil,
  FileJson,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import DataImport from './DataImport'
import PlanningRolesModal from './PlanningRolesModal'

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
  const [activeImport, setActiveImport] = useState<ImportType>(null)
  const [showRoles, setShowRoles] = useState(false)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [showManualPlaceholder, setShowManualPlaceholder] = useState(false)

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
                        setShowManualPlaceholder(true)
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

      {/* Platzhalter: manuelle Projektanlage (kommt in Paket 7B) */}
      {showManualPlaceholder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">Projekt manuell anlegen</h2>
              <button
                onClick={() => setShowManualPlaceholder(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500">
                Die manuelle Projektanlage wird in einem Folgepaket (7B) bereitgestellt.
                Bitte nutze bis dahin den <span className="font-medium text-slate-700">Abacus-Import</span>.
              </p>
            </div>
            <div className="px-6 pb-5">
              <button
                onClick={() => setShowManualPlaceholder(false)}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
