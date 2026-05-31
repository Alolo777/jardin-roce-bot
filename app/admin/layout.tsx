// app/admin/layout.tsx
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

// ── Botón de pausa del bot ────────────────────────────────────────────────────
function BotonPausa() {
  const [pausado,  setPausado]  = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    supabase
      .from('configuracion_agente')
      .select('bot_pausado')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        setPausado(data?.bot_pausado ?? false)
        setCargando(false)
      })
      .catch(() => setCargando(false))
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
    <div className="w-32 h-8 bg-gray-100 rounded-full animate-pulse" />
  )

  return (
    <button
      onClick={togglePausa}
      disabled={guardando}
      title={pausado ? 'El bot está pausado. Tú estás atendiendo.' : 'El bot está activo respondiendo clientes.'}
      className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
        guardando
          ? 'opacity-50 cursor-not-allowed bg-gray-100 text-gray-400'
          : pausado
            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 ring-1 ring-amber-300'
            : 'bg-green-100 text-green-700 hover:bg-green-200 ring-1 ring-green-300'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${pausado ? 'bg-amber-500' : 'bg-green-500 animate-pulse'}`} />
      {guardando ? 'Guardando...' : pausado ? 'Bot pausado — Tú atiendes' : 'Bot activo'}
    </button>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🌸</span>
            <span className="font-bold text-gray-800">Jardin RoCe Admin</span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/admin/inventario"
              className="text-sm font-medium text-gray-600 hover:text-rose-500 transition"
            >
              📦 Inventario del Día
            </Link>
            <Link
              href="/admin/prompt"
              className="text-sm font-medium text-gray-600 hover:text-rose-500 transition"
            >
              🤖 Prompt del Agente
            </Link>
            {/* Separador */}
            <div className="w-px h-5 bg-gray-200" />
            {/* Botón de pausa */}
            <BotonPausa />
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  )
}