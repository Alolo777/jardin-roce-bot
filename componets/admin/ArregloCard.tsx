'use client'

import Image from 'next/image'
import type { ArregloDiario } from '@/lib/types'

const ESTADOS = {
  disponible: { label: 'Disponible', color: 'bg-emerald-100 text-emerald-700 ring-emerald-300' },
  apartado:   { label: 'Apartado',   color: 'bg-amber-100 text-amber-700 ring-amber-300' },
  vendido:    { label: 'Vendido',    color: 'bg-rose-100 text-rose-700 ring-rose-300' },
} as const

interface Props {
  arreglo: ArregloDiario
  onCambiarEstado: (id: string, estado: ArregloDiario['estado']) => void
  onEliminar: (id: string) => void
}

export default function ArregloCard({ arreglo, onCambiarEstado, onEliminar }: Props) {
  return (
    <div className="group bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100/80 overflow-hidden">
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
      <div className="p-4 space-y-3">
        {arreglo.descripcion && (
          <p className="text-xs text-gray-500 line-clamp-2">{arreglo.descripcion}</p>
        )}
        <select value={arreglo.estado}
          onChange={e => onCambiarEstado(arreglo.id, e.target.value as ArregloDiario['estado'])}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-400 outline-none bg-gray-50/50 cursor-pointer">
          <option value="disponible">✅ Disponible</option>
          <option value="apartado">⏳ Apartado</option>
          <option value="vendido">❌ Vendido</option>
        </select>
        <button onClick={() => onEliminar(arreglo.id)}
          className="w-full text-sm text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl py-2 transition">
          Eliminar
        </button>
      </div>
    </div>
  )
}
