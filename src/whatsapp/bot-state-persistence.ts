import { supabaseAdmin } from '../../lib/supabase'
import { FRUSTRACION_NOTIFICADA, ATENCION_HUMANA_NOTIFICADA, INTERES_COMPRA_NOTIFICADO, RECLAMACION_NOTIFICADA, ENVIO_NOTIFICADO, FOTOS_NOTIFICADO, FOTOS_DISPONIBLES_RECIENTES, ALERTAS_DEDUP, ULTIMA_INTERVENCION_HUMANA, RATE_TIMESTAMPS, FOTOS_PENDIENTES_APERTURA, RECORDATORIOS_APARTADO } from './bot-state'

const MAPAS_A_PERSISTIR: { key: string; map: Map<string, any> }[] = [
  { key: 'ULTIMA_INTERVENCION_HUMANA', map: ULTIMA_INTERVENCION_HUMANA },
  { key: 'ALERTAS_DEDUP',              map: ALERTAS_DEDUP },
  { key: 'RATE_TIMESTAMPS',            map: RATE_TIMESTAMPS },
  { key: 'FRUSTRACION_NOTIFICADA',     map: FRUSTRACION_NOTIFICADA },
  { key: 'ATENCION_HUMANA_NOTIFICADA', map: ATENCION_HUMANA_NOTIFICADA },
  { key: 'INTERES_COMPRA_NOTIFICADO',  map: INTERES_COMPRA_NOTIFICADO },
  { key: 'RECLAMACION_NOTIFICADA',     map: RECLAMACION_NOTIFICADA },
  { key: 'ENVIO_NOTIFICADO',           map: ENVIO_NOTIFICADO },
  { key: 'FOTOS_NOTIFICADO',           map: FOTOS_NOTIFICADO },
  { key: 'FOTOS_DISPONIBLES_RECIENTES',map: FOTOS_DISPONIBLES_RECIENTES },
  { key: 'FOTOS_PENDIENTES_APERTURA',  map: FOTOS_PENDIENTES_APERTURA },
  { key: 'RECORDATORIOS_APARTADO',     map: RECORDATORIOS_APARTADO },
]

function mapToRecords(map: Map<string, any>): Record<string, any> {
  return Object.fromEntries(map)
}

function recordsToMap(records: Record<string, any>): Map<string, any> {
  return new Map(Object.entries(records))
}

export async function cargarEstado(): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from('bot_cache')
      .select('key, value')

    if (error) {
      console.error('[bot-cache] Error cargando estado:', error.message)
      return
    }

    if (!data || data.length === 0) return

    const cache = new Map(data.map(r => [r.key, r.value]))

    for (const entry of MAPAS_A_PERSISTIR) {
      const raw = cache.get(entry.key)
      if (!raw) continue
      const restored = recordsToMap(raw)
      entry.map.clear()
      for (const [k, v] of restored) {
        entry.map.set(k, v)
      }
    }

    console.log(`[bot-cache] Estado restaurado: ${data.length} claves`)
  } catch (err) {
    console.error('[bot-cache] Error cargando estado:', err)
  }
}

export async function guardarEstado(): Promise<void> {
  const rows = MAPAS_A_PERSISTIR
    .filter(e => e.map.size > 0)
    .map(e => ({
      key: e.key,
      value: mapToRecords(e.map),
      updated_at: new Date().toISOString(),
    }))

  if (rows.length === 0) return

  try {
    const { error } = await supabaseAdmin
      .from('bot_cache')
      .upsert(rows, { onConflict: 'key' })

    if (error) {
      console.error('[bot-cache] Error guardando estado:', error.message)
    }
  } catch (err) {
    console.error('[bot-cache] Error guardando estado:', err)
  }
}

// Borra del bot_cache las claves cuyos mapas ahora están vacíos.
// Evita que un reinicio restaure datos ya consumidos (ej: FOTOS_PENDIENTES_APERTURA
// que ya fueron reenviadas al equipo) y reenvíe notificaciones duplicadas.
export async function limpiarClavesVacias(): Promise<void> {
  const clavesVacias = MAPAS_A_PERSISTIR.filter(e => e.map.size === 0).map(e => e.key)
  if (clavesVacias.length === 0) return
  try {
    const { error } = await supabaseAdmin
      .from('bot_cache')
      .delete()
      .in('key', clavesVacias)
    if (error) {
      console.error('[bot-cache] Error limpiando claves vacías:', error.message)
    }
  } catch (err) {
    console.error('[bot-cache] Error limpiando claves vacías:', err)
  }
}

let persistenciaInterval: ReturnType<typeof setInterval> | null = null

export function iniciarPersistenciaPeriodica(intervalMs = 5 * 60_000): void {
  if (persistenciaInterval) clearInterval(persistenciaInterval)
  persistenciaInterval = setInterval(() => {
    guardarEstado().catch(() => {})
  }, intervalMs)
  persistenciaInterval.unref()
  console.log(`[bot-cache] Persistencia automática cada ${intervalMs / 1000}s`)
}
