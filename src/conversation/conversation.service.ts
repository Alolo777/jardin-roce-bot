// src/conversation/conversation.service.ts
// Motor de Conversación — Historial, actividad, inactividad y estado de conversación

import { supabaseAdmin } from '../../lib/supabase'
import type { MensajeChat } from '../../lib/ai'
import type { ConversationState } from '../models/types'

// ════════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════════

export const MAX_TURNOS_HISTORIAL = 30
export const MENSAJE_PROCESADO_TTL_MS = 2 * 60 * 60_000
export const INACTIVIDAD_CAMBIO_TEMA_HR = 24
export const INACTIVIDAD_ARCHIVAR_CASO_HR = 72
export const INACTIVIDAD_MAX_HR = 99

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
  const limpio = (jid || '')
    .replace(/@[^\s]*/g, '')
    .replace(/:\d+$/, '')
    .trim()
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

export async function obtenerUltimoMensaje(telefono: string): Promise<{ rol: 'user' | 'assistant'; contenido: string; timestamp: string } | null> {
  const clienteId = await obtenerClienteId(telefono)
  if (!clienteId) return null

  try {
    const { data } = await supabaseAdmin
      .from('historial_chat').select('rol, contenido, creado_en')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(1)
      .single()

    if (!data) return null
    return {
      rol: data.rol as 'user' | 'assistant',
      contenido: data.contenido,
      timestamp: data.creado_en,
    }
  } catch {
    return null
  }
}

export async function obtenerHistorialCompletoConTimestamp(telefono: string): Promise<{ rol: string; contenido: string; creadoEn: string }[]> {
  const clienteId = await obtenerClienteId(telefono)
  if (!clienteId) return []

  try {
    const { data } = await supabaseAdmin
      .from('historial_chat').select('rol, contenido, creado_en')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: true })
      .limit(MAX_TURNOS_HISTORIAL * 2)

    return (data ?? []).map(m => ({
      rol: m.rol,
      contenido: m.contenido,
      creadoEn: m.creado_en,
    }))
  } catch {
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
// ESTADO DE CONVERSACIÓN
// ════════════════════════════════════════════════════════════════

export function calcularHorasInactivo(ultimaActividad: string | null | undefined): number {
  if (!ultimaActividad) return INACTIVIDAD_MAX_HR
  return (Date.now() - new Date(ultimaActividad).getTime()) / (1000 * 60 * 60)
}

export function detectarCambioTema(texto: string, horasInactivo: number): boolean {
  if (horasInactivo >= INACTIVIDAD_CAMBIO_TEMA_HR) return true

  const soloAgradecimiento = /^(gracias|ok|okay|si|sí|vale|dale|está bien|esta bien|de acuerdo|claro|perfecto|genial|bueno)$/i
  if (soloAgradecimiento.test(texto.trim())) return false

  const indicadoresNuevo = /\b(ahora\s+(quiero|necesito|ocupo)|otro\s+(pedido|ramo|arreglo|cosa|tema)|nuevo\s+(pedido|caso)|empezamos\s+de\s+nuevo|desde\s+cero|cambio\s+de\s+tema|es\s+otra\s+(cosa|flor)|ahora\s+(para|es))\b/i
  if (indicadoresNuevo.test(texto)) return true

  return false
}

export async function obtenerEstadoConversacion(telefono: string, ultimaActividadCaso?: string | null): Promise<ConversationState> {
  const clienteId = await obtenerClienteId(telefono)
  const ultimoMsg = await obtenerUltimoMensaje(telefono)
  const historial = clienteId ? await obtenerHistorial(telefono) : []

  const ultimaActividad = ultimoMsg?.timestamp ?? ultimaActividadCaso ?? null
  const horasInactivo = calcularHorasInactivo(ultimaActividad)
  const esNuevoCliente = historial.length === 0

  return {
    telefono,
    clienteId,
    existeHistorial: historial.length > 0,
    ultimoMensaje: ultimoMsg,
    horasInactivo,
    esNuevoCliente,
    totalMensajes: historial.length,
    ultimaActividad,
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
