'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Loader2, LogIn } from 'lucide-react'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('E-Mail oder Passwort falsch.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[10px] tracking-[0.15em] uppercase text-slate-500 font-medium mb-1.5">
          E-Mail
        </label>
        <input
          type="email"
          required
          placeholder="name@buero.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="
            w-full rounded-lg border border-slate-200 bg-slate-50
            px-4 py-3 text-sm text-slate-800 placeholder-slate-300
            outline-none transition-all
            focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100
          "
        />
      </div>

      <div>
        <label className="block text-[10px] tracking-[0.15em] uppercase text-slate-500 font-medium mb-1.5">
          Passwort
        </label>
        <input
          type="password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="
            w-full rounded-lg border border-slate-200 bg-slate-50
            px-4 py-3 text-sm text-slate-800 placeholder-slate-300
            outline-none transition-all
            focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100
          "
        />
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="
          mt-2 w-full flex items-center justify-center gap-2
          rounded-lg bg-slate-800 text-white
          px-4 py-3 text-sm font-medium
          transition-all hover:bg-slate-700 active:scale-[0.98]
          disabled:opacity-50 disabled:cursor-not-allowed
        "
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <LogIn className="h-4 w-4" />
            Anmelden
          </>
        )}
      </button>
    </form>
  )
}
