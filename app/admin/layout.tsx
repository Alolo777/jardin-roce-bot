'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

function BotonPausa() {
  const [pausado,  setPausado]  = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    async function cargarEstado() {
      try {
        const { data, error } = await supabase
          .from('configuracion_agente')
          .select('bot_pausado')
          .eq('id', 1)
          .single()
        if (error) throw error
        setPausado(data?.bot_pausado ?? false)
      } catch (error) {
        console.error('Error al obtener estado de pausa:', error)
      } finally {
        setCargando(false)
      }
    }
    cargarEstado()
  }, [])

  async function togglePausa() {
    setGuardando(true)
    const nuevo = !pausado
    try {
      const { error } = await supabase
        .from('configuracion_agente')
        .update({ bot_pausado: nuevo })
        .eq('id', 1)
      if (error) throw error
      setPausado(nuevo)
    } catch (err) {
      console.error('Error al cambiar pausa:', err)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return (
    <div className="w-36 h-9 bg-white/20 rounded-full animate-pulse" />
  )

  return (
    <button
      onClick={togglePausa}
      disabled={guardando}
      title={pausado ? 'Flora está dormida. Tú atiendes.' : 'Flora está atendiendo clientes.'}
      className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 ${
        guardando
          ? 'opacity-50 cursor-not-allowed bg-white/20 text-white/70'
          : pausado
            ? 'bg-amber-200/80 text-amber-900 hover:bg-amber-300 shadow-sm hover:shadow-md'
            : 'bg-emerald-200/80 text-emerald-900 hover:bg-emerald-300 shadow-sm hover:shadow-md'
      }`}
    >
      <span className={`relative flex w-2.5 h-2.5 ${pausado ? '' : 'animate-pulse'}`}>
        <span className={`absolute inset-0 rounded-full ${pausado ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        {!pausado && (
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
        )}
      </span>
      <span>{guardando ? '...' : pausado ? 'Flora dormida' : 'Flora activa'}</span>
    </button>
  )
}

const NAV_LINKS = [
  { href: '/admin/inventario', label: 'Inventario', icon: '🌷' },
  { href: '/admin/prompt', label: 'Cerebro', icon: '🧠' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-white to-amber-50">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-rose-200/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-amber-200/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-4 h-4 bg-rose-300/30 rounded-full animate-drift" />
        <div className="absolute top-1/2 right-1/4 w-3 h-3 bg-amber-300/30 rounded-full animate-drift" style={{ animationDelay: '2s' }} />
        <div className="absolute top-2/3 left-1/2 w-5 h-5 bg-pink-300/20 rounded-full animate-drift" style={{ animationDelay: '4s' }} />
      </div>

      {/* Nav */}
      <nav className="relative bg-gradient-to-r from-rose-600 via-rose-500 to-pink-500 shadow-lg shadow-rose-200/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Brand */}
            <Link href="/admin" className="flex items-center gap-2.5 group">
              <span className="text-2xl animate-float">🌸</span>
              <div>
                <span className="font-bold text-white text-lg tracking-tight">Jardín RoCe</span>
                <span className="hidden sm:inline text-white/70 text-xs ml-2 font-light">· Panel de Control</span>
              </div>
            </Link>

            {/* Right side */}
            <div className="flex items-center gap-1 sm:gap-3">
              {NAV_LINKS.map(link => {
                const activo = pathname === link.href
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                      activo
                        ? 'bg-white/20 text-white shadow-sm'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="text-sm">{link.icon}</span>
                    <span className="hidden sm:inline">{link.label}</span>
                  </Link>
                )
              })}
              <div className="w-px h-6 bg-white/20 mx-1" />
              <BotonPausa />
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  )
}
