'use client'

import { useState, useEffect, useRef } from 'react'

interface NovedadItem {
  telefono: string
  cliente?: string
  tipo: string
  resumen: string
  prioridad: 'baja' | 'media' | 'alta'
  fuente: 'reglas' | 'ia'
}

interface DigestNovedades {
  fechaAnalizada: string | null
  tipoVentana: 'dia_anterior' | 'reciente'
  generadaEn: string | null
  novedades: NovedadItem[]
}

const ETIQUETAS_TIPO: Record<string, string> = {
  cotizacion_pendiente: 'quiere una cotización',
  pedido_sin_tratar: 'quiere apartar un pedido y no ha avanzado',
  cambio_fecha: 'intentó cambiar la fecha/hora de entrega',
  modificacion_arreglo: 'quiere modificar su arreglo floral',
  pago_pendiente: 'queda pendiente su comprobante de pago',
  entrega_programada: 'tiene entrega/recogida programada',
  esperando_respuesta_equipo: 'espera respuesta del equipo',
  duda_sin_responder: 'tiene una duda sin responder',
  queja: 'tiene una queja o reclamo',
  otro: 'tiene un tema pendiente',
}

export default function AdministradoresPage() {
  const [numeros, setNumeros] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [nuevoNumero, setNuevoNumero] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  // ─── Novedades (DEC-084 / BUG-024) ───
  const [digest, setDigest] = useState<DigestNovedades | null>(null)
  const [cargandoDigest, setCargandoDigest] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [mensajeNovedades, setMensajeNovedades] = useState<string | null>(null)
  const generadaEnAntesRef = useRef<string | null>(null)

  async function cargarDigest() {
    try {
      const res = await fetch('/api/novedades')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setDigest(data.digest ?? null)
    } catch {
      /* silencioso */
    } finally {
      setCargandoDigest(false)
    }
  }

  useEffect(() => { cargarDigest() }, [])

  // Tras enviar el comando, consulta cada 5s hasta que generadaEn cambie (máx 90s)
  async function esperarRegeneracion() {
    let intentos = 0
    while (intentos < 18) {
      await new Promise(r => setTimeout(r, 5000))
      intentos++
      try {
        const res = await fetch('/api/novedades', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          const nueva = data.digest?.generadaEn ?? null
          if (nueva && nueva !== generadaEnAntesRef.current) {
            setDigest(data.digest ?? null)
            setActualizando(false)
            setMensajeNovedades('✅ Novedades actualizadas')
            return
          }
        }
      } catch { /* reintenta */ }
    }
    setActualizando(false)
    setMensajeNovedades('⚠️ El bot no confirmó la actualización. Revisa la sección Logs o los logs de la VM.')
  }

  async function regenerarAhora() {
    setError(null)
    setExito(null)
    setActualizando(true)
    setMensajeNovedades('Enviando comando al bot…')
    generadaEnAntesRef.current = digest?.generadaEn ?? null
    try {
      const res = await fetch('/api/novedades/regenerar', { method: 'POST' })
      if (!res.ok) throw new Error()
      await esperarRegeneracion()
    } catch {
      setActualizando(false)
      setMensajeNovedades(null)
      setError('No se pudo enviar el comando de actualización')
    }
  }

  async function cargar() {
    try {
      const res = await fetch('/api/admins')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNumeros(data.numeros || [])
    } catch {
      setNumeros([])
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  async function guardar(actualizados: string[], mensajeExito: string) {
    setError(null)
    setExito(null)
    try {
      const res = await fetch('/api/admins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeros: actualizados }),
      })
      if (!res.ok) throw new Error()
      setNumeros(actualizados)
      setExito(mensajeExito)
    } catch {
      setError('No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function agregar() {
    const limpio = nuevoNumero.trim()
    if (!limpio) return
    setGuardando(true)
    await guardar([...numeros, limpio], 'Número agregado')
    setNuevoNumero('')
  }

  async function eliminar(idx: number) {
    setGuardando(true)
    await guardar(numeros.filter((_, i) => i !== idx), 'Número eliminado')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">🛡️ Administradores del Bot</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Estos números pueden escribirle al WhatsApp del bot y pedirle las novedades pendientes de cada chat.
          El bot les envía el resumen diario a las 6 am y responden bajo demanda cuando pregunten.
        </p>
      </div>

      {/* ─── Novedades ─── */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-amber-100/80 p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-1 h-6 bg-gradient-to-b from-amber-400 to-orange-400 rounded-full" />
            <h2 className="text-lg font-semibold text-gray-800">📋 Novedades de los chats</h2>
          </div>
          <button
            onClick={regenerarAhora}
            disabled={actualizando}
            className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition shadow-md shadow-amber-200/30"
          >
            <span className={actualizando ? 'animate-spin' : ''}>🔄</span>
            {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          El bot genera automáticamente el resumen a las 3 am (día anterior) y lo envía a las 6 am.
          El botón analiza los últimos 2 días (60 mensajes por chat) y muestra el resultado aquí y a los admins.
          Tip: también puedes preguntarle al bot por WhatsApp: "¿qué pasó con el 7890?" (últimos 4 dígitos) o "¿y Lizet?".
        </p>

        {mensajeNovedades && (
          <div className={`text-sm rounded-xl px-4 py-3 mb-4 ${mensajeNovedades.startsWith('✅') ? 'text-emerald-700 bg-emerald-50' : mensajeNovedades.startsWith('⚠️') ? 'text-amber-700 bg-amber-50' : 'text-gray-600 bg-gray-50'}`}>
            {mensajeNovedades}
          </div>
        )}

        {cargandoDigest ? (
          <div className="animate-pulse bg-gray-50 rounded-xl h-20" />
        ) : !digest || digest.novedades.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">
            Sin digest generado todavía. Pulsa «Actualizar ahora» o espera el job automático de las 3 am.
          </div>
        ) : (
          <div>
            <div className="text-xs text-gray-400 mb-3">
              {digest.tipoVentana === 'reciente'
                ? 'Últimas 48 horas'
                : `Día analizado: ${digest.fechaAnalizada}`}
              {digest.generadaEn && <> · Generado: {new Date(digest.generadaEn).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</>}
              {' · '}{digest.novedades.length} novedad(es)
            </div>
            <div className="space-y-2">
              {digest.novedades.map((n, i) => {
                const marca = n.prioridad === 'alta' ? '🔴' : n.prioridad === 'media' ? '🟡' : '⚪'
                return (
                  <div key={i} className="rounded-xl bg-gray-50/80 px-4 py-3 text-sm">
                    <span className="mr-1">{marca}</span>
                    <span className="font-mono font-semibold text-gray-700">{n.telefono}</span>
                    {n.cliente && <span className="text-gray-500"> ({n.cliente})</span>}
                    <span className="text-gray-600">: {ETIQUETAS_TIPO[n.tipo] ?? n.tipo}</span>
                    {n.resumen && <span className="text-gray-500"> — {n.resumen}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-rose-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Agregar administrador</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="text" value={nuevoNumero} onChange={e => setNuevoNumero(e.target.value)}
            placeholder="521234567890"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-rose-50/20"
            onKeyDown={e => e.key === 'Enter' && agregar()}
          />
          <button
            onClick={agregar} disabled={guardando || !nuevoNumero.trim()}
            className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-xl transition shadow-md shadow-rose-200/30"
          >
            {guardando ? '...' : 'Agregar'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Formato: código de país + número (ej. 521234567890). Con o sin @c.us funciona.
        </p>
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{error}</div>}
      {exito && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">{exito}</div>}

      {cargando ? (
        <div className="animate-pulse bg-white/80 rounded-2xl h-32" />
      ) : numeros.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 opacity-50">🛡️</div>
          <p className="text-gray-400 text-lg">No hay administradores registrados</p>
          <p className="text-gray-300 text-sm mt-1">Agrega el primer número para recibir novedades del bot</p>
        </div>
      ) : (
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100/80 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Administradores ({numeros.length})</h2>
          <div className="space-y-2">
            {numeros.map((num, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-gray-50/80 px-4 py-3">
                <span className="text-sm font-mono text-gray-700">{num}</span>
                <button
                  onClick={() => eliminar(i)}
                  className="text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg px-3 py-1.5 transition"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
