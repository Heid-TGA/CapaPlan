'use client'

// HOAI-Dummy-Rechner (Paket 6B / Ergaenzung A2 + A2b).
//
// Isoliertes Planungswerkzeug. Die Berechnung ist rein lokal; gespeichert
// werden ueber A2b NUR die Eingaben eines Szenarios (label, anrechenbare
// Kosten, honorar_pct) in public.hoai_calc_scenarios. Die LPH-Verteilung und
// alle Euro-Betraege werden NICHT gespeichert, sondern aus lib/hoai-dummy.ts
// abgeleitet.
//
// ABGRENZUNG (nicht verhandelbar): Ergebnisse sind SZENARIO-Werte und fliessen
// NICHT in project_lph_budgets, allocations, Meilensteine oder Gewerke ein.
// Keine rechtsverbindliche HOAI-Berechnung. Kein automatisches Uebernehmen in
// Projektbudgets.

import { useEffect, useState } from 'react'
import { X, Calculator, Save, Trash2 } from 'lucide-react'
import { calcHoaiDummy, HOAI_DUMMY_HONORAR_PCT, HOAI_DUMMY_SPLIT_SUM } from '@/lib/hoai-dummy'
import { LPH_LABELS } from '@/lib/planning-phases'
import {
  loadHoaiScenarios,
  createHoaiScenario,
  deleteHoaiScenario,
  type HoaiScenario,
} from '@/app/actions/hoai-scenarios'

interface Props {
  projectId: string
  projectName?: string
  onClose: () => void
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

// Parst deutsche Zahleneingaben: entfernt Tausenderpunkte/Leerzeichen/€,
// akzeptiert Komma als Dezimaltrenner. Leere/ungueltige Eingabe → NaN.
function parseGermanNumber(raw: string): number {
  const cleaned = raw
    .replace(/[€%\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  if (cleaned === '') return NaN
  return Number(cleaned)
}

export default function HoaiCalculatorModal({ projectId, projectName, onClose }: Props) {
  const [label, setLabel] = useState('Angebot v1')
  const [input, setInput] = useState('')
  const [pctInput, setPctInput] = useState(String(HOAI_DUMMY_HONORAR_PCT))

  const [scenarios, setScenarios] = useState<HoaiScenario[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const kosten = parseGermanNumber(input)
  const hasValue = Number.isFinite(kosten) && kosten > 0
  const pct = parseGermanNumber(pctInput)
  const hasPct = Number.isFinite(pct) && pct > 0 && pct <= 100
  const result = calcHoaiDummy(hasValue ? kosten : 0, hasPct ? pct : 0)

  const canSave = hasValue && hasPct && label.trim() !== '' && !saving

  // Gespeicherte Szenarien beim Oeffnen laden.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadHoaiScenarios(projectId)
      .then((res) => {
        if (cancelled) return
        if (res.success) setScenarios(res.data)
        else { setScenarios([]); setError(res.message) }
      })
      .catch((e) => { if (!cancelled) { setScenarios([]); setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  async function handleSave() {
    if (!canSave) return
    setSaving(true); setError(null)
    try {
      const res = await createHoaiScenario(projectId, {
        label: label.trim(),
        anrechenbare_kosten: kosten,
        honorar_pct: pct,
      })
      if (!res.success || !res.data) { setError(res.message || 'Speichern fehlgeschlagen'); return }
      setScenarios((prev) => [res.data!, ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  // Klick auf ein Szenario laedt dessen Werte zurueck ins Formular.
  function handleLoad(s: HoaiScenario) {
    setLabel(s.label)
    setInput(new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(s.anrechenbare_kosten))
    setPctInput(String(s.honorar_pct))
    setError(null)
  }

  async function handleDelete(id: string) {
    if (deletingId) return
    setDeletingId(id); setError(null)
    try {
      const res = await deleteHoaiScenario(id)
      if (res.success) setScenarios((prev) => prev.filter((s) => s.id !== id))
      else setError(res.message || 'Loeschen fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Loeschen fehlgeschlagen')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-700">HOAI-Rechner (Dummy)</p>
              {projectName && <p className="text-[11px] text-slate-400">{projectName}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 transition-colors" title="Schließen">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Unverbindlich-Hinweis */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-[11px] text-amber-700">
              Vereinfachter Planungs-/Dummy-Rechner für TGA — <strong>keine rechtsverbindliche
              HOAI-Berechnung</strong>. Gespeicherte Szenarien sind reine Planungswerte und werden
              <strong> nicht</strong> in Projektbudgets übernommen.
            </p>
          </div>

          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Eingaben */}
          <div className="space-y-2.5">
            <div>
              <label htmlFor="hoai-label" className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                Bezeichnung
              </label>
              <input
                id="hoai-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. Angebot v1"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 text-slate-800"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="hoai-kosten" className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                  Anrechenbare Kosten (€)
                </label>
                <input
                  id="hoai-kosten"
                  type="text"
                  inputMode="decimal"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="z. B. 1.000.000"
                  autoFocus
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 text-slate-800"
                />
              </div>
              <div className="w-28">
                <label htmlFor="hoai-pct" className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                  Honorar (%)
                </label>
                <input
                  id="hoai-pct"
                  type="text"
                  inputMode="decimal"
                  value={pctInput}
                  onChange={(e) => setPctInput(e.target.value)}
                  placeholder="12"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 text-slate-800"
                />
              </div>
            </div>
            {input.trim() !== '' && !hasValue && (
              <p className="text-[11px] text-red-500">Anrechenbare Kosten: bitte eine positive Zahl eingeben.</p>
            )}
            {pctInput.trim() !== '' && !hasPct && (
              <p className="text-[11px] text-red-500">Honorarsatz: Wert zwischen 0 und 100.</p>
            )}
          </div>

          {/* Gesamthonorar */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Gesamthonorar</p>
              <p className="text-[11px] text-slate-400">{hasPct ? pct : HOAI_DUMMY_HONORAR_PCT}% der anrechenbaren Kosten</p>
            </div>
            <p className="text-xl font-semibold text-slate-800">{hasValue && hasPct ? fmtEur(result.totalHonorar) : '—'}</p>
          </div>

          {/* LPH-Verteilung */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center bg-slate-50 px-4 py-2 border-b border-slate-100">
              <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Leistungsphase</span>
              <span className="w-14 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Anteil</span>
              <span className="w-28 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Honorar</span>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {result.rows.map((r) => (
                <div key={r.lph} className="flex items-center px-4 py-1.5 border-b border-slate-50 last:border-b-0">
                  <span className="flex-1 text-xs text-slate-700">
                    <span className="font-semibold">LPH {r.lph}</span>
                    <span className="text-slate-400"> · {LPH_LABELS[r.lph]}</span>
                  </span>
                  <span className="w-14 text-right text-xs text-slate-500 tabular-nums">{r.pct}%</span>
                  <span className="w-28 text-right text-xs font-medium text-slate-700 tabular-nums">
                    {hasValue && hasPct ? fmtEur(r.honorar) : '—'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center bg-slate-50 px-4 py-2 border-t border-slate-200">
              <span className="flex-1 text-xs font-semibold text-slate-500">Summe</span>
              <span className="w-14 text-right text-xs font-semibold text-slate-500 tabular-nums">{HOAI_DUMMY_SPLIT_SUM}%</span>
              <span className="w-28 text-right text-xs font-semibold text-slate-700 tabular-nums">
                {hasValue && hasPct ? fmtEur(result.totalHonorar) : '—'}
              </span>
            </div>
          </div>

          {/* Speichern */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-3.5 w-3.5" />{saving ? 'Speichern…' : 'Szenario speichern'}
          </button>

          {/* Gespeicherte Szenarien */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Gespeicherte Szenarien (Dummy)
            </p>
            {loading ? (
              <p className="text-[11px] text-slate-400 px-1 py-2">Laden…</p>
            ) : scenarios.length === 0 ? (
              <p className="text-[11px] text-slate-400 px-1 py-2">Noch keine Szenarien gespeichert.</p>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {scenarios.map((s) => {
                  const total = calcHoaiDummy(s.anrechenbare_kosten, s.honorar_pct).totalHonorar
                  return (
                    <div key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50/60">
                      <button onClick={() => handleLoad(s)} className="flex-1 text-left min-w-0" title="Werte laden">
                        <p className="text-xs font-medium text-slate-700 truncate">{s.label}</p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {fmtEur(s.anrechenbare_kosten)} · {s.honorar_pct}% → {fmtEur(total)}
                        </p>
                      </button>
                      <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 text-[9px] font-semibold uppercase tracking-wide">Dummy</span>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        title="Szenario löschen"
                        className="shrink-0 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-400">
            Aus dem Honorar je LPH wird später die rollenbasierte Soll-Kapazität abgeleitet (Paket 6B).
            Keine Übernahme in Budgets, keine echte HOAI-Berechnung.
          </p>
        </div>
      </div>
    </div>
  )
}
