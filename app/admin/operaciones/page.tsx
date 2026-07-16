'use client'

import { useState, useEffect } from 'react'

type PedidoActivo = {
  id?: string
  cliente_id?: string
  telefono?: string
  cliente_nombre?: string | null
  producto?: string | null
  estado?: string
  estado_flujo?: string | null
  total?: number | null
  precio_arreglo?: number | null
  zona_envio?: string | null
  sucursal?: string | null
  metodo_pago?: string | null
  ultimo_mensaje?: string | null
  requiere_revision?: boolean
  actualizado_en?: string
}

type Resumen = {
  cotizacionesPendientes: number
  esperandoPrecioEquipo: number
  precioConfirmado: number
  esperandoDatos: number
  apartadosSucursal: number
  pagadosTransferencia: number
  conFotoReferencia: number
}

const ESTADO_LABEL: Record<string, string> = {
  NUEVO: 'Nuevo',
  COTIZANDO: 'Cotizando',
  PRECIO_CONFIRMADO: 'Precio confirmado',
  ESPERANDO_DATOS: 'Esperando datos',
  ESPERANDO_PAGO: 'Esperando pago',
  APARTADO: 'Apartado',
  EN_PRODUCCION: 'En producción',
  LISTO: 'Listo',
  ENTREGADO: 'Entregado',
  ARCHIVADO: 'Archivado',
}

function flujoAEstado(flujo: string | null | undefined, estado: string | undefined): string {
  if (flujo && ESTADO_LABEL[flujo]) return flujo
  if (estado && ESTADO_LABEL[estado.toUpperCase()]) return estado.toUpperCase()
  return 'NUEVO'
}

function TarjetaResumen({ label, valor, color }: { label: string; valor: number; color: string }) {
  return (
    <div className={`rounded-2xl ${color} p-4`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-2xl font-bold">{valor}</p>
    </div>
  )
}

export default function OperacionesPage() {
  const [pedidos, setPedidos] = useState<PedidoActivo[]>([])
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [zonasAmbiguas, setZonasAmbiguas] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    try {
      const res = await fetch('/api/bot/status', { cache: 'no-store' })
      const data = await res.json()
      setPedidos(Array.isArray(data.pedidosActivos) ? data.pedidosActivos : [])
      setResumen(data.pedidosResumen ?? null)
      setZonasAmbiguas(data.zonasAmbiguasPendientes ?? 0)
      setError(null)
    } catch {
      setError('No se pudo cargar el estado del bot')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    const interval = setInterval(cargar, 15000)
    return () => clearInterval(interval)
  }, [])

  const agrupados = pedidos.reduce<Record<string, PedidoActivo[]>>((acc, p) => {
    const key = flujoAEstado(p.estado_flujo, p.estado)
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  const ordenEstados = ['NUEVO', 'COTIZANDO', 'PRECIO_CONFIRMADO', 'ESPERANDO_DATOS', 'ESPERANDO_PAGO', 'APARTADO', 'EN_PRODUCCION', 'LISTO']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">📋 Operaciones en tiempo real</h1>
        <p className="text-sm text-gray-500">Pedidos activos por estado de la máquina. Se actualiza cada 15s.</p>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">{error}</div>
      )}

      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <TarjetaResumen label="Cotizaciones" valor={resumen.cotizacionesPendientes} color="bg-sky-50 text-sky-800" />
          <TarjetaResumen label="Esperando precio" valor={resumen.esperandoPrecioEquipo} color="bg-amber-50 text-amber-800" />
          <TarjetaResumen label="Apartados" valor={resumen.apartadosSucursal} color="bg-emerald-50 text-emerald-800" />
          <TarjetaResumen label="Pagados" valor={resumen.pagadosTransferencia} color="bg-teal-50 text-teal-800" />
        </div>
      )}

      {zonasAmbiguas > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Hay {zonasAmbiguas} zona(s) de envío ambiguas pendientes de revisar.
        </div>
      )}

      {cargando ? (
        <div className="bg-white/80 rounded-2xl p-8 border border-gray-100 animate-pulse h-40" />
      ) : pedidos.length === 0 ? (
        <div className="rounded-2xl bg-white/80 border border-gray-100 p-8 text-center text-gray-400">
          No hay pedidos activos en este momento 🌸
        </div>
      ) : (
        <div className="space-y-6">
          {ordenEstados
            .filter(e => agrupados[e]?.length)
            .map(estado => (
              <div key={estado} className="rounded-2xl bg-white/80 border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-5 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
                    {ESTADO_LABEL[estado]} ({agrupados[estado].length})
                  </h2>
                </div>
                <div className="space-y-2">
                  {agrupados[estado].map((p, i) => (
                    <div key={p.id ?? `${p.telefono}-${i}`} className="flex items-start justify-between gap-3 rounded-xl bg-gray-50/80 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {p.cliente_nombre || p.producto || 'Cliente'}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {p.producto || 'Sin producto'} · {p.telefono || ''}
                        </p>
                        {p.ultimo_mensaje && (
                          <p className="text-xs text-gray-400 truncate mt-1">{p.ultimo_mensaje}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-700">
                          ${Number(p.total || p.precio_arreglo || 0).toFixed(2)}
                        </p>
                        {p.requiere_revision && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-100 rounded px-1.5 py-0.5">REVISAR</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
