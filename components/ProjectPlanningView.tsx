'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { TrendingDown, Users, Clock, Euro, CalendarDays, Flag, Circle, ChevronRight } from 'lucide-react'
import { upsertAllocation, getLphBudgetStatus } from '@/app/actions/allocation'
import { loadProjectAllocations } from '@/app/actions/heatmap'
import { loadTerminplan, saveLphSchedule, type LphSchedule, type Milestone } from '@/app/actions/terminplan'
import GanttBar from './GanttBar'

// ── Konstanten ─────────────────────────────────────────────────────────────────

const PLANNING_PHASES = [
  { key: 'basic',       label: 'Basic Design',  lph: [1, 2, 3, 4], color: 'bg-violet-500', light: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700' },
  { key: 'detail',      label: 'Detail Design', lph: [5, 6, 7],    color: 'bg-blue-500',   light: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700' },
  { key: 'ausfuehrung', label: 'Ausführung',    lph: [8],          color: 'bg-emerald-500',light: 'bg-emerald-50',border: 'border-emerald-200',text: 'text-emerald-700' },
] as const
type PhaseKey = typeof PLANNING_PHASES[number]['key']

const COL_WIDTH = 52   // px — einheitliche Spaltenbreite für Gantt + Matrix
const EMP_COL   = 200  // px — Mitarbeiterspalte
const CAP_COL   = 56   // px — Kapazitätsspalte
const H_I_WEEKS = 2    // Erste N KWs = H&I-Zone

// ── Typen ──────────────────────────────────────────────────────────────────────

interface Project { id: string; project_number: string; name: string }
interface Employee { id: string; name: string; role_type: string; department: string; weekly_capacity_hours: number }
interface Allocation { hours: number; source: 'H&I' | 'Manuell_PL' }
type AllocMap = Record<string, Record<number, Allocation>>
interface LphBudget { lph_number: number; budget_eur: number; allocated_eur: number; remaining_eur: number; utilization_pct: number; total_hours: number }
interface Props { projects: Project[]; employees: Employee[]; initialProjectId?: string }

const DUMMY_EMPLOYEES: Employee[] = [
  { id: 'dummy-zeichner-arch', name: 'N.N. Zeichner Architektur', role_type: 'Zeichner',     department: 'Architektur', weekly_capacity_hours: 40 },
  { id: 'dummy-ing-statik',    name: 'N.N. Ingenieur Statik',     role_type: 'Ingenieur',    department: 'Statik',      weekly_capacity_hours: 40 },
  { id: 'dummy-ing-tga',       name: 'N.N. Ingenieur TGA',        role_type: 'Ingenieur',    department: 'TGA',         weekly_capacity_hours: 40 },
  { id: 'dummy-pl',            name: 'N.N. Projektleiter',        role_type: 'Projektleiter',department: 'Architektur', weekly_capacity_hours: 40 },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCurrentWeek(): number {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+4-(d.getDay()||7))
  return Math.ceil(((d.getTime()-new Date(d.getFullYear(),0,1).getTime())/86400000+1)/7)
}
function fmtEur(n: number) {
  return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n)
}

// ── Haupt-Komponente ───────────────────────────────────────────────────────────

export default function ProjectPlanningView({ projects, employees, initialProjectId }: Props) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(
    projects.find(p => p.id === initialProjectId) ?? projects[0] ?? null
  )
  const [selectedPhase, setSelectedPhase] = useState<PhaseKey>('detail')
  const [phaseBudgets, setPhaseBudgets] = useState<Record<PhaseKey, LphBudget[]>>({ basic: [], detail: [], ausfuehrung: [] })
  const [allocations, setAllocations] = useState<AllocMap>({})
  const [editCell, setEditCell] = useState<{ empId: string; lphId: string; kw: number } | null>(null)
  const [showDummies, setShowDummies] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [schedules, setSchedules] = useState<LphSchedule[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const currentWeek = getCurrentWeek()
  const currentYear = new Date().getFullYear()
  const weeks = Array.from({ length: 12 }, (_, i) => ((currentWeek - 1 + i) % 52) + 1)
  const allEmployees = [...employees, ...(showDummies ? DUMMY_EMPLOYEES : [])]
  const departments = [...new Set(allEmployees.map(e => e.department))]
  const phase = PLANNING_PHASES.find(p => p.key === selectedPhase)!

  useEffect(() => {
    const initial = projects.find(p => p.id === initialProjectId) ?? projects[0]
    if (initial) handleProjectSelect(initial)
  }, [initialProjectId]) // eslint-disable-line

  async function loadAll(project: Project) {
    await Promise.all([loadPhaseBudgets(project), loadAllocations(project), loadScheduleData(project)])
  }

  async function loadScheduleData(project: Project) {
    try {
      const { schedules: s, milestones: m } = await loadTerminplan(project.id)
      setSchedules(s); setMilestones(m)
    } catch(e) { console.error(e) }
  }

  async function loadPhaseBudgets(project: Project) {
    const updated: Record<PhaseKey, LphBudget[]> = { basic: [], detail: [], ausfuehrung: [] }
    for (const ph of PLANNING_PHASES) {
      const budgets: LphBudget[] = []
      for (const n of ph.lph) { try { const b = await getLphBudgetStatus(project.id, n); if (b) budgets.push(b) } catch {} }
      updated[ph.key] = budgets
    }
    setPhaseBudgets(updated)
  }

  async function loadAllocations(project: Project) {
    try {
      const data = await loadProjectAllocations(project.id, currentYear, weeks)
      const map: AllocMap = {}
      for (const a of data) {
        const lphId = `${project.id}_lph${a.lph_number}`
        const key = `${a.employee_id}_${lphId}`
        if (!map[key]) map[key] = {}
        map[key][a.calendar_week] = { hours: a.allocated_hours, source: a.source as 'H&I' | 'Manuell_PL' }
      }
      setAllocations(map)
    } catch(e) { console.error(e) }
  }

  async function handleProjectSelect(project: Project) {
    setSelectedProject(project); setAllocations({}); setPhaseBudgets({ basic: [], detail: [], ausfuehrung: [] }); setSchedules([]); setMilestones([])
    await loadAll(project)
  }

  // Terminplan-Helpers
  function getPhaseRange(ph: typeof PLANNING_PHASES[number]): { start: number | null; end: number | null } {
    const sched = schedules.filter(s => ph.lph.includes(s.lph_number as never))
    const starts = sched.map(s => s.start_kw).filter(Boolean) as number[]
    const ends = sched.map(s => s.end_kw).filter(Boolean) as number[]
    return { start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null }
  }

  function isInPhaseRange(kw: number): boolean {
    const { start, end } = getPhaseRange(phase)
    return !!(start && end && kw >= start && kw <= end)
  }

  function getMilestonesForKw(kw: number): Milestone[] {
    return milestones.filter(m => m.kw === kw && phase.lph.includes(m.lph_number as never))
  }

  // Alloc-Helpers
  function allocKey(empId: string, lphId: string) { return `${empId}_${lphId}` }
  function getHours(empId: string, lphId: string, kw: number) { return allocations[allocKey(empId, lphId)]?.[kw]?.hours ?? 0 }
  function getSource(empId: string, lphId: string, kw: number) { return allocations[allocKey(empId, lphId)]?.[kw]?.source }
  function getEmpPhaseTotal(empId: string) { return phase.lph.reduce((sum, n) => sum + weeks.reduce((s, kw) => s + getHours(empId, `${selectedProject?.id}_lph${n}`, kw), 0), 0) }
  function getKwPhaseTotal(kw: number) { return allEmployees.reduce((sum, emp) => sum + phase.lph.reduce((s, n) => s + getHours(emp.id, `${selectedProject?.id}_lph${n}`, kw), 0), 0) }

  const phaseData = phaseBudgets[selectedPhase]
  const totalBudget = phaseData.reduce((s, b) => s + b.budget_eur, 0)
  const totalAllocated = phaseData.reduce((s, b) => s + b.allocated_eur, 0)
  const totalHours = phaseData.reduce((s, b) => s + b.total_hours, 0)
  const utilizationPct = totalBudget > 0 ? Math.min(100, Math.round(totalAllocated / totalBudget * 100)) : 0
  const progressColor = utilizationPct > 85 ? 'bg-red-400' : utilizationPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'

  function commitEdit(empId: string, lphId: string, kw: number, value: string) {
    const hours = Math.max(0, Math.min(60, parseFloat(value) || 0))
    setAllocations(prev => ({ ...prev, [allocKey(empId, lphId)]: { ...prev[allocKey(empId, lphId)], [kw]: { hours, source: 'Manuell_PL' } } }))
    setEditCell(null)
    if (empId.startsWith('dummy-') || !selectedProject) return
    const lphNum = parseInt(lphId.split('lph')[1])
    startTransition(async () => {
      try {
        const result = await upsertAllocation(selectedProject.id, lphId, empId, kw, currentYear, hours)
        if (result) {
          setPhaseBudgets(prev => {
            const updated = { ...prev }
            const ph = PLANNING_PHASES.find(p => p.lph.includes(lphNum as never))
            if (!ph) return prev
            updated[ph.key] = prev[ph.key].map(b => b.lph_number === lphNum ? { ...b, remaining_eur: result.remaining_eur, utilization_pct: result.utilization_pct } : b)
            return updated
          })
        }
      } catch(e) { console.error(e) }
    })
  }

  if (projects.length === 0) return (
    <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
      <p className="text-slate-400 text-sm">Keine Projekte gefunden.</p>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">

        {/* ── Projekt-Auswahl ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {projects.map(p => (
            <button key={p.id} onClick={() => handleProjectSelect(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${selectedProject?.id === p.id ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
              <span className="text-xs opacity-60 mr-1.5">{p.project_number}</span>{p.name}
            </button>
          ))}
        </div>

        {/* ── Planungsschritte ── */}
        <div className="grid grid-cols-3 gap-3">
          {PLANNING_PHASES.map(ph => {
            const phData = phaseBudgets[ph.key]
            const phBudget = phData.reduce((s, b) => s + b.budget_eur, 0)
            const phAllocated = phData.reduce((s, b) => s + b.allocated_eur, 0)
            const phPct = phBudget > 0 ? Math.min(100, Math.round(phAllocated / phBudget * 100)) : 0
            const isActive = selectedPhase === ph.key
            const barColor = phPct > 85 ? 'bg-red-400' : phPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'
            const { start, end } = getPhaseRange(ph)
            return (
              <button key={ph.key} onClick={() => setSelectedPhase(ph.key)}
                className={`text-left p-4 rounded-xl border transition-all ${isActive ? 'bg-slate-800 border-slate-800' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className={`h-2 w-2 rounded-full ${ph.color}`} />
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-slate-400">{ph.lph.map(l => `LPH ${l}`).join('·')}</p>
                </div>
                <p className={`text-sm font-semibold mb-1 ${isActive ? 'text-white' : 'text-slate-800'}`}>{ph.label}</p>
                {start && end && <p className="text-[10px] text-slate-400 flex items-center gap-1 mb-1.5"><CalendarDays className="h-2.5 w-2.5" />KW {start}–{end}</p>}
                {phBudget > 0 ? (
                  <>
                    <div className={`h-1 rounded-full mb-1 ${isActive ? 'bg-slate-600' : 'bg-slate-100'}`}>
                      <div className={`h-full rounded-full ${isActive ? 'bg-white' : barColor}`} style={{ width: `${phPct}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-400">{fmtEur(phBudget-phAllocated)} · {phPct}%</p>
                  </>
                ) : <p className="text-[10px] text-slate-400">Kein Budget</p>}
              </button>
            )
          })}
        </div>

        {/* ── Budget-Karten ── */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-2"><Euro className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Budget verbleibend</p></div>
            {totalBudget > 0 ? (
              <>
                <p className="text-xl font-semibold text-slate-800">{fmtEur(totalBudget-totalAllocated)}</p>
                <p className="text-xs text-slate-400 mt-0.5">{fmtEur(totalAllocated)} von {fmtEur(totalBudget)}</p>
                <div className="mt-2.5 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${progressColor}`} style={{ width: `${utilizationPct}%` }} /></div>
                <p className="text-[10px] text-slate-400 mt-1">{utilizationPct}% ausgeschöpft</p>
              </>
            ) : <p className="text-slate-300 text-sm mt-1">Projekt wählen</p>}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-2"><Clock className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Verplante Stunden</p></div>
            <p className="text-xl font-semibold text-slate-800">{totalHours > 0 ? `${Math.round(totalHours)} h` : '— h'}</p>
            <p className="text-xs text-slate-400 mt-0.5">{phase.label}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-2"><Users className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Team</p></div>
            <p className="text-xl font-semibold text-slate-800">{employees.length}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-slate-400">+ {DUMMY_EMPLOYEES.length} N.N.</p>
              <button onClick={() => setShowDummies(v => !v)} className="text-[10px] text-slate-400 hover:text-slate-600 underline underline-offset-2">{showDummies ? 'ausbl.' : 'einbl.'}</button>
            </div>
          </div>
        </div>

        {/* ── INTEGRIERTE ANSICHT: Gantt + Matrix ── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

          {/* Matrix-Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div>
              <p className="text-sm font-semibold text-slate-700">Terminplan & Ressourcen</p>
              <p className="text-xs text-slate-400">{phase.label} · LPH {phase.lph.join(' · ')}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {isPending && <span className="text-amber-500 animate-pulse">Speichern…</span>}
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium">H&I-Zone (KW 1–{H_I_WEEKS})</span>
              <span className="flex items-center gap-1"><Flag className="h-3 w-3 text-red-500 fill-red-500" />Extern</span>
              <span className="flex items-center gap-1"><Circle className="h-3 w-3 text-blue-500 fill-blue-500" />Intern</span>
            </div>
          </div>

          <div className="overflow-x-auto" ref={scrollRef}>
            {/* ── GANTT-LEISTE (synchron mit Matrix) ── */}
            <div style={{ minWidth: `${EMP_COL + CAP_COL + weeks.length * COL_WIDTH}px` }}>

              {/* Gantt-Zeilen — eine Zeile pro LPH */}
              {PLANNING_PHASES.map(ph => {
                const phSchedRows = schedules.filter(s => ph.lph.includes(s.lph_number as never))
                const isSelected = selectedPhase === ph.key
                if (phSchedRows.length === 0) return null
                return (
                  <div key={ph.key} className={`border-b ${isSelected ? 'bg-slate-50' : ''}`}>
                    {/* Phase-Header */}
                    <div className="flex cursor-pointer" onClick={() => setSelectedPhase(ph.key)}>
                      <div style={{ width: EMP_COL, minWidth: EMP_COL }}
                        className="px-5 py-1.5 flex items-center gap-2 border-r border-slate-100">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${ph.color}`} />
                        <p className="text-xs font-semibold text-slate-700">{ph.label}</p>
                        {isSelected && <ChevronRight className="h-3 w-3 text-slate-400 ml-auto" />}
                      </div>
                      <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="border-r border-slate-100" />
                      <div className="flex-1" />
                    </div>
                    {/* LPH-Balken — eine Zeile pro LPH */}
                    {phSchedRows.map(s => (
                      <div key={s.lph_id} className="flex items-center">
                        <div style={{ width: EMP_COL, minWidth: EMP_COL }}
                          className="px-5 pl-9 border-r border-slate-100 flex items-center">
                          <span className="text-[10px] text-slate-400">LPH {s.lph_number}</span>
                        </div>
                        <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="border-r border-slate-100" />
                        <div className="flex-1 relative">
                          <div className="absolute inset-0 flex pointer-events-none">
                            {weeks.map((_, i) => (
                              <div key={i} style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                                className={i < H_I_WEEKS ? 'bg-blue-50/40' : ''} />
                            ))}
                          </div>
                          <GanttBar
                            lphId={s.lph_id}
                            lphNumber={s.lph_number}
                            weeks={weeks}
                            colWidth={COL_WIDTH}
                            startKw={s.start_kw}
                            endKw={s.end_kw}
                            milestones={milestones.filter(m => m.lph_id === s.lph_id)}
                            color={ph.color}
                            onChange={(id, start, end) => {
                              setSchedules(prev => prev.map(sc =>
                                sc.lph_id === id ? { ...sc, start_kw: start, end_kw: end } : sc
                              ))
                              setSelectedPhase(ph.key)
                            }}
                            
                            onSave={(id, start, end) => saveLphSchedule(id, start, end, currentYear)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}

              {/* ── KW-HEADER ── */}
              <div className="flex bg-slate-50 border-b border-slate-200">
                <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-2 text-xs font-medium text-slate-500 border-r border-slate-100">Mitarbeiter</div>
                <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="py-2 text-xs font-medium text-slate-400 text-center border-r border-slate-100">Kap/Wo</div>
                {weeks.map((kw, i) => {
                  const inRange = isInPhaseRange(kw)
                  const kwMs = getMilestonesForKw(kw)
                  const isHI = i < H_I_WEEKS
                  return (
                    <div key={kw}
                      style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                      className={`py-1 text-center border-r border-slate-100 ${isHI ? 'bg-blue-50' : inRange ? 'bg-amber-50' : ''}`}>
                      {/* H&I Label über den ersten 2 KWs */}
                      {i === 0 && (
                        <div className="absolute -mt-0.5 left-0" style={{ width: COL_WIDTH * H_I_WEEKS }}>
                          {/* rendered by the badge in header, handled via coloring */}
                        </div>
                      )}
                      {kwMs.length > 0 && (
                        <div className="flex gap-0.5 justify-center mb-0.5">
                          {kwMs.map(m => (
                            <div key={m.id} title={m.description} className="cursor-help">
                              {m.type === 'external' ? <Flag className="h-2.5 w-2.5 text-red-500 fill-red-500" /> : <Circle className="h-2.5 w-2.5 text-blue-500 fill-blue-500" />}
                            </div>
                          ))}
                        </div>
                      )}
                      <span className={`text-[10px] font-medium ${kw === currentWeek ? 'text-blue-600 font-bold' : 'text-slate-500'}`}>
                        {kw === currentWeek ? '▸' : ''}KW {kw}
                      </span>
                      {isHI && <div className="text-[8px] text-blue-500 leading-none">H&I</div>}
                    </div>
                  )
                })}
              </div>

              {/* ── MITARBEITER-ZEILEN ── */}
              {departments.map(dept => {
                const deptEmps = allEmployees.filter(e => e.department === dept)
                return [
                  <div key={`dept-${dept}`} style={{ display: 'flex' }}>
                    <div style={{ width: EMP_COL + CAP_COL + weeks.length * COL_WIDTH }}
                      className="px-5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                      {dept}
                    </div>
                  </div>,
                  ...deptEmps.map(emp => {
                    const isDummy = emp.id.startsWith('dummy-')
                    const empPhaseTotal = getEmpPhaseTotal(emp.id)
                    return (
                      <div key={emp.id} className="flex border-b border-slate-100 hover:bg-slate-50/30 transition-colors">
                        {/* Name */}
                        <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-2 border-r border-slate-100 flex flex-col justify-center">
                          <p className={`text-sm font-medium ${isDummy ? 'text-slate-400 italic' : 'text-slate-700'}`}>{emp.name}</p>
                          <p className="text-[10px] text-slate-400">{emp.role_type} · {emp.weekly_capacity_hours}h/Wo</p>
                        </div>
                        {/* Kapazität */}
                        <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="text-center text-xs text-slate-400 font-mono border-r border-slate-100 flex items-center justify-center">{emp.weekly_capacity_hours}h</div>
                        {/* KW-Zellen */}
                        {weeks.map((kw, i) => {
                          const phaseHoursKw = phase.lph.reduce((s, n) => s + getHours(emp.id, `${selectedProject?.id}_lph${n}`, kw), 0)
                          const primaryLphId = `${selectedProject?.id}_lph${phase.lph[0]}`
                          const src = getSource(emp.id, primaryLphId, kw)
                          const isEditing = editCell?.empId === emp.id && editCell?.kw === kw
                          const inRange = isInPhaseRange(kw)
                          const isHI = i < H_I_WEEKS
                          const loadPct = emp.weekly_capacity_hours > 0 ? phaseHoursKw / emp.weekly_capacity_hours * 100 : 0
                          const cellBg = phaseHoursKw === 0 ? '' : isDummy ? 'bg-slate-100 text-slate-500' : loadPct > 100 ? 'bg-red-50 text-red-600' : src === 'H&I' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-50 text-emerald-700'

                          return (
                            <div key={kw}
                              style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                              className={`flex items-center justify-center border-r border-slate-50 py-1.5 ${isHI ? 'bg-blue-50/40' : inRange ? 'bg-amber-50/50' : ''}`}
                              onClick={() => !isEditing && setEditCell({ empId: emp.id, lphId: primaryLphId, kw })}>
                              {isEditing ? (
                                <input type="number" min="0" max="60" step="0.5" defaultValue={phaseHoursKw || ''} autoFocus
                                  style={{ width: COL_WIDTH - 8, textAlign: 'center', fontSize: 12 }}
                                  className="h-8 font-medium border border-blue-300 rounded-md bg-white text-slate-800 outline-none"
                                  onBlur={e => commitEdit(emp.id, primaryLphId, kw, e.target.value)}
                                  onKeyDown={e => { if (e.key==='Enter') commitEdit(emp.id, primaryLphId, kw, (e.target as HTMLInputElement).value); if (e.key==='Escape') setEditCell(null) }} />
                              ) : (
                                <div style={{ width: COL_WIDTH - 8, height: 32 }}
                                  className={`flex items-center justify-center rounded-md cursor-pointer text-xs font-medium transition-all
                                    ${phaseHoursKw > 0 ? cellBg : `text-slate-200 hover:bg-slate-100 hover:text-slate-400 ${inRange && !isHI ? 'border border-dashed border-amber-200' : ''}`}`}>
                                  {phaseHoursKw > 0 ? `${Math.round(phaseHoursKw * 10) / 10}h` : '+'}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {/* Summe */}
                        <div style={{ width: 56, minWidth: 56 }} className="text-center text-xs font-semibold text-slate-500 flex items-center justify-center">
                          {empPhaseTotal > 0 ? `${Math.round(empPhaseTotal)}h` : '—'}
                        </div>
                      </div>
                    )
                  })
                ]
              })}

              {/* Summenzeile */}
              <div className="flex bg-slate-50 border-t border-slate-200">
                <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-2.5 text-xs font-semibold text-slate-500 border-r border-slate-100">Σ je KW</div>
                <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="border-r border-slate-100" />
                {weeks.map((kw, i) => {
                  const isHI = i < H_I_WEEKS
                  const inRange = isInPhaseRange(kw)
                  return (
                    <div key={kw} style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                      className={`text-center text-xs font-semibold text-slate-500 py-2.5 border-r border-slate-50 ${isHI ? 'bg-blue-50/40' : inRange ? 'bg-amber-50/50' : ''}`}>
                      {getKwPhaseTotal(kw) > 0 ? `${Math.round(getKwPhaseTotal(kw))}h` : '—'}
                    </div>
                  )
                })}
                <div style={{ width: 56 }} />
              </div>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
          <TrendingDown className="h-3 w-3" />
          Stundensätze intern ·
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-blue-50 border border-blue-200 inline-block" />H&I-Zone (tagesaktuelle Planung)</span> ·
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-50 border border-amber-200 inline-block" />Terminplan-Leitplanke</span> ·
          Klick auf Gantt-Balken → Terminplan bearbeiten
        </p>
      </div>


    </>
  )
}