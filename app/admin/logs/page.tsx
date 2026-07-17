'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface LogRow {
  id?: number
  level: string
  module: string
  message: string
  metadata?: Record<string, unknown>
  created_at?: string
}

const NIVELES = ['error', 'warn', 'info', 'debug']

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [nivel, setNivel] = useState('')
  const [modulo, setModulo] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [auto, setAuto] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [expandido, setExpandido] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const params = new URLSearchParams()
    if (nivel) params.set('level', nivel)
    if (modulo.trim()) params.set('module', modulo.trim())
    if (busqueda.trim()) params.set('search', busqueda.trim())
    params.set('limit', '100')
    try {
      const res = await fetch(`/api/logs?${params.toString()}`)
      const data = await res.json()
      setLogs(Array.isArray(data.logs) ? data.logs : [])
    } catch {
      setLogs([])
    } finally {
      setCargando(false)
    }
  }, [nivel, modulo, busqueda])

  useEffect(() => {
    cargar()
    if (auto) {
      timer.current = setInterval(cargar, 5000)
      return () => {
        if (timer.current) clearInterval(timer.current)
      }
    }
  }, [cargar, auto])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-1 text-gray-800 dark:text-gray-100">Logs del Sistema</h1>
      <p className="text-sm text-gray-500 mb-4">
        Observabilidad en tiempo real. Todos los eventos y errores del bot se registran aquí.
      </p>

      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Nivel</label>
          <select
            className="border border-gray-300 rounded px-2 py-1 text-sm dark:bg-gray-800 dark:text-gray-100"
            value={nivel}
            onChange={(e) => setNivel(e.target.value)}
          >
            <option value="">Todos</option>
            {NIVELES.map((n) => (
              <option key={n} value={n}>{n.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Módulo</label>
          <input
            className="border border-gray-300 rounded px-2 py-1 text-sm dark:bg-gray-800 dark:text-gray-100"
            placeholder="ej. bot, ai, event"
            value={modulo}
            onChange={(e) => setModulo(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input
            className="border border-gray-300 rounded px-2 py-1 text-sm w-56 dark:bg-gray-800 dark:text-gray-100"
            placeholder="texto en el mensaje"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <button
          className="bg-gray-700 text-white rounded px-3 py-1 text-sm"
          onClick={cargar}
          disabled={cargando}
        >
          {cargando ? 'Cargando…' : 'Refrescar'}
        </button>
        <label className="flex items-center gap-1 text-sm text-gray-600 ml-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto (5s)
        </label>
        <span className="text-xs text-gray-400 ml-auto">{logs.length} registros</span>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="text-left p-2">Hora</th>
              <th className="text-left p-2">Nivel</th>
              <th className="text-left p-2">Módulo</th>
              <th className="text-left p-2">Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-gray-400">Sin registros</td>
              </tr>
            )}
            {logs.map((l, i) => (
              <>
                <tr
                  key={l.id ?? i}
                  className="border-t border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setExpandido(expandido === i ? null : i)}
                >
                  <td className="p-2 whitespace-nowrap text-gray-500">
                    {l.created_at ? new Date(l.created_at).toLocaleString('es-MX') : '—'}
                  </td>
                  <td className="p-2">
                    <span
                      className={
                        'px-2 py-0.5 rounded text-xs font-semibold ' +
                        (l.level === 'error'
                          ? 'bg-red-100 text-red-700'
                          : l.level === 'warn'
                          ? 'bg-yellow-100 text-yellow-700'
                          : l.level === 'debug'
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-blue-100 text-blue-700')
                      }
                    >
                      {l.level.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-2 text-gray-600 dark:text-gray-300">{l.module}</td>
                  <td className="p-2 text-gray-800 dark:text-gray-100">{l.message}</td>
                </tr>
                {expandido === i && l.metadata && (
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <td colSpan={4} className="p-3">
                      <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {JSON.stringify(l.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
