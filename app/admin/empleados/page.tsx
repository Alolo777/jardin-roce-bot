'use client'

import { useState, useEffect } from 'react'

export default function EmpleadosPage() {
  const [numeros, setNumeros] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [nuevoNumero, setNuevoNumero] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  async function cargar() {
    try {
      const res = await fetch('/api/empleados')
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

  async function agregar() {
    const limpio = nuevoNumero.trim()
    if (!limpio) return
    setError(null)
    setExito(null)
    setGuardando(true)
    try {
      const actualizados = [...numeros, limpio]
      const res = await fetch('/api/empleados', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeros: actualizados }),
      })
      if (!res.ok) throw new Error()
      setNumeros(actualizados)
      setNuevoNumero('')
      setExito('Número agregado')
    } catch {
      setError('No se pudo guardar')
    } finally { setGuardando(false) }
  }

  async function eliminar(idx: number) {
    setError(null)
    setExito(null)
    const actualizados = numeros.filter((_, i) => i !== idx)
    try {
      const res = await fetch('/api/empleados', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeros: actualizados }),
      })
      if (!res.ok) throw new Error()
      setNumeros(actualizados)
      setExito('Número eliminado')
    } catch {
      setError('No se pudo eliminar')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">👥 Empleados a Notificar</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cuando un cliente pida fotos o cotización de envío, estos números recibirán un aviso por WhatsApp.
        </p>
      </div>

      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-rose-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Agregar número</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="text" value={nuevoNumero} onChange={e => setNuevoNumero(e.target.value)}
            placeholder="521234567890@c.us"
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
          Formato: código de país + número + @c.us (ej. 521234567890@c.us)
        </p>
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{error}</div>}
      {exito && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">{exito}</div>}

      {cargando ? (
        <div className="animate-pulse bg-white/80 rounded-2xl h-32" />
      ) : numeros.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 opacity-50">👤</div>
          <p className="text-gray-400 text-lg">No hay empleados registrados</p>
          <p className="text-gray-300 text-sm mt-1">Agrega el primer número para recibir notificaciones</p>
        </div>
      ) : (
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100/80 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Números registrados ({numeros.length})</h2>
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
