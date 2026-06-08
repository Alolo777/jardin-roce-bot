'use client'

import { useState, useEffect } from 'react'
import PromptEditor from '@/componets/admin/PromptEditor'
import type { HistorialPrompt } from '@/lib/types'

function HistorialPromptModal({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const [historial, setHistorial] = useState<HistorialPrompt[]>([])
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    async function cargar() {
      setCargando(true)
      try {
        const res = await fetch('/api/prompt/history')
        const data = await res.json()
        if (res.ok) setHistorial(data.historial)
      } catch { /* ignorar */ }
      finally { setCargando(false) }
    }
    cargar()
  }, [abierto])

  if (!abierto) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-lg">📜</span>
            <h2 className="text-lg font-bold text-gray-800">Historial de Cambios</h2>
          </div>
          <button onClick={onCerrar}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl px-3 py-1.5 transition text-sm">
            ✕ Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {cargando ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-24 bg-gray-50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : historial.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400">No hay cambios registrados todavía</p>
              <p className="text-gray-300 text-sm mt-1">Los cambios se guardan automáticamente al editar el prompt</p>
            </div>
          ) : (
            historial.map(h => (
              <div key={h.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandido(expandido === h.id ? null : h.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm">📝</span>
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Editado por {h.editado_por}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(h.creado_en).toLocaleString('es-MX', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">{expandido === h.id ? '▲' : '▼'}</span>
                </button>

                {expandido === h.id && (
                  <div className="px-4 pb-4 space-y-2 border-t border-gray-50 pt-3">
                    <div>
                      <p className="text-xs font-medium text-rose-500 mb-1">Antes:</p>
                      <pre className="text-xs text-gray-600 bg-rose-50/50 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                        {h.prompt_anterior.slice(0, 500)}{h.prompt_anterior.length > 500 ? '...' : ''}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-emerald-500 mb-1">Después:</p>
                      <pre className="text-xs text-gray-600 bg-emerald-50/50 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                        {h.prompt_nuevo.slice(0, 500)}{h.prompt_nuevo.length > 500 ? '...' : ''}
                      </pre>
                    </div>
                    {h.prompt_anterior.length > 500 && (
                      <p className="text-xs text-gray-400 text-center">(Cambio truncado a 500 caracteres)</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default function PromptPage() {
  const [prompt, setPrompt] = useState('')
  const [promptActual, setPromptActual] = useState('')
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error', texto: string } | null>(null)
  const [historialAbierto, setHistorialAbierto] = useState(false)

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🧠 Cerebro de Flora</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Estas son las instrucciones que sigue Flora para atender a tus clientes.
            Los cambios se aplican en tiempo real.
          </p>
        </div>
        <button onClick={() => setHistorialAbierto(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition shadow-sm">
          <span>📜</span>
          <span className="hidden sm:inline">Historial</span>
        </button>
      </div>

      {/* Prompt Editor */}
      <PromptEditor
        prompt={prompt}
        promptActual={promptActual}
        cargando={cargando}
        guardando={guardando}
        hayCambios={hayCambios}
        onChange={setPrompt}
        onGuardar={handleGuardar}
        mensaje={mensaje}
      />

      {/* Información de última edición */}
      {actualizadoEn && (
        <div className="text-xs text-gray-400 text-right px-2">
          Última edición: {new Date(actualizadoEn).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })}
        </div>
      )}

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
              <li>Exportar tus datos a CSV</li>
            </ul>
            <p className="text-sm text-emerald-800/80 mt-2">
              Cuando un cliente mencione su colonia o municipio, el sistema lo buscará automáticamente y le asignará el precio de envío correcto.
            </p>
          </div>
        </div>
      </div>

      {/* Historial Modal */}
      <HistorialPromptModal abierto={historialAbierto} onCerrar={() => setHistorialAbierto(false)} />
    </div>
  )
}
