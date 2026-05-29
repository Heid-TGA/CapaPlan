'use client'

import { useState, useEffect } from 'react'
import { Bug, X, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { loadHeatmapData } from '@/app/actions/heatmap'

function Section({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" /> : <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />}
        <span className="text-xs font-semibold text-slate-600">{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="text-[10px] text-slate-400 shrink-0">{label}</span>
      <span className={`text-[10px] font-mono text-right break-all ${highlight ? 'text-amber-600 font-semibold' : 'text-slate-600'}`}>
        {value}
      </span>
    </div>
  )
}

interface Props {
  projectId?: string
  year?: number
  weeks?: number[]
}

export default function DebugPanel({ projectId, year, weeks }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    employees: unknown[]
    allocations: unknown[]
    rawWeeks: number[]
    rawYear: number
    loadedAt: string
    error: string | null
  } | null>(null)

  const currentYear = year ?? new Date().getFullYear()
  const currentWeek = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 4 - (d.getDay() || 7))
    const yearStart = new Date(d.getFullYear(), 0, 1)
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  })()
  const defaultWeeks = weeks ?? Array.from({ length: 12 }, (_, i) => ((currentWeek - 1 + i) % 52) + 1)

  async function load() {
    setLoading(true)
    try {
      const result = await loadHeatmapData(currentYear, defaultWeeks)
      setData({
        employees: result.employees,
        allocations: result.allocations,
        rawWeeks: defaultWeeks,
        rawYear: currentYear,
        loadedAt: new Date().toLocaleTimeString('de-DE'),
        error: null,
      })
    } catch (e) {
      setData((prev) => ({
        employees: prev?.employees ?? [],
        allocations: prev?.allocations ?? [],
        rawWeeks: defaultWeeks,
        rawYear: currentYear,
        loadedAt: new Date().toLocaleTimeString('de-DE'),
        error: e instanceof Error ? e.message : String(e),
      }))
    }
    setLoading(false)
  }

  useEffect(() => { if (open && !data) load() }, [open])

  // KW-Verteilung der Allocations
  const kwCounts = data?.allocations.reduce<Record<number, number>>((acc, a) => {
    const kw = (a as { calendar_week: number }).calendar_week
    acc[kw] = (acc[kw] ?? 0) + 1
    return acc
  }, {}) ?? {}

  // Mitarbeiter-Matching
  const empNames = new Set(data?.employees.map((e) => (e as { name: string }).name.toLowerCase().trim()) ?? [])

  return (
    <>
      {/* Toggle-Button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium shadow-lg hover:bg-slate-700 transition-colors"
        title="Debug Panel"
      >
        <Bug className="h-3.5 w-3.5" />
        Debug
        {data?.allocations && data.allocations.length > 0 && (
          <span className="bg-emerald-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">
            {data.allocations.length}
          </span>
        )}
        {data?.error && (
          <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full">!</span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-14 right-4 z-50 w-80 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-800 text-white shrink-0">
            <div className="flex items-center gap-2">
              <Bug className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">Capaview Debug</span>
              {data && <span className="text-[10px] text-slate-400">{data.loadedAt}</span>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={load} disabled={loading}
                className="p-1 rounded hover:bg-slate-700 transition-colors">
                <RefreshCw className={`h-3 w-3 text-slate-300 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-slate-700 transition-colors">
                <X className="h-3 w-3 text-slate-300" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1">
            {!data && loading && (
              <div className="p-4 text-center text-xs text-slate-400">Lade Daten…</div>
            )}

            {data?.error && (
              <div className="m-3 p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-xs font-semibold text-red-600 mb-1">Fehler</p>
                <p className="text-[10px] text-red-500 font-mono">{data.error}</p>
              </div>
            )}

            {data && (
              <>
                {/* Übersicht */}
                <Section title="Übersicht" defaultOpen>
                  <Row label="Jahr" value={data.rawYear} />
                  <Row label="KW-Bereich" value={`KW ${data.rawWeeks[0]}–${data.rawWeeks[data.rawWeeks.length - 1]}`} />
                  <Row label="Mitarbeiter in DB" value={data.employees.length} />
                  <Row label="Allocations gesamt" value={data.allocations.length}
                    highlight={data.allocations.length === 0} />
                  {data.allocations.length === 0 && (
                    <p className="text-[10px] text-amber-600 mt-1 font-medium">
                      ⚠ Keine Allocations gefunden — H&I Import prüfen
                    </p>
                  )}
                </Section>

                {/* KW-Verteilung */}
                <Section title={`Allocations je KW (${data.allocations.length} total)`} defaultOpen={data.allocations.length > 0}>
                  {Object.keys(kwCounts).length === 0 ? (
                    <p className="text-[10px] text-slate-400">Keine Einträge</p>
                  ) : (
                    Object.entries(kwCounts)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([kw, count]) => (
                        <Row key={kw} label={`KW ${kw}`} value={`${count} Einträge`}
                          highlight={defaultWeeks.includes(Number(kw)) === false} />
                      ))
                  )}
                  {Object.keys(kwCounts).length > 0 && (
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      Orange = außerhalb des angezeigten KW-Fensters
                    </p>
                  )}
                </Section>

                {/* Mitarbeiter */}
                <Section title={`Mitarbeiter (${data.employees.length})`}>
                  {data.employees.map((e, i) => {
                    const emp = e as { id: string; name: string; department: string; weekly_capacity_hours: number }
                    const hasAlloc = data.allocations.some((a) => (a as { employee_id: string }).employee_id === emp.id)
                    return (
                      <div key={i} className="py-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-600">{emp.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${hasAlloc ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                            {hasAlloc ? 'hat Alloc.' : 'keine'}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-400 font-mono">{emp.id.slice(0, 8)}…</p>
                      </div>
                    )
                  })}
                </Section>

                {/* Letzte 5 Allocations */}
                <Section title="Letzte 5 Allocations">
                  {data.allocations.length === 0 ? (
                    <p className="text-[10px] text-slate-400">Keine vorhanden</p>
                  ) : (
                    (data.allocations as {
                      employee_name: string; project_number: string
                      lph_number: number; calendar_week: number; allocated_hours: number; source: string
                    }[]).slice(-5).reverse().map((a, i) => (
                      <div key={i} className="py-1 border-b border-slate-50 last:border-0">
                        <div className="flex justify-between">
                          <span className="text-[10px] font-medium text-slate-700">{a.employee_name}</span>
                          <span className="text-[10px] text-slate-500">{a.allocated_hours}h</span>
                        </div>
                        <p className="text-[9px] text-slate-400">
                          {a.project_number} · LPH {a.lph_number} · KW {a.calendar_week} · {a.source}
                        </p>
                      </div>
                    ))
                  )}
                </Section>

                {/* Name-Matching Check */}
                <Section title="H&I Name-Matching Check">
                  <p className="text-[10px] text-slate-400 mb-2">
                    Prüfe ob H&I-Namen mit DB übereinstimmen (lowercase):
                  </p>
                  {['jens buss', 'kira hoffmann', 'tom schreiber', 'lena mayer', 'finn wolters'].map((name) => (
                    <div key={name} className="flex items-center justify-between py-0.5">
                      <span className="text-[10px] text-slate-600">{name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${empNames.has(name) ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {empNames.has(name) ? '✓ Match' : '✗ kein Match'}
                      </span>
                    </div>
                  ))}
                </Section>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}