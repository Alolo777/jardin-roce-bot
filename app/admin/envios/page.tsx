'use client'

import { useState, useEffect } from 'react'
import type { ZonaEnvio } from '@/lib/types'

export default function EnviosPage() {
  const [zonas, setZonas] = useState<ZonaEnvio[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zona, setZona] = useState('')
  const [precio, setPrecio] = useState('')
  const [palabras, setPalabras] = useState('')

  async function cargarZonas() {
    try {
      const res = await fetch('/api/envios')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setZonas(data.zonas)
    } catch {
      setError('No se pudieron cargar las zonas')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarZonas() }, [])

  async function agregarZona(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zona, precio: parseFloat(precio), palabras_clave: palabras }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setZona(''); setPrecio(''); setPalabras('')
      await cargarZonas()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agregar zona')
    }
  }

  async function eliminar(id: string) {
    if (!confirm('Eliminar esta zona?')) return
    try {
      const res = await fetch(`/api/envios/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setZonas(prev => prev.filter(z => z.id !== id))
    } catch {
      setError('No se pudo eliminar la zona')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">📍 Zonas de Envío</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {zonas.length} zonas configuradas
        </p>
      </div>

      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-amber-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-amber-400 to-orange-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Agregar zona</h2>
        </div>
        <form onSubmit={agregarZona} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Zona</label>
            <input type="text" value={zona} onChange={e => setZona(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20"
              placeholder="Centro" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Precio (MXN)</label>
            <input type="number" value={precio} onChange={e => setPrecio(e.target.value)}
              min="1" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20"
              placeholder="60" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Palabras clave</label>
            <input type="text" value={palabras} onChange={e => setPalabras(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20"
              placeholder="centro, zócalo, plaza" required />
          </div>
          <div className="md:col-span-3">
            <p className="text-xs text-gray-400 mb-3">
              Escribe colonias, calles o municipios separados por coma. La IA buscará coincidencias cuando un cliente pregunte por envío.
            </p>
            <button type="submit"
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium px-6 py-2.5 rounded-xl transition shadow-md shadow-amber-200/30">
              📍 Agregar zona
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{error}</div>
      )}

      {cargando ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 bg-white rounded-2xl animate-pulse border border-gray-100" />
          ))}
        </div>
      ) : zonas.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 opacity-50">📍</div>
          <p className="text-gray-400 text-lg">No hay zonas configuradas</p>
          <p className="text-gray-300 text-sm mt-1">Agrega la primera para que Flora pueda cotizar envíos</p>
        </div>
      ) : (
        <div className="space-y-3">
          {zonas.map(z => (
            <div key={z.id}
              className="flex items-center justify-between bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100/80">
              <div className="flex items-center gap-4">
                <span className="text-2xl">📍</span>
                <div>
                  <p className="font-semibold text-gray-800">{z.zona}</p>
                  <p className="text-xs text-gray-400">
                    {z.palabras_clave} · ${z.precio.toFixed(2)} MXN
                  </p>
                </div>
              </div>
              <button onClick={() => eliminar(z.id)}
                className="text-sm text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl px-3 py-2 transition">
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
