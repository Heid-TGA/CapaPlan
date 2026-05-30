# CapaPlan / Capaview — Projektanweisungen

Capacity-Planning-Tool für TGA-Planungsbüros (Next.js 16 + Supabase).
Diese Datei ist bewusst kurz. Details stehen in `01_Context/AI_CONTEXT.md` und in `.claude/rules/`.

## Kontext nur bei Bedarf laden

**Lies zuerst `01_Context/AI_CONTEXT.md`**, bevor du an einem dieser Themen arbeitest:

- Supabase: Schema, RLS-Policies, RPC-Funktionen, Views, Auth, Rollen (TL/PL)
- Import-Logik (Abacus, H&I)
- Datenmodell / Migrationen
- Vercel / Environment Variables
- alles, was Sicherheit oder Datensichtbarkeit betrifft

**Lies die große Kontextdatei NICHT** bei kleinen UI-, Text- oder Styling-Änderungen.
Dort genügen die Regeln in `.claude/rules/frontend.md`.

Themenspezifische Regeln (immer gültig, kurz):
- `.claude/rules/supabase.md` — DB, RLS, RPC, Auth, Rollen
- `.claude/rules/imports.md` — Abacus- & H&I-Import
- `.claude/rules/frontend.md` — Next.js 16, App Router, Tailwind 4, UI

## AI_CONTEXT.md — gezielt lesen, nicht komplett

`01_Context/AI_CONTEXT.md` hat nummerierte Sektionen. **Lies nur die relevante Sektion**
(via `offset`/`limit`), nicht die ganze Datei. Startzeilen (Stand: kann driften, bei
Bedarf Überschrift per Grep verifizieren):

| § | Thema | ab Zeile |
|---|---|---|
| 4 | Environment Variables | 49 |
| 5 | Vollständige Dateistruktur | 60 |
| 6 | Architektur (proxy.ts, 'use server', Tailwind 4, Clients) | 111 |
| 7 | Rollen & Auth (TL/PL) | 145 |
| 8 | Planungsschritte / LPH | 157 |
| 9 | Import-Logik (Abacus, H&I, JSON-Formate) | 171 |
| 10 | Datenbank-Schema | 216 |
| 11 | RLS-Policies (FOR INSERT WITH CHECK) | 278 |
| 12 | RPC-Funktionen (SECURITY DEFINER) | 303 |
| 13 | Server Actions | 317 |
| 14 | Komponenten | 339 |
| 16 | Bekannte User | 383 |
| 17 | Design-System | 395 |

## Repo-Karte (vermeidet Suchen)

- `proxy.ts` — Middleware (Root!). Supabase-Proxy-Helper: `lib/supabase/proxy.ts`.
- `lib/supabase/{client,server}.ts` — Browser- bzw. Server-Client.
- `app/actions/` — Server Actions: `import.ts` (Abacus/H&I), `allocation.ts` (RPC-Aufrufe),
  `heatmap.ts`, `terminplan.ts` (Gantt, aktiv), `schedule.ts` (ungenutzt).
- `app/dashboard/` — `tl/page.tsx`, `pl/page.tsx`, `layout.tsx`. Login: `app/login/`, `app/auth/callback/`.
- `components/` — `ProjectPlanningView`, `EmployeeHeatmapView`, `DataImport`, `DashboardHeader`,
  `GanttBar`, `TerminplanSheet`, `TlDashboardClient`, `sidebar`/`topbar`; UI in `components/ui/`.
- `lib/` — `types.ts`, `planning-phases.ts`, `utils.ts`.
- `01_Context/` — `AI_CONTEXT.md`, `supabase_{schema,rls,rpc}.sql`, Import-Beispiel-JSONs (geschützt).

## Arbeitsweise

- **Vor Codeänderungen** kurz nennen, welche Dateien betroffen sind.
- Bei Dateiänderungen **vollständige Dateien** liefern, keine Snippets.
- **Nach Codeänderungen `npm run build` ausführen** — oder begründen, warum das nicht möglich war.
- Keine destruktiven Schritte (DROP, Datenlöschung, Force-Push) ohne ausdrückliche Rückfrage.

## Kontextdateien schützen

Dateien unter `01_Context/` (insb. `AI_CONTEXT.md`) und die `supabase_*.sql` dürfen
**nur geändert werden, wenn ich ausdrücklich `schreibe Kontext` sage**. Sonst nur lesen.
