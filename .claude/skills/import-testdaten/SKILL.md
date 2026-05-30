---
name: import-testdaten
description: Generiert Beispiel-/Testdaten-JSONs für die CapaPlan-Importe (Abacus-Stammdaten und H&I-Einsatzplanung) im exakten Format von app/actions/import.ts. Auslösen, wenn der Nutzer Testdaten, Beispieldaten, Demodaten, Import-JSONs, Abacus-JSON oder H&I-JSON für CapaPlan/Capaview erstellen will. NICHT für echte Produktivdaten oder den eigentlichen Importvorgang (der läuft über die UI-Buttons).
---

# Import-Testdaten generieren

Erzeugt zwei JSON-Dateien, die exakt zum Importcode in `app/actions/import.ts` passen.

## Wann verwenden
Nutzer will Beispiel-/Test-/Demodaten für die CapaPlan-Importe (Abacus und/oder H&I).

## Standard-Defaults (wenn Nutzer nichts anderes sagt)
- **6 Mitarbeiter**, gemischte TGA-Rollen/Abteilungen (HLS, Elektro, MSR, Sanitär).
- **3–4 typische TGA-Planungsprojekte** mit LPH-Budgets nach HOAI-Logik.
- **H&I nur für die nächsten 2 Kalenderwochen** ab dem heutigen Datum.
  Heutiges Datum → ISO-Kalenderwoche bestimmen; KW + (KW+1) verwenden, Jahr passend.
- Beide Dateien nach `01_Context/` schreiben (z. B. `abacus_import_beispiel.json`,
  `hi_einsatzplanung_beispiel.json`) — das sind Beispieldateien, **nicht** die
  geschützten Kontextdateien; sie dürfen ohne `schreibe Kontext` neu erzeugt werden.

## Pflichtformat — Abacus (`importAbacusBudgets`)
Objekt mit Arrays `mitarbeiter` und `projekte`.

Mitarbeiter (alle Felder Pflicht, sonst wird der Eintrag still übersprungen):
- `name` (string, UNIQUE — onConflict), `role_type` (string), `department` (string),
  `weekly_capacity_hours` (number), `hourly_rate_eur` (number).

Projekt:
- `project_number` (string, UNIQUE), `name` (string), optional `pl_name` (string —
  muss exakt `public.users.name` treffen, sonst Fallback auf importierenden TL),
  `lph_budgets`: Array aus `{ lph_number (number), budget_eur (number) }`.
- **LPH 9 wird vom Import ignoriert** — darf zu Demozwecken trotzdem enthalten sein.

## Pflichtformat — H&I (`importHiAllocations`)
JSON-**Array** aus Tageseinträgen. Pflichtfelder je Eintrag (sonst gefiltert):
- `employee_name` (string, muss einen Abacus-Mitarbeiter per Name matchen),
- `project_number` (string), `lph_number` (number), `calendar_week` (number),
  `year` (number), `percentage` (number; typisch 25/50/75/100).
- `source` NICHT setzen (vom Code automatisch auf 'H&I' gesetzt).
- Zusatzfelder wie `date` sind erlaubt (werden ignoriert) und erhöhen die Lesbarkeit.

### Stunden-/Aggregationslogik (wichtig für plausible Werte)
- Pro Tag: `stunden = percentage/100 × (weekly_capacity_hours / 5)`.
- Einträge mit gleichem Schlüssel
  `employee_name|project_number|lph_number|calendar_week|year` werden zu KW-Summen addiert.
  → Eine 100%-Woche = 5 Tageseinträge à `percentage:100`.
- Jedes referenzierte `project_number`+`lph_number` **muss** in den Abacus-`lph_budgets`
  existieren, sonst wird der H&I-Eintrag übersprungen.

## Ablauf
1. Falls unklar: nur kurz fragen, was von Default abweicht (Anzahl MA/Projekte, Zeitraum).
   Sonst direkt mit Defaults bauen.
2. Heutiges Datum → die 2 Ziel-Kalenderwochen + Jahr bestimmen.
3. Beide JSONs schreiben. Reihenfolge der Daten so wählen, dass H&I-Refs in Abacus existieren.
4. **Validieren**: JSON parst sauber; alle H&I-Pflichtfelder vorhanden; alle
   `project_number`+`lph_number` in Abacus gedeckt. (PowerShell `ConvertFrom-Json` reicht.)
5. Kurz melden: Dateipfade, Anzahl MA/Projekte/Einträge, verwendete KW.

## Konventionen / Stolpersteine
- Reihenfolge beim echten Import ist Abacus → H&I (nur als Hinweis ausgeben, nicht selbst importieren).
- `hourly_rate_eur` gehört in die Abacus-Daten (Stammdaten), erscheint aber nie im Frontend.
- Wurde `app/actions/import.ts` zwischenzeitlich geändert, das obige Feldformat dort
  kurz gegenprüfen, bevor generiert wird.
