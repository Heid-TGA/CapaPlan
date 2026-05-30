'use client'

import { useState, useEffect } from 'react'
import { X, Flag, Circle, Plus, Trash2, Save, CalendarDays, Loader2 } from 'lucide-react'
import {
  loadTerminplan,
  saveLphSchedule,
  saveMilestone,
  deleteMilestone,
  type LphSchedule,
  type Milestone,
} from '@/app/actions/terminplan'
import { currentIsoWeek, addWeeks, buildWeekWindow } from '@/lib/calendar-weeks'

const PLANNING_PHASES = [
  { key: 'basic',       label: 'Basic Design',  lph: [1, 2, 3, 4] },
  { key: 'detail',      label: 'Detail Design', lph: [5, 6, 7] },
  { key: 'ausfuehrung', label: 'Ausführung',    lph: [8] },
] as const

const PHASE_COLORS: Record<string, string> = {
  basic:       'bg-violet-400',
  detail:      'bg-blue-400',
  ausfuehrung: 'bg-emerald-400',
}

const PHASE_LIGHT: Record<string, string> = {
  basic:       'bg-violet-50 border-violet-200',
  detail:      'bg-blue-50 border-blue-200',
  ausfuehrung: 'bg-emerald-50 border-emerald-200',
}

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
  onSaved: (schedules: LphSchedule[], milestones: Milestone[]) => void
}

interface NewMilestone {
  lphId: string
  kw: string
  type: 'external' | 'internal'
  description: string
}

const EMPTY_MS: NewMilestone = { lphId: '', kw: '', type: 'external', description: '' }

export default function TerminplanSheet({ projectId, projectName, onClose, onSaved }: Props) {
  const [schedules, setSchedules] = useState<LphSchedule[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [newMs, setNewMs] = useState<NewMilestone>(EMPTY_MS)
  const [addingMs, setAddingMs] = useState(false)
  const [msError, setMsError] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()
  const today = currentIsoWeek()
  const currentWeek = today.week

  // KW-Fenster: 4 Wochen zurück bis 24 voraus
  const weeks = buildWeekWindow(addWeeks(today, -4), 28).map((w) => w.week)

  useEffect(() => {
    loadTerminplan(projectId)
      .then(({ schedules, milestones }) => {
        setSchedules(schedules)
        setMilestones(milestones)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId])

  function getPhaseForLph(lphNum: number) {
    return PLANNING_PHASES.find((p) => p.lph.includes(lphNum as never))
  }

  async function handleScheduleChange(
    lphId: string,
    field: 'start_kw' | 'end_kw',
    value: string
  ) {
    const num = value === '' ? null : parseInt(value)
    setSchedules((prev) =>
      prev.map((s) => (s.lph_id === lphId ? { ...s, [field]: num } : s))
    )
    setSaving(lphId)
    const s = schedules.find((x) => x.lph_id === lphId)!
    const updated = { ...s, [field]: num }
    await saveLphSchedule(lphId, updated.start_kw, updated.end_kw, currentYear)
    setSaving(null)
  }

  async function handleAddMilestone() {
    if (!newMs.lphId || !newMs.kw || !newMs.description) {
      setMsError('Alle Felder ausfüllen')
      return
    }
    setMsError(null)
    setAddingMs(true)
    const result = await saveMilestone(
      projectId, newMs.lphId, parseInt(newMs.kw),
      currentYear, newMs.type, newMs.description
    )
    if (result.success && result.id) {
      const lphNum = schedules.find((s) => s.lph_id === newMs.lphId)?.lph_number ?? 0
      const ms: Milestone = {
        id: result.id, lph_id: newMs.lphId, lph_number: lphNum,
        kw: parseInt(newMs.kw), year: currentYear,
        type: newMs.type, description: newMs.description,
        milestone_date: null, // KW-basierter Pfad ohne Datumsfeld
      }
      const updated = [...milestones, ms]
      setMilestones(updated)
      onSaved(schedules, updated)
      setNewMs(EMPTY_MS)
    } else {
      setMsError(result.message)
    }
    setAddingMs(false)
  }

  async function handleDeleteMilestone(id: string) {
    await deleteMilestone(id)
    const updated = milestones.filter((m) => m.id !== id)
    setMilestones(updated)
    onSaved(schedules, updated)
  }

  function handleSaveAll() {
    onSaved(schedules, milestones)
    onClose()
  }

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="w-[720px] bg-white shadow-2xl flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-slate-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-800">Terminplan bearbeiten</h2>
              <p className="text-xs text-slate-400">{projectName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              Übernehmen & schließen
            </button>
            <button onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Lade Terminplan…</span>
            </div>
          ) : (
            <div className="p-6 space-y-8">

              {/* ── Gantt-Light ── */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-4">
                  Leistungsphasen-Zeitplan
                </h3>

                {/* KW-Header */}
                <div className="overflow-x-auto">
                  <div style={{ minWidth: `${28 * 36 + 180}px` }}>
                    {/* Header-Zeile */}
                    <div className="flex mb-1">
                      <div className="w-44 shrink-0" />
                      <div className="w-20 shrink-0" />
                      <div className="flex">
                        {weeks.map((kw) => (
                          <div key={kw}
                            className={`w-9 text-center text-[9px] font-mono shrink-0 py-1 ${
                              kw === currentWeek ? 'text-blue-600 font-bold' : 'text-slate-400'
                            }`}>
                            {kw}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* LPH-Zeilen */}
                    {PLANNING_PHASES.map((phase) => {
                      const phaseSched = schedules.filter((s) => phase.lph.includes(s.lph_number as never))
                      if (phaseSched.length === 0) return null

                      // Gemeinsamer Start/End für den Planungsschritt
                      const starts = phaseSched.map((s) => s.start_kw).filter(Boolean) as number[]
                      const ends = phaseSched.map((s) => s.end_kw).filter(Boolean) as number[]
                      const phaseStart = starts.length ? Math.min(...starts) : null
                      const phaseEnd = ends.length ? Math.max(...ends) : null

                      // Meilensteine für diesen Planungsschritt
                      const phaseMilestones = milestones.filter((m) =>
                        phase.lph.includes(m.lph_number as never)
                      )

                      return (
                        <div key={phase.key} className="mb-4">
                          {/* Phase-Label */}
                          <div className="flex items-center mb-1">
                            <div className="w-44 shrink-0">
                              <p className="text-xs font-semibold text-slate-700">{phase.label}</p>
                              <p className="text-[10px] text-slate-400">LPH {phase.lph.join('·')}</p>
                            </div>
                            <div className="w-20 shrink-0" />
                            {/* Gantt-Balken */}
                            <div className="flex relative">
                              {weeks.map((kw) => {
                                const inRange = phaseStart && phaseEnd && kw >= phaseStart && kw <= phaseEnd
                                const isStart = kw === phaseStart
                                const isEnd = kw === phaseEnd
                                const ms = phaseMilestones.filter((m) => m.kw === kw)

                                return (
                                  <div key={kw}
                                    className={`w-9 h-8 shrink-0 relative flex items-center justify-center border-r border-slate-100 ${
                                      kw === currentWeek ? 'bg-blue-50/50' : ''
                                    }`}>
                                    {inRange && (
                                      <div className={`absolute inset-y-2 left-0 right-0 ${PHASE_COLORS[phase.key]} opacity-80
                                        ${isStart ? 'rounded-l-full left-1' : ''}
                                        ${isEnd ? 'rounded-r-full right-1' : ''}
                                      `} />
                                    )}
                                    {ms.map((m, i) => (
                                      <div key={m.id}
                                        className="absolute z-10"
                                        style={{ top: 2 + i * 10 }}
                                        title={m.description}>
                                        {m.type === 'external'
                                          ? <Flag className="h-3 w-3 text-red-500 fill-red-500" />
                                          : <Circle className="h-3 w-3 text-blue-500 fill-blue-500" />
                                        }
                                      </div>
                                    ))}
                                  </div>
                                )
                              })}
                            </div>
                          </div>

                          {/* LPH-Einzelzeilen mit Start/End-Inputs */}
                          {phaseSched.map((s) => (
                            <div key={s.lph_id} className="flex items-center mb-0.5">
                              <div className="w-44 shrink-0 pl-3">
                                <span className="text-[11px] text-slate-500">LPH {s.lph_number}</span>
                              </div>
                              <div className="w-20 shrink-0 flex gap-1 items-center">
                                <input
                                  type="number" min="1" max="53" placeholder="von"
                                  value={s.start_kw ?? ''}
                                  onChange={(e) => handleScheduleChange(s.lph_id, 'start_kw', e.target.value)}
                                  className="w-9 text-center text-[10px] border border-slate-200 rounded px-0.5 py-0.5 outline-none focus:border-slate-400"
                                />
                                <span className="text-[10px] text-slate-300">–</span>
                                <input
                                  type="number" min="1" max="53" placeholder="bis"
                                  value={s.end_kw ?? ''}
                                  onChange={(e) => handleScheduleChange(s.lph_id, 'end_kw', e.target.value)}
                                  className="w-9 text-center text-[10px] border border-slate-200 rounded px-0.5 py-0.5 outline-none focus:border-slate-400"
                                />
                                {saving === s.lph_id && (
                                  <Loader2 className="h-3 w-3 text-slate-400 animate-spin" />
                                )}
                              </div>
                              {/* Mini-Balken pro LPH */}
                              <div className="flex">
                                {weeks.map((kw) => {
                                  const inRange = s.start_kw && s.end_kw && kw >= s.start_kw && kw <= s.end_kw
                                  return (
                                    <div key={kw} className={`w-9 h-5 shrink-0 border-r border-slate-50 ${kw === currentWeek ? 'bg-blue-50/30' : ''}`}>
                                      {inRange && (
                                        <div className={`mx-0.5 h-full rounded-sm ${PHASE_LIGHT[phase.key]} border`} />
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Legende */}
                <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Flag className="h-3 w-3 text-red-500 fill-red-500" />
                    Externer Termin (Abgabe Bauherr)
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Circle className="h-3 w-3 text-blue-500 fill-blue-500" />
                    Interner Termin (Planprüfung FBL)
                  </div>
                </div>
              </div>

              {/* ── Meilensteine ── */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Meilensteine</h3>

                {/* Bestehende */}
                {milestones.length > 0 && (
                  <div className="space-y-1.5 mb-4">
                    {milestones.map((m) => (
                      <div key={m.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50">
                        {m.type === 'external'
                          ? <Flag className="h-3.5 w-3.5 text-red-500 fill-red-500 shrink-0" />
                          : <Circle className="h-3.5 w-3.5 text-blue-500 fill-blue-500 shrink-0" />
                        }
                        <span className="text-xs text-slate-500 w-14 shrink-0">KW {m.kw}</span>
                        <span className="text-xs text-slate-400 w-16 shrink-0">LPH {m.lph_number}</span>
                        <span className="text-xs text-slate-700 flex-1">{m.description}</span>
                        <button onClick={() => handleDeleteMilestone(m.id)}
                          className="p-1 rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Neuen Meilenstein hinzufügen */}
                <div className="rounded-xl border border-slate-200 p-4 bg-white">
                  <p className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Neuer Meilenstein
                  </p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">LPH</label>
                      <select
                        value={newMs.lphId}
                        onChange={(e) => setNewMs((v) => ({ ...v, lphId: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 bg-white text-slate-700"
                      >
                        <option value="">Wählen…</option>
                        {schedules.map((s) => (
                          <option key={s.lph_id} value={s.lph_id}>LPH {s.lph_number}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">KW</label>
                      <input
                        type="number" min="1" max="53" placeholder="z.B. 16"
                        value={newMs.kw}
                        onChange={(e) => setNewMs((v) => ({ ...v, kw: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Typ</label>
                      <div className="flex gap-2">
                        {(['external', 'internal'] as const).map((t) => (
                          <button key={t}
                            onClick={() => setNewMs((v) => ({ ...v, type: t }))}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-all ${
                              newMs.type === t
                                ? t === 'external'
                                  ? 'bg-red-50 border-red-300 text-red-700'
                                  : 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}>
                            {t === 'external'
                              ? <><Flag className="h-3 w-3 fill-current" />Extern</>
                              : <><Circle className="h-3 w-3 fill-current" />Intern</>
                            }
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Beschreibung</label>
                      <input
                        type="text" placeholder="z.B. Abgabe Bauherr"
                        value={newMs.description}
                        onChange={(e) => setNewMs((v) => ({ ...v, description: e.target.value }))}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                  {msError && <p className="text-xs text-red-500 mb-2">{msError}</p>}
                  <button
                    onClick={handleAddMilestone}
                    disabled={addingMs}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
                  >
                    {addingMs ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Hinzufügen
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
