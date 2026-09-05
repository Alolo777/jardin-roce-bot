import { eventBus } from '../events/event-bus'
import { EventType } from '../events/types'
import { supabaseAdmin } from '../../lib/supabase'
import type { VentaCerrada } from '../../lib/types'
import { obtenerHistorial, agregarAlHistorial, extraerTelefono, calcularHorasInactivo, obtenerUltimosMensajesEquipo } from '../conversation/conversation.service'
import { parseNombre, pareceNombreCliente, esNombrePlausible, parseSucursal, parseDireccion, extraerFecha, extraerHora } from '../parser'
import { getMensajeTexto, getMessageBody, getFechaActual, hasQuotedMsg, getQuotedText, ahoraCdmx, getContextoHorario, estaEnHorario, formatearFechaHoraMensaje } from './message-utils'
import { notificarEmpleadosWhatsApp, enviarFotoEmpleadosWhatsApp } from './notification.service'
import { obtenerNumeroReal } from './contact.service'
import { FRUSTRACION_NOTIFICADA, INTERES_COMPRA_NOTIFICADO, ENVIO_NOTIFICADO, FOTOS_NOTIFICADO, FOTOS_DISPONIBLES_RECIENTES, FOTOS_DISPONIBLES_TTL_MS, debeEnviarAlertaDedup, debeNotificarAtencionHumana, debeNotificarReclamacion, obtenerIntervencionHumanaReciente, RATE_AVISADOS, RATE_LIMIT_WINDOW_MS, extraerPrecioRespuesta, encolarFotoPendienteApertura } from './bot-state'
import { crearCaso, obtenerCasoActivo, actualizarActividad, detectarCambioTema, clasificarTipoCaso } from '../casos/caso.service'
import { crearPedido, obtenerPedido, transitarDesdeFlujo, archivarPedido, sincronizarConCaso } from '../pedidos/pedido.service'
import {
  analizarIntencion,
  detectarFrustracion,
  detectarAtencionHumana,
  esSolicitudFotosDisponibles,
  clienteEligeFotoDisponible,
  esTextoComprobante,
  respuestaPideComprobante,
  detectarConfirmacionCorta,
  detectarEmpezarCero,
} from '../decision/decision.engine'
import { buildValidatedRulesSection } from '../openai/prompt.builder'

import { construirContextoPrompt } from '../openai/prompt.builder'
import { detectarCancelacion, detectarQueja, detectarEvento, detectarInteresCompra } from '../decision/intent-detector'
import { esHorarioAnticipado, HORARIO_APERTURA } from '../validators/horario.validator'
import { obtenerTextoCuenta } from '../validators/pago.validator'
import { validarSucursal, obtenerTextoConfirmacionSucursal } from '../validators/sucursal.validator'
import { buscarEnvio, pareceConsultaEnvio, detectarLinkMaps, formatearZonasParaPrompt } from '../validators/envio.validator'
import { validarRespuestaIA, sanitizarRespuestaIA } from '../validators/response.validator'
import { evaluarCancelacion } from '../validators/cancelacion.validator'
import { evaluarQueja } from '../validators/queja.validator'
import { getAIResponse, clasificarImagenVenta, revisarRespuestaFlora } from '../../lib/ai'
import { guardarMediaChat, guardarMediaEquipoChat } from '../novedades/media-chat.repository'
import type { IntencionMedia } from '../novedades/media-chat.repository'
import { logger } from '../../lib/logger.service'
import { PedidoActual, EstadoPedido, OrigenMensaje } from '../models/types'

export interface MsgHandlerDeps {
  pedidoActual: (clienteId: string) => PedidoActual
  responderMensaje: (msg: any, texto: string) => Promise<any>
  ventaCerradaHandler: (clienteId: string, venta: VentaCerrada, telefono: string) => Promise<void>
  pedidoApartadoHandler: (clienteId: string, venta: VentaCerrada, telefono: string, metodoPago: string) => Promise<void>
  ventaDesdeEstado: (clienteId: string, fallback?: VentaCerrada) => VentaCerrada | null
  persistirPedido: (clienteId: string, telefono: string | null, estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado', ultimoMensaje?: string) => Promise<void>
  ventaListaParaCerrar: (clienteId: string) => boolean
  ventaListaParaPagoTransferencia: (clienteId: string) => boolean
  pedidoEstaCerrado: (clienteId: string) => boolean
  tieneArregloVerificado: (clienteId: string) => boolean
  tienePrecioConfirmado: (clienteId: string) => boolean
  tieneNombreValido: (clienteId: string) => boolean
  resetearPedidoActivo: (clienteId: string) => void
  marcarFotosDisponibles: (clienteId: string) => void
  hayFotosDisponiblesRecientes: (clienteId: string) => boolean
  totalExtrasPedido: (clienteId: string) => number
  extrasPedidoTexto: (clienteId: string) => string | null
  totalDashboardPedido: (clienteId: string, fallback: string) => string
  precioArregloTexto: (clienteId: string) => string
  MEDIA_POR_CLIENTE: Map<string, { base64: string; mimetype: string; caption: string }[]>
  apartadoSucursalListo: (clienteId: string) => boolean
}

const MAX_LONGITUD_MENSAJE = 1000
function extraerFechaHoraPedido(texto: string): { fecha?: string; hora?: string } {
  return { fecha: extraerFecha(texto) ?? undefined, hora: extraerHora(texto) ?? undefined }
}

function contextoEsperaComprobante(clienteId: string, textoTurno: string, historialRecienteTexto: string, deps: Pick<MsgHandlerDeps, 'pedidoActual'>): boolean {
  const pedido = deps.pedidoActual(clienteId)
  const contextoPago = pedido.metodoPago === 'transferencia' || pedido.estadoFlujo === 'esperando_pago' || /comprobante|pago\s+por\s+transferencia|mandame\s+(?:tu\s+)?comprobante|m[aá]ndame\s+(?:tu\s+)?comprobante|cuenta\s*(?:bbva)?\s*:?\s*4152|bbva|devi\s+am[eé]rica|pon\s+tu\s+nombre\s+en\s+concepto|cuando\s+est[eé]\s+listo/i.test(historialRecienteTexto)
  const confirmaTurno = /\b(listo|claro|va|vale|ya\s+est[aá]|hecho|te\s+lo\s+mand[oó]|lo\s+mand[oó])\b/i.test(textoTurno)
  const imagenSinTexto = !textoTurno.trim() || /^\[Imagen sin texto\]$/i.test(textoTurno.trim())
  return Boolean(contextoPago && (imagenSinTexto || confirmaTurno || esTextoComprobante(textoTurno)))
}

function sincronizarPedidoConCaso(clienteId: string, telefono: string, cambioTema: boolean, deps: Pick<MsgHandlerDeps, 'pedidoActual' | 'resetearPedidoActivo'>, casoId?: string): void {
  if (cambioTema || !obtenerPedido(clienteId)) {
    deps.resetearPedidoActivo(clienteId)
    const nuevo = crearPedido(clienteId, telefono)
    if (casoId && nuevo.id) sincronizarConCaso(nuevo, casoId)
  } else if (casoId) {
    const existente = obtenerPedido(clienteId)
    if (existente && !existente.casoId) sincronizarConCaso(existente, casoId)
  }
}

const KW_CATALOGO = [
  'catalogo', 'catálogo', 'drive', 'ver mas', 'ver más',
  'mas opciones', 'más opciones', 'otros ramos', 'que mas tienen', 'que más tienen',
]

const KW_COTIZADOR = [
  'cotizar', 'cotizacion', 'cotización', 'cuanto cuesta', 'cuánto cuesta',
  'cuanto vale', 'cuánto vale', 'precio de un ramo', 'hacer un ramo',
  'ramo personalizado', 'armar un ramo', 'pedido especial',
  'tienen web', 'tienes web', 'pagina', 'página', 'diseñar',
]

function detectarIntencion(texto: string, clienteId: string, deps: Pick<MsgHandlerDeps, 'pedidoEstaCerrado'>): 'catalogo' | 'cotizador' | 'normal' {
  if (/foto.*(entrega|entreguen|entregado|repartidor)|comprobante.*entrega|cuando.*entreguen/.test(texto.toLowerCase())) return 'normal'
  if (deps.pedidoEstaCerrado(clienteId)) return 'normal'

  const decision = analizarIntencion({ texto, horasInactivo: 0 })
  return decision.intencionCatalogo
}

function limpiarRespuestaIA(texto: string): string {
  return texto
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2')
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')
    .replace(/https:\/\/[^\s]+supabase\.co\/storage\/[^\s]*/g, '')
    .replace(/\[(?:CLIENTE|CONTEXTO|INSTRUCCION|ARREGLO|TODOS|EXPRESIÓN|POSIBLE)[^\]]*\]\n?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const GOOGLE_MAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s]*/i

function limpiarDireccionCliente(texto: string): string {
  // BUG-007 (opcion A): si es un link de Maps, se CONSERVA como direccion
  // (el short-link no trae calle legible; luego se pedira confirmar calle).
  if (GOOGLE_MAPS_REGEX.test(texto)) {
    return texto.trim().slice(0, 200).replace(/\s+/g, ' ')
  }
  return String(texto || '')
    .replace(GOOGLE_MAPS_REGEX, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^,|,$/g, '')
    .trim()
}






export function esTextoReferenciaOCotizacion(texto: string): boolean {
  return /\b(cotiz|cotizar|cotizaci[oó]n|cu[aá]nto|cuanto|precio|saldr[ií]a|costar[ií]a|ramo\s+as[ií]|como\s+(este|esta|la\s+foto|imagen)|referencia|foto\s+de\s+referencia|imagen\s+de\s+referencia|hacer\s+un\s+ramo|podr[ií]an\s+hacer|hortensias?|lilis?|rosas?|flores?\s+de\s+la\s+imagen)\b/i.test(texto)
}

function extraerNombrePedido(texto: string): string | null {
  return parseNombre(texto)
}

const ESTADOS_BLOQUEADOS_FLUJO: ReadonlySet<EstadoPedido> = new Set([
  EstadoPedido.APARTADO,
  EstadoPedido.EN_PRODUCCION,
  EstadoPedido.LISTO,
  EstadoPedido.ENTREGADO,
  EstadoPedido.ARCHIVADO,
  EstadoPedido.CANCELADO,
  EstadoPedido.QUEJA,
  EstadoPedido.POSTVENTA,
])

function transitarDesdeFlujoSeguro(clienteId: string, flujo: string, pedidoActual?: PedidoActual): boolean {
  const pedido = pedidoActual ?? obtenerPedido(clienteId)
  if (pedido?.estado && ESTADOS_BLOQUEADOS_FLUJO.has(pedido.estado)) {
    console.warn(`[message-handler] transitarDesdeFlujo bloqueada (${flujo}) para pedido en estado ${pedido.estado} — ${clienteId}`)
    return false
  }
  return transitarDesdeFlujo(clienteId, flujo)
}

function aplicarDatosPedidoDesdeTexto(clienteId: string, texto: string, deps: Pick<MsgHandlerDeps, 'pedidoActual' | 'tieneArregloVerificado'>): void {
  if (!deps.tieneArregloVerificado(clienteId)) return
  const pedido = deps.pedidoActual(clienteId)
  const extras = detectarExtrasPedido(texto)
  agregarExtrasPedido(clienteId, extras, deps)

  const nombre = extraerNombrePedido(texto)
  if (nombre) pedido.nombre = nombre

  const lineas = texto.split('\n---\n').map(l => l.trim()).filter(Boolean)
  const posibleNombre = lineas.find(l => pareceNombreCliente(l))
  if (!pedido.nombre && posibleNombre) pedido.nombre = posibleNombre.replace(/\s+/g, ' ').slice(0, 80)

  const sucParsed = parseSucursal(texto)
  if ((sucParsed.confianza === 'alta' || sucParsed.confianza === 'media') && sucParsed.sucursal) {
    pedido.sucursal = sucParsed.sucursal
    pedido.sucursal_por_confirmar = sucParsed.confianza === 'media'
  }

  if (/\b(transferencia|transfer|comprobante|recibo|ticket|listo\s+ese\s+es\s+el\s+recibo|pago\s+con\s+transferencia)\b/i.test(texto)) {
    pedido.metodoPago = 'transferencia'
    pedido.estadoFlujo = 'esperando_pago'
    if (pedido.estado !== EstadoPedido.APARTADO) transitarDesdeFlujoSeguro(clienteId, 'esperando_pago')
  }

  if (pedido.nombre) {
    const op = obtenerPedido(clienteId)
    if (op) op.nombre = pedido.nombre
  }
}

export function createMessageHandler(deps: MsgHandlerDeps) {

  function faltaFechaHoraParaCerrar(clienteId: string): boolean {
    const pedido = deps.pedidoActual(clienteId)
    return !pedido.fechaEntrega || !pedido.horaEntrega
  }

  function formatearTotalConDesglose(clienteId: string): string {
    const pedido = deps.pedidoActual(clienteId)
    const subtotal = pedido.arreglo?.precio ?? pedido.precioPersonalizado ?? 0
    const extras = deps.totalExtrasPedido(clienteId)
    const envio = pedido.envio?.precio ?? 0
    const total = subtotal + extras + envio
    const desglose = [`ramo $${subtotal.toFixed(2)}`]
    if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
    if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
    return desglose.length > 1 ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})` : `$${total.toFixed(2)} MXN`
  }

  async function registrarReclamacion(telefono: string, tipo: 'cancelacion' | 'queja', descripcion: string, arregloReferencia?: string | null): Promise<void> {
    try {
      const { error } = await supabaseAdmin.from('reclamaciones').insert({
        cliente_telefono: telefono,
        tipo,
        descripcion: descripcion.slice(0, 1000),
        arreglo_referencia: arregloReferencia ?? null,
        estado: 'pendiente',
      })
      if (error) throw error
    } catch (err) {
      console.warn('[reclamaciones] No se pudo registrar:', err)
    }
  }

  async function registrarZonaAmbigua(texto: string, telefono: string | null, candidatos: unknown[]): Promise<void> {
    try {
      await supabaseAdmin.from('zonas_envio_ambiguas').insert({
        texto_cliente: texto,
        telefono,
        candidatos,
      })
    } catch (err) {
      console.warn('[zonas_envio_ambiguas] No se pudo registrar:', err)
    }
  }

  async function pedirFechaHoraSiFalta(msg: any, telefono: string, clienteId: string): Promise<boolean> {
    if (!faltaFechaHoraParaCerrar(clienteId)) return false
    const pedido = deps.pedidoActual(clienteId)
    pedido.estadoFlujo = 'esperando_fecha_hora'
    if (pedido.estado !== EstadoPedido.APARTADO) transitarDesdeFlujoSeguro(clienteId, 'esperando_fecha_hora')
    await deps.persistirPedido(clienteId, telefono, 'apartado', 'Falta fecha/hora antes de cerrar')
    const pregunta = '¿Para qué fecha y hora lo necesitas? 🌷'
    await deps.responderMensaje(msg, pregunta)
    await agregarAlHistorial(telefono, 'assistant', pregunta, OrigenMensaje.FLORA)
    return true
  }

  async function procesarMediaAcumulado(
    clienteId: string,
    telefono: string,
    textoCliente: string,
    sock: any,
    pushName?: string,
    intencion?: string,
    contextoExtra?: string
  ): Promise<'referencia' | 'comprobante' | 'imagen' | null> {
    const mediaAcumulado = deps.MEDIA_POR_CLIENTE.get(clienteId)
    if (!mediaAcumulado || mediaAcumulado.length === 0) return null

    deps.MEDIA_POR_CLIENTE.delete(clienteId)
    const historial = await obtenerHistorial(telefono)
    // DEC-085: guardar las últimas imágenes con intención de conversación
    // para que el admin y la IA sepan el contexto al consultar.
    const ultimaImagen = mediaAcumulado[mediaAcumulado.length - 1]
    guardarMediaChat(clienteId, telefono, mediaAcumulado.map(m => ({ base64: m.base64, mimetype: m.mimetype, caption: m.caption })), intencion as any, contextoExtra)
      .catch(err => console.warn('[media-chat] captura fallida:', err))
    // Solo se envía la ÚLTIMA imagen a visión IA para clasificar.
    // Si el cliente envió 3+ fotos en ráfaga, solo la última se analiza.
    const imagenesParaVision = [ultimaImagen]
    const historialRecienteTexto = historial.slice(-8).map(m => m.content).join(' ')
    const captionsTexto = mediaAcumulado.map(m => m.caption).filter(Boolean).join(' ')
    const textoTurno = `${textoCliente} ${captionsTexto}`.trim()
    const textoClasificacion = `${textoTurno} ${historialRecienteTexto}`

    const quiereCotizarTurno = esTextoReferenciaOCotizacion(textoTurno)
    const pagoEnTurno = esTextoComprobante(textoTurno)
    const pagoReciente = esTextoComprobante(textoClasificacion)
    const esperaComprobante = contextoEsperaComprobante(clienteId, textoTurno, historialRecienteTexto, { pedidoActual: deps.pedidoActual })
    let esComprobante = esperaComprobante || (!quiereCotizarTurno && (pagoEnTurno || pagoReciente))
    let esReferencia = !esComprobante && (quiereCotizarTurno || (!pagoEnTurno && !pagoReciente))

    const tieneImagen = mediaAcumulado.some(m => m.mimetype.startsWith('image/'))

    if (tieneImagen) {
      console.log(`[bot] 👁️ Enviando ÚLTIMA imagen (${mediaAcumulado.length} recibidas) a visión IA para ${telefono}...`)
      const pedido = deps.pedidoActual(clienteId)
      const contextoVision = [
        `estado_flujo: ${pedido.estadoFlujo ?? 'sin_pedido'}`,
        `metodo_pago: ${pedido.metodoPago ?? 'sin_confirmar'}`,
        `tiene_arreglo: ${deps.tieneArregloVerificado(clienteId) ? 'si' : 'no'}`,
        `texto_turno: ${textoTurno || 'sin texto'}`,
        `intencion: ${intencion ?? 'sin_definir'}`,
      ].join('\n')
      const vision = await clasificarImagenVenta(historial, contextoVision, imagenesParaVision, intencion as any)
      console.log(`[bot] 👁️ Visión clasifica ${telefono}: ${vision.tipo} (${vision.razon})`)
      if (vision.tipo === 'comprobante') {
        esComprobante = true
        esReferencia = false
      } else if (vision.tipo === 'referencia') {
        esComprobante = false
        esReferencia = true
      } else if (vision.tipo === 'otra') {
        esComprobante = false
        esReferencia = false
      }
    }

    const enHorario = estaEnHorario()

    for (const media of mediaAcumulado) {
const ultimoMedia = mediaAcumulado[mediaAcumulado.length - 1]
    if (ultimoMedia && tieneImagen) {
      // DEC-085/DEC-091: guarda fotos enviadas por el equipo al cliente
      // para que el admin sepa qué fotos se enviaron y en qué contexto.
      const tipoEquipo = esComprobante ? 'comprobante' : esReferencia ? 'referencia' : 'otra'
      guardarMediaEquipoChat(clienteId, telefono, [{ base64: ultimoMedia.base64, mimetype: ultimoMedia.mimetype, caption: ultimoMedia.caption }], intencion as any, contextoExtra)
        .catch(err => console.warn('[media-chat] guardado equipo fallido:', err))
    }

    if (esComprobante) {
        if (!enHorario) {
          encolarFotoPendienteApertura(clienteId, { telefono, tipo: 'comprobante', base64: media.base64, mimetype: media.mimetype, caption: media.caption, ts: Date.now() })
          continue
        }
        eventBus.emit(EventType.PHOTO_RECEIVED, {
          telefono,
          tipo: 'comprobante',
          base64: media.base64,
          mimetype: media.mimetype,
          caption: media.caption,
        })
        enviarFotoEmpleadosWhatsApp(sock, media.base64, `📸 *Comprobante de pago* — ${telefono}${media.caption ? `\n\n${media.caption}` : ''}\n\nVerifica el comprobante y confirma el pago.`, media.mimetype).catch(err => console.error('[bot] WhatsApp foto comprobante:', err))
        notificarEmpleadosWhatsApp(sock, `💰 *Comprobante de pago recibido:* ${telefono}\n\nRevisa la foto del comprobante y confirma el pago con el equipo.`).catch(err => console.error('[bot] WhatsApp notif comprobante:', err))
      } else if (esReferencia) {
        if (!enHorario) {
          encolarFotoPendienteApertura(clienteId, { telefono, tipo: 'referencia', base64: media.base64, mimetype: media.mimetype, caption: media.caption, ts: Date.now() })
          continue
        }
        eventBus.emit(EventType.PHOTO_RECEIVED, {
          telefono,
          tipo: 'referencia',
          base64: media.base64,
          mimetype: media.mimetype,
          caption: media.caption,
        })
        enviarFotoEmpleadosWhatsApp(sock, media.base64, `📷 Foto de referencia de ${telefono}${media.caption ? `\n\nCliente dice: ${media.caption}` : ''}`, media.mimetype).catch(err => console.error('[bot] WhatsApp foto referencia:', err))
        if (debeEnviarAlertaDedup(clienteId, 'foto-sent', media.caption || 'Foto de referencia', 30 * 60_000)) {
          eventBus.emit(EventType.PHOTO_SENT, { telefono, descripcion: media.caption || 'Foto de referencia' })
        }
      } else {
        if (!enHorario) {
          encolarFotoPendienteApertura(clienteId, { telefono, tipo: 'otra', base64: media.base64, mimetype: media.mimetype, caption: media.caption, ts: Date.now() })
          continue
        }
        eventBus.emit(EventType.PHOTO_RECEIVED, {
          telefono,
          tipo: 'otra',
          base64: media.base64,
          mimetype: media.mimetype,
          caption: media.caption,
        })
      }
    }

    if (esComprobante) {
      const pedido = deps.pedidoActual(clienteId)
      pedido.metodoPago = 'transferencia'
      pedido.estadoFlujo = 'pagado_transferencia'
      transitarDesdeFlujoSeguro(clienteId, 'pagado_transferencia')
      const venta = deps.ventaDesdeEstado(clienteId)
      if (venta && deps.ventaListaParaPagoTransferencia(clienteId)) {
        await deps.ventaCerradaHandler(clienteId, venta, telefono)
      } else {
        await deps.persistirPedido(clienteId, telefono, 'apartado', 'Comprobante recibido, faltan datos para cierre')
        if (debeEnviarAlertaDedup(clienteId, 'comprobante-pendiente', textoTurno || 'comprobante', 30 * 60_000)) {
          const pedido = deps.pedidoActual(clienteId)
          eventBus.emit(EventType.ORDER_CREATED, {
            orderId: pedido.id,
            telefono,
            cliente: pedido.nombre ?? 'Verificar en chat',
            producto: pedido.productoPersonalizado ?? 'Verificar en conversación',
            total: parseFloat(deps.totalDashboardPedido(clienteId, '0').replace(/[^0-9.]/g, '')) || 0,
            sucursal: pedido.direccion ?? pedido.sucursal ?? pedido.envio?.zona ?? 'Por confirmar',
            metodoPago: 'Transferencia',
            descripcion: 'comprobante-pendiente',
            precioArreglo: deps.tienePrecioConfirmado(clienteId) ? deps.precioArregloTexto(clienteId) : undefined,
            precioExtras: deps.extrasPedidoTexto(clienteId) ?? undefined,
          } as any)
        }
      }
      return 'comprobante'
    }

    if (esReferencia) {
      const descripcion = mediaAcumulado.map(m => m.caption).filter(Boolean).join(' | ') || 'Envió foto(s) de referencia'
      const pedido = deps.pedidoActual(clienteId)
      pedido.productoPersonalizado ||= descripcion === 'Envió foto(s) de referencia' ? 'Ramo personalizado con foto de referencia' : descripcion
      pedido.estadoFlujo = 'esperando_precio_equipo'
      transitarDesdeFlujoSeguro(clienteId, 'esperando_precio_equipo')
      pedido.fotoReferenciaBase64 = mediaAcumulado[0]?.base64
      pedido.fotoReferenciaMimetype = mediaAcumulado[0]?.mimetype
      pedido.fotoReferenciaCaption = descripcion
      pedido.fotoReferenciaRecibidaEn = new Date().toISOString()
      pedido.detallesEspeciales = descripcion
      await deps.persistirPedido(clienteId, telefono, 'cotizacion', descripcion)
      if (debeEnviarAlertaDedup(clienteId, 'cotizacion-foto', descripcion, 30 * 60_000)) {
        if (!enHorario) {
          encolarFotoPendienteApertura(clienteId, { telefono, tipo: 'cotizacion', caption: descripcion, ts: Date.now() })
        } else {
          eventBus.emit(EventType.COTIZACION_REQUESTED, { telefono, descripcion })
          eventBus.emit(EventType.CUSTOMER_WAITING, { telefono, descripcion: 'Cliente esperando cotización del equipo' })
          notificarEmpleadosWhatsApp(sock,
            `🌷 *Cliente necesita cotización:* ${telefono}\n\n${descripcion}\n\nRevisa la foto de referencia y cotízale por WhatsApp.`
          ).catch(err => console.error('[bot] WhatsApp empleados cotización:', err))
        }
      }
      return 'referencia'
    }

    if (debeEnviarAlertaDedup(clienteId, 'imagen-sin-contexto', 'imagen sin contexto', 20 * 60_000)) {
      eventBus.emit(EventType.HUMAN_REQUIRED, { telefono, cliente: pushName || '', descripcion: 'Envió imagen sin contexto claro', contexto: 'Imagen sin contexto' })
    }
    return 'imagen'
  }

  async function procesarMensaje(msg: any, sock: any): Promise<void> {
    const clienteId = msg.key?.remoteJid as string
    if (!clienteId) return
    const telefono = extraerTelefono(msg)
    let textoCliente = (getMensajeTexto(msg) || '').trim()

    if (!textoCliente) return
    if (textoCliente.length > MAX_LONGITUD_MENSAJE) textoCliente = textoCliente.slice(0, MAX_LONGITUD_MENSAJE)

    console.log(`[${new Date().toLocaleTimeString('es-MX')}] 📨 ${clienteId}: ${textoCliente.substring(0, 80)}`)

    const numeroRealPromise = obtenerNumeroReal(msg)
    const esFrustrado = detectarFrustracion(textoCliente)
    const esInteresCompra = detectarInteresCompra(textoCliente)

    try {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 300))

      await agregarAlHistorial(telefono, 'user', textoCliente, OrigenMensaje.CLIENTE)

      const pideEmpezarDesdeCero = /empecemos\s+desde\s+cero|desde\s+cero|borr[oó]n\s+y\s+cuenta\s+nueva|nuevo\s+pedido|otro\s+pedido|otro\s+ramo|es\s+aparte|aparte\s+ese|ya\s+hab[ií]a\s+finalizado|ya\s+se\s+finaliz[oó]|ese\s+ya\s+qued[oó]/i.test(textoCliente)
      if (pideEmpezarDesdeCero) deps.resetearPedidoActivo(clienteId)

      let casoActivo = obtenerCasoActivo(clienteId)
      const horasInactivo = calcularHorasInactivo(casoActivo?.ultimaActividad)
      const cambioTema = casoActivo ? detectarCambioTema(textoCliente, horasInactivo) : false

      const decision = analizarIntencion({
        texto: textoCliente,
        horasInactivo,
      })

      if (cambioTema) {
        casoActivo = crearCaso(clienteId, telefono, undefined, undefined, { decisionIntencion: decision.intencion })
      } else if (!casoActivo) {
        casoActivo = crearCaso(clienteId, telefono, undefined, undefined, { decisionIntencion: decision.intencion })
      }
      actualizarActividad(casoActivo)

      sincronizarPedidoConCaso(clienteId, telefono, cambioTema, { pedidoActual: deps.pedidoActual, resetearPedidoActivo: deps.resetearPedidoActivo }, casoActivo?.id)

      const fechaHoraDetectada = extraerFechaHoraPedido(textoCliente)
      let esHorarioAnticipadoFlag = false
      if ((fechaHoraDetectada.fecha || fechaHoraDetectada.hora) && deps.tieneArregloVerificado(clienteId)) {
        const pedido = deps.pedidoActual(clienteId)
        if (fechaHoraDetectada.fecha) pedido.fechaEntrega = fechaHoraDetectada.fecha
        if (fechaHoraDetectada.hora) pedido.horaEntrega = fechaHoraDetectada.hora
      }
      if (fechaHoraDetectada.hora && esHorarioAnticipado(fechaHoraDetectada.hora)) {
        esHorarioAnticipadoFlag = true
        const pedido = deps.pedidoActual(clienteId)
        pedido.estadoFlujo = 'esperando_fecha_hora'
        if (pedido.estado !== EstadoPedido.APARTADO) transitarDesdeFlujoSeguro(clienteId, 'esperando_fecha_hora')
        if (debeEnviarAlertaDedup(clienteId, 'horario-anticipado', fechaHoraDetectada.hora, 30 * 60_000)) {
          eventBus.emit(EventType.HUMAN_REQUIRED, {
            telefono: await numeroRealPromise,
            cliente: msg.pushName || '',
            prioridad: 'media',
            descripcion: `Cliente solicita entrega a las ${fechaHoraDetectada.hora} (antes de apertura ${HORARIO_APERTURA}:00). ¿Podemos?`,
            contexto: 'Horario anticipado',
          })
        }
      }

      const intencion = detectarIntencion(textoCliente, clienteId, { pedidoEstaCerrado: deps.pedidoEstaCerrado })
      const horario = getContextoHorario()
      const pedidoEngine = obtenerPedido(clienteId)
      const contextoPrompt = construirContextoPrompt({
        decision,
        caso: casoActivo,
        pedido: pedidoEngine,
        textoCliente,
        horaActual: ahoraCdmx().etiqueta12,
        fechaActual: getFechaActual(),
      })
      let contextoExtra = `${contextoPrompt}${horario}`

      if (pideEmpezarDesdeCero) {
        contextoExtra +=
          `\n\n[CLIENTE QUIERE EMPEZAR DESDE CERO] ` +
          `El pedido anterior ya no debe mezclarse con este. Usa SOLO la última solicitud del cliente para el pedido nuevo. No reutilices flores, precio, sucursal, pago ni nombre del pedido anterior.`
      }

      if (esHorarioAnticipadoFlag) {
        contextoExtra +=
          `\n\n[HORARIO ANTICIPADO] El cliente pide entrega a las ${fechaHoraDetectada.hora}, antes de las ${HORARIO_APERTURA}:00 (nuestra apertura). ` +
          `INSTRUCCIÓN: NO confirmes ni rechaces el horario. Responde exactamente: "Entendido, consulto con el equipo si podemos tenerlo listo a las ${fechaHoraDetectada.hora} y te confirmo 🌷"`
      }

      if (textoCliente.includes('\n---\n')) {
        const partes = textoCliente.split('\n---\n').filter(Boolean)
        contextoExtra +=
          `\n\n[CLIENTE ENVIÓ VARIOS MENSAJES SEGUIDOS] El cliente escribió ${partes.length} mensajes ` +
          `en poco tiempo. Léelos TODOS antes de responder para entender el contexto completo. ` +
          `Responde considerando el último mensaje como lo más reciente, pero usa los anteriores como contexto.`
      }

      let textoCitado = ''
      if (hasQuotedMsg(msg)) {
        textoCitado = getQuotedText(msg)
      }

      const historialCompleto = await obtenerHistorial(telefono)
      const historialTexto = historialCompleto.map(m => m.content).join('\n').toLowerCase()

      const ultimoAssistant = [...historialCompleto].reverse().find(m => m.role === 'assistant')
      const equipoRespondio = ultimoAssistant && (
        ultimoAssistant.origen === OrigenMensaje.EQUIPO ||
        ultimoAssistant.content.startsWith('[Agente:')
      )
      if (equipoRespondio) {
        const textoAgente = ultimoAssistant.content.replace(/^\[Agente:\s*|\]$/g, '').trim()
        contextoExtra +=
          `\n\n[EL EQUIPO HUMANO RESPONDIÓ] El equipo ya habló con el cliente. ` +
          `Su último mensaje fue: "${textoAgente.replace(/"/g, "'")}". ` +
          `Flora puede continuar la conversación con normalidad, respetando lo dicho por el equipo. ` +
          `Si el equipo dio un precio, úsalo como confirmado. No lo contradigas ni preguntes lo mismo.`
      }

      const mensajesEquipo = await obtenerUltimosMensajesEquipo(telefono, 24, 3)

      const intervencionHumana = obtenerIntervencionHumanaReciente(clienteId)
      if (intervencionHumana && !equipoRespondio && mensajesEquipo.length === 0) {
        const conPrecio = intervencionHumana.precio
          ? ` El equipo indicó un precio: $${intervencionHumana.precio}. Úsalo como precio confirmado por el equipo.`
          : ''
        contextoExtra +=
          `\n\n[INTERVENCION HUMANA RECIENTE] ` +
          `El equipo respondió hace ${Math.round(intervencionHumana.haceMs / 1000)} segundos: "${intervencionHumana.texto.replace(/"/g, "'")}". ` +
          `Flora NO debe ignorar esa respuesta.${conPrecio} No digas que falta confirmar ese mismo precio.`
      }

      if (!equipoRespondio && mensajesEquipo.length > 0) {
        const lineas = mensajesEquipo.map(m => {
          const textoAgente = m.contenido.replace(/^\[Agente:\s*|\]$/g, '').trim()
          const precio = extraerPrecioRespuesta(textoAgente)
          const hora = m.creadoEn ? formatearFechaHoraMensaje(m.creadoEn) : ''
          return `- [${hora}]${precio ? ` $${precio} (precio confirmado por el equipo):` : ''} "${textoAgente.replace(/"/g, "'")}"`
        })
        contextoExtra +=
          `\n\n[RESPUESTAS VERIFICADAS DEL EQUIPO] ` +
          `Mensajes recientes escritos por una persona del equipo humano (100% verificados, persistidos en el sistema):\n` +
          `${lineas.join('\n')}\n` +
          `NO los contradigas ni preguntes lo mismo que ya respondió el equipo. ` +
          `Si el equipo dio un precio, úsalo como confirmado y no lo pidas de nuevo.`
      }

      // Respaldo para bot apagado días: si las capas de 24h no trajeron nada,
      // se busca hasta 7 días atrás en Supabase (misma clasificación
      // origen='equipo' o prefijo [Agente:]). Cubre el caso donde el equipo
      // atendió por teléfono con el bot apagado y el pedido en memoria está
      // vacío: el precio/dirección confirmados solo viven en el historial.
      if (!equipoRespondio && mensajesEquipo.length === 0) {
        const respaldoEquipo = await obtenerUltimosMensajesEquipo(telefono, 7 * 24, 10).catch(() => [])
        if (respaldoEquipo.length > 0) {
          const lineas = respaldoEquipo.map(m => {
            const textoAgente = m.contenido.replace(/^\[Agente:\s*|\]$/g, '').trim()
            const precio = extraerPrecioRespuesta(textoAgente)
            const hora = m.creadoEn ? formatearFechaHoraMensaje(m.creadoEn) : ''
            return `- [${hora}]${precio ? ` $${precio} (precio confirmado por el equipo):` : ''} "${textoAgente.replace(/"/g, "'")}"`
          })
          contextoExtra +=
            `\n\n[HISTORIAL VERIFICADO DEL EQUIPO — DÍAS PREVIOS] ` +
            `El equipo humano atendió este chat en días anteriores (el bot estuvo apagado, por eso el pedido actual está vacío). ` +
            `Estos mensajes son respuestas ya confirmadas, NO requieren reconfirmación:\n` +
            `${lineas.join('\n')}\n` +
            `INSTRUCCIÓN: NO pidas de nuevo la dirección, el envío, la cotización ni el precio que el equipo ya dio. ` +
            `Úsalos como datos confirmados y continúa desde ahí. Si falta algo que el equipo NO confirmó, pregunta solo eso.`
        }
      }

      contextoExtra +=
        `\n\n[DECISION] Intención: ${decision.intencion} | Prioridad: ${decision.prioridad} | ` +
        `Requiere humano: ${decision.requiereHumano} | Cambio de tema: ${decision.esCambioTema}`
      if (decision.contextoAdicional) {
        contextoExtra += ` | ${decision.contextoAdicional}`
      }

      if (decision.requiereHumano && debeEnviarAlertaDedup(clienteId, `humano-${decision.intencion}`, textoCliente, 20 * 60_000)) {
        const telefonoReal = await numeroRealPromise
        eventBus.emit(EventType.HUMAN_REQUIRED, {
          telefono: telefonoReal,
          cliente: msg.pushName || '',
          descripcion: textoCliente.substring(0, 300),
          contexto: `Intención: ${decision.intencion} | Prioridad: ${decision.prioridad}`,
        })
      }

      if ((decision.prioridad === 'alta' || decision.prioridad === 'critica') && debeEnviarAlertaDedup(clienteId, `ia-whatsapp-${decision.intencion}`, textoCliente, 20 * 60_000)) {
        const telefonoReal = await numeroRealPromise
        notificarEmpleadosWhatsApp(sock,
          `⚠️ *Alerta ${decision.prioridad.toUpperCase()} (${decision.intencion}):* ${telefonoReal}\n\n${textoCliente.slice(0, 500)}`
        ).catch(err => console.error('[bot] WhatsApp alerta IA:', err))
      }
      const pideFotosDisponibles = esSolicitudFotosDisponibles(textoCliente) &&
        !(/\b(pague|pag[uú]e|comprobante|transfer|ya\s*envi[eé])\b/i.test(textoCliente))
      if (pideFotosDisponibles) {
        deps.resetearPedidoActivo(clienteId)
        deps.marcarFotosDisponibles(clienteId)
        contextoExtra +=
          `\n\n[CLIENTE INICIA NUEVA SELECCION CON FOTOS DISPONIBLES] ` +
          `El cliente esta dejando atras cualquier cotizacion inconclusa anterior. No reutilices productos, precios, envio, nombre ni pago anteriores. ` +
          `Pide al equipo que le mande fotos disponibles y espera a que el cliente elija una foto nueva.`
      }

      const pedidoPreSeleccion = deps.pedidoActual(clienteId)
      const yaPreciadoPorEquipo = (pedidoPreSeleccion.precioConfirmadoPor === 'equipo' || pedidoPreSeleccion.precioConfirmadoPor === 'manual') && pedidoPreSeleccion.precioPersonalizado
      const seleccionaFotoDisponible = !pideFotosDisponibles && !yaPreciadoPorEquipo && deps.hayFotosDisponiblesRecientes(clienteId) && clienteEligeFotoDisponible(textoCliente)
      if (seleccionaFotoDisponible) {
        deps.resetearPedidoActivo(clienteId)
        FOTOS_DISPONIBLES_RECIENTES.delete(clienteId)
        const pedido = deps.pedidoActual(clienteId)
        pedido.productoPersonalizado = 'Ramo elegido de fotos disponibles'
        pedido.detallesEspeciales = 'Cliente eligio un ramo de las fotos disponibles enviadas por el equipo'
        pedido.estadoFlujo = 'esperando_precio_equipo'
        transitarDesdeFlujoSeguro(clienteId, 'esperando_precio_equipo')
        contextoExtra +=
          `\n\n[CLIENTE ELIGIO UNA FOTO DISPONIBLE RECIENTE] ` +
          `Es un pedido nuevo basado en fotos que envio el equipo. NO uses precios de cotizaciones anteriores. ` +
          `Si el cliente pregunta precio, di que lo confirmas con el equipo; no inventes ni reutilices $400, $600 u otro precio viejo.`
      }

      const mediaPendiente = deps.MEDIA_POR_CLIENTE.get(clienteId)
      if (mediaPendiente && mediaPendiente.length > 0) {
        contextoExtra +=
          `\n\n[CLIENTE ENVIO ${mediaPendiente.length} IMAGEN(ES) EN ESTE TURNO] ` +
          `El sistema ya recibio la foto de referencia/comprobante y la enviara al equipo. ` +
          `NO le pidas al cliente que la reenvie. Si pide cotizacion de un ramo como la foto, responde que ya recibiste la referencia y que el equipo la revisara para cotizarle.`
      }
      const motivoAtencionHumana = detectarAtencionHumana(textoCliente) || (decision.requiereHumano ? 'Cliente requiere atención humana' : null)
      if (motivoAtencionHumana) {
        contextoExtra +=
          `\n\n[ATENCION HUMANA REQUERIDA: ${motivoAtencionHumana}] ` +
          `INSTRUCCION: Responde breve y amable. No inventes datos de sucursal, fotos del local, estado de pedidos ni conversaciones de Instagram. ` +
          `Di que lo reportas al equipo para que puedan apoyarle. El sistema notificará al administrador.`
      }
      const confirmaCorto = /^(ok|okay|okey|oki|okis|vale|va|dale|s[ií]|si|perfecto|de acuerdo|esta bien|está bien)$/i.test(textoCliente.trim())
      if (confirmaCorto && /env[ií]o a esa zona cuesta|costo.*env[ií]o|cuesta \$/.test(historialTexto)) {
        contextoExtra +=
          `\n\n[CLIENTE ACEPTÓ EL COSTO DE ENVÍO] ` +
          `INSTRUCCION: Para entrega a domicilio, pide el nombre para apartarlo y comparte la cuenta (${obtenerTextoCuenta()}). ` +
          `NO ofrezcas efectivo/tarjeta al recoger porque el cliente pidió envío. ` +
          `Pregunta una sola cosa si falta: "¿A qué nombre lo aparto?".`
      }

      if (historialCompleto.length === 0) {
        const saludos = [
          'PRESENTATE así: "¡Hola! Soy Flora 🌸, la asistente de Jardín RoCe. ¿En qué te puedo ayudar hoy?"',
          'PRESENTATE así: "Holis 🌷 Soy Flora, tu asistente floral. ¿En qué te ayudo?"',
          'PRESENTATE así: "¡Buen día! Soy Flora 🌸, de Jardín RoCe. Dime, ¿qué se te ofrece?"',
          'PRESENTATE así: "Holiwis ✨ Soy Flora. ¿Estás buscando algún regalo floral? Cuéntame"',
          'PRESENTATE así: "¡Hola! Qué gusto verte por aquí 🌷 Soy Flora. ¿Buscas algo en especial?"',
        ]
        contextoExtra += `\n\n${saludos[Math.floor(Math.random() * saludos.length)]}` +
          '\nMáximo 2 líneas. NUNCA te presentes de nuevo si ya hay conversación.'
      }

      if (intencion === 'catalogo') {
        contextoExtra +=
          `\n\nINSTRUCCION: Envía DIRECTAMENTE: ` +
          `https://drive.google.com/drive/folders/1s7Hs5JKBSezcqVznKwl6TT866UqRCB4N Máximo 2 líneas.`
      }

      if (intencion === 'cotizador') {
        contextoExtra +=
          `\n\nINSTRUCCION: El cliente quiere cotizar un arreglo. Pídele amablemente una FOTO de referencia o que describa qué busca (flores, tamaño, ocasión). ` +
          `El sistema recibe la foto y el equipo la cotiza. Si describe con flores sueltas y hay precios referenciales en las reglas, puedes orientar el costo; si no, di que el equipo confirma el precio exacto. Máximo 3 líneas.`
      }

      const pareceEnvio = pareceConsultaEnvio(textoCliente)
      const clienteDaDir = parseDireccion(textoCliente).confianza !== 'ninguna'

      if (pareceEnvio) {
        if ((clienteDaDir || detectarLinkMaps(textoCliente)) && deps.tieneArregloVerificado(clienteId)) {
          const pedido = deps.pedidoActual(clienteId)
          pedido.direccion = limpiarDireccionCliente(textoCliente)
          pedido.esperandoPrecioEnvio = true
        }
        let instruccionEnvio =
          `\n\n[CLIENTE PREGUNTA POR ENVÍO] El cliente quiere saber sobre envío a domicilio. ` +
          `INSTRUCCION: Responde que el costo exacto de envío depende de la ubicación, ` +
          `y que una compañera del equipo le confirmará el precio exacto. ` +
          `Menciona que el equipo le contactará pronto. Máximo 3 líneas.`
        // BUG-007 (opcion A): si la direccion es un link de Maps, se guardo el
        // link pero NO trae calle legible; pedir que confirme la calle en texto.
        if (detectarLinkMaps(textoCliente)) {
          instruccionEnvio +=
            ` El cliente envió un link de Google Maps como ubicación; ` +
            `GUARDA el link como su dirección, pero PIDE que confirme la calle y número en texto ` +
            `para poder registrarla bien. No repitas el link como si fuera la calle.`
        }
        contextoExtra += instruccionEnvio
      }

      const resultadoEnvio = pareceEnvio ? await buscarEnvio(textoCliente).catch(() => null) : null

      const envioCooldown = ENVIO_NOTIFICADO.get(clienteId) ?? 0
      const puedeNotificarEnvio = Date.now() - envioCooldown > 30 * 60_000

      if (resultadoEnvio && !('ambiguo' in resultadoEnvio)) {
        const telefonoReal = await numeroRealPromise
        console.log(`[bot] 📬 Envío match: ${resultadoEnvio.zona} — $${resultadoEnvio.precio}`)
        if (puedeNotificarEnvio) {
          ENVIO_NOTIFICADO.set(clienteId, Date.now())
          notificarEmpleadosWhatsApp(sock,
            `🚚 *Cliente necesita cotización de envío:* ${telefonoReal}\n\nZona detectada: ${resultadoEnvio.zona} — $${resultadoEnvio.precio}\n\nPor favor confírmale el precio exacto de envío.`
          ).catch(err => console.error('[bot] WhatsApp empleados envío:', err))
        }
      } else if (resultadoEnvio && 'ambiguo' in resultadoEnvio && resultadoEnvio.ambiguo) {
        const telefonoReal = await numeroRealPromise
        registrarZonaAmbigua(textoCliente, telefonoReal, resultadoEnvio.candidatos).catch(() => {})
        if (debeEnviarAlertaDedup(clienteId, 'zona-ambigua', textoCliente, 30 * 60_000)) {
          eventBus.emit(EventType.ZONA_AMBIGUA, {
            telefono: telefonoReal,
            descripcion: textoCliente,
            candidatos: resultadoEnvio.candidatos,
          })
        }
        if (puedeNotificarEnvio) {
          ENVIO_NOTIFICADO.set(clienteId, Date.now())
          notificarEmpleadosWhatsApp(sock,
            `🚚 *Cliente necesita cotización de envío:* ${telefonoReal}\n\nUbicación: ${textoCliente.slice(0, 100)}\n\nPor favor confírmale el precio exacto de envío.`
          ).catch(err => console.error('[bot] WhatsApp empleados envío:', err))
          eventBus.emit(EventType.ENVIO_REQUESTED, { telefono: telefonoReal, descripcion: textoCliente })
        }
      } else if (pareceEnvio && !resultadoEnvio) {
        const telefonoReal = await numeroRealPromise
        if (puedeNotificarEnvio) {
          ENVIO_NOTIFICADO.set(clienteId, Date.now())
          notificarEmpleadosWhatsApp(sock,
            `🚚 *Cliente necesita cotización de envío:* ${telefonoReal}\n\nUbicación: ${textoCliente.slice(0, 100)}\n\nPor favor confírmale el precio exacto de envío.`
          ).catch(err => console.error('[bot] WhatsApp empleados envío:', err))
          eventBus.emit(EventType.ENVIO_REQUESTED, { telefono: telefonoReal, descripcion: textoCliente })
        }
      }

      if (hasQuotedMsg(msg) && textoCitado) {
        contextoExtra +=
          `\n\n[CLIENTE RESPONDIÓ AL MENSAJE: "${textoCitado.replace(/"/g, "'")}"]` +
          `\nINSTRUCCION: El usuario respondió específicamente a ese mensaje. Úsalo para entender a qué se refiere.`
      }

      const evalCancel = evaluarCancelacion(textoCliente)
      if (evalCancel.detectada) {
        contextoExtra += `\n\n[CLIENTE QUIERE CANCELAR UN PEDIDO]\n${evalCancel.instruccion}`
        if (debeNotificarReclamacion(clienteId, 'cancelacion')) {
          const telefonoReal = await numeroRealPromise
          const referencia = deps.pedidoActual(clienteId).arreglo?.nombre ?? null
          eventBus.emit(EventType.CANCELACION_REQUESTED, { telefono: telefonoReal, descripcion: textoCliente.substring(0, 300) })
          registrarReclamacion(telefonoReal, 'cancelacion', textoCliente, referencia).catch(() => {})
          deps.persistirPedido(clienteId, telefonoReal, 'cancelado', textoCliente).catch(() => {})
        }
      }

      const evalQueja = evaluarQueja(textoCliente)
      if (evalQueja.detectada) {
        contextoExtra += `\n\n[CLIENTE TIENE UNA QUEJA O RECLAMO]\n${evalQueja.instruccion}`
        if (debeNotificarReclamacion(clienteId, 'queja')) {
          const telefonoReal = await numeroRealPromise
          const referencia = deps.pedidoActual(clienteId).arreglo?.nombre ?? null
          eventBus.emit(EventType.CUSTOMER_ANGRY, { telefono: telefonoReal, descripcion: textoCliente.substring(0, 300) })
          registrarReclamacion(telefonoReal, 'queja', textoCliente, referencia).catch(() => {})
        }
      }

      const evento = detectarEvento(textoCliente)
      if (evento) {
        const contextoEvento: Record<string, string> = {
          'boda': 'Sugiere ramos de novia elegantes, centros de mesa, arreglos para ceremonia.',
          'xv años': 'Sugiere ramos y arreglos juveniles, colores vibrantes, para quinceañera.',
          'funeral': 'Sé sensible y respetuosa. Sugiere coronas fúnebres, ramos de luto, arreglos blancos.',
          'aniversario': 'Sugiere ramos románticos con rosas o flores favoritas.',
          'graduación': 'Sugiere ramos alegres y coloridos, girasoles, arreglos para celebrar.',
        }
        const sugerencia = Object.entries(contextoEvento).find(([k]) => evento.includes(k))?.[1] || ''
        contextoExtra += `\n\n[EVENTO: ${evento.toUpperCase()}] ${sugerencia}`
      }

      if (esFrustrado) {
        const ahoraFrustracion = FRUSTRACION_NOTIFICADA.get(clienteId) ?? 0
        if (Date.now() - ahoraFrustracion > 30 * 60_000) {
          FRUSTRACION_NOTIFICADA.set(clienteId, Date.now())
          const telefonoReal = await numeroRealPromise
          eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: telefonoReal, prioridad: 'critica', descripcion: textoCliente.substring(0, 200) })
          eventBus.emit(EventType.CUSTOMER_WAITING, { telefono: telefonoReal, descripcion: 'Cliente frustrado esperando atención humana' })
        }
      }

      if (esInteresCompra) {
        const ahoraInteres = INTERES_COMPRA_NOTIFICADO.get(clienteId) ?? 0
        if (Date.now() - ahoraInteres > 30 * 60_000) {
          INTERES_COMPRA_NOTIFICADO.set(clienteId, Date.now())
          const telefonoReal = await numeroRealPromise
          const pedidoInteres = deps.pedidoActual(clienteId)
          const productoInteres = pedidoInteres?.productoPersonalizado
            || pedidoInteres?.arreglo
            || (deps.tieneArregloVerificado(clienteId) ? 'arreglo en selección' : 'sin arreglo definido')
          const descripcionInteres =
            `Interés de compra de ${msg.pushName || 'cliente'} (${telefonoReal}): ` +
            `${productoInteres} | "${textoCliente.substring(0, 180)}"`
          console.log(`[bot] 💰 Interés de compra de ${telefonoReal}: ${textoCliente.substring(0, 80)}`)
          eventBus.emit(EventType.COTIZACION_REQUESTED, {
            telefono: telefonoReal,
            cliente: msg.pushName || '',
            descripcion: descripcionInteres,
          })
          eventBus.emit(EventType.CUSTOMER_WAITING, { telefono: telefonoReal, descripcion: 'Cliente esperando cotización' })
        }
      }

      const pideFotos = pideFotosDisponibles && !deps.pedidoEstaCerrado(clienteId)
      if (pideFotos) {
        const ahoraFotos = FOTOS_NOTIFICADO.get(clienteId) ?? 0
        if (Date.now() - ahoraFotos > 60 * 60_000) {
          FOTOS_NOTIFICADO.set(clienteId, Date.now())
          const telefonoReal = await numeroRealPromise
          notificarEmpleadosWhatsApp(sock,
            `📸 *Cliente pide fotos de arreglos:* ${telefonoReal}\n\nContáctalo directamente por WhatsApp y envíale fotos de lo que tenemos disponible.`
          ).catch(err => console.error('[bot] WhatsApp empleados fotos:', err))
          eventBus.emit(EventType.PHOTO_REQUESTED, {
            telefono: telefonoReal,
            cliente: msg.pushName || '',
            descripcion: `Cliente ${msg.pushName || 'sin nombre'} (${telefonoReal}) pide ver fotos de arreglos disponibles`,
          })
          eventBus.emit(EventType.CUSTOMER_WAITING, { telefono: telefonoReal, descripcion: 'Cliente esperando fotos de arreglos' })
          console.log(`[bot] 📸 Alerta de fotos enviada para ${telefonoReal}`)
        }
      }

      aplicarDatosPedidoDesdeTexto(clienteId, textoCliente, { pedidoActual: deps.pedidoActual, tieneArregloVerificado: deps.tieneArregloVerificado })
      const extrasDetectados = deps.extrasPedidoTexto(clienteId)
      if (extrasDetectados) {
        contextoExtra +=
          `\n\n[EXTRAS DETECTADOS EN PEDIDO] ${extrasDetectados}. ` +
          `Estos costos NO son precio del ramo. Mantén ramo, extras, envío y total separados. ` +
          `Si aparece $10 por nota/tarjeta/dedicatoria, es solo extra; nunca digas que el ramo cuesta $10.`
      }

      let ventaCerrada = false
      const tipoMediaProcesada = await procesarMediaAcumulado(clienteId, await numeroRealPromise, textoCliente, sock, msg.pushName, decision.intencion, contextoExtra)
      const enHorarioMedia = estaEnHorario()
      const fueraDeHorarioTexto = enHorarioMedia ? '' : ' 🌷 La reviso a primera hora.'
      if (tipoMediaProcesada === 'referencia') {
        const respuesta = `Ya recibí la foto 🌷${fueraDeHorarioTexto}`
        await deps.responderMensaje(msg, respuesta)
        await agregarAlHistorial(telefono, 'assistant', respuesta, OrigenMensaje.FLORA)
        return
      }
      if (tipoMediaProcesada === 'imagen') {
        const respuesta = `Ya recibí tu imagen 🌷${fueraDeHorarioTexto}`
        await deps.responderMensaje(msg, respuesta)
        await agregarAlHistorial(telefono, 'assistant', respuesta, OrigenMensaje.FLORA)
        return
      }
      if (tipoMediaProcesada === 'comprobante') {
        const venta = deps.ventaDesdeEstado(clienteId)
        if (venta && deps.ventaListaParaCerrar(clienteId) && !deps.pedidoEstaCerrado(clienteId)) {
          const confirmacion = `¡Gracias, ${venta.cliente}! 🌸 Recibido, pedido apartado.`
          await deps.responderMensaje(msg, confirmacion)
          await agregarAlHistorial(telefono, 'assistant', confirmacion, OrigenMensaje.FLORA)
          await deps.ventaCerradaHandler(clienteId, venta, await numeroRealPromise)
          ventaCerrada = true
        } else {
          const respuesta = `Gracias, ya recibí tu comprobante 🌷 Lo registro${enHorarioMedia ? ' para que el equipo continúe con tu pedido.' : ' y el equipo lo valida a primera hora.'}`
          await deps.responderMensaje(msg, respuesta)
          await agregarAlHistorial(telefono, 'assistant', respuesta, OrigenMensaje.FLORA)
        }
        return
      }

      if (seleccionaFotoDisponible && !deps.tienePrecioConfirmado(clienteId)) {
        const telefonoReal = await numeroRealPromise
        await deps.persistirPedido(clienteId, telefonoReal, 'cotizacion', 'Cliente eligio foto disponible, falta precio del equipo')
        notificarEmpleadosWhatsApp(sock,
          `🌷 *Cliente eligió un ramo de las fotos disponibles:* ${telefonoReal}\n\n${textoCliente.slice(0, 300)}\n\nConfirma el precio real del ramo antes de continuar.`
        ).catch(err => console.error('[bot] WhatsApp empleados precio foto disponible:', err))
        const respuesta = detectarLinkMaps(textoCliente) || /\b(env[ií]o|env[ií]ar|domicilio|direcci[oó]n)\b/i.test(textoCliente)
          ? 'Sí, podemos revisar el envío 🌷 Déjame confirmar con el equipo el precio real de ese ramo y el costo de envío antes de apartarlo.'
          : 'Claro 🌷 Déjame confirmar con el equipo el precio real de ese ramo y te digo.'
        await deps.responderMensaje(msg, respuesta)
        await agregarAlHistorial(telefono, 'assistant', respuesta, OrigenMensaje.FLORA)
        return
      }

      if (/venta\s*cerrada/i.test(textoCliente)) {
        const venta = deps.ventaDesdeEstado(clienteId)
        if (venta) {
          if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
          await deps.ventaCerradaHandler(clienteId, venta, await numeroRealPromise)
        }
      }

      const notaMatch = textoCliente.match(/nota[:\s]*([\s\S]{1,500})/i)
      if (notaMatch && deps.tieneArregloVerificado(clienteId)) deps.pedidoActual(clienteId).nota = notaMatch[1].trim().slice(0, 500)

      const nombreMatch = textoCliente.match(/(?:a qué nombre|a nombre de|nombre de|nombre|apartar a nombre de|para quien|para quién|ponerle|se lo aparto a nombre de)[:\s]*([a-záéíóúñA-ZÁÉÍÓÚÑ\s']+)/i)
      if (nombreMatch && deps.tieneArregloVerificado(clienteId)) {
        const extraido = extraerNombrePedido(textoCliente)
        const fallback = nombreMatch[1].trim().replace(/\s+/g, ' ').slice(0, 80)
        const nombre = extraido && esNombrePlausible(extraido)
          ? extraido
          : esNombrePlausible(fallback)
            ? fallback
            : null
        if (nombre) {
          deps.pedidoActual(clienteId).nombre = nombre
        }
      }

      if (!deps.pedidoActual(clienteId).nombre && deps.tieneArregloVerificado(clienteId) && pareceNombreCliente(textoCliente)) {
        deps.pedidoActual(clienteId).nombre = textoCliente.trim().replace(/\s+/g, ' ').slice(0, 80)
      }

      const primeraLineaNombre = textoCliente.split('\n---\n')[0]?.trim() || ''
      if (!deps.pedidoActual(clienteId).nombre && deps.tieneArregloVerificado(clienteId) && pareceNombreCliente(primeraLineaNombre)) {
        deps.pedidoActual(clienteId).nombre = primeraLineaNombre.replace(/\s+/g, ' ').slice(0, 80)
      }

      if (deps.pedidoActual(clienteId).nombre) {
        const op = obtenerPedido(clienteId)
        if (op) op.nombre = deps.pedidoActual(clienteId).nombre
      }

      const consultaPagoEnviado = /(?:ya\s*)?pag[uú]e|comprobante|recibo|ticket|transferencia|ya\s*transfer|transfer[ií]|transfiero|le\s+transfiero|devi\s+america|devi\s+américa/i.test(textoCliente)
      if (consultaPagoEnviado && deps.tieneArregloVerificado(clienteId)) {
        deps.pedidoActual(clienteId).metodoPago = 'transferencia'
        deps.pedidoActual(clienteId).estadoFlujo = 'esperando_pago'
        if (deps.pedidoActual(clienteId).estado !== EstadoPedido.APARTADO) transitarDesdeFlujoSeguro(clienteId, 'esperando_pago')
        deps.persistirPedido(clienteId, await numeroRealPromise, 'apartado', textoCliente).catch(() => {})
      }

      const sucParsed = parseSucursal(textoCliente)
      if ((sucParsed.confianza === 'alta' || sucParsed.confianza === 'media') && sucParsed.sucursal && deps.tieneArregloVerificado(clienteId)) {
        deps.pedidoActual(clienteId).sucursal = sucParsed.sucursal
        deps.pedidoActual(clienteId).sucursal_por_confirmar = sucParsed.confianza === 'media'
        if (!consultaPagoEnviado) {
          deps.pedidoActual(clienteId).metodoPago = /tarjeta/i.test(textoCliente) ? 'tarjeta_recoger' : 'efectivo_recoger'
          deps.pedidoActual(clienteId).estadoFlujo = 'esperando_fecha_hora'
          if (deps.pedidoActual(clienteId).estado !== EstadoPedido.APARTADO) transitarDesdeFlujoSeguro(clienteId, 'esperando_fecha_hora')
        }
        contextoExtra +=
          `\n\n[CLIENTE RECOGE EN SUCURSAL] ` +
          `INSTRUCCION: ${obtenerTextoConfirmacionSucursal(validarSucursal(textoCliente))} ` +
          `Pregunta en qué horario pasará y comparte la cuenta BBVA por si quiere adelantar el pago. ` +
          `El equipo preparará su pedido.`
      }

      const pagoEfectivoAlRecoger = /\b(efectivo|tarjeta)\b/i.test(textoCliente) && /\b(recoger|pasar[ií]a|pasaria|paso|sucursal|norte|centro)\b/i.test(textoCliente)
      const pedidoParaCierre = deps.pedidoActual(clienteId)
      const ventaParaCierre = deps.ventaDesdeEstado(clienteId)
      if (!deps.pedidoEstaCerrado(clienteId) && ventaParaCierre && pagoEfectivoAlRecoger && deps.ventaListaParaCerrar(clienteId) && (pedidoParaCierre?.sucursal || /\b(norte|centro)\b/i.test(textoCliente))) {
        if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
        const confirmacion = `¡Listo, ${ventaParaCierre.cliente}! 🌷 Tu pedido queda apartado para ${ventaParaCierre.direccion}. Total: ${ventaParaCierre.total}. Pagas al recoger.`
        await deps.responderMensaje(msg, confirmacion)
        await agregarAlHistorial(telefono, 'assistant', confirmacion, OrigenMensaje.FLORA)
        await deps.pedidoApartadoHandler(clienteId, ventaParaCierre, await numeroRealPromise, 'Efectivo al recoger')
        ventaCerrada = true
      }

      const cierrePagoTransferencia = /\b(listo|ya\s+qued[oó]|ya\s+pag[uú]e|ya\s+transfer[ií]|comprobante)\b/i.test(textoCliente) && (consultaPagoEnviado || /\b(bbva|devi\s+america|devi\s+américa|cuenta|transferencia)\b/i.test(historialTexto))
      if (!ventaCerrada && !deps.pedidoEstaCerrado(clienteId) && ventaParaCierre && cierrePagoTransferencia && deps.ventaListaParaCerrar(clienteId)) {
        if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
        const confirmacion = `¡Gracias, ${ventaParaCierre.cliente}! 🌸 Tu pedido queda registrado. Total: ${ventaParaCierre.total}.`
        await deps.responderMensaje(msg, confirmacion)
        await agregarAlHistorial(telefono, 'assistant', confirmacion, OrigenMensaje.FLORA)
        await deps.ventaCerradaHandler(clienteId, ventaParaCierre, await numeroRealPromise)
        ventaCerrada = true
      }

      if (!ventaCerrada && !deps.pedidoEstaCerrado(clienteId) && confirmaCorto && deps.ventaListaParaCerrar(clienteId) && (deps.tieneArregloVerificado(clienteId) || (textoCliente.length < 150 && !textoCliente.includes('?')))) {
        const venta = deps.ventaDesdeEstado(clienteId)
        if (venta) {
          const totalTexto = formatearTotalConDesglose(clienteId)
          if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
          await deps.ventaCerradaHandler(clienteId, {
            cliente: venta.cliente,
            producto: venta.producto,
            total: totalTexto,
            direccion: venta.direccion,
          }, await numeroRealPromise)
          ventaCerrada = true
        }
      }

      if (!ventaCerrada && !deps.pedidoEstaCerrado(clienteId) && deps.apartadoSucursalListo(clienteId)) {
        const venta = deps.ventaDesdeEstado(clienteId)
        if (venta) {
          const metodo = deps.pedidoActual(clienteId).metodoPago === 'tarjeta_recoger' ? 'Tarjeta al recoger' : 'Efectivo al recoger'
          const confirmacion = `¡Listo, ${venta.cliente}! 🌷 Tu pedido queda apartado para ${venta.direccion}. Total: ${venta.total}. Pagas al recoger.`
          await deps.responderMensaje(msg, confirmacion)
          await agregarAlHistorial(telefono, 'assistant', confirmacion, OrigenMensaje.FLORA)
          await deps.pedidoApartadoHandler(clienteId, venta, await numeroRealPromise, metodo)
          ventaCerrada = true
        }
      }

      if (motivoAtencionHumana && debeNotificarAtencionHumana(clienteId) && debeEnviarAlertaDedup(clienteId, 'atencion-humana', motivoAtencionHumana, 20 * 60_000)) {
        eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: await numeroRealPromise, cliente: msg.pushName || '', descripcion: textoCliente.substring(0, 300), contexto: motivoAtencionHumana })
      }

      if (!ventaCerrada) {

        contextoExtra += `\n\nForma de pago:\n${obtenerTextoCuenta()}\n` +
          `(Pregunta el nombre para apartarlo)`

        contextoExtra = `${buildValidatedRulesSection()}\n\n${contextoExtra}`

        const respuestaIA = await getAIResponse(
          historialCompleto.length > 0 ? historialCompleto : [],
          contextoExtra,
        )

        if (!respuestaIA) {
          const telefonoReal = await numeroRealPromise.catch(() => telefono)
          const jid = msg.key?.remoteJid
          if (jid) {
            sock.chatModify({
              markRead: false,
              lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }],
            }, jid).catch(() => {})
          }
          eventBus.emit(EventType.HUMAN_REQUIRED, {
            telefono: telefonoReal,
            cliente: msg.pushName || '',
            prioridad: 'critica',
            descripcion: `[TIMEOUT IA] No se pudo responder automáticamente. Se requiere atención humana urgente para ${telefonoReal}.`,
            contexto: 'Timeout del proveedor de IA',
          })
          return
        }

        const mensajeParaEnviar = sanitizarRespuestaIA(limpiarRespuestaIA(respuestaIA.mensaje))

        const validacion = validarRespuestaIA(mensajeParaEnviar, contextoExtra)
        if (!validacion.valido) {
          console.warn(`[response-validator] Respuesta IA rechazada para ${telefono}: ${validacion.razon}`)
          eventBus.emit(EventType.HUMAN_REQUIRED, {
            telefono: await numeroRealPromise,
            cliente: msg.pushName || '',
            prioridad: 'alta',
            descripcion: `[VALIDACION IA] El LLM intentó responder con información no verificada: ${validacion.razon}. Se requiere atención humana. Mensaje original: ${textoCliente.substring(0, 200)}`,
            contexto: 'Response validator reject',
          })
        }

        let mensajeFinal = mensajeParaEnviar
        const revision = await revisarRespuestaFlora(
          historialCompleto,
          textoCliente,
          mensajeParaEnviar,
          contextoExtra
        )
        if (!revision.approved) {
          if (revision.mensaje) {
            mensajeFinal = sanitizarRespuestaIA(limpiarRespuestaIA(revision.mensaje))
            console.log(`[bot] 🔎 Revisora IA corrigió respuesta para ${telefono}: ${revision.razon}`)
          } else {
            console.warn(`[bot] 🔎 Revisora IA desaprobó respuesta para ${telefono}: ${revision.razon}`)
            eventBus.emit(EventType.HUMAN_REQUIRED, {
              telefono: await numeroRealPromise,
              cliente: msg.pushName || '',
              prioridad: 'alta',
              descripcion: `[REVISORA IA] El LLM propuso una respuesta no aprobada: ${revision.razon}. Se requiere atención humana. Mensaje original: ${textoCliente.substring(0, 200)}`,
              contexto: 'Revisora IA reject',
            })
            await agregarAlHistorial(telefono, 'assistant', `[Flora omitió respuesta — revisora: "${revision.razon.slice(0, 150)}"]`, OrigenMensaje.SISTEMA)
            return
          }
        }

        const ventaEstado = deps.ventaDesdeEstado(clienteId)
        if (!deps.pedidoEstaCerrado(clienteId) && ventaEstado && deps.ventaListaParaCerrar(clienteId) && (
          confirmaCorto || /lo[sv]? quiero|me gusta|adelante|procedo|hagamoslo|hag[aá]moslo|d[aá]le|adelante|apartalo|aparta lo|si? (por favor|gracias)/i.test(textoCliente)
        )) {
          const totalTexto = formatearTotalConDesglose(clienteId)
          if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
          deps.ventaCerradaHandler(clienteId, {
            cliente: ventaEstado.cliente,
            producto: ventaEstado.producto,
            total: totalTexto,
            direccion: ventaEstado.direccion,
          }, await numeroRealPromise)
        }

        const intervencionAntesDeEnviar = obtenerIntervencionHumanaReciente(clienteId)
        if (intervencionAntesDeEnviar && intervencionAntesDeEnviar.haceMs < 30_000) {
          console.log(`[bot] 🙋 Empleado respondió hace ${Math.round(intervencionAntesDeEnviar.haceMs / 1000)}s durante LLM; Flora omite respuesta para ${clienteId}`)
          await agregarAlHistorial(telefono, 'assistant', `[Flora omitió respuesta — empleado respondió: "${intervencionAntesDeEnviar.texto.slice(0, 150)}"]`, OrigenMensaje.SISTEMA)
          return
        }

        await deps.responderMensaje(msg, mensajeFinal)
        await agregarAlHistorial(telefono, 'assistant', mensajeFinal, OrigenMensaje.FLORA)
        if (respuestaPideComprobante(mensajeFinal) && deps.tieneArregloVerificado(clienteId)) {
          const pedido = deps.pedidoActual(clienteId)
          pedido.metodoPago = 'transferencia'
          pedido.estadoFlujo = 'esperando_pago'
          if (pedido.estado !== EstadoPedido.APARTADO) transitarDesdeFlujoSeguro(clienteId, 'esperando_pago')
          deps.persistirPedido(clienteId, await numeroRealPromise, 'apartado', 'Esperando comprobante de transferencia').catch(() => {})
        }
      }
    } catch (err) {
      logger.error('message-handler', 'Error en procesarMensaje', { error: String(err), stack: (err as Error)?.stack })
      const telefonoReal = await numeroRealPromise.catch(() => telefono)
      const jid = msg?.key?.remoteJid
      if (jid) {
        sock.chatModify({
          markRead: false,
          lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }],
        }, jid).catch(() => {})
      }
      eventBus.emit(EventType.HUMAN_REQUIRED, {
        telefono: telefonoReal,
        cliente: msg?.pushName || '',
        prioridad: 'critica',
        descripcion: `[ERROR SISTEMA] Error inesperado al procesar mensaje de ${telefonoReal}. Se requiere atención humana.`,
        contexto: 'Error en procesarMensaje',
      })
    } finally {
      const mediaPendiente = deps.MEDIA_POR_CLIENTE.get(clienteId)
      if (mediaPendiente && mediaPendiente.length > 0) {
        deps.MEDIA_POR_CLIENTE.delete(clienteId)
        const telefonoReal = await numeroRealPromise.catch(() => telefono)
        const enHorarioPendiente = estaEnHorario()
        for (const media of mediaPendiente) {
          if (!enHorarioPendiente) {
            encolarFotoPendienteApertura(clienteId, { telefono: telefonoReal, tipo: 'otra', base64: media.base64, mimetype: media.mimetype, caption: media.caption, ts: Date.now() })
            continue
          }
          eventBus.emit(EventType.PHOTO_RECEIVED, {
            telefono: telefonoReal,
            tipo: 'pendiente',
            base64: media.base64,
            mimetype: media.mimetype,
            caption: media.caption,
          })
          enviarFotoEmpleadosWhatsApp(sock, media.base64, `📷 Imagen pendiente de ${telefonoReal}${media.caption ? `\n\nCliente dice: ${media.caption}` : ''}`, media.mimetype).catch(err => console.error('[bot] WhatsApp imagen pendiente:', err))
          if (debeEnviarAlertaDedup(clienteId, 'foto-sent', media.caption || 'Imagen pendiente', 30 * 60_000)) {
            eventBus.emit(EventType.PHOTO_SENT, { telefono: telefonoReal, descripcion: media.caption || 'Imagen pendiente' })
          }
        }
      }
    }
  }

  return { procesarMensaje }
}

function detectarExtrasPedido(texto: string): { nombre: string; precio: number }[] {
  const extras = new Map<string, { nombre: string; precio: number }>()
  if (/\b(notita|nota\s+personalizada|nota|tarjeta|dedicatoria|mensaje\s+(?:escrito|impreso)|papelito)\b/i.test(texto)) {
    extras.set('Nota personalizada', { nombre: 'Nota personalizada', precio: 10 })
  }
  return [...extras.values()]
}

function agregarExtrasPedido(clienteId: string, extras: { nombre: string; precio: number }[], deps: Pick<MsgHandlerDeps, 'pedidoActual'>): void {
  if (extras.length === 0) return
  const pedido = deps.pedidoActual(clienteId)
  const actuales = new Map((pedido.extras ?? []).map(extra => [extra.nombre.toLowerCase(), extra]))
  for (const extra of extras) actuales.set(extra.nombre.toLowerCase(), extra)
  pedido.extras = [...actuales.values()]
}
