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

export function limpiarCachesEstado(): void {
  FRUSTRACION_NOTIFICADA.clear()
  RATE_TIMESTAMPS.clear()
}
