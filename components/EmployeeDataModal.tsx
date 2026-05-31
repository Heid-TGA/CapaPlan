'use client'

// Mitarbeiterdaten-Verwaltung (Paket 11) — NUR fuer TL.
//
// Zwei Tabs:
//   * "Mitarbeiter": Liste + Inline-Bearbeitung + Anlegen + aktiv/inaktiv.
//   * "Import":      oeffnet den bestehenden Abacus-/H&I-Import (DataImport).
//
// SICHERHEIT: hourly_rate_eur wird hier NIE geladen, angezeigt oder bearbeitet.
// Die Server-Actions (employees-admin.ts) liefern den Stundensatz gar nicht aus.
// Schreibrechte werden serverseitig per RLS erzwungen (nur TL).

import { useEffect, useState } from 'react'
import { X, Users, Plus, Trash2, Check, UploadCloud } from 'lucide-react'
import {
  loadEmployeesAdmin,
  createEmployeeManual,
  updateEmployeeManual,
  type EmployeeAdmin,
} from '@/app/actions/employees-admin'
import { loadPlanningRoles } from '@/app/actions/planning-roles'
import { EMPLOYEE_DEPARTMENTS } from '@/lib/employee-fields'
import DataImport from './DataImport'

interface Props {
  onClose: () => void
}

type TabType = 'mitarbeiter' | 'import'

interface Draft {
  name: string
  role_type: string
  department: string
  hours: string
}

// Deutsche Zahleneingabe -> number. Leer/ungueltig -> NaN.
function parseGermanNumber(raw: string): number {
  const cleaned = raw.replace(/[h\s]/gi, '').replace(',', '.')
  if (cleaned === '') return NaN
  return Number(cleaned)
}

const ROLES_DATALIST_ID = 'emp-role-suggestions'

const inputCls =
  'min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-slate-400 text-slate-800'

export default function EmployeeDataModal({ onClose }: Props) {
  const [tab, setTab] = useState<TabType>('mitarbeiter')
  const [showImport, setShowImport] = useState(false)

  const [employees, setEmployees] = useState<EmployeeAdmin[]>([])
  const [roleNames, setRoleNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Lokale Edit-Puffer je Mitarbeiter.
  const [draft, setDraft] = useState<Record<string, Draft>>({})

  // Neuer Mitarbeiter.
  const [neu, setNeu] = useState<Draft>({ name: '', role_type: '', department: 'HLKS', hours: '40' })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadEmployeesAdmin(), loadPlanningRoles()])
      .then(([empRes, rolesRes]) => {
        if (cancelled) return
        if (empRes.success) {
          setEmployees(empRes.data)
          setDraft(Object.fromEntries(empRes.data.map((e) => [e.id, toDraft(e)])))
        } else {
          setEmployees([])
          setError(empRes.message)
        }
        if (rolesRes.success) {
          setRoleNames(rolesRes.data.filter((r) => r.active).map((r) => r.name))
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function toDraft(e: EmployeeAdmin): Draft {
    return {
      name: e.name,
      role_type: e.role_type,
      department: e.department,
      hours: String(e.weekly_capacity_hours),
    }
  }

  function setEmployeeLocal(updated: EmployeeAdmin) {
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
    setDraft((d) => ({ ...d, [updated.id]: toDraft(updated) }))
  }

  function isDirty(e: EmployeeAdmin): boolean {
    const d = draft[e.id]
    if (!d) return false
    return (
      d.name.trim() !== e.name ||
      d.role_type.trim() !== e.role_type ||
      d.department !== e.department ||
      parseGermanNumber(d.hours) !== e.weekly_capacity_hours
    )
  }

  async function handleSaveRow(emp: EmployeeAdmin) {
    const d = draft[emp.id]
    if (!d) return
    const hours = parseGermanNumber(d.hours)
    if (!d.name.trim()) { setError('Name fehlt.'); return }
    if (!d.role_type.trim()) { setError('Rolle fehlt.'); return }
    setBusyId(emp.id); setError(null)
    try {
      const res = await updateEmployeeManual(emp.id, {
        name: d.name.trim(),
        role_type: d.role_type.trim(),
        department: d.department,
        weekly_capacity_hours: hours,
      })
      if (res.success && res.data) setEmployeeLocal(res.data)
      else setError(res.message || 'Speichern fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleActive(emp: EmployeeAdmin) {
    setBusyId(emp.id); setError(null)
    try {
      const res = await updateEmployeeManual(emp.id, { active: !emp.active })
      if (res.success && res.data) setEmployeeLocal(res.data)
      else setError(res.message || 'Speichern fehlgeschlagen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreate() {
    const hours = parseGermanNumber(neu.hours)
    if (!neu.name.trim()) { setError('Name fehlt.'); return }
    if (!neu.role_type.trim()) { setError('Rolle fehlt.'); return }
    setCreating(true); setError(null)
    try {
      const res = await createEmployeeManual({
        name: neu.name.trim(),
        role_type: neu.role_type.trim(),
        department: neu.department,
        weekly_capacity_hours: hours,
      })
      if (res.success && res.data) {
        const created = res.data
        setEmployees((prev) => [...prev, created])
        setDraft((d) => ({ ...d, [created.id]: toDraft(created) }))
        setNeu({ name: '', role_type: '', department: 'HLKS', hours: '40' })
      } else {
        setError(res.message || 'Anlegen fehlgeschlagen')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />

        <div className="relative z-10 w-full max-w-3xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" />
              <div>
                <p className="text-sm font-semibold text-slate-700">Mitarbeiterdaten</p>
                <p className="text-[11px] text-slate-400">Stammdaten pflegen oder importieren</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600 transition-colors" title="Schließen">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 shrink-0">
            {([
              { id: 'mitarbeiter', label: 'Mitarbeiter' },
              { id: 'import', label: 'Import' },
            ] as { id: TabType; label: string }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-slate-800 text-slate-800 bg-slate-50'
                    : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Mitarbeiter ── */}
          {tab === 'mitarbeiter' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">
                  Manuelle Pflege von Mitarbeitern. Stundensätze werden hier nie angezeigt.{' '}
                  <strong>Achtung:</strong> Ein erneuter Abacus-Import überschreibt Name, Rolle,
                  Bereich und Wochenstunden (Match über den Namen) — der aktiv/inaktiv-Status bleibt erhalten.
                </p>
              </div>

              {error && (
                <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* Rollen-Vorschläge (planning_roles) */}
              <datalist id={ROLES_DATALIST_ID}>
                {roleNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                {/* Kopfzeile */}
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 border-b border-slate-100">
                  <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Name</span>
                  <span className="w-16 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Std/Wo</span>
                  <span className="w-32 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Rolle</span>
                  <span className="w-28 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Bereich</span>
                  <span className="w-36 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Status / Aktion</span>
                </div>

                {loading ? (
                  <p className="text-[11px] text-slate-400 px-3 py-3">Laden…</p>
                ) : employees.length === 0 ? (
                  <p className="text-[11px] text-slate-400 px-3 py-3">Noch keine Mitarbeiter. Unten anlegen oder importieren.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {employees.map((emp) => {
                      const d = draft[emp.id] ?? toDraft(emp)
                      const busy = busyId === emp.id
                      const dirty = isDirty(emp)
                      return (
                        <div key={emp.id} className={`flex items-center gap-2 px-3 py-2 ${emp.active ? '' : 'opacity-50'}`}>
                          <input
                            type="text"
                            value={d.name}
                            onChange={(e) => setDraft((dd) => ({ ...dd, [emp.id]: { ...d, name: e.target.value } }))}
                            className={`${inputCls} flex-1`}
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={d.hours}
                            onChange={(e) => setDraft((dd) => ({ ...dd, [emp.id]: { ...d, hours: e.target.value } }))}
                            className={`${inputCls} w-16 tabular-nums`}
                          />
                          <input
                            type="text"
                            list={ROLES_DATALIST_ID}
                            value={d.role_type}
                            onChange={(e) => setDraft((dd) => ({ ...dd, [emp.id]: { ...d, role_type: e.target.value } }))}
                            className={`${inputCls} w-32`}
                          />
                          <select
                            value={d.department}
                            onChange={(e) => setDraft((dd) => ({ ...dd, [emp.id]: { ...d, department: e.target.value } }))}
                            className={`${inputCls} w-28 bg-white`}
                          >
                            {/* Bestandswert (z. B. aus Abacus) zulassen, falls nicht im Set */}
                            {!EMPLOYEE_DEPARTMENTS.includes(d.department as (typeof EMPLOYEE_DEPARTMENTS)[number]) && (
                              <option value={d.department}>{d.department}</option>
                            )}
                            {EMPLOYEE_DEPARTMENTS.map((dep) => (
                              <option key={dep} value={dep}>{dep}</option>
                            ))}
                          </select>
                          <div className="w-36 flex items-center justify-end gap-1.5">
                            {dirty && (
                              <button onClick={() => handleSaveRow(emp)} disabled={busy} title="Speichern"
                                className="px-2 py-1 rounded-md bg-slate-800 text-white text-[10px] font-medium hover:bg-slate-700 disabled:opacity-50">
                                <Check className="h-3 w-3" />
                              </button>
                            )}
                            <button onClick={() => handleToggleActive(emp)} disabled={busy} title={emp.active ? 'Deaktivieren' : 'Aktivieren'}
                              className="px-2 py-1 rounded-md border border-slate-200 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                              {emp.active ? 'aktiv' : 'inaktiv'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Neue Zeile */}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 bg-slate-50/50">
                  <input
                    type="text"
                    value={neu.name}
                    onChange={(e) => setNeu((n) => ({ ...n, name: e.target.value }))}
                    placeholder="Name"
                    className={`${inputCls} flex-1`}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={neu.hours}
                    onChange={(e) => setNeu((n) => ({ ...n, hours: e.target.value }))}
                    placeholder="40"
                    className={`${inputCls} w-16 tabular-nums`}
                  />
                  <input
                    type="text"
                    list={ROLES_DATALIST_ID}
                    value={neu.role_type}
                    onChange={(e) => setNeu((n) => ({ ...n, role_type: e.target.value }))}
                    placeholder="Rolle"
                    className={`${inputCls} w-32`}
                  />
                  <select
                    value={neu.department}
                    onChange={(e) => setNeu((n) => ({ ...n, department: e.target.value }))}
                    className={`${inputCls} w-28 bg-white`}
                  >
                    {EMPLOYEE_DEPARTMENTS.map((dep) => (
                      <option key={dep} value={dep}>{dep}</option>
                    ))}
                  </select>
                  <div className="w-36 flex justify-end">
                    <button onClick={handleCreate} disabled={creating}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700 disabled:opacity-50">
                      <Plus className="h-3 w-3" />{creating ? '…' : 'Hinzufügen'}
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-400">
                {employees.filter((e) => e.active).length} aktiv · {employees.filter((e) => !e.active).length} inaktiv.
                Inaktive Mitarbeiter werden datensicher behalten (kein Hard-Delete wegen referenzierter Allocations).
              </p>
            </div>
          )}

          {/* ── Tab: Import ── */}
          {tab === 'import' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-500">
                  Stammdaten aus <strong>Abacus</strong> importieren (Mitarbeiter, Projekte, LPH-Budgets).
                  Abacus ist das führende System; ein Import legt Mitarbeiter an oder aktualisiert sie.
                </p>
              </div>
              <button
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                <UploadCloud className="h-4 w-4" />
                Import öffnen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bestehendes Import-Modal — wird ueber dem Mitarbeiter-Modal angezeigt
          (gleiches z-50, spaeter im DOM -> oben). Nach Schliessen Liste neu laden. */}
      {showImport && (
        <DataImport
          initialTab="abacus"
          onClose={() => {
            setShowImport(false)
            loadEmployeesAdmin().then((res) => {
              if (res.success) {
                setEmployees(res.data)
                setDraft(Object.fromEntries(res.data.map((e) => [e.id, toDraft(e)])))
              }
            })
          }}
        />
      )}
    </>
  )
}
