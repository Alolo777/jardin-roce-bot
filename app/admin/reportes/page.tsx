'use client'

import { useState, useEffect, useCallback } from 'react'

type VentasReporte = {
  total: number
  cantidad: number
  promedio: number
  ticketMayor: number
  envios: number
  recogidas: number
  productosTop: Array<{ producto: string; cantidad: number; total: number }>
  porSucursal: Array<{ sucursal: string; cantidad: number; total: number; envios: number }>
  diario: Array<{ fecha: string; total: number; cantidad: number }>
  recientes: Array<{
    cliente_nombre: string | null
    cliente_telefono: string | null
    producto: string
    precio_total: number
    direccion_entrega: string | null
    metodo_pago: string | null
    estado: string
    creado_en: string
  }>
}

const hoy = () => new Date().toISOString().slice(0, 10)
const inicioMes = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export default function ReportesPage() {
  const [desde, setDesde] = useState(inicioMes)
  const [hasta, setHasta] = useState(hoy)
  const [sucursalFiltro, setSucursalFiltro] = useState('')
  const [ventas, setVentas] = useState<VentasReporte | null>(null)
  const [cotizaciones, setCotizaciones] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({ desde, hasta })
      if (sucursalFiltro) params.set('sucursal', sucursalFiltro)
      const res = await fetch(`/api/reportes?${params}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Error al cargar reportes')
      const data = await res.json()
      setVentas(data.ventas)
      setCotizaciones(data.cotizaciones.cantidad)
    } catch {
      setError('No se pudieron cargar los reportes')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta, sucursalFiltro])

  useEffect(() => { cargar() }, [cargar])

  function exportarCSV() {
    if (!ventas?.recientes?.length) return
    const headers = ['Cliente', 'Teléfono', 'Producto', 'Total', 'Dirección', 'Pago', 'Estado', 'Fecha']
    const rows = ventas.recientes.map(v => [
      v.cliente_nombre ?? '',
      v.cliente_telefono ?? '',
      v.producto,
      v.precio_total.toFixed(2),
      v.direccion_entrega ?? '',
      v.metodo_pago ?? '',
      v.estado,
      v.creado_en ? new Date(v.creado_en).toLocaleDateString() : '',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_ventas_${desde}_${hasta}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Reportes de ventas</h1>
        <p className="text-sm text-gray-500">Métricas históricas y desglose por período.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white/80 border border-gray-100 p-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={e => setDesde(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={e => setHasta(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sucursal</label>
          <select
            value={sucursalFiltro}
            onChange={e => setSucursalFiltro(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
          >
            <option value="">Todas</option>
            <option value="Apizaco">Apizaco</option>
            <option value="Centro">Centro</option>
          </select>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="rounded-xl bg-gradient-to-r from-rose-400 to-pink-400 px-5 py-1.5 text-sm font-semibold text-white hover:from-rose-500 hover:to-pink-500 disabled:opacity-50"
        >{cargando ? 'Cargando...' : 'Actualizar'}</button>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">{error}</div>
      )}

      {ventas && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-600">Total ventas</p>
              <p className="text-2xl font-bold text-emerald-800">${ventas.total.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-medium text-sky-600">Pedidos</p>
              <p className="text-2xl font-bold text-sky-800">{ventas.cantidad}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="text-xs font-medium text-amber-600">Promedio</p>
              <p className="text-2xl font-bold text-amber-800">${ventas.promedio.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-rose-50 p-4">
              <p className="text-xs font-medium text-rose-600">Ticket mayor</p>
              <p className="text-2xl font-bold text-rose-800">${ventas.ticketMayor.toFixed(2)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-600">Envíos</p>
              <p className="text-2xl font-bold text-blue-800">{ventas.envios}</p>
            </div>
            <div className="rounded-2xl bg-teal-50 p-4">
              <p className="text-xs font-medium text-teal-600">Recogidas</p>
              <p className="text-2xl font-bold text-teal-800">{ventas.recogidas}</p>
            </div>
            <div className="rounded-2xl bg-purple-50 p-4">
              <p className="text-xs font-medium text-purple-600">Cotizaciones</p>
              <p className="text-2xl font-bold text-purple-800">{cotizaciones}</p>
            </div>
          </div>

          {ventas.diario.length > 0 && (
            <div className="rounded-2xl bg-white/80 border border-gray-100 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3">Ventas por día</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 text-gray-500 font-medium">Fecha</th>
                      <th className="text-right py-2 text-gray-500 font-medium">Ventas</th>
                      <th className="text-right py-2 text-gray-500 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventas.diario.map(d => (
                      <tr key={d.fecha} className="border-b border-gray-50">
                        <td className="py-2 text-gray-700">{new Date(d.fecha + 'T00:00:00').toLocaleDateString()}</td>
                        <td className="py-2 text-right text-gray-700">{d.cantidad}</td>
                        <td className="py-2 text-right font-medium text-gray-800">${d.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {ventas.porSucursal.length > 0 && (
            <div className="rounded-2xl bg-white/80 border border-gray-100 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3">Desglose por sucursal</h3>
              <div className="space-y-2">
                {ventas.porSucursal.map(s => {
                  const maxTotal = Math.max(...ventas.porSucursal.map(x => x.total))
                  const pct = maxTotal > 0 ? (s.total / maxTotal) * 100 : 0
                  return (
                    <div key={s.sucursal} className="flex items-center gap-3">
                      <span className="w-28 text-xs font-medium text-gray-600 truncate">{s.sucursal}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-rose-400 to-pink-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-20 text-right text-xs font-bold text-gray-700">${s.total.toFixed(0)}</span>
                      <span className="w-12 text-right text-xs text-gray-500">{s.cantidad}uds</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ventas.productosTop.length > 0 && (
            <div className="rounded-2xl bg-white/80 border border-gray-100 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3">Productos más vendidos</h3>
              <div className="space-y-2">
                {ventas.productosTop.map(p => {
                  const maxCant = Math.max(...ventas.productosTop.map(x => x.cantidad))
                  const pct = maxCant > 0 ? (p.cantidad / maxCant) * 100 : 0
                  return (
                    <div key={p.producto} className="flex items-center gap-3">
                      <span className="flex-1 text-xs text-gray-700 truncate">{p.producto}</span>
                      <div className="w-32 h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-rose-400 to-pink-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-bold text-gray-700">{p.cantidad}</span>
                      <span className="w-20 text-right text-xs text-gray-500">${p.total.toFixed(0)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ventas.recientes.length > 0 && (
            <div className="rounded-2xl bg-white/80 border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">Ventas recientes</h3>
                <button
                  onClick={exportarCSV}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 rounded-lg px-2.5 py-1 hover:bg-rose-100"
                >Exportar CSV</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 text-gray-500 font-medium">Cliente</th>
                      <th className="text-left py-2 text-gray-500 font-medium">Producto</th>
                      <th className="text-right py-2 text-gray-500 font-medium">Total</th>
                      <th className="text-left py-2 text-gray-500 font-medium">Pago</th>
                      <th className="text-left py-2 text-gray-500 font-medium">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventas.recientes.map((v, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2 text-gray-700 truncate max-w-32">{v.cliente_nombre || v.cliente_telefono || '—'}</td>
                        <td className="py-2 text-gray-600 truncate max-w-32">{v.producto}</td>
                        <td className="py-2 text-right font-medium text-gray-800">${v.precio_total.toFixed(2)}</td>
                        <td className="py-2 text-gray-600">{v.metodo_pago || '—'}</td>
                        <td className="py-2 text-gray-500 whitespace-nowrap">{new Date(v.creado_en).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
