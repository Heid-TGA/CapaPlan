'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Flag, Circle, GripVertical } from 'lucide-react'
import type { Milestone } from '@/app/actions/terminplan'

interface GanttBarProps {
  lphId: string
  lphNumber: number
  weeks: number[]
  colWidth: number
  startKw: number | null
  endKw: number | null
  milestones: Milestone[]
  color: string
  onChange: (lphId: string, startKw: number, endKw: number) => void
  onSave: (lphId: string, startKw: number, endKw: number) => void
}

// ── Popover ────────────────────────────────────────────────────────────────────

function BarPopover({
  startKw, endKw, onChange, onSave, onClose, anchorRef,
}: {
  startKw: number; endKw: number
  onChange: (s: number, e: number) => void
  onSave: (s: number, e: number) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [ls, setLs] = useState(String(startKw))
  const [le, setLe] = useState(String(endKw))
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setLs(String(startKw)) }, [startKw])
  useEffect(() => { setLe(String(endKw)) }, [endKw])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  return (
    <div ref={popRef}
      className="absolute top-full mt-2 left-0 z-50 bg-white rounded-xl border border-slate-200 shadow-xl p-4 w-52"
      onClick={e => e.stopPropagation()}>
      <div className="absolute -top-1.5 left-5 h-3 w-3 bg-white border-l border-t border-slate-200 rotate-45" />
      <p className="text-xs font-semibold text-slate-700 mb-3">LPH-Zeitraum</p>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1">
          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Start KW</label>
          <input type="number" min="1" max="53" value={ls}
            onChange={e => { setLs(e.target.value); const n=parseInt(e.target.value); if(n>=1&&n<=endKw) onChange(n,endKw) }}
            className="w-full text-sm font-semibold border border-slate-200 rounded-lg px-2 py-2 outline-none focus:border-slate-400 text-center text-slate-800" />
        </div>
        <span className="text-slate-300 mt-5 text-xs">→</span>
        <div className="flex-1">
          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">Ende KW</label>
          <input type="number" min="1" max="53" value={le}
            onChange={e => { setLe(e.target.value); const n=parseInt(e.target.value); if(n>=startKw&&n<=53) onChange(startKw,n) }}
            className="w-full text-sm font-semibold border border-slate-200 rounded-lg px-2 py-2 outline-none focus:border-slate-400 text-center text-slate-800" />
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mb-3">Dauer: {endKw-startKw+1} Woche{endKw-startKw!==0?'n':''}</p>
      <button onClick={() => { onSave(startKw, endKw); onClose() }}
        className="w-full py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors">
        Speichern
      </button>
    </div>
  )
}

// ── GanttBar ───────────────────────────────────────────────────────────────────

export default function GanttBar({
  lphId, lphNumber, weeks, colWidth, startKw, endKw,
  milestones, color, onChange, onSave,
}: GanttBarProps) {
  const [showPopover, setShowPopover] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [resizingLeft, setResizingLeft] = useState(false)
  const [resizingRight, setResizingRight] = useState(false)

  const barRef = useRef<HTMLDivElement>(null)
  const dragStartX = useRef(0)
  const dragStartKw = useRef({ start: 0, end: 0 })
  const didDrag = useRef(false)

  function kwToIdx(kw: number) { return weeks.indexOf(kw) }
  function idxToKw(idx: number) { return weeks[Math.max(0, Math.min(weeks.length-1, idx))]! }
  function snapDelta(x0: number, x1: number) { return Math.round((x1-x0)/colWidth) }

  // ── Move ──────────────────────────────────────────────────────────────────

  const onMoveDown = useCallback((e: React.PointerEvent) => {
    if (startKw === null || endKw === null) return
    e.preventDefault(); e.stopPropagation()
    setDragging(true); setShowPopover(false); didDrag.current = false
    dragStartX.current = e.clientX
    dragStartKw.current = { start: startKw, end: endKw }
    const dur = endKw - startKw
    const capStart = startKw; const capEnd = endKw

    function onMove(ev: PointerEvent) {
      const d = snapDelta(dragStartX.current, ev.clientX)
      if (d !== 0) didDrag.current = true
      const si = Math.max(0, Math.min(weeks.length-1-dur, kwToIdx(dragStartKw.current.start)+d))
      onChange(lphId, idxToKw(si), idxToKw(si+dur))
    }
    function onUp() {
      setDragging(false)
      if (!didDrag.current) setShowPopover(true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [startKw, endKw, weeks, colWidth, lphId, onChange])

  // ── Resize Left ───────────────────────────────────────────────────────────

  const onResizeLeftDown = useCallback((e: React.PointerEvent) => {
    if (startKw === null || endKw === null) return
    e.preventDefault(); e.stopPropagation()
    setResizingLeft(true); setShowPopover(false)
    dragStartX.current = e.clientX
    dragStartKw.current = { start: startKw, end: endKw }
    const capEnd = endKw

    function onMove(ev: PointerEvent) {
      const d = snapDelta(dragStartX.current, ev.clientX)
      const ei = kwToIdx(dragStartKw.current.end)
      const si = Math.max(0, Math.min(ei-1, kwToIdx(dragStartKw.current.start)+d))
      onChange(lphId, idxToKw(si), capEnd)
    }
    function onUp() {
      setResizingLeft(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [startKw, endKw, weeks, colWidth, lphId, onChange])

  // ── Resize Right ──────────────────────────────────────────────────────────

  const onResizeRightDown = useCallback((e: React.PointerEvent) => {
    if (startKw === null || endKw === null) return
    e.preventDefault(); e.stopPropagation()
    setResizingRight(true); setShowPopover(false)
    dragStartX.current = e.clientX
    dragStartKw.current = { start: startKw, end: endKw }
    const capStart = startKw

    function onMove(ev: PointerEvent) {
      const d = snapDelta(dragStartX.current, ev.clientX)
      const si = kwToIdx(dragStartKw.current.start)
      const ei = Math.max(si+1, Math.min(weeks.length-1, kwToIdx(dragStartKw.current.end)+d))
      onChange(lphId, capStart, idxToKw(ei))
    }
    function onUp() {
      setResizingRight(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [startKw, endKw, weeks, colWidth, lphId, onChange])

  // ── Leere Zone ────────────────────────────────────────────────────────────

  if (startKw === null || endKw === null) {
    return (
      <div className="relative flex items-center" style={{ height: 28 }}>
        {weeks.map((kw) => (
          <div key={kw} style={{ width: colWidth, minWidth: colWidth }}
            className="h-full flex items-center justify-center group cursor-pointer border-r border-slate-50"
            onClick={() => {
              const si = weeks.indexOf(kw)
              const ei = Math.min(si+3, weeks.length-1)
              onChange(lphId, kw, weeks[ei]!)
              onSave(lphId, kw, weeks[ei]!)
            }}>
            <div className="opacity-0 group-hover:opacity-40 w-full mx-1 h-4 rounded-full bg-slate-300 transition-opacity" />
          </div>
        ))}
      </div>
    )
  }

  const si = kwToIdx(startKw)
  const ei = kwToIdx(endKw)
  const barCols = Math.max(1, ei - si + 1)
  const lphMs = milestones.filter(m => m.kw >= startKw && m.kw <= endKw)

  return (
    <div className="relative flex items-center" style={{ height: 28 }}>
      {/* Hintergrund-Raster */}
      {weeks.map((kw) => (
        <div key={kw} style={{ width: colWidth, minWidth: colWidth }}
          className="h-full border-r border-slate-50 shrink-0" />
      ))}

      {/* Balken */}
      <div ref={barRef} className="absolute"
        style={{ left: si * colWidth + 3, width: barCols * colWidth - 6, top: 2, bottom: 2 }}>
        <div
          className={`relative h-full rounded-full ${color} flex items-center select-none
            ${dragging ? 'opacity-75 scale-95' : 'opacity-90 hover:opacity-100'}
            transition-all duration-75`}
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={onMoveDown}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Resize L */}
          <div onPointerDown={onResizeRightDown}
            className={`absolute left-0 top-0 bottom-0 w-4 flex items-center justify-start pl-1
              rounded-l-full cursor-ew-resize transition-opacity ${hovered||resizingLeft?'opacity-100':'opacity-0'}`}>
            <GripVertical className="h-2.5 w-2 text-white/60" />
          </div>

          {/* Label */}
          <span className="absolute inset-x-4 text-[9px] font-bold text-white truncate text-center pointer-events-none leading-none">
            LPH {lphNumber}
          </span>

          {/* Meilensteine */}
          {lphMs.map(m => {
            const mi = kwToIdx(m.kw) - si
            const pct = barCols > 1 ? (mi / (barCols-1)) * 100 : 50
            return (
              <div key={m.id} className="absolute inset-y-0 flex items-end pb-0.5 pointer-events-none"
                style={{ left: `${pct}%`, transform: 'translateX(-50%)' }} title={m.description}>
                {m.type === 'external'
                  ? <Flag className="h-2.5 w-2.5 text-white fill-white" />
                  : <Circle className="h-2.5 w-2.5 text-white/70 fill-white/70" />}
              </div>
            )
          })}

          {/* Resize R */}
          <div onPointerDown={onResizeRightDown}
            className={`absolute right-0 top-0 bottom-0 w-4 flex items-center justify-end pr-1
              rounded-r-full cursor-ew-resize transition-opacity ${hovered||resizingRight?'opacity-100':'opacity-0'}`}>
            <GripVertical className="h-2.5 w-2 text-white/60" />
          </div>
        </div>

        {showPopover && (
          <BarPopover
            startKw={startKw} endKw={endKw}
            onChange={(s, e) => onChange(lphId, s, e)}
            onSave={(s, e) => { onSave(lphId, s, e); setShowPopover(false) }}
            onClose={() => setShowPopover(false)}
            anchorRef={barRef as React.RefObject<HTMLDivElement>}
          />
        )}
      </div>
    </div>
  )
}