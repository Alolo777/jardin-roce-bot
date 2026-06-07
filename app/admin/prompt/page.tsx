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
    } finally { setCargando(false) }
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
      setMensaje({ tipo: 'exito', texto: 'Prompt guardado. Flora lo usará en la próxima conversación.' })
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err instanceof Error ? err.message : 'Error al guardar' })
    } finally { setGuardando(false) }
  }

  const hayCambios = prompt !== promptActual

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">🧠 Cerebro de Flora</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Estas son las instrucciones que sigue Flora para atender a tus clientes.
          Los cambios se aplican en tiempo real.
        </p>
      </div>

      {/* Editor card */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-emerald-100/80 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="w-1 h-6 bg-gradient-to-b from-emerald-400 to-teal-400 rounded-full" />
            <span className="text-sm font-semibold text-gray-700">System Prompt</span>
          </div>
          <div className="flex items-center gap-3">
            {actualizadoEn && (
              <span className="text-xs text-gray-400 hidden sm:inline">
                Última edición: {new Date(actualizadoEn).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="text-xs text-gray-400 font-mono">{prompt.length} caracteres</span>
          </div>
        </div>

        {/* Textarea */}
        <div className="p-6">
          {cargando ? (
            <div className="h-72 bg-gradient-to-b from-gray-50 to-gray-100 rounded-xl animate-pulse" />
          ) : (
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              rows={18}
              className="w-full border border-gray-200 rounded-xl px-5 py-4 text-sm font-mono leading-relaxed focus:ring-2 focus:ring-emerald-400 outline-none resize-y bg-emerald-50/10"
              placeholder="Escribe aquí las instrucciones de Flora..." />
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <button onClick={handleGuardar} disabled={guardando || !hayCambios || cargando}
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

        {/* Messages */}
        {mensaje && (
          <div className={`px-6 pb-6 ${mensaje.tipo === 'exito' ? '' : ''}`}>
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

      {/* Token guide */}
      <div className="relative overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/60 rounded-2xl p-6">
        <div className="absolute top-0 right-0 w-24 h-24 bg-amber-200/20 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="relative flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-amber-200/50 rounded-xl flex items-center justify-center">
            <span className="text-lg">💡</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900 mb-1">Token de Venta Cerrada</h3>
            <p className="text-sm text-amber-800/80 mb-3">
              Flora genera automáticamente este token al final del mensaje cuando el cliente confirma el pago.
              No necesitas hacer nada. Si ves que no lo detecta, el bot tiene un fallback que notifica igual.
            </p>
            <div className="bg-white/80 backdrop-blur-sm border border-amber-200/60 rounded-xl px-4 py-3">
              <code className="text-xs font-mono text-amber-900 break-all">
                {'[VENTA_CERRADA: {nombre} | {producto} | ${precio} | {direccion}]'}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* Municipios guide */}
      <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/60 rounded-2xl p-6">
        <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-200/20 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="relative flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 bg-emerald-200/50 rounded-xl flex items-center justify-center">
            <span className="text-lg">🏘️</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-emerald-900 mb-1">Municipios de Envío</h3>
            <p className="text-sm text-emerald-800/80 mb-1">
              Ahora puedes importar todos los municipios de Tlaxcala con códigos postales y precios de envío exactos.
              Ve a la sección <strong>Municipios</strong> en el menú para:
            </p>
            <ul className="text-sm text-emerald-700 list-disc list-inside space-y-0.5">
              <li>Importar tu CSV con columnas: municipio, codigo_postal, zona, precio_envio</li>
              <li>Agregar municipios manualmente uno por uno</li>
              <li>Buscar por municipio, colonia o código postal</li>
            </ul>
            <p className="text-sm text-emerald-800/80 mt-2">
              Cuando un cliente mencione su colonia o municipio, el sistema lo buscará automáticamente y le asignará el precio de envío correcto.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
