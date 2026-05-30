'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { TrendingDown, Users, Clock, Euro, Circle, ChevronRight, Plus, X } from 'lucide-react'
import { upsertAllocation, getLphBudgetStatus } from '@/app/actions/allocation'
import { loadProjectAllocations } from '@/app/actions/heatmap'
import { loadTerminplan, saveLphSchedule, saveMilestone, type LphSchedule, type Milestone } from '@/app/actions/terminplan'
import { ALL_LPH, LPH_LABELS } from '@/lib/planning-phases'
import { isoWeekOf } from '@/lib/calendar-weeks'
import GanttBar from './GanttBar'

// ── Konstanten ─────────────────────────────────────────────────────────────────

const COL_WIDTH = 52   // px — einheitliche Spaltenbreite für Gantt + Matrix
const EMP_COL   = 200  // px — Mitarbeiter-/LPH-Spalte
const CAP_COL   = 56   // px — Kapazitätsspalte
const H_I_WEEKS = 2    // Erste N KWs = H&I-Zone

// LPH → Balkenfarbe (visuelle Gruppierung wie früher Basic/Detail/Ausführung)
function lphColor(n: number): string {
  if (n <= 4) return 'bg-violet-500'
  if (n <= 7) return 'bg-blue-500'
  return 'bg-emerald-500'
}

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
  const [selectedLph, setSelectedLph] = useState<number | null>(null)
  const [visibleLph, setVisibleLph] = useState<Set<number>>(new Set())
  const [showLphPicker, setShowLphPicker] = useState(false)
  const [lphBudgets, setLphBudgets] = useState<Record<number, LphBudget>>({})
  const [allocations, setAllocations] = useState<AllocMap>({})
  const [editCell, setEditCell] = useState<{ empId: string; kw: number } | null>(null)
  const [showDummies, setShowDummies] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [schedules, setSchedules] = useState<LphSchedule[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Meilenstein-Formular (MVP, KW-basiert)
  const [showMsForm, setShowMsForm] = useState(false)
  const [msDesc, setMsDesc] = useState('')
  const [msDate, setMsDate] = useState('') // ISO-Datum (yyyy-mm-dd) aus <input type="date">
  const [msLph, setMsLph] = useState<number | null>(null)
  const [msSaving, setMsSaving] = useState(false)
  const [msError, setMsError] = useState<string | null>(null)

  const currentWeek = getCurrentWeek()
  const currentYear = new Date().getFullYear()
  const weeks = Array.from({ length: 12 }, (_, i) => ((currentWeek - 1 + i) % 52) + 1)
  const allEmployees = [...employees, ...(showDummies ? DUMMY_EMPLOYEES : [])]
  const departments = [...new Set(allEmployees.map(e => e.department))]

  useEffect(() => {
    const initial = projects.find(p => p.id === initialProjectId) ?? projects[0]
    if (initial) handleProjectSelect(initial)
  }, [initialProjectId]) // eslint-disable-line

  // ── Laden ──────────────────────────────────────────────────────────────────

  async function fetchLphBudgets(project: Project): Promise<Record<number, LphBudget>> {
    const map: Record<number, LphBudget> = {}
    for (const n of ALL_LPH) {
      try { const b = await getLphBudgetStatus(project.id, n); if (b) map[n] = b } catch {}
    }
    return map
  }

  async function fetchAllocations(project: Project): Promise<{ map: AllocMap; lphWithHours: Set<number> }> {
    const data = await loadProjectAllocations(project.id, currentYear, weeks)
    const map: AllocMap = {}
    const lphWithHours = new Set<number>()
    for (const a of data) {
      const lphId = `${project.id}_lph${a.lph_number}`
      const key = `${a.employee_id}_${lphId}`
      if (!map[key]) map[key] = {}
      map[key][a.calendar_week] = { hours: a.allocated_hours, source: a.source as 'H&I' | 'Manuell_PL' }
      if (a.allocated_hours > 0) lphWithHours.add(a.lph_number)
    }
    return { map, lphWithHours }
  }

  async function loadAll(project: Project) {
    try {
      const [budgets, alloc, term] = await Promise.all([
        fetchLphBudgets(project),
        fetchAllocations(project),
        loadTerminplan(project.id),
      ])
      setLphBudgets(budgets)
      setAllocations(alloc.map)
      setSchedules(term.schedules)
      setMilestones(term.milestones)

      // Default sichtbare LPH: terminierte ∪ mit Stunden; sonst alle budgetierten.
      const scheduled = term.schedules.filter(s => s.start_kw != null && s.end_kw != null).map(s => s.lph_number)
      const def = new Set<number>([...scheduled, ...alloc.lphWithHours])
      const visible = def.size > 0 ? def : new Set<number>(term.schedules.map(s => s.lph_number))
      setVisibleLph(visible)
      const sortedVisible = [...visible].sort((a, b) => a - b)
      setSelectedLph(sortedVisible[0] ?? null)
    } catch (e) { console.error(e) }
  }

  async function handleProjectSelect(project: Project) {
    setSelectedProject(project)
    setLphBudgets({}); setAllocations({}); setSchedules([]); setMilestones([])
    setVisibleLph(new Set()); setSelectedLph(null); setShowLphPicker(false)
    await loadAll(project)
  }

  // ── Abgeleitete Werte ────────────────────────────────────────────────────────

  // Verfügbare (budgetierte) LPH = solche mit project_lph_budgets-Zeile (echte lph_id).
  const availableLph = new Set(schedules.map(s => s.lph_number))
  const visibleSorted = schedules
    .filter(s => visibleLph.has(s.lph_number))
    .sort((a, b) => a.lph_number - b.lph_number)

  // Effektiv aktive LPH (fällt auf erste sichtbare zurück, falls Auswahl ausgeblendet).
  const activeLph = (selectedLph != null && visibleLph.has(selectedLph))
    ? selectedLph
    : (visibleSorted[0]?.lph_number ?? null)
  const activeSchedule = activeLph != null ? schedules.find(s => s.lph_number === activeLph) ?? null : null
  const primaryLphId = activeLph != null ? `${selectedProject?.id}_lph${activeLph}` : ''

  function toggleLph(n: number) {
    if (!availableLph.has(n)) return
    setVisibleLph(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }

  // ── Terminplan-/Range-Helpers (auf aktive LPH bezogen) ─────────────────────────

  function isInRange(kw: number): boolean {
    return !!(activeSchedule?.start_kw && activeSchedule?.end_kw && kw >= activeSchedule.start_kw && kw <= activeSchedule.end_kw)
  }
  function getMilestonesForKw(kw: number): Milestone[] {
    return milestones.filter(m => m.kw === kw && m.lph_number === activeLph)
  }
  function msTooltip(m: Milestone): string {
    return `${m.description} · KW ${String(m.kw).padStart(2, '0')}/${m.year}`
  }

  // ── Meilenstein-MVP ──────────────────────────────────────────────────────────

  function openMsForm() {
    const sorted = [...schedules].sort((a, b) => a.lph_number - b.lph_number)
    setMsDesc('')
    setMsDate('')
    setMsLph(activeLph != null && availableLph.has(activeLph) ? activeLph : (sorted[0]?.lph_number ?? null))
    setMsError(null)
    setShowMsForm(true)
  }

  async function handleSaveMilestone() {
    if (!selectedProject || msLph == null) return
    const desc = msDesc.trim()
    if (!desc) { setMsError('Beschreibung fehlt'); return }
    if (!msDate) { setMsError('Datum fehlt'); return }
    // Datum als UTC-Mitternacht parsen (Zeitzonen-Drift vermeiden),
    // dann über die zentrale Funktion in ISO-KW + ISO-Jahr umrechnen.
    const parsed = new Date(`${msDate}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) { setMsError('Datum ungültig'); return }
    const { year, week: kw } = isoWeekOf(parsed) // ISO-Jahr, NICHT getFullYear()
    const sched = schedules.find(s => s.lph_number === msLph)
    if (!sched) { setMsError('LPH ohne Budget'); return }   // nur LPH mit vorhandener lph_id
    setMsSaving(true); setMsError(null)
    try {
      const res = await saveMilestone(selectedProject.id, sched.lph_id, kw, year, 'external', desc)
      if (!res.success || !res.id) { setMsError(res.message || 'Speichern fehlgeschlagen'); return }
      setMilestones(prev => [...prev, {
        id: res.id!, lph_id: sched.lph_id, lph_number: sched.lph_number,
        kw, year, type: 'external', description: desc,
      }])
      setShowMsForm(false)
    } catch (e) {
      setMsError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setMsSaving(false)
    }
  }

  // ── Alloc-Helpers ──────────────────────────────────────────────────────────────

  function allocKey(empId: string, lphId: string) { return `${empId}_${lphId}` }
  function getHours(empId: string, lphId: string, kw: number) { return allocations[allocKey(empId, lphId)]?.[kw]?.hours ?? 0 }
  function getSource(empId: string, lphId: string, kw: number) { return allocations[allocKey(empId, lphId)]?.[kw]?.source }
  function getEmpLphTotal(empId: string) { return activeLph == null ? 0 : weeks.reduce((s, kw) => s + getHours(empId, primaryLphId, kw), 0) }
  function getKwLphTotal(kw: number) { return activeLph == null ? 0 : allEmployees.reduce((sum, emp) => sum + getHours(emp.id, primaryLphId, kw), 0) }

  // ── Budget-Karten (auf aktive LPH bezogen) ─────────────────────────────────────

  const activeBudget = activeLph != null ? lphBudgets[activeLph] : undefined
  const totalBudget = activeBudget?.budget_eur ?? 0
  const totalAllocated = activeBudget?.allocated_eur ?? 0
  const totalHours = activeBudget?.total_hours ?? 0
  const utilizationPct = totalBudget > 0 ? Math.min(100, Math.round(totalAllocated / totalBudget * 100)) : 0
  const progressColor = utilizationPct > 85 ? 'bg-red-400' : utilizationPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'

  function commitEdit(empId: string, kw: number, value: string) {
    if (activeLph == null) { setEditCell(null); return }
    const hours = Math.max(0, Math.min(60, parseFloat(value) || 0))
    const lphId = primaryLphId
    setAllocations(prev => ({ ...prev, [allocKey(empId, lphId)]: { ...prev[allocKey(empId, lphId)], [kw]: { hours, source: 'Manuell_PL' } } }))
    setEditCell(null)
    if (empId.startsWith('dummy-') || !selectedProject) return
    const lphNum = activeLph
    startTransition(async () => {
      try {
        const result = await upsertAllocation(selectedProject.id, lphId, empId, kw, currentYear, hours)
        if (result) {
          setLphBudgets(prev => {
            const b = prev[lphNum]
            if (!b) return prev
            return { ...prev, [lphNum]: { ...b, remaining_eur: result.remaining_eur, utilization_pct: result.utilization_pct } }
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

      {/* ── Budget-Karten (aktive LPH) ── */}
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
          ) : <p className="text-slate-300 text-sm mt-1">{activeLph != null ? 'Kein Budget' : 'LPH wählen'}</p>}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2"><Clock className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Verplante Stunden</p></div>
          <p className="text-xl font-semibold text-slate-800">{totalHours > 0 ? `${Math.round(totalHours)} h` : '— h'}</p>
          <p className="text-xs text-slate-400 mt-0.5">{activeLph != null ? `LPH ${activeLph}: ${LPH_LABELS[activeLph]}` : 'Keine LPH'}</p>
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
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Terminplan & Ressourcen</p>
              <p className="text-xs text-slate-400">{activeLph != null ? `LPH ${activeLph}: ${LPH_LABELS[activeLph]}` : 'Keine LPH ausgewählt'}</p>
            </div>

            {/* LPH hinzufügen */}
            <div className="relative">
              <button onClick={() => setShowLphPicker(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors">
                <Plus className="h-3.5 w-3.5" />LPH hinzufügen
              </button>
              {showLphPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLphPicker(false)} />
                  <div className="absolute left-0 top-full mt-2 z-50 w-80 bg-white rounded-xl border border-slate-200 shadow-xl p-2">
                    <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Leistungsphasen anzeigen</p>
                    {ALL_LPH.map(n => {
                      const available = availableLph.has(n)
                      const checked = visibleLph.has(n)
                      return (
                        <label key={n}
                          className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm ${available ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-50'}`}>
                          <input type="checkbox" disabled={!available} checked={checked} onChange={() => toggleLph(n)}
                            className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                          <span className="font-semibold text-slate-700 shrink-0">LPH {n}</span>
                          <span className="text-xs text-slate-400 truncate">{LPH_LABELS[n]}</span>
                          {!available && <span className="ml-auto text-[9px] text-slate-300 shrink-0">kein Budget</span>}
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Meilenstein hinzufügen */}
            <div className="relative">
              <button onClick={() => (showMsForm ? setShowMsForm(false) : openMsForm())}
                disabled={availableLph.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Plus className="h-3.5 w-3.5" />Meilenstein
              </button>
              {showMsForm && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMsForm(false)} />
                  <div className="absolute left-0 top-full mt-2 z-50 w-72 bg-white rounded-xl border border-slate-200 shadow-xl p-3">
                    <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Meilenstein hinzufügen</p>
                    {availableLph.size === 0 ? (
                      <p className="px-1 py-2 text-xs text-slate-400">Keine LPH mit Budget vorhanden.</p>
                    ) : (
                      <div className="space-y-2.5 px-1">
                        <div>
                          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Beschreibung</label>
                          <input type="text" value={msDesc} onChange={e => setMsDesc(e.target.value)} placeholder="z. B. Bauantrag"
                            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Datum</label>
                          <input type="date" value={msDate} onChange={e => setMsDate(e.target.value)}
                            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800" />
                          <p className="mt-1 text-[10px] text-slate-400">Wird in ISO-Kalenderwoche umgerechnet.</p>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Leistungsphase</label>
                          <select value={msLph ?? ''} onChange={e => setMsLph(Number(e.target.value))}
                            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800 bg-white">
                            {[...schedules].sort((a, b) => a.lph_number - b.lph_number).map(s => (
                              <option key={s.lph_id} value={s.lph_number}>LPH {s.lph_number}: {LPH_LABELS[s.lph_number]}</option>
                            ))}
                          </select>
                        </div>
                        {msError && <p className="text-[11px] text-red-500">{msError}</p>}
                        <button onClick={handleSaveMilestone} disabled={msSaving}
                          className="w-full py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50">
                          {msSaving ? 'Speichern…' : 'Meilenstein speichern'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            {isPending && <span className="text-amber-500 animate-pulse">Speichern…</span>}
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium">H&I-Zone (KW 1–{H_I_WEEKS})</span>
            <span className="flex items-center gap-1"><X className="h-3 w-3 text-red-600" strokeWidth={3} />Extern</span>
            <span className="flex items-center gap-1"><Circle className="h-3 w-3 text-blue-500 fill-blue-500" />Intern</span>
          </div>
        </div>

        <div className="overflow-x-auto" ref={scrollRef}>
          <div style={{ minWidth: `${EMP_COL + CAP_COL + weeks.length * COL_WIDTH}px` }}>

            {/* ── LPH-ZEILEN (1→9, nur sichtbare) ── */}
            {visibleSorted.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-slate-400 border-b border-slate-100">
                Noch keine Leistungsphase sichtbar — über „LPH hinzufügen" auswählen.
              </div>
            ) : visibleSorted.map(s => {
              const isSel = activeLph === s.lph_number
              const color = lphColor(s.lph_number)
              return (
                <div key={s.lph_id}
                  className={`flex items-center border-b border-slate-100 cursor-pointer ${isSel ? 'bg-slate-50' : ''}`}
                  onClick={() => setSelectedLph(s.lph_number)}>
                  <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-1.5 flex items-center gap-2 border-r border-slate-100">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
                    <p className="text-xs font-semibold text-slate-700 shrink-0">LPH {s.lph_number}</p>
                    <p className="text-[10px] text-slate-400 truncate">{LPH_LABELS[s.lph_number]}</p>
                    {isSel && <ChevronRight className="h-3 w-3 text-slate-400 ml-auto shrink-0" />}
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
                      color={color}
                      onChange={(id, start, end) => {
                        setSchedules(prev => prev.map(sc =>
                          sc.lph_id === id ? { ...sc, start_kw: start, end_kw: end } : sc
                        ))
                        setSelectedLph(s.lph_number)
                      }}
                      onSave={(id, start, end) => saveLphSchedule(id, start, end, currentYear)}
                    />
                  </div>
                </div>
              )
            })}

            {/* ── KW-HEADER ── */}
            <div className="flex bg-slate-50 border-b border-slate-200">
              <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-2 text-xs font-medium text-slate-500 border-r border-slate-100">Mitarbeiter</div>
              <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="py-2 text-xs font-medium text-slate-400 text-center border-r border-slate-100">Kap/Wo</div>
              {weeks.map((kw, i) => {
                const inRange = isInRange(kw)
                const kwMs = getMilestonesForKw(kw)
                const isHI = i < H_I_WEEKS
                return (
                  <div key={kw}
                    style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                    className={`py-1 text-center border-r border-slate-100 ${isHI ? 'bg-blue-50' : inRange ? 'bg-amber-50' : ''}`}>
                    {kwMs.length > 0 && (
                      <div className="flex gap-0.5 justify-center mb-0.5">
                        {kwMs.map(m => (
                          <div key={m.id} title={msTooltip(m)} className="cursor-help">
                            {m.type === 'external'
                              ? <X className="h-3 w-3 text-red-600" strokeWidth={3} />
                              : <Circle className="h-2.5 w-2.5 text-blue-500 fill-blue-500" />}
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
                  const empTotal = getEmpLphTotal(emp.id)
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
                        const hoursKw = activeLph != null ? getHours(emp.id, primaryLphId, kw) : 0
                        const src = getSource(emp.id, primaryLphId, kw)
                        const isEditing = editCell?.empId === emp.id && editCell?.kw === kw
                        const inRange = isInRange(kw)
                        const isHI = i < H_I_WEEKS
                        const loadPct = emp.weekly_capacity_hours > 0 ? hoursKw / emp.weekly_capacity_hours * 100 : 0
                        const cellBg = hoursKw === 0 ? '' : isDummy ? 'bg-slate-100 text-slate-500' : loadPct > 100 ? 'bg-red-50 text-red-600' : src === 'H&I' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                        const editable = activeLph != null

                        return (
                          <div key={kw}
                            style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                            className={`flex items-center justify-center border-r border-slate-50 py-1.5 ${isHI ? 'bg-blue-50/40' : inRange ? 'bg-amber-50/50' : ''}`}
                            onClick={() => editable && !isEditing && setEditCell({ empId: emp.id, kw })}>
                            {isEditing ? (
                              <input type="number" min="0" max="60" step="0.5" defaultValue={hoursKw || ''} autoFocus
                                style={{ width: COL_WIDTH - 8, textAlign: 'center', fontSize: 12 }}
                                className="h-8 font-medium border border-blue-300 rounded-md bg-white text-slate-800 outline-none"
                                onBlur={e => commitEdit(emp.id, kw, e.target.value)}
                                onKeyDown={e => { if (e.key==='Enter') commitEdit(emp.id, kw, (e.target as HTMLInputElement).value); if (e.key==='Escape') setEditCell(null) }} />
                            ) : (
                              <div style={{ width: COL_WIDTH - 8, height: 32 }}
                                className={`flex items-center justify-center rounded-md text-xs font-medium transition-all
                                  ${hoursKw > 0 ? cellBg : editable ? `cursor-pointer text-slate-200 hover:bg-slate-100 hover:text-slate-400 ${inRange && !isHI ? 'border border-dashed border-amber-200' : ''}` : 'text-slate-200'}`}>
                                {hoursKw > 0 ? `${Math.round(hoursKw * 10) / 10}h` : editable ? '+' : ''}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {/* Summe */}
                      <div style={{ width: 56, minWidth: 56 }} className="text-center text-xs font-semibold text-slate-500 flex items-center justify-center">
                        {empTotal > 0 ? `${Math.round(empTotal)}h` : '—'}
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
                const inRange = isInRange(kw)
                return (
                  <div key={kw} style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                    className={`text-center text-xs font-semibold text-slate-500 py-2.5 border-r border-slate-50 ${isHI ? 'bg-blue-50/40' : inRange ? 'bg-amber-50/50' : ''}`}>
                    {getKwLphTotal(kw) > 0 ? `${Math.round(getKwLphTotal(kw))}h` : '—'}
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
  )
}
