// src/whatsapp/media-inbox.service.ts — Persistencia de medios ENTRANTES
//
// Guarda fotos, notas de voz y archivos que envían los clientes en el bucket
// privado `whatsapp-media` y deja una fila en el historial con marcador
// legible ([Foto], [Nota de voz · 0:42]...) + columnas media_* para que el
// dashboard los muestre al instante.
//
// Es independiente del flujo de IA (agrupamiento/clasificación): ese flujo
// sigue intacto con sus buffers en memoria. Fire-and-forget con logs.

import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { supabaseAdmin } from '../../lib/supabase'
import { agregarAlHistorial } from '../conversation/conversation.service'
import { OrigenMensaje } from '../models/types'
import {
  MEDIA_BUCKET,
  MAX_BYTES_BOT,
  extensionPara,
  marcadorMedia,
  rutaMedia,
  tipoDesdeMime,
  type TipoMediaChat,
} from '../../lib/chat-media'
import { getContenidoMensaje } from './message-utils'
import { comprimirImagen } from '../../lib/comprimir-imagen'

export interface MediaDescargado {
  buffer: Buffer
  mimetype: string
  tipo: TipoMediaChat
  nombre?: string
  duracionSeg?: number
}

// Descarga imagen/documento/audio de un mensaje entrante con su mimetype.
export async function descargarMediaConMime(msg: any): Promise<MediaDescargado | null> {
  try {
    const full = getContenidoMensaje(msg)
    if (!full) return null
    let contenido: any = null
    let familia: 'image' | 'document' | 'audio' | null = null
    if (full.imageMessage) {
      contenido = full.imageMessage
      familia = 'image'
    } else if (full.documentMessage) {
      contenido = full.documentMessage
      familia = 'document'
    } else if (full.audioMessage) {
      contenido = full.audioMessage
      familia = 'audio'
    }
    if (!contenido || !familia) return null

    const stream = await downloadContentFromMessage(contenido, familia as any)
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of stream as any) {
      const buf = chunk as Uint8Array
      total += buf.length
      if (total > MAX_BYTES_BOT) {
        console.warn('[media-inbox] Archivo excede 12MB, se omite persistencia')
        return null
      }
      chunks.push(buf)
    }
    const buffer = Buffer.concat(chunks)
    if (buffer.length === 0) return null

    const mimetype =
      String(contenido.mimetype || (familia === 'image' ? 'image/jpeg' : familia === 'audio' ? 'audio/ogg' : 'application/octet-stream'))
    const tipo = tipoDesdeMime(mimetype) ?? (familia === 'audio' ? 'audio' : familia === 'image' ? 'imagen' : 'documento')
    const nombre =
      familia === 'document' ? String(contenido.fileName || 'archivo') : undefined
    const duracionSeg =
      familia === 'audio' && Number.isFinite(Number(contenido.seconds))
        ? Number(contenido.seconds)
        : undefined
    return { buffer, mimetype, tipo, nombre, duracionSeg }
  } catch (err) {
    console.warn('[media-inbox] Error descargando:', err instanceof Error ? err.message : err)
    return null
  }
}

// promise.race con timeout: downloadContentFromMessage puede colgarse y
// dejar el mensaje atorado sin logs. Devuelve null al vencer.
export async function conTimeout<T>(promesa: Promise<T>, ms: number, etiqueta: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promesa,
      new Promise<null>((_, rechazar) => {
        timer = setTimeout(() => rechazar(new Error(`timeout ${ms}ms`)), ms)
        timer.unref?.()
      }),
    ])
  } catch (err) {
    console.warn(`[media-inbox] ⏱️ ${etiqueta}:`, err instanceof Error ? err.message : err)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const TIMEOUT_DESCARGA_MS = 25_000

export interface Persistido {
  url: string // path dentro del bucket (sin dominio)
  marcador: string
  tipo: TipoMediaChat
  mimetype: string
}

// Sube el medio a Storage y registra el marcador en el historial.
// telefonoCanon: formato +teléfono (o el valor ya resuelto de la fila).
export async function persistirMediaEntrante(
  telefonoCanon: string,
  media: MediaDescargado,
  caption?: string
): Promise<Persistido | null> {
  // Comprimir fotos para cuidar el almacenamiento (audios/docs pasan tal cual).
  let buffer = media.buffer
  let mimetype = media.mimetype
  let ext = extensionPara(media.mimetype)
  if (media.tipo === 'imagen') {
    try {
      const comprimida = await comprimirImagen(media.buffer, media.mimetype)
      if (comprimida) {
        console.log(
          `[media-inbox] 🗜️ Foto ${Math.round(media.buffer.length / 1024)}KB → ${Math.round(comprimida.buffer.length / 1024)}KB`
        )
        buffer = comprimida.buffer
        mimetype = comprimida.mimetype
        ext = 'jpg'
      }
    } catch { /* se sube la original */ }
  }

  const cap = String(caption ?? '').trim().slice(0, 200)
  const marcador = cap || marcadorMedia(media.tipo, media.nombre, media.duracionSeg)

  // Si el upload falla (ej. bucket aún no creado), se guarda el marcador de
  // texto para no perder el mensaje en la bandeja.
  try {
    const digitos = String(telefonoCanon ?? '').replace(/\D/g, '')
    const path = rutaMedia(digitos, randomUUID(), ext)
    const { error: upError } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .upload(path, buffer, {
        contentType: mimetype.split(';')[0].trim() || 'application/octet-stream',
        upsert: false,
      })
    if (upError) throw upError

    await agregarAlHistorial(telefonoCanon, 'user', marcador, OrigenMensaje.CLIENTE, {
      mediaTipo: media.tipo,
      mediaUrl: path,
    })
    console.log(`[media-inbox] ✅ ${media.tipo} guardado: ${path}`)
    return { url: path, marcador, tipo: media.tipo, mimetype }
  } catch (err) {
    console.error('[media-inbox] Error subiendo (se guarda solo marcador):', err instanceof Error ? err.message : err)
    try {
      await agregarAlHistorial(telefonoCanon, 'user', marcador, OrigenMensaje.CLIENTE)
    } catch { /* último recurso: no fatal */ }
    return { url: '', marcador, tipo: media.tipo, mimetype }
  }
}
