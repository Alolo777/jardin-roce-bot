'use client'

import { useState, useEffect } from 'react'

export default function PromptPage() {
  const [prompt, setPrompt] = useState('')
  const [promptActual, setPromptActual] = useState('')
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error', texto: string } | null>(null)

  async function cargarPrompt() {
    try {
      const res = await fetch('/api/prompt')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPrompt(data.prompt)
      setPromptActual(data.prompt)
      setActualizadoEn(data.actualizado_en)
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudo cargar el prompt' })
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarPrompt() }, [])

  async function handleGuardar() {
    setGuardando(true)
    setMensaje(null)
    try {
      const res = await fetch('/api/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPromptActual(prompt)
      setActualizadoEn(data.actualizado_en)
      setMensaje({ tipo: 'exito', texto: '✅ Prompt actualizado. El bot lo usará en la próxima consulta.' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar'
      setMensaje({ tipo: 'error', texto: msg })
    } finally {
      setGuardando(false)
    }
  }

  const hayCambios = prompt !== promptActual

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">🤖 Prompt del Agente IA</h1>
        <p className="text-gray-500 text-sm mt-1">
          Edita las instrucciones y reglas de negocio que sigue el agente Flora.
          Los cambios aplican en tiempo real sin reiniciar el bot.
        </p>
      </div>

      {actualizadoEn && (
        <p className="text-xs text-gray-400">
          Última actualización: {new Date(actualizadoEn).toLocaleString('es-MX')}
        </p>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-700">System Prompt</label>
          <span className="text-xs text-gray-400">{prompt.length} caracteres</span>
        </div>

        {cargando ? (
          <div className="h-64 bg-gray-50 rounded-lg animate-pulse" />
        ) : (
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={16}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-rose-400 outline-none resize-y"
            placeholder="Escribe aquí las instrucciones del agente..."
          />
        )}

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={handleGuardar}
            disabled={guardando || !hayCambios || cargando}
            className="bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white font-medium px-6 py-2.5 rounded-lg transition"
          >
            {guardando ? 'Guardando...' : '💾 Guardar Cambios'}
          </button>

          {hayCambios && !guardando && (
            <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full">
              ⚠️ Hay cambios sin guardar
            </span>
          )}
        </div>

        {mensaje && (
          <div className={`mt-4 text-sm rounded-lg px-4 py-3 ${
            mensaje.tipo === 'exito'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-600'
          }`}>
            {mensaje.texto}
          </div>
        )}
      </div>

      {/* Guía de tokens */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <h3 className="font-semibold text-amber-800 mb-2">💡 Token de Venta Cerrada</h3>
        <p className="text-sm text-amber-700">
          Para que el bot te notifique por Telegram cuando se cierre una venta,
          incluye en el prompt la instrucción de usar este token exacto al final del mensaje:
        </p>
        <code className="block mt-2 bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs font-mono text-amber-900">
          {'[VENTA_CERRADA: {nombre_cliente} | {producto} | ${precio} | {direccion}]'}
        </code>
      </div>
    </div>
  )
}