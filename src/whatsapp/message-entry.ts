import { isJidGroup } from '@whiskeysockets/baileys'
import {
  getMessageType,
  getMessageBody,
  descargarMedia,
  getContenidoMensaje,
  jidANumero,
} from './message-utils'
import {
  yaProcesadoRecientemente,
  obtenerMensajeId,
  marcarMensajeProcesado,
  variantesTelefono,
} from '../conversation/conversation.service'
import {
  cargarIgnorados,
  MENSAJES_RESCATADOS,
} from './preferences.service'
import { obtenerNumeroReal } from './contact.service'
import {
  estaRateLimited,
  RATE_AVISADOS,
  RATE_LIMIT_WINDOW_MS,
} from './bot-state'

export interface MessageEntryDeps {
  responderMensaje: (msg: any, texto: string) => Promise<any>
  marcarFotosDisponibles: (clienteId: string) => void
  encolarPorCliente: (id: string, tarea: () => Promise<void>) => void
  encolarMensajeAgrupado: (clienteId: string, msg: any) => void
  procesarMensajeEquipo: (remoteJid: string, msgType: string, body: string) => Promise<void>
  verificarSiBotPausado: () => Promise<boolean>
  mediaToBase64: (media: Buffer | Uint8Array | ArrayBuffer) => string
  TIPOS_MEDIA_NO_SOPORTADOS: Set<string>
  registrarActividad: () => void
}

export function createMessageEntry(deps: MessageEntryDeps) {
  const {
    responderMensaje,
    marcarFotosDisponibles,
    encolarPorCliente,
    encolarMensajeAgrupado,
    procesarMensajeEquipo,
    verificarSiBotPausado,
    mediaToBase64,
    TIPOS_MEDIA_NO_SOPORTADOS,
    registrarActividad,
  } = deps

  function timestampMensajeMs(msg: any): number {
    const ts = msg?.messageTimestamp
    const segundos = Number(ts?.toNumber?.() ?? ts ?? 0)
    return Number.isFinite(segundos) ? segundos * 1000 : 0
  }

  function avisarRateLimitUnaVez(msg: any, id: string): void {
    if (RATE_AVISADOS.has(id)) return
    RATE_AVISADOS.add(id)
    responderMensaje(msg, 'Voy un poquito rápido 🌸 Dame un momento. ¿Va?').catch(() => {})
    setTimeout(() => RATE_AVISADOS.delete(id), RATE_LIMIT_WINDOW_MS)
  }

  async function procesarMensajeEntrante(msg: any): Promise<void> {
    registrarActividad()

    const remoteJid = msg.key?.remoteJid as string
    if (!remoteJid) return

    const msgType = getMessageType(msg)
    const body = getMessageBody(msg) || ''

    console.log(`[DIAG] from: ${remoteJid} | type: ${msgType} | fromMe: ${msg.key?.fromMe}`)

    if (isJidGroup(remoteJid)) return
    if (remoteJid.endsWith('@newsletter')) return
    if (remoteJid === 'status@broadcast') return
    if (!msg.key?.fromMe && yaProcesadoRecientemente(msg)) {
      console.log(`[entry] ↩️ Mensaje duplicado ignorado: ${obtenerMensajeId(msg)}`)
      return
    }

    const ignorados = await cargarIgnorados()
    const numeroRealParaIgnorar = await obtenerNumeroReal(msg)
    const candidatosIgnorar = [
      numeroRealParaIgnorar,
      remoteJid,
      msg.key?.participant,
      msg.key?.remoteJidAlt,
      msg.key?.participantAlt,
      msg.key?.senderPn,
      msg.senderPn,
      msg.participant,
    ].filter(Boolean) as string[]
    const variantesMensaje = [...new Set(candidatosIgnorar.flatMap(n => variantesTelefono(jidANumero(n))))]
    if (!msg.key?.fromMe && variantesMensaje.some(n => ignorados.includes(n))) {
      console.log(`[entry] 🔇 Número ignorado: ${numeroRealParaIgnorar || remoteJid}`)
      return
    }

    if (msg.key?.fromMe) {
      if (msgType === 'image' || msgType === 'document') marcarFotosDisponibles(remoteJid)
      if (body) encolarPorCliente(remoteJid, () => procesarMensajeEquipo(remoteJid, msgType, body))
      return
    }

    const clienteId = remoteJid

    if (msgType === 'sticker') {
      const stickerId = obtenerMensajeId(msg)
      if (stickerId) marcarMensajeProcesado(stickerId)
      return
    }

    if (msgType !== 'chat' && TIPOS_MEDIA_NO_SOPORTADOS.has(msgType)) {
      if (msgType === 'image' || msgType === 'document') {
        const buffer = await descargarMedia(msg, msgType as 'image' | 'document')
        if (buffer) {
          const msgConMedia = msg as any
          msgConMedia._mediaBuffer = mediaToBase64(buffer)
          msgConMedia._mediaMime = msgType === 'document'
            ? getContenidoMensaje(msg)?.documentMessage?.mimetype || 'application/octet-stream'
            : 'image/jpeg'
        }
        encolarMensajeAgrupado(clienteId, msg)
      } else {
        responderMensaje(msg, 'Por ahora solo puedo leer mensajes de *texto* 🌸. ¿Qué necesitas?').catch(() => {})
      }
      return
    }

    if (!body.trim()) return
    if (estaRateLimited(clienteId)) { avisarRateLimitUnaVez(msg, clienteId); return }

    verificarSiBotPausado().then(pausado => {
      if (pausado) { console.log(`[entry] ⏸️ Pausado — ${clienteId} ignorado`); return }
      encolarMensajeAgrupado(clienteId, msg)
    }).catch(() => encolarMensajeAgrupado(clienteId, msg))
  }

  async function rescatarMensajesNoLeidos(chats: any[], messages: any[]): Promise<void> {
    const noLeidos = new Map<string, number>()
    for (const chat of chats || []) {
      const jid = chat?.id
      const unread = Number(chat?.unreadCount || 0)
      if (!jid || unread <= 0) continue
      if (isJidGroup(jid) || jid.endsWith('@newsletter') || jid === 'status@broadcast') continue
      noLeidos.set(jid, unread)
    }
    if (noLeidos.size === 0) return

    const hace48h = Date.now() - 48 * 60 * 60_000
    const porChat = new Map<string, any[]>()
    for (const msg of messages || []) {
      const jid = msg?.key?.remoteJid
      if (!jid || !noLeidos.has(jid) || msg?.key?.fromMe) continue
      const id = obtenerMensajeId(msg)
      if (!id || MENSAJES_RESCATADOS.has(id)) continue
      const ts = timestampMensajeMs(msg)
      if (ts && ts < hace48h) continue
      const lista = porChat.get(jid) || []
      lista.push(msg)
      porChat.set(jid, lista)
    }

    for (const [jid, lista] of porChat) {
      const limite = noLeidos.get(jid) || 1
      const pendientes = lista
        .sort((a, b) => timestampMensajeMs(b) - timestampMensajeMs(a))
        .slice(0, limite)
        .sort((a, b) => timestampMensajeMs(a) - timestampMensajeMs(b))
      if (pendientes.length === 0) continue
      console.log(`[entry] 🛟 Rescatando ${pendientes.length} mensaje(s) no leído(s) de ${jid}`)
      for (const msg of pendientes) {
        const id = obtenerMensajeId(msg)
        if (id) MENSAJES_RESCATADOS.add(id)
        await procesarMensajeEntrante(msg)
      }
    }
  }

  return { procesarMensajeEntrante, rescatarMensajesNoLeidos }
}

export type MessageEntry = ReturnType<typeof createMessageEntry>
