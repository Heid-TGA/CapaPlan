'use client'

// HOAI-Rechner je Anlagengruppe (Paket 10.4; baut auf Paket 6B / A2b auf).
//
// Isoliertes Planungswerkzeug. Ein Szenario hat jetzt je AG 1–5 eine eigene
// Tabelle: anrechenbare Kosten, Honorarsatz, ein FESTES „Grundhonorar"
// (= anrechenbare Kosten × Honorar-% / 100, unabhaengig von der LPH-Auswahl)
// und darunter LPH 1–9 mit Checkbox + editierbarem Anteil. Die untere Summenzeile
// zeigt NUR die AUSGEWAEHLTEN LPH-Prozente bzw. -Honorare (nicht zwingend 100 %).
//
// Persistenz: hoai_calc_scenarios (Header) + hoai_scenario_ag (AG-Konfig) +
// hoai_scenario_ag_lph (LPH-Auswahl/-Prozente). Speichern/Laden ueber die
// Server Actions saveHoaiScenarioDetail / loadHoaiScenarioDetail.
//
// ABGRENZUNG (nicht verhandelbar): Ergebnisse sind SZENARIO-Werte und
// ueberschreiben KEINE Abacus-Budgets (project_lph_budgets). Keine
// rechtsverbindliche HOAI-Berechnung. Die Uebernahme der AG-Budgets nach
// project_ag_budgets erfolgt separat in der Projektplanung (Budgetquelle 'hoai').

import { useEffect, useState } from 'react'
import { X, Calculator, Save, Trash2, Plus } from 'lucide-react'
import { LPH_LABELS } from '@/lib/planning-phases'
import { ANLAGENGRUPPEN } from '@/lib/anlagengruppen'
import {
  HOAI_AG_LPH_NUMBERS,
  HOAI_AG_LPH_DEFAULT_PCT,
  grundhonorar,
  lphHonorar,
  agSelectedSums,
  type HoaiAgConfig,
} from '@/lib/hoai-ag'
import {
  loadHoaiScenarios,
  deleteHoaiScenario,
  saveHoaiScenarioDetail,
  loadHoaiScenarioDetail,
  type HoaiScenario,
} from '@/app/actions/hoai-scenarios'
import {
  loadProjectBudgetAreas,
  ensureDefaultBudgetAreas,
  type BudgetArea,
} from '@/app/actions/budget-areas'

interface Props {
  projectId: string
  projectName?: string
  onClose: () => void
}

// ── Editier-Modell (Strings fuer Eingabefelder; Zahlen werden abgeleitet) ─────
interface LphEdit {
  lph_number: number
  selected: boolean
  pctInput: string
}
interface AgEdit {
  ag_number: number
  enabled: boolean
  kostenInput: string
  pctInput: string
  lphs: LphEdit[]
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}
function fmtPct(n: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(n)
}

// Parst deutsche Zahleneingaben: entfernt Tausenderpunkte/Leerzeichen/€/%,
// akzeptiert Komma als Dezimaltrenner. Leere/ungueltige Eingabe -> 0.
function parseGermanNumber(raw: string): number {
  const cleaned = (raw ?? '').replace(/[€%\s]/g, '').replace(/\./g, '').replace(',', '.')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : 0
}
// Prozent-Eingabe -> 0..100. Leer/ungueltig -> 0.
function parsePct(raw: string): number {
  const cleaned = (raw ?? '').replace(/[%\s]/g, '').replace(',', '.')
  if (cleaned === '') return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

// Default-Editiermodell fuer AG 1–5 (alle deaktiviert, LPH 1–9 ausgewaehlt).
function defaultAgEdits(): AgEdit[] {
  return ANLAGENGRUPPEN.map((g) => ({
    ag_number: g.ag,
    enabled: false,
    kostenInput: '',
    pctInput: '12',
    lphs: HOAI_AG_LPH_NUMBERS.map((n) => ({
      lph_number: n,
      selected: true,
      pctInput: String(HOAI_AG_LPH_DEFAULT_PCT[n] ?? 0),
    })),
  }))
}

// Editiermodell -> Rechen-/Speichermodell (HoaiAgConfig).
function toConfig(e: AgEdit): HoaiAgConfig {
  return {
    ag_number: e.ag_number,
    enabled: e.enabled,
    anrechenbare_kosten: parseGermanNumber(e.kostenInput),
    honorar_pct: parsePct(e.pctInput),
    lphs: e.lphs.map((l) => ({ lph_number: l.lph_number, selected: l.selected, pct: parsePct(l.pctInput) })),
  }
}

export default function HoaiCalculatorModal({ projectId, projectName, onClose }: Props) {
  const [label, setLabel] = useState('Angebot v1')
  const [areaId, setAreaId] = useState<string>('') // '' = Ohne Bereich / Gesamt
  const [currentScenarioId, setCurrentScenarioId] = useState<string | null>(null)
  const [ags, setAgs] = useState<AgEdit[]>(defaultAgEdits)

  const [scenarios, setScenarios] = useState<HoaiScenario[]>([])
  const [areas, setAreas] = useState<BudgetArea[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const areaName = (id: string | null): string =>
    id ? (areas.find((a) => a.id === id)?.name ?? 'Bereich gelöscht') : 'ohne Bereich'

  // ── Abgeleitete Werte ──────────────────────────────────────────────────────
  const configs = ags.map(toConfig)
  const enabledWithKosten = configs.some((c) => c.enabled && c.anrechenbare_kosten > 0)
  const canSave = label.trim() !== '' && enabledWithKosten && !saving

  // Gespeicherte Szenarien + Budgetbereiche beim Oeffnen laden.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadHoaiScenarios(projectId), loadProjectBudgetAreas(projectId)])
      .then(([scRes, arRes]) => {
        if (cancelled) return
        if (scRes.success) setScenarios(scRes.data)
        else { setScenarios([]); setError(scRes.message) }
        if (arRes.success) setAreas(arRes.data)
        else setAreas([])
      })
      .catch((e) => { if (!cancelled) { setScenarios([]); setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  async function handleSeedAreas() {
    if (seeding) return
    setSeeding(true); setError(null)
    try {
      const res = await ensureDefaultBudgetAreas(projectId)
      if (res.success) setAreas(res.data)
      else setError(res.message || 'Bereiche konnten nicht angelegt werden')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bereiche konnten nicht angelegt werden')
    } finally {
      setSeeding(false)
    }
  }

  // ── Editier-Aktionen ─────────────────────────────────────────────────────────
  function toggleAg(ag: number) {
    setAgs((prev) => prev.map((e) => (e.ag_number === ag ? { ...e, enabled: !e.enabled } : e)))
  }
  function setAgField(ag: number, field: 'kostenInput' | 'pctInput', value: string) {
    setAgs((prev) => prev.map((e) => (e.ag_number === ag ? { ...e, [field]: value } : e)))
  }
  function toggleLph(ag: number, lph: number) {
    setAgs((prev) => prev.map((e) =>
      e.ag_number === ag
        ? { ...e, lphs: e.lphs.map((l) => (l.lph_number === lph ? { ...l, selected: !l.selected } : l)) }
        : e
    ))
  }
  function setLphPct(ag: number, lph: number, value: string) {
    setAgs((prev) => prev.map((e) =>
      e.ag_number === ag
        ? { ...e, lphs: e.lphs.map((l) => (l.lph_number === lph ? { ...l, pctInput: value } : l)) }
        : e
    ))
  }

  // Formular auf „neues Szenario" zuruecksetzen.
  function handleNew() {
    setCurrentScenarioId(null)
    setLabel('Angebot v1')
    setAreaId('')
    setAgs(defaultAgEdits())
    setError(null)
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true); setError(null)
    try {
      const res = await saveHoaiScenarioDetail(projectId, {
        id: currentScenarioId,
        label: label.trim(),
        area_id: areaId || null,
        ags: configs.map((c) => ({
          ag_number: c.ag_number,
          enabled: c.enabled,
          anrechenbare_kosten: c.anrechenbare_kosten,
          honorar_pct: c.honorar_pct,
          lphs: c.lphs.map((l) => ({ lph_number: l.lph_number, selected: l.selected, pct: l.pct })),
        })),
      })
      if (!res.success || !res.data) { setError(res.message || 'Speichern fehlgeschlagen'); return }
      setCurrentScenarioId(res.data.id)
      // Szenario-Liste aktualisieren (neu oben einsortieren bzw. ersetzen).
      const listRes = await loadHoaiScenarios(projectId)
      if (listRes.success) setScenarios(listRes.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  // Klick auf ein Szenario laedt dessen Detail (Header + AG- + LPH-Zeilen).
  async function handleLoad(s: HoaiScenario) {
    if (loadingDetailId) return
    setLoadingDetailId(s.id); setError(null)
    try {
      const res = await loadHoaiScenarioDetail(s.id)
      if (!res.success || !res.data) { setError(res.message || 'Laden fehlgeschlagen'); return }
      const d = res.data
      setCurrentScenarioId(d.id)
      setLabel(d.label)
      setAreaId(d.area_id && areas.some((a) => a.id === d.area_id) ? d.area_id : '')
      setAgs(ANLAGENGRUPPEN.map((g) => {
        const a = d.ags.find((x) => x.ag_number === g.ag)
        return {
          ag_number: g.ag,
          enabled: a ? a.enabled : false,
          kostenInput: a && a.anrechenbare_kosten > 0
            ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(a.anrechenbare_kosten)
            : '',
          pctInput: a ? String(a.honorar_pct) : '12',
          lphs: HOAI_AG_LPH_NUMBERS.map((n) => {
            const l = a?.lphs.find((x) => x.lph_number === n)
            return {
              lph_number: n,
              selected: l ? l.selected : true,
              pctInput: String(l ? l.pct : (HOAI_AG_LPH_DEFAULT_PCT[n] ?? 0)),
            }
          }),
        }
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    } finally {
      setLoadingDetailId(null)
    }
  }

  async function handleDelete(id: string) {
    if (deletingId) return
    setDeletingId(id); setError(null)
    try {
      const res = await deleteHoaiScenario(id)
      if (res.success) {
        setScenarios((prev) => prev.filter((s) => s.id !== id))
        if (currentScenarioId === id) handleNew()
      } else setError(res.message || 'Loeschen fehlgeschlagen')
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
      <div className="relative z-10 w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-700">HOAI-Rechner je Anlagengruppe</p>
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
              HOAI-Berechnung</strong>. Das <strong>Grundhonorar</strong> je AG ist fest
              (anrechenbare Kosten × Honorar-%); die untere Summe zeigt nur die <strong>ausgewählten</strong>
              LPH. Gespeicherte Szenarien überschreiben <strong>keine Abacus-Budgets</strong>.
            </p>
          </div>

          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Kopf: Bezeichnung + Budgetbereich + Neu */}
          <div className="space-y-2.5">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
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
              <button
                type="button"
                onClick={handleNew}
                title="Neues Szenario beginnen"
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />Neu
              </button>
            </div>
            <div>
              <label htmlFor="hoai-area" className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                Budgetbereich
              </label>
              {areas.length === 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Keine Bereiche angelegt.</span>
                  <button
                    type="button"
                    onClick={handleSeedAreas}
                    disabled={seeding}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    {seeding ? 'Anlegen…' : 'Standardbereiche anlegen'}
                  </button>
                </div>
              ) : (
                <select
                  id="hoai-area"
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 text-slate-800 bg-white"
                >
                  <option value="">Ohne Bereich / Gesamt</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* AG-Auswahl (AG 1–5) — nur aktivierte AG zeigen unten ihre Tabelle. */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Beauftragte Anlagengruppen
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {ANLAGENGRUPPEN.map((g) => {
                const e = ags.find((x) => x.ag_number === g.ag)!
                return (
                  <label
                    key={g.ag}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${e.enabled ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={e.enabled}
                      onChange={() => toggleAg(g.ag)}
                      className="h-3.5 w-3.5 accent-slate-700"
                    />
                    <span className="text-xs text-slate-700 truncate" title={g.label}>{g.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Pro aktivierter AG: eigene Tabelle. */}
          {configs.every((c) => !c.enabled) ? (
            <p className="text-[11px] text-slate-400 px-1 py-2">
              Keine Anlagengruppe aktiviert. Oben mindestens eine AG anhaken, um deren HOAI-Tabelle zu zeigen.
            </p>
          ) : (
            <div className="space-y-4">
              {ags.map((e) => {
                if (!e.enabled) return null
                const g = ANLAGENGRUPPEN.find((x) => x.ag === e.ag_number)!
                const c = toConfig(e)
                const grund = grundhonorar(c.anrechenbare_kosten, c.honorar_pct)
                const sums = agSelectedSums(c)
                return (
                  <div key={e.ag_number} className="rounded-lg border border-slate-200 overflow-hidden">
                    {/* AG-Kopf */}
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-700">{g.label}</p>
                      <p className="text-[10px] text-slate-400">Gewerk: {g.gewerk}</p>
                    </div>

                    <div className="p-4 space-y-3">
                      {/* Eingaben + Grundhonorar */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                            Anrechenbare Kosten (€)
                          </label>
                          <input
                            type="text" inputMode="decimal"
                            value={e.kostenInput}
                            onChange={(ev) => setAgField(e.ag_number, 'kostenInput', ev.target.value)}
                            placeholder="z. B. 1.000.000"
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 text-slate-800"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block text-[10px] text-slate-400 uppercase tracking-wide mb-1">
                            Honorar (%)
                          </label>
                          <input
                            type="text" inputMode="decimal"
                            value={e.pctInput}
                            onChange={(ev) => setAgField(e.ag_number, 'pctInput', ev.target.value)}
                            placeholder="12"
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-slate-400 text-slate-800"
                          />
                        </div>
                      </div>

                      {/* Grundhonorar (fest) */}
                      <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-2.5">
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Grundhonorar</p>
                          <p className="text-[11px] text-slate-400">
                            {fmtPct(c.honorar_pct)}% der anrechenbaren Kosten — fest, unabhängig von der LPH-Auswahl
                          </p>
                        </div>
                        <p className="text-lg font-semibold text-slate-800 tabular-nums">
                          {c.anrechenbare_kosten > 0 ? fmtEur(grund) : '—'}
                        </p>
                      </div>

                      {/* LPH-Tabelle 1–9 */}
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="flex items-center bg-slate-50 px-3 py-2 border-b border-slate-100">
                          <span className="w-5" />
                          <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Leistungsphase</span>
                          <span className="w-20 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Anteil %</span>
                          <span className="w-28 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Honorar</span>
                        </div>
                        {e.lphs.map((l) => {
                          const lphPct = parsePct(l.pctInput)
                          const honorar = lphHonorar(grund, lphPct)
                          return (
                            <div key={l.lph_number} className={`flex items-center px-3 py-1.5 border-b border-slate-50 last:border-b-0 ${l.selected ? '' : 'opacity-50'}`}>
                              <span className="w-5 flex items-center">
                                <input
                                  type="checkbox"
                                  checked={l.selected}
                                  onChange={() => toggleLph(e.ag_number, l.lph_number)}
                                  className="h-3.5 w-3.5 accent-slate-700"
                                  title="LPH aus-/abwählen"
                                />
                              </span>
                              <span className="flex-1 text-xs text-slate-700 truncate">
                                <span className="font-semibold">LPH {l.lph_number}</span>
                                <span className="text-slate-400"> · {LPH_LABELS[l.lph_number]}</span>
                              </span>
                              <span className="w-20 flex justify-end">
                                <input
                                  type="text" inputMode="decimal"
                                  value={l.pctInput}
                                  onChange={(ev) => setLphPct(e.ag_number, l.lph_number, ev.target.value)}
                                  className="w-16 text-right text-xs border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-700 tabular-nums"
                                />
                              </span>
                              <span className="w-28 text-right text-xs font-medium text-slate-700 tabular-nums">
                                {c.anrechenbare_kosten > 0 && l.selected ? fmtEur(honorar) : '—'}
                              </span>
                            </div>
                          )
                        })}
                        {/* Ausgewählte Summe (NICHT zwingend 100 %). */}
                        <div className="flex items-center bg-slate-50 px-3 py-2 border-t border-slate-200">
                          <span className="w-5" />
                          <span className="flex-1 text-xs font-semibold text-slate-500">Ausgewählt</span>
                          <span className="w-20 text-right text-xs font-semibold text-slate-600 tabular-nums">{fmtPct(sums.pctSum)}%</span>
                          <span className="w-28 text-right text-xs font-semibold text-slate-800 tabular-nums">
                            {c.anrechenbare_kosten > 0 ? fmtEur(sums.honorarSum) : '—'}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        AG-Budget (für Übernahme) = ausgewähltes Honorar = <strong>{c.anrechenbare_kosten > 0 ? fmtEur(sums.honorarSum) : '—'}</strong>.
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Speichern */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-3.5 w-3.5" />{saving ? 'Speichern…' : (currentScenarioId ? 'Szenario aktualisieren' : 'Szenario speichern')}
          </button>
          {!enabledWithKosten && (
            <p className="text-[10px] text-slate-400 -mt-2">
              Zum Speichern mindestens eine AG aktivieren und deren anrechenbare Kosten eintragen.
            </p>
          )}

          {/* Gespeicherte Szenarien */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Gespeicherte Szenarien
            </p>
            {loading ? (
              <p className="text-[11px] text-slate-400 px-1 py-2">Laden…</p>
            ) : scenarios.length === 0 ? (
              <p className="text-[11px] text-slate-400 px-1 py-2">Noch keine Szenarien gespeichert.</p>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {scenarios.map((s) => {
                  // Header haelt fuer AG-Szenarien Σ aktive AG-Kosten + gewichteten Satz;
                  // kosten×pct/100 entspricht daher dem Gesamt-Grundhonorar.
                  const totalGrund = (s.anrechenbare_kosten * s.honorar_pct) / 100
                  const isCurrent = currentScenarioId === s.id
                  return (
                    <div key={s.id} className={`flex items-center gap-2 px-3 py-2 hover:bg-slate-50/60 ${isCurrent ? 'bg-slate-50' : ''}`}>
                      <button onClick={() => handleLoad(s)} disabled={loadingDetailId === s.id} className="flex-1 text-left min-w-0 disabled:opacity-50" title="Szenario laden">
                        <p className="text-xs font-medium text-slate-700 truncate">
                          {s.label} <span className="font-normal text-slate-400">· {areaName(s.area_id)}</span>
                          {isCurrent && <span className="ml-1.5 text-[10px] text-emerald-600 font-semibold">· geladen</span>}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          Grundhonorar gesamt {fmtEur(totalGrund)}
                          {loadingDetailId === s.id && ' · lädt…'}
                        </p>
                      </button>
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
            Gespeicherte HOAI-Szenarien können in der Projektplanung als <strong>Budgetquelle</strong> gewählt
            werden. Pro AG fließt dann die Summe der <strong>ausgewählten LPH-Honorare</strong> in die
            AG-Budgets (HLKS = AG 1–3, Elektro = AG 4–5). Es bleibt eine Schätzlogik; Abacus-Budgets werden
            nicht überschrieben.
          </p>
        </div>
      </div>
    </div>
  )
}
