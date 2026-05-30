# Regeln: Supabase, RLS, RPC, Views, Auth, Rollen

Bei Aufgaben zu diesen Themen **zuerst `01_Context/AI_CONTEXT.md` lesen.**
Referenz-SQL liegt in `01_Context/supabase_schema.sql`, `supabase_rls.sql`, `supabase_rpc.sql`
(nur lesen — Änderung nur bei `schreibe Kontext`).

## Sicherheit (nicht verhandelbar)

- **`hourly_rate_eur` darf niemals ans Frontend gelangen.**
  Das Feld liegt ausschließlich in `public.employees`. Frontend/PL lesen Mitarbeiter
  **immer** über die View `public.employees_public` (ohne Stundensatz), **nie** direkt aus `employees`.
- `hourly_rate_eur` verlässt die DB nur serverseitig innerhalb von `SECURITY DEFINER`-RPCs.
- Keine `select('*')` auf `employees` im Client- oder ungeschützten Code.

## Rollen

- Zwei Rollen in `public.users`: `TL` (Teamleiter) und `PL` (Projektleiter).
- `public.users.id` muss exakt der `auth.users.id` entsprechen.
- PL sieht nur eigene Projekte und Mitarbeiter nur über `employees_public`.

## RLS

- RLS auf allen fachlichen Tabellen aktiviert.
- **INSERT braucht eine eigene `FOR INSERT WITH CHECK`-Policy** — eine `USING`-Policy
  allein deckt INSERT nicht ab. Sonst scheitert u.a. der Abacus-Import.
- UPDATE/DELETE jeweils mit passender `USING`(/`WITH CHECK`)-Policy absichern.
- Views, die RLS bewusst über Owner-Rechte umgehen (z.B. `employees_public`), nicht
  auf `security_invoker` umstellen, ohne die Konsequenz für PL-Zugriff zu prüfen.

## RPC / Berechnungen

- **Budget- und Kostenberechnungen laufen serverseitig in RPC-Funktionen**
  (`SECURITY DEFINER`), nicht im Frontend — damit `hourly_rate_eur` die DB nicht verlässt.
- Rückgaben der RPCs dürfen keine Stundensätze oder daraus trivial ableitbaren
  Einzelwerte enthalten, die das Frontend nicht haben darf.

## Destruktiv = Rückfrage

- **Keine `DROP TABLE/VIEW/FUNCTION`, `TRUNCATE`, `DELETE` ohne ausdrückliche Rückfrage.**
- Migrationen idempotent halten (`if not exists`, `add column if not exists`).
- SQL-Dateien werden generiert und vom Nutzer selbst im Supabase SQL Editor ausgeführt —
  nicht eigenmächtig gegen die DB ausführen.
