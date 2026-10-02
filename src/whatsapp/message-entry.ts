import { isJidGroup } from '@whiskeysockets/baileys'
import { Buffer } from 'node:buffer'
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
  obtenerDescripcionIgnorado,
  MENSAJES_RESCATADOS,
} from './preferences.service'
import { agregarAlHistorial } from '../conversation/conversation.service'
import { TOMA_HUMANA_DESCRIPCION } from '../../lib/chat-dashboard'
import { obtenerNumeroReal } from './contact.service'
import { descargarMediaConMime, persistirMediaEntrante, conTimeout, TIMEOUT_DESCARGA_MS } from './media-inbox.service'
import {
  telefonoPorLid,
  registrarMapeoLid,
  canonicalizarClienteLid,
} from './lid-mapping'
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
  // DEC-084: los administradores del bot escriben desde SU número y reciben
  // el digest de novedades; no pasan por el flujo de cliente.
  esAdminBot: (numeroOJid: string) => Promise<boolean>
  procesarMensajeAdmin: (remoteJid: string, body: string) => Promise<void>
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
    esAdminBot,
    procesarMensajeAdmin,
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

    if (isJidGroup(remoteJid)) return
    if (remoteJid.endsWith('@newsletter')) return
    if (remoteJid === 'status@broadcast') return
    // Ruido de sincronización de Baileys al reconectar: ecos/protocolos sin
    // contenido (type unknown + fromMe) que antes inundaban los logs.
    if (msgType === 'unknown' && msg.key?.fromMe && !body.trim()) return

    console.log(`[DIAG] from: ${remoteJid} | type: ${msgType} | fromMe: ${msg.key?.fromMe}`)
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
      // Toma humana desde el dashboard: el mensaje SÍ se guarda para que se
      // vea al instante en la bandeja, pero Flora no responde en este chat.
      // Los silenciados permanentes conservan el comportamiento legacy
      // (se descartan sin guardar para no meter ruido a la bandeja).
      // Incluye fotos, voz y archivos: antes se descartaban aquí sin llegar
      // al código que los persiste (el filtro solo dejaba pasar texto).
      try {
        const motivo = await obtenerDescripcionIgnorado(variantesMensaje)
        if (motivo === TOMA_HUMANA_DESCRIPCION) {
          const tel = (numeroRealParaIgnorar || jidANumero(remoteJid)).trim()
          if (msgType === 'chat' && body.trim()) {
            if (tel) {
              agregarAlHistorial(tel, 'user', body.trim().slice(0, 1000)).catch(() => {})
              console.log(`[entry] ⏸️ Guardado (toma humana, sin responder): ${tel}`)
            }
            return
          }
          if (tel && (msgType === 'image' || msgType === 'document' || msgType === 'audio')) {
            const media = await conTimeout(descargarMediaConMime(msg), TIMEOUT_DESCARGA_MS, 'descarga media (pausa)')
            if (media) {
              await persistirMediaEntrante(tel, media, body).catch(() => {})
              console.log(`[entry] ⏸️ Medio guardado (toma humana): ${tel} ${media.tipo}`)
              if (msgType === 'audio') {
                responderMensaje(msg, '🎤 ¡Recibí tu nota de voz! El equipo la va a escuchar en un momento 🌸').catch(() => {})
              }
            }
            return
          }
        }
      } catch { /* ante cualquier duda: legado (descartar) */ }
      console.log(`[entry] 🔇 Número ignorado: ${numeroRealParaIgnorar || remoteJid}`)
      return
    }

    // DEC-084: intercepto de administradores. Va antes del flujo de cliente
    // y sin rate-limit/pausa: es uso interno del panel operativo.
    if (!msg.key?.fromMe && body.trim() && (await esAdminBot(numeroRealParaIgnorar || remoteJid))) {
      console.log(`[entry] 🛡️ Mensaje de administrador: ${numeroRealParaIgnorar || remoteJid}`)
      encolarPorCliente(remoteJid, () => procesarMensajeAdmin(remoteJid, body))
      return
    }

    // Auto-aprendizaje LID: si el chat viene por LID pero el mensaje trae
    // remitente real (senderPn), se registra el mapeo y se fusiona la fila
    // legacy para que dashboard y bot compartan la conversación canónica.
    // Fire-and-forget: jamás bloquea ni altera el flujo del mensaje.
    if (remoteJid.endsWith('@lid')) {
      const dReal = String(numeroRealParaIgnorar || '').replace(/\D/g, '')
      if (/^52\d{10,12}$/.test(dReal)) {
        const telCanon = `+${dReal}`
        registrarMapeoLid(remoteJid, telCanon, 'auto')
          .then(() => canonicalizarClienteLid(remoteJid, telCanon))
          .catch(() => {})
      }
    }

    if (msg.key?.fromMe) {
      const esMediaEquipo = msgType === 'image' || msgType === 'document'
      if (esMediaEquipo) marcarFotosDisponibles(remoteJid)
      if (body || esMediaEquipo) {
        // Si el chat LID tiene teléfono conocido, el eco se procesa con el
        // JID del teléfono para caer en la fila canónica (+teléfono) en vez
        // de partir el historial. Sin mapeo: comportamiento legacy.
        let jidEquipo = remoteJid
        if (remoteJid.endsWith('@lid')) {
          try {
            const mapeado = await telefonoPorLid(remoteJid)
            const d = String(mapeado ?? '').replace(/\D/g, '')
            if (/^52\d{10,12}$/.test(d)) jidEquipo = `${d}@s.whatsapp.net`
          } catch { /* legado: JID original */ }
        }
        encolarPorCliente(jidEquipo, () => procesarMensajeEquipo(jidEquipo, msgType, body))
      }
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
        const buffer = await conTimeout(
          descargarMedia(msg, msgType as 'image' | 'document'),
          TIMEOUT_DESCARGA_MS,
          'descarga imagen/documento'
        )
        if (buffer) {
          const msgConMedia = msg as any
          msgConMedia._mediaBuffer = mediaToBase64(buffer)
          msgConMedia._mediaMime = msgType === 'document'
            ? getContenidoMensaje(msg)?.documentMessage?.mimetype || 'application/octet-stream'
            : 'image/jpeg'
        }
        // Bandeja del dashboard: persistir al instante (no depende del flujo IA).
        // Reutiliza el buffer ya descargado arriba (sin segunda descarga).
        {
          const tel = (numeroRealParaIgnorar || jidANumero(remoteJid)).trim()
          const msgConMedia = msg as any
          if (tel && msgConMedia._mediaBuffer && msgConMedia._mediaMime) {
            const mimetype = String(msgConMedia._mediaMime)
            await persistirMediaEntrante(tel, {
              buffer: Buffer.from(String(msgConMedia._mediaBuffer), 'base64'),
              mimetype,
              tipo: mimetype.startsWith('image/') ? 'imagen' : 'documento',
              nombre: msgType === 'document'
                ? String(getContenidoMensaje(msg)?.documentMessage?.fileName || 'archivo')
                : undefined,
            }, body).catch(() => {})
          }
        }
        encolarMensajeAgrupado(clienteId, msg)
      } else if (msgType === 'audio') {
        // Notas de voz: se guardan y muestran al instante en el dashboard.
        // No entran al flujo de visión IA (solo imagen/PDF); acuse simple.
        // Si la descarga falla, se pide reenvío en vez de mentir el acuse.
        {
          const tel = (numeroRealParaIgnorar || jidANumero(remoteJid)).trim()
          const media = await conTimeout(descargarMediaConMime(msg), TIMEOUT_DESCARGA_MS, 'descarga audio')
          if (tel && media) {
            await persistirMediaEntrante(tel, media).catch(() => {})
            responderMensaje(msg, '🎤 ¡Recibí tu nota de voz! El equipo la va a escuchar en un momento 🌸').catch(() => {})
          } else {
            responderMensaje(msg, '🎤 No pude descargar tu nota de voz 🙏 ¿Me la reenvías porfa?').catch(() => {})
          }
        }
      } else {
        responderMensaje(msg, 'Por ahora solo puedo leer mensajes de *texto* 🌸. ¿Qué necesitas?').catch(() => {})
      }
      return
    }

    if (!body.trim()) return
    if (estaRateLimited(clienteId)) { avisarRateLimitUnaVez(msg, clienteId); return }

    verificarSiBotPausado().then(pausado => {
      if (pausado) {
        // Pausa global: se guarda para la bandeja (visible al instante) pero
        // no se encola al buffer de Flora (no hay respuesta). El buffer de
        // agrupamiento para chats activos queda intacto.
        if (!msg.key?.fromMe && msgType === 'chat' && body.trim()) {
          const tel = (numeroRealParaIgnorar || jidANumero(remoteJid)).trim()
          if (tel) agregarAlHistorial(tel, 'user', body.trim().slice(0, 1000)).catch(() => {})
        }
        console.log(`[entry] ⏸️ Pausado — ${clienteId} guardado sin responder`)
        return
      }
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
