import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LoginForm from '@/components/login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  const params = await searchParams

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      {/* Subtiles Raster */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          opacity: 0.4,
          backgroundImage: `
            linear-gradient(#e2e8f0 1px, transparent 1px),
            linear-gradient(90deg, #e2e8f0 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />

      <div className="w-full max-w-sm relative z-10">
        {/* Wordmark */}
        <div className="mb-8 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-1">
            Planungsbüro
          </p>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">
            Kapazitäts<span className="text-slate-400 font-normal">vorschau</span>
          </h1>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {params?.error && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
              Anmeldung fehlgeschlagen. Bitte prüfe deine Zugangsdaten.
            </div>
          )}
          <LoginForm />
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-400">
          Zugang nur für autorisierte Mitarbeiter
        </p>
      </div>
    </main>
  )
}
