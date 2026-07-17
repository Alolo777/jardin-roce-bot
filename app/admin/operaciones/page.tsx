'use client'

import { useState, useEffect, useCallback } from 'react'

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
  fecha_entrega?: string | null
  hora_entrega?: string | null
  detalles_especiales?: string | null
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

type EditForm = {
  cliente_nombre: string
  producto: string
  precio_arreglo: string
  sucursal: string
  fecha_entrega: string
  hora_entrega: string
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

const ACCIONES_RAPIDAS: Record<string, Array<{ label: string; estado: string; color: string }>> = {
  COTIZANDO: [{ label: '→ Apartado', estado: 'APARTADO', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' }],
  PRECIO_CONFIRMADO: [{ label: '→ Apartado', estado: 'APARTADO', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' }],
  ESPERANDO_DATOS: [{ label: '→ Esp. Pago', estado: 'ESPERANDO_PAGO', color: 'bg-amber-100 text-amber-700 hover:bg-amber-200' }],
  ESPERANDO_PAGO: [{ label: '→ Apartado', estado: 'APARTADO', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' }],
  APARTADO: [{ label: '→ Producción', estado: 'EN_PRODUCCION', color: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' }],
  EN_PRODUCCION: [{ label: '→ Listo', estado: 'LISTO', color: 'bg-teal-100 text-teal-700 hover:bg-teal-200' }],
  LISTO: [{ label: '→ Entregado', estado: 'ENTREGADO', color: 'bg-green-100 text-green-700 hover:bg-green-200' }],
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
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ cliente_nombre: '', producto: '', precio_arreglo: '', sucursal: '', fecha_entrega: '', hora_entrega: '' })
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [filtroSucursal, setFiltroSucursal] = useState<string>('')
  const [filtroRevision, setFiltroRevision] = useState(false)
  const [mutando, setMutando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    cargar()
    const interval = setInterval(cargar, 15000)
    return () => clearInterval(interval)
  }, [cargar])

  async function actualizarEstado(p: PedidoActivo, nuevoEstado: string) {
    if (!p.id) return
    setMutando(p.id)
    try {
      const estadoLegacy = { COTIZANDO: 'cotizacion', APARTADO: 'apartado', EN_PRODUCCION: 'pagado', LISTO: 'pagado', ENTREGADO: 'entregado', CANCELADO: 'cancelado' }
      await fetch(`/api/pedidos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: estadoLegacy[nuevoEstado as keyof typeof estadoLegacy] ?? 'cotizacion', estado_flujo: nuevoEstado }),
      })
    } finally {
      setMutando(null)
      cargar()
    }
  }

  async function guardarEdicion(p: PedidoActivo) {
    if (!p.id) return
    setMutando(p.id)
    try {
      const body: Record<string, unknown> = {}
      if (editForm.cliente_nombre !== (p.cliente_nombre ?? '')) body.cliente_nombre = editForm.cliente_nombre
      if (editForm.producto !== (p.producto ?? '')) body.producto = editForm.producto
      if (editForm.precio_arreglo !== String(p.precio_arreglo ?? '')) body.precio_arreglo = Number(editForm.precio_arreglo) || null
      if (editForm.sucursal !== (p.sucursal ?? '')) body.sucursal = editForm.sucursal
      if (editForm.fecha_entrega !== (p.fecha_entrega ?? '')) body.fecha_entrega = editForm.fecha_entrega || null
      if (editForm.hora_entrega !== (p.hora_entrega ?? '')) body.hora_entrega = editForm.hora_entrega || null
      if (Object.keys(body).length === 0) { setEditandoId(null); return }
      await fetch(`/api/pedidos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setEditandoId(null)
    } finally {
      setMutando(null)
      cargar()
    }
  }

  function abrirEdicion(p: PedidoActivo) {
    setEditForm({
      cliente_nombre: p.cliente_nombre ?? '',
      producto: p.producto ?? '',
      precio_arreglo: String(p.precio_arreglo ?? ''),
      sucursal: p.sucursal ?? '',
      fecha_entrega: p.fecha_entrega ?? '',
      hora_entrega: p.hora_entrega ?? '',
    })
    setEditandoId(p.id ?? '')
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setEditForm({ cliente_nombre: '', producto: '', precio_arreglo: '', sucursal: '', fecha_entrega: '', hora_entrega: '' })
  }

  const agrupados = pedidos.reduce<Record<string, PedidoActivo[]>>((acc, p) => {
    const key = flujoAEstado(p.estado_flujo, p.estado)
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  const ordenEstados = ['NUEVO', 'COTIZANDO', 'PRECIO_CONFIRMADO', 'ESPERANDO_DATOS', 'ESPERANDO_PAGO', 'APARTADO', 'EN_PRODUCCION', 'LISTO']

  function pedidoFiltrado(p: PedidoActivo): boolean {
    if (filtroEstado && flujoAEstado(p.estado_flujo, p.estado) !== filtroEstado) return false
    if (filtroSucursal && !(p.sucursal ?? '').toLowerCase().includes(filtroSucursal.toLowerCase())) return false
    if (filtroRevision && !p.requiere_revision) return false
    return true
  }

  const sucursales = [...new Set(pedidos.map(p => p.sucursal).filter(Boolean))] as string[]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Operaciones en tiempo real</h1>
          <p className="text-sm text-gray-500">Pedidos activos por estado de la máquina. Se actualiza cada 15s.</p>
        </div>
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

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-200"
        >
          <option value="">Todos los estados</option>
          {ordenEstados.map(e => (
            <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
          ))}
        </select>

        <select
          value={filtroSucursal}
          onChange={e => setFiltroSucursal(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-200"
        >
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filtroRevision}
            onChange={e => setFiltroRevision(e.target.checked)}
            className="rounded border-gray-300 text-rose-500 focus:ring-rose-200"
          />
          Solo revisión
        </label>

        {(filtroEstado || filtroSucursal || filtroRevision) && (
          <button
            onClick={() => { setFiltroEstado(''); setFiltroSucursal(''); setFiltroRevision(false) }}
            className="text-xs text-rose-500 hover:text-rose-700 font-medium"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {cargando ? (
        <div className="bg-white/80 rounded-2xl p-8 border border-gray-100 animate-pulse h-40" />
      ) : pedidos.length === 0 ? (
        <div className="rounded-2xl bg-white/80 border border-gray-100 p-8 text-center text-gray-400">
          No hay pedidos activos en este momento
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
                  {agrupados[estado].filter(pedidoFiltrado).map((p, i) => (
                    <div key={p.id ?? `${p.telefono}-${i}`} className="flex items-start justify-between gap-3 rounded-xl bg-gray-50/80 p-3">
                      <div className="min-w-0 flex-1">
                        {editandoId === p.id ? (
                          <div className="space-y-2">
                            <input
                              value={editForm.cliente_nombre}
                              onChange={e => setEditForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                              className="w-full rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                              placeholder="Nombre"
                            />
                            <input
                              value={editForm.producto}
                              onChange={e => setEditForm(f => ({ ...f, producto: e.target.value }))}
                              className="w-full rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                              placeholder="Producto"
                            />
                            <div className="flex gap-2">
                              <input
                                value={editForm.precio_arreglo}
                                onChange={e => setEditForm(f => ({ ...f, precio_arreglo: e.target.value }))}
                                className="w-28 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                                placeholder="Precio"
                                type="number"
                                step="0.01"
                              />
                              <input
                                value={editForm.sucursal}
                                onChange={e => setEditForm(f => ({ ...f, sucursal: e.target.value }))}
                                className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                                placeholder="Sucursal"
                              />
                            </div>
                            <div className="flex gap-2">
                              <input
                                value={editForm.fecha_entrega}
                                onChange={e => setEditForm(f => ({ ...f, fecha_entrega: e.target.value }))}
                                className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                                placeholder="Fecha (YYYY-MM-DD)"
                              />
                              <input
                                value={editForm.hora_entrega}
                                onChange={e => setEditForm(f => ({ ...f, hora_entrega: e.target.value }))}
                                className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                                placeholder="Hora"
                              />
                            </div>
                            <div className="flex gap-2 mt-1">
                              <button
                                onClick={() => guardarEdicion(p)}
                                disabled={mutando === p.id}
                                className="text-xs font-semibold bg-rose-100 text-rose-700 rounded-lg px-2.5 py-1 hover:bg-rose-200 disabled:opacity-50"
                              >{mutando === p.id ? 'Guardando...' : 'Guardar'}</button>
                              <button
                                onClick={cancelarEdicion}
                                className="text-xs font-medium text-gray-500 hover:text-gray-700"
                              >Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-gray-800 truncate">
                              {p.cliente_nombre || p.producto || 'Cliente'}
                              {p.fecha_entrega && <span className="ml-2 text-xs font-normal text-gray-400">📅 {p.fecha_entrega}</span>}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {p.producto || 'Sin producto'} · {p.sucursal || p.telefono || ''}
                            </p>
                            {p.ultimo_mensaje && (
                              <p className="text-xs text-gray-400 truncate mt-1">{p.ultimo_mensaje}</p>
                            )}
                          </>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        <p className="text-sm font-bold text-gray-700">
                          ${Number(p.total || p.precio_arreglo || 0).toFixed(2)}
                        </p>
                        {p.requiere_revision && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-100 rounded px-1.5 py-0.5">REVISAR</span>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1 justify-end">
                          {ACCIONES_RAPIDAS[estado]?.map(accion => (
                            <button
                              key={accion.estado}
                              onClick={() => actualizarEstado(p, accion.estado)}
                              disabled={mutando === p.id}
                              className={`text-[10px] font-semibold rounded px-1.5 py-0.5 disabled:opacity-50 ${accion.color}`}
                            >{accion.label}</button>
                          ))}
                          <button
                            onClick={() => abrirEdicion(p)}
                            className="text-[10px] font-medium text-gray-400 hover:text-gray-600 rounded px-1.5 py-0.5 border border-gray-200 hover:border-gray-300"
                          >Editar</button>
                        </div>
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
