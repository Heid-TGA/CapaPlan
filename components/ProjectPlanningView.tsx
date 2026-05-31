'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { TrendingDown, Users, Clock, Euro, Circle, ChevronRight, ChevronLeft, Plus, X, Calculator } from 'lucide-react'
import { upsertAllocation, getLphBudgetStatus } from '@/app/actions/allocation'
import { loadProjectAllocationsForWindow } from '@/app/actions/heatmap'
import { loadTerminplan, saveLphSchedule, saveMilestone, ensureLphBudgetRow, type LphSchedule, type Milestone } from '@/app/actions/terminplan'
import { loadExternalTrades, createExternalTrade, deleteExternalTrade, type ExternalTrade } from '@/app/actions/external-trades'
import { updateProjectCalcProfile } from '@/app/actions/project-settings'
import { loadPlanningRoles, type PlanningRole } from '@/app/actions/planning-roles'
import { loadLphRolePlan, saveLphRolePlan, loadProjectRolePlans, type LphRoleShare } from '@/app/actions/lph-role-plan'
import { loadProjectBudgetAreas, type BudgetArea } from '@/app/actions/budget-areas'
import { ALL_LPH, LPH_LABELS } from '@/lib/planning-phases'
import { CALC_PROFILES, CALC_PROFILE_LABELS, isCalcProfile, type CalcProfile } from '@/lib/calc-profile'
import { isoWeekOf, mondayOfIsoWeek, currentIsoWeek, addWeeks, buildWeekWindow, type WeekRef, type WindowWeek } from '@/lib/calendar-weeks'
import GanttBar from './GanttBar'
import HoaiCalculatorModal from './HoaiCalculatorModal'

// ── Konstanten ─────────────────────────────────────────────────────────────────

const COL_WIDTH = 52   // px — einheitliche Spaltenbreite für Gantt + Matrix
const EMP_COL   = 200  // px — Mitarbeiter-/LPH-Spalte
const CAP_COL   = 56   // px — Kapazitätsspalte
const H_I_WEEKS = 2    // Erste N KWs = H&I-Zone

// Fremdgewerk-Namensvorschläge (Freitext bleibt möglich).
const TRADE_PRESETS = ['Architektur', 'Statik', 'Bauherr', 'Behörde', 'Fachplaner']

// LPH → Balkenfarbe (visuelle Gruppierung wie früher Basic/Detail/Ausführung)
function lphColor(n: number): string {
  if (n <= 4) return 'bg-violet-500'
  if (n <= 7) return 'bg-blue-500'
  return 'bg-emerald-500'
}

// ── Typen ──────────────────────────────────────────────────────────────────────

interface Project { id: string; project_number: string; name: string; calc_profile?: string }
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

// Zeitachsen-Fenster (6B-0): Standard ~3 Monate, Navigation in Monatsschritten.
const WINDOW_HORIZON = 13   // sichtbare ISO-Wochen (~3 Monate)
const WINDOW_STEP = 4       // Wochen pro Navigationsklick (~1 Monat)

function weekKey(w: { year: number; week: number }): string {
  return `${w.year}-${w.week}`
}

function fmtEur(n: number) {
  return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n)
}
// Prozent-Eingabe (de) -> number, geklemmt auf 0..100. Leer/ungueltig -> 0.
function parseSharePct(raw: string | undefined): number {
  if (!raw) return 0
  const n = parseFloat(raw.replace(',', '.'))
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
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
  const [scheduleError, setScheduleError] = useState<string | null>(null) // Terminplan-Speicherfehler (sichtbar)
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
  const [addingLph, setAddingLph] = useState<number | null>(null) // LPH ohne Budget wird gerade angelegt

  // Andere Gewerke (Terminplan-/Koordinationslayer, KEIN Ressourcenlayer)
  const [externalTrades, setExternalTrades] = useState<ExternalTrade[]>([])
  const [showExternalTrades, setShowExternalTrades] = useState(false) // Default: eingeklappt
  const [showEtForm, setShowEtForm] = useState(false)
  const [etName, setEtName] = useState('')
  const [etLph, setEtLph] = useState<number | null>(null)
  const [etStart, setEtStart] = useState('') // ISO yyyy-mm-dd
  const [etEnd, setEtEnd] = useState('')     // ISO yyyy-mm-dd
  const [etNote, setEtNote] = useState('')
  const [etSaving, setEtSaving] = useState(false)
  const [etError, setEtError] = useState<string | null>(null)
  const [deletingEtId, setDeletingEtId] = useState<string | null>(null)

  // Kalkulationsprofil (A1) — nur ein Schalter; aendert keine Budgets/Allocations/
  // Meilensteine/Gewerke. Lokaler Override-State je Projekt-ID (Prop bleibt unberuehrt).
  const [profileByProject, setProfileByProject] = useState<Record<string, CalcProfile>>(
    () => Object.fromEntries(projects.map(p => [p.id, isCalcProfile(p.calc_profile) ? p.calc_profile : 'frei']))
  )
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  // HOAI-Dummy-Rechner (A2) — rein lokales Szenario-Fenster, keine Persistenz.
  const [showHoai, setShowHoai] = useState(false)

  // Rollenverteilung je LPH (6B-2B) — reines Soll-/Planungsmodell.
  // KEINE Mitarbeiterzuweisung, kein allocations-Schreibpfad, keine Stundensaetze
  // von Mitarbeitenden. Nutzt die echte lph_id (UUID), nicht primaryLphId.
  const [showRolePlan, setShowRolePlan] = useState(false)
  const [planRoles, setPlanRoles] = useState<PlanningRole[]>([])
  const [planAreas, setPlanAreas] = useState<BudgetArea[]>([])
  // Alle Rollenverteilungen des Projekts (für SOLL-Stunden je LPH-Balken, 6B-2D).
  const [rolePlans, setRolePlans] = useState<LphRoleShare[]>([])
  const [rpAreaId, setRpAreaId] = useState<string>('') // '' = Gesamt / ohne Bereich
  const [rpShares, setRpShares] = useState<Record<string, string>>({}) // roleId -> %-String
  const [rpLoading, setRpLoading] = useState(false)
  const [rpSaving, setRpSaving] = useState(false)
  const [rpError, setRpError] = useState<string | null>(null)
  const [rpSavedMsg, setRpSavedMsg] = useState<string | null>(null)

  // Zeitachsen-Navigation (6B-0): Startwoche des sichtbaren Fensters (WeekRef).
  const [windowStart, setWindowStart] = useState<WeekRef>(() => currentIsoWeek())

  // Abgeleitetes Fenster — ISO-/Jahreswechsel-sicher über lib/calendar-weeks.
  const today = currentIsoWeek()
  const windowWeeks: WindowWeek[] = buildWeekWindow(windowStart, WINDOW_HORIZON)
  // Echte H&I-Zone: die nächsten H_I_WEEKS Wochen AB HEUTE (nicht relativ zum Fenster).
  const hiKeys = new Set(Array.from({ length: H_I_WEEKS }, (_, i) => weekKey(addWeeks(today, i))))
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
    const data = await loadProjectAllocationsForWindow(project.id, windowWeeks.map(w => ({ year: w.year, week: w.week })))
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
      const [budgets, alloc, term, rolePlansRes] = await Promise.all([
        fetchLphBudgets(project),
        fetchAllocations(project),
        loadTerminplan(project.id),
        loadProjectRolePlans(project.id),
      ])
      setLphBudgets(budgets)
      setAllocations(alloc.map)
      setSchedules(term.schedules)
      setMilestones(term.milestones)
      setRolePlans(rolePlansRes.success ? rolePlansRes.data : [])

      // Default sichtbare LPH: terminierte ∪ mit Stunden; sonst alle budgetierten.
      const scheduled = term.schedules.filter(s => s.start_kw != null && s.end_kw != null).map(s => s.lph_number)
      const def = new Set<number>([...scheduled, ...alloc.lphWithHours])
      const visible = def.size > 0 ? def : new Set<number>(term.schedules.map(s => s.lph_number))
      setVisibleLph(visible)
      const sortedVisible = [...visible].sort((a, b) => a - b)
      setSelectedLph(sortedVisible[0] ?? null)
    } catch (e) { console.error(e) }

    // Andere Gewerke separat laden — ein Fehler hier darf die Projektplanung
    // (Budgets/Allocations/Terminplan) NICHT blockieren.
    try {
      const etRes = await loadExternalTrades(project.id)
      if (etRes.success) setExternalTrades(etRes.data)
      else { setExternalTrades([]); console.error('loadExternalTrades:', etRes.message) }
    } catch (e) { setExternalTrades([]); console.error(e) }
  }

  async function handleProjectSelect(project: Project) {
    setSelectedProject(project)
    setLphBudgets({}); setAllocations({}); setSchedules([]); setMilestones([]); setRolePlans([])
    setVisibleLph(new Set()); setSelectedLph(null); setShowLphPicker(false)
    setExternalTrades([]); setShowEtForm(false); setEtError(null)
    setScheduleError(null)
    setProfileError(null)
    await loadAll(project)
  }

  // ── Zeitachsen-Navigation (6B-0) ────────────────────────────────────────────
  // Allocations beim Fensterwechsel jahreswechsel-sicher nachladen. State wird
  // KOMPLETT ersetzt (kein Merge) -> innerhalb eines <=13-Wochen-Fensters sind
  // KW-Nummern eindeutig, daher bleibt der week-basierte AllocMap-Key kollisionsfrei.
  const windowKey = weekKey(windowStart)
  const skipFirstWindowLoad = useRef(true)
  useEffect(() => {
    if (skipFirstWindowLoad.current) { skipFirstWindowLoad.current = false; return }
    const project = selectedProject
    if (!project) return
    let cancelled = false
    setEditCell(null)
    loadProjectAllocationsForWindow(project.id, windowWeeks.map(w => ({ year: w.year, week: w.week })))
      .then(data => {
        if (cancelled) return
        const map: AllocMap = {}
        for (const a of data) {
          const lphId = `${project.id}_lph${a.lph_number}`
          const key = `${a.employee_id}_${lphId}`
          if (!map[key]) map[key] = {}
          map[key][a.calendar_week] = { hours: a.allocated_hours, source: a.source as 'H&I' | 'Manuell_PL' }
        }
        setAllocations(map)
      })
      .catch(e => console.error(e))
    return () => { cancelled = true }
  }, [windowKey]) // eslint-disable-line

  function goToday() { setWindowStart(currentIsoWeek()) }
  function goPrev() { setWindowStart(s => addWeeks(s, -WINDOW_STEP)) }
  function goNext() { setWindowStart(s => addWeeks(s, WINDOW_STEP)) }

  // ── Kalkulationsprofil (A1) ────────────────────────────────────────────────
  // Aktuelles Profil des gewaehlten Projekts (lokaler Override, sonst 'frei').
  const currentProfile: CalcProfile =
    selectedProject ? (profileByProject[selectedProject.id] ?? 'frei') : 'frei'

  async function handleProfileChange(value: string) {
    if (!selectedProject || !isCalcProfile(value)) return
    const projectId = selectedProject.id
    const prev = profileByProject[projectId] ?? 'frei'
    if (value === prev) return
    // Optimistisch setzen, bei Fehler zuruecksetzen.
    setProfileByProject(m => ({ ...m, [projectId]: value }))
    setProfileSaving(true); setProfileError(null)
    try {
      const res = await updateProjectCalcProfile(projectId, value)
      if (!res.success) {
        setProfileByProject(m => ({ ...m, [projectId]: prev }))
        setProfileError(res.message)
        console.error('updateProjectCalcProfile:', res.message)
      }
    } catch (e) {
      setProfileByProject(m => ({ ...m, [projectId]: prev }))
      const msg = e instanceof Error ? e.message : 'Speichern fehlgeschlagen'
      setProfileError(msg)
      console.error('updateProjectCalcProfile:', e)
    } finally {
      setProfileSaving(false)
    }
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
  // Echte LPH-UUID (aus project_lph_budgets) — Pflicht fuer lph_role_plan.
  const realLphId = activeSchedule?.lph_id ?? null

  // ── Rollenverteilung (6B-2B) ────────────────────────────────────────────────
  // Aktive Planungsrollen + Budgetbereiche je Projekt laden.
  useEffect(() => {
    const pid = selectedProject?.id
    setRpAreaId(''); setRpSavedMsg(null); setRpError(null)
    if (!pid) { setPlanRoles([]); setPlanAreas([]); return }
    let cancelled = false
    Promise.all([loadPlanningRoles(), loadProjectBudgetAreas(pid)])
      .then(([rolesRes, areasRes]) => {
        if (cancelled) return
        setPlanRoles(rolesRes.success ? rolesRes.data.filter(r => r.active) : [])
        setPlanAreas(areasRes.success ? areasRes.data : [])
      })
      .catch(() => { if (!cancelled) { setPlanRoles([]); setPlanAreas([]) } })
    return () => { cancelled = true }
  }, [selectedProject?.id]) // eslint-disable-line

  // Vorhandene Verteilung der aktiven LPH (+ Bereich) laden.
  useEffect(() => {
    setRpSavedMsg(null)
    if (!realLphId) { setRpShares({}); return }
    let cancelled = false
    setRpLoading(true)
    loadLphRolePlan(realLphId, rpAreaId || null)
      .then(res => {
        if (cancelled) return
        const m: Record<string, string> = {}
        if (res.success) for (const s of res.data) m[s.role_id] = String(s.share_pct)
        setRpShares(m)
      })
      .catch(() => { if (!cancelled) setRpShares({}) })
      .finally(() => { if (!cancelled) setRpLoading(false) })
    return () => { cancelled = true }
  }, [realLphId, rpAreaId])

  async function handleSaveRolePlan() {
    if (!realLphId) return
    setRpSaving(true); setRpError(null); setRpSavedMsg(null)
    try {
      const shares = planRoles.map(r => ({ roleId: r.id, sharePct: parseSharePct(rpShares[r.id]) }))
      const res = await saveLphRolePlan(realLphId, rpAreaId || null, shares)
      if (!res.success) { setRpError(res.message || 'Speichern fehlgeschlagen'); return }
      const m: Record<string, string> = {}
      for (const s of res.data) m[s.role_id] = String(s.share_pct)
      setRpShares(m)
      setRpSavedMsg('Gespeichert')
      // Projekt-Rollenverteilungen neu laden, damit die SOLL-Stunden auf den
      // LPH-Balken (6B-2D) sofort die gespeicherten Werte widerspiegeln.
      if (selectedProject) {
        try {
          const rp = await loadProjectRolePlans(selectedProject.id)
          if (rp.success) setRolePlans(rp.data)
        } catch { /* Balken-SOLL bleibt bis Reload auf altem Stand */ }
      }
    } catch (e) {
      setRpError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setRpSaving(false)
    }
  }

  const rpSum = planRoles.reduce((a, r) => a + parseSharePct(rpShares[r.id]), 0)
  const rpSumRounded = Math.round(rpSum * 10) / 10

  async function toggleLph(n: number) {
    // Abwählen: nur aus der sichtbaren Liste nehmen — KEINE DB-Zeile / Allocations /
    // Meilensteine / Terminbalken löschen.
    if (visibleLph.has(n)) {
      setVisibleLph(prev => { const next = new Set(prev); next.delete(n); return next })
      return
    }
    // Bereits budgetiert (echte lph_id vorhanden): nur einblenden, keine neue DB-Zeile.
    if (availableLph.has(n)) {
      setVisibleLph(prev => new Set(prev).add(n))
      setSelectedLph(n)
      return
    }
    // LPH ohne Budget: idempotent eine 0-Euro-Zeile anlegen, dann einblenden.
    if (!selectedProject || addingLph != null) return
    setAddingLph(n)
    try {
      const res = await ensureLphBudgetRow(selectedProject.id, n)
      if (!res.success || !res.row) { console.error('ensureLphBudgetRow:', res.message); return }
      const row = res.row
      setSchedules(prev => prev.some(s => s.lph_number === row.lph_number)
        ? prev.map(s => (s.lph_number === row.lph_number ? row : s))
        : [...prev, row])
      setVisibleLph(prev => new Set(prev).add(n))
      setSelectedLph(n)
      // Budgetstatus nachladen (für „Verplante Stunden" / spätere Allocations).
      try {
        const b = await getLphBudgetStatus(selectedProject.id, n)
        if (b) setLphBudgets(prev => ({ ...prev, [n]: b }))
      } catch { /* 0-Euro-LPH: Budgetkarte greift auf totalBudget>0-Guard zurück */ }
    } catch (e) {
      console.error(e)
    } finally {
      setAddingLph(null)
    }
  }

  // ── Terminplan-/Range-Helpers (auf aktive LPH bezogen) ─────────────────────────

  function isInRange(w: WeekRef): boolean {
    if (!activeSchedule?.start_kw || !activeSchedule?.end_kw) return false
    // Jahreswechsel-sicher: nur im plan_year der LPH-Zeile hervorheben.
    if (activeSchedule.plan_year != null && w.year !== activeSchedule.plan_year) return false
    return w.week >= activeSchedule.start_kw && w.week <= activeSchedule.end_kw
  }
  // ISO yyyy-mm-dd → dd.mm.yyyy. NULL/leer/ungültig → null (Tooltip fällt dann
  // auf reine KW-Anzeige zurück, z. B. für Alt-Meilensteine ohne milestone_date).
  function formatMsDate(iso: string | null): string | null {
    if (!iso) return null
    const [y, m, d] = iso.split('-')
    if (!y || !m || !d) return null
    return `${d}.${m}.${y}`
  }
  function msTooltip(m: Milestone): string {
    const kwPart = `KW ${String(m.kw).padStart(2, '0')}/${m.year}`
    const datePart = formatMsDate(m.milestone_date)
    return datePart
      ? `${m.description} · ${datePart} · ${kwPart}`
      : `${m.description} · ${kwPart}`
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
      // msDate (ISO yyyy-mm-dd) wird zusätzlich als exaktes Datum gespeichert;
      // kw/year bleiben für die KW-basierte Anzeige erhalten.
      const res = await saveMilestone(selectedProject.id, sched.lph_id, kw, year, 'external', desc, msDate)
      if (!res.success || !res.id) { setMsError(res.message || 'Speichern fehlgeschlagen'); return }
      setMilestones(prev => [...prev, {
        id: res.id!, lph_id: sched.lph_id, lph_number: sched.lph_number,
        kw, year, type: 'external', description: desc, milestone_date: msDate,
      }])
      setShowMsForm(false)
    } catch (e) {
      setMsError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setMsSaving(false)
    }
  }

  // ── LPH-Terminbalken speichern ─────────────────────────────────────────────────
  // Persistiert start_kw/end_kw/plan_year über saveLphSchedule und macht Fehler
  // sichtbar (kein stilles Verwerfen des Ergebnisses mehr). Wird von GanttBar bei
  // Drag-/Resize-Ende sowie beim Anlegen via Klick auf eine leere Zone aufgerufen.
  function persistSchedule(id: string, startKw: number, endKw: number, planYear: number) {
    startTransition(async () => {
      try {
        const res = await saveLphSchedule(id, startKw, endKw, planYear)
        if (!res.success) {
          setScheduleError(res.message || 'Terminplan konnte nicht gespeichert werden')
          console.error('saveLphSchedule fehlgeschlagen:', res.message)
        } else {
          setScheduleError(null)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Terminplan konnte nicht gespeichert werden'
        setScheduleError(msg)
        console.error('saveLphSchedule fehlgeschlagen:', e)
      }
    })
  }

  // ── Andere Gewerke (Terminplan-/Koordinationslayer) ────────────────────────────

  // Read-only Balkenposition auf der sichtbaren Fenster-Achse. Datum → ISO-KW über
  // lib/calendar-weeks. Balken wird auf das Fenster geclippt; liegt er komplett
  // außerhalb, wird null zurückgegeben (nicht gerendert).
  function externalBarPos(t: ExternalTrade): { left: number; width: number } | null {
    const sd = new Date(`${t.start_date}T00:00:00Z`)
    const ed = new Date(`${t.end_date}T00:00:00Z`)
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return null
    const m0 = mondayOfIsoWeek(windowStart.year, windowStart.week)
    const sRef = isoWeekOf(sd)
    const eRef = isoWeekOf(ed)
    const mS = mondayOfIsoWeek(sRef.year, sRef.week)
    const mE = mondayOfIsoWeek(eRef.year, eRef.week)
    const sDelta = Math.round((mS.getTime() - m0.getTime()) / (7 * 86_400_000))
    const eDelta = Math.round((mE.getTime() - m0.getTime()) / (7 * 86_400_000))
    const from = Math.max(0, sDelta)
    const to = Math.min(windowWeeks.length - 1, eDelta)
    if (to < from) return null // komplett außerhalb des Fensters
    return { left: from * COL_WIDTH, width: (to - from + 1) * COL_WIDTH }
  }

  // Tooltip: "Gewerk · LPH x · dd.mm.yyyy–dd.mm.yyyy" (+ Notiz falls vorhanden).
  function externalTooltip(t: ExternalTrade): string {
    const s = formatMsDate(t.start_date) ?? t.start_date
    const e = formatMsDate(t.end_date) ?? t.end_date
    const base = `${t.trade_name} · LPH ${t.lph_number} · ${s}–${e}`
    return t.note ? `${base} · ${t.note}` : base
  }

  function openEtForm() {
    setEtName('')
    setEtLph(activeLph ?? 1)
    setEtStart('')
    setEtEnd('')
    setEtNote('')
    setEtError(null)
    setShowEtForm(true)
  }

  async function handleSaveExternalTrade() {
    if (!selectedProject) return
    const name = etName.trim()
    if (!name) { setEtError('Gewerkname fehlt'); return }
    if (etLph == null) { setEtError('Leistungsphase wählen'); return }
    if (!etStart) { setEtError('Startdatum fehlt'); return }
    if (!etEnd) { setEtError('Enddatum fehlt'); return }
    if (etEnd < etStart) { setEtError('Enddatum darf nicht vor Startdatum liegen'); return }
    setEtSaving(true); setEtError(null)
    try {
      const res = await createExternalTrade(selectedProject.id, {
        trade_name: name,
        lph_number: etLph,
        start_date: etStart,
        end_date: etEnd,
        note: etNote.trim() || undefined,
      })
      if (!res.success) { setEtError(res.message || 'Speichern fehlgeschlagen'); return }
      setExternalTrades(prev => [...prev, res.data])
      setShowExternalTrades(true)
      setShowEtForm(false)
    } catch (e) {
      setEtError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setEtSaving(false)
    }
  }

  async function handleDeleteExternalTrade(id: string) {
    if (deletingEtId) return
    setDeletingEtId(id)
    try {
      const res = await deleteExternalTrade(id)
      if (res.success) setExternalTrades(prev => prev.filter(t => t.id !== id))
      else console.error('deleteExternalTrade:', res.message)
    } catch (e) {
      console.error(e)
    } finally {
      setDeletingEtId(null)
    }
  }

  // ── Alloc-Helpers ──────────────────────────────────────────────────────────────

  function allocKey(empId: string, lphId: string) { return `${empId}_${lphId}` }
  function getHours(empId: string, lphId: string, kw: number) { return allocations[allocKey(empId, lphId)]?.[kw]?.hours ?? 0 }
  function getSource(empId: string, lphId: string, kw: number) { return allocations[allocKey(empId, lphId)]?.[kw]?.source }

  // Synthetischer Client-Key einer LPH-Nummer (identisch zu fetchAllocations).
  function lphKey(n: number) { return `${selectedProject?.id}_lph${n}` }

  // ── Projektbezogene Matrix (6B-2D) ──────────────────────────────────────────
  // Die Matrix-Zelle bedeutet MITARBEITER + PROJEKT + KW (LPH-unabhängig): Summe
  // der Stunden über ALLE LPH dieses Projekts. Dadurch ändert sich der Wert NICHT,
  // wenn links eine andere LPH ausgewählt wird. Die LPH-Zuordnung für IST/SOLL
  // erfolgt separat, rein rechnerisch über die zeitliche Lage der LPH-Balken.
  function getProjectHours(empId: string, kw: number) {
    return schedules.reduce((s, sc) => s + getHours(empId, lphKey(sc.lph_number), kw), 0)
  }
  // Repräsentative Quelle für die Zellfarbe: Manuell hat Vorrang vor H&I.
  function getProjectSource(empId: string, kw: number): 'H&I' | 'Manuell_PL' | undefined {
    let hasHI = false, hasManual = false
    for (const sc of schedules) {
      if (getHours(empId, lphKey(sc.lph_number), kw) <= 0) continue
      const src = getSource(empId, lphKey(sc.lph_number), kw)
      if (src === 'Manuell_PL') hasManual = true
      else if (src === 'H&I') hasHI = true
    }
    return hasManual ? 'Manuell_PL' : hasHI ? 'H&I' : undefined
  }
  function getEmpProjectTotal(empId: string) { return windowWeeks.reduce((s, w) => s + getProjectHours(empId, w.week), 0) }
  function getKwProjectTotal(kw: number) { return allEmployees.reduce((sum, emp) => sum + getProjectHours(emp.id, kw), 0) }
  // Jahr einer Fenster-KW (für jahreswechsel-sicheres Speichern von Allocations).
  function yearOfWeek(kw: number): number { return windowWeeks.find(w => w.week === kw)?.year ?? today.year }

  // ── Budget-Karten (auf aktive LPH bezogen) ─────────────────────────────────────

  const activeBudget = activeLph != null ? lphBudgets[activeLph] : undefined
  const totalBudget = activeBudget?.budget_eur ?? 0
  const totalAllocated = activeBudget?.allocated_eur ?? 0
  const totalHours = activeBudget?.total_hours ?? 0
  const utilizationPct = totalBudget > 0 ? Math.min(100, Math.round(totalAllocated / totalBudget * 100)) : 0
  const progressColor = utilizationPct > 85 ? 'bg-red-400' : utilizationPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'

  // ── Soll-Rollenbedarf (6B-2C, read-only) ────────────────────────────────────
  // Reine Planungswerte, abgeleitet aus LPH-Budget (project_lph_budgets.budget_eur)
  // + Rollenverteilung + interner Planungssatz (planning_roles.rate_eur_per_hour).
  // KEINE allocations, KEINE Mitarbeiterdaten, KEIN hourly_rate_eur.
  //   rollen_budget = budget * share_pct / 100
  //   soll_stunden  = rollen_budget / rate   (rate <= 0 -> null)
  //   h/Woche       = soll_stunden / wochen  (kein Balken -> null)
  // Wochen aus dem LPH-Balken (start_kw..end_kw, inklusive). Reaktiv: Drag/Resize
  // des Balkens aktualisiert activeSchedule -> Werte rechnen sich automatisch neu.
  const lphWeeks =
    activeSchedule?.start_kw != null && activeSchedule?.end_kw != null
      ? activeSchedule.end_kw - activeSchedule.start_kw + 1
      : null

  const sollRows = planRoles
    .map((r) => {
      const pct = parseSharePct(rpShares[r.id])
      const rollenBudget = totalBudget * pct / 100
      const rate = r.rate_eur_per_hour
      const sollStunden = rate > 0 ? rollenBudget / rate : null
      const hProWoche = sollStunden != null && lphWeeks && lphWeeks > 0 ? sollStunden / lphWeeks : null
      return { id: r.id, name: r.name, pct, rate, rollenBudget, sollStunden, hProWoche }
    })
    .filter((row) => row.pct > 0)

  // ── IST/SOLL je LPH für die Balkenbeschriftung (6B-2D) ──────────────────────
  // SOLL: budget_lph × Σ(share_pct/100 ÷ rate) über die Gesamt-Rollenverteilung
  // (area_id = null), identisch zur bestehenden Soll-Rollenbedarf-Logik, aber je
  // LPH. rate ≤ 0 → Rolle trägt 0 bei (sauber abgefangen).
  const sollByLph: Record<number, number> = {}
  for (const s of schedules) {
    const budget = lphBudgets[s.lph_number]?.budget_eur ?? s.budget_eur ?? 0
    if (budget <= 0) continue
    let soll = 0
    for (const r of rolePlans) {
      if (r.lph_id !== s.lph_id || r.area_id !== null) continue
      if (r.role_rate_eur_per_hour > 0) soll += budget * r.share_pct / 100 / r.role_rate_eur_per_hour
    }
    sollByLph[s.lph_number] = soll
  }

  // IST: Mitarbeiterstunden je KW werden gleichmäßig auf die in dieser KW aktiven,
  // sichtbaren LPH-Balken verteilt (KW-genau). Datenbasis sind die bereits
  // geladenen Matrix-Allocations → IST bezieht sich auf das sichtbare Fenster.
  // Keine aktive LPH in einer KW → die Stunden dieser KW werden keiner LPH
  // zugeordnet (übersprungen). Summen-erhaltend: Σ Anteile = Wochenstunden.
  const istByLph: Record<number, number> = {}
  for (const w of windowWeeks) {
    const active = visibleSorted.filter(s =>
      s.start_kw != null && s.end_kw != null &&
      (s.plan_year == null || s.plan_year === w.year) &&
      w.week >= s.start_kw && w.week <= s.end_kw
    )
    if (active.length === 0) continue
    let totalW = 0
    for (const key in allocations) {
      const h = allocations[key]?.[w.week]?.hours
      if (h) totalW += h
    }
    if (totalW === 0) continue
    const share = totalW / active.length
    for (const s of active) istByLph[s.lph_number] = (istByLph[s.lph_number] ?? 0) + share
  }

  // Matrix-Speichern (6B-2D): Die Zelle ist projektbezogen (Mitarbeiter+Projekt+KW).
  // Die DB verlangt aber weiterhin allocations.lph_id NOT NULL mit UNIQUE(lph_id,
  // employee_id, calendar_week, year). Damit der projektbezogene Wochenwert OHNE
  // Doppelzählung gespeichert werden kann, wird eine deterministische Carrier-
  // Strategie genutzt: die gesamte Wochenstundenzahl liegt auf der aktiven LPH
  // (Carrier), alle anderen LPH-Zeilen dieser (Mitarbeiter,KW) werden auf 0 gesetzt.
  // Wichtig: Gespeichert wird über die ECHTE lph_id (UUID), nicht über den
  // synthetischen Client-Key.
  function commitEdit(empId: string, kw: number, value: string) {
    if (activeLph == null || !selectedProject) { setEditCell(null); return }
    const hours = Math.max(0, Math.min(60, parseFloat(value) || 0))
    const carrierKey = allocKey(empId, primaryLphId)
    setEditCell(null)

    // Andere LPH dieses Mitarbeiters/Projekts, die in dieser KW Stunden tragen.
    const otherLphNums = schedules
      .map(s => s.lph_number)
      .filter(n => n !== activeLph && getHours(empId, lphKey(n), kw) > 0)

    // Lokaler State: Carrier = volle Wochenstunden, alle anderen LPH = 0.
    setAllocations(prev => {
      const next: AllocMap = { ...prev }
      next[carrierKey] = { ...next[carrierKey], [kw]: { hours, source: 'Manuell_PL' } }
      for (const n of otherLphNums) {
        const k = allocKey(empId, lphKey(n))
        const prevSrc = next[k]?.[kw]?.source ?? 'Manuell_PL'
        next[k] = { ...next[k], [kw]: { hours: 0, source: prevSrc } }
      }
      return next
    })

    if (empId.startsWith('dummy-')) return
    if (!realLphId) return // ohne echte lph_id kein DB-Write möglich

    const carrierLphNum = activeLph
    const carrierRealId = realLphId
    const yr = yearOfWeek(kw)
    const project = selectedProject

    const applyBudget = (lphNum: number, res: { remaining_eur: number; utilization_pct: number } | null) => {
      if (!res) return
      setLphBudgets(prev => {
        const b = prev[lphNum]
        if (!b) return prev
        return { ...prev, [lphNum]: { ...b, remaining_eur: res.remaining_eur, utilization_pct: res.utilization_pct } }
      })
    }

    startTransition(async () => {
      try {
        // 1) Carrier-LPH = volle projektbezogene Wochenstunden.
        const result = await upsertAllocation(project.id, carrierRealId, empId, kw, yr, hours)
        applyBudget(carrierLphNum, result)
        // 2) Andere LPH dieser (Mitarbeiter,KW) auf 0 → keine Doppelzählung.
        for (const n of otherLphNums) {
          const realId = schedules.find(s => s.lph_number === n)?.lph_id
          if (!realId || realId === carrierRealId) continue
          const res2 = await upsertAllocation(project.id, realId, empId, kw, yr, 0)
          applyBudget(n, res2)
        }
      } catch (e) { console.error(e) }
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

      {/* ── Projekt-Auswahl + Kalkulationsprofil ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {projects.map(p => (
            <button key={p.id} onClick={() => handleProjectSelect(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${selectedProject?.id === p.id ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
              <span className="text-xs opacity-60 mr-1.5">{p.project_number}</span>{p.name}
            </button>
          ))}
        </div>

        {selectedProject && (
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="calc-profile" className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Kalkulationsprofil</label>
            <select id="calc-profile" value={currentProfile} disabled={profileSaving}
              onChange={e => handleProfileChange(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-slate-400 disabled:opacity-50">
              {CALC_PROFILES.map(p => (
                <option key={p} value={p}>{CALC_PROFILE_LABELS[p]}</option>
              ))}
            </select>
            {profileSaving && <span className="text-[10px] text-amber-500 animate-pulse">Speichern…</span>}
            {profileError && <span className="text-[10px] text-red-500" title={profileError}>Profil nicht gespeichert</span>}
            {currentProfile === 'TGA' && (
              <button onClick={() => setShowHoai(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors">
                <Calculator className="h-3.5 w-3.5" />HOAI-Rechner
              </button>
            )}
          </div>
        )}
      </div>

      {/* HOAI-Dummy-Rechner (A2): isoliertes, rein lokales Szenario-Fenster. */}
      {showHoai && selectedProject && (
        <HoaiCalculatorModal projectId={selectedProject.id} projectName={selectedProject.name} onClose={() => setShowHoai(false)} />
      )}

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

      {/* ── Rollenverteilung (Soll-Planung, 6B-2B) ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button onClick={() => setShowRolePlan(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50/60 transition-colors">
          <div className="flex items-center gap-2">
            <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${showRolePlan ? 'rotate-90' : ''}`} />
            <span className="text-sm font-semibold text-slate-700">Rollenverteilung</span>
            <span className="text-[11px] text-slate-400">
              {activeLph != null ? `LPH ${activeLph} · Soll-Planung` : 'Keine LPH gewählt'}
            </span>
          </div>
          {showRolePlan && realLphId && planRoles.length > 0 && (
            <span className={`text-[10px] font-medium tabular-nums ${rpSum === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
              Σ {rpSumRounded} %
            </span>
          )}
        </button>

        {showRolePlan && (
          <div className="px-5 pb-4 border-t border-slate-100">
            {activeLph == null || !realLphId ? (
              <p className="py-4 text-xs text-slate-400">Bitte zuerst eine Leistungsphase mit Budgetzeile wählen.</p>
            ) : (
              <div className="pt-3 space-y-3 max-w-md">
                {/* Bereich */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Bereich</label>
                  <select value={rpAreaId} onChange={e => { setRpAreaId(e.target.value); setRpSavedMsg(null) }}
                    className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 outline-none focus:border-slate-400">
                    <option value="">Gesamt / ohne Bereich</option>
                    {planAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>

                {/* Rollen */}
                {rpLoading ? (
                  <p className="text-xs text-slate-400 py-2">Laden…</p>
                ) : planRoles.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">Keine aktiven Planungsrollen. (TL legt sie über „Planungsrollen“ an.)</p>
                ) : (
                  <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                    {planRoles.map(r => (
                      <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="flex-1 text-sm text-slate-700">{r.name}</span>
                        <div className="flex items-center gap-1">
                          <input type="text" inputMode="decimal" value={rpShares[r.id] ?? ''}
                            onChange={e => { setRpShares(s => ({ ...s, [r.id]: e.target.value })); setRpSavedMsg(null) }}
                            placeholder="0"
                            className="w-16 text-sm text-right border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800 tabular-nums" />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50">
                      <span className="flex-1 text-xs font-semibold text-slate-500">Summe</span>
                      <span className={`text-xs font-semibold tabular-nums ${rpSum === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {rpSumRounded} %
                      </span>
                    </div>
                  </div>
                )}

                {planRoles.length > 0 && rpSum !== 100 && (
                  <p className="text-[11px] text-amber-600">Hinweis: Summe ist nicht 100 % — Speichern ist trotzdem möglich.</p>
                )}
                {rpError && <p className="text-[11px] text-red-500">{rpError}</p>}

                <div className="flex items-center gap-2">
                  <button onClick={handleSaveRolePlan} disabled={rpSaving || planRoles.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50">
                    {rpSaving ? 'Speichern…' : 'Speichern'}
                  </button>
                  {rpSavedMsg && <span className="text-[11px] text-emerald-600">{rpSavedMsg}</span>}
                </div>

                <p className="text-[10px] text-slate-400">
                  Soll-/Planungsmodell · keine echten Mitarbeiterzuweisungen, keine Mitarbeiter-Stundensätze.
                </p>

                {/* ── Soll-Rollenbedarf (read-only, 6B-2C) ── */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Soll-Rollenbedarf</p>
                    <span className="text-[10px] text-slate-400">
                      {lphWeeks ? `${lphWeeks} Wo` : 'kein Balken'} · {totalBudget > 0 ? fmtEur(totalBudget) : 'kein Budget'}
                    </span>
                  </div>

                  {totalBudget <= 0 ? (
                    <p className="text-[11px] text-slate-400 py-1">Kein LPH-Budget vorhanden.</p>
                  ) : sollRows.length === 0 ? (
                    <p className="text-[11px] text-slate-400 py-1">Noch keine Rollenverteilung gepflegt.</p>
                  ) : (
                    <>
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="flex items-center bg-slate-50 px-2.5 py-1 border-b border-slate-100 text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
                          <span className="flex-1">Rolle</span>
                          <span className="w-10 text-right">%</span>
                          <span className="w-14 text-right">€/h</span>
                          <span className="w-20 text-right">Budget</span>
                          <span className="w-14 text-right">Soll h</span>
                          <span className="w-16 text-right">h/Wo</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {sollRows.map((row) => (
                            <div key={row.id} className="flex items-center px-2.5 py-1 text-[11px] text-slate-700 tabular-nums">
                              <span className="flex-1 truncate">{row.name}</span>
                              <span className="w-10 text-right">{Math.round(row.pct * 10) / 10}</span>
                              {row.rate > 0 ? (
                                <>
                                  <span className="w-14 text-right">{fmtEur(row.rate)}</span>
                                  <span className="w-20 text-right">{fmtEur(row.rollenBudget)}</span>
                                  <span className="w-14 text-right">{row.sollStunden != null ? `${Math.round(row.sollStunden * 10) / 10} h` : '—'}</span>
                                  <span className="w-16 text-right">{row.hProWoche != null ? `${Math.round(row.hProWoche * 10) / 10} h` : '—'}</span>
                                </>
                              ) : (
                                <span className="flex-1 text-right text-amber-600">kein Planungssatz</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      {rpSum !== 100 && (
                        <p className="mt-1 text-[10px] text-amber-600">
                          Summe ist nicht 100 % — Rest ist unverplant bzw. überplant.
                        </p>
                      )}
                      {lphWeeks == null && (
                        <p className="mt-1 text-[10px] text-slate-400">
                          Kein Terminbalken gesetzt — „h/Wo" wird erst mit Balken berechnet.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
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
                      const busy = addingLph === n
                      return (
                        <label key={n}
                          className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm ${busy ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-slate-50'}`}>
                          <input type="checkbox" disabled={busy} checked={checked} onChange={() => toggleLph(n)}
                            className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                          <span className="font-semibold text-slate-700 shrink-0">LPH {n}</span>
                          <span className="text-xs text-slate-400 truncate">{LPH_LABELS[n]}</span>
                          {busy
                            ? <span className="ml-auto text-[9px] text-slate-400 shrink-0">anlegen…</span>
                            : !available && <span className="ml-auto text-[9px] text-amber-500 shrink-0">kein Budget</span>}
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
            {scheduleError && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-600 text-[10px] font-medium" title={scheduleError}>
                <X className="h-3 w-3" strokeWidth={3} />Terminplan nicht gespeichert
              </span>
            )}

            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium">H&I-Zone (nächste {H_I_WEEKS} Wo.)</span>
            <span className="flex items-center gap-1"><X className="h-3 w-3 text-red-600" strokeWidth={3} />Extern</span>
            <span className="flex items-center gap-1"><Circle className="h-3 w-3 text-blue-500 fill-blue-500" />Intern</span>
          </div>
        </div>

        <div className="overflow-x-auto" ref={scrollRef}>
          <div style={{ minWidth: `${EMP_COL + CAP_COL + windowWeeks.length * COL_WIDTH}px` }}>

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
                  {/* minHeight 28: gibt dem absolut positionierten GanttBar wieder eine
                      Box (sonst kollabiert flex-1 auf 0 → Balken unsichtbar). */}
                  <div className="flex-1 relative" style={{ minHeight: 28 }}>
                    <div className="absolute inset-0 flex pointer-events-none">
                      {windowWeeks.map((w, i) => (
                        <div key={i} style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                          className={hiKeys.has(weekKey(w)) ? 'bg-blue-50/40' : ''} />
                      ))}
                    </div>
                    <GanttBar
                      lphId={s.lph_id}
                      lphNumber={s.lph_number}
                      weeks={windowWeeks}
                      planYear={s.plan_year}
                      colWidth={COL_WIDTH}
                      startKw={s.start_kw}
                      endKw={s.end_kw}
                      color={color}
                      istHours={istByLph[s.lph_number] ?? 0}
                      sollHours={sollByLph[s.lph_number] ?? 0}
                      onChange={(id, start, end, planYear) => {
                        setSchedules(prev => prev.map(sc =>
                          sc.lph_id === id ? { ...sc, start_kw: start, end_kw: end, plan_year: planYear } : sc
                        ))
                        setSelectedLph(s.lph_number)
                      }}
                      onSave={(id, start, end, planYear) => persistSchedule(id, start, end, planYear)}
                    />
                    {/* Meilenstein-Marker dieser LPH-Zeile: rotes X an der jeweiligen KW,
                        unabhängig vom Terminbalken (auch ohne Balken sichtbar). Jahres-
                        wechsel-sicher: KW UND Jahr müssen zur Fensterspalte passen. */}
                    <div className="absolute inset-0 pointer-events-none">
                      {milestones.filter(m => m.lph_id === s.lph_id).map(m => {
                        const idx = windowWeeks.findIndex(w => w.week === m.kw && w.year === m.year)
                        if (idx < 0) return null
                        return (
                          <div key={m.id} style={{ left: idx * COL_WIDTH, width: COL_WIDTH }}
                            className="absolute top-0 bottom-0 flex items-center justify-center">
                            <span title={msTooltip(m)} className="pointer-events-auto cursor-help">
                              {m.type === 'external'
                                ? <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-1 ring-red-200 shadow-sm"><X className="h-2.5 w-2.5 text-red-600" strokeWidth={3} /></span>
                                : <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-1 ring-blue-200 shadow-sm"><Circle className="h-2 w-2 text-blue-500 fill-blue-500" /></span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* ── ANDERE GEWERKE (Terminplan-/Koordinationslayer, read-only) ── */}
            <div className="border-b border-slate-100">
              {/* Gruppenzeile */}
              <div className="flex items-center justify-between bg-slate-50/60 px-5 py-1.5"
                style={{ width: EMP_COL + CAP_COL + windowWeeks.length * COL_WIDTH }}>
                <button onClick={() => setShowExternalTrades(v => !v)}
                  className="flex items-center gap-1.5 group">
                  <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${showExternalTrades ? 'rotate-90' : ''}`} />
                  <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-800">Andere Gewerke</span>
                  <span className="text-[10px] text-slate-400 font-medium">{externalTrades.length}</span>
                </button>
                <div className="relative">
                  <button onClick={() => (showEtForm ? setShowEtForm(false) : openEtForm())}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-medium hover:bg-slate-50 transition-colors">
                    <Plus className="h-3 w-3" />Gewerk
                  </button>
                  {showEtForm && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowEtForm(false)} />
                      <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-white rounded-xl border border-slate-200 shadow-xl p-3">
                        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Fremdgewerk hinzufügen</p>
                        <div className="space-y-2.5 px-1">
                          <div>
                            <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Gewerk</label>
                            <input type="text" value={etName} onChange={e => setEtName(e.target.value)} placeholder="z. B. Architektur"
                              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800" />
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {TRADE_PRESETS.map(p => (
                                <button key={p} type="button" onClick={() => setEtName(p)}
                                  className="px-2 py-0.5 rounded-full border border-slate-200 text-[10px] text-slate-500 hover:bg-slate-50">
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Leistungsphase</label>
                            <select value={etLph ?? ''} onChange={e => setEtLph(Number(e.target.value))}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800 bg-white">
                              {ALL_LPH.map(n => (
                                <option key={n} value={n}>LPH {n}: {LPH_LABELS[n]}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Start</label>
                              <input type="date" value={etStart} onChange={e => setEtStart(e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800" />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Ende</label>
                              <input type="date" value={etEnd} onChange={e => setEtEnd(e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Notiz (optional)</label>
                            <input type="text" value={etNote} onChange={e => setEtNote(e.target.value)} placeholder="optional"
                              className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-slate-400 text-slate-800" />
                          </div>
                          {etError && <p className="text-[11px] text-red-500">{etError}</p>}
                          <button onClick={handleSaveExternalTrade} disabled={etSaving}
                            className="w-full py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50">
                            {etSaving ? 'Speichern…' : 'Gewerk speichern'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Fremdgewerk-Zeilen (aufgeklappt) */}
              {showExternalTrades && (
                externalTrades.length === 0 ? (
                  <div className="px-5 py-3 text-center text-[11px] text-slate-400">
                    Noch keine anderen Gewerke — über „+ Gewerk" hinzufügen.
                  </div>
                ) : externalTrades.map(t => {
                  const pos = externalBarPos(t)
                  return (
                    <div key={t.id} className="flex items-center border-t border-slate-50 hover:bg-slate-50/30">
                      {/* Label: Name + LPH-Badge + Löschen */}
                      <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-1.5 flex items-center gap-2 border-r border-slate-100">
                        <span className="text-xs font-medium text-slate-600 truncate">{t.trade_name}</span>
                        <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[9px] font-semibold">LPH {t.lph_number}</span>
                        <button onClick={() => handleDeleteExternalTrade(t.id)} disabled={deletingEtId === t.id}
                          title="Gewerk löschen"
                          className="shrink-0 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="border-r border-slate-100" />
                      {/* Read-only Balken auf der KW-Achse */}
                      <div className="flex-1 relative py-2">
                        <div className="absolute inset-0 flex pointer-events-none">
                          {windowWeeks.map((w, i) => (
                            <div key={i} style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                              className={hiKeys.has(weekKey(w)) ? 'bg-blue-50/40' : ''} />
                          ))}
                        </div>
                        {pos && (
                          <div style={{ left: pos.left, width: pos.width }}
                            title={externalTooltip(t)}
                            className="absolute top-1/2 -translate-y-1/2 h-4 rounded-md border border-dashed border-slate-400 bg-slate-200/60 flex items-center overflow-hidden cursor-help">
                            <span className="px-2 text-[10px] text-slate-500 truncate">{t.trade_name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* ── ZEITACHSEN-NAVIGATION (6B-0): direkt über der KW-Zeile, links am
                   Beginn des Zeitstrahls (nach Mitarbeiter-/Kap-Spalten). ── */}
            <div className="flex items-center bg-slate-50/70 border-b border-slate-100">
              <div style={{ width: EMP_COL + CAP_COL, minWidth: EMP_COL + CAP_COL }} className="border-r border-slate-100" />
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button onClick={goPrev} title="1 Monat zurück"
                  className="p-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button onClick={goToday} title="Aktuelles Fenster"
                  className="px-2 py-1 rounded-md border border-slate-200 bg-white text-[10px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Heute
                </button>
                <button onClick={goNext} title="1 Monat vor"
                  className="p-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <span className="ml-1.5 text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                  KW {windowWeeks[0]?.week}–{windowWeeks[windowWeeks.length - 1]?.week}
                  {windowWeeks[0] && windowWeeks[windowWeeks.length - 1] && windowWeeks[0].year !== windowWeeks[windowWeeks.length - 1].year
                    ? ` ${windowWeeks[0].year}/${windowWeeks[windowWeeks.length - 1].year}`
                    : ` ${windowWeeks[0]?.year}`}
                </span>
              </div>
            </div>

            {/* ── KW-HEADER ── */}
            <div className="flex bg-slate-50 border-b border-slate-200">
              <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-2 text-xs font-medium text-slate-500 border-r border-slate-100">Mitarbeiter</div>
              <div style={{ width: CAP_COL, minWidth: CAP_COL }} className="py-2 text-xs font-medium text-slate-400 text-center border-r border-slate-100">Kap/Wo</div>
              {windowWeeks.map((w) => {
                const inRange = isInRange(w)
                const isHI = hiKeys.has(weekKey(w))
                const isNow = w.isCurrent
                // Jahr nur an Jahresgrenzen (erste Spalte oder KW 1) anzeigen.
                const showYear = w.week === 1
                return (
                  <div key={weekKey(w)}
                    style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                    className={`py-1 text-center border-r border-slate-100 ${isHI ? 'bg-blue-50' : inRange ? 'bg-amber-50' : ''}`}>
                    <span className={`text-[10px] font-medium ${isNow ? 'text-blue-600 font-bold' : 'text-slate-500'}`}>
                      {isNow ? '▸' : ''}KW {w.week}
                    </span>
                    {showYear && <div className="text-[8px] text-slate-400 leading-none">{w.year}</div>}
                    {isHI && !showYear && <div className="text-[8px] text-blue-500 leading-none">H&I</div>}
                  </div>
                )
              })}
            </div>

            {/* ── MITARBEITER-ZEILEN ── */}
            {departments.map(dept => {
              const deptEmps = allEmployees.filter(e => e.department === dept)
              return [
                <div key={`dept-${dept}`} style={{ display: 'flex' }}>
                  <div style={{ width: EMP_COL + CAP_COL + windowWeeks.length * COL_WIDTH }}
                    className="px-5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                    {dept}
                  </div>
                </div>,
                ...deptEmps.map(emp => {
                  const isDummy = emp.id.startsWith('dummy-')
                  const empTotal = getEmpProjectTotal(emp.id)
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
                      {windowWeeks.map((w) => {
                        const kw = w.week
                        // Projektbezogen (LPH-unabhängig): Summe über alle LPH.
                        const hoursKw = getProjectHours(emp.id, kw)
                        const src = getProjectSource(emp.id, kw)
                        const isEditing = editCell?.empId === emp.id && editCell?.kw === kw
                        const inRange = isInRange(w)
                        const isHI = hiKeys.has(weekKey(w))
                        const loadPct = emp.weekly_capacity_hours > 0 ? hoursKw / emp.weekly_capacity_hours * 100 : 0
                        const cellBg = hoursKw === 0 ? '' : isDummy ? 'bg-slate-100 text-slate-500' : loadPct > 100 ? 'bg-red-50 text-red-600' : src === 'H&I' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                        const editable = activeLph != null

                        return (
                          <div key={weekKey(w)}
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
              {windowWeeks.map((w) => {
                const isHI = hiKeys.has(weekKey(w))
                const inRange = isInRange(w)
                return (
                  <div key={weekKey(w)} style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                    className={`text-center text-xs font-semibold text-slate-500 py-2.5 border-r border-slate-50 ${isHI ? 'bg-blue-50/40' : inRange ? 'bg-amber-50/50' : ''}`}>
                    {getKwProjectTotal(w.week) > 0 ? `${Math.round(getKwProjectTotal(w.week))}h` : '—'}
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
