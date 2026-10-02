'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-client'

type Lado = 'cliente' | 'flora' | 'equipo' | 'sistema'

type Conversacion = {
  telefono: string
  mostrar: string
  nombre: string | null
  ultimoMensaje: string
  ultimoLado: Lado
  ultimaActividad: string
  noLeidos: number
  pausado: boolean
  pausaPropia: boolean
  pedido: { producto: string | null; estado: string | null; estadoFlujo: string | null; total: number | null } | null
  caso: { tipo: string | null; prioridad: string | null } | null
}

type Mensaje = {
  id: string
  lado: Lado
  texto: string
  creadoEn: string
}

type DetalleChat = {
  telefono: string
  mostrar: string
  mensajes: Mensaje[]
  contacto: {
    nombre: string | null
    pedido: any | null
    caso: any | null
    pausado: boolean
    pausaPropia: boolean
  }
  outbox: { pendientes: number; ultimoError: { texto: string; detalle: string | null; fecha: string } | null }
}

function haceCuanto(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

function horaCorta(iso: string): string {
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return ''
  return f.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

function inicial(nombre: string | null, telefono: string): string {
  if (nombre?.trim()) return nombre.trim().charAt(0).toUpperCase()
  const d = telefono.replace(/\D/g, '')
  return d.slice(-2, -1) || '•'
}

// División del timeline por día (zona America/Mexico_City).
function diaKeyCdmx(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) // YYYY-MM-DD
}

function etiquetaDia(key: string): string {
  const fmt = (f: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(f)
  const ahora = Date.now()
  if (key === fmt(new Date(ahora))) return 'Hoy'
  if (key === fmt(new Date(ahora - 24 * 60 * 60_000))) return 'Ayer'
  const [y, m, dd] = key.split('-').map(Number)
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  if (!y || !m || !dd) return key
  return `${dd} de ${meses[m - 1]}${y !== new Date().getFullYear() ? ` de ${y}` : ''}`
}

type FilaTimeline = { kind: 'dia'; key: string; etiqueta: string } | { kind: 'msg'; m: Mensaje }

function filasTimeline(mensajes: Mensaje[]): FilaTimeline[] {
  const filas: FilaTimeline[] = []
  let ultimoDia = ''
  for (const m of mensajes) {
    const dia = diaKeyCdmx(m.creadoEn)
    if (dia && dia !== ultimoDia) {
      ultimoDia = dia
      filas.push({ kind: 'dia', key: `dia-${dia}-${m.id}`, etiqueta: etiquetaDia(dia) })
    }
    filas.push({ kind: 'msg', m })
  }
  return filas
}

const ESTADO_PEDIDO_LABEL: Record<string, string> = {
  cotizacion: 'Cotización',
  apartado: 'Apartado',
  pagado: 'Pagado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

export default function WhatsappPage() {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([])
  const [cargandoLista, setCargandoLista] = useState(true)
  const [errorLista, setErrorLista] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [telefonoActivo, setTelefonoActivo] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<DetalleChat | null>(null)
  const [cargandoChat, setCargandoChat] = useState(false)
  const [errorChat, setErrorChat] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mutandoPausa, setMutandoPausa] = useState(false)
  const [verContacto, setVerContacto] = useState(false)
  const fondoRef = useRef<HTMLDivElement>(null)
  const busquedaTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargarLista = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/chat/conversaciones${q ? `?q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar')
      setConversaciones(data.conversaciones ?? [])
      setErrorLista(null)
    } catch (e) {
      setErrorLista(e instanceof Error && e.message ? e.message : 'No se pudo cargar la bandeja')
    } finally {
      setCargandoLista(false)
    }
  }, [])

  const cargarChat = useCallback(async (telefono: string) => {
    setCargandoChat(true)
    setErrorChat(null)
    try {
      const res = await fetch(`/api/chat/mensajes?telefono=${encodeURIComponent(telefono)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar')
      setDetalle(data)
    } catch (e) {
      setErrorChat(e instanceof Error && e.message ? e.message : 'No se pudo cargar la conversación')
    } finally {
      setCargandoChat(false)
    }
  }, [])

  // Carga inicial + polling de respaldo cada 10s
  useEffect(() => {
    cargarLista('')
    const interval = setInterval(() => cargarLista(busquedaRef.current), 10_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargarLista])

  const busquedaRef = useRef('')
  useEffect(() => { busquedaRef.current = busqueda }, [busqueda])

  // Búsqueda con debounce (servidor)
  function onBuscar(v: string) {
    setBusqueda(v)
    if (busquedaTimer.current) clearTimeout(busquedaTimer.current)
    busquedaTimer.current = setTimeout(() => {
      setCargandoLista(true)
      cargarLista(v.trim())
    }, 400)
  }

  // Realtime: cualquier INSERT en historial_chat refresca bandeja y chat abierto.
  // (Requiere la tabla en la publicación supabase_realtime — ver guía.)
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const canal = supabase
      .channel('whatsapp-dashboard')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'historial_chat' },
        () => {
          cargarLista(busquedaRef.current)
          if (telefonoActivo) cargarChat(telefonoActivo)
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [cargarLista, cargarChat, telefonoActivo])

  // Polling del chat abierto (respaldo si Realtime no está activo)
  useEffect(() => {
    if (!telefonoActivo) return
    cargarChat(telefonoActivo)
    const interval = setInterval(() => cargarChat(telefonoActivo), 10_000)
    return () => clearInterval(interval)
  }, [telefonoActivo, cargarChat])

  // Auto-scroll al fondo al cambiar mensajes
  useEffect(() => {
    const el = fondoRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [detalle?.mensajes.length])

  function abrirChat(c: Conversacion) {
    setTelefonoActivo(c.telefono)
    setDetalle(null)
    setTexto('')
    setVerContacto(false)
    // Limpieza visual local del badge (el servidor lo recalcula)
    setConversaciones((prev) =>
      prev.map((x) => (x.telefono === c.telefono ? { ...x, noLeidos: 0 } : x))
    )
  }

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault()
    const limpio = texto.trim()
    if (!telefonoActivo || !limpio || enviando) return
    setEnviando(true)
    try {
      const res = await fetch('/api/chat/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: telefonoActivo, texto: limpio.slice(0, 1000) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar')
      setTexto('')
      // El bot lo recoge en ~4s; recargar tras una pausa para verlo en el timeline
      setTimeout(() => {
        cargarChat(telefonoActivo)
        cargarLista(busquedaRef.current)
      }, 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo enviar')
    } finally {
      setEnviando(false)
    }
  }

  async function togglePausa() {
    if (!telefonoActivo || !detalle || mutandoPausa) return
    setMutandoPausa(true)
    try {
      const res = await fetch('/api/chat/pausar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono: telefonoActivo, pausar: !detalle.contacto.pausado }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo cambiar')
      if (data.nota) alert(data.nota)
      await cargarChat(telefonoActivo)
      cargarLista(busquedaRef.current)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo cambiar')
    } finally {
      setMutandoPausa(false)
    }
  }

  const activa = conversaciones.find((c) => c.telefono === telefonoActivo) ?? null
  const pausado = detalle?.contacto.pausado ?? activa?.pausado ?? false
  const pedido = detalle?.contacto.pedido ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">💬 WhatsApp</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Bandeja del equipo: lee y responde chats. Al responder, Flora se pausa solo en ese chat.
          </p>
        </div>
        <Link href="/admin/operaciones" className="text-sm font-medium text-rose-500 hover:text-rose-600">
          Ver Operaciones →
        </Link>
      </div>

      {errorLista && (
        <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3 flex items-center justify-between">
          <span>{errorLista}</span>
          <button onClick={() => { setCargandoLista(true); cargarLista(busquedaRef.current) }} className="font-semibold underline">
            Reintentar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[70vh]">
        {/* ── Lista de conversaciones ─────────────────────────── */}
        <div className={`lg:col-span-4 xl:col-span-3 bg-white/90 rounded-3xl shadow-lg border border-gray-100/80 overflow-hidden flex-col ${telefonoActivo ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-4 border-b border-gray-100">
            <input
              value={busqueda}
              onChange={(e) => onBuscar(e.target.value)}
              placeholder="🔎 Buscar por nombre, número o texto..."
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-rose-50/30"
            />
          </div>
          <div className="flex-1 overflow-y-auto max-h-[60vh] lg:max-h-[68vh]">
            {cargandoLista ? (
              <div className="p-4 space-y-3 animate-pulse">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 bg-gray-100 rounded-xl" />
                ))}
              </div>
            ) : conversaciones.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                <p className="text-3xl mb-2">🌸</p>
                Sin conversaciones todavía.
              </div>
            ) : (
              conversaciones.map((c) => (
                <button
                  key={c.telefono}
                  onClick={() => abrirChat(c)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-rose-50/60 transition flex gap-3 items-start ${
                    c.telefono === telefonoActivo ? 'bg-rose-50' : ''
                  }`}
                >
                  <span className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-rose-400 to-pink-400 text-white flex items-center justify-center font-bold">
                    {inicial(c.nombre, c.telefono)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-gray-800 truncate">
                        {c.nombre ?? c.mostrar ?? c.telefono}
                        {c.pausado && <span title="Flora pausada en este chat"> ⏸️</span>}
                      </span>
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{haceCuanto(c.ultimaActividad)}</span>
                    </span>
                    <span className="block text-xs text-gray-500 truncate mt-0.5">
                      {c.ultimoLado === 'equipo' ? 'Tú: ' : c.ultimoLado === 'flora' ? 'Flora: ' : ''}{c.ultimoMensaje || '—'}
                    </span>
                    <span className="flex items-center gap-1.5 mt-1">
                      {c.pedido?.estado && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                          {ESTADO_PEDIDO_LABEL[c.pedido.estado] ?? c.pedido.estado}
                        </span>
                      )}
                      {c.noLeidos > 0 && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-bold">
                          {c.noLeidos}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Conversación + composer ──────────────────────────── */}
        <div className={`lg:col-span-8 xl:col-span-6 bg-white/90 rounded-3xl shadow-lg border border-gray-100/80 overflow-hidden flex-col ${telefonoActivo ? 'flex' : 'hidden lg:flex'}`}>
          {!telefonoActivo ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
              <p className="text-4xl mb-3">💬</p>
              <p className="text-sm">Selecciona una conversación para leer y responder.</p>
            </div>
          ) : (
            <>
              {/* Header del chat */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                <button onClick={() => setTelefonoActivo(null)} className="lg:hidden text-gray-400 hover:text-gray-600 text-xl leading-none">
                  ←
                </button>
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-400 to-pink-400 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {inicial(detalle?.contacto.nombre ?? activa?.nombre ?? null, telefonoActivo)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-800 truncate">
                    {detalle?.contacto.nombre ?? activa?.nombre ?? detalle?.mostrar ?? activa?.mostrar ?? telefonoActivo}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {detalle?.mostrar ?? activa?.mostrar ?? telefonoActivo}
                    {pausado ? ' · ⏸️ Flora pausada' : ' · Flora activa'}
                  </p>
                </div>
                <button
                  onClick={() => setVerContacto((v) => !v)}
                  className="xl:hidden text-xs font-medium text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5"
                >
                  {verContacto ? 'Ocultar ficha' : 'Ver ficha'}
                </button>
                <button
                  onClick={togglePausa}
                  disabled={mutandoPausa || cargandoChat}
                  className={`text-xs font-semibold rounded-lg px-3 py-1.5 transition disabled:opacity-50 ${
                    pausado
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  }`}
                >
                  {mutandoPausa ? '...' : pausado ? '▶ Reanudar Flora' : '⏸ Pausar Flora'}
                </button>
              </div>

              {/* Timeline */}
              <div ref={fondoRef} className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-gradient-to-b from-rose-50/40 to-white max-h-[52vh] lg:max-h-[54vh]">
                {cargandoChat && !detalle ? (
                  <div className="space-y-3 animate-pulse">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className={`h-12 rounded-2xl ${i % 2 ? 'bg-gray-100 ml-12' : 'bg-rose-100/60 mr-12'}`} />
                    ))}
                  </div>
                ) : errorChat ? (
                  <div className="text-center text-sm text-rose-600 py-8">
                    {errorChat}{' '}
                    <button onClick={() => cargarChat(telefonoActivo)} className="underline font-semibold">
                      Reintentar
                    </button>
                  </div>
                ) : detalle && detalle.mensajes.length === 0 ? (
                  <div className="text-center text-sm text-gray-400 py-8">Sin mensajes en esta conversación.</div>
                ) : (
                  detalle && filasTimeline(detalle.mensajes).map((fila) =>
                    fila.kind === 'dia' ? (
                      <div key={fila.key} className="flex justify-center py-1.5 sticky top-0">
                        <span className="text-[11px] font-semibold text-gray-500 bg-gray-100/90 rounded-full px-3 py-1 shadow-sm">
                          {fila.etiqueta}
                        </span>
                      </div>
                    ) : fila.m.lado === 'sistema' ? (
                      <div key={fila.m.id} className="text-center">
                        <span className="inline-block text-[11px] text-gray-400 bg-gray-100 rounded-full px-3 py-1 max-w-full truncate">
                          {fila.m.texto.slice(0, 120)}
                        </span>
                      </div>
                    ) : (
                      <div key={fila.m.id} className={`flex ${fila.m.lado === 'cliente' ? 'justify-start' : 'justify-end'}`}>
                        <div
                          title={fila.m.creadoEn ? new Date(fila.m.creadoEn).toLocaleString('es-MX') : undefined}
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
                            fila.m.lado === 'cliente'
                              ? 'bg-gray-100 text-gray-800 rounded-tl-md'
                              : fila.m.lado === 'equipo'
                                ? 'bg-gradient-to-br from-rose-500 to-pink-500 text-white rounded-tr-md'
                                : 'bg-emerald-50 text-emerald-900 border border-emerald-100 rounded-tr-md'
                          }`}
                        >
                          {fila.m.lado === 'equipo' && (
                            <p className="text-[10px] font-bold opacity-80 mb-0.5">Tú · equipo</p>
                          )}
                          {fila.m.lado === 'flora' && (
                            <p className="text-[10px] font-bold opacity-70 mb-0.5">🌸 Flora</p>
                          )}
                          <p>{fila.m.texto}</p>
                          <p className={`text-[10px] mt-1 text-right ${fila.m.lado === 'equipo' ? 'opacity-70' : 'text-gray-400'}`}>
                            {horaCorta(fila.m.creadoEn)}
                          </p>
                        </div>
                      </div>
                    )
                  )
                )}
              </div>

              {/* Estado outbox */}
              {detalle && detalle.outbox.pendientes > 0 && (
                <div className="px-4 py-1.5 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
                  ⏳ {detalle.outbox.pendientes} mensaje(s) en camino (el bot los envía en segundos)...
                </div>
              )}
              {detalle?.outbox.ultimoError && (
                <div className="px-4 py-1.5 text-[11px] text-rose-700 bg-rose-50 border-t border-rose-100 truncate">
                  ⚠️ No se pudo enviar: “{detalle.outbox.ultimoError.texto.slice(0, 60)}” ({detalle.outbox.ultimoError.detalle ?? 'error de entrega'}). Reescríbelo para reintentar.
                </div>
              )}

              {/* Composer */}
              <form onSubmit={enviar} className="p-3 border-t border-gray-100">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value.slice(0, 1000))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        enviar()
                      }
                    }}
                    rows={2}
                    placeholder={pausado ? 'Escribe como equipo (Flora pausada aquí)...' : 'Escribe como equipo (se pausará Flora en este chat)...'}
                    className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none resize-none bg-gray-50/60"
                  />
                  <button
                    type="submit"
                    disabled={enviando || !texto.trim()}
                    className="flex-shrink-0 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 disabled:opacity-40 text-white font-semibold px-5 py-2.5 rounded-2xl transition shadow-md shadow-rose-200/40"
                  >
                    {enviando ? '...' : 'Enviar ➤'}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1 text-right">{texto.length}/1000 · Enter envía, Shift+Enter salto de línea</p>
              </form>
            </>
          )}
        </div>

        {/* ── Panel del contacto ───────────────────────────────── */}
        {telefonoActivo && (
          <div className={`xl:col-span-3 bg-white/90 rounded-3xl shadow-lg border border-gray-100/80 p-5 overflow-y-auto max-h-[68vh] ${verContacto ? 'block' : 'hidden xl:block'}`}>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-6 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
              <h2 className="text-base font-semibold text-gray-800">Ficha del contacto</h2>
            </div>
            {!detalle ? (
              <div className="animate-pulse space-y-3">
                <div className="h-10 bg-gray-100 rounded-xl" />
                <div className="h-24 bg-gray-100 rounded-xl" />
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="font-bold text-gray-800">{detalle.contacto.nombre ?? 'Sin nombre registrado'}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{detalle.mostrar ?? detalle.telefono}</p>
                  <p className={`text-xs font-semibold mt-1 ${pausado ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {pausado ? '⏸️ Flora pausada en este chat' : '🟢 Flora activa en este chat'}
                  </p>
                </div>
                {pedido ? (
                  <div className="bg-gray-50/80 rounded-2xl p-3.5 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pedido</p>
                    {pedido.producto && <p><span className="text-gray-500">Producto: </span><span className="font-medium">{pedido.producto}</span></p>}
                    {pedido.estado && <p><span className="text-gray-500">Estado: </span><span className="font-medium">{ESTADO_PEDIDO_LABEL[pedido.estado] ?? pedido.estado}{pedido.estado_flujo ? ` · ${pedido.estado_flujo}` : ''}</span></p>}
                    {pedido.total != null && <p><span className="text-gray-500">Total: </span><span className="font-medium">${Number(pedido.total).toFixed(2)}</span></p>}
                    {pedido.sucursal && <p><span className="text-gray-500">Sucursal: </span><span className="font-medium">{pedido.sucursal}</span></p>}
                    {(pedido.fecha_entrega || pedido.hora_entrega) && (
                      <p><span className="text-gray-500">Entrega: </span><span className="font-medium">{[pedido.fecha_entrega, pedido.hora_entrega].filter(Boolean).join(' ')}</span></p>
                    )}
                    {pedido.direccion && <p><span className="text-gray-500">Dirección: </span><span className="font-medium">{pedido.direccion}</span></p>}
                    {pedido.zona_envio && <p><span className="text-gray-500">Envío: </span><span className="font-medium">{pedido.zona_envio}{pedido.precio_envio != null ? ` ($${Number(pedido.precio_envio).toFixed(2)})` : ''}</span></p>}
                    {pedido.metodo_pago && <p><span className="text-gray-500">Pago: </span><span className="font-medium">{pedido.metodo_pago}</span></p>}
                    {pedido.requiere_revision && <p className="text-amber-700 font-semibold">⚠️ Requiere revisión del equipo</p>}
                  </div>
                ) : (
                  <div className="bg-gray-50/80 rounded-2xl p-3.5 text-gray-400 text-xs">
                    Sin pedido registrado para este cliente.
                  </div>
                )}
                {detalle.contacto.caso && (
                  <div className="bg-violet-50 rounded-2xl p-3.5 space-y-1">
                    <p className="text-xs font-semibold text-violet-500 uppercase tracking-wide">Caso activo</p>
                    <p><span className="text-gray-500">Tipo: </span><span className="font-medium">{detalle.contacto.caso.tipo}</span></p>
                    <p><span className="text-gray-500">Prioridad: </span><span className="font-medium capitalize">{detalle.contacto.caso.prioridad}</span></p>
                  </div>
                )}
                <Link href="/admin/operaciones" className="block text-center text-xs font-semibold text-rose-500 border border-rose-200 rounded-xl px-3 py-2 hover:bg-rose-50 transition">
                  Gestionar pedido en Operaciones →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
