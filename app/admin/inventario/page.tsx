'use client'

import { useState, useEffect, useRef } from 'react'
import type { ArregloDiario } from '@/lib/types'
import Image from 'next/image'

const ESTADOS = {
  disponible: { label: 'Disponible', color: 'bg-green-100 text-green-700' },
  apartado: { label: 'Apartado', color: 'bg-yellow-100 text-yellow-700' },
  vendido: { label: 'Vendido', color: 'bg-red-100 text-red-700' },
} as const

export default function InventarioPage() {
  const [arreglos, setArreglos] = useState<ArregloDiario[]>([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  // Form state
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
    } catch (err) {
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
    if (!foto) {
      setError('Debes seleccionar una foto')
      return
    }

    setSubiendo(true)
    try {
      const formData = new FormData()
      formData.append('nombre', nombre)
      formData.append('descripcion', descripcion)
      formData.append('precio', precio)
      formData.append('foto', foto)

      const res = await fetch('/api/inventario', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setExito('¡Arreglo subido correctamente! 🌸')
      setNombre('')
      setDescripcion('')
      setPrecio('')
      setFotoPreview(null)
      if (fotoRef.current) fotoRef.current.value = ''
      await cargarArreglos()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al subir'
      setError(msg)
    } finally {
      setSubiendo(false)
    }
  }

  async function cambiarEstado(id: string, estado: ArregloDiario['estado']) {
    try {
      const res = await fetch(`/api/inventario/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      })
      if (!res.ok) throw new Error()
      setArreglos(prev =>
        prev.map(a => a.id === id ? { ...a, estado } : a)
      )
    } catch {
      setError('No se pudo cambiar el estado')
    }
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este arreglo?')) return
    try {
      await fetch(`/api/inventario/${id}`, { method: 'DELETE' })
      setArreglos(prev => prev.filter(a => a.id !== id))
    } catch {
      setError('No se pudo eliminar')
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-800">📦 Inventario del Día</h1>

      {/* Formulario de subida */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">Subir Nuevo Arreglo</h2>
        <form onSubmit={handleSubir} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Nombre *</label>
            <input
              type="text"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-400 outline-none"
              placeholder="Ej: Bouquet de rosas rojas"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Precio (MXN) *</label>
            <input
              type="number"
              value={precio}
              onChange={e => setPrecio(e.target.value)}
              min="1"
              step="0.01"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-400 outline-none"
              placeholder="350.00"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-600 mb-1">Descripción</label>
            <textarea
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-400 outline-none resize-none"
              rows={2}
              placeholder="Descripción del arreglo para el cliente..."
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-600 mb-1">Foto *</label>
            <div className="flex items-start gap-4">
              <input
                ref={fotoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFotoChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100"
                required
              />
              {fotoPreview && (
                <Image
                  src={fotoPreview}
                  alt="Preview"
                  width={80}
                  height={80}
                  className="rounded-lg object-cover flex-shrink-0"
                />
              )}
            </div>
          </div>

          {error && (
            <div className="md:col-span-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {exito && (
            <div className="md:col-span-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
              {exito}
            </div>
          )}

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={subiendo}
              className="bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition"
            >
              {subiendo ? 'Subiendo...' : '📸 Subir Arreglo'}
            </button>
          </div>
        </form>
      </div>

      {/* Lista de arreglos */}
      {cargando ? (
        <div className="text-center py-12 text-gray-400">Cargando inventario...</div>
      ) : arreglos.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No hay arreglos subidos hoy. ¡Sube el primero! 🌷
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {arreglos.map(arreglo => (
            <div
              key={arreglo.id}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div className="relative h-48">
                <Image
                  src={arreglo.foto_url}
                  alt={arreglo.nombre}
                  fill
                  className="object-cover"
                />
                <span className={`absolute top-2 right-2 text-xs font-medium px-2.5 py-1 rounded-full ${ESTADOS[arreglo.estado].color}`}>
                  {ESTADOS[arreglo.estado].label}
                </span>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{arreglo.nombre}</h3>
                  {arreglo.descripcion && (
                    <p className="text-sm text-gray-500 mt-0.5">{arreglo.descripcion}</p>
                  )}
                  <p className="text-rose-600 font-bold mt-1">
                    ${arreglo.precio.toFixed(2)} MXN
                  </p>
                </div>

                {/* Selector de estado */}
                <select
                  value={arreglo.estado}
                  onChange={e => cambiarEstado(arreglo.id, e.target.value as ArregloDiario['estado'])}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-rose-400 outline-none"
                >
                  <option value="disponible">✅ Disponible</option>
                  <option value="apartado">⏳ Apartado</option>
                  <option value="vendido">❌ Vendido</option>
                </select>

                <button
                  onClick={() => eliminar(arreglo.id)}
                  className="w-full text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg py-1.5 transition"
                >
                  🗑️ Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}