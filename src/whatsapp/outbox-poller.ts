// src/whatsapp/outbox-poller.ts — Poller de mensajes del equipo (dashboard → WhatsApp)
//
// La pestaña WhatsApp del dashboard (Vercel) NO habla directo con esta VM.
// En su lugar escribe filas en `mensajes_outbox_equipo` (Supabase) y este
// poller las envía por Baileys cada POLL_MS.
//
// Diseño anti-duplicados:
//   1. Claim atómico pendiente → enviando (un solo envío aunque haya reinicios).
//   2. Tras enviar, espera el eco fromMe: procesarMensajeEquipo ya guarda
//      el mensaje como `[Agente: ...]` con origen='equipo'. Solo si el eco
//      no aparece en ECO_ESPERA_MS se guarda directo en el historial.
//   3. Mensajes con más de 24h en cola se marcan error (fuera de contexto).
//   4. Si el bot está desconectado (sin sock.user), las filas quedan
//      pendientes y se envían al reconectar.

import { supabaseAdmin } from '../../lib/supabase'
import { enviarTextoANumeros } from './notification.service'
import {
  obtenerClienteId,
  agregarAlHistorial,
} from '../conversation/conversation.service'
import { OrigenMensaje } from '../models/types'
import {
  resolverTelefonoCanonical,
  MAX_TEXTO_OUTBOX,
} from '../../lib/chat-dashboard'

const POLL_MS = 4_000
const LIMITE_LOTE = 5
const ECO_ESPERA_MS = 15_000
const ECO_INTERVALO_MS = 2_000
const MAX_ANTIGUEDAD_MS = 24 * 60 * 60_000

let timer: NodeJS.Timeout | null = null
let procesando = false

type OutboxRow = {
  id: string
  telefono: string
  texto: string
  estado: string
  intentos: number | null
  creado_en: string
}

export function iniciarOutboxPoller(getSock: () => any | null): void {
  if (timer) return
  timer = setInterval(() => {
    procesarPendientes(getSock).catch((err) =>
      console.error('[outbox] Error en ciclo:', err)
    )
  }, POLL_MS)
  timer.unref?.()
  console.log('[outbox] 📤 Poller de mensajes del equipo iniciado (cada 4s)')
}

export function detenerOutboxPoller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function procesarPendientes(getSock: () => any | null): Promise<void> {
  if (procesando) return
  procesando = true
  try {
    const sock = getSock()
    if (!sock?.user) return // desconectado: reintentar en el próximo ciclo
    const { data, error } = await supabaseAdmin
      .from('mensajes_outbox_equipo')
      .select('id, telefono, texto, estado, intentos, creado_en')
      .eq('estado', 'pendiente')
      .order('creado_en', { ascending: true })
      .limit(LIMITE_LOTE)
    if (error) {
      console.error('[outbox] Error leyendo pendientes:', error.message)
      return
    }
    for (const m of (data ?? []) as OutboxRow[]) {
      try {
        await procesarUno(sock, m)
      } catch (err) {
        console.error(`[outbox] Error con mensaje ${m.id}:`, err)
      }
    }
  } finally {
    procesando = false
  }
}

async function procesarUno(sock: any, m: OutboxRow): Promise<void> {
  const texto = String(m.texto ?? '').slice(0, MAX_TEXTO_OUTBOX).trim()

  if (Date.now() - new Date(m.creado_en).getTime() > MAX_ANTIGUEDAD_MS) {
    await marcar(m.id, 'error', 'Vencido: más de 24h en cola, ya no se envía')
    return
  }
  if (!texto) {
    await marcar(m.id, 'error', 'Texto vacío')
    return
  }

  // Claim atómico para no enviar dos veces ante reinicios/ciclos solapados.
  const { data: claim } = await supabaseAdmin
    .from('mensajes_outbox_equipo')
    .update({
      estado: 'enviando',
      intentos: (m.intentos ?? 0) + 1,
      actualizado_en: new Date().toISOString(),
    })
    .eq('id', m.id)
    .eq('estado', 'pendiente')
    .select('id')
    .maybeSingle()
  if (!claim) return

  const enviadoAntes = new Date().toISOString()
  try {
    const n = await enviarTextoANumeros(sock, [m.telefono], texto)
    if (n === 0) throw new Error('Sin entrega: número inválido o sin WhatsApp')
  } catch (err) {
    // Se devuelve a pendiente para reintentar en el próximo ciclo.
    await marcar(m.id, 'pendiente')
    console.warn(
      `[outbox] Reintento ${m.id}:`,
      err instanceof Error ? err.message : err
    )
    return
  }

  const eco = await esperarEcoHistorial(m.telefono, texto, enviadoAntes)
  if (!eco) {
    const canonico = await resolverTelefonoCanonical(m.telefono)
    await agregarAlHistorial(
      canonico,
      'assistant',
      `[Agente: ${texto}]`,
      OrigenMensaje.EQUIPO
    )
  }
  await marcar(m.id, 'enviado')
  console.log(`[outbox] ✅ Enviado a ${m.telefono} (${texto.length} chars)`)
}

// Busca en el historial el eco fromMe del mensaje recién enviado.
// procesarMensajeEquipo lo persiste como `[Agente: <texto>]` con
// origen='equipo', así que encontrarlo evita guardarlo dos veces.
async function esperarEcoHistorial(
  telefono: string,
  texto: string,
  desdeIso: string
): Promise<boolean> {
  const clienteId = await obtenerClienteId(
    await resolverTelefonoCanonical(telefono)
  )
  if (!clienteId) return false
  const limite = Date.now() + ECO_ESPERA_MS
  while (Date.now() < limite) {
    try {
      const { data } = await supabaseAdmin
        .from('historial_chat')
        .select('contenido, origen')
        .eq('cliente_id', clienteId)
        .gte('creado_en', desdeIso)
        .eq('origen', 'equipo')
        .limit(10)
      for (const row of data ?? []) {
        const limpio = String(row.contenido ?? '')
          .replace(/^\[Agente:\s*|\]$/g, '')
          .trim()
        if (limpio === texto) return true
      }
    } catch {
      // error transitorio de lectura: reintentar hasta agotar la espera
    }
    await new Promise((r) => setTimeout(r, ECO_INTERVALO_MS))
  }
  return false
}

async function marcar(
  id: string,
  estado: 'pendiente' | 'enviando' | 'enviado' | 'error',
  errorDetalle?: string
): Promise<void> {
  try {
    await supabaseAdmin
      .from('mensajes_outbox_equipo')
      .update({
        estado,
        error_detalle: errorDetalle ?? null,
        actualizado_en: new Date().toISOString(),
        ...(estado === 'enviado' ? { enviado_en: new Date().toISOString() } : {}),
      })
      .eq('id', id)
  } catch (err) {
    console.error(`[outbox] Error marcando ${id} como ${estado}:`, err)
  }
}
