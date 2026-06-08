'use client'

import { useState } from 'react'

interface Props {
  prompt: string
  promptActual: string
  cargando: boolean
  guardando: boolean
  hayCambios: boolean
  onChange: (valor: string) => void
  onGuardar: () => void
  mensaje: { tipo: 'exito' | 'error', texto: string } | null
}

export default function PromptEditor({ prompt, promptActual, cargando, guardando, hayCambios, onChange, onGuardar, mensaje }: Props) {
  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-emerald-100/80 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-emerald-400 to-teal-400 rounded-full" />
          <span className="text-sm font-semibold text-gray-700">System Prompt</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 font-mono">{prompt.length} caracteres</span>
        </div>
      </div>

      <div className="p-6">
        {cargando ? (
          <div className="h-72 bg-gradient-to-b from-gray-50 to-gray-100 rounded-xl animate-pulse" />
        ) : (
          <textarea value={prompt} onChange={e => onChange(e.target.value)}
            rows={18}
            className="w-full border border-gray-200 rounded-xl px-5 py-4 text-sm font-mono leading-relaxed focus:ring-2 focus:ring-emerald-400 outline-none resize-y bg-emerald-50/10"
            placeholder="Escribe aquí las instrucciones de Flora..." />
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <button onClick={onGuardar} disabled={guardando || !hayCambios || cargando}
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-40 text-white font-medium px-6 py-2.5 rounded-xl transition shadow-md shadow-emerald-200/30">
            {guardando ? 'Guardando...' : '💾 Guardar'}
          </button>
          {hayCambios && !guardando && (
            <span className="text-xs text-amber-700 bg-amber-100 px-3 py-1.5 rounded-full font-medium">
              Sin guardar
            </span>
          )}
        </div>
      </div>

      {mensaje && (
        <div className="px-6 pb-6">
          <div className={`text-sm rounded-xl px-4 py-3 ${
            mensaje.tipo === 'exito'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-rose-50 text-rose-700 border border-rose-200'
          }`}>
            {mensaje.texto}
          </div>
        </div>
      )}
    </div>
  )
}
