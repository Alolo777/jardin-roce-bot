import { eventBus } from '../events/event-bus'
import { EventType } from '../events/types'
import { supabaseAdmin } from '../../lib/supabase'
import type { VentaCerrada } from '../../lib/types'
import { obtenerHistorial, agregarAlHistorial, extraerTelefono } from '../conversation/conversation.service'
import { parseNombre, pareceNombreCliente, parseSucursal, parseDireccion, extraerFecha, extraerHora } from '../parser'
import { getMensajeTexto, getMessageBody, getFechaActual, hasQuotedMsg, getQuotedText, ahoraCdmx } from './message-utils'
import { notificarEmpleadosWhatsApp, enviarFotoEmpleadosWhatsApp } from './notification.service'
import { obtenerNumeroReal } from './contact.service'
import { FRUSTRACION_NOTIFICADA, INTERES_COMPRA_NOTIFICADO, ENVIO_NOTIFICADO, FOTOS_NOTIFICADO, FOTOS_DISPONIBLES_RECIENTES, FOTOS_DISPONIBLES_TTL_MS, debeEnviarAlertaDedup, debeNotificarAtencionHumana, debeNotificarReclamacion, obtenerIntervencionHumanaReciente, RATE_AVISADOS, RATE_LIMIT_WINDOW_MS, extraerPrecioRespuesta } from './bot-state'
import { crearCaso, obtenerCasoActivo, actualizarActividad, detectarCambioTema, clasificarTipoCaso } from '../casos/caso.service'
import { crearPedido, obtenerPedido, transitarDesdeFlujo, archivarPedido } from '../pedidos/pedido.service'
import { analizarIntencion } from '../decision/decision.engine'
import { Intencion } from '../models/types'
import { construirContextoPrompt } from '../openai/prompt.builder'
import { detectarCancelacion, detectarQueja, detectarEvento, detectarInteresCompra } from '../decision/intent-detector'
import { validarHorario, esHorarioAnticipado, HORARIO_APERTURA } from '../validators/horario.validator'
import { obtenerTextoCuenta } from '../validators/pago.validator'
import { validarSucursal, obtenerTextoConfirmacionSucursal } from '../validators/sucursal.validator'
import { buscarEnvio, pareceConsultaEnvio } from '../validators/envio.validator'
import { evaluarCancelacion } from '../validators/cancelacion.validator'
import { evaluarQueja } from '../validators/queja.validator'
import { clasificarConversacion, getAIResponse, revisarRespuestaFlora, clasificarImagenVenta } from '../../lib/ai'
import { logger } from '../../lib/logger.service'
import type { PedidoActual, EstadoPedido } from '../models/types'

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
const GOOGLE_MAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s]*/i

const KW_FRUSTRACION = [
  'que show', 'qué show', 'no me ayudas', 'no sirves', 'pesimo', 'pésimo',
  'mal servicio', 'molesta', 'molesto', 'enojada', 'enojado', 'horrible',
  'no entiendes', 'quiero hablar con una persona', 'quiero hablar con alguien',
  'con un humano', 'inutil', 'inútil', 'no funciona', 'tardas mucho',
  'cuando me van a contestar', 'tardaste mucho', 'porque tardaste',
]

function detectarFrustracion(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_FRUSTRACION.some(k => n.includes(k))
}

function detectarAtencionHumana(texto: string): string | null {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (detectarLinkMaps(texto) && /\b(direccion|ubicacion|colonia|calle)\b/i.test(n)) return null
  const reglas: Array<[RegExp, string]> = [
    [/\b(recoger|recojo|pasar por|paso por|recogi|recog[ií]|voy por|vengo por)\b.*\b(ramo|pedido|arreglo|flores?)\b|\b(ramo|pedido|arreglo|flores?)\b.*\b(recoger|recojo|pasar por|paso por|recogi|recog[ií]|voy por|vengo por)\b/i, 'Cliente quiere recoger un pedido'],
    [/\b(sucursal|local|ubicacion|ubicación|direccion|dirección|atah)\b/i, 'Cliente pide información de sucursal/local'],
    [/\b(foto|imagen)\b.*\b(local|sucursal|fachada|entrada|tienda)\b|\b(local|sucursal|fachada|entrada|tienda)\b.*\b(foto|imagen)\b/i, 'Cliente pide foto del local'],
    [/\b(instagram|facebook|dm|inbox|mensaje por insta)\b/i, 'Cliente menciona conversación en redes sociales'],
    [/\b(hable|hablar|comunicarme)\b.*\b(persona|humano|encargad[ao]|asesor)\b/i, 'Cliente solicita atención humana'],
  ]
  return reglas.find(([regex]) => regex.test(n))?.[1] ?? null
}

function extraerFechaHoraPedido(texto: string): { fecha?: string; hora?: string } {
  return { fecha: extraerFecha(texto) ?? undefined, hora: extraerHora(texto) ?? undefined }
}

function esSolicitudFotosDisponibles(texto: string): boolean {
  return /\b(fotos?|ver.*arregl|muestra|enseña|manda.*foto|averlos|verlos|qu[eé].*(?:ramos?|ramitos?|arreglos?|flores?).*tiene(?:n)?|qu[eé]\s+tiene(?:n)?\s+disponible|hay.*foto|puedo.*ver|quisiera.*ver|ramitos?.*disponibles?|ramos?.*disponibles?|arreglos?.*disponibles?|disponibles?\s+hoy)\b/i.test(texto)
}

function clienteEligeFotoDisponible(texto: string): boolean {
  return /\b(me\s+gust[oó]|me\s+interesa|quiero|quisiera|ap[aá]rtame|apartame|apartarlo|este|esta|ese|esa|el\s+de\s+la\s+foto|la\s+de\s+la\s+foto|qu[eé]\s+precio|cu[aá]nto|cuanto)\b/i.test(texto)
}

function contextoEsperaComprobante(clienteId: string, textoTurno: string, historialRecienteTexto: string, deps: Pick<MsgHandlerDeps, 'pedidoActual'>): boolean {
  const pedido = deps.pedidoActual(clienteId)
  const contextoPago = pedido.metodoPago === 'transferencia' || pedido.estadoFlujo === 'esperando_pago' || /comprobante|pago\s+por\s+transferencia|mandame\s+(?:tu\s+)?comprobante|m[aá]ndame\s+(?:tu\s+)?comprobante|cuenta\s*(?:bbva)?\s*:?\s*4152|bbva|devi\s+am[eé]rica|pon\s+tu\s+nombre\s+en\s+concepto|cuando\s+est[eé]\s+listo/i.test(historialRecienteTexto)
  const confirmaTurno = /\b(listo|claro|va|vale|ya\s+est[aá]|hecho|te\s+lo\s+mand[oó]|lo\s+mand[oó])\b/i.test(textoTurno)
  const imagenSinTexto = !textoTurno.trim() || /^\[Imagen sin texto\]$/i.test(textoTurno.trim())
  return Boolean(contextoPago && (imagenSinTexto || confirmaTurno || esTextoComprobante(textoTurno)))
}

function respuestaPideComprobante(texto: string): boolean {
  return /(?:bbva|4152|devi\s+am[eé]rica|m[aá]ndame\s+(?:tu\s+)?comprobante|comprobante\s+cuando\s+est[eé]\s+listo|pon\s+tu\s+nombre\s+en\s+concepto)/i.test(texto)
}

function sincronizarPedidoConCaso(clienteId: string, telefono: string, cambioTema: boolean, deps: Pick<MsgHandlerDeps, 'pedidoActual' | 'resetearPedidoActivo'>): void {
  if (cambioTema || !obtenerPedido(clienteId)) {
    deps.resetearPedidoActivo(clienteId)
    crearPedido(clienteId, telefono)
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
  if (decision.intencion === Intencion.CATALOGO || decision.intencion === Intencion.FOTOS) return 'catalogo'
  if (decision.intencion === Intencion.COTIZACION || decision.intencion === Intencion.PERSONALIZADO) return 'cotizador'
  return 'normal'
}

function detectarLinkMaps(texto: string): boolean {
  return GOOGLE_MAPS_REGEX.test(texto)
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

interface ZonaEnvioData {
  id: string; zona: string; precio: number; palabras_clave: string
}

let cacheZonas: { zonas: ZonaEnvioData[]; ts: number } | null = null

async function obtenerZonasEnvio(): Promise<ZonaEnvioData[]> {
  const ahora = Date.now()
  if (cacheZonas && ahora - cacheZonas.ts < 120_000) return cacheZonas.zonas
  try {
    const { data, error } = await supabaseAdmin
      .from('zonas_envio').select('id, zona, precio, palabras_clave').order('precio', { ascending: true })
    if (error) throw error
    cacheZonas = { zonas: data ?? [], ts: ahora }
    return data ?? []
  } catch (err) { console.error('[bot] Error obteniendo zonas:', err); return [] }
}

function formatearZonasParaPrompt(zonas: ZonaEnvioData[]): string {
  if (!zonas.length) return ''
  return zonas.map(z => `- ${z.zona}: $${z.precio.toFixed(2)} MXN (${z.palabras_clave})`).join('\n')
}

interface MunicipioEnvioData {
  id: string; municipio: string; codigo_postal: string
  colonia: string | null; zona: string; precio_envio: number
}

let cacheMunicipios: { data: MunicipioEnvioData[]; ts: number } | null = null

async function obtenerMunicipiosEnvio(): Promise<MunicipioEnvioData[]> {
  const ahora = Date.now()
  if (cacheMunicipios && ahora - cacheMunicipios.ts < 120_000) return cacheMunicipios.data
  try {
    const { data, error } = await supabaseAdmin
      .from('municipios_envio').select('*').order('municipio', { ascending: true })
    if (error) throw error
    cacheMunicipios = { data: data ?? [], ts: ahora }
    return data ?? []
  } catch (err) { console.error('[bot] Error obteniendo municipios:', err); return [] }
}

function esTextoComprobante(texto: string): boolean {
  return /\b(comprobante|ya\s*pag[uú]e|pagado|pago\s*hecho|ya\s*qued[oó]|ya\s*transfer[ií]|transfer[ií]|transferencia|dep[oó]sito|recibo|ticket|bbva|devi\s+america|devi\s+américa|4152)\b/i.test(texto)
}

export function esTextoReferenciaOCotizacion(texto: string): boolean {
  return /\b(cotiz|cotizar|cotizaci[oó]n|cu[aá]nto|cuanto|precio|saldr[ií]a|costar[ií]a|ramo\s+as[ií]|como\s+(este|esta|la\s+foto|imagen)|referencia|foto\s+de\s+referencia|imagen\s+de\s+referencia|hacer\s+un\s+ramo|podr[ií]an\s+hacer|hortensias?|lilis?|rosas?|flores?\s+de\s+la\s+imagen)\b/i.test(texto)
}

type ResultadoEnvio = { zona: string; precio: number; fuente: string } | { ambiguo: true; candidatos: Array<{ zona: string; precio: number; fuente: string }> }

async function buscarPrecioEnvio(texto: string): Promise<ResultadoEnvio | null> {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const tieneDatoDireccion = parseDireccion(texto).confianza !== 'ninguna'

  const municipios = await obtenerMunicipiosEnvio()
  if (municipios.length > 0) {
    const candidatos = municipios
      .map(m => {
        const nomMunicipio = m.municipio.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const nomColonia = (m.colonia ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const cp = m.codigo_postal.trim()
        let score = 0
        if (cp && n.includes(cp)) score += 200
        if (contieneFrase(n, nomMunicipio) || n.includes(nomMunicipio)) score += 120 + nomMunicipio.length
        if (nomColonia && (contieneFrase(n, nomColonia) || n.includes(nomColonia))) {
          score += nomColonia.length <= 7 ? 35 : 70 + nomColonia.length
        }
        return { municipio: m, score }
      })
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)

    const mejor = candidatos[0]
    const segundo = candidatos[1]
    if (mejor) {
      const match = mejor.municipio
      const esMatchFuerte = mejor.score >= 180 || tieneDatoDireccion
      const ambiguo = segundo && Math.abs(mejor.score - segundo.score) < 10
      if (!esMatchFuerte || ambiguo) {
        console.warn(`[envio] Zona ambigua/no fuerte para "${texto}". Mejor=${match.zona} score=${mejor.score}`)
        return {
          ambiguo: true,
          candidatos: candidatos.slice(0, 5).map(c => ({ zona: c.municipio.zona, precio: c.municipio.precio_envio, fuente: 'municipios' })),
        }
      }
      return { zona: match.zona, precio: match.precio_envio, fuente: 'municipios' }
    }
  }

  const zonas = await obtenerZonasEnvio()
  if (zonas.length > 0) {
    const zonaMatch = zonas.find(z =>
      z.palabras_clave.split(',').some(p => {
        const palabra = p.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return palabra && contieneFrase(n, palabra)
      })
    )
    if (zonaMatch && tieneDatoDireccion) return { zona: zonaMatch.zona, precio: zonaMatch.precio, fuente: 'zonas' }
  }

  return null
}

function contieneFrase(texto: string, frase: string): boolean {
  if (!frase) return false
  const segura = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${segura}(\\s|$)`).test(texto)
}

function extraerNombrePedido(texto: string): string | null {
  return parseNombre(texto)
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
  if (sucParsed.confianza === 'alta' && sucParsed.sucursal) {
    pedido.sucursal = sucParsed.sucursal
  }

  if (/\b(transferencia|transfer|comprobante|recibo|ticket|listo\s+ese\s+es\s+el\s+recibo|pago\s+con\s+transferencia)\b/i.test(texto)) {
    pedido.metodoPago = 'transferencia'
    pedido.estadoFlujo = 'esperando_pago'
    transitarDesdeFlujo(clienteId, 'esperando_pago')
  }

  if (pedido.nombre) {
    const op = obtenerPedido(clienteId)
    if (op) op.nombre = pedido.nombre
  }
}

function faltoFechaHoraParaCerrar(clienteId: string, deps: Pick<MsgHandlerDeps, 'pedidoActual'>): boolean {
  const pedido = deps.pedidoActual(clienteId)
  return !pedido.fechaEntrega || !pedido.horaEntrega
}

export function createMessageHandler(deps: MsgHandlerDeps) {

  function faltaFechaHoraParaCerrar(clienteId: string): boolean {
    const pedido = deps.pedidoActual(clienteId)
    return !pedido.fechaEntrega || !pedido.horaEntrega
  }

  function apartadoSucursalListo(clienteId: string): boolean {
    const pedido = deps.pedidoActual(clienteId)
    return Boolean(pedido.sucursal && deps.ventaListaParaCerrar(clienteId))
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
    transitarDesdeFlujo(clienteId, 'esperando_fecha_hora')
    await deps.persistirPedido(clienteId, telefono, 'apartado', 'Falta fecha/hora antes de cerrar')
    const pregunta = '¿Para qué fecha y hora lo necesitas? 🌷'
    await deps.responderMensaje(msg, pregunta)
    await agregarAlHistorial(telefono, 'assistant', pregunta)
    return true
  }

  async function procesarMediaAcumulado(clienteId: string, telefono: string, textoCliente: string, sock: any, pushName?: string): Promise<'referencia' | 'comprobante' | 'imagen' | null> {
    const mediaAcumulado = deps.MEDIA_POR_CLIENTE.get(clienteId)
    if (!mediaAcumulado || mediaAcumulado.length === 0) return null

    deps.MEDIA_POR_CLIENTE.delete(clienteId)
    const historial = await obtenerHistorial(telefono)
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
      console.log(`[bot] 👁️ Enviando ${mediaAcumulado.length} imagen(es) a visión IA para ${telefono}...`)
      const pedido = deps.pedidoActual(clienteId)
      const contextoVision = [
        `estado_flujo: ${pedido.estadoFlujo ?? 'sin_pedido'}`,
        `metodo_pago: ${pedido.metodoPago ?? 'sin_confirmar'}`,
        `tiene_arreglo: ${deps.tieneArregloVerificado(clienteId) ? 'si' : 'no'}`,
        `texto_turno: ${textoTurno || 'sin texto'}`,
      ].join('\n')
      const vision = await clasificarImagenVenta(historial, contextoVision, mediaAcumulado)
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

    for (const media of mediaAcumulado) {
      if (esComprobante) {
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
        eventBus.emit(EventType.PHOTO_RECEIVED, {
          telefono,
          tipo: 'referencia',
          base64: media.base64,
          mimetype: media.mimetype,
          caption: media.caption,
        })
        enviarFotoEmpleadosWhatsApp(sock, media.base64, `📷 Foto de referencia de ${telefono}${media.caption ? `\n\nCliente dice: ${media.caption}` : ''}`, media.mimetype).catch(err => console.error('[bot] WhatsApp foto referencia:', err))
        eventBus.emit(EventType.PHOTO_SENT, { telefono, descripcion: media.caption || 'Foto de referencia' })
      } else {
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
      transitarDesdeFlujo(clienteId, 'pagado_transferencia')
      const venta = deps.ventaDesdeEstado(clienteId)
      if (venta && deps.ventaListaParaPagoTransferencia(clienteId)) {
        await deps.ventaCerradaHandler(clienteId, venta, telefono)
      } else {
        await deps.persistirPedido(clienteId, telefono, 'apartado', 'Comprobante recibido, faltan datos para cierre')
        if (debeEnviarAlertaDedup(clienteId, 'comprobante-pendiente', textoTurno || 'comprobante', 30 * 60_000)) {
          const pedido = deps.pedidoActual(clienteId)
          eventBus.emit(EventType.ORDER_CREATED, {
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
      transitarDesdeFlujo(clienteId, 'esperando_precio_equipo')
      pedido.fotoReferenciaBase64 = mediaAcumulado[0]?.base64
      pedido.fotoReferenciaMimetype = mediaAcumulado[0]?.mimetype
      pedido.fotoReferenciaCaption = descripcion
      pedido.fotoReferenciaRecibidaEn = new Date().toISOString()
      pedido.detallesEspeciales = descripcion
      await deps.persistirPedido(clienteId, telefono, 'cotizacion', descripcion)
      if (debeEnviarAlertaDedup(clienteId, 'cotizacion-foto', descripcion, 30 * 60_000)) {
        eventBus.emit(EventType.COTIZACION_REQUESTED, { telefono, descripcion })
        notificarEmpleadosWhatsApp(sock,
          `🌷 *Cliente necesita cotización:* ${telefono}\n\n${descripcion}\n\nRevisa la foto de referencia y cotízale por WhatsApp.`
        ).catch(err => console.error('[bot] WhatsApp empleados cotización:', err))
      }
      return 'referencia'
    }

    eventBus.emit(EventType.HUMAN_REQUIRED, { telefono, cliente: pushName || '', descripcion: 'Envió imagen sin contexto claro', contexto: 'Imagen sin contexto' })
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

      await agregarAlHistorial(telefono, 'user', textoCliente)

      const pideEmpezarDesdeCero = /empecemos\s+desde\s+cero|desde\s+cero|borr[oó]n\s+y\s+cuenta\s+nueva|nuevo\s+pedido|otro\s+pedido|otro\s+ramo|es\s+aparte|aparte\s+ese|ya\s+hab[ií]a\s+finalizado|ya\s+se\s+finaliz[oó]|ese\s+ya\s+qued[oó]/i.test(textoCliente)
      if (pideEmpezarDesdeCero) deps.resetearPedidoActivo(clienteId)

      let casoActivo = obtenerCasoActivo(clienteId)
      const horasInactivo = casoActivo
        ? (Date.now() - new Date(casoActivo.ultimaActividad).getTime()) / (1000 * 60 * 60)
        : 99
      const cambioTema = casoActivo ? detectarCambioTema(textoCliente, horasInactivo) : false
      if (cambioTema) {
        casoActivo = crearCaso(clienteId, telefono, clasificarTipoCaso(textoCliente))
      } else if (!casoActivo) {
        casoActivo = crearCaso(clienteId, telefono, clasificarTipoCaso(textoCliente))
      }
      actualizarActividad(casoActivo)

      sincronizarPedidoConCaso(clienteId, telefono, cambioTema, { pedidoActual: deps.pedidoActual, resetearPedidoActivo: deps.resetearPedidoActivo })

      const decision = analizarIntencion({
        texto: textoCliente,
        horasInactivo,
      })

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
        transitarDesdeFlujo(clienteId, 'esperando_fecha_hora')
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
      const horario = validarHorario().mensajeBackend
      const pedidoEngine = obtenerPedido(clienteId)
      const contextoPrompt = construirContextoPrompt({
        decision,
        caso: casoActivo,
        pedido: pedidoEngine,
        textoCliente,
        horaActual: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
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
      const equipoRespondio = ultimoAssistant && ultimoAssistant.content.startsWith('[Agente:')
      if (equipoRespondio) {
        const textoAgente = ultimoAssistant.content.replace(/^\[Agente:\s*|\]$/g, '').trim()
        contextoExtra +=
          `\n\n[EL EQUIPO HUMANO RESPONDIÓ] El equipo ya habló con el cliente. ` +
          `Su último mensaje fue: "${textoAgente.replace(/"/g, "'")}". ` +
          `Flora puede continuar la conversación con normalidad, respetando lo dicho por el equipo. ` +
          `Si el equipo dio un precio, úsalo como confirmado. No lo contradigas ni preguntes lo mismo.`
      }

      const intervencionHumana = obtenerIntervencionHumanaReciente(clienteId)
      if (intervencionHumana && !equipoRespondio) {
        contextoExtra +=
          `\n\n[INTERVENCION HUMANA RECIENTE] ` +
          `El equipo respondió hace ${Math.round(intervencionHumana.haceMs / 1000)} segundos: "${intervencionHumana.texto.replace(/"/g, "'")}". ` +
          `Flora NO debe ignorar esa respuesta. Si contiene precio, úsalo como precio confirmado por el equipo. No digas que falta confirmar ese mismo precio.`
      }

      const clasificacionIA = await clasificarConversacion(
        historialCompleto,
        textoCliente,
        [
          `estado_pedido: ${deps.pedidoActual(clienteId).estadoFlujo ?? 'sin_pedido'}`,
          `tiene_arreglo: ${deps.tieneArregloVerificado(clienteId) ? 'si' : 'no'}`,
          `precio_confirmado: ${deps.tienePrecioConfirmado(clienteId) ? 'si' : 'no'}`,
          intervencionHumana ? `intervencion_humana_reciente: ${intervencionHumana.texto}` : 'intervencion_humana_reciente: no',
        ].join('\n')
      )
      contextoExtra +=
        `\n\n[CLASIFICACION_JSON] ${JSON.stringify(clasificacionIA)} ` +
        `Usa esta clasificacion como apoyo operativo, pero respeta reglas duras de inventario, precios y pagos.`

      if (!clasificacionIA.debeResponder && clasificacionIA.confianza >= 0.7) {
        console.log(`[bot] Clasificador indicó no responder a ${clienteId}: ${clasificacionIA.razon}`)
        return
      }

      if (clasificacionIA.debeAlertarWhatsApp && debeEnviarAlertaDedup(clienteId, `ia-whatsapp-${clasificacionIA.intencion}`, clasificacionIA.razon || textoCliente, 20 * 60_000)) {
        const telefonoReal = await numeroRealPromise
        notificarEmpleadosWhatsApp(sock,
          `⚠️ *Alerta ${clasificacionIA.severidad.toUpperCase()} (${clasificacionIA.intencion}):* ${telefonoReal}\n\n${(clasificacionIA.razon || textoCliente).slice(0, 500)}`
        ).catch(err => console.error('[bot] WhatsApp alerta IA:', err))
      }
      if (clasificacionIA.debeAlertarTelegram && clasificacionIA.intencion === 'atencion_humana' && debeEnviarAlertaDedup(clienteId, `ia-telegram-${clasificacionIA.intencion}`, clasificacionIA.razon || textoCliente, 20 * 60_000)) {
        const telefonoReal = await numeroRealPromise
        eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: telefonoReal, cliente: msg.pushName || '', descripcion: (clasificacionIA.razon || textoCliente).substring(0, 300), contexto: `Severidad: ${clasificacionIA.severidad} | Intención: ${clasificacionIA.intencion}` })
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

      const seleccionaFotoDisponible = !pideFotosDisponibles && deps.hayFotosDisponiblesRecientes(clienteId) && clienteEligeFotoDisponible(textoCliente)
      if (seleccionaFotoDisponible) {
        deps.resetearPedidoActivo(clienteId)
        FOTOS_DISPONIBLES_RECIENTES.delete(clienteId)
        const pedido = deps.pedidoActual(clienteId)
        pedido.productoPersonalizado = 'Ramo elegido de fotos disponibles'
        pedido.detallesEspeciales = 'Cliente eligio un ramo de las fotos disponibles enviadas por el equipo'
        pedido.estadoFlujo = 'esperando_precio_equipo'
        transitarDesdeFlujo(clienteId, 'esperando_precio_equipo')
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
      const motivoAtencionHumana = detectarAtencionHumana(textoCliente) || (clasificacionIA.intencion === 'atencion_humana' && clasificacionIA.confianza >= 0.65 ? clasificacionIA.razon || 'Cliente requiere atención humana' : null)
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
          `\n\nINSTRUCCION: Envía DIRECTAMENTE el cotizador: ` +
          `https://floreria-app-mauve.vercel.app/ Menciona que puede subir foto de referencia. Máximo 3 líneas.`
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

      const resultadoEnvio = pareceEnvio ? await buscarPrecioEnvio(textoCliente).catch(() => null) : null

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
        eventBus.emit(EventType.ZONA_AMBIGUA, {
          telefono: telefonoReal,
          descripcion: textoCliente,
          candidatos: resultadoEnvio.candidatos,
        })
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

      const evalCancel = evaluarCancelacion(textoCliente, clasificacionIA)
      if (evalCancel.detectada && !evalCancel.descartadaPorIA) {
        contextoExtra += `\n\n[CLIENTE QUIERE CANCELAR UN PEDIDO]\n${evalCancel.instruccion}`
        if ((clasificacionIA.severidad === 'alta' || clasificacionIA.severidad === 'critica' || clasificacionIA.intencion === 'cancelacion') && debeNotificarReclamacion(clienteId, 'cancelacion')) {
          const telefonoReal = await numeroRealPromise
          const referencia = deps.pedidoActual(clienteId).arreglo?.nombre ?? null
          eventBus.emit(EventType.CANCELACION_REQUESTED, { telefono: telefonoReal, descripcion: textoCliente.substring(0, 300) })
          registrarReclamacion(telefonoReal, 'cancelacion', textoCliente, referencia).catch(() => {})
          deps.persistirPedido(clienteId, telefonoReal, 'cancelado', textoCliente).catch(() => {})
        }
      }

      const evalQueja = evaluarQueja(textoCliente, clasificacionIA)
      if (evalQueja.detectada && !evalQueja.descartadaPorIA) {
        contextoExtra += `\n\n[CLIENTE TIENE UNA QUEJA O RECLAMO]\n${evalQueja.instruccion}`
        if ((clasificacionIA.severidad === 'alta' || clasificacionIA.severidad === 'critica' || clasificacionIA.intencion === 'queja') && debeNotificarReclamacion(clienteId, 'queja')) {
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
      const tipoMediaProcesada = await procesarMediaAcumulado(clienteId, await numeroRealPromise, textoCliente, sock, msg.pushName)
      if (tipoMediaProcesada === 'referencia') {
        const respuesta = 'Ya recibí la foto de referencia 🌷 Se la paso al equipo para que la revise y te confirme el precio.'
        await deps.responderMensaje(msg, respuesta)
        await agregarAlHistorial(telefono, 'assistant', respuesta)
        return
      }
      if (tipoMediaProcesada === 'imagen') {
        const respuesta = 'Ya recibí tu imagen 🌷 Se la paso al equipo para que la revise.'
        await deps.responderMensaje(msg, respuesta)
        await agregarAlHistorial(telefono, 'assistant', respuesta)
        return
      }
      if (tipoMediaProcesada === 'comprobante') {
        const venta = deps.ventaDesdeEstado(clienteId)
        if (venta && deps.ventaListaParaCerrar(clienteId) && !deps.pedidoEstaCerrado(clienteId)) {
          const confirmacion = `¡Gracias, ${venta.cliente}! 🌸 Recibí tu comprobante. Tu pedido queda registrado. Total: ${venta.total}.`
          await deps.responderMensaje(msg, confirmacion)
          await agregarAlHistorial(telefono, 'assistant', confirmacion)
          await deps.ventaCerradaHandler(clienteId, venta, await numeroRealPromise)
          ventaCerrada = true
        } else {
          const respuesta = 'Gracias, ya recibí tu comprobante 🌷 Lo registro para que el equipo continúe con tu pedido.'
          await deps.responderMensaje(msg, respuesta)
          await agregarAlHistorial(telefono, 'assistant', respuesta)
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
        await agregarAlHistorial(telefono, 'assistant', respuesta)
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

      const nombreMatch = textoCliente.match(/(?:a qué nombre|a nombre de|nombre de|nombre|apartar a nombre de|para quien|para quién|ponerle|se lo aparto a nombre de)[:\s]*([a-záéíóúñ\s]+)/i)
      if (nombreMatch && deps.tieneArregloVerificado(clienteId)) {
        const nombre = extraerNombrePedido(textoCliente) ?? nombreMatch[1].trim().replace(/\s+/g, ' ').slice(0, 80)
        if (!/^(ok|si|sí|vale|dale|va|de acuerdo|esta bien|está bien)$/i.test(nombre)) {
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
        transitarDesdeFlujo(clienteId, 'esperando_pago')
        deps.persistirPedido(clienteId, await numeroRealPromise, 'apartado', textoCliente).catch(() => {})
      }

      const sucParsed = parseSucursal(textoCliente)
      if (sucParsed.confianza === 'alta' && sucParsed.sucursal && deps.tieneArregloVerificado(clienteId)) {
        deps.pedidoActual(clienteId).sucursal = sucParsed.sucursal
        if (!consultaPagoEnviado) {
          deps.pedidoActual(clienteId).metodoPago = /tarjeta/i.test(textoCliente) ? 'tarjeta_recoger' : 'efectivo_recoger'
          deps.pedidoActual(clienteId).estadoFlujo = 'esperando_fecha_hora'
          transitarDesdeFlujo(clienteId, 'esperando_fecha_hora')
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
        await agregarAlHistorial(telefono, 'assistant', confirmacion)
        await deps.pedidoApartadoHandler(clienteId, ventaParaCierre, await numeroRealPromise, 'Efectivo al recoger')
        ventaCerrada = true
      }

      const cierrePagoTransferencia = /\b(listo|ya\s+qued[oó]|ya\s+pag[uú]e|ya\s+transfer[ií]|comprobante)\b/i.test(textoCliente) && (consultaPagoEnviado || /\b(bbva|devi\s+america|devi\s+américa|cuenta|transferencia)\b/i.test(historialTexto))
      if (!ventaCerrada && !deps.pedidoEstaCerrado(clienteId) && ventaParaCierre && cierrePagoTransferencia && deps.ventaListaParaCerrar(clienteId)) {
        if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
        const confirmacion = `¡Gracias, ${ventaParaCierre.cliente}! 🌸 Tu pedido queda registrado. Total: ${ventaParaCierre.total}.`
        await deps.responderMensaje(msg, confirmacion)
        await agregarAlHistorial(telefono, 'assistant', confirmacion)
        await deps.ventaCerradaHandler(clienteId, ventaParaCierre, await numeroRealPromise)
        ventaCerrada = true
      }

      if (!ventaCerrada && !deps.pedidoEstaCerrado(clienteId) && confirmaCorto && deps.ventaListaParaCerrar(clienteId) && (deps.tieneArregloVerificado(clienteId) || (textoCliente.length < 150 && !textoCliente.includes('?')))) {
        const venta = deps.ventaDesdeEstado(clienteId)
        if (venta) {
          const pedido = deps.pedidoActual(clienteId)
          const subtotal = pedido.arreglo?.precio ?? pedido.precioPersonalizado ?? 0
          const extras = deps.totalExtrasPedido(clienteId)
          const envio = pedido.envio?.precio ?? 0
          const total = subtotal + extras + envio
          const desglose = [`ramo $${subtotal.toFixed(2)}`]
          if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
          if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
          const totalTexto = desglose.length > 1 ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})` : `$${total.toFixed(2)} MXN`
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
          await agregarAlHistorial(telefono, 'assistant', confirmacion)
          await deps.pedidoApartadoHandler(clienteId, venta, await numeroRealPromise, metodo)
          ventaCerrada = true
        }
      }

      if (motivoAtencionHumana && debeNotificarAtencionHumana(clienteId) && debeEnviarAlertaDedup(clienteId, 'atencion-humana', motivoAtencionHumana, 20 * 60_000)) {
        eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: await numeroRealPromise, cliente: msg.pushName || '', descripcion: textoCliente.substring(0, 300), contexto: motivoAtencionHumana })
      }

      if (!ventaCerrada) {
        const zonas = await obtenerZonasEnvio()
        const zonasPrompt = formatearZonasParaPrompt(zonas)
        if (zonasPrompt) contextoExtra += `\n\nZonas de envío disponibles:\n${zonasPrompt}`

        contextoExtra += `\n\nForma de pago:\n${obtenerTextoCuenta()}\n` +
          `(Pregunta el nombre para apartarlo)`

        const respuestaIA = await getAIResponse(
          historialCompleto.length > 0 ? historialCompleto : [],
          contextoExtra,
        )

        if (!respuestaIA) {
          await deps.responderMensaje(msg, '🌷 Dame un momento, estoy revisando...')
          return
        }

        const mensajeFinal = limpiarRespuestaIA(respuestaIA.mensaje)

        let mensajeParaEnviar = mensajeFinal

        const revision = await revisarRespuestaFlora(
          historialCompleto,
          textoCliente,
          mensajeParaEnviar,
          [
            `clasificacion: ${JSON.stringify(clasificacionIA)}`,
            `estado_pedido: ${deps.pedidoActual(clienteId).estadoFlujo ?? 'sin_pedido'}`,
            `precio_confirmado: ${deps.tienePrecioConfirmado(clienteId) ? 'si' : 'no'}`,
            intervencionHumana ? `intervencion_humana_reciente: ${intervencionHumana.texto}` : 'intervencion_humana_reciente: no',
          ].join('\n')
        )
        if (!revision.approved && revision.mensaje) {
          console.log(`[bot] 🧪 Revisor corrigió respuesta para ${clienteId}: ${revision.razon}`)
          mensajeParaEnviar = limpiarRespuestaIA(revision.mensaje)
        }
        if ((revision.debeAlertarTelegram || revision.debeAlertarWhatsApp) && debeEnviarAlertaDedup(clienteId, `review-${revision.riesgo}`, revision.razon || textoCliente, 20 * 60_000)) {
          const telefonoReal = await numeroRealPromise
          if (revision.debeAlertarTelegram) {
            eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: telefonoReal, cliente: msg.pushName || '', descripcion: revision.razon || 'Revisor detectó riesgo en respuesta', contexto: `Cliente: ${textoCliente.slice(0, 300)}\nFlora: ${mensajeParaEnviar.slice(0, 300)}` })
          }
          if (revision.debeAlertarWhatsApp) {
            notificarEmpleadosWhatsApp(sock,
              `⚠️ *Revisar conversación con ${telefonoReal}:*\n\n${(revision.razon || textoCliente).slice(0, 500)}`
            ).catch(err => console.error('[bot] WhatsApp alerta revisor:', err))
          }
        }

        const ventaEstado = deps.ventaDesdeEstado(clienteId)
        if (!deps.pedidoEstaCerrado(clienteId) && ventaEstado && deps.ventaListaParaCerrar(clienteId) && (
          confirmaCorto || /lo[sv]? quiero|me gusta|adelante|procedo|hagamoslo|hag[aá]moslo|d[aá]le|adelante|apartalo|aparta lo|si? (por favor|gracias)/i.test(textoCliente)
        )) {
          const pedido = deps.pedidoActual(clienteId)
          const subtotal = pedido.arreglo?.precio ?? pedido.precioPersonalizado ?? 0
          const extras = deps.totalExtrasPedido(clienteId)
          const envio = pedido.envio?.precio ?? 0
          const total = subtotal + extras + envio
          const desglose = [`ramo $${subtotal.toFixed(2)}`]
          if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
          if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
          const totalTexto = desglose.length > 1 ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})` : `$${total.toFixed(2)} MXN`
          if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
          deps.ventaCerradaHandler(clienteId, {
            cliente: ventaEstado.cliente,
            producto: ventaEstado.producto,
            total: totalTexto,
            direccion: ventaEstado.direccion,
          }, await numeroRealPromise)
        }

        const intervencionAntesDeEnviar = obtenerIntervencionHumanaReciente(clienteId)
        if (intervencionAntesDeEnviar && intervencionAntesDeEnviar.haceMs < 180_000) {
          console.log(`[bot] 🙋 Empleado respondió hace ${Math.round(intervencionAntesDeEnviar.haceMs / 1000)}s durante LLM; Flora omite respuesta para ${clienteId}`)
          await agregarAlHistorial(telefono, 'assistant', `[Flora omitió respuesta — empleado respondió: "${intervencionAntesDeEnviar.texto.slice(0, 150)}"]`)
          return
        }

        await deps.responderMensaje(msg, mensajeParaEnviar)
        await agregarAlHistorial(telefono, 'assistant', mensajeParaEnviar)
        if (respuestaPideComprobante(mensajeParaEnviar) && deps.tieneArregloVerificado(clienteId)) {
          const pedido = deps.pedidoActual(clienteId)
          pedido.metodoPago = 'transferencia'
          pedido.estadoFlujo = 'esperando_pago'
          transitarDesdeFlujo(clienteId, 'esperando_pago')
          deps.persistirPedido(clienteId, await numeroRealPromise, 'apartado', 'Esperando comprobante de transferencia').catch(() => {})
        }
      }
    } catch (err) {
      logger.error('message-handler', 'Error en procesarMensaje', { error: String(err), stack: (err as Error)?.stack })
      try {
        if (msg?.key?.remoteJid) {
          await deps.responderMensaje(msg, '🌷 Perdón, un pequeño mareo digital. ¿Me repites?')
        }
      } catch {}
    } finally {
      const mediaPendiente = deps.MEDIA_POR_CLIENTE.get(clienteId)
      if (mediaPendiente && mediaPendiente.length > 0) {
        deps.MEDIA_POR_CLIENTE.delete(clienteId)
        const telefonoReal = await numeroRealPromise.catch(() => telefono)
        for (const media of mediaPendiente) {
          eventBus.emit(EventType.PHOTO_RECEIVED, {
            telefono: telefonoReal,
            tipo: 'pendiente',
            base64: media.base64,
            mimetype: media.mimetype,
            caption: media.caption,
          })
          enviarFotoEmpleadosWhatsApp(sock, media.base64, `📷 Imagen pendiente de ${telefonoReal}${media.caption ? `\n\nCliente dice: ${media.caption}` : ''}`, media.mimetype).catch(err => console.error('[bot] WhatsApp imagen pendiente:', err))
          eventBus.emit(EventType.PHOTO_SENT, { telefono: telefonoReal, descripcion: media.caption || 'Imagen pendiente' })
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
