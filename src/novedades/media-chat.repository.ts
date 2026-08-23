// src/novedades/media-chat.repository.ts
// Persistencia ligera de las últimas imágenes/documentos que envía un cliente
// (máx 2 por chat) para adjuntarlas al seguimiento del administrador (DEC-085).

import { supabaseAdmin } from '../../lib/supabase'
import { variantesTelefono } from '../conversation/conversation.service'

const MAX_POR_CHAT = 2

export interface MediaChatEntrada {
  base64: string
  mimetype?: string
  caption?: string
}

// Guarda las imágenes de un turno y poda el historial del chat a las últimas 2.
export async function guardarMediaChat(
  clienteId: string,
  telefono: string,
  medias: MediaChatEntrada[]
): Promise<void> {
  const utiles = medias.filter(m => m.base64)
  for (const m of utiles) {
    const tipo = (m.mimetype ?? '').startsWith('image/') ? 'imagen' : 'documento'
    const { error } = await supabaseAdmin.from('media_chat').insert({
      cliente_id: clienteId,
      telefono: telefono || null,
      origen: 'cliente',
      tipo,
      mimetype: m.mimetype ?? null,
      caption: m.caption ?? null,
      base64: m.base64,
    })
    if (error) {
      console.warn('[media-chat] Error guardando media:', error.message)
      continue
    }
    await podarPorTelefono(telefono)
  }
}

async function podarPorTelefono(telefono: string): Promise<void> {
  try {
    if (!telefono) return
    const { data: ultimas } = await supabaseAdmin
      .from('media_chat')
      .select('id')
      .eq('telefono', telefono)
      .order('creado_en', { ascending: false })
      .limit(MAX_POR_CHAT)
    const ids = (ultimas ?? []).map(r => r.id as string)
    if (ids.length < MAX_POR_CHAT) return
    await supabaseAdmin
      .from('media_chat')
      .delete()
      .eq('telefono', telefono)
      .not('id', 'in', `(${ids.join(',')})`)
  } catch (err) {
    console.warn('[media-chat] Error podando:', err)
  }
}

export interface MediaChatImagen {
  base64: string
  mimetype?: string
  caption?: string
}

// Devuelve hasta `limite` imágenes recientes cuyo teléfono coincida con alguna
// de las variantes dadas (tolera 52/521 y formatos con/ sin +).
export async function obtenerImagenesPorTelefono(telefonos: string[], limite = MAX_POR_CHAT): Promise<MediaChatImagen[]> {
  const variantes = new Set<string>()
  for (const t of telefonos) {
    for (const v of variantesTelefono(t)) variantes.add(v)
  }
  if (variantes.size === 0) return []
  try {
    const { data, error } = await supabaseAdmin
      .from('media_chat')
      .select('base64, mimetype, caption')
      .in('telefono', [...variantes])
      .order('creado_en', { ascending: false })
      .limit(limite)
    if (error) throw error
    return (data ?? [])
      .filter((r: any) => !!r.base64)
      .map((r: any) => ({ base64: r.base64 as string, mimetype: r.mimetype ?? undefined, caption: r.caption ?? undefined }))
  } catch (err) {
    console.warn('[media-chat] Error leyendo imágenes:', err)
    return []
  }
}
