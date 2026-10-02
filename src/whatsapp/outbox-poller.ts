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
import {
  MEDIA_BUCKET,
  MAX_BYTES_BOT,
  marcadorMedia,
  esRutaMediaValida,
  type TipoOutbox,
} from '../../lib/chat-media'

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
  tipo?: string | null
  media_path?: string | null
  media_mimetype?: string | null
  media_nombre?: string | null
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
      .select('id, telefono, texto, estado, intentos, creado_en, tipo, media_path, media_mimetype, media_nombre')
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
  // El texto vacío solo es error en mensajes de texto: en medios es el
  // caption opcional (el archivo va en media_path).
  const tipo = (m.tipo as TipoOutbox) || 'texto'
  if (!texto && tipo === 'texto') {
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

  const caption = texto

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

  if (tipo !== 'texto') {
    if (!m.media_path || !esRutaMediaValida(m.media_path)) {
      await marcar(m.id, 'error', 'Archivo adjunto inválido o ausente')
      return
    }
  }

  try {
    await enviarOutboxMedia(sock, destinoEnvio, {
      tipo,
      texto: caption,
      mediaPath: m.media_path ?? undefined,
      mediaMimetype: m.media_mimetype ?? undefined,
      mediaNombre: m.media_nombre ?? undefined,
    })
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err)
    if (detalle.startsWith('ADJUNTO_NO_ENCONTRADO')) {
      await marcar(m.id, 'error', 'El archivo ya no existe en el almacenamiento')
      console.warn(`[outbox] Adjunto perdido ${m.id}, se marca error`)
      return
    }
    // Se devuelve a pendiente para reintentar en el próximo ciclo.
    await marcar(m.id, 'pendiente')
    console.warn(`[outbox] Reintento ${m.id}:`, detalle)
    return
  }

  // Guardado DETERMINISTA e inmediato en el historial (no depende del eco
  // fromMe de Baileys, que no está garantizado). Si el eco también guardara
  // el mensaje, la poda periódica elimina el duplicado.
  try {
    if (tipo === 'texto') {
      await agregarAlHistorial(
        canonico,
        'assistant',
        `[Agente: ${caption}]`,
        OrigenMensaje.EQUIPO
      )
    } else {
      // Prefijo `[Agente: ...]` para que Flora lo reconozca como equipo.
      const etiqueta =
        tipo === 'imagen' ? 'envió una foto' : tipo === 'audio' ? 'envió una nota de voz' : 'envió un archivo'
      await agregarAlHistorial(
        canonico,
        'assistant',
        caption ? `[Agente: ${caption}]` : `[Agente: ${etiqueta}]`,
        OrigenMensaje.EQUIPO,
        { mediaTipo: tipo, mediaUrl: m.media_path ?? undefined }
      )
    }
  } catch (err) {
    console.error(
      `[outbox] ⚠️ Enviado pero NO se pudo guardar en historial (${m.id} → ${canonico}):`,
      err instanceof Error ? err.message : err
    )
  }
  await marcar(m.id, 'enviado')
  console.log(`[outbox] ✅ Enviado a ${m.telefono} (${tipo}${caption ? `, ${caption.length} chars` : ''})`)
}

// Resuelve el JID de destino. Las direcciones LID (@lid o dígitos largos)
// van DIRECTO a su JID sin pasar por onWhatsApp, que solo valida números
// telefónicos reales y las rechazaría. Los teléfonos reales se resuelven
// con onWhatsApp (tolera variantes MX 52/521).
async function resolverJidEnvio(sock: any, destino: string): Promise<string> {
  const d = String(destino ?? '').trim()
  if (d.includes('@')) return d.replace(/:\d+$/, '')
  const digitos = d.replace(/\D/g, '')
  if (digitos.length > 13) return `${digitos}@lid`
  if (digitos.length >= 10 && sock?.onWhatsApp) {
    try {
      const res = await sock.onWhatsApp(digitos).catch(() => undefined)
      const contacto = res?.find((r: { exists: boolean; jid: string }) => r.exists && r.jid)
      if (contacto?.jid) return String(contacto.jid).replace(/@c\.us$/, '@s.whatsapp.net')
    } catch { /* fallback al JID directo */ }
  }
  return `${digitos}@s.whatsapp.net`
}

export interface CargaOutbox {
  tipo: TipoOutbox
  texto: string
  mediaPath?: string
  mediaMimetype?: string
  mediaNombre?: string
}

// Envía texto o medios del outbox por Baileys.
async function enviarOutboxMedia(sock: any, destino: string, carga: CargaOutbox): Promise<void> {
  const d = String(destino ?? '').trim()
  if (carga.tipo === 'texto') {
    if (d.includes('@')) {
      await sock.sendMessage(d.replace(/:\d+$/, ''), { text: carga.texto })
      return
    }
    const digitos = d.replace(/\D/g, '')
    if (digitos.length > 13) {
      await sock.sendMessage(`${digitos}@lid`, { text: carga.texto })
      return
    }
    const n = await enviarTextoANumeros(sock, [d], carga.texto)
    if (n === 0) throw new Error('Sin entrega: número inválido o sin WhatsApp')
    return
  }

  if (!carga.mediaPath || !esRutaMediaValida(carga.mediaPath)) {
    throw new Error('Ruta de archivo inválida')
  }
  const { data, error } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .download(carga.mediaPath)
  if (error || !data) {
    // Archivo borrado o ruta inválida: error definitivo (no reintentar).
    if (/not found|does not exist|no existe/i.test(error?.message ?? '')) {
      throw new Error(`ADJUNTO_NO_ENCONTRADO: ${carga.mediaPath}`)
    }
    throw new Error('No se pudo descargar el adjunto')
  }
  const buf = Buffer.from(await data.arrayBuffer())
  if (buf.length === 0 || buf.length > MAX_BYTES_BOT) {
    throw new Error('Adjunto vacío o excede 12MB')
  }
  const jid = await resolverJidEnvio(sock, d)
  const caption = carga.texto.trim() || undefined
  const mimetype = String(carga.mediaMimetype || 'application/octet-stream').split(';')[0].trim()

  if (carga.tipo === 'imagen') {
    await sock.sendMessage(jid, { image: buf, caption, mimetype })
  } else if (carga.tipo === 'audio') {
    // WhatsApp exige Ogg Opus con mimetype exacto + duración para PTT.
    const mimeVoz = 'audio/ogg; codecs=opus'
    let segundos: number | undefined
    try {
      const { parseBuffer } = await import('music-metadata')
      const meta = await parseBuffer(buf, { mimeType: 'audio/ogg' } as any, { duration: true } as any)
      const d = Number((meta as any)?.format?.duration)
      if (Number.isFinite(d) && d > 0) segundos = Math.max(1, Math.round(d))
    } catch {
      // sin duración: Baileys intentará calcularla solo
    }
    await sock.sendMessage(jid, { audio: buf, mimetype: mimeVoz, ptt: true, ...(segundos ? { seconds: segundos } : {}) })
  } else {
    const fileName = String(carga.mediaNombre || 'archivo').slice(0, 120) || 'archivo'
    await sock.sendMessage(jid, { document: buf, mimetype, fileName, caption })
  }
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
      .select('id, cliente_id, contenido, creado_en, media_url')
      .eq('origen', 'equipo')
      .gte('creado_en', desde)
      .order('creado_en', { ascending: true })
      .limit(500)
    if (error || !data || data.length < 2) return
    const vistos = new Map<string, string>()
    const duplicados: string[] = []
    for (const row of data) {
      // La URL distingue dos fotos distintas con el mismo caption.
      const clave = `${row.cliente_id}‖${String(row.contenido ?? '').trim()}‖${String((row as any).media_url ?? '')}`
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
