import { normalizarTexto } from '../conversation/index'
import { parsePrecio } from '../parser/precio.parser'

export const FRUSTRACION_NOTIFICADA = new Map<string, number>()
export const ATENCION_HUMANA_NOTIFICADA = new Map<string, number>()
export const INTERES_COMPRA_NOTIFICADO = new Map<string, number>()
export const RECLAMACION_NOTIFICADA = new Map<string, number>()
export const ENVIO_NOTIFICADO = new Map<string, number>()
export const FOTOS_NOTIFICADO = new Map<string, number>()
export const FOTOS_DISPONIBLES_RECIENTES = new Map<string, number>()
export const ALERTAS_DEDUP = new Map<string, number>()
export const ULTIMA_INTERVENCION_HUMANA = new Map<string, { ts: number; texto: string; precio?: number }>()
export const RATE_TIMESTAMPS = new Map<string, number[]>()

export const FOTOS_DISPONIBLES_TTL_MS = 2 * 60 * 60_000
export const INTERVENCION_HUMANA_TTL_MS = 10 * 60_000

export const RATE_LIMIT_MAX = 8
export const RATE_LIMIT_WINDOW_MS = 30_000
export const RATE_AVISADOS = new Set<string>()

export function estaRateLimited(id: string): boolean {
  const ahora = Date.now()
  const recientes = (RATE_TIMESTAMPS.get(id) ?? []).filter(t => ahora - t < RATE_LIMIT_WINDOW_MS)
  recientes.push(ahora)
  if (recientes.length === 0) {
    RATE_TIMESTAMPS.delete(id)
  } else {
    RATE_TIMESTAMPS.set(id, recientes)
  }
  return recientes.length > RATE_LIMIT_MAX
}

export function limpiarCachesEstado(): void {
  FRUSTRACION_NOTIFICADA.clear()
  RATE_TIMESTAMPS.clear()
}

export function debeNotificarAtencionHumana(clienteId: string): boolean {
  const ahora = Date.now()
  const ultima = ATENCION_HUMANA_NOTIFICADA.get(clienteId) ?? 0
  if (ahora - ultima < 20 * 60_000) return false
  ATENCION_HUMANA_NOTIFICADA.set(clienteId, ahora)
  return true
}

export function debeNotificarReclamacion(clienteId: string, tipo: 'cancelacion' | 'queja'): boolean {
  const ahora = Date.now()
  const key = `${tipo}:${clienteId}`
  const ultima = RECLAMACION_NOTIFICADA.get(key) ?? 0
  if (ahora - ultima < 20 * 60_000) return false
  RECLAMACION_NOTIFICADA.set(key, ahora)
  return true
}

export function debeEnviarAlertaDedup(clienteId: string, tipo: string, detalle: string, ttlMs: number): boolean {
  const ahora = Date.now()
  const huella = normalizarTexto(detalle).slice(0, 120)
  const key = `${tipo}:${clienteId}:${huella}`
  const ultima = ALERTAS_DEDUP.get(key) ?? 0
  if (ahora - ultima < ttlMs) return false
  ALERTAS_DEDUP.set(key, ahora)
  if (ALERTAS_DEDUP.size > 500) {
    for (const [k, ts] of ALERTAS_DEDUP) {
      if (ahora - ts > 24 * 60 * 60_000) ALERTAS_DEDUP.delete(k)
    }
  }
  return true
}

export function extraerPrecioRespuesta(texto: string): number | null {
  return parsePrecio(texto)
}

export function registrarIntervencionHumana(clienteId: string, texto: string): void {
  const precio = extraerPrecioRespuesta(texto)
  ULTIMA_INTERVENCION_HUMANA.set(clienteId, { ts: Date.now(), texto: texto.trim().slice(0, 500), precio: precio ?? undefined })
}

export function obtenerIntervencionHumanaReciente(clienteId: string): { texto: string; precio?: number; haceMs: number } | null {
  const dato = ULTIMA_INTERVENCION_HUMANA.get(clienteId)
  if (!dato) return null
  const haceMs = Date.now() - dato.ts
  if (haceMs > INTERVENCION_HUMANA_TTL_MS) {
    ULTIMA_INTERVENCION_HUMANA.delete(clienteId)
    return null
  }
  return { texto: dato.texto, precio: dato.precio, haceMs }
}
