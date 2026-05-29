'use client'

import { useState, useCallback, useRef } from 'react'
import { X, UploadCloud, CalendarDays, FileJson, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { importAbacusBudgets, importHiAllocations } from '@/app/actions/import'

type ImportStatus = 'idle' | 'loading' | 'success' | 'error'
type TabType = 'abacus' | 'hi'

interface FileState {
  file: File | null
  status: ImportStatus
  message: string
}

interface DataImportProps {
  initialTab: TabType
  onClose: () => void
}

const EMPTY_STATE: FileState = { file: null, status: 'idle', message: '' }

// ── DropZone ──────────────────────────────────────────────────────────────────

function DropZone({
  state,
  onFile,
}: {
  state: FileState
  onFile: (file: File) => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) onFile(file)
    },
    [onFile]
  )

  const borderClass =
    state.status === 'success'
      ? 'border-emerald-300 bg-emerald-50'
      : state.status === 'error'
      ? 'border-red-300 bg-red-50'
      : dragging
      ? 'border-slate-400 bg-slate-50'
      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'

  const icon =
    state.status === 'loading' ? (
      <Loader2 className="h-8 w-8 text-slate-300 animate-spin" />
    ) : state.status === 'success' ? (
      <CheckCircle2 className="h-8 w-8 text-emerald-400" />
    ) : state.status === 'error' ? (
      <AlertCircle className="h-8 w-8 text-red-400" />
    ) : (
      <FileJson className="h-8 w-8 text-slate-300" />
    )

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-150 ${borderClass}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />

      <div className="flex flex-col items-center gap-3">
        {icon}

        {state.status === 'idle' && (
          <>
            <p className="text-sm font-medium text-slate-600">
              JSON-Datei hier ablegen
            </p>
            <p className="text-xs text-slate-400">oder klicken zum Auswählen</p>
          </>
        )}

        {state.status === 'loading' && (
          <p className="text-sm text-slate-500">Wird verarbeitet…</p>
        )}

        {state.status === 'success' && (
          <>
            <p className="text-sm font-semibold text-emerald-600">Import erfolgreich</p>
            <p className="text-xs text-emerald-500">{state.message}</p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-600">Fehler</p>
            <p className="text-xs text-red-500">{state.message}</p>
          </>
        )}

        {state.file && state.status !== 'idle' && (
          <p className="text-[11px] font-mono text-slate-400 truncate max-w-full">
            {state.file.name}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Haupt-Komponente ───────────────────────────────────────────────────────────

export default function DataImport({ initialTab, onClose }: DataImportProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)
  const [abacus, setAbacus] = useState<FileState>(EMPTY_STATE)
  const [hi, setHi] = useState<FileState>(EMPTY_STATE)

  async function processFile(
    file: File,
    setter: React.Dispatch<React.SetStateAction<FileState>>,
    handler: (data: unknown) => Promise<{ success: boolean; message: string }>
  ) {
    setter({ file, status: 'loading', message: '' })
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.onerror = () => reject(new Error('Lesefehler'))
        reader.readAsText(file, 'UTF-8')
      })

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setter({ file, status: 'error', message: 'Ungültiges JSON-Format.' })
        return
      }

      const result = await handler(parsed)
      setter({ file, status: result.success ? 'success' : 'error', message: result.message })
    } catch (err) {
      setter({
        file,
        status: 'error',
        message: err instanceof Error ? err.message : 'Unbekannter Fehler',
      })
    }
  }

  const tabs: { id: TabType; label: string; sublabel: string; icon: React.ReactNode }[] = [
    {
      id: 'abacus',
      label: 'Abacus-Daten',
      sublabel: 'Urlaub & Projekte',
      icon: <CalendarDays className="h-4 w-4" />,
    },
    {
      id: 'hi',
      label: 'H&I Einsatzplanung',
      sublabel: 'Tagesaktuelle Stunden',
      icon: <UploadCloud className="h-4 w-4" />,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Daten importieren</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 flex items-center justify-center gap-2 px-4 py-3.5
                text-sm font-medium transition-all duration-150 border-b-2
                ${activeTab === tab.id
                  ? 'border-slate-800 text-slate-800 bg-slate-50'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          <p className="text-xs text-slate-400 mb-4">
            {activeTab === 'abacus'
              ? 'Importiert LPH-Budgets und Projektdaten aus MyAbacus.'
              : 'Importiert tagesaktuelle Stundenzuweisungen der nächsten 2 Wochen aus H&I.'}
          </p>

          {activeTab === 'abacus' && (
            <DropZone
              state={abacus}
              onFile={(file) => processFile(file, setAbacus, importAbacusBudgets)}
            />
          )}

          {activeTab === 'hi' && (
            <DropZone
              state={hi}
              onFile={(file) => processFile(file, setHi, importHiAllocations)}
            />
          )}

          {/* Format-Hinweis */}
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 p-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Erwartetes Format
            </p>
            {activeTab === 'abacus' ? (
              <pre className="text-[10px] text-slate-500 font-mono leading-relaxed">{`[{
  "project_number": "2024-0087",
  "lph_number": 5,
  "budget_eur": 15000
}]`}</pre>
            ) : (
              <pre className="text-[10px] text-slate-500 font-mono leading-relaxed">{`[{
  "employee_id": "uuid",
  "project_number": "2024-0087",
  "lph_number": 5,
  "calendar_week": 14,
  "year": 2025,
  "hours": 20
}]`}</pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
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
