'use client'

import { useState } from 'react'
import { LayoutGrid, Users, FolderKanban } from 'lucide-react'
import PortfolioView from './PortfolioView'
import ProjectPlanningView from './ProjectPlanningView'
import EmployeeHeatmapView from './EmployeeHeatmapView'

interface Project {
  id: string
  project_number: string
  name: string
  calc_profile?: string
}

interface Employee {
  id: string
  name: string
  role_type: string
  department: string
  weekly_capacity_hours: number
}

interface Props {
  projects: Project[]
  employees: Employee[]
}

type Tab = 'portfolio' | 'teamkapazitaet' | 'projektplanung'

export default function TlDashboardClient({ projects, employees }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined)

  // Klick auf eine Projektzeile im Portfolio → Projektplanung mit Vorauswahl.
  function handleOpenProject(projectId: string) {
    setSelectedProjectId(projectId)
    setActiveTab('projektplanung')
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; description: string }[] = [
    {
      id: 'portfolio',
      label: 'Portfolio',
      icon: <LayoutGrid className="h-4 w-4" />,
      description: 'Alle Projekte über 12 Wochen',
    },
    {
      id: 'teamkapazitaet',
      label: 'Teamkapazität',
      icon: <Users className="h-4 w-4" />,
      description: 'Projektübergreifende Auslastung',
    },
    {
      id: 'projektplanung',
      label: 'Projektplanung',
      icon: <FolderKanban className="h-4 w-4" />,
      description: 'Stunden je Projekt und Leistungsphase',
    },
  ]

  return (
    <div className="space-y-5">
      {/* ── Tab-Leiste ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 flex gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex-1 flex items-center gap-3 px-4 py-3 rounded-lg text-sm
              transition-all duration-150 text-left
              ${activeTab === tab.id
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }
            `}
          >
            <span className={activeTab === tab.id ? 'text-white' : 'text-slate-400'}>
              {tab.icon}
            </span>
            <div>
              <p className="font-medium leading-tight">{tab.label}</p>
              <p className="text-[11px] leading-tight mt-0.5 text-slate-400">
                {tab.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Tab-Inhalt ── */}
      {activeTab === 'portfolio' && (
        <PortfolioView onOpenProject={handleOpenProject} />
      )}

      {activeTab === 'teamkapazitaet' && (
        <EmployeeHeatmapView />
      )}

      {activeTab === 'projektplanung' && (
        <ProjectPlanningView
          projects={projects}
          employees={employees}
          initialProjectId={selectedProjectId}
        />
      )}
    </div>
  )
}
