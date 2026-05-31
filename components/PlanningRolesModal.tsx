'use client'

// Planungsrollen-Verwaltung (Paket 6B-1) — NUR fuer TL.
//
// Verwaltet den globalen Rollenkatalog mit internen Planungssaetzen
// (public.planning_roles). rate_eur_per_hour ist ein ABSTRAKTER interner
// Planungssatz je Rolle und hat NICHTS mit echten Mitarbeiter-Stundensaetzen
// (employees.hourly_rate_eur) zu tun. Keine Verbindung zu allocations,
// project_lph_budgets oder employees.
//
// Schreibrechte werden serverseitig per RLS erzwungen (nur TL). Dieses Modal
// wird ohnehin nur fuer TL gerendert (DashboardHeader).

import { useEffect, useState } from 'react'
import { X, SlidersHorizontal, Plus, Trash2, Check } from 'lucide-react'
import {
  loadPlanningRoles,
  createPlanningRole,
  updatePlanningRole,
  deletePlanningRole,
  type PlanningRole,
} from '@/app/actions/planning-roles'

interface Props {
  onClose: () => void
}

function fmtRate(n: number): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
}

// Deutsche Zahleneingabe -> number. Leer/ungueltig -> NaN.
function parseGermanNumber(raw: string): number {
  const cleaned = raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')
  if (cleaned === '') return NaN
  return Number(cleaned)
}

export default function PlanningRolesModal({ onClose }: Props) {
  const [roles, setRoles] = useState<PlanningRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Lokale Edit-Puffer je Rolle (Name + Satz als String fuer freie Eingabe).
  const [draft, setDraft] = useState<Record<string, { name: string; rate: string }>>({})

  // Neue Rolle
  const [newName, setNewName] = useState('')
  const [newRate, setNewRate] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadPlanningRoles()
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setRoles(res.data)
          setDraft(Object.fromEntries(res.data.map((r) => [r.id, { name: r.name, rate: String(r.rate_eur_per_hour) }])))
        } else { setRoles([]); setError(res.message) }
      })
      .catch((e) => { if (!cancelled) { setRoles([]); setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function setRoleLocal(updated: PlanningRole) {
    setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    setDraft((d) => ({ ...d, [updated.id]: { name: updated.name, rate: String(updated.rate_eur_per_hour) } }))
  }

  async function handleSaveRow(role: PlanningRole) {
    const d = draft[role.id]
    if (!d) return
    const name = d.name.trim()
    const rate = parseGermanNumber(d.rate)
    if (!name) { setError('Name fehlt.'); return }
    if (!Number.isFinite(rate) || rate <= 0) { setError('Planungssatz muss groesser als 0 sein.'); return }
    setBusyId(role.id); setError(null)
    try {
      const res = await updatePlanningRole(role.id, { name, rate_eur_per_hour: rate })
      if (res.success && res.data) setRoleLocal(res.data)
      else setError(res.message || 'Speichern fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally { setBusyId(null) }
  }

  async function handleToggleActive(role: PlanningRole) {
    setBusyId(role.id); setError(null)
    try {
      const res = await updatePlanningRole(role.id, { active: !role.active })
      if (res.success && res.data) setRoleLocal(res.data)
      else setError(res.message || 'Speichern fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally { setBusyId(null) }
  }

  async function handleDelete(role: PlanningRole) {
    if (busyId) return
    setBusyId(role.id); setError(null)
    try {
      const res = await deletePlanningRole(role.id)
      if (res.success) {
        setRoles((prev) => prev.filter((r) => r.id !== role.id))
        setDraft((d) => { const n = { ...d }; delete n[role.id]; return n })
      } else setError(res.message || 'Loeschen fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Loeschen fehlgeschlagen')
    } finally { setBusyId(null) }
  }

  async function handleCreate() {
    const name = newName.trim()
    const rate = parseGermanNumber(newRate)
    if (!name) { setError('Name fehlt.'); return }
    if (!Number.isFinite(rate) || rate <= 0) { setError('Planungssatz muss groesser als 0 sein.'); return }
    setCreating(true); setError(null)
    try {
      const res = await createPlanningRole({ name, rate_eur_per_hour: rate, sort_order: roles.length })
      if (res.success && res.data) {
        const created = res.data
        setRoles((prev) => [...prev, created])
        setDraft((d) => ({ ...d, [created.id]: { name: created.name, rate: String(created.rate_eur_per_hour) } }))
        setNewName(''); setNewRate('')
      } else setError(res.message || 'Anlegen fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen')
    } finally { setCreating(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />

      <div className="relative z-10 w-full max-w-xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-semibold text-slate-700">Planungsrollen</p>
              <p className="text-[11px] text-slate-400">Interne Planungssätze je Rolle</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 transition-colors" title="Schließen">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Hinweis */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-[11px] text-slate-500">
              Abstrakte interne Planungssätze je Rolle (€/h) — <strong>keine echten
              Mitarbeiter-Stundensätze</strong>. Werden später für die rollenbasierte
              Soll-Kapazität genutzt.
            </p>
          </div>

          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Liste */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center bg-slate-50 px-3 py-2 border-b border-slate-100">
              <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Rolle</span>
              <span className="w-28 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Satz (€/h)</span>
              <span className="w-32 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Aktion</span>
            </div>

            {loading ? (
              <p className="text-[11px] text-slate-400 px-3 py-3">Laden…</p>
            ) : roles.length === 0 ? (
              <p className="text-[11px] text-slate-400 px-3 py-3">Noch keine Rollen angelegt.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {roles.map((r) => {
                  const d = draft[r.id] ?? { name: r.name, rate: String(r.rate_eur_per_hour) }
                  const busy = busyId === r.id
                  const dirty = d.name.trim() !== r.name || parseGermanNumber(d.rate) !== r.rate_eur_per_hour
                  return (
                    <div key={r.id} className={`flex items-center gap-2 px-3 py-2 ${r.active ? '' : 'opacity-50'}`}>
                      <input
                        type="text"
                        value={d.name}
                        onChange={(e) => setDraft((dd) => ({ ...dd, [r.id]: { ...d, name: e.target.value } }))}
                        className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={d.rate}
                        onChange={(e) => setDraft((dd) => ({ ...dd, [r.id]: { ...d, rate: e.target.value } }))}
                        className="w-28 text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800 tabular-nums"
                      />
                      <div className="w-32 flex items-center justify-end gap-1.5">
                        {dirty && (
                          <button onClick={() => handleSaveRow(r)} disabled={busy} title="Speichern"
                            className="px-2 py-1 rounded-md bg-slate-800 text-white text-[10px] font-medium hover:bg-slate-700 disabled:opacity-50">
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                        <button onClick={() => handleToggleActive(r)} disabled={busy} title={r.active ? 'Deaktivieren' : 'Aktivieren'}
                          className="px-2 py-1 rounded-md border border-slate-200 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                          {r.active ? 'aktiv' : 'inaktiv'}
                        </button>
                        <button onClick={() => handleDelete(r)} disabled={busy} title="Löschen"
                          className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Neue Rolle */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 bg-slate-50/50">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Neue Rolle"
                className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800"
              />
              <input
                type="text"
                inputMode="decimal"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="€/h"
                className="w-28 text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800 tabular-nums"
              />
              <div className="w-32 flex justify-end">
                <button onClick={handleCreate} disabled={creating}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700 disabled:opacity-50">
                  <Plus className="h-3 w-3" />{creating ? '…' : 'Anlegen'}
                </button>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400">
            Aktuell genutzt: {roles.filter((r) => r.active).map((r) => `${r.name} (${fmtRate(r.rate_eur_per_hour)} €/h)`).join(' · ') || '—'}
          </p>
        </div>
      </div>
    </div>
  )
}
