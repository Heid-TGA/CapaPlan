'use client'

import { useState, useEffect } from 'react'
import { X, AlertTriangle, TrendingUp, Users, Zap, Loader2 } from 'lucide-react'
import { loadHeatmapData, type HeatmapEmployee, type HeatmapAllocation } from '@/app/actions/heatmap'

interface PopoverState {
  empId: string
  kw: number
  x: number
  y: number
}

interface ProjectBreakdown {
  project_number: string
  project_name: string
  hours: number
  lph_number: number
}

function getCurrentWeek(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function getCellStyle(hours: number, capacity: number) {
  if (hours === 0) return { bg: 'bg-white', text: 'text-slate-200', border: 'border-transparent' }
  const pct = hours / capacity
  if (pct > 1.05) return { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200' }
  if (pct >= 0.9) return { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' }
  if (pct >= 0.5) return { bg: 'bg-sky-50',      text: 'text-sky-700',     border: 'border-sky-200' }
  return               { bg: 'bg-slate-50',    text: 'text-slate-500',   border: 'border-slate-200' }
}

const PROJECT_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
]

export default function EmployeeHeatmapView() {
  const [employees, setEmployees] = useState<HeatmapEmployee[]>([])
  const [allocations, setAllocations] = useState<HeatmapAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const currentWeek = getCurrentWeek()
  const currentYear = new Date().getFullYear()
  const weeks = Array.from({ length: 12 }, (_, i) => ((currentWeek - 1 + i) % 52) + 1)

  useEffect(() => {
    setLoading(true)
    loadHeatmapData(currentYear, weeks)
      .then(({ employees, allocations }) => {
        setEmployees(employees)
        setAllocations(allocations)
        setLoading(false)
      })
      .catch((e) => {
        setError(e.message)
        setLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Projekt-Farb-Map aufbauen
  const projectNumbers = [...new Set(allocations.map((a) => a.project_number))]
  const projectColorMap = new Map(projectNumbers.map((p, i) => [p, PROJECT_COLORS[i % PROJECT_COLORS.length]]))

  // Stunden für Mitarbeiter + KW berechnen
  function getBreakdown(empId: string, kw: number): ProjectBreakdown[] {
    return allocations
      .filter((a) => a.employee_id === empId && a.calendar_week === kw)
      .reduce<ProjectBreakdown[]>((acc, a) => {
        const existing = acc.find((x) => x.project_number === a.project_number && x.lph_number === a.lph_number)
        if (existing) {
          existing.hours += a.allocated_hours
        } else {
          acc.push({
            project_number: a.project_number,
            project_name: a.project_name,
            hours: a.allocated_hours,
            lph_number: a.lph_number,
          })
        }
        return acc
      }, [])
      .sort((a, b) => b.hours - a.hours)
  }

  function getTotalHours(empId: string, kw: number): number {
    return allocations
      .filter((a) => a.employee_id === empId && a.calendar_week === kw)
      .reduce((s, a) => s + a.allocated_hours, 0)
  }

  const departments = [...new Set(employees.map((e) => e.department))]

  const overbookedCount = employees.filter((emp) =>
    weeks.some((kw) => getTotalHours(emp.id, kw) > emp.weekly_capacity_hours * 1.05)
  ).length

  const freeCapCount = employees.filter((emp) =>
    weeks.some((kw) => {
      const h = getTotalHours(emp.id, kw)
      return h > 0 && h < emp.weekly_capacity_hours * 0.5
    })
  ).length

  const totalHours = allocations.reduce((s, a) => s + a.allocated_hours, 0)

  function handleCellClick(e: React.MouseEvent, empId: string, kw: number) {
    const breakdown = getBreakdown(empId, kw)
    if (breakdown.length === 0) return
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPopover({ empId, kw, x: rect.left, y: rect.bottom + 6 })
  }

  const popoverEmp = popover ? employees.find((e) => e.id === popover.empId) : null
  const popoverBreakdown = popover ? getBreakdown(popover.empId, popover.kw) : []
  const popoverTotal = popoverBreakdown.reduce((s, a) => s + a.hours, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Lade Ressourcendaten…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-600 font-medium">Fehler beim Laden</p>
        <p className="text-xs text-red-400 mt-1">{error}</p>
      </div>
    )
  }

  if (allocations.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
        <p className="text-slate-400 text-sm">Noch keine Planungsdaten vorhanden.</p>
        <p className="text-slate-300 text-xs mt-1">Importiere zuerst Abacus- und H&I-Daten.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" onClick={() => setPopover(null)}>

      {/* ── Statistik-Karten ── */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Überbuchungen</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{overbookedCount}</p>
          <p className="text-xs text-slate-400 mt-1">Mitarbeiter betroffen</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-sky-400" />
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Freie Kapazität</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{freeCapCount}</p>
          <p className="text-xs text-slate-400 mt-1">Mitarbeiter &lt; 50%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Verplante Stunden</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{Math.round(totalHours)}</p>
          <p className="text-xs text-slate-400 mt-1">KW {weeks[0]}–{weeks[weeks.length - 1]}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-slate-300" />
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Team</p>
          </div>
          <p className="text-2xl font-semibold text-slate-800">{employees.length}</p>
          <p className="text-xs text-slate-400 mt-1">Mitarbeiter</p>
        </div>
      </div>

      {/* ── Legende ── */}
      <div className="flex items-center gap-6 px-1 flex-wrap">
        <p className="text-xs text-slate-400 font-medium">Auslastung:</p>
        {[
          { color: 'bg-red-100 border-red-200',       label: 'Überbucht (>105%)' },
          { color: 'bg-emerald-100 border-emerald-200', label: 'Optimal (90–105%)' },
          { color: 'bg-sky-100 border-sky-200',        label: 'Teilbelegt (50–89%)' },
          { color: 'bg-slate-100 border-slate-200',    label: 'Unterbelegt (<50%)' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`h-3 w-5 rounded border ${l.color}`} />
            <span className="text-xs text-slate-500">{l.label}</span>
          </div>
        ))}
      </div>

      {/* ── Heatmap-Tabelle ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '180px' }} />
              <col style={{ width: '56px' }} />
              {weeks.map((kw) => <col key={kw} style={{ width: '64px' }} />)}
            </colgroup>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="sticky left-0 z-10 bg-slate-50 text-left px-5 py-3 text-xs font-medium text-slate-500">
                  Mitarbeiter
                </th>
                <th className="px-2 py-3 text-xs font-medium text-slate-400 text-center border-r border-slate-100">
                  Kap.
                </th>
                {weeks.map((kw) => (
                  <th key={kw}
                    className={`px-1 py-3 text-xs font-medium text-center ${
                      kw === currentWeek ? 'text-blue-600 bg-blue-50' : 'text-slate-500'
                    }`}>
                    {kw === currentWeek && (
                      <span className="block text-[8px] text-blue-400 leading-none mb-0.5">▸ heute</span>
                    )}
                    KW {kw}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => {
                const deptEmps = employees.filter((e) => e.department === dept)
                return [
                  <tr key={`dept-${dept}`}>
                    <td colSpan={weeks.length + 2}
                      className="bg-slate-50 px-5 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-b border-t border-slate-100">
                      {dept}
                    </td>
                  </tr>,
                  ...deptEmps.map((emp) => (
                    <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/30">
                      <td className="sticky left-0 z-10 bg-white border-r border-slate-100 px-5 py-2">
                        <p className="text-sm font-medium text-slate-700 truncate">{emp.name}</p>
                        <p className="text-[10px] text-slate-400">{emp.role_type}</p>
                      </td>
                      <td className="text-center text-xs text-slate-400 font-mono border-r border-slate-100 px-1">
                        {emp.weekly_capacity_hours}h
                      </td>
                      {weeks.map((kw) => {
                        const total = getTotalHours(emp.id, kw)
                        const style = getCellStyle(total, emp.weekly_capacity_hours)
                        const isCurrentKw = kw === currentWeek
                        const overHours = total - emp.weekly_capacity_hours

                        return (
                          <td key={kw}
                            className={`p-1 text-center ${isCurrentKw ? 'bg-blue-50/30' : ''}`}
                            onClick={(e) => handleCellClick(e, emp.id, kw)}
                          >
                            <div className={`
                              mx-auto flex flex-col items-center justify-center
                              h-10 w-14 rounded-lg border text-xs font-semibold
                              transition-all duration-100
                              ${style.bg} ${style.text} ${style.border}
                              ${total > 0 ? 'cursor-pointer hover:opacity-80 hover:scale-105' : 'cursor-default'}
                            `}>
                              {total > 0 ? (
                                <>
                                  <span>{Math.round(total)}h</span>
                                  {overHours > 0 && (
                                    <span className="text-[8px] font-bold text-red-500 leading-none">
                                      +{Math.round(overHours)}h
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-slate-200 text-[10px]">—</span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))
                ]
              })}

              {/* Summenzeile */}
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td className="sticky left-0 z-10 bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-600">
                  Σ alle Mitarbeiter
                </td>
                <td className="border-r border-slate-100" />
                {weeks.map((kw) => {
                  const total = employees.reduce((s, emp) => s + getTotalHours(emp.id, kw), 0)
                  return (
                    <td key={kw} className="text-center text-xs font-semibold text-slate-600 py-2.5">
                      {total > 0 ? `${Math.round(total)}h` : '—'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Drill-Down Popover ── */}
      {popover && popoverEmp && popoverBreakdown.length > 0 && (
        <div
          className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-xl w-72 p-4"
          style={{
            top: Math.min(popover.y, window.innerHeight - 320),
            left: Math.min(popover.x, window.innerWidth - 300),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{popoverEmp.name}</p>
              <p className="text-xs text-slate-400">
                KW {popover.kw} · {Math.round(popoverTotal)}h von {popoverEmp.weekly_capacity_hours}h
              </p>
            </div>
            <button onClick={() => setPopover(null)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Auslastungsbalken */}
          <div className="mb-3">
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  popoverTotal > popoverEmp.weekly_capacity_hours * 1.05 ? 'bg-red-400' :
                  popoverTotal >= popoverEmp.weekly_capacity_hours * 0.9 ? 'bg-emerald-400' : 'bg-sky-400'
                }`}
                style={{ width: `${Math.min(100, popoverTotal / popoverEmp.weekly_capacity_hours * 100)}%` }}
              />
            </div>
            {popoverTotal > popoverEmp.weekly_capacity_hours && (
              <p className="text-[10px] text-red-500 font-medium mt-1">
                ⚠ {Math.round(popoverTotal - popoverEmp.weekly_capacity_hours)}h über Kapazität
              </p>
            )}
          </div>

          {/* Projekt-Aufschlüsselung */}
          <div className="space-y-1.5">
            {popoverBreakdown.map((item, i) => {
              const pct = Math.round(item.hours / popoverEmp.weekly_capacity_hours * 100)
              const colorClass = projectColorMap.get(item.project_number) ?? 'bg-slate-100 text-slate-600'
              return (
                <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 ${colorClass}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{item.project_number}</p>
                    <p className="text-[10px] opacity-70 truncate">{item.project_name} · LPH {item.lph_number}</p>
                  </div>
                  <div className="text-right ml-2 shrink-0">
                    <p className="text-xs font-bold">{Math.round(item.hours)}h</p>
                    <p className="text-[10px] opacity-60">{pct}%</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
