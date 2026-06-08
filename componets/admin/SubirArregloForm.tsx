'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'

interface Props {
  onArregloSubido: () => void
}

export default function SubirArregloForm({ onArregloSubido }: Props) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const fotoRef = useRef<HTMLInputElement>(null)

  function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => setFotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e: React.FormEvent) {
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
      setExito('Arreglo subido exitosamente')
      setNombre(''); setDescripcion(''); setPrecio('')
      setFotoPreview(null)
      if (fotoRef.current) fotoRef.current.value = ''
      onArregloSubido()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir')
    } finally { setSubiendo(false) }
  }

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-rose-100/80 p-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="w-1 h-6 bg-gradient-to-b from-rose-400 to-pink-400 rounded-full" />
        <h2 className="text-lg font-semibold text-gray-800">Subir nuevo arreglo</h2>
      </div>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
  )
}
