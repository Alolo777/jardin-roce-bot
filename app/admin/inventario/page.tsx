'use client'

import { useState, useEffect, useRef } from 'react'
import type { ArregloDiario } from '@/lib/types'
import Image from 'next/image'

const ESTADOS = {
  disponible: { label: 'Disponible', color: 'bg-emerald-100 text-emerald-700 ring-emerald-300' },
  apartado:   { label: 'Apartado',   color: 'bg-amber-100 text-amber-700 ring-amber-300' },
  vendido:    { label: 'Vendido',    color: 'bg-rose-100 text-rose-700 ring-rose-300' },
} as const

export default function InventarioPage() {
  const [arreglos, setArreglos] = useState<ArregloDiario[]>([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const fotoRef = useRef<HTMLInputElement>(null)

  async function cargarArreglos() {
    try {
      const res = await fetch('/api/inventario')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setArreglos(data.arreglos)
    } catch {
      setError('No se pudo cargar el inventario')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarArreglos() }, [])

  function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => setFotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSubir(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setExito(null)
    const foto = fotoRef.current?.files?.[0]
    if (!foto) { setError('Debes seleccionar una foto'); return }
    setSubiendo(true)
    try {
      const formData = new FormData()
      formData.append('nombre', nombre)
      formData.append('descripcion', descripcion)
      formData.append('precio', precio)
      formData.append('foto', foto)
      const res = await fetch('/api/inventario', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setExito('Arreglo subido')
      setNombre(''); setDescripcion(''); setPrecio('')
      setFotoPreview(null)
      if (fotoRef.current) fotoRef.current.value = ''
      await cargarArreglos()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir')
    } finally { setSubiendo(false) }
  }

  async function cambiarEstado(id: string, estado: ArregloDiario['estado']) {
    try {
      const res = await fetch(`/api/inventario/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      })
      if (!res.ok) throw new Error()
      setArreglos(prev => prev.map(a => a.id === id ? { ...a, estado } : a))
    } catch { setError('No se pudo cambiar el estado') }
  }

  async function eliminar(id: string) {
    if (!confirm('Eliminar este arreglo?')) return
    try {
      await fetch(`/api/inventario/${id}`, { method: 'DELETE' })
      setArreglos(prev => prev.filter(a => a.id !== id))
    } catch { setError('No se pudo eliminar') }
  }

  const disponibles = arreglos.filter(a => a.estado === 'disponible').length
  const apartados = arreglos.filter(a => a.estado === 'apartado').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🌷 Inventario del Día</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {arreglos.length} arreglos · {disponibles} disponibles · {apartados} apartados
          </p>
        </div>
      </div>

      {/* Upload form */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-rose-100/80 p-6">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-6 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
          <h2 className="text-lg font-semibold text-gray-800">Subir nuevo arreglo</h2>
        </div>
        <form onSubmit={handleSubir} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-rose-50/20"
              placeholder="Bouquet de rosas rojas" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Precio (MXN)</label>
            <input type="number" value={precio} onChange={e => setPrecio(e.target.value)}
              min="1" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-rose-50/20"
              placeholder="350.00" required />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-600 mb-1">Descripción</label>
            <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none resize-none bg-rose-50/20"
              rows={2} placeholder="Descripción para el cliente..." />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-600 mb-1">Foto</label>
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <input ref={fotoRef} type="file" accept="image/jpeg,image/png,image/webp"
                  onChange={handleFotoChange} required
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-gradient-to-r file:from-rose-50 file:to-pink-50 file:text-rose-700 hover:file:from-rose-100 hover:file:to-pink-100 file:transition cursor-pointer" />
              </div>
              {fotoPreview && (
                <Image src={fotoPreview} alt="Preview" width={72} height={72}
                  className="rounded-xl object-cover flex-shrink-0 ring-2 ring-rose-200" />
              )}
            </div>
          </div>

          {error && <div className="md:col-span-2 text-sm text-rose-700 bg-rose-50 rounded-xl px-4 py-3">{error}</div>}
          {exito && <div className="md:col-span-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">{exito}</div>}

          <div className="md:col-span-2">
            <button type="submit" disabled={subiendo}
              className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-xl transition shadow-md shadow-rose-200/30">
              {subiendo ? 'Subiendo... 🌱' : '🌷 Subir arreglo'}
            </button>
          </div>
        </form>
      </div>

      {/* Inventory grid */}
      {cargando ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
              <div className="h-48 bg-gray-100" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
                <div className="h-8 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : arreglos.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 opacity-50">🏵️</div>
          <p className="text-gray-400 text-lg">No hay arreglos hoy</p>
          <p className="text-gray-300 text-sm mt-1">Sube el primero para que Flora lo muestre a los clientes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {arreglos.map(arreglo => (
            <div key={arreglo.id}
              className="group bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100/80 overflow-hidden">
              {/* Image */}
              <div className="relative h-48 overflow-hidden">
                <Image src={arreglo.foto_url} alt={arreglo.nombre} fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                <span className={`absolute top-3 right-3 text-xs font-semibold px-3 py-1 rounded-full ring-1 backdrop-blur-sm ${ESTADOS[arreglo.estado].color}`}>
                  {ESTADOS[arreglo.estado].label}
                </span>
                <div className="absolute bottom-3 left-3 right-3">
                  <h3 className="text-white font-bold text-base drop-shadow-sm">{arreglo.nombre}</h3>
                  <p className="text-white/90 text-sm font-semibold drop-shadow-sm">
                    ${arreglo.precio.toFixed(2)} MXN
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="p-4 space-y-3">
                {arreglo.descripcion && (
                  <p className="text-xs text-gray-500 line-clamp-2">{arreglo.descripcion}</p>
                )}

                <select value={arreglo.estado}
                  onChange={e => cambiarEstado(arreglo.id, e.target.value as ArregloDiario['estado'])}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-gray-50/50 cursor-pointer">
                  <option value="disponible">✅ Disponible</option>
                  <option value="apartado">⏳ Apartado</option>
                  <option value="vendido">❌ Vendido</option>
                </select>

                <button onClick={() => eliminar(arreglo.id)}
                  className="w-full text-sm text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl py-2 transition">
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
