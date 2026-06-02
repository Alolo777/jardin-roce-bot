'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      router.push('/admin/inventario')
      router.refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg === 'Invalid login credentials'
        ? 'Correo o contraseña incorrectos'
        : msg
      )
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-600 via-pink-500 to-rose-400 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative petals */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-[20%] w-6 h-6 bg-white/10 rounded-full animate-petal" />
        <div className="absolute top-20 left-[60%] w-4 h-4 bg-white/10 rounded-full animate-petal" style={{ animationDelay: '1s' }} />
        <div className="absolute top-5 left-[40%] w-5 h-5 bg-white/10 rounded-full animate-petal" style={{ animationDelay: '2s' }} />
        <div className="absolute top-32 left-[75%] w-3 h-3 bg-white/10 rounded-full animate-petal" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-12 left-[85%] w-7 h-7 bg-white/10 rounded-full animate-petal" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="relative w-full max-w-md animate-bloom">
        {/* Decorative header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full mb-4 shadow-lg">
            <span className="text-4xl animate-float">🌸</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Jardín RoCe</h1>
          <p className="text-white/80 text-sm mt-1.5">Panel de Administración — <span className="font-medium text-white/90">Flora</span></p>
        </div>

        {/* Card */}
        <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl shadow-rose-900/20 p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-rose-400 focus:border-transparent outline-none transition bg-rose-50/30"
                placeholder="admin@jardinroce.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-rose-400 focus:border-transparent outline-none transition bg-rose-50/30"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
                <span>🌹</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="w-full bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-rose-200/50 disabled:shadow-none"
            >
              {cargando ? 'Entrando al jardín...' : 'Entrar al jardín 🌸'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/60 text-xs mt-6">
          Florería Jardín RoCe — Apizaco, Tlaxcala
        </p>
      </div>
    </div>
  )
}
