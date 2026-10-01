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
import { agregarAlHistorial } from '../conversation/conversation.service'
import { OrigenMensaje } from '../models/types'
import {
  resolverTelefonoCanonical,
  MAX_TEXTO_OUTBOX,
} from '../../lib/chat-dashboard'
import { telefonoPorLid } from './lid-mapping'

const POLL_MS = 4_000
const LIMITE_LOTE = 5
const PODA_DUPLICADOS_MS = 5 * 60_000
const MAX_ANTIGUEDAD_MS = 24 * 60 * 60_000

let timer: NodeJS.Timeout | null = null
let timerPoda: NodeJS.Timeout | null = null
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
  if (!timerPoda) {
    timerPoda = setInterval(() => {
      podarDuplicadosEquipo().catch((err) =>
        console.error('[outbox] Error en poda:', err)
      )
    }, PODA_DUPLICADOS_MS)
    timerPoda.unref?.()
  }
  console.log('[outbox] 📤 Poller de mensajes del equipo iniciado (cada 4s)')
}

export function detenerOutboxPoller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (timerPoda) {
    clearInterval(timerPoda)
    timerPoda = null
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

  // Si el destino es un LID con teléfono conocido, operar sobre la fila
  // canónica (+teléfono): mejor entregabilidad y cero filas partidas.
  let destinoEnvio = m.telefono
  let canonico = await resolverTelefonoCanonical(m.telefono)
  try {
    const d = String(m.telefono ?? '').replace(/\D/g, '')
    if ((String(m.telefono).includes('@lid') || d.length > 13) && !canonico.startsWith('+')) {
      const mapeado = await telefonoPorLid(d)
      if (mapeado) {
        const soloDigitos = mapeado.replace(/\D/g, '')
        destinoEnvio = `${soloDigitos}@s.whatsapp.net`
        canonico = mapeado.startsWith('+') ? mapeado : `+${soloDigitos}`
      }
    }
  } catch {
    // ante cualquier duda se usa el destino original
  }

  try {
    await enviarOutbox(sock, destinoEnvio, texto)
  } catch (err) {
    // Se devuelve a pendiente para reintentar en el próximo ciclo.
    await marcar(m.id, 'pendiente')
    console.warn(
      `[outbox] Reintento ${m.id}:`,
      err instanceof Error ? err.message : err
    )
    return
  }

  // Guardado DETERMINISTA e inmediato en el historial (no depende del eco
  // fromMe de Baileys, que no está garantizado). Si el eco también guardara
  // el mensaje, la poda periódica elimina el duplicado.
  try {
    await agregarAlHistorial(
      canonico,
      'assistant',
      `[Agente: ${texto}]`,
      OrigenMensaje.EQUIPO
    )
  } catch (err) {
    console.error(
      `[outbox] ⚠️ Enviado pero NO se pudo guardar en historial (${m.id} → ${canonico}):`,
      err instanceof Error ? err.message : err
    )
  }
  await marcar(m.id, 'enviado')
  console.log(`[outbox] ✅ Enviado a ${m.telefono} (${texto.length} chars)`)
}

// Envía un mensaje del outbox. Las direcciones LID (@lid o dígitos largos)
// se envían DIRECTO a su JID sin pasar por onWhatsApp, que solo valida
// números telefónicos reales y las rechazaría (quedarían reintentando).
async function enviarOutbox(sock: any, destino: string, texto: string): Promise<void> {
  const d = String(destino ?? '').trim()
  if (d.includes('@')) {
    const jid = d.replace(/:\d+$/, '')
    await sock.sendMessage(jid, { text: texto })
    return
  }
  const digitos = d.replace(/\D/g, '')
  if (digitos.length > 13) {
    await sock.sendMessage(`${digitos}@lid`, { text: texto })
    return
  }
  const n = await enviarTextoANumeros(sock, [d], texto)
  if (n === 0) throw new Error('Sin entrega: número inválido o sin WhatsApp')
}

// Poda de seguridad: si el eco fromMe de Baileys guardó el mismo mensaje
// del equipo que ya guardó el poller, quedan 2 filas idénticas seguidas.
// Se conserva la más antigua y se borran las demás. Corre cada 5 min sobre
// una ventana de 15 min (costo despreciable).
async function podarDuplicadosEquipo(): Promise<void> {
  try {
    const desde = new Date(Date.now() - 15 * 60_000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('historial_chat')
      .select('id, cliente_id, contenido, creado_en')
      .eq('origen', 'equipo')
      .gte('creado_en', desde)
      .order('creado_en', { ascending: true })
      .limit(500)
    if (error || !data || data.length < 2) return
    const vistos = new Map<string, string>()
    const duplicados: string[] = []
    for (const row of data) {
      const clave = `${row.cliente_id}‖${String(row.contenido ?? '').trim()}`
      if (vistos.has(clave)) duplicados.push(row.id as string)
      else vistos.set(clave, row.id as string)
    }
    if (duplicados.length === 0) return
    const { error: delError } = await supabaseAdmin
      .from('historial_chat')
      .delete()
      .in('id', duplicados)
    if (!delError) console.log(`[outbox] 🧹 Poda: ${duplicados.length} mensaje(s) duplicado(s) eliminados`)
  } catch {
    // no fatal: se reintenta en el próximo ciclo
  }
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
