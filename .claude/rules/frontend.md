# Regeln: Frontend (Next.js 16, App Router, Tailwind 4)

Für reine UI-, Text- oder Styling-Änderungen genügt diese Datei —
**nicht** unnötig `01_Context/AI_CONTEXT.md` laden.

## Next.js 16 / App Router

- **Middleware-Datei heißt `proxy.ts` (im Root), nicht `middleware.ts`.**
  Niemals eine `middleware.ts` anlegen.
- App Router unter `app/`. Server Components sind Standard; `'use client'` nur,
  wo wirklich Interaktivität nötig ist.

## Server Actions (`'use server'`)

- **Keine Objekt-Exports aus einer `'use server'`-Datei** — aus solchen Modulen
  dürfen nur `async function`s exportiert werden. Konstanten/Objekte/Typen, die
  exportiert werden sollen, in eine separate Datei ohne `'use server'` auslagern.
- Jede exportierte Server Action ist `async`.

## Tailwind 4

- Globale CSS: **`@import "tailwindcss";`** (in `app/globals.css`).
- **Kein altes Tailwind-3-Pattern** — keine `@tailwind base/components/utilities;`,
  keine `tailwind.config` als zentrale Theme-Quelle erwarten; Theme läuft über
  CSS-Variablen / `@theme`.
- UI-Bausteine: shadcn/ui-Komponenten unter `components/`, Icons via lucide-react.

## Allgemein

- Vor Codeänderungen kurz die betroffenen Dateien nennen.
- Vollständige Dateien liefern, keine Snippets.
- Nach Codeänderungen `npm run build` ausführen (oder begründen, warum nicht).
