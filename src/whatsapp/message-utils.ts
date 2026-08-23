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

export interface HoraCdmx {
  dia: number
  hora: number
  minuto: number
  etiqueta: string
  hora12: number
  ampm: 'am' | 'pm'
  etiqueta12: string
}

export function ahoraCdmx(): HoraCdmx {
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
  const hora12 = hora % 12 === 0 ? 12 : hora % 12
  const ampm: 'am' | 'pm' = hora < 12 ? 'am' : 'pm'
  const mm = String(Number.isFinite(minuto) ? minuto : 0).padStart(2, '0')
  return {
    dia: dias[valor('weekday')] ?? 0,
    hora: Number.isFinite(hora) ? hora : 0,
    minuto: Number.isFinite(minuto) ? minuto : 0,
    etiqueta: `${String(Number.isFinite(hora) ? hora : 0).padStart(2, '0')}:${mm}`,
    hora12,
    ampm,
    etiqueta12: `${hora12}:${mm} ${ampm}`,
  }
}

// Formatea una hora 0-23 a formato 12h ("3:00 pm", "10:00 am").
export function formatoHora12(hora: number, minuto: number = 0): string {
  const h12 = hora % 12 === 0 ? 12 : hora % 12
  const ampm = hora < 12 ? 'am' : 'pm'
  return `${h12}:${String(minuto).padStart(2, '0')} ${ampm}`
}

// BUG-024: fecha (YYYY-MM-DD) y hora (0-23) actuales en CDMX, calculadas con
// formatToParts. NUNCA usar `new Date(localeString)` para esto: en Node,
// `new Date("23/8/2026, 12:28 p.m.")` devuelve Invalid Date (formato DD/MM/YYYY
// y sufijo "p.m." no son parseables), lo que dejaba muertos TODOS los jobs
// diarios del scheduler de bot.ts.
export function fechaYHoraCdmx(ahora: Date = new Date()): { fecha: string; hora: number } {
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora)
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? ''
  const hora = Number(valor('hour'))
  return {
    fecha: `${valor('year')}-${valor('month')}-${valor('day')}`,
    hora: Number.isFinite(hora) ? hora % 24 : 0,
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
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(fecha)
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value || ''
  const hh = Number(valor('hour'))
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  const ampm = hh < 12 ? 'am' : 'pm'
  return `${valor('day')}/${valor('month')}/${valor('year')} ${h12}:${valor('minute')} ${ampm}`
}

export function getContextoHorario(): string {
  const ahora = ahoraCdmx()
  const horarios = obtenerHorarios()
  const esFinDeSemana = ahora.dia === 0 || ahora.dia === 6
  const cierre = esFinDeSemana ? horarios.cierreFinSemana : horarios.cierreSemana

  if (estaEnHorario()) {
    const minutosActuales = ahora.hora * 60 + ahora.minuto
    const horaEntregaMin = minutosActuales + 60
    const entregaPosible = horaEntregaMin <= cierre * 60
    const horaEntregaHora = Math.floor(horaEntregaMin / 60)
    const horaEntregaResto = horaEntregaMin % 60
    const facturaEntrega = entregaPosible
      ? `Entrega/finalización en 1 hora: POSIBLE — estaría listo alrededor de las ${formatoHora12(horaEntregaHora, horaEntregaResto)}, aún dentro del horario (cerramos a las ${formatoHora12(cierre)}). Si el cliente pregunta por entrega en 1 hora, puedes confirmar esa hora estimada.`
      : `Entrega/finalización en 1 hora: NO posible — el equipo cierra a las ${formatoHora12(cierre)} y la hora estimada supera el cierre. NO prometas entrega en 1 hora ni inventes una hora; ofrece agendar para el siguiente horario disponible.`
    return `\n\n[CONTEXTO: Horario de atención] Hora actual CDMX: ${ahora.etiqueta12}. Estamos ABIERTOS en este momento (cierre: ${formatoHora12(cierre)}). ${facturaEntrega} No digas que estamos cerrados ni que se atenderá mañana.`
  }
  const estadoHorario = ahora.hora < horarios.apertura
    ? `Aún no abrimos (abrimos a las ${formatoHora12(horarios.apertura)}).`
    : `Ya cerramos por hoy (abrimos mañana a las ${formatoHora12(horarios.apertura)}).`
  return (
    `\n\n[CONTEXTO: Fuera de Horario] Hora actual CDMX: ${ahora.etiqueta12}. ${estadoHorario} ` +
    `Estamos CERRADOS para el equipo humano, PERO tú sigues disponible como asistente virtual para que el cliente NO pierda su pedido. ` +
    `Ofrécele: 1) mandar la FOTO de referencia del arreglo que quiere, 2) decir su PRESUPUESTO aproximado y 3) para QUÉ DÍA lo necesita. ` +
    `Promete amablemente que el equipo lo cotiza a primera hora cuando abran (a las ${formatoHora12(horarios.apertura)}). ` +
    `Puedes compartir el catálogo de Google Drive (link del prompt) para que vaya viendo opciones y recibir su foto de referencia. ` +
    `Si quiere pagar o apartar, comparte la cuenta BBVA (de [REGLAS VALIDADAS POR EL BACKEND]) y recibe su comprobante; el sistema lo registra y el equipo lo valida a primera hora. ` +
    `NUNCA digas "mañana te muestro", NUNCA inventes precios, horarios, disponibilidad ni links.`
  )
}
