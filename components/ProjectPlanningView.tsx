'use client'

import { useState, useTransition, useEffect, useRef, Fragment } from 'react'
import { TrendingDown, Users, Clock, Euro, Circle, ChevronRight, ChevronLeft, Plus, X, Calculator } from 'lucide-react'
import { upsertAllocation, getLphBudgetStatusById } from '@/app/actions/allocation'
import { loadProjectAllocationsForWindow } from '@/app/actions/heatmap'
import { loadTerminplan, saveLphSchedule, saveMilestone, ensureLphBudgetRow, type LphSchedule, type Milestone } from '@/app/actions/terminplan'
import { loadExternalTrades, createExternalTrade, deleteExternalTrade, type ExternalTrade } from '@/app/actions/external-trades'
import { loadPlanningRoles, type PlanningRole } from '@/app/actions/planning-roles'
import { loadLphRolePlan, saveLphRolePlan, loadProjectRolePlans, type LphRoleShare } from '@/app/actions/lph-role-plan'
import { loadProjectBudgetAreas, type BudgetArea } from '@/app/actions/budget-areas'
import { getDefaultGroupForLph, loadRolePlanDefaults, type RolePlanDefault } from '@/app/actions/role-plan-defaults'
import { groupKeyForLph, ROLE_PLAN_DEFAULT_GROUP_LABELS } from '@/lib/role-plan-defaults'
import { ALL_LPH, LPH_LABELS } from '@/lib/planning-phases'
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

// 9-KorrA: Kostengruppen/Anlagengruppen (HOAI/DIN 276, TGA) — nur Labels für die
// vorbereitete „Budget nach Anlagengruppen"-Karte. Noch KEINE Budgetdaten.
const ANLAGENGRUPPEN: { ag: number; label: string }[] = [
  { ag: 1, label: 'AG 1: Abwasser-, Wasser- und Gasanlagen' },
  { ag: 2, label: 'AG 2: Wärmeversorgungsanlagen' },
  { ag: 3, label: 'AG 3: Lufttechnische Anlagen' },
  { ag: 4, label: 'AG 4: Starkstromanlagen' },
  { ag: 5, label: 'AG 5: Fernmelde- und informationstechnische Anlagen' },
]
// Gewerk-Gruppierung für die „Sollstunden nach Gewerk"-Karte.
const GEWERK_GRUPPEN: { name: string; span: string }[] = [
  { name: 'HLKS', span: 'AG 1–3' },
  { name: 'Elektro', span: 'AG 4–5' },
]

// ── Haupt-Komponente ───────────────────────────────────────────────────────────

export default function ProjectPlanningView({ projects, employees, initialProjectId }: Props) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(
    projects.find(p => p.id === initialProjectId) ?? projects[0] ?? null
  )
  const [selectedLph, setSelectedLph] = useState<number | null>(null)
  const [visibleLph, setVisibleLph] = useState<Set<number>>(new Set())
  const [showLphPicker, setShowLphPicker] = useState(false)
  // 8E: Budgetstatus je LPH-Zeile bereichsstabil über die echte lph_id (UUID)
  // geschlüsselt — sonst überschreibt ELT LPH 5 den Status von HLKS LPH 5.
  const [lphBudgets, setLphBudgets] = useState<Record<string, LphBudget>>({})
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

  // 9-KorrA: Budgetquelle auf PROJEKTebene (statt Budgetbasis pro LPH). Im MVP
  // rein visuelle Auswahl: Abacus | HOAI-Rechner | Frei/manuell. calc_profile in
  // DB/Actions bleibt unberührt (wird hier nicht mehr angezeigt/geschrieben).
  const [budgetSource, setBudgetSource] = useState<'abacus' | 'hoai' | 'manual'>('abacus')
  const [showManualPlaceholder, setShowManualPlaceholder] = useState(false)

  // HOAI-Dummy-Rechner (A2) — rein lokales Szenario-Fenster, keine Persistenz.
  const [showHoai, setShowHoai] = useState(false)

  // Rollenverteilung je LPH (6B-2B) — reines Soll-/Planungsmodell.
  // KEINE Mitarbeiterzuweisung, kein allocations-Schreibpfad, keine Stundensaetze
  // von Mitarbeitenden. Nutzt die echte lph_id (UUID) der aktiven LPH-Zeile.
  // 7D: Rollenverteilung klappt direkt unter der jeweiligen LPH-Zeile auf.
  // Nur eine LPH gleichzeitig; immer an die aktive LPH gekoppelt.
  const [expandedLph, setExpandedLph] = useState<number | null>(null)
  const [planRoles, setPlanRoles] = useState<PlanningRole[]>([])
  const [planAreas, setPlanAreas] = useState<BudgetArea[]>([])
  // Alle Rollenverteilungen des Projekts (für SOLL-Stunden je LPH-Balken, 6B-2D).
  const [rolePlans, setRolePlans] = useState<LphRoleShare[]>([])
  // 7C Fix A: globale Default-Rollenverteilungen (Fallback für SOLL, wenn eine
  // LPH noch keine eigene Verteilung hat). Reine Vorlagen, keine allocations.
  const [rolePlanDefaults, setRolePlanDefaults] = useState<RolePlanDefault[]>([])
  const [rpAreaId, setRpAreaId] = useState<string>('') // '' = Gesamt / ohne Bereich
  const [rpShares, setRpShares] = useState<Record<string, string>>({}) // roleId -> %-String
  const [rpLoading, setRpLoading] = useState(false)
  const [rpSaving, setRpSaving] = useState(false)
  const [rpError, setRpError] = useState<string | null>(null)
  const [rpSavedMsg, setRpSavedMsg] = useState<string | null>(null)
  // 7C: „Default anwenden" — uebernimmt die Default-Vorlage in die aktive LPH.
  const [rpApplying, setRpApplying] = useState(false)

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

  // Budgetstatus je LPH-Zeile EINDEUTIG über ihre lph_id (Paket 8D) statt über
  // (project_id, lph_number) — letzteres wäre bei künftigen HLKS/ELT-Bereichszeilen
  // mehrdeutig. Quelle der lph_ids sind die geladenen Terminplan-Schedules.
  // Schlägt der id-basierte RPC fehl (z. B. Patch 8C noch nicht ausgeführt), wird
  // die betroffene LPH einfach übersprungen (try/catch) — kein Crash.
  // 8E: Keying per lph_id (UUID) — bereichsstabil über alle Bereiche eines
  // Projekts. Geladen werden ALLE LPH-Zeilen (alle Bereiche), damit die
  // Projektbudgetkarte projektweit summieren kann.
  async function fetchLphBudgets(schedules: LphSchedule[]): Promise<Record<string, LphBudget>> {
    const map: Record<string, LphBudget> = {}
    for (const s of schedules) {
      try { const b = await getLphBudgetStatusById(s.lph_id); if (b) map[s.lph_id] = b } catch {}
    }
    return map
  }

  async function fetchAllocations(project: Project): Promise<{ map: AllocMap; lphWithHours: Set<number> }> {
    const data = await loadProjectAllocationsForWindow(project.id, windowWeeks.map(w => ({ year: w.year, week: w.week })))
    const map: AllocMap = {}
    const lphWithHours = new Set<number>()
    for (const a of data) {
      // 8E: bereichsstabiler Key über die echte lph_id (UUID) statt synthetischer
      // (project,lph_number)-Key. lphWithHours bleibt nummernbasiert (Default-Sicht).
      const key = `${a.employee_id}_${a.lph_id}`
      if (!map[key]) map[key] = {}
      map[key][a.calendar_week] = { hours: a.allocated_hours, source: a.source as 'H&I' | 'Manuell_PL' }
      if (a.allocated_hours > 0) lphWithHours.add(a.lph_number)
    }
    return { map, lphWithHours }
  }

  async function loadAll(project: Project) {
    try {
      const [alloc, term, rolePlansRes] = await Promise.all([
        fetchAllocations(project),
        loadTerminplan(project.id),
        loadProjectRolePlans(project.id),
      ])
      // Budgetstatus erst nach dem Terminplan: braucht die lph_ids der Schedules
      // (id-basierter RPC, Paket 8D).
      const budgets = await fetchLphBudgets(term.schedules)
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
          const key = `${a.employee_id}_${a.lph_id}`
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

  // ── Abgeleitete Werte ────────────────────────────────────────────────────────

  // 9-KorrA: Bereichsumschalter (Gesamt/HLKS/ELT) entfernt. Die Projektplanung
  // läuft wieder bereichslos über die Standard-/Abacus-Zeilen (area_id = null).
  // area_id bleibt in der DB erhalten; künftige Struktur kommt über Anlagengruppen.
  const effectiveAreaId: string | null = null
  const areaSchedules = schedules.filter(s => (s.area_id ?? null) === effectiveAreaId)

  // Verfügbare (budgetierte) LPH dieses Bereichs = solche mit project_lph_budgets-Zeile.
  const availableLph = new Set(areaSchedules.map(s => s.lph_number))
  const visibleSorted = areaSchedules
    .filter(s => visibleLph.has(s.lph_number))
    .sort((a, b) => a.lph_number - b.lph_number)

  // Effektiv aktive LPH (fällt auf erste sichtbare zurück, falls Auswahl im
  // aktuellen Bereich nicht existiert oder ausgeblendet ist).
  const activeLph = (selectedLph != null && visibleLph.has(selectedLph) && availableLph.has(selectedLph))
    ? selectedLph
    : (visibleSorted[0]?.lph_number ?? null)
  const activeSchedule = activeLph != null ? areaSchedules.find(s => s.lph_number === activeLph) ?? null : null
  // Echte LPH-UUID (aus project_lph_budgets) — Pflicht fuer lph_role_plan, Gantt,
  // Meilensteine, Budgetstatus und Matrix-Carrier. Trägt implizit den Bereich.
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

  // 7C Fix A: globale Default-Verteilungen einmalig laden (Fallback für SOLL).
  useEffect(() => {
    let cancelled = false
    loadRolePlanDefaults()
      .then(res => { if (!cancelled) setRolePlanDefaults(res.success ? res.data : []) })
      .catch(() => { if (!cancelled) setRolePlanDefaults([]) })
    return () => { cancelled = true }
  }, [])

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

  // 7C: Default-Vorlage der passenden LPH-Gruppe in die aktive LPH uebernehmen
  // UND speichern (ueber das bestehende saveLphRolePlan). Erzeugt KEINE
  // Mitarbeiterzuweisungen und schreibt NICHT in allocations.
  async function handleApplyDefault() {
    if (!realLphId || activeLph == null) return
    setRpApplying(true); setRpError(null); setRpSavedMsg(null)
    try {
      const def = await getDefaultGroupForLph(activeLph)
      if (!def.success) { setRpError(def.message || 'Default konnte nicht geladen werden'); return }
      const defMap = new Map(def.data.map(d => [d.role_id, d.share_pct]))
      // Jede aktive Rolle bekommt ihren Default-Anteil (fehlt einer -> 0).
      const shares = planRoles.map(r => ({ roleId: r.id, sharePct: defMap.get(r.id) ?? 0 }))
      const res = await saveLphRolePlan(realLphId, rpAreaId || null, shares)
      if (!res.success) { setRpError(res.message || 'Speichern fehlgeschlagen'); return }
      const m: Record<string, string> = {}
      for (const s of res.data) m[s.role_id] = String(s.share_pct)
      setRpShares(m)
      setRpSavedMsg('Default angewendet')
      // Projekt-Rollenverteilungen neu laden -> LPH-Balken-SOLL aktualisiert sich.
      if (selectedProject) {
        try {
          const rp = await loadProjectRolePlans(selectedProject.id)
          if (rp.success) setRolePlans(rp.data)
        } catch { /* Balken-SOLL bleibt bis Reload auf altem Stand */ }
      }
    } catch (e) {
      setRpError(e instanceof Error ? e.message : 'Default konnte nicht angewendet werden')
    } finally {
      setRpApplying(false)
    }
  }

  const rpSum = planRoles.reduce((a, r) => a + parseSharePct(rpShares[r.id]), 0)
  const rpSumRounded = Math.round(rpSum * 10) / 10

  async function toggleLph(n: number) {
    // 8E: zuerst BEREICHSBEZOGEN prüfen, ob die LPH-Zeile im aktuellen Bereich
    // existiert (availableLph ist bereichsgefiltert). So meint "LPH 5 anzeigen"
    // auf dem ELT-Tab niemals die HLKS-Zeile.
    if (availableLph.has(n)) {
      // Nur clientseitig ein-/ausblenden — KEINE DB-Zeile / Allocations /
      // Meilensteine / Terminbalken löschen.
      if (visibleLph.has(n)) {
        setVisibleLph(prev => { const next = new Set(prev); next.delete(n); return next })
      } else {
        setVisibleLph(prev => new Set(prev).add(n))
        setSelectedLph(n)
      }
      return
    }
    // LPH ohne Budget: idempotent eine 0-Euro-Zeile anlegen, dann einblenden.
    // 9-KorrA: bereichslos (effectiveAreaId = null) — kein Bereichsumschalter mehr.
    if (!selectedProject || addingLph != null) return
    setAddingLph(n)
    try {
      const res = await ensureLphBudgetRow(selectedProject.id, n, effectiveAreaId)
      if (!res.success || !res.row) { console.error('ensureLphBudgetRow:', res.message); return }
      const row = res.row
      // Upsert in den lokalen State über (lph_number UND area_id) — niemals eine
      // gleichnamige LPH eines anderen Bereichs überschreiben.
      setSchedules(prev => prev.some(s => s.lph_number === row.lph_number && (s.area_id ?? null) === (row.area_id ?? null))
        ? prev.map(s => (s.lph_number === row.lph_number && (s.area_id ?? null) === (row.area_id ?? null) ? row : s))
        : [...prev, row])
      setVisibleLph(prev => new Set(prev).add(n))
      setSelectedLph(n)
      // Budgetstatus nachladen (für „Verplante Stunden" / spätere Allocations) —
      // eindeutig über die neue lph_id der gerade sichergestellten Zeile (Paket 8D).
      try {
        const b = await getLphBudgetStatusById(row.lph_id)
        if (b) setLphBudgets(prev => ({ ...prev, [row.lph_id]: b }))
      } catch { /* 0-Euro-LPH oder Patch 8C noch nicht ausgeführt: Budgetkarte greift auf totalBudget>0-Guard zurück */ }
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
    // Nur LPH-Zeilen des aktiven Bereichs — Meilenstein hängt an genau dieser lph_id.
    const sorted = [...areaSchedules].sort((a, b) => a.lph_number - b.lph_number)
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
    const sched = areaSchedules.find(s => s.lph_number === msLph)
    if (!sched) { setMsError('LPH ohne Budget'); return }   // nur LPH mit vorhandener lph_id (im aktiven Bereich)
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

  // ── Projektbezogene Matrix (6B-2D) ──────────────────────────────────────────
  // Die Matrix-Zelle bedeutet MITARBEITER + PROJEKT + KW (LPH-unabhängig): Summe
  // der Stunden über ALLE LPH dieses Projekts (alle Bereiche). Dadurch ändert sich
  // der Wert NICHT, wenn links eine andere LPH/ein anderer Bereich gewählt wird.
  // 8E: Summiert über die echten lph_id (UUID) je Zeile — bereichsstabil und ohne
  // Doppelzählung, auch wenn HLKS LPH 5 und ELT LPH 5 beide existieren.
  function getProjectHours(empId: string, kw: number) {
    return schedules.reduce((s, sc) => s + getHours(empId, sc.lph_id, kw), 0)
  }
  // Repräsentative Quelle für die Zellfarbe: Manuell hat Vorrang vor H&I.
  function getProjectSource(empId: string, kw: number): 'H&I' | 'Manuell_PL' | undefined {
    let hasHI = false, hasManual = false
    for (const sc of schedules) {
      if (getHours(empId, sc.lph_id, kw) <= 0) continue
      const src = getSource(empId, sc.lph_id, kw)
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

  const activeBudget = realLphId ? lphBudgets[realLphId] : undefined
  const totalBudget = activeBudget?.budget_eur ?? 0
  const totalAllocated = activeBudget?.allocated_eur ?? 0
  const totalHours = activeBudget?.total_hours ?? 0
  const utilizationPct = totalBudget > 0 ? Math.min(100, Math.round(totalAllocated / totalBudget * 100)) : 0
  const progressColor = utilizationPct > 85 ? 'bg-red-400' : utilizationPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'

  // ── Projektgesamtbudget (8A) ────────────────────────────────────────────────
  // Die obere Budgetkarte ist PROJEKTBEZOGEN, nicht LPH-bezogen:
  //   budget    = Σ project_lph_budgets.budget_eur  (alle geladenen LPH des Projekts)
  //   verbraucht = Σ allocated_eur                  (je LPH aus getLphBudgetStatus-RPC)
  // Beide Summen stammen aus bereits geladenen LPH-Budgetstatuswerten (lphBudgets).
  // Die Carrier-Strategie beim Matrix-Speichern hält die Stunden je (MA,KW) auf genau
  // EINER LPH-Zeile (alle anderen 0) → die LPH-allocated_eur summieren sich ohne
  // Doppelzählung zum projektweiten Verbrauch. Kein HLKS/ELT-Datenmodell hier (folgt 8B).
  const projectBudgetTotal = Object.values(lphBudgets).reduce((s, b) => s + (b.budget_eur ?? 0), 0)
  const projectAllocatedTotal = Object.values(lphBudgets).reduce((s, b) => s + (b.allocated_eur ?? 0), 0)
  const projectRemaining = projectBudgetTotal - projectAllocatedTotal
  const projectUtilizationPct = projectBudgetTotal > 0 ? Math.min(100, Math.round(projectAllocatedTotal / projectBudgetTotal * 100)) : 0
  const projectProgressColor = projectUtilizationPct > 85 ? 'bg-red-400' : projectUtilizationPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'

  // 9-KorrA: Hover-Tooltip eines LPH-Balkens. SOLL kommt wieder aus der zentralen
  // Abacus-/Projektbudgetlogik (Budgetbasis pro LPH wurde entfernt). Ohne wirksames
  // Sollbudget steht "kein Sollbudget" statt 0h.
  function barTooltip(lphNumber: number, ist: number, soll: number, hasBudget: boolean): string {
    const sollPart = hasBudget ? `SOLL ${Math.round(soll)}h` : 'kein Sollbudget'
    return `LPH ${lphNumber} · IST ${Math.round(ist)}h · ${sollPart}`
  }

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

  // ── Default-Fallback (7C Fix A) ─────────────────────────────────────────────
  // Default-Prozente je Gruppe (lph_1_5 / lph_6_7 / lph_8_9) -> roleId -> pct.
  const defaultPctByGroup: Record<string, Map<string, number>> = {}
  for (const d of rolePlanDefaults) {
    if (d.share_pct <= 0) continue
    ;(defaultPctByGroup[d.group_key] ??= new Map()).set(d.role_id, d.share_pct)
  }
  // Planungssatz je Rolle (für die Soll-Umrechnung der Defaults).
  const roleRateById = new Map(planRoles.map(r => [r.id, r.rate_eur_per_hour]))

  // Aktive LPH: hat sie eine EIGENE Verteilung (>0 %) für den aktuellen Bereich?
  const rpHasOwn = planRoles.some(r => parseSharePct(rpShares[r.id]) > 0)
  const activeGroupKey = activeLph != null ? groupKeyForLph(activeLph) : null
  const activeDefaultPct = activeGroupKey ? defaultPctByGroup[activeGroupKey] : undefined
  // Fallback greift nur, wenn keine eigene Verteilung existiert UND ein Default da ist.
  const usingDefaultForActive = !rpHasOwn && !!activeDefaultPct && activeDefaultPct.size > 0

  const sollRows = planRoles
    .map((r) => {
      const pct = usingDefaultForActive
        ? (activeDefaultPct!.get(r.id) ?? 0)
        : parseSharePct(rpShares[r.id])
      // 9-KorrA: SOLL wieder aus dem zentralen Abacus-/Projekt-LPH-Budget.
      const rollenBudget = totalBudget * pct / 100
      const rate = r.rate_eur_per_hour
      const sollStunden = rate > 0 ? rollenBudget / rate : null
      const hProWoche = sollStunden != null && lphWeeks && lphWeeks > 0 ? sollStunden / lphWeeks : null
      return { id: r.id, name: r.name, pct, rate, rollenBudget, sollStunden, hProWoche }
    })
    .filter((row) => row.pct > 0)

  // ── IST/SOLL je LPH für die Balkenbeschriftung (6B-2D + 7C Fix A) ───────────
  // SOLL: budget_lph × Σ(share_pct/100 ÷ rate). Bevorzugt die EIGENE Gesamt-
  // Rollenverteilung (area_id = null, share>0). Hat eine LPH keine eigene
  // Verteilung, wird die passende DEFAULT-Gruppe als Fallback genutzt. rate ≤ 0
  // → Rolle trägt 0 bei (sauber abgefangen).
  // 8E: per lph_id geschlüsselt (bereichsstabil). budget kommt aus dem id-basierten
  // Budgetstatus dieser konkreten LPH-Zeile.
  const sollByLph: Record<string, number> = {}
  for (const s of schedules) {
    // 9-KorrA: Budget wieder aus dem zentralen Abacus-/Projekt-LPH-Budget.
    const budget = lphBudgets[s.lph_id]?.budget_eur ?? s.budget_eur ?? 0
    if (budget <= 0) continue
    let soll = 0
    const own = rolePlans.filter(r => r.lph_id === s.lph_id && r.area_id === null && r.share_pct > 0)
    if (own.length > 0) {
      for (const r of own) {
        if (r.role_rate_eur_per_hour > 0) soll += budget * r.share_pct / 100 / r.role_rate_eur_per_hour
      }
    } else {
      const grp = groupKeyForLph(s.lph_number)
      const defs = grp ? defaultPctByGroup[grp] : undefined
      if (defs) {
        for (const [roleId, pct] of defs) {
          const rate = roleRateById.get(roleId) ?? 0
          if (rate > 0) soll += budget * pct / 100 / rate
        }
      }
    }
    sollByLph[s.lph_id] = soll
  }

  // IST: Mitarbeiterstunden je KW werden gleichmäßig auf die in dieser KW aktiven,
  // sichtbaren LPH-Balken verteilt (KW-genau). Datenbasis sind die bereits
  // geladenen Matrix-Allocations → IST bezieht sich auf das sichtbare Fenster.
  // Keine aktive LPH in einer KW → die Stunden dieser KW werden keiner LPH
  // zugeordnet (übersprungen). Summen-erhaltend: Σ Anteile = Wochenstunden.
  // 8E: per lph_id geschlüsselt. „active" sind die sichtbaren Balken des aktiven
  // Bereichs (visibleSorted ist bereits bereichsgefiltert).
  const istByLph: Record<string, number> = {}
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
    for (const s of active) istByLph[s.lph_id] = (istByLph[s.lph_id] ?? 0) + share
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
    if (activeLph == null || !selectedProject || !realLphId) { setEditCell(null); return }
    const hours = Math.max(0, Math.min(60, parseFloat(value) || 0))
    const carrierRealId = realLphId // aktive LPH-Zeile (trägt implizit den Bereich)
    const carrierKey = allocKey(empId, carrierRealId)
    setEditCell(null)

    // 8E: Carrier-Strategie projektweit über echte lph_id (alle Bereiche). Andere
    // LPH-Zeilen dieses (Mitarbeiter,KW), die Stunden tragen, werden auf 0 gesetzt
    // → keine Doppelzählung im projektbezogenen Matrix-Wert.
    const otherLphIds = schedules
      .map(s => s.lph_id)
      .filter(id => id !== carrierRealId && getHours(empId, id, kw) > 0)

    // Lokaler State: Carrier = volle Wochenstunden, alle anderen LPH = 0.
    setAllocations(prev => {
      const next: AllocMap = { ...prev }
      next[carrierKey] = { ...next[carrierKey], [kw]: { hours, source: 'Manuell_PL' } }
      for (const id of otherLphIds) {
        const k = allocKey(empId, id)
        const prevSrc = next[k]?.[kw]?.source ?? 'Manuell_PL'
        next[k] = { ...next[k], [kw]: { hours: 0, source: prevSrc } }
      }
      return next
    })

    if (empId.startsWith('dummy-')) return

    const yr = yearOfWeek(kw)
    const project = selectedProject

    const applyBudget = (lphId: string, res: { remaining_eur: number; utilization_pct: number } | null) => {
      if (!res) return
      setLphBudgets(prev => {
        const b = prev[lphId]
        if (!b) return prev
        return { ...prev, [lphId]: { ...b, remaining_eur: res.remaining_eur, utilization_pct: res.utilization_pct } }
      })
    }

    startTransition(async () => {
      try {
        // 1) Carrier-LPH = volle projektbezogene Wochenstunden.
        const result = await upsertAllocation(project.id, carrierRealId, empId, kw, yr, hours)
        applyBudget(carrierRealId, result)
        // 2) Andere LPH dieser (Mitarbeiter,KW) auf 0 → keine Doppelzählung.
        for (const id of otherLphIds) {
          if (id === carrierRealId) continue
          const res2 = await upsertAllocation(project.id, id, empId, kw, yr, 0)
          applyBudget(id, res2)
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

  // 7D: Inline-Rollenverteilung direkt unter der aktiven LPH-Zeile.
  // Links: Prozentfelder (editierbar) · rechts: Soll-Rollenbedarf (read-only).
  // Nutzt unveraendert realLphId/rpShares/sollRows/handleSaveRolePlan (aktive LPH).
  function renderRolePanel() {
    return (
      <div className="border-b border-slate-100 bg-slate-50/50"
        style={{ width: EMP_COL + CAP_COL + windowWeeks.length * COL_WIDTH }}>
        {activeLph == null || !realLphId ? (
          <p className="px-5 py-4 text-xs text-slate-400">Bitte zuerst eine Leistungsphase mit Budgetzeile wählen.</p>
        ) : (
          <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

            {/* ── LINKS: Rollenverteilung (Prozente, editierbar) ── */}
            <div className="space-y-3 max-w-md">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Rollenverteilung · LPH {activeLph}</p>
                {realLphId && planRoles.length > 0 && (
                  <span className={`text-[10px] font-medium tabular-nums ${rpSum === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    Σ {rpSumRounded} %
                  </span>
                )}
              </div>

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
                <p className="text-xs text-slate-400 py-2">Keine aktiven Planungsrollen. (TL legt sie über „Mitarbeiterrollen“ an.)</p>
              ) : (
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
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

              {usingDefaultForActive && (
                <p className="text-[11px] text-blue-600 bg-blue-50 border border-blue-100 rounded-md px-2 py-1.5">
                  Default-Verteilung wird für die Soll-Berechnung verwendet
                  {activeGroupKey ? ` (${ROLE_PLAN_DEFAULT_GROUP_LABELS[activeGroupKey]})` : ''}.
                  Mit „Default anwenden" dauerhaft in diese LPH übernehmen.
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleSaveRolePlan} disabled={rpSaving || rpApplying || planRoles.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50">
                  {rpSaving ? 'Speichern…' : 'Speichern'}
                </button>
                {activeLph != null && groupKeyForLph(activeLph) && (
                  <button onClick={handleApplyDefault} disabled={rpSaving || rpApplying || planRoles.length === 0}
                    title={`Default-Vorlage „${ROLE_PLAN_DEFAULT_GROUP_LABELS[groupKeyForLph(activeLph)!]}" übernehmen`}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50">
                    {rpApplying ? 'Anwenden…' : 'Default anwenden'}
                  </button>
                )}
                {rpSavedMsg && <span className="text-[11px] text-emerald-600">{rpSavedMsg}</span>}
              </div>

              <p className="text-[10px] text-slate-400">
                Soll-/Planungsmodell · keine echten Mitarbeiterzuweisungen, keine Mitarbeiter-Stundensätze.
              </p>
            </div>

            {/* ── RECHTS: Soll-Rollenbedarf (read-only) ── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Soll-Rollenbedarf</p>
                <span className="text-[10px] text-slate-400">
                  {lphWeeks ? `${lphWeeks} Wo` : 'kein Balken'} · {totalBudget > 0 ? fmtEur(totalBudget) : 'kein Budget'}
                </span>
              </div>

              {totalBudget <= 0 ? (
                <p className="text-[11px] text-slate-400 py-1">Für diese LPH ist kein wirksames Sollbudget hinterlegt.</p>
              ) : sollRows.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-1">Noch keine Rollenverteilung gepflegt.</p>
              ) : (
                <>
                  <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
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
    )
  }

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
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* 9-KorrA: Budgetquelle auf Projektebene (ersetzt Kalkulationsprofil). */}
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Budgetquelle</span>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
              <button onClick={() => setBudgetSource('abacus')}
                title="Abacus-Budget aus dem Import verwenden"
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${budgetSource === 'abacus' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                Abacus
              </button>
              <button onClick={() => { setBudgetSource('hoai'); setShowHoai(true) }}
                title="HOAI-Rechner (Dummy/Schätzung) öffnen"
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${budgetSource === 'hoai' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                <Calculator className="h-3.5 w-3.5" />HOAI-Rechner
              </button>
              <button onClick={() => { setBudgetSource('manual'); setShowManualPlaceholder(true) }}
                title="Freie / manuelle Budgeteingabe"
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${budgetSource === 'manual' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                Frei / manuell
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HOAI-Dummy-Rechner (A2): isoliertes, rein lokales Szenario-Fenster. */}
      {showHoai && selectedProject && (
        <HoaiCalculatorModal projectId={selectedProject.id} projectName={selectedProject.name} onClose={() => setShowHoai(false)} />
      )}

      {/* 9-KorrA: Platzhalter für freie/manuelle Budgeteingabe (folgt im nächsten Paket). */}
      {showManualPlaceholder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setShowManualPlaceholder(false)} />
          <div className="relative z-10 w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-700">Frei / manuell</p>
              <button onClick={() => setShowManualPlaceholder(false)} className="text-slate-300 hover:text-slate-600 transition-colors" title="Schließen">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">Manuelle Budgeteingabe folgt im nächsten Paket.</p>
          </div>
        </div>
      )}

      {/* ── Budget-Karten (aktive LPH) ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2"><Euro className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Projektbudget verbleibend</p></div>
          {projectBudgetTotal > 0 ? (
            <>
              <p className="text-xl font-semibold text-slate-800">{fmtEur(projectRemaining)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{fmtEur(projectAllocatedTotal)} von {fmtEur(projectBudgetTotal)}</p>
              <div className="mt-2.5 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${projectProgressColor}`} style={{ width: `${projectUtilizationPct}%` }} /></div>
              <p className="text-[10px] text-slate-400 mt-1">{projectUtilizationPct}% ausgeschöpft · Verbrauch aus vorhandenen LPH-Budgetstatuswerten</p>
            </>
          ) : <p className="text-slate-300 text-sm mt-1">{selectedProject != null ? 'Kein Budget' : 'Projekt wählen'}</p>}
        </div>
        {/* 9-KorrA: Mittlere Karte fachlich vorbereitet — Budget je Anlagengruppe
            (AG 1–5). Noch KEINE AG-Budgetdaten -> Beträge als „—". */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2"><Euro className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Budget nach Anlagengruppen</p></div>
          <div className="space-y-1">
            {ANLAGENGRUPPEN.map(g => (
              <div key={g.ag} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 truncate" title={g.label}>{g.label}</span>
                <span className="text-[11px] font-medium text-slate-300 tabular-nums shrink-0">—</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">Noch keine AG-Budgetdaten hinterlegt.</p>
        </div>
        {/* 9-KorrA: Rechte Karte fachlich vorbereitet — Sollstunden je Gewerk
            (HLKS = AG 1–3, Elektro = AG 4–5). Noch KEINE Berechnung -> „— h". */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2"><Clock className="h-3.5 w-3.5 text-slate-300" /><p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Sollstunden nach Gewerk</p></div>
          <div className="space-y-1.5">
            {GEWERK_GRUPPEN.map(g => (
              <div key={g.name} className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-600">{g.name} <span className="text-[10px] text-slate-400">· {g.span}</span></span>
                <span className="text-base font-semibold text-slate-300 tabular-nums">— h</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">Gewerk-Sollstunden folgen in einem separaten Paket.</p>
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
                    <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      Leistungsphasen anzeigen
                    </p>
                    {ALL_LPH.map(n => {
                      const available = availableLph.has(n)
                      // checked nur, wenn die Zeile im AKTUELLEN Bereich existiert und sichtbar ist.
                      const checked = available && visibleLph.has(n)
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
                            {[...areaSchedules].sort((a, b) => a.lph_number - b.lph_number).map(s => (
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
            {/* 9-KorrA: Team-/N.N.-Umschalter (zuvor in der entfernten Team-Karte). */}
            <span className="flex items-center gap-1.5">
              <Users className="h-3 w-3 text-slate-300" />{employees.length} + {DUMMY_EMPLOYEES.length} N.N.
              <button onClick={() => setShowDummies(v => !v)} className="text-[10px] text-slate-400 hover:text-slate-600 underline underline-offset-2">{showDummies ? 'ausbl.' : 'einbl.'}</button>
            </span>
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
              const isExpanded = isSel && expandedLph === s.lph_number
              const color = lphColor(s.lph_number)
              // 9-KorrA: wirksames Sollbudget = zentrales Abacus-/Projekt-LPH-Budget > 0.
              const barHasBudget = (lphBudgets[s.lph_id]?.budget_eur ?? s.budget_eur ?? 0) > 0
              const barIst = istByLph[s.lph_id] ?? 0
              const barSoll = sollByLph[s.lph_id] ?? 0
              return (
                <Fragment key={s.lph_id}>
                <div
                  className={`flex items-center border-b border-slate-100 cursor-pointer ${isSel ? 'bg-slate-50' : ''}`}
                  onClick={() => { setSelectedLph(s.lph_number); setExpandedLph(cur => cur === s.lph_number ? cur : null) }}>
                  <div style={{ width: EMP_COL, minWidth: EMP_COL }} className="px-5 py-1.5 flex items-center gap-2 border-r border-slate-100">
                    {/* 7D: Chevron klappt die Rollenverteilung dieser LPH auf/zu. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedLph(s.lph_number); setExpandedLph(cur => cur === s.lph_number ? null : s.lph_number) }}
                      title="Rollenverteilung"
                      className="shrink-0 -ml-1 p-0.5 rounded hover:bg-slate-200/70 transition-colors">
                      <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>
                    <div className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
                    <p className="text-xs font-semibold text-slate-700 shrink-0">LPH {s.lph_number}</p>
                    <p className="text-[10px] text-slate-400 truncate">{LPH_LABELS[s.lph_number]}</p>
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
                      istHours={barIst}
                      sollHours={barSoll}
                      hasSollBudget={barHasBudget}
                      tooltip={barTooltip(s.lph_number, barIst, barSoll, barHasBudget)}
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
                {/* 7D: Rollenverteilung direkt unter der aufgeklappten LPH-Zeile. */}
                {isExpanded && renderRolePanel()}
                </Fragment>
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

            {/* Dezenter Hilfetext: Matrix ist projektbezogen, LPH-Auswertung rechnerisch (6B-2D). */}
            <div className="px-5 py-1.5 bg-slate-50/60 border-b border-slate-100">
              <p className="text-[10px] text-slate-400">
                Projektstunden je KW · LPH-Auswertung erfolgt über Balkenlage. Die aktive LPH filtert die Matrix nicht.
              </p>
            </div>

            {/* ── KW-HEADER ── */}
            <div className="flex bg-slate-50 border-b border-slate-200">
              <div style={{ width: EMP_COL, minWidth: EMP_COL }}
                title="Diese Stunden gelten für das Projekt und werden nicht durch die aktive LPH gefiltert."
                className="px-5 py-2 text-xs font-medium text-slate-500 border-r border-slate-100 cursor-help">Mitarbeiter</div>
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
