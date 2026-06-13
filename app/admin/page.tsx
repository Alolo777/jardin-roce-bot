'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import QrSection from '@/componets/admin/QrSection'

const FEATURES = [
  {
    href: '/admin/inventario',
    icon: '🌸',
    title: 'Inventario del Día',
    desc: 'Sube fotos, asigna precios y actualiza el catálogo que Flora ofrece hoy a tus clientes.',
    gradient: 'from-rose-400 to-pink-400',
    shadow: 'shadow-rose-200/40',
  },
  {
    href: '/admin/prompt',
    icon: '🌿',
    title: 'Cerebro de Flora',
    desc: 'Edita las instrucciones y la personalidad de la IA. Cambia cómo habla, qué reglas sigue y cómo vende.',
    gradient: 'from-emerald-400 to-teal-400',
    shadow: 'shadow-emerald-200/40',
  },
  {
    href: '/admin/municipios',
    icon: '🏘️',
    title: 'Municipios de Envío',
    desc: 'Gestiona las zonas de envío, precios y colonias. Importa o exporta datos fácilmente.',
    gradient: 'from-cyan-400 to-blue-400',
    shadow: 'shadow-cyan-200/40',
  },
  {
    href: '/admin/ignorados',
    icon: '🔇',
    title: 'Números Silenciados',
    desc: 'Administra qué números de WhatsApp debe ignorar Flora (repartidor, administradores).',
    gradient: 'from-amber-400 to-orange-400',
    shadow: 'shadow-amber-200/40',
  },
]

function BotStatusPanel() {
  const [status, setStatus] = useState<any>(null)
  const [cargando, setCargando] = useState(true)
  const [accion, setAccion] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargar() {
    try {
      const res = await fetch('/api/bot/status', { cache: 'no-store' })
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ connected: false, pausado: false, estado: 'desconectado' })
    } finally {
      setCargando(false)
    }
  }

  async function ejecutarAccion(tipo: 'reconnect' | 'recover') {
    setAccion(tipo)
    setMensaje(null)
    try {
      const res = await fetch(`/api/bot/${tipo}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo ejecutar la acción')
      setMensaje(data.mensaje || 'Acción iniciada')
      setTimeout(cargar, 2000)
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : 'No se pudo ejecutar la acción')
    } finally {
      setAccion(null)
    }
  }

  useEffect(() => {
    cargar()
    const interval = setInterval(cargar, 30000)
    return () => clearInterval(interval)
  }, [])

  if (cargando) {
    return (
      <div className="bg-white/80 rounded-2xl p-6 border border-gray-100 animate-pulse">
        <div className="h-16 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  const estado = status.estado || (status.connected ? 'conectado' : 'desconectado')
  const estadoColor = status.connected
    ? 'text-emerald-700'
    : estado === 'esperando_qr'
      ? 'text-amber-700'
      : status.reconnecting
        ? 'text-blue-700'
        : 'text-rose-700'
  const puntoColor = status.connected ? 'bg-emerald-500' : estado === 'esperando_qr' ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-md border border-gray-100/80 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">🤖 Estado del Bot</h2>
        </div>
        <span className="text-xs text-gray-400">Se actualiza cada 30s</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Conexión */}
        <div className="bg-gray-50/80 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="relative flex w-2.5 h-2.5">
              <span className={`absolute inset-0 rounded-full ${puntoColor}`} />
              {status.connected && (
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
              )}
            </span>
            <span className="text-xs text-gray-500">WhatsApp</span>
          </div>
          <p className={`text-sm font-bold capitalize ${estadoColor}`}>
            {estado.replaceAll('_', ' ')}
          </p>
          {status.estadoDetalle && <p className="text-xs text-gray-500 truncate">{status.estadoDetalle}</p>}
        </div>

        {/* Bot activo/pausado */}
        <div className="bg-gray-50/80 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`relative flex w-2.5 h-2.5`}>
              <span className={`absolute inset-0 rounded-full ${status.pausado ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            </span>
            <span className="text-xs text-gray-500">Flora</span>
          </div>
          <p className={`text-sm font-bold ${status.pausado ? 'text-amber-700' : 'text-emerald-700'}`}>
            {status.pausado ? 'Pausada' : 'Activa'}
          </p>
        </div>

        {/* Ventas hoy */}
        <div className="bg-gray-50/80 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs">💰</span>
            <span className="text-xs text-gray-500">Ventas hoy</span>
          </div>
          <p className="text-sm font-bold text-gray-800">
            {status.ventasHoy ?? '—'} ventas
          </p>
          {status.totalVentasHoy !== undefined && (
            <p className="text-xs text-gray-500">
              ${(status.totalVentasHoy || 0).toFixed(2)} MXN
            </p>
          )}
        </div>

        {/* Actividad */}
        <div className="bg-gray-50/80 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs">⏱️</span>
            <span className="text-xs text-gray-500">Actividad</span>
          </div>
          <p className="text-sm font-bold text-gray-800">
            {status.ultimaActividad ?? '—'}
          </p>
          {status.clientesAtendidosHoy !== undefined && (
            <p className="text-xs text-gray-500">
              {status.clientesAtendidosHoy} msgs hoy
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-gray-500">
          {status.qrScanGraceSeconds !== null && status.qrScanGraceSeconds !== undefined && (
            <span>
              QR se regenera automáticamente en {Math.ceil(status.qrScanGraceSeconds / 60)} min si no se escanea.
            </span>
          )}
          {mensaje && <span className="block text-gray-700 font-medium">{mensaje}</span>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => ejecutarAccion('recover')}
            disabled={accion !== null}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accion === 'recover' ? 'Rescatando...' : 'Rescatar mensajes'}
          </button>
          <button
            type="button"
            onClick={() => ejecutarAccion('reconnect')}
            disabled={accion !== null}
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accion === 'reconnect' ? 'Reiniciando...' : 'Reiniciar conexion'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="relative overflow-hidden bg-gradient-to-br from-rose-500 via-pink-500 to-rose-400 rounded-3xl p-8 shadow-xl shadow-rose-200/40">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl animate-float">🌸</span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">¡Bienvenida, Flor!</h1>
          </div>
          <p className="text-white/80 text-sm sm:text-base max-w-xl">
            Hoy es un día hermoso para atender tu florería. Aquí puedes gestionar lo que Flora
            mostrará y dirá a tus clientes.
          </p>
        </div>
      </div>

      {/* QR section */}
      <QrSection />

      {/* Bot Status */}
      <BotStatusPanel />

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {FEATURES.map((f, i) => (
          <Link
            key={f.href}
            href={f.href}
            className="group relative overflow-hidden bg-white rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-gray-100/80"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            {/* Gradient top accent */}
            <div className={`h-2 bg-gradient-to-r ${f.gradient}`} />

            <div className="p-8">
              <div className="flex items-start gap-5">
                <div className={`flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br ${f.gradient} flex items-center justify-center shadow-lg ${f.shadow} group-hover:scale-110 transition-transform duration-300`}>
                  <span className="text-2xl">{f.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-gray-800 group-hover:text-rose-600 transition-colors">
                    {f.title}
                  </h2>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center text-sm font-medium text-rose-500 group-hover:text-rose-600 transition-colors">
                <span>Entrar</span>
                <span className="ml-1.5 group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick tip */}
      <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">🌱</span>
          <div>
            <p className="text-sm text-amber-800 font-medium">Tip del día</p>
            <p className="text-sm text-amber-700/80 mt-1">
              Recuerda subir los arreglos del día temprano para que Flora pueda mostrarlos
              a los clientes desde que abren.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
