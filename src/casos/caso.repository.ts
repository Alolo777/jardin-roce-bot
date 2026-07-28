import { supabaseAdmin } from '../../lib/supabase'
import { Caso, EstadoCaso } from '../models/types'

export async function insertarCaso(caso: Caso): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('casos')
      .insert({
        id: caso.id,
        cliente_id: caso.clienteId,
        telefono: caso.telefono,
        tipo: caso.tipo,
        estado: caso.estado,
        prioridad: caso.prioridad,
        pedido_id: caso.pedidoId ?? null,
        cotizacion_id: caso.cotizacionId ?? null,
        responsable: caso.responsable ?? null,
        creado_en: caso.creadoEn,
        ultima_actividad: caso.ultimaActividad,
        archivado_en: caso.archivadoEn ?? null,
      })
    if (error) console.warn('[caso-repo] Error insertando caso:', error.message)
  } catch (err) {
    console.warn('[caso-repo] Error insertando caso:', err)
  }
}

export async function actualizarCaso(caso: Caso): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('casos')
      .update({
        estado: caso.estado,
        prioridad: caso.prioridad,
        pedido_id: caso.pedidoId ?? null,
        cotizacion_id: caso.cotizacionId ?? null,
        responsable: caso.responsable ?? null,
        ultima_actividad: caso.ultimaActividad,
        archivado_en: caso.archivadoEn ?? null,
      })
      .eq('id', caso.id)
    if (error) console.warn('[caso-repo] Error actualizando caso:', error.message)
  } catch (err) {
    console.warn('[caso-repo] Error actualizando caso:', err)
  }
}

export async function cargarCasosActivos(): Promise<Map<string, Caso>> {
  const mapa = new Map<string, Caso>()
  try {
    const { data, error } = await supabaseAdmin
      .from('casos')
      .select('*')
      .eq('estado', 'ACTIVO')
    if (error) {
      if (error.code !== 'PGRST116') console.warn('[caso-repo] Error cargando casos:', error.message)
      return mapa
    }
    if (!data) return mapa
    for (const row of data) {
      const caso: Caso = {
        id: row.id,
        clienteId: row.cliente_id,
        telefono: row.telefono,
        tipo: row.tipo,
        estado: row.estado,
        prioridad: row.prioridad,
        pedidoId: row.pedido_id ?? undefined,
        cotizacionId: row.cotizacion_id ?? undefined,
        responsable: row.responsable ?? undefined,
        creadoEn: row.creado_en,
        ultimaActividad: row.ultima_actividad,
        archivadoEn: row.archivado_en ?? undefined,
      }
      mapa.set(caso.clienteId, caso)
    }
    console.log(`[caso-repo] Cargados ${mapa.size} casos activos desde Supabase`)
  } catch (err) {
    console.warn('[caso-repo] Error cargando casos:', err)
  }
  return mapa
}
