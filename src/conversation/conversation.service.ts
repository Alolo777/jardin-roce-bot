// src/conversation/conversation.service.ts
// Motor de Conversación — Historial, deduplicación y utilidades de mensajes

import { supabaseAdmin } from '../../lib/supabase'
import type { MensajeChat } from '../../lib/ai'

// ════════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════════

export const MAX_TURNOS_HISTORIAL = 30
export const MENSAJE_PROCESADO_TTL_MS = 2 * 60 * 60_000

// ════════════════════════════════════════════════════════════════
// CACHÉS EN MEMORIA
// ════════════════════════════════════════════════════════════════

export const CACHE_CLIENTE_UUID = new Map<string, string>()
export const MENSAJES_PROCESADOS = new Map<string, number>()

// ════════════════════════════════════════════════════════════════
// UTILIDADES DE TELÉFONO
// ════════════════════════════════════════════════════════════════

export function variantesTelefono(numero: string): string[] {
  const limpio = String(numero ?? '').replace(/\D/g, '')
  const variantes = new Set<string>()
  if (!limpio) return []

  variantes.add(limpio)
  if (limpio.startsWith('521') && limpio.length === 13) variantes.add(`52${limpio.slice(3)}`)
  if (limpio.startsWith('52') && limpio.length === 12) variantes.add(`521${limpio.slice(2)}`)
  if (limpio.length === 10) {
    variantes.add(`52${limpio}`)
    variantes.add(`521${limpio}`)
  }
  if (limpio.length > 10) variantes.add(limpio.slice(-10))

  return [...variantes]
}

export function jidToTelefono(jid: string): string {
  const limpio = (jid || '').replace(/@[^\s]*/g, '').trim()
  return limpio.startsWith('52') ? `+${limpio}` : limpio
}

export function extraerTelefono(msg: any): string {
  return jidToTelefono(msg.key?.remoteJid || '')
}

// ════════════════════════════════════════════════════════════════
// GESTIÓN DE CLIENTES (UUID)
// ════════════════════════════════════════════════════════════════

export async function obtenerClienteId(telefono: string): Promise<string | null> {
  const cached = CACHE_CLIENTE_UUID.get(telefono)
  if (cached) return cached

  try {
    const { data: existing } = await supabaseAdmin
      .from('clientes').select('id').eq('telefono', telefono).maybeSingle()

    if (existing) {
      CACHE_CLIENTE_UUID.set(telefono, existing.id)
      return existing.id
    }

    const { data: nuevo } = await supabaseAdmin
      .from('clientes').insert({ telefono }).select('id').single()

    if (nuevo) {
      CACHE_CLIENTE_UUID.set(telefono, nuevo.id)
      return nuevo.id
    }
  } catch (err) {
    console.error('[conversation] Error en obtenerClienteId:', err)
  }
  return null
}

// ════════════════════════════════════════════════════════════════
// HISTORIAL DE CONVERSACIONES (Supabase)
// ════════════════════════════════════════════════════════════════

export async function obtenerHistorial(telefono: string): Promise<MensajeChat[]> {
  const clienteId = await obtenerClienteId(telefono)
  if (!clienteId) return []

  try {
    const { data } = await supabaseAdmin
      .from('historial_chat').select('rol, contenido')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(MAX_TURNOS_HISTORIAL * 2)

    return (data ?? []).reverse().map(m => ({
      role: m.rol as 'user' | 'assistant',
      content: m.contenido,
    }))
  } catch (err) {
    console.error('[conversation] Error leyendo historial:', err)
    return []
  }
}

export async function agregarAlHistorial(telefono: string, role: 'user' | 'assistant', content: string): Promise<void> {
  const clienteId = await obtenerClienteId(telefono)
  if (!clienteId) return

  try {
    await supabaseAdmin.from('historial_chat').insert({
      cliente_id: clienteId,
      rol: role,
      contenido: content,
    })
  } catch (err) {
    console.error('[conversation] Error guardando historial:', err)
  }
}

// ════════════════════════════════════════════════════════════════
// DEDUPLICACIÓN DE MENSAJES
// ════════════════════════════════════════════════════════════════

export function obtenerMensajeId(msg: any): string | null {
  return msg?.key?.id || null
}

export function marcarMensajeProcesado(id: string): void {
  MENSAJES_PROCESADOS.set(id, Date.now())
}

export function yaProcesadoRecientemente(msg: any): boolean {
  const id = obtenerMensajeId(msg)
  if (!id) return false

  const ahora = Date.now()
  const procesadoEn = MENSAJES_PROCESADOS.get(id)
  if (procesadoEn && ahora - procesadoEn < MENSAJE_PROCESADO_TTL_MS) return true

  marcarMensajeProcesado(id)
  if (MENSAJES_PROCESADOS.size > 1000) {
    for (const [msgId, ts] of MENSAJES_PROCESADOS) {
      if (ahora - ts > MENSAJE_PROCESADO_TTL_MS) MENSAJES_PROCESADOS.delete(msgId)
    }
  }
  return false
}

// ════════════════════════════════════════════════════════════════
// UTILIDADES DE TEXTO
// ════════════════════════════════════════════════════════════════

export function normalizarTexto(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

// ════════════════════════════════════════════════════════════════
// LIMPIEZA DE CACHÉS (llamado desde watchdog de memoria)
// ════════════════════════════════════════════════════════════════

export function limpiarCachesConversacion(): void {
  CACHE_CLIENTE_UUID.clear()
  MENSAJES_PROCESADOS.clear()
}
