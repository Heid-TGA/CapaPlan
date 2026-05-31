'use client'

import { useState, useRef, useEffect } from 'react'
import type { WeekRef } from '@/lib/calendar-weeks'

interface GanttBarProps {
  lphId: string
  lphNumber: number
  weeks: WeekRef[]          // sichtbares Fenster (ISO-Wochen mit Jahr)
  planYear: number          // plan_year der LPH-Zeile (Jahr von start_kw/end_kw)
  colWidth: number
  startKw: number | null
  endKw: number | null
  color: string
  istHours?: number         // IST-Stunden (aus Mitarbeiter-Matrix, KW-verteilt)
  sollHours?: number        // SOLL-Stunden (Soll-Modell: budget × share / rate)
  hasSollBudget?: boolean    // 9C: false = kein wirksames Sollbudget -> "kein Budget"/"—"
  tooltip?: string           // 9C: Hover-Text (LPH · IST · SOLL · Budgetbasis)
  onChange: (lphId: string, startKw: number, endKw: number, planYear: number) => void
  onSave: (lphId: string, startKw: number, endKw: number, planYear: number) => void
}

// Drag & Resize Gantt-Balken für eine LPH-Zeile.
// Positioniert sich über (week, year) im sichtbaren Fenster und schreibt echte
// KW-Werte + plan_year zurück. Jahreswechsel-sicher: ein KW-Wert wird nur in
// seinem plan_year-Jahr getroffen. Balken ohne Termin (startKw/endKw null)
// erscheinen weiterhin als Default-Balken zum Anlegen per Drag.
export default function GanttBar({
  lphId, lphNumber, weeks, planYear, colWidth, startKw, endKw, color,
  istHours = 0, sollHours = 0, hasSollBudget = true, tooltip, onChange, onSave,
}: GanttBarProps) {
  const [drag, setDrag] = useState<null | { mode: 'move' | 'resize-l' | 'resize-r'; startX: number; origStart: number; origEnd: number }>(null)
  // Zuletzt emittierte Werte — vermeidet stale-closure beim mouseup/onSave.
  const lastRef = useRef<{ startKw: number; endKw: number; year: number } | null>(null)

  const hasSchedule = startKw != null && endKw != null

  // Fenster-Spalten, die im Termin [startKw..endKw] des plan_year liegen (jahres-
  // sicher). Statt nur die Kanten zu suchen, werden alle Spalten im Zeitraum
  // betrachtet — so bleibt ein Balken auch sichtbar, wenn er das Fenster komplett
  // überspannt (beide Kanten außerhalb). Clipping passiert über erste/letzte
  // Treffer-Spalte; liegt der Balken komplett außerhalb, gibt es keinen Treffer.
  const inSched = (w: WeekRef) =>
    hasSchedule && w.year === planYear && w.week >= startKw! && w.week <= endKw!
  const firstIdx = hasSchedule ? weeks.findIndex(inSched) : -1
  let lastIdx = -1
  if (hasSchedule) {
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (inSched(weeks[i])) { lastIdx = i; break }
    }
  }

  // Sichtbarkeit: Ohne Termin immer (Default-Balken zum Anlegen). Mit Termin nur,
  // wenn mindestens eine Fensterspalte im Zeitraum liegt.
  const renderBar = !hasSchedule || firstIdx >= 0

  // Position inkl. Clipping an den Fensterrändern.
  const barStart = !hasSchedule ? 0 : firstIdx
  const barEnd = !hasSchedule ? Math.min(weeks.length - 1, 1) : lastIdx

  const left = barStart * colWidth
  const width = (barEnd - barStart + 1) * colWidth

  const onMouseDown = (mode: 'move' | 'resize-l' | 'resize-r') => (e: React.MouseEvent) => {
    e.stopPropagation()
    lastRef.current = null
    setDrag({ mode, startX: e.clientX, origStart: barStart, origEnd: barEnd })
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent) => {
      const deltaCol = Math.round((e.clientX - drag.startX) / colWidth)
      let ns = drag.origStart, ne = drag.origEnd
      if (drag.mode === 'move') { ns = drag.origStart + deltaCol; ne = drag.origEnd + deltaCol }
      if (drag.mode === 'resize-l') { ns = drag.origStart + deltaCol }
      if (drag.mode === 'resize-r') { ne = drag.origEnd + deltaCol }
      ns = Math.max(0, Math.min(weeks.length - 1, ns))
      ne = Math.max(ns, Math.min(weeks.length - 1, ne))
      const newStart = weeks[ns]
      const newEnd = weeks[ne]
      if (newStart && newEnd) {
        // plan_year folgt der Startspalte (Modell: ein plan_year je LPH-Zeile).
        lastRef.current = { startKw: newStart.week, endKw: newEnd.week, year: newStart.year }
        onChange(lphId, newStart.week, newEnd.week, newStart.year)
      }
    }
    const onUp = () => {
      setDrag(null)
      const last = lastRef.current
      if (last) onSave(lphId, last.startKw, last.endKw, last.year)
      else if (startKw && endKw) onSave(lphId, startKw, endKw, planYear)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, colWidth, weeks, lphId, startKw, endKw, planYear, onChange, onSave])

  return (
    <div className="absolute inset-0">
      {weeks.map((_, i) => {
        const inBar = renderBar && i >= barStart && i <= barEnd
        return (
          <div key={i}
            className={`absolute top-0 bottom-0`}
            style={{ left: i * colWidth, width: colWidth }}
            onMouseDown={inBar ? onMouseDown('move') : undefined}
          >
          </div>
        )
      })}

      {/* Sichtbarer Balken — nur wenn (teilweise) im Fenster bzw. anlegbar */}
      {renderBar && (
        <div
          className={`absolute top-1 bottom-1 rounded-md ${color} cursor-move flex items-center justify-between group`}
          style={{ left: `${left}px`, width: `${width}px` }}
          title={tooltip}
          onMouseDown={onMouseDown('move')}
        >
          <div onMouseDown={onMouseDown('resize-l')}
            className="w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-l-md" />
          {/* 9C: Beschriftung LPH · IST / SOLL. Ohne wirksames Sollbudget zeigt der
              SOLL-Teil "kein Budget" (bzw. "—" bei schmalem Balken) statt 0h. */}
          <span className="text-[10px] text-white/90 font-medium px-1 truncate pointer-events-none">
            LPH {lphNumber} · {Math.round(istHours)}h / {hasSollBudget ? `${Math.round(sollHours)}h` : (width >= 150 ? 'kein Budget' : '—')}
          </span>
          <div onMouseDown={onMouseDown('resize-r')}
            className="w-2 h-full cursor-ew-resize hover:bg-black/10 rounded-r-md" />
        </div>
      )}
    </div>
  )
}
