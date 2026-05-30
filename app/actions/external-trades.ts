'use server'

// ============================================================================
// Server Actions: Andere Gewerke / Fremdgewerke (public.external_trade_schedules)
// ----------------------------------------------------------------------------
// Layer-Charakter: TERMINPLAN-/KOORDINATIONSLAYER, KEIN Ressourcenlayer.
//   * Landet NICHT in allocations.
//   * Fliesst NICHT in Teamkapazitaet / Heatmap ein.
//   * Erzeugt KEINE Mitarbeiterstunden, beeinflusst KEINE Budgetauslastung.
//   * KEIN Bezug zu employees, hourly_rate_eur oder Budget-RPCs.
// Diese Actions sprechen ausschliesslich public.external_trade_schedules an.
//
// Sicherheit: Es wird der normale Supabase-Server-Client (anon key + Cookies)
// verwendet -> RLS greift. Keine Service-Role, kein RLS-Umgehen. TL/PL-Rechte
// kommen aus den Policies der Tabelle; fremde Projekte blockt die DB.
// ============================================================================

import { createClient } from '@/lib/supabase/server'

// Type-only Export fuer die spaetere UI (Paket 5C). Interfaces werden zur
// Laufzeit geloescht und sind daher in 'use server'-Dateien erlaubt
// (vgl. terminplan.ts). Keine RUNTIME-Objekte/Konstanten exportieren.
export interface ExternalTrade {
  id: string
  project_id: string
  trade_name: string
  lph_number: number
  start_date: string // ISO yyyy-mm-dd
  end_date: string // ISO yyyy-mm-dd
  source: 'manual' | 'import'
  note: string | null
  color: string | null // Palette-Key (siehe ALLOWED_COLOR_KEYS), kein freier CSS-String
  sort_order: number
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

// ── Lokale (nicht exportierte) Typen & Konstanten ───────────────────────────
// In 'use server' duerfen nur async functions EXPORTIERT werden. Modul-interne,
// nicht exportierte Konstanten/Typen sind erlaubt.

type Ok<T> = { success: true; data: T }
type Err = { success: false; message: string }
type Result<T> = Ok<T> | Err

interface CreateTradeInput {
  trade_name: string
  lph_number: number
  start_date: string
  end_date: string
  note?: string | null
  color?: string | null
  sort_order?: number | null
}

interface UpdateTradeInput {
  trade_name?: string
  lph_number?: number
  start_date?: string
  end_date?: string
  note?: string | null
  color?: string | null
  sort_order?: number | null
}

interface DbRow {
  id: string
  project_id: string
  trade_name: string
  lph_number: number
  start_date: string
  end_date: string
  source: string
  note: string | null
  color: string | null
  sort_order: number
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

const SELECT_COLS =
  'id, project_id, trade_name, lph_number, start_date, end_date, source, note, color, sort_order, created_by, created_at, updated_at'

// Sichere Farb-Palette. Gespeichert wird NUR der Key; die UI mappt ihn auf eine
// konkrete Klasse/Farbe. Damit gelangt kein freier CSS-String in die DB.
const ALLOWED_COLOR_KEYS: readonly string[] = [
  'slate', 'gray', 'zinc', 'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose',
]

const NOTE_MAX = 2000
const NAME_MAX = 200
// smallint-Wertebereich (Tabelle nutzt smallint fuer sort_order).
const SMALLINT_MIN = -32768
const SMALLINT_MAX = 32767

// ── Validierungs-Helfer (nicht exportiert) ──────────────────────────────────

type Check<T> = { ok: true; value: T } | { ok: false; message: string }

function checkTradeName(v: unknown): Check<string> {
  if (typeof v !== 'string') return { ok: false, message: 'trade_name muss Text sein' }
  const t = v.trim()
  if (t.length === 0) return { ok: false, message: 'trade_name darf nicht leer sein' }
  if (t.length > NAME_MAX) return { ok: false, message: `trade_name ist zu lang (max. ${NAME_MAX} Zeichen)` }
  return { ok: true, value: t }
}

function checkLph(v: unknown): Check<number> {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 9) {
    return { ok: false, message: 'lph_number muss eine ganze Zahl zwischen 1 und 9 sein' }
  }
  return { ok: true, value: v }
}

// Strikte ISO-Datumspruefung (yyyy-mm-dd). Round-Trip ueber UTC faengt
// unmoegliche Daten wie 2026-02-30 ab (JS wuerde sie sonst rollen).
function checkIsoDate(v: unknown, field: string): Check<string> {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return { ok: false, message: `${field} muss ein gueltiges ISO-Datum (yyyy-mm-dd) sein` }
  }
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    return { ok: false, message: `${field} ist kein gueltiges Kalenderdatum` }
  }
  return { ok: true, value: v }
}

// color ist optional. Leer/null -> NULL. Sonst muss es ein Palette-Key sein.
function checkColor(v: unknown): Check<string | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  if (typeof v !== 'string' || !ALLOWED_COLOR_KEYS.includes(v)) {
    return { ok: false, message: 'color muss ein gueltiger Palette-Key sein (kein freier CSS-Wert)' }
  }
  return { ok: true, value: v }
}

// note ist optional. Leer/null -> NULL.
function checkNote(v: unknown): Check<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, message: 'note muss Text sein' }
  const t = v.trim()
  if (t.length === 0) return { ok: true, value: null }
  if (t.length > NOTE_MAX) return { ok: false, message: `note ist zu lang (max. ${NOTE_MAX} Zeichen)` }
  return { ok: true, value: t }
}

// sort_order ist optional. Fehlt es, gilt der Default 0.
function checkSortOrder(v: unknown): Check<number> {
  if (v === undefined || v === null) return { ok: true, value: 0 }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < SMALLINT_MIN || v > SMALLINT_MAX) {
    return { ok: false, message: 'sort_order muss eine ganze Zahl im smallint-Bereich sein' }
  }
  return { ok: true, value: v }
}

function mapRow(r: DbRow): ExternalTrade {
  return {
    id: r.id,
    project_id: r.project_id,
    trade_name: r.trade_name,
    lph_number: r.lph_number,
    start_date: r.start_date,
    end_date: r.end_date,
    source: r.source === 'import' ? 'import' : 'manual',
    note: r.note,
    color: r.color,
    sort_order: r.sort_order,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

// ── 1. Laden ────────────────────────────────────────────────────────────────
// Alle Fremdgewerk-Balken eines Projekts, sortiert nach sort_order, dann
// lph_number, dann trade_name. RLS liefert PL nur eigene Projekte.
export async function loadExternalTrades(
  projectId: string
): Promise<Result<ExternalTrade[]>> {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return { success: false, message: 'projectId fehlt' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('external_trade_schedules')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('lph_number', { ascending: true })
    .order('trade_name', { ascending: true })

  if (error) return { success: false, message: error.message }
  return { success: true, data: ((data ?? []) as DbRow[]).map(mapRow) }
}

// ── 2. Anlegen ───────────────────────────────────────────────────────────────
// source ist im MVP immer 'manual'. created_by wird – falls ermittelbar – auf
// den eingeloggten User gesetzt. RLS entscheidet, ob das Projekt beschreibbar ist.
export async function createExternalTrade(
  projectId: string,
  payload: CreateTradeInput
): Promise<Result<ExternalTrade>> {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return { success: false, message: 'projectId fehlt' }
  }
  if (payload === null || typeof payload !== 'object') {
    return { success: false, message: 'payload fehlt' }
  }

  const name = checkTradeName(payload.trade_name)
  if (!name.ok) return { success: false, message: name.message }

  const lph = checkLph(payload.lph_number)
  if (!lph.ok) return { success: false, message: lph.message }

  const start = checkIsoDate(payload.start_date, 'start_date')
  if (!start.ok) return { success: false, message: start.message }

  const end = checkIsoDate(payload.end_date, 'end_date')
  if (!end.ok) return { success: false, message: end.message }

  if (end.value < start.value) {
    return { success: false, message: 'end_date darf nicht vor start_date liegen' }
  }

  const note = checkNote(payload.note)
  if (!note.ok) return { success: false, message: note.message }

  const color = checkColor(payload.color)
  if (!color.ok) return { success: false, message: color.message }

  const sortOrder = checkSortOrder(payload.sort_order)
  if (!sortOrder.ok) return { success: false, message: sortOrder.message }

  const supabase = await createClient()

  // created_by best effort – wenn kein User ermittelbar ist, bleibt es NULL.
  const { data: userData } = await supabase.auth.getUser()
  const createdBy = userData?.user?.id ?? null

  const { data, error } = await supabase
    .from('external_trade_schedules')
    .insert({
      project_id: projectId,
      trade_name: name.value,
      lph_number: lph.value,
      start_date: start.value,
      end_date: end.value,
      source: 'manual',
      note: note.value,
      color: color.value,
      sort_order: sortOrder.value,
      created_by: createdBy,
    })
    .select(SELECT_COLS)
    .single()

  if (error) return { success: false, message: error.message }
  return { success: true, data: mapRow(data as DbRow) }
}

// ── 3. Aktualisieren ─────────────────────────────────────────────────────────
// Nur uebergebene Felder werden geaendert. Die Datums-Reihenfolge wird gegen die
// EFFEKTIVEN Werte (Patch + Bestand) geprueft, damit auch das Patchen nur eines
// Datums nicht end_date < start_date erzeugen kann. updated_at wird explizit
// gesetzt. Der Vorab-Select ist RLS-gescoped: PL sieht fremde Zeilen nicht.
export async function updateExternalTrade(
  id: string,
  patch: UpdateTradeInput
): Promise<Result<ExternalTrade>> {
  if (typeof id !== 'string' || id.length === 0) {
    return { success: false, message: 'id fehlt' }
  }
  if (patch === null || typeof patch !== 'object') {
    return { success: false, message: 'patch fehlt' }
  }

  const supabase = await createClient()

  // Bestand laden (RLS-gescoped). Kein Treffer => nicht vorhanden oder kein Zugriff.
  const { data: existing, error: selErr } = await supabase
    .from('external_trade_schedules')
    .select(SELECT_COLS)
    .eq('id', id)
    .maybeSingle()

  if (selErr) return { success: false, message: selErr.message }
  if (!existing) return { success: false, message: 'Eintrag nicht gefunden oder kein Zugriff' }

  const current = mapRow(existing as DbRow)
  const updateObj: Record<string, unknown> = {}

  if (patch.trade_name !== undefined) {
    const r = checkTradeName(patch.trade_name)
    if (!r.ok) return { success: false, message: r.message }
    updateObj.trade_name = r.value
  }

  if (patch.lph_number !== undefined) {
    const r = checkLph(patch.lph_number)
    if (!r.ok) return { success: false, message: r.message }
    updateObj.lph_number = r.value
  }

  let effStart = current.start_date
  if (patch.start_date !== undefined) {
    const r = checkIsoDate(patch.start_date, 'start_date')
    if (!r.ok) return { success: false, message: r.message }
    updateObj.start_date = r.value
    effStart = r.value
  }

  let effEnd = current.end_date
  if (patch.end_date !== undefined) {
    const r = checkIsoDate(patch.end_date, 'end_date')
    if (!r.ok) return { success: false, message: r.message }
    updateObj.end_date = r.value
    effEnd = r.value
  }

  if (effEnd < effStart) {
    return { success: false, message: 'end_date darf nicht vor start_date liegen' }
  }

  if (patch.note !== undefined) {
    const r = checkNote(patch.note)
    if (!r.ok) return { success: false, message: r.message }
    updateObj.note = r.value
  }

  if (patch.color !== undefined) {
    const r = checkColor(patch.color)
    if (!r.ok) return { success: false, message: r.message }
    updateObj.color = r.value
  }

  if (patch.sort_order !== undefined) {
    const r = checkSortOrder(patch.sort_order)
    if (!r.ok) return { success: false, message: r.message }
    updateObj.sort_order = r.value
  }

  // updated_at immer explizit setzen.
  updateObj.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('external_trade_schedules')
    .update(updateObj)
    .eq('id', id)
    .select(SELECT_COLS)
    .single()

  if (error) return { success: false, message: error.message }
  return { success: true, data: mapRow(data as DbRow) }
}

// ── 4. Loeschen ──────────────────────────────────────────────────────────────
// RLS entscheidet, ob geloescht werden darf. Fremde Zeilen werden nicht getroffen.
export async function deleteExternalTrade(
  id: string
): Promise<Result<{ id: string }>> {
  if (typeof id !== 'string' || id.length === 0) {
    return { success: false, message: 'id fehlt' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('external_trade_schedules')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { success: false, message: error.message }
  if (!data) return { success: false, message: 'Eintrag nicht gefunden oder kein Zugriff' }
  return { success: true, data: { id: data.id } }
}
