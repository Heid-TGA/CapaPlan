# Regeln: Abacus- & H&I-Import

Bei Aufgaben zur Importlogik **zuerst `01_Context/AI_CONTEXT.md` lesen.**
Code: `app/actions/import.ts`. Beispiel-Dateien: `01_Context/abacus_import_beispiel.json`,
`01_Context/hi_einsatzplanung_beispiel.json`.

## Systemhoheit

- **Abacus ist das führende System** für Stammdaten und Budgets:
  Mitarbeiter (inkl. `hourly_rate_eur`, `weekly_capacity_hours`), Projekte, LPH-Budgets.
- **H&I liefert nur** Klarnamen (`employee_name`) und Tages-Prozentwerte je
  Projekt/LPH/Kalenderwoche — keine Stammdaten, keine Budgets, keine Stundensätze.

## Reihenfolge

- **Immer zuerst Abacus, dann H&I.** H&I matcht Mitarbeiter über den Namen und
  Projekte/LPH über `project_number`+`lph_number`. Ohne vorherigen Abacus-Import
  finden die H&I-Einträge keinen Match.

## H&I-Stundenformel

- H&I gibt Tages-Prozente aus (typisch 25/50/75/100).
- Umrechnung in Stunden:

  **`stunden = percentage / 100 × (weekly_capacity_hours / 5)`**

  (`weekly_capacity_hours / 5` = ein Arbeitstag.) Tageswerte werden pro KW zu
  Wochensummen aggregiert.

## Testdaten

- **H&I-Testdaten standardmäßig nur für die nächsten 2 Kalenderwochen**, sofern nicht
  anders gewünscht. Abacus-Testdaten: ca. 6 Mitarbeiter, 3–4 typische TGA-Projekte.
- LPH 9 wird im Import ignoriert (siehe `import.ts`).
- Referenzierte `project_number`+`lph_number` müssen in den Abacus-Budgets existieren,
  sonst werden H&I-Einträge übersprungen.

## Pflichtfelder

- Abacus-Mitarbeiter: `name`, `role_type`, `department`, `weekly_capacity_hours`, `hourly_rate_eur`.
- H&I-Eintrag: `employee_name`, `project_number`, `lph_number`, `calendar_week`, `year`, `percentage`.
