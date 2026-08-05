import { getContentType, downloadContentFromMessage, isJidGroup } from '@whiskeysockets/baileys'
import { Buffer } from 'node:buffer'
import { obtenerHorarios } from '../config/configuracion.service'

export function getContenidoMensaje(msg: any): any {
  let full = msg?.message
  for (let i = 0; i < 4 && full; i++) {
    if (full.ephemeralMessage?.message) full = full.ephemeralMessage.message
    else if (full.viewOnceMessage?.message) full = full.viewOnceMessage.message
    else if (full.viewOnceMessageV2?.message) full = full.viewOnceMessageV2.message
    else if (full.viewOnceMessageV2Extension?.message) full = full.viewOnceMessageV2Extension.message
    else if (full.documentWithCaptionMessage?.message) full = full.documentWithCaptionMessage.message
    else break
  }
  return full
}

export function getMessageBody(msg: any): string {
  const full = getContenidoMensaje(msg)
  if (!full) return ''
  const type = getContentType(full)
  if (!type) return ''
  if (type === 'conversation') return full.conversation || ''
  if (type === 'extendedTextMessage') return full.extendedTextMessage?.text || ''
  if (type === 'imageMessage') return full.imageMessage?.caption || ''
  if (type === 'videoMessage') return full.videoMessage?.caption || ''
  if (type === 'documentMessage') return full.documentMessage?.caption || ''
  if (type === 'buttonsResponseMessage') return full.buttonsResponseMessage?.selectedButtonId || ''
  if (type === 'listResponseMessage') return full.listResponseMessage?.singleSelectReply?.selectedRowId || ''
  return ''
}

export function getMensajeTexto(msg: any): string {
  return typeof msg?.body === 'string' ? msg.body : getMessageBody(msg)
}

export function getMessageType(msg: any): string {
  const full = getContenidoMensaje(msg)
  if (!full) return 'unknown'
  const type = getContentType(full)
  if (type === 'conversation' || type === 'extendedTextMessage') return 'chat'
  if (type === 'imageMessage') return 'image'
  if (type === 'videoMessage') return 'video'
  if (type === 'audioMessage') return 'audio'
  if (type === 'documentMessage') return 'document'
  if (type === 'stickerMessage') return 'sticker'
  return 'unknown'
}

export function hasQuotedMsg(msg: any): boolean {
  const ci = msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.imageMessage?.contextInfo
    || msg?.message?.videoMessage?.contextInfo
  return !!(ci?.stanzaId || ci?.quotedMessage)
}

export function getQuotedText(msg: any): string {
  const ci = msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.imageMessage?.contextInfo
    || msg?.message?.videoMessage?.contextInfo
  if (!ci?.quotedMessage) return ''
  const q = ci.quotedMessage
  if (q.conversation) return q.conversation
  if (q.extendedTextMessage?.text) return q.extendedTextMessage.text
  if (q.imageMessage?.caption) return q.imageMessage.caption
  if (q.videoMessage?.caption) return q.videoMessage.caption
  return ''
}

export async function descargarMedia(msg: any, type: 'image' | 'document'): Promise<Buffer | null> {
  try {
    const full = getContenidoMensaje(msg)
    const contenido = type === 'document' ? full?.documentMessage : full?.imageMessage
    if (!contenido) return null
    const stream = await downloadContentFromMessage(contenido, type === 'document' ? 'document' : 'image')
    const chunks: Uint8Array[] = []
    for await (const chunk of stream) chunks.push(chunk as Uint8Array)
    return Buffer.concat(chunks)
  } catch (e) {
    console.warn('[msg-utils] Error descargando media:', e)
    return null
  }
}

export function jidANumero(jid: string): string {
  const limpio = (jid || '')
    .replace(/@[^\s]*/g, '')
    .replace(/:\d+$/, '')
    .trim()
  return limpio.startsWith('52') ? `+${limpio}` : limpio
}

export function ahoraCdmx(): { dia: number; hora: number; minuto: number; etiqueta: string } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value || ''
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const hora = Number(valor('hour'))
  const minuto = Number(valor('minute'))
  return {
    dia: dias[valor('weekday')] ?? 0,
    hora: Number.isFinite(hora) ? hora : 0,
    minuto: Number.isFinite(minuto) ? minuto : 0,
    etiqueta: `${String(Number.isFinite(hora) ? hora : 0).padStart(2, '0')}:${String(Number.isFinite(minuto) ? minuto : 0).padStart(2, '0')}`,
  }
}

export function estaEnHorario(): boolean {
  const ahora = ahoraCdmx()
  const hora  = ahora.hora * 60 + ahora.minuto
  const dia   = ahora.dia
  const esFinDeSemana = dia === 0 || dia === 6
  const horarios = obtenerHorarios()
  return hora >= horarios.apertura * 60 && hora < (esFinDeSemana ? horarios.cierreFinSemana * 60 : horarios.cierreSemana * 60)
}

export function getFechaActual(): string {
  return new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatearFechaHoraMensaje(creadoEn: string): string {
  const fecha = new Date(creadoEn)
  if (Number.isNaN(fecha.getTime())) return ''
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(fecha)
}

export function getContextoHorario(): string {
  const ahora = ahoraCdmx()
  const horarios = obtenerHorarios()
  if (estaEnHorario()) {
    return `\n\n[CONTEXTO: Horario de atención] Hora actual CDMX: ${ahora.etiqueta}. Estamos ABIERTOS en este momento. No digas que estamos cerrados ni que se atenderá mañana.`
  }
  const estadoHorario = ahora.hora < horarios.apertura
    ? `Aún no abrimos (abrimos a las ${horarios.apertura}:00 am).`
    : `Ya cerramos por hoy (abrimos mañana a las ${horarios.apertura}:00 am).`
  return (
    `\n\n[CONTEXTO: Fuera de Horario] Hora actual CDMX: ${ahora.etiqueta}. ${estadoHorario} ` +
    `Flora sigue disponible para ayudar al cliente con cosas útiles: puede enviar FOTO de referencia del arreglo que quiere, indicar su presupuesto, su nombre y para qué día lo necesita, para que el equipo lo cotice a primera hora cuando abramos. ` +
    `Pídele amablemente esos datos o confirma que recibió su foto de referencia. NUNCA le digas "mañana te muestro" ni inventes precios ni horarios.`
  )
}
