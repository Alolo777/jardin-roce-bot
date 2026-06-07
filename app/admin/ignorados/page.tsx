'use client'

import { useState, useEffect } from 'react'
import type { NumeroIgnorado } from '@/lib/types'

export default function IgnoradosPage() {
  const [numeros, setNumeros] = useState<NumeroIgnorado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numero, setNumero] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    try {
      const res = await fetch('/api/ignorados')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNumeros(data.numeros)
    } catch {
      setError('No se pudieron cargar los números')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      const res = await fetch('/api/ignorados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, descripcion }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNumero(''); setDescripcion('')
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agregar')
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar(id: string) {
    if (!confirm('Eliminar este número de la lista?')) return
    try {
      const res = await fetch(`/api/ignorados/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setNumeros(prev => prev.filter(n => n.id !== id))
    } catch {
      setError('No se pudo eliminar el número')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">🔇 Números Silenciados</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Estos números serán ignorados por Flora. Útil para el repartidor, administradores, etc.
        </p>
      </div>

      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-amber-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-amber-400 to-orange-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Agregar número</h2>
        </div>
        <form onSubmit={agregar} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Número</label>
            <input type="tel" value={numero} onChange={e => setNumero(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20"
              placeholder="521234567890" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Descripción</label>
            <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20"
              placeholder="Repartidor" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={guardando || !numero.trim()}
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 text-white font-medium px-6 py-2.5 rounded-xl transition shadow-md shadow-amber-200/30">
              {guardando ? 'Agregando...' : '🔇 Silenciar'}
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{error}</div>
      )}

      {cargando ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-white rounded-2xl animate-pulse border border-gray-100" />
          ))}
        </div>
      ) : numeros.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 opacity-50">🔇</div>
          <p className="text-gray-400 text-lg">No hay números silenciados</p>
          <p className="text-gray-300 text-sm mt-1">Agrega el número de tu repartidor para que el bot no le responda</p>
        </div>
      ) : (
        <div className="space-y-3">
          {numeros.map(n => (
            <div key={n.id}
              className="flex items-center justify-between bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100/80">
              <div className="flex items-center gap-4">
                <span className="text-2xl">🔇</span>
                <div>
                  <p className="font-semibold text-gray-800 font-mono">{n.numero}</p>
                  <p className="text-xs text-gray-400">
                    {n.descripcion || 'Sin descripción'} · {new Date(n.creado_en).toLocaleDateString('es-MX')}
                  </p>
                </div>
              </div>
              <button onClick={() => eliminar(n.id)}
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
