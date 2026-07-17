'use client'

import { useCallback, useEffect, useState } from 'react'

interface AiMetrics {
  totalLlamadas: number
  totalErrores: number
  latenciaPromedioMs: number
  latenciaP95Ms: number
  latenciaUltimasMuestras: number[]
}
interface SupabaseMetrics {
  totalErrores: number
  ultimoError?: string
  ultimoErrorEn?: string
}
interface EventosMetrics {
  total: number
  porTipo: Record<string, number>
  tasaPorMinuto: number
}
interface Snapshot {
  uptimeSegundos: number
  ultimaActualizacion: string
  ai: AiMetrics
  supabase: SupabaseMetrics
  eventos: EventosMetrics
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${tone ?? 'text-gray-800 dark:text-gray-100'}`}>{value}</div>
    </div>
  )
}

export default function HealthPage() {
  const [data, setData] = useState<{ ok: boolean; salud?: string; metrics?: Snapshot; mensaje?: string } | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      const json = await res.json()
      setData(json)
    } catch {
      setData({ ok: false, mensaje: 'Error al consultar health' })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 10_000)
    return () => clearInterval(t)
  }, [cargar])

  const m = data?.metrics
  const tasaErrorIA = m ? ((m.ai.totalErrores / Math.max(1, m.ai.totalLlamadas)) * 100).toFixed(1) : '0'

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Salud del Sistema</h1>
        <span
          className={
            'px-3 py-1 rounded-full text-sm font-semibold ' +
            (data?.salud === 'saludable'
              ? 'bg-emerald-100 text-emerald-700'
              : data?.salud === 'degradado'
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-gray-100 text-gray-500')
          }
        >
          {data?.salud ?? (cargando ? 'cargando…' : 'desconocido')}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Métricas en vivo del bot. Se actualiza cada 10s.
      </p>

      {!m && (
        <div className="text-gray-400 p-4 border border-dashed rounded-lg">
          {data?.mensaje ?? 'Sin métricas disponibles aún.'}
        </div>
      )}

      {m && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Latencia IA prom" value={`${m.ai.latenciaPromedioMs} ms`} />
            <Stat label="Latencia IA p95" value={`${m.ai.latenciaP95Ms} ms`} />
            <Stat
              label="Tasa error IA"
              value={`${tasaErrorIA}%`}
              tone={Number(tasaErrorIA) > 20 ? 'text-red-600' : 'text-emerald-600'}
            />
            <Stat label="Llamadas IA" value={`${m.ai.totalLlamadas}`} />
            <Stat
              label="Errores Supabase"
              value={`${m.supabase.totalErrores}`}
              tone={m.supabase.totalErrores > 0 ? 'text-yellow-600' : 'text-emerald-600'}
            />
            <Stat label="Eventos total" value={`${m.eventos.total}`} />
            <Stat label="Eventos/min" value={`${m.eventos.tasaPorMinuto}`} />
            <Stat label="Uptime" value={`${Math.round(m.uptimeSegundos / 60)} min`} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Latencia IA (últimas muestras)</h2>
              <div className="flex items-end gap-1 h-24 overflow-x-auto">
                {m.ai.latenciaUltimasMuestras.length === 0 && (
                  <span className="text-gray-400 text-sm">Sin muestras</span>
                )}
                {m.ai.latenciaUltimasMuestras.map((ms, i) => (
                  <div
                    key={i}
                    title={`${ms} ms`}
                    className="bg-rose-400 rounded-t"
                    style={{ height: `${Math.min(100, (ms / Math.max(1, m.ai.latenciaP95Ms)) * 100)}%`, minWidth: 6 }}
                  />
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h2 className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Eventos por tipo</h2>
              <div className="max-h-40 overflow-y-auto text-sm">
                {Object.keys(m.eventos.porTipo).length === 0 && (
                  <span className="text-gray-400">Sin eventos</span>
                )}
                {Object.entries(m.eventos.porTipo)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tipo, count]) => (
                    <div key={tipo} className="flex justify-between py-0.5 border-b border-gray-100 dark:border-gray-700">
                      <span className="text-gray-600 dark:text-gray-300">{tipo}</span>
                      <span className="font-mono text-gray-800 dark:text-gray-100">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {m.supabase.ultimoError && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              <strong>Último error Supabase:</strong> {m.supabase.ultimoError}
              {m.supabase.ultimoErrorEn && <> <em>({m.supabase.ultimoErrorEn})</em></>}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4">
            Última actualización: {new Date(m.ultimaActualizacion).toLocaleString('es-MX')}
          </p>
        </>
      )}
    </div>
  )
}
