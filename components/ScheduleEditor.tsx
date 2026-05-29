'use client'

import { useState, useEffect } from 'react'
import { X, Flag, Circle, Plus, Trash2, Save, Calendar } from 'lucide-react'
import {
  loadSchedule,
  upsertSchedule,
  upsertMilestone,
  deleteMilestone,
  type LphSchedule,
  type Milestone,
} from '@/app/actions/schedule'

const PLANNING_PHASES = [
  { key: 'basic',       label: 'Basic Design',  lph: [1, 2, 3, 4] },
  { key: 'detail',      label: 'Detail Design', lph: [5, 6, 7] },
  { key: 'ausfuehrung', label: 'Ausführung',    lph: [8] },
]

const PHASE_COLORS: Record<string, string> = {
  basic:       'bg-violet-200 border-violet-300',
  detail:      'bg-sky-200 border-sky-300',
  ausfuehrung: 'bg-amber-200 border-amber-300',
}
const PHASE_TEXT: Record<string, string> = {
  basic: 'text-violet-700', detail: 'text-sky-700', ausfuehrung: 'text-amber-700',
}

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
  onSaved: (schedules: LphSchedule[], milestones: Milestone[]) => void
}

function getCurrentWeek() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export default function ScheduleEditor({ projectId, projectName, onClose, onSaved }: Props) {
  const [schedules, setSchedules] = useState<LphSchedule[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newMilestone, setNewMilestone] = useState<Partial<Milestone> | null>(null)

  const currentYear = new Date().getFullYear()
  const currentWeek = getCurrentWeek()
  // Zeige 20 Wochen ab aktueller KW
  const weeks = Array.from({ length: 20 }, (_, i) => {
    const kw = ((currentWeek - 1 + i) % 52) + 1
    return { kw, year: kw < currentWeek ? currentYear + 1 : currentYear }
  })

  useEffect(() => {
    loadSchedule(projectId).then(({ schedules, milestones }) => {
      setSchedules(schedules)
      setMilestones(milestones)
      setLoading(false)
    })
  }, [projectId])

  function getSchedule(lphNum: number): LphSchedule | undefined {
    return schedules.find((s) => s.lph_number === lphNum)
  }

  function isInRange(kw: number, year: number, lphNum: number): boolean {
    const s = getSchedule(lphNum)
    if (!s) return false
    const val = year * 100 + kw
    const start = s.start_year * 100 + s.start_kw
    const end = s.end_year * 100 + s.end_kw
    return val >= start && val <= end
  }

  function getMilestonesForKw(kw: number, year: number, lphNum: number): Milestone[] {
    return milestones.filter((m) => m.kw === kw && m.year === year && m.lph_number === lphNum)
  }

  function handleBarClick(kw: number, year: number, lphNum: number) {
    const s = getSchedule(lphNum)
    if (!s) {
      // Neues Schedule anlegen: KW als Start, +4 Wochen als End
      const endKw = ((kw - 1 + 4) % 52) + 1
      const endYear = endKw < kw ? year + 1 : year
      setSchedules((prev) => [
        ...prev.filter((x) => x.lph_number !== lphNum),
        { lph_number: lphNum, start_kw: kw, start_year: year, end_kw: endKw, end_year: endYear },
      ])
    }
  }

  function handleStartChange(lphNum: number, kw: number, year: number) {
    setSchedules((prev) => prev.map((s) =>
      s.lph_number === lphNum ? { ...s, start_kw: kw, start_year: year } : s
    ))
  }

  function handleEndChange(lphNum: number, kw: number, year: number) {
    setSchedules((prev) => prev.map((s) =>
      s.lph_number === lphNum ? { ...s, end_kw: kw, end_year: year } : s
    ))
  }

  function clearSchedule(lphNum: number) {
    setSchedules((prev) => prev.filter((s) => s.lph_number !== lphNum))
    setMilestones((prev) => prev.filter((m) => m.lph_number !== lphNum))
  }

  async function handleSave() {
    setSaving(true)
    for (const s of schedules) {
      await upsertSchedule(projectId, s)
    }
    for (const m of milestones) {
      if (m.id?.startsWith('local-')) {
        const { id: _, ...rest } = m
        await upsertMilestone(projectId, rest)
      }
    }
    setSaving(false)
    onSaved(schedules, milestones)
    onClose()
  }

  function addMilestone() {
    setNewMilestone({ lph_number: 5, kw: currentWeek, year: currentYear, type: 'external', description: '' })
  }

  function confirmNewMilestone() {
    if (!newMilestone?.description || !newMilestone.lph_number || !newMilestone.kw) return
    const m: Milestone = {
      id: `local-${Date.now()}`,
      lph_number: newMilestone.lph_number!,
      kw: newMilestone.kw!,
      year: newMilestone.year ?? currentYear,
      type: newMilestone.type as 'external' | 'internal' ?? 'external',
      description: newMilestone.description!,
    }
    setMilestones((prev) => [...prev, m])
    setNewMilestone(null)
  }

  async function removeMilestone(m: Milestone) {
    if (m.id && !m.id.startsWith('local-')) {
      await deleteMilestone(m.id)
    }
    setMilestones((prev) => prev.filter((x) => x.id !== m.id))
  }

  const phaseForLph = (lphNum: number) =>
    PLANNING_PHASES.find((p) => p.lph.includes(lphNum as never))?.key ?? 'basic'

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-3xl bg-white border-l border-slate-200 shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-slate-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-800">Terminplan</h2>
              <p className="text-xs text-slate-400">{projectName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Speichern…' : 'Speichern'}
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Legende */}
        <div className="flex items-center gap-5 px-6 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
          <p className="text-xs font-medium text-slate-500">Legende:</p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Flag className="h-3.5 w-3.5 text-red-500" />
            Externer Termin
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Circle className="h-3.5 w-3.5 text-blue-500" />
            Interner Termin
          </div>
          {PLANNING_PHASES.map((ph) => (
            <div key={ph.key} className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className={`h-3 w-6 rounded border ${PHASE_COLORS[ph.key]}`} />
              {ph.label}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Lade Terminplan…
          </div>
        ) : (
          <div className="flex-1 overflow-auto">

            {/* Gantt-Tabelle */}
            <div className="overflow-x-auto">
              <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '160px' }} />
                  {weeks.map((w) => <col key={`${w.year}-${w.kw}`} style={{ width: '44px' }} />)}
                  <col style={{ width: '120px' }} />
                </colgroup>

                {/* KW-Header */}
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-xs font-medium text-slate-500">
                      LPH
                    </th>
                    {weeks.map(({ kw, year }) => (
                      <th key={`${year}-${kw}`}
                        className={`px-0 py-3 text-center text-[10px] font-medium border-l border-slate-100 ${kw === currentWeek && year === currentYear ? 'text-blue-600 bg-blue-50' : 'text-slate-400'}`}>
                        {kw === currentWeek && year === currentYear && (
                          <span className="block text-[8px] text-blue-400 leading-none">▸</span>
                        )}
                        {kw}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-xs font-medium text-slate-500 text-center">Zeitraum</th>
                  </tr>
                </thead>

                <tbody>
                  {PLANNING_PHASES.map((ph) =>
                    ph.lph.map((lphNum) => {
                      const s = getSchedule(lphNum)
                      const phKey = phaseForLph(lphNum)

                      return (
                        <tr key={lphNum} className="border-b border-slate-100 hover:bg-slate-50/50">
                          {/* LPH-Label */}
                          <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-slate-100">
                            <p className={`text-xs font-semibold ${PHASE_TEXT[phKey]}`}>LPH {lphNum}</p>
                            <p className="text-[10px] text-slate-400">{ph.label}</p>
                          </td>

                          {/* Gantt-Zellen */}
                          {weeks.map(({ kw, year }) => {
                            const inRange = isInRange(kw, year, lphNum)
                            const mss = getMilestonesForKw(kw, year, lphNum)
                            const isStart = s?.start_kw === kw && s?.start_year === year
                            const isEnd = s?.end_kw === kw && s?.end_year === year

                            return (
                              <td key={`${year}-${kw}`}
                                className={`p-0 h-10 border-l border-slate-100 cursor-pointer relative group ${kw === currentWeek && year === currentYear ? 'bg-blue-50/30' : ''}`}
                                onClick={() => handleBarClick(kw, year, lphNum)}
                              >
                                {inRange && (
                                  <div className={`
                                    absolute inset-y-1.5 left-0 right-0
                                    ${PHASE_COLORS[phKey]}
                                    border-y
                                    ${isStart ? 'left-2 rounded-l-full border-l' : ''}
                                    ${isEnd ? 'right-2 rounded-r-full border-r' : ''}
                                  `} />
                                )}
                                {mss.map((m, i) => (
                                  <div key={i} className="absolute inset-0 flex items-center justify-center z-10">
                                    {m.type === 'external'
                                      ? <Flag className="h-3.5 w-3.5 text-red-500" />
                                      : <Circle className="h-3.5 w-3.5 text-blue-500" />
                                    }
                                  </div>
                                ))}
                                {!inRange && (
                                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                    <div className="h-1 w-4 bg-slate-200 rounded-full" />
                                  </div>
                                )}
                              </td>
                            )
                          })}

                          {/* Zeitraum-Picker */}
                          <td className="px-2 py-1 text-center">
                            {s ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-slate-400 w-8">von</span>
                                  <select
                                    value={s.start_kw}
                                    onChange={(e) => handleStartChange(lphNum, Number(e.target.value), s.start_year)}
                                    className="text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-700 bg-white w-14"
                                  >
                                    {Array.from({ length: 52 }, (_, i) => i + 1).map((kw) => (
                                      <option key={kw} value={kw}>KW {kw}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-slate-400 w-8">bis</span>
                                  <select
                                    value={s.end_kw}
                                    onChange={(e) => handleEndChange(lphNum, Number(e.target.value), s.end_year)}
                                    className="text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-700 bg-white w-14"
                                  >
                                    {Array.from({ length: 52 }, (_, i) => i + 1).map((kw) => (
                                      <option key={kw} value={kw}>KW {kw}</option>
                                    ))}
                                  </select>
                                </div>
                                <button
                                  onClick={() => clearSchedule(lphNum)}
                                  className="text-[9px] text-red-400 hover:text-red-600 text-left"
                                >
                                  löschen
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleBarClick(currentWeek, currentYear, lphNum)}
                                className="text-[10px] text-slate-300 hover:text-slate-500 transition-colors"
                              >
                                + setzen
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Meilensteine */}
            <div className="px-6 py-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">Meilensteine</h3>
                <button
                  onClick={addMilestone}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Meilenstein hinzufügen
                </button>
              </div>

              {/* Neuer Meilenstein Form */}
              {newMilestone && (
                <div className="mb-3 p-3 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-5 gap-2 items-end">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">LPH</label>
                    <select
                      value={newMilestone.lph_number}
                      onChange={(e) => setNewMilestone((p) => ({ ...p, lph_number: Number(e.target.value) }))}
                      className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
                    >
                      {[1,2,3,4,5,6,7,8].map((l) => <option key={l} value={l}>LPH {l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">KW</label>
                    <select
                      value={newMilestone.kw}
                      onChange={(e) => setNewMilestone((p) => ({ ...p, kw: Number(e.target.value) }))}
                      className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
                    >
                      {Array.from({ length: 52 }, (_, i) => i + 1).map((kw) => (
                        <option key={kw} value={kw}>KW {kw}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Typ</label>
                    <select
                      value={newMilestone.type}
                      onChange={(e) => setNewMilestone((p) => ({ ...p, type: e.target.value as 'external' | 'internal' }))}
                      className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
                    >
                      <option value="external">🔴 Extern</option>
                      <option value="internal">🔵 Intern</option>
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="text-[10px] text-slate-400 block mb-1">Beschreibung</label>
                    <input
                      type="text"
                      placeholder="z.B. Abgabe Bauherr"
                      value={newMilestone.description}
                      onChange={(e) => setNewMilestone((p) => ({ ...p, description: e.target.value }))}
                      className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
                    />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={confirmNewMilestone}
                      className="flex-1 px-2 py-1.5 rounded-md bg-slate-800 text-white text-xs font-medium hover:bg-slate-700">
                      ✓
                    </button>
                    <button onClick={() => setNewMilestone(null)}
                      className="flex-1 px-2 py-1.5 rounded-md border border-slate-200 text-slate-500 text-xs hover:bg-slate-50">
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Meilenstein-Liste */}
              {milestones.length === 0 && !newMilestone ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  Noch keine Meilensteine. Klicke "+ Meilenstein hinzufügen".
                </p>
              ) : (
                <div className="space-y-1.5">
                  {milestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-slate-100 hover:border-slate-200 transition-colors">
                      {m.type === 'external'
                        ? <Flag className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        : <Circle className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      }
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${m.type === 'external' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                        {m.type === 'external' ? 'Extern' : 'Intern'}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">LPH {m.lph_number}</span>
                      <span className="text-xs text-slate-400">KW {m.kw}</span>
                      <span className="flex-1 text-xs text-slate-700">{m.description}</span>
                      <button onClick={() => removeMilestone(m)}
                        className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
