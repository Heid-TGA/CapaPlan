'use client'

import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { loadPlanningRoles, type PlanningRole } from '@/app/actions/planning-roles'
import { loadRolePlanDefaults, saveRolePlanDefaultGroup } from '@/app/actions/role-plan-defaults'
import {
  ROLE_PLAN_DEFAULT_GROUPS,
  ROLE_PLAN_DEFAULT_GROUP_LABELS,
  type RolePlanDefaultGroup,
} from '@/lib/role-plan-defaults'

// Paket 7C — Default-Rollenverteilung. Oeffnet sich aus
// „Einstellungen > Default-Rollenverteilung". Pflegt nur globale Vorlagen
// (public.role_plan_defaults); keine echten Zuweisungen, keine allocations.

interface RolePlanDefaultsModalProps {
  onClose: () => void
}

function parseShare(v: string | undefined): number {
  if (v == null || v.trim() === '') return 0
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export default function RolePlanDefaultsModal({ onClose }: RolePlanDefaultsModalProps) {
  const [roles, setRoles] = useState<PlanningRole[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // shares[groupKey][roleId] = "%"-String
  const [shares, setShares] = useState<Record<string, Record<string, string>>>({})
  const [savingGroup, setSavingGroup] = useState<RolePlanDefaultGroup | null>(null)
  const [groupMsg, setGroupMsg] = useState<Record<string, string>>({})
  const [groupErr, setGroupErr] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadPlanningRoles(), loadRolePlanDefaults()])
      .then(([rolesRes, defaultsRes]) => {
        if (cancelled) return
        if (!rolesRes.success) { setLoadError(rolesRes.message); return }
        const activeRoles = rolesRes.data.filter((r) => r.active)
        setRoles(activeRoles)

        const next: Record<string, Record<string, string>> = {}
        for (const g of ROLE_PLAN_DEFAULT_GROUPS) next[g] = {}
        if (defaultsRes.success) {
          for (const d of defaultsRes.data) {
            if (!next[d.group_key]) next[d.group_key] = {}
            next[d.group_key][d.role_id] = String(d.share_pct)
          }
        }
        setShares(next)
      })
      .catch(() => { if (!cancelled) setLoadError('Daten konnten nicht geladen werden.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function setShare(group: string, roleId: string, value: string) {
    setShares((s) => ({ ...s, [group]: { ...(s[group] ?? {}), [roleId]: value } }))
    setGroupMsg((m) => ({ ...m, [group]: '' }))
  }

  function groupSum(group: string): number {
    const g = shares[group] ?? {}
    const sum = roles.reduce((acc, r) => acc + parseShare(g[r.id]), 0)
    return Math.round(sum * 10) / 10
  }

  async function handleSaveGroup(group: RolePlanDefaultGroup) {
    setSavingGroup(group)
    setGroupErr((e) => ({ ...e, [group]: '' }))
    setGroupMsg((m) => ({ ...m, [group]: '' }))
    try {
      const g = shares[group] ?? {}
      const payload = roles.map((r) => ({ roleId: r.id, sharePct: parseShare(g[r.id]) }))
      const res = await saveRolePlanDefaultGroup(group, payload)
      if (!res.success) { setGroupErr((e) => ({ ...e, [group]: res.message })); return }
      // Lokalen Stand aus dem Ergebnis aktualisieren.
      setShares((s) => {
        const updated = { ...(s[group] ?? {}) }
        for (const row of res.data) updated[row.role_id] = String(row.share_pct)
        return { ...s, [group]: updated }
      })
      setGroupMsg((m) => ({ ...m, [group]: 'Gespeichert' }))
    } catch (e) {
      setGroupErr((er) => ({ ...er, [group]: e instanceof Error ? e.message : 'Speichern fehlgeschlagen.' }))
    } finally {
      setSavingGroup(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Default-Rollenverteilung</h2>
            <p className="text-[11px] text-slate-400">Vorlagen je LPH-Gruppe · Mitarbeiterrollen</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Laden…
            </div>
          ) : loadError ? (
            <p className="text-sm text-red-500 py-4">{loadError}</p>
          ) : roles.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">
              Keine aktiven Mitarbeiterrollen. Bitte zuerst unter „Einstellungen &gt; Mitarbeiterrollen" Rollen anlegen.
            </p>
          ) : (
            ROLE_PLAN_DEFAULT_GROUPS.map((group) => {
              const sum = groupSum(group)
              const sumOk = sum === 100
              return (
                <div key={group} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                    <span className="text-sm font-semibold text-slate-700">
                      {ROLE_PLAN_DEFAULT_GROUP_LABELS[group]}
                    </span>
                    <span className={`text-[11px] font-medium tabular-nums ${sumOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                      Σ {sum} %
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {roles.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 px-4 py-1.5">
                        <span className="flex-1 text-sm text-slate-700">{r.name}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={shares[group]?.[r.id] ?? ''}
                          onChange={(e) => setShare(group, r.id, e.target.value)}
                          placeholder="0"
                          className="w-16 text-sm text-right border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800 tabular-nums"
                        />
                        <span className="text-xs text-slate-400 w-3">%</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50/60 border-t border-slate-100">
                    <button
                      onClick={() => handleSaveGroup(group)}
                      disabled={savingGroup !== null}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50"
                    >
                      {savingGroup === group && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {savingGroup === group ? 'Speichern…' : 'Speichern'}
                    </button>
                    {groupMsg[group] && <span className="text-[11px] text-emerald-600">{groupMsg[group]}</span>}
                    {groupErr[group] && <span className="text-[11px] text-red-500">{groupErr[group]}</span>}
                    {!sumOk && !groupErr[group] && (
                      <span className="text-[11px] text-amber-600">Summe ist nicht 100 % (Speichern trotzdem möglich).</span>
                    )}
                  </div>
                </div>
              )
            })
          )}

          <p className="text-[10px] text-slate-400">
            Reine Vorlagen · keine echten Mitarbeiterzuweisungen, keine Mitarbeiter-Stundensätze.
            Anwendung erfolgt pro Projekt-LPH über „Default anwenden".
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
