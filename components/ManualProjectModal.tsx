'use client'

import { useEffect, useState } from 'react'
import { X, CheckCircle2, Loader2 } from 'lucide-react'
import { loadProjectLeads, createManualProject } from '@/app/actions/projects'
import { CALC_PROFILES, CALC_PROFILE_LABELS } from '@/lib/calc-profile'

// Paket 7B — Manuelle Projektanlage (TL). Oeffnet sich aus
// „Projekt einfügen > Manuell". Schreibt ausschliesslich nach public.projects.

interface ManualProjectModalProps {
  onClose: () => void
  onCreated: () => void
}

type Lead = { id: string; name: string; role: string }

export default function ManualProjectModal({ onClose, onCreated }: ManualProjectModalProps) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(true)

  const [projectNumber, setProjectNumber] = useState('')
  const [name, setName] = useState('')
  const [plId, setPlId] = useState('')
  const [calcProfile, setCalcProfile] = useState<string>('frei')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Moegliche Projektleiter laden.
  useEffect(() => {
    let cancelled = false
    setLeadsLoading(true)
    loadProjectLeads()
      .then((res) => {
        if (cancelled) return
        setLeads(res.success ? res.data : [])
      })
      .catch(() => { if (!cancelled) setLeads([]) })
      .finally(() => { if (!cancelled) setLeadsLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit() {
    setError(null)
    if (!projectNumber.trim()) { setError('Bitte eine Projektnummer angeben.'); return }
    if (!name.trim()) { setError('Bitte einen Projektnamen angeben.'); return }
    if (!plId) { setError('Bitte einen Projektleiter auswählen.'); return }

    setSaving(true)
    try {
      const res = await createManualProject({
        projectNumber: projectNumber.trim(),
        name: name.trim(),
        plId,
        calcProfile,
      })
      if (!res.success) { setError(res.message); return }
      setSuccessMsg(res.message)
      // Projektliste im Dashboard sofort neu laden (router.refresh über Parent).
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Projekt konnte nicht angelegt werden.')
    } finally {
      setSaving(false)
    }
  }

  const roleLabel = (role: string) => (role === 'PL' ? 'PL' : role === 'TL' ? 'TL' : role)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Projekt manuell anlegen</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {successMsg ? (
          /* Erfolgs-Ansicht */
          <>
            <div className="p-6 flex flex-col items-center text-center gap-3">
              <CheckCircle2 className="h-9 w-9 text-emerald-400" />
              <p className="text-sm font-semibold text-emerald-600">Projekt angelegt</p>
              <p className="text-xs text-slate-500">{successMsg}</p>
              <p className="text-[11px] text-slate-400">
                Das Projekt erscheint in der Projektliste der Planung.
              </p>
            </div>
            <div className="px-6 pb-5">
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Fertig
              </button>
            </div>
          </>
        ) : (
          /* Formular */
          <>
            <div className="p-6 space-y-4">
              {/* Projektnummer */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Projektnummer
                </label>
                <input
                  type="text"
                  value={projectNumber}
                  onChange={(e) => { setProjectNumber(e.target.value); setError(null) }}
                  placeholder="z. B. 2025-0042"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 outline-none focus:border-slate-400"
                />
              </div>

              {/* Projektname */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Projektname
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null) }}
                  placeholder="z. B. Neubau Bürogebäude Musterstraße"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 outline-none focus:border-slate-400"
                />
              </div>

              {/* Projektleiter */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Projektleiter
                </label>
                <select
                  value={plId}
                  onChange={(e) => { setPlId(e.target.value); setError(null) }}
                  disabled={leadsLoading}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none focus:border-slate-400 disabled:opacity-50"
                >
                  <option value="">{leadsLoading ? 'Laden…' : 'Bitte wählen'}</option>
                  {leads.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({roleLabel(u.role)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Kalkulationsprofil */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Kalkulationsprofil
                </label>
                <select
                  value={calcProfile}
                  onChange={(e) => setCalcProfile(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none focus:border-slate-400"
                >
                  {CALC_PROFILES.map((p) => (
                    <option key={p} value={p}>{CALC_PROFILE_LABELS[p]}</option>
                  ))}
                </select>
              </div>

              {error && <p className="text-[11px] text-red-500">{error}</p>}
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Anlegen…' : 'Projekt anlegen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
