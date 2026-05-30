'use client'

import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, Eye, CircleDashed, CheckCircle2, LayoutGrid, Loader2, UserX } from 'lucide-react'
import { loadPortfolioData, type PortfolioData } from '@/app/actions/portfolio'
import {
  buildPortfolioRows,
  sortPortfolioRows,
  formatReasons,
  spanToColumns,
  type PortfolioRow,
  type PortfolioStatus,
  type PortfolioSort,
} from '@/lib/portfolio'
import type { PhaseKey } from '@/lib/planning-phases'
import { currentIsoWeek } from '@/lib/calendar-weeks'

// ── Layout-Konstanten ────────────────────────────────────────────────────────

const COL_WIDTH = 52
const NAME_COL = 240
const PHASE_COL = 140
const STATUS_COL = 140

// ── Stil-Maps ────────────────────────────────────────────────────────────────

const PHASE_STYLE: Record<PhaseKey, { bar: string; label: string }> = {
  basic: { bar: 'bg-violet-400', label: 'Basic' },
  detail: { bar: 'bg-blue-400', label: 'Detail' },
  ausfuehrung: { bar: 'bg-emerald-400', label: 'Ausführung' },
}

const STATUS_STYLE: Record<PortfolioStatus, { dot: string; text: string; chip: string }> = {
  engpass: { dot: 'bg-red-500', text: 'text-red-700', chip: 'bg-red-50 border-red-200' },
  beobachten: { dot: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 border-amber-200' },
  nicht_terminiert: { dot: 'bg-slate-400', text: 'text-slate-600', chip: 'bg-slate-100 border-slate-200' },
  ohne_zuweisung: { dot: 'bg-slate-300', text: 'text-slate-500', chip: 'bg-white border-slate-200' },
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 border-emerald-200' },
}

type Filter = 'alle' | PortfolioStatus

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'engpass', label: 'Engpass' },
  { key: 'beobachten', label: 'Beobachten' },
  { key: 'nicht_terminiert', label: 'Nicht terminiert' },
  { key: 'ohne_zuweisung', label: 'Ohne Zuweisung' },
  { key: 'ok', label: 'OK' },
]

const SORTS: { key: PortfolioSort; label: string }[] = [
  { key: 'projektnummer', label: 'Projektnummer' },
  { key: 'dringlichkeit', label: 'Dringlichkeit' },
]

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onOpenProject: (projectId: string) => void
}

// ── Komponente ───────────────────────────────────────────────────────────────

export default function PortfolioView({ onOpenProject }: Props) {
  const [data, setData] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('alle')
  const [sort, setSort] = useState<PortfolioSort>('projektnummer')

  useEffect(() => {
    const ref = currentIsoWeek()
    loadPortfolioData(ref.year, ref.week)
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
        setLoading(false)
      })
  }, [])

  const rows = useMemo<PortfolioRow[]>(() => (data ? buildPortfolioRows(data) : []), [data])

  const counts = useMemo(() => {
    const c = { total: rows.length, engpass: 0, beobachten: 0, nicht_terminiert: 0, ohne_zuweisung: 0, ok: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])

  const sortedRows = useMemo(() => sortPortfolioRows(rows, sort), [rows, sort])
  const visibleRows = filter === 'alle' ? sortedRows : sortedRows.filter((r) => r.status === filter)

  // ── States ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Lade Portfolio…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-red-600">Fehler beim Laden</p>
        <p className="mt-1 text-xs text-red-400">{error}</p>
      </div>
    )
  }

  if (!data || rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
        <p className="text-sm text-slate-400">Keine Projekte vorhanden.</p>
        <p className="mt-1 text-xs text-slate-300">Importiere zuerst Abacus-Daten.</p>
      </div>
    )
  }

  const weeks = data.weeks
  const trackWidth = weeks.length * COL_WIDTH
  const minWidth = NAME_COL + PHASE_COL + STATUS_COL + trackWidth

  const kpis = [
    { label: 'Projekte gesamt', value: counts.total, icon: <LayoutGrid className="h-4 w-4 text-slate-300" /> },
    { label: 'Engpass', value: counts.engpass, icon: <AlertTriangle className="h-4 w-4 text-red-400" /> },
    { label: 'Beobachten', value: counts.beobachten, icon: <Eye className="h-4 w-4 text-amber-400" /> },
    { label: 'Nicht terminiert', value: counts.nicht_terminiert, icon: <CircleDashed className="h-4 w-4 text-slate-300" /> },
    { label: 'Ohne Zuweisung', value: counts.ohne_zuweisung, icon: <UserX className="h-4 w-4 text-slate-300" /> },
    { label: 'OK', value: counts.ok, icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
  ]

  return (
    <div className="space-y-4">
      {/* ── KPI-Leiste ── */}
      <div className="grid grid-cols-6 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              {k.icon}
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</p>
            </div>
            <p className="text-2xl font-semibold text-slate-800">{k.value}</p>
          </div>
        ))}
      </div>

      {/* ── Status-Filter + Sortierung ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Sortierung</span>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
            {SORTS.map((s) => {
              const active = sort === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    active ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Portfolio-Tabelle ── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <div style={{ minWidth }}>
            {/* Kopfzeile */}
            <div className="flex border-b border-slate-200 bg-slate-50">
              <div style={{ width: NAME_COL, minWidth: NAME_COL }} className="border-r border-slate-100 px-5 py-2.5 text-xs font-medium text-slate-500">
                Projekt
              </div>
              <div style={{ width: PHASE_COL, minWidth: PHASE_COL }} className="border-r border-slate-100 px-3 py-2.5 text-xs font-medium text-slate-500">
                Aktuelle Phase
              </div>
              <div style={{ width: STATUS_COL, minWidth: STATUS_COL }} className="border-r border-slate-100 px-3 py-2.5 text-xs font-medium text-slate-500">
                Status
              </div>
              {weeks.map((w) => (
                <div
                  key={`${w.year}-${w.week}`}
                  style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                  className={`border-r border-slate-100 py-2.5 text-center text-[10px] font-medium ${
                    w.isCurrent ? 'bg-blue-50 text-blue-600' : 'text-slate-500'
                  }`}
                >
                  {w.isCurrent && <span className="block leading-none text-blue-400">▸</span>}
                  KW {w.week}
                </div>
              ))}
            </div>

            {/* Datenzeilen */}
            {visibleRows.map((row) => {
              const s = STATUS_STYLE[row.status]
              return (
                <div
                  key={row.project.id}
                  onClick={() => onOpenProject(row.project.id)}
                  className="flex cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/60"
                >
                  {/* Projekt */}
                  <div style={{ width: NAME_COL, minWidth: NAME_COL }} className="flex flex-col justify-center border-r border-slate-100 px-5 py-2.5">
                    <p className="truncate text-sm font-medium text-slate-700">{row.project.name}</p>
                    <p className="text-[10px] text-slate-400">{row.project.project_number}</p>
                  </div>

                  {/* Aktuelle Phase */}
                  <div style={{ width: PHASE_COL, minWidth: PHASE_COL }} className="flex items-center border-r border-slate-100 px-3 py-2.5">
                    <span className="truncate text-xs text-slate-600">{row.currentPhaseLabel}</span>
                  </div>

                  {/* Status / Ampel */}
                  <div style={{ width: STATUS_COL, minWidth: STATUS_COL }} className="flex items-center border-r border-slate-100 px-3 py-2.5">
                    <span
                      title={formatReasons(row.reasons)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${s.chip} ${s.text}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      {row.statusLabel}
                    </span>
                  </div>

                  {/* Zeitachse mit Phasenbalken */}
                  <div className="relative" style={{ width: trackWidth, minWidth: trackWidth }}>
                    {/* Spaltenraster */}
                    <div className="absolute inset-0 flex">
                      {weeks.map((w) => (
                        <div
                          key={`${w.year}-${w.week}`}
                          style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
                          className={`border-r border-slate-50 ${w.isCurrent ? 'bg-blue-50/40' : ''}`}
                        />
                      ))}
                    </div>

                    {/* Phasenbalken */}
                    {row.spans.map((span) => {
                      const cols = spanToColumns(span, weeks)
                      if (!cols) return null
                      const style = PHASE_STYLE[span.key]
                      return (
                        <div
                          key={span.key}
                          title={`${span.label} · KW ${span.startKw}–${span.endKw}`}
                          className={`absolute flex h-5 items-center rounded-full ${style.bar}`}
                          style={{
                            left: cols.startIdx * COL_WIDTH + 3,
                            width: (cols.endIdx - cols.startIdx + 1) * COL_WIDTH - 6,
                            top: '50%',
                            transform: 'translateY(-50%)',
                          }}
                        >
                          <span className="truncate px-2 text-[9px] font-semibold text-white">{style.label}</span>
                        </div>
                      )
                    })}

                    {/* Hinweis bei fehlendem Terminplan */}
                    {row.spans.length === 0 && (
                      <div className="flex h-full items-center pl-3">
                        <span className="text-[10px] italic text-slate-300">kein Terminplan</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {visibleRows.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                Keine Projekte im Filter „{FILTERS.find((f) => f.key === filter)?.label}".
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Legende ── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-xs text-slate-500">
        <span className="font-medium text-slate-400">Status:</span>
        {(['engpass', 'beobachten', 'nicht_terminiert', 'ohne_zuweisung', 'ok'] as PortfolioStatus[]).map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[st].dot}`} />
            {st === 'engpass' && 'Engpass (>105 %)'}
            {st === 'beobachten' && 'Beobachten (90–105 % · außerhalb Phase · unvollständig)'}
            {st === 'nicht_terminiert' && 'Nicht terminiert (kein Terminplan)'}
            {st === 'ohne_zuweisung' && 'Ohne Zuweisung (terminiert, keine Allocation)'}
            {st === 'ok' && 'OK'}
          </span>
        ))}
        <span className="font-medium text-slate-400">Phase:</span>
        {(['basic', 'detail', 'ausfuehrung'] as PhaseKey[]).map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-4 rounded ${PHASE_STYLE[p].bar}`} />
            {PHASE_STYLE[p].label}
          </span>
        ))}
      </div>
    </div>
  )
}
