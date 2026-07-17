'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'
import QRCode from 'qrcode'

function BotonPausa() {
  const [pausado,  setPausado]  = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const supabase = createSupabaseBrowserClient()
  const toggled = useRef(false)

  useEffect(() => {
    async function cargarEstado() {
      try {
        const { data, error } = await supabase
          .from('configuracion_agente')
          .select('bot_pausado')
          .eq('id', 1)
          .single()
        if (error) throw error
        // ❗ No sobrescribir si el usuario ya hizo toggle manual
        if (!toggled.current) setPausado(data?.bot_pausado ?? false)
      } catch (error) {
        console.error('Error al obtener estado de pausa:', error)
      } finally {
        setCargando(false)
      }
    }
    cargarEstado()
  }, [])

  async function togglePausa() {
    toggled.current = true
    setGuardando(true)
    const nuevo = !pausado
    setPausado(nuevo) // optimista: cambiar al instante
    try {
      const res = await fetch('/api/bot/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pausado: nuevo }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      setPausado(!nuevo) // revertir si falló
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

function QrDisplay() {
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('configuracion_agente')
          .select('qr_code')
          .eq('id', 1)
          .single()

        if (data?.qr_code) {
          const url = await QRCode.toDataURL(data.qr_code, { width: 280, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } })
          setQrImage(url)
        } else {
          setQrImage(null)
          setOpen(false)
        }
      } catch { /* silently retry */ }
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!qrImage) return null

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        title="Escanea QR para vincular WhatsApp"
        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 text-amber-200/90 hover:bg-white/10 hover:text-amber-100"
      >
        <span className="text-base">📱</span>
        <span className="hidden sm:inline text-xs">Vincular</span>
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 bg-white rounded-2xl shadow-2xl border border-amber-100 p-5 flex flex-col items-center">
          <p className="text-sm font-semibold text-gray-700 mb-3">Vincula WhatsApp</p>
          <img src={qrImage} alt="QR de WhatsApp" className="rounded-xl" />
          <p className="text-xs text-gray-400 mt-3 text-center leading-relaxed">
            Abre WhatsApp en tu celular →<br />
            Menú ⋮ → WhatsApp Web → Escanea
          </p>
        </div>
      )}
    </div>
  )
}

const NAV_LINKS = [
  { href: '/admin', label: 'Dashboard', icon: '📊' },
  { href: '/admin/prompt', label: 'Cerebro', icon: '🧠' },
  { href: '/admin/empleados', label: 'Empleados', icon: '👥' },
  { href: '/admin/ignorados', label: 'Silenciados', icon: '🔇' },
  { href: '/admin/logs', label: 'Logs', icon: '📜' },
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
              <QrDisplay />
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
