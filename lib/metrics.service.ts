// lib/metrics.service.ts
// Store de métricas en memoria del proceso. El bot persiste un snapshot en Supabase
// (clave bot_metrics) para que el dashboard en Vercel pueda leerlo.

export interface MetricsSnapshot {
  uptimeSegundos: number
  ultimaActualizacion: string
  ai: {
    totalLlamadas: number
    totalErrores: number
    latenciaPromedioMs: number
    latenciaP95Ms: number
    latenciaUltimasMuestras: number[]
  }
  supabase: {
    totalErrores: number
    ultimoError?: string
    ultimoErrorEn?: string
  }
  eventos: {
    total: number
    porTipo: Record<string, number>
    tasaPorMinuto: number
  }
}

interface EventSample {
  tipo: string
  ts: number
}

const aiLatenciaMuestras: number[] = []
let aiTotalLlamadas = 0
let aiTotalErrores = 0
let supabaseTotalErrores = 0
let supabaseUltimoError: string | undefined
let supabaseUltimoErrorEn: string | undefined
let eventosTotal = 0
const eventosPorTipo: Record<string, number> = {}
const eventosVentana: EventSample[] = []

const VENTANA_EVENTOS_MS = 60_000
const MAX_MUESTRAS = 200

export const metrics = {
  recordAiLatency(ms: number): void {
    aiTotalLlamadas++
    aiLatenciaMuestras.push(ms)
    if (aiLatenciaMuestras.length > MAX_MUESTRAS) aiLatenciaMuestras.shift()
  },
  recordAiError(): void {
    aiTotalErrores++
  },
  recordSupabaseError(mensaje: string, modulo?: string): void {
    supabaseTotalErrores++
    supabaseUltimoError = String(mensaje).slice(0, 200)
    supabaseUltimoErrorEn = modulo
  },
  recordEvent(tipo: string): void {
    eventosTotal++
    eventosPorTipo[tipo] = (eventosPorTipo[tipo] ?? 0) + 1
    eventosVentana.push({ tipo, ts: Date.now() })
    const corte = Date.now() - VENTANA_EVENTOS_MS
    while (eventosVentana.length && eventosVentana[0].ts < corte) eventosVentana.shift()
  },
  getSnapshot(): MetricsSnapshot {
    const muestras = [...aiLatenciaMuestras].sort((a, b) => a - b)
    const promedio = muestras.length
      ? Math.round(muestras.reduce((s, v) => s + v, 0) / muestras.length)
      : 0
    const p95 = muestras.length
      ? muestras[Math.min(muestras.length - 1, Math.floor(muestras.length * 0.95))]
      : 0
    return {
      uptimeSegundos: Math.round(process.uptime()),
      ultimaActualizacion: new Date().toISOString(),
      ai: {
        totalLlamadas: aiTotalLlamadas,
        totalErrores: aiTotalErrores,
        latenciaPromedioMs: promedio,
        latenciaP95Ms: p95,
        latenciaUltimasMuestras: muestras.slice(-20),
      },
      supabase: {
        totalErrores: supabaseTotalErrores,
        ultimoError: supabaseUltimoError,
        ultimoErrorEn: supabaseUltimoErrorEn,
      },
      eventos: {
        total: eventosTotal,
        porTipo: { ...eventosPorTipo },
        tasaPorMinuto: eventosVentana.length,
      },
    }
  },
}
