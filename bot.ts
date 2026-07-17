// bot.ts — Jardín RoCe 🌸
// Adaptado para Baileys (sin Chrome/Chromium) en GCP e2-micro

import makeWASocket from '@whiskeysockets/baileys'
import {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  getContentType,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  isJidGroup,
} from '@whiskeysockets/baileys'
import type { Boom } from '@hapi/boom'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import dotenv from 'dotenv'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'

dotenv.config({ path: '.env.local' })

import { clasificarConversacion, clasificarImagenVenta, getAIResponse, revisarRespuestaFlora } from './lib/ai'
import { eventBus } from './src/events/event-bus'
import { EventType } from './src/events/types'
import { subscribeTelegramEvents } from './src/events/telegram.subscriber'
import { subscribeLogEvents, logger, flushLogsNow } from './lib/logger.service'
import { metrics } from './lib/metrics.service'
import { supabaseAdmin } from './lib/supabase'
import type { VentaCerrada } from './lib/types'
import { startServer } from './src/api/server'
import {
  MAX_TURNOS_HISTORIAL,
  variantesTelefono,
  jidToTelefono,
  extraerTelefono,
  obtenerClienteId,
  obtenerHistorial,
  agregarAlHistorial,
  obtenerMensajeId,
  marcarMensajeProcesado,
  yaProcesadoRecientemente,
  normalizarTexto,
  limpiarCachesConversacion,
  CACHE_CLIENTE_UUID,
  MENSAJES_PROCESADOS,
} from './src/conversation/conversation.service'
import { parseNombre, pareceNombreCliente, parseFecha, extraerFecha, parseHora, extraerHora, parseSucursal, parsePrecio, parseDireccion, limpiarTelefono } from './src/parser'
import { getContenidoMensaje, getMessageBody, getMensajeTexto, getMessageType, hasQuotedMsg, getQuotedText, descargarMedia, jidANumero, ahoraCdmx, estaEnHorario, getFechaActual } from './src/whatsapp/message-utils'
import { crearCaso, obtenerCasoActivo, actualizarActividad, detectarCambioTema, clasificarTipoCaso, limpiarCachesCasos } from './src/casos/caso.service'
import { crearPedido, obtenerPedido, transitar, transitarDesdeFlujo, archivarPedido, cancelarPedido, limpiarCachesPedidos, cargarPedidosDesdeBD, persistirPedidosEngine } from './src/pedidos/pedido.service'
import { analizarIntencion, Decision } from './src/decision/decision.engine'
import { Intencion, PedidoActual, EstadoPedido } from './src/models/types'
import { createMessageHandler, esTextoReferenciaOCotizacion } from './src/whatsapp/message-handler'
import type { MsgHandlerDeps } from './src/whatsapp/message-handler'
import { createMessageEntry, type MessageEntryDeps } from './src/whatsapp/message-entry'
import { construirContextoPrompt } from './src/openai/prompt.builder'
import { cargarIgnorados, MENSAJES_RESCATADOS } from './src/whatsapp/preferences.service'
import { obtenerNumeroReal, setBaileysKeys, limpiarCacheNumeros } from './src/whatsapp/contact.service'
import { notificarEmpleadosWhatsApp, enviarFotoEmpleadosWhatsApp } from './src/whatsapp/notification.service'
import { detectarCancelacion, detectarQueja, detectarEvento, detectarInteresCompra } from './src/decision/intent-detector'
import { FRUSTRACION_NOTIFICADA, ATENCION_HUMANA_NOTIFICADA, INTERES_COMPRA_NOTIFICADO, RECLAMACION_NOTIFICADA, ENVIO_NOTIFICADO, FOTOS_NOTIFICADO, FOTOS_DISPONIBLES_RECIENTES, ALERTAS_DEDUP, ULTIMA_INTERVENCION_HUMANA, RATE_TIMESTAMPS, FOTOS_DISPONIBLES_TTL_MS, INTERVENCION_HUMANA_TTL_MS, limpiarCachesEstado, debeNotificarAtencionHumana, debeNotificarReclamacion, debeEnviarAlertaDedup, registrarIntervencionHumana, obtenerIntervencionHumanaReciente, extraerPrecioRespuesta, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, RATE_AVISADOS, estaRateLimited } from './src/whatsapp/bot-state'
import { cargarEstado, guardarEstado, iniciarPersistenciaPeriodica } from './src/whatsapp/bot-state-persistence'
import { validarHorario, esHorarioAnticipado, HORARIO_APERTURA } from './src/validators/horario.validator'
import { obtenerTextoCuenta, determinarInstruccionPago } from './src/validators/pago.validator'
import { validarSucursal, obtenerTextoConfirmacionSucursal } from './src/validators/sucursal.validator'
import { buscarEnvio, pareceConsultaEnvio } from './src/validators/envio.validator'
import { evaluarCancelacion } from './src/validators/cancelacion.validator'
import { evaluarQueja } from './src/validators/queja.validator'

// ════════════════════════════════════════════════════════════════
// PAUSA DEL BOT
// ════════════════════════════════════════════════════════════════

let BOT_PAUSADO        = false
let ultimaVerifPausa   = 0
let verificacionEnCurso = false
const PAUSA_CACHE_MS   = 5_000

export async function verificarSiBotPausado(): Promise<boolean> {
  if (Date.now() - ultimaVerifPausa < PAUSA_CACHE_MS) return BOT_PAUSADO
  if (verificacionEnCurso) return BOT_PAUSADO

  verificacionEnCurso = true
  try {
    const { data } = await supabaseAdmin
      .from('configuracion_agente').select('bot_pausado').eq('id', 1).single()
    BOT_PAUSADO      = data?.bot_pausado ?? false
    ultimaVerifPausa = Date.now()
  } catch { /* mantener valor anterior */ }
  finally { verificacionEnCurso = false }

  return BOT_PAUSADO
}

// ════════════════════════════════════════════════════════════════
// WATCHDOG
// ════════════════════════════════════════════════════════════════

export let ultimaActividad = Date.now()
export function registrarActividad(): void { ultimaActividad = Date.now() }

// ════════════════════════════════════════════════════════════════
// CONTADOR DE REINICIOS
// ════════════════════════════════════════════════════════════════

let crashCount      = 0
let crashWindowStart = Date.now()
const MAX_CRASHES    = 3
const CRASH_WINDOW_MS = 10 * 60 * 1000

function getSessionPath(): string {
  return process.env.BAILEYS_DATA_PATH || './.baileys_auth'
}

function getCrashStatePath(): string {
  return process.env.BOT_CRASH_STATE_PATH || './.bot_crash_state.json'
}

function cargarEstadoCrash(): void {
  try {
    const raw = fs.readFileSync(getCrashStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as { count?: number; windowStart?: number }
    crashCount = parsed.count ?? crashCount
    crashWindowStart = parsed.windowStart ?? crashWindowStart
  } catch {
    // Sin estado previo: se empieza una ventana nueva.
  }
}

function guardarEstadoCrash(): void {
  try {
    fs.writeFileSync(getCrashStatePath(), JSON.stringify({ count: crashCount, windowStart: crashWindowStart }))
  } catch (err) {
    console.warn('[Crash] No se pudo guardar estado:', err)
  }
}

function resetearEstadoCrash(): void {
  crashCount = 0
  crashWindowStart = Date.now()
  try { fs.rmSync(getCrashStatePath(), { force: true }) } catch {}
}

function registrarCrash(): void {
  cargarEstadoCrash()
  const ahora = Date.now()
  if (ahora - crashWindowStart > CRASH_WINDOW_MS) {
    crashCount = 0
    crashWindowStart = ahora
  }
  crashCount++
  guardarEstadoCrash()
  console.warn(`[Crash] ${crashCount}/${MAX_CRASHES} reinicios en ventana de 10 min`)

  if (crashCount >= MAX_CRASHES) {
    const sessionPath = getSessionPath()
    console.warn(`[Crash] 🧹 Demasiados reinicios — limpiando sesión en ${sessionPath}...`)
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true })
      resetearEstadoCrash()
      console.warn('[Crash] ✅ Sesión eliminada. Se generará QR fresco al reiniciar.')
    } catch (err) {
      console.error('[Crash] Error limpiando sesión:', err)
    }
  }
}

// ════════════════════════════════════════════════════════════════
// MONITOR DE MEMORIA
// ════════════════════════════════════════════════════════════════

setInterval(() => {
  const rss  = Math.round(process.memoryUsage().rss      / 1024 / 1024)
  const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  console.log(`[RAM] RSS: ${rss}MB | Heap: ${heap}MB`)

  if (rss > 440) {
    console.warn('[RAM] ⚠️ Memoria alta — limpiando...')
    limpiarCachesConversacion()
    limpiarCachesCasos()
    limpiarCachesPedidos()
    limpiarCacheNumeros()
    limpiarCachesEstado()
    MENSAJES_RESCATADOS.clear()
    console.log('[RAM] 🧹 Cachés limpiadas')
  }
}, 5 * 60_000)

// ════════════════════════════════════════════════════════════════
// ALERTA PERIÓDICA DE DESCONEXIÓN — cada 30 min revisa si toca avisar
// ════════════════════════════════════════════════════════════════

let ultimoDiaAlertaDiaria = ''
setInterval(() => {
  if (BOT_READY) return
  const ahora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
  const d     = new Date(ahora)
  const hora  = d.getHours()
  const dia   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  if (hora === 8 && dia !== ultimoDiaAlertaDiaria) {
    ultimoDiaAlertaDiaria = dia
    eventBus.emit(EventType.BOT_DAILY_ALERT, { telefono: 'system' })
  }
}, 30 * 60_000)

// ════════════════════════════════════════════════════════════════
// LÍMITES Y RATE LIMITING
// ════════════════════════════════════════════════════════════════

const MAX_LONGITUD_MENSAJE      = 1000
export const TIPOS_MEDIA_NO_SOPORTADOS = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker'])
export async function responderMensaje(msg: any, texto: string): Promise<any> {
  if (!sock) return
  const jid = msg.key?.remoteJid
  if (!jid) return
  return sock.sendMessage(jid, { text: texto }, { quoted: msg })
}

// ════════════════════════════════════════════════════════════════
// REPORTE DE VENTAS
// ════════════════════════════════════════════════════════════════

async function registrarVenta(clienteNombre: string, telefono: string, producto: string, total: string, direccion: string, metodoPago = 'transferencia'): Promise<void> {
  try {
    const precioNumerico = extraerTotalNumerico(total)
    const { error } = await supabaseAdmin.from('reporte_ventas').insert({
      cliente_telefono: telefono,
      cliente_nombre: clienteNombre,
      producto,
      precio_total: precioNumerico,
      direccion_entrega: direccion,
      metodo_pago: metodoPago,
      estado: metodoPago === 'transferencia' ? 'pagado' : 'apartado',
    })
    if (error) console.error('[bot] Error registrando venta:', error)
  } catch (err) { console.error('[bot] Error en registrarVenta:', err) }
}

function extraerTotalNumerico(total: string): number {
  const montos = String(total ?? '').match(/\d{1,6}(?:[,.]\d{2})?/g) ?? []
  if (montos.length === 0) return 0

  const normalizar = (monto: string) => Number(monto.replace(/,/g, '')) || 0
  const primero = normalizar(montos[0]!)

  // Los totales generados por el bot empiezan con el total y luego incluyen desglose.
  if (/^\s*\$?\s*\d/.test(total)) return primero

  // Si solo hay desglose tipo "ramo $500 + envio $80", registrar la suma.
  if (/[+]/.test(total) && montos.length > 1) {
    return Array.from(montos).reduce((sum, monto) => sum + normalizar(monto), 0)
  }

  return primero
}

export function mediaToBase64(media: Buffer | Uint8Array | ArrayBuffer): string {
  return Buffer.from(media as any).toString('base64' as BufferEncoding)
}


function fechaInicioFinCDMX(): { inicio: Date; fin: Date } {
  const ahora = new Date()
  const cdmxStr = ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
  const cdmx = new Date(cdmxStr)
  const inicio = new Date(Date.UTC(cdmx.getFullYear(), cdmx.getMonth(), cdmx.getDate()))
  const fin = new Date(Date.UTC(cdmx.getFullYear(), cdmx.getMonth(), cdmx.getDate(), 23, 59, 59, 999))
  return { inicio, fin }
}

async function obtenerVentasHoy(): Promise<{ total: number; cantidad: number }> {
  try {
    const { inicio, fin } = fechaInicioFinCDMX()

    const { data, error } = await supabaseAdmin
      .from('reporte_ventas')
      .select('precio_total')
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())

    if (error) throw error
    const cantidad = data?.length ?? 0
    const total = data?.reduce((sum, r) => sum + (r.precio_total || 0), 0) ?? 0
    return { total, cantidad }
  } catch (err) {
    console.error('[bot] Error obteniendo ventas hoy:', err)
    return { total: 0, cantidad: 0 }
  }
}

async function obtenerClientesAtendidosHoy(): Promise<number> {
  try {
    const { inicio, fin } = fechaInicioFinCDMX()

    const { count, error } = await supabaseAdmin
      .from('historial_chat')
      .select('*', { count: 'exact', head: true })
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())

    if (error) throw error
    return count ?? 0
  } catch (err) {
    console.error('[bot] Error obteniendo clientes hoy:', err)
    return 0
  }
}

export const COLA_POR_CLIENTE = new Map<string, Promise<void>>()
export const MENSAJES_POR_AGRUPAR = new Map<string, { mensajes: any[]; timer: NodeJS.Timeout }>()
export const MEDIA_POR_CLIENTE = new Map<string, { base64: string; mimetype: string; caption: string }[]>()
export const AGRUPAR_MENSAJES_MS = 60_000

export function encolarPorCliente(id: string, tarea: () => Promise<void>): void {
  const previa    = COLA_POR_CLIENTE.get(id) ?? Promise.resolve()
  const siguiente = previa.catch(() => {}).then(tarea).catch(e => console.error(`[bot] Cola ${id}:`, e))
  COLA_POR_CLIENTE.set(id, siguiente)
  siguiente.finally(() => { if (COLA_POR_CLIENTE.get(id) === siguiente) COLA_POR_CLIENTE.delete(id) })
}

export function encolarMensajeAgrupado(clienteId: string, msg: any): void {
  const actual = MENSAJES_POR_AGRUPAR.get(clienteId)
  if (actual) clearTimeout(actual.timer)

  const mensajes = [...(actual?.mensajes ?? []), msg]

  // Acumular media (imágenes) para enviarlas juntas
  if ((msg as any)._mediaBuffer) {
    const mediaActual = MEDIA_POR_CLIENTE.get(clienteId) || []
    mediaActual.push({
      base64: (msg as any)._mediaBuffer,
      mimetype: (msg as any)._mediaMime || 'image/jpeg',
      caption: getMensajeTexto(msg) || '',
    })
    MEDIA_POR_CLIENTE.set(clienteId, mediaActual)
  }

  const timer = setTimeout(() => {
    MENSAJES_POR_AGRUPAR.delete(clienteId)
    const textos = mensajes.map(m => getMessageBody(m)).filter(Boolean)
    const tieneMedia = mensajes.some(m => (m as any)._mediaBuffer)
    if (textos.length === 0 && !tieneMedia) return

    const base = mensajes.find(m => hasQuotedMsg(m)) ?? mensajes[mensajes.length - 1]
    base.body = textos.length > 0 ? textos.join('\n---\n') : '[Imagen sin texto]'
    for (const m of mensajes) {
      const id = obtenerMensajeId(m)
      if (id && m !== base) marcarMensajeProcesado(id)
    }

    const intervencion = obtenerIntervencionHumanaReciente(clienteId)
    const humanoRespondioDuranteEspera = intervencion && intervencion.haceMs < AGRUPAR_MENSAJES_MS + 1_500
    if (humanoRespondioDuranteEspera && intervencion.precio && esTextoReferenciaOCotizacion(base.body)) {
      console.log(`[bot] 🙋 Equipo cotizó durante la espera; Flora no duplica respuesta para ${clienteId}`)
      return
    }

    console.log(`[bot] 🧵 Batch ${mensajes.length} mensajes de ${clienteId} (${AGRUPAR_MENSAJES_MS/1000}s)`)
    if (esPedidoCotizador(base.body)) {
      encolarPorCliente(clienteId, () => procesarPedidoWeb(base))
    } else {
      encolarPorCliente(clienteId, () => msgHandler.procesarMensaje(base, sock))
    }
  }, AGRUPAR_MENSAJES_MS)
  timer.unref()

  MENSAJES_POR_AGRUPAR.set(clienteId, { mensajes, timer })
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN COTIZADOR WEB
// ════════════════════════════════════════════════════════════════

function esPedidoCotizador(texto: string): boolean {
  return (
    (texto.includes('NUEVO PEDIDO') && texto.includes('Florería RoCé')) ||
    (texto.includes('NUEVO PEDIDO') && texto.includes('Floreria RoCe')) ||
    (texto.includes('TOTAL A COBRAR') && texto.includes('MXN') && texto.includes('Flores del arreglo'))
  )
}

interface PedidoWebParseado {
  total: string; entrega: string; flores: string
  accesorios: string; tamano: string; envoltura: string
  nota: string; imagenUrl: string
}

function parsearPedidoCotizador(texto: string): PedidoWebParseado {
  const matchTotal  = texto.match(/TOTAL A COBRAR[:\s*]*\$?([\d,\.]+)\s*MXN/i)
  const matchTamano = texto.match(/Tama[ñn]o[:\s*]*([^\n]+)/i)
  const matchEnvolt = texto.match(/Envoltura[:\s*]*([^\n]+)/i)
  const matchImg    = texto.match(/(https?:\/\/[^\s]+(?:supabase|storage)[^\s]*)/i)
  const matchNota   = texto.match(/Nota[:\s\n]*([^\n]+)/i)

  const lineas     = texto.split('\n')
  const flores     = lineas.filter(l => l.trim().startsWith('•') && !l.includes('🧸') && !l.includes('🎀') && !l.toLowerCase().includes('peluche')).slice(0, 8).map(l => l.trim().replace(/^[•\*]\s*/, '')).join(', ')
  const accesorios = lineas.filter(l => l.trim().startsWith('•') && (l.includes('🧸') || l.includes('🎀') || l.toLowerCase().includes('peluche'))).map(l => l.trim().replace(/^[•\*]\s*/, '')).join(', ')

  let entrega = 'Por confirmar'
  if (texto.includes('Envío a domicilio') || texto.includes('Envio a domicilio')) {
    const z = texto.match(/Zona:\s*([^\n]+)/i)
    entrega = z ? `Envío — ${z[1].trim()}` : 'Envío a domicilio'
  } else if (texto.includes('Recolección en tienda') || texto.includes('Sucursal')) {
    const s = texto.match(/Sucursal\s+([^\n]+)/i)
    entrega = s ? `Recoger — Sucursal ${s[1].trim()}` : 'Recoger en sucursal'
  }

  return {
    total:     matchTotal  ? `$${matchTotal[1]} MXN`                 : 'Por confirmar',
    tamano:    matchTamano ? matchTamano[1].trim().replace(/\*/g, '') : 'Por definir',
    envoltura: matchEnvolt ? matchEnvolt[1].trim().replace(/\*/g, '') : 'Incluida',
    imagenUrl: matchImg    ? matchImg[1]                              : '',
    nota:      matchNota   ? matchNota[1].trim().replace(/\*/g, '')   : '',
    flores:    flores      || 'Ver imagen de referencia',
    accesorios,
    entrega,
  }
}

export const VENTA_ACTUAL = new Map<string, VentaCerrada>()
type EstadoFlujoPedido = 'sin_pedido' | 'cotizando' | 'esperando_precio_equipo' | 'precio_confirmado' | 'esperando_fecha_hora' | 'esperando_entrega' | 'esperando_nombre' | 'esperando_pago' | 'apartado_sucursal' | 'pagado_transferencia' | 'cerrado' | 'cancelado'

function pedidoActual(clienteId: string): PedidoActual {
  return obtenerPedido(clienteId) ?? crearPedido(clienteId, '')
}

export function marcarFotosDisponibles(clienteId: string): void {
  FOTOS_DISPONIBLES_RECIENTES.set(clienteId, Date.now())
}

export function hayFotosDisponiblesRecientes(clienteId: string): boolean {
  const timestamp = FOTOS_DISPONIBLES_RECIENTES.get(clienteId)
  return Boolean(timestamp && Date.now() - timestamp < FOTOS_DISPONIBLES_TTL_MS)
}

function totalExtrasPedido(clienteId: string): number {
  return (pedidoActual(clienteId).extras ?? []).reduce((sum, extra) => sum + extra.precio, 0)
}

function extrasPedidoTexto(clienteId: string): string | null {
  const extras = pedidoActual(clienteId).extras ?? []
  if (extras.length === 0) return null
  return extras.map(extra => `${extra.nombre} $${extra.precio.toFixed(2)} MXN`).join(', ')
}

function totalPedidoNumerico(clienteId: string): number | null {
  const pedido = pedidoActual(clienteId)
  const arreglo = pedido.arreglo
  const subtotal = arreglo?.precio ?? pedido.precioPersonalizado
  if (!subtotal) return null
  return subtotal + totalExtrasPedido(clienteId) + (pedido.envio?.precio ?? 0)
}

function estadoFlujoDesdeEstado(estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado', pedido?: PedidoActual): EstadoFlujoPedido {
  if (estado === 'cancelado') return 'cancelado'
  if (estado === 'entregado') return 'cerrado'
  if (estado === 'pagado') return 'pagado_transferencia'
  if (pedido?.estadoFlujo) return pedido.estadoFlujo as EstadoFlujoPedido
  if (estado === 'apartado') return pedido?.metodoPago === 'transferencia' ? 'esperando_pago' : 'apartado_sucursal'
  if (pedido?.fotoReferenciaBase64) return 'esperando_precio_equipo'
  if (pedido?.precioPersonalizado) return 'precio_confirmado'
  return 'cotizando'
}

function resumirPedidoOperativo(clienteId: string, telefono: string | null): string {
  const pedido = pedidoActual(clienteId)
  const arreglo = pedido.arreglo
  const subtotal = arreglo?.precio ?? pedido.precioPersonalizado ?? 0
  const extras = totalExtrasPedido(clienteId)
  const envio = pedido.envio?.precio ?? 0
  const total = subtotal + extras + envio
  return [
    `cliente_nombre: ${pedido.nombre ?? 'Por confirmar'}`,
    `telefono: ${telefono ?? 'Por confirmar'}`,
    `producto: ${arreglo?.nombre ?? pedido.productoPersonalizado ?? 'Por confirmar'}`,
    `detalles_especiales: ${pedido.detallesEspeciales ?? pedido.nota ?? 'Sin notas'}`,
    `precio_arreglo: ${subtotal || 'Por confirmar'}`,
    `extras: ${extrasPedidoTexto(clienteId) ?? 'Sin extras'}`,
    `precio_envio: ${envio || 0}`,
    `total: ${total || 'Por confirmar'}`,
    `entrega: ${pedido.envio ? 'domicilio' : (pedido.sucursal ? 'sucursal' : 'Por confirmar')}`,
    `sucursal/direccion: ${pedido.direccion ?? pedido.sucursal ?? pedido.envio?.zona ?? 'Por confirmar'}`,
    `fecha/hora: ${[pedido.fechaEntrega, pedido.horaEntrega].filter(Boolean).join(' ') || 'Por confirmar'}`,
    `metodo_pago: ${pedido.metodoPago ?? 'Por confirmar'}`,
    `tiene_foto_referencia: ${pedido.fotoReferenciaBase64 ? 'si' : 'no'}`,
  ].join('\n')
}

async function persistirPedido(clienteId: string, telefono: string | null, estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado', ultimoMensaje?: string): Promise<void> {
  persistirPedidosEngine()
}

function resetearPedidoCliente(clienteId: string): void {
  archivarPedido(clienteId, 'Venta cerrada — fin de ciclo')
  VENTA_ACTUAL.delete(clienteId)
  FOTOS_DISPONIBLES_RECIENTES.delete(clienteId)
}

function resetearPedidoActivo(clienteId: string): void {
  archivarPedido(clienteId, 'Reset por cambio de contexto')
  VENTA_ACTUAL.delete(clienteId)
}

function ventaDesdeEstado(clienteId: string, fallback?: VentaCerrada): VentaCerrada | null {
  const pedido = pedidoActual(clienteId)
  const elegido = pedido.arreglo
  if (!elegido && !pedido.productoPersonalizado && !fallback) return null

  const producto = elegido?.nombre ?? fallback?.producto ?? 'Pedido'
  const subtotal = elegido?.precio ?? pedido.precioPersonalizado ?? (parseFloat(String(fallback?.total ?? '').replace(/[^0-9.]/g, '')) || 0)
  const extras = totalExtrasPedido(clienteId)
  const envio = pedido.envio?.precio ?? 0
  const total = subtotal + extras + envio
  const direccion = pedido.envio?.zona
    ? `${pedido.envio.zona}${pedido.direccion ? ` — ${pedido.direccion}` : ''}`
    : (pedido.sucursal ? `Sucursal ${pedido.sucursal}` : (pedido.direccion ?? fallback?.direccion ?? 'Por confirmar'))

  const desglose = [`ramo $${subtotal.toFixed(2)}`]
  if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
  if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
  const totalTexto = desglose.length > 1
    ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})`
    : `$${total.toFixed(2)} MXN`

  return {
    cliente: pedido.nombre ?? obtenerPedido(clienteId)?.nombre ?? fallback?.cliente ?? 'Verificar en chat',
    producto,
    total: totalTexto,
    direccion,
  }
}

function precioPedidoActual(clienteId: string): number {
  const pedido = pedidoActual(clienteId)
  return pedido.arreglo?.precio ?? pedido.precioPersonalizado ?? 0
}

function tienePrecioConfirmado(clienteId: string): boolean {
  return precioPedidoActual(clienteId) > 0
}

function tieneNombreValido(clienteId: string): boolean {
  const nombre = pedidoActual(clienteId).nombre
  return Boolean(nombre && !/verificar|confirmar|chat/i.test(nombre))
}

function ventaListaParaCerrar(clienteId: string): boolean {
  return tienePrecioConfirmado(clienteId) && tieneNombreValido(clienteId) && !faltaFechaHoraParaCerrar(clienteId)
}

function ventaListaParaPagoTransferencia(clienteId: string): boolean {
  const pedido = pedidoActual(clienteId)
  return Boolean(tienePrecioConfirmado(clienteId) && tieneNombreValido(clienteId) && (pedido.direccion || pedido.sucursal || pedido.envio?.zona))
}

function apartadoSucursalListo(clienteId: string): boolean {
  const pedido = pedidoActual(clienteId)
  return Boolean(pedido.sucursal && ventaListaParaCerrar(clienteId))
}

function pedidoEstaCerrado(clienteId: string): boolean {
  const pedido = obtenerPedido(clienteId)
  if (!pedido?.estado) return false
  return [
    EstadoPedido.APARTADO,
    EstadoPedido.EN_PRODUCCION,
    EstadoPedido.LISTO,
    EstadoPedido.ENTREGADO,
    EstadoPedido.ARCHIVADO,
    EstadoPedido.CANCELADO,
  ].includes(pedido.estado)
}

function tieneArregloVerificado(clienteId: string): boolean {
  const pedido = pedidoActual(clienteId)
  return Boolean(pedido.arreglo || pedido.productoPersonalizado)
}

function precioArregloTexto(clienteId: string): string {
  const pedido = pedidoActual(clienteId)
  const precio = pedido.arreglo?.precio ?? pedido.precioPersonalizado ?? 0
  return `$${precio.toFixed(2)} MXN`
}

function totalDashboardPedido(clienteId: string, fallback: string): string {
  const total = totalPedidoNumerico(clienteId)
  return total && total > 0 ? `$${total.toFixed(2)} MXN` : fallback
}

function faltaFechaHoraParaCerrar(clienteId: string): boolean {
  const pedido = pedidoActual(clienteId)
  return !pedido.fechaEntrega || !pedido.horaEntrega
}

async function simularEscritura(jid: string, ms: number): Promise<void> {
  if (!sock) return
  try {
    await sock.sendPresenceUpdate('composing', jid)
    await new Promise(r => setTimeout(r, ms))
    await sock.sendPresenceUpdate('paused', jid)
  } catch { /* no fatal */ }
}

// ════════════════════════════════════════════════════════════════
// FLUJO: PEDIDO DEL COTIZADOR WEB
// ════════════════════════════════════════════════════════════════

async function syncPedidoFromDashboard(clienteId: string, updates: Record<string, unknown>): Promise<void> {
  const pedido = obtenerPedido(clienteId)
  if (!pedido) return

  if (typeof updates.cliente_nombre === 'string') pedido.nombre = updates.cliente_nombre
  if (typeof updates.producto === 'string') pedido.productoPersonalizado = updates.producto
  if (typeof updates.precio_arreglo === 'number') pedido.precioPersonalizado = updates.precio_arreglo
  if (typeof updates.sucursal === 'string') pedido.sucursal = updates.sucursal
  if (typeof updates.direccion === 'string') pedido.direccion = updates.direccion
  if (typeof updates.metodo_pago === 'string') pedido.metodoPago = updates.metodo_pago as any
  if (typeof updates.nota === 'string') pedido.nota = updates.nota
  if (typeof updates.fecha_entrega === 'string') pedido.fechaEntrega = updates.fecha_entrega
  if (typeof updates.hora_entrega === 'string') pedido.horaEntrega = updates.hora_entrega
  if (typeof updates.detalles_especiales === 'string') pedido.detallesEspeciales = updates.detalles_especiales
  if (typeof updates.zona_envio === 'string') {
    const base = pedido.envio ?? { zona: updates.zona_envio, precio: 0 }
    pedido.envio = { ...base, zona: updates.zona_envio }
  }
  if (typeof updates.precio_envio === 'number') {
    const base = pedido.envio ?? { zona: '', precio: updates.precio_envio }
    pedido.envio = { ...base, precio: updates.precio_envio }
  }

  if (typeof updates.estado === 'string') {
    const estadoMap: Record<string, EstadoPedido> = {
      cotizacion: EstadoPedido.COTIZANDO,
      apartado: EstadoPedido.APARTADO,
      pagado: EstadoPedido.EN_PRODUCCION,
      entregado: EstadoPedido.ENTREGADO,
      cancelado: EstadoPedido.CANCELADO,
    }
    const nuevo = estadoMap[updates.estado]
    if (nuevo && pedido.estado !== nuevo) transitar(pedido, nuevo)
  }
}

async function procesarPedidoWeb(msg: any): Promise<void> {
  const clienteId        = msg.key?.remoteJid as string
  const texto            = getMensajeTexto(msg) || ''
  const pedido           = parsearPedidoCotizador(texto)
  const numeroRealPromise = obtenerNumeroReal(msg)
  const jid = msg.key?.remoteJid

  if (!jid) return
  await simularEscritura(jid, 1500)
  await responderMensaje(msg,
    `¡Qué bonita elección! 🌸 Ya recibimos tu pedido.\n\n` +
    `💐 ${pedido.flores.slice(0, 60)}${pedido.flores.length > 60 ? '...' : ''}\n` +
    `💰 Total: *${pedido.total}*\n` +
    `📍 ${pedido.entrega}\n\n` +
    `Realiza tu pago a:\n` +
    `BBVA | 4152314097305273 | Devi América Cerenil\n` +
    `_(Concepto: tu nombre o usuario de WhatsApp)_\n\n` +
    `Mándame tu comprobante y listo. ¡Con mucho gusto! 🌹`
  )

  const numeroReal = await numeroRealPromise
  console.log(`[bot] 🛒 Pedido cotizador web de ${numeroReal}`)
  eventBus.emit(EventType.ORDER_CREATED, {
    telefono: numeroReal, producto: pedido.flores, total: parseFloat(pedido.total.replace(/[^0-9.]/g, '')) || 0,
    sucursal: pedido.entrega, descripcion: `Pedido web: ${pedido.tamano}, ${pedido.envoltura}${pedido.nota ? ` | Nota: ${pedido.nota}` : ''}`,
  })
}

// ════════════════════════════════════════════════════════════════
// FLUJO: MENSAJE DEL EQUIPO (fromMe)
// ════════════════════════════════════════════════════════════════

function esMensajeFotosDisponiblesEquipo(texto: string): boolean {
  return /\b(esos?|estos?|ramitos?|ramos?|arreglos?)\b.*\b(disponibles?|tenemos|hay)\b|\b(disponibles?|tenemos|hay)\b.*\b(esos?|estos?|ramitos?|ramos?|arreglos?)\b/i.test(texto)
}

export async function procesarMensajeEquipo(remoteJid: string, msgType: string, body: string): Promise<void> {
  const telefonoDestino = remoteJid.replace(/@[^\s]*/g, '').trim()
  if (!telefonoDestino) return
  const num = telefonoDestino.startsWith('52') ? `+${telefonoDestino}` : telefonoDestino
  if (msgType === 'image' || msgType === 'document') marcarFotosDisponibles(remoteJid)
  registrarIntervencionHumana(remoteJid, body)
  await agregarAlHistorial(num, 'assistant', `[Agente: ${body.trim()}]`)
  if (esMensajeFotosDisponiblesEquipo(body)) marcarFotosDisponibles(remoteJid)
  const precioAgente = extraerPrecioRespuesta(body)
  if (precioAgente) {
    const pedido = pedidoActual(remoteJid)
    if (pedido.esperandoPrecioEnvio || /\b(env[ií]o|flete|reparto|domicilio|llevar)\b/i.test(body)) {
      pedido.envio = { zona: pedido.envio?.zona ?? 'Envío confirmado por equipo', precio: precioAgente }
      pedido.esperandoPrecioEnvio = false
      if (pedido.precioPersonalizado || pedido.arreglo) pedido.estadoFlujo = 'esperando_pago'
      if (pedido.precioPersonalizado || pedido.arreglo) transitarDesdeFlujo(remoteJid, 'esperando_pago')
    } else {
      pedido.productoPersonalizado ||= 'Ramo personalizado'
      pedido.precioPersonalizado = precioAgente
      pedido.precioConfirmadoPor = 'equipo'
      pedido.estadoFlujo = 'precio_confirmado'
      transitarDesdeFlujo(remoteJid, 'precio_confirmado')
    }
    persistirPedido(remoteJid, num, 'cotizacion', `[Agente: ${body.trim()}]`).catch(() => {})
  }
  if (/\b(gracias\s+por\s+(su\s+)?pago|pago\s+recibido|comprobante\s+recibido|le\s+agendamos|queda\s+agendado|pagado)\b/i.test(body)) {
    const pedido = pedidoActual(remoteJid)
    pedido.metodoPago = 'transferencia'
    pedido.estadoFlujo = 'pagado_transferencia'
    transitarDesdeFlujo(remoteJid, 'pagado_transferencia')
    const venta = ventaDesdeEstado(remoteJid)
    if (venta && ventaListaParaPagoTransferencia(remoteJid)) {
      ventaCerradaHandler(remoteJid, venta, num).catch(() => {})
    } else {
      persistirPedido(remoteJid, num, 'pagado', `[Agente confirmó pago: ${body.trim()}]`).catch(() => {})
    }
  }
}
// ════════════════════════════════════════════════════════════════
// VENTA CERRADA
// ════════════════════════════════════════════════════════════════

async function ventaCerradaHandler(clienteId: string, venta: VentaCerrada, telefono: string): Promise<void> {
  const numeroReal = telefono.startsWith('+') ? telefono : `+${telefono}`
  const pedido = pedidoActual(clienteId)
  pedido.metodoPago ||= 'transferencia'
  pedido.estadoFlujo = 'pagado_transferencia'
  transitarDesdeFlujo(clienteId, 'pagado_transferencia')
  pedido.cerradoEn = new Date().toISOString()

  console.log(`[bot] 💰 Venta cerrada: ${venta.cliente} — ${venta.producto} — ${venta.total}`)
  await registrarVenta(venta.cliente, numeroReal, venta.producto, totalDashboardPedido(clienteId, venta.total), venta.direccion, 'transferencia')
  await persistirPedido(clienteId, numeroReal, 'pagado')

  eventBus.emit(EventType.PAYMENT_RECEIVED, {
    telefono: numeroReal,
    cliente: venta.cliente,
    producto: venta.producto,
    total: parseFloat(venta.total.replace(/[^0-9.]/g, '')) || 0,
    metodoPago: 'Transferencia',
  })
  eventBus.emit(EventType.PAYMENT_CONFIRMED, {
    telefono: numeroReal,
    cliente: venta.cliente,
    producto: venta.producto,
    total: parseFloat(venta.total.replace(/[^0-9.]/g, '')) || 0,
    metodoPago: 'Transferencia',
  })
  eventBus.emit(EventType.ORDER_CREATED, {
    telefono: numeroReal,
    cliente: venta.cliente,
    producto: venta.producto,
    total: parseFloat(venta.total.replace(/[^0-9.]/g, '')) || 0,
    sucursal: venta.direccion,
    metodoPago: 'Transferencia',
    descripcion: 'Pago recibido - venta completada',
    precioArreglo: precioArregloTexto(clienteId),
    precioExtras: extrasPedidoTexto(clienteId) ?? undefined,
    precioEnvio: pedido?.envio?.precio,
    fechaHora: [pedido?.fechaEntrega, pedido?.horaEntrega].filter(Boolean).join(' ') || undefined,
    tieneFotoReferencia: pedido?.fotoReferenciaBase64 ? true : undefined,
  } as any)
  resetearPedidoCliente(clienteId)
}

async function pedidoApartadoHandler(clienteId: string, venta: VentaCerrada, telefono: string, metodoPago: string): Promise<void> {
  const numeroReal = telefono.startsWith('+') ? telefono : `+${telefono}`
  const pedido = pedidoActual(clienteId)
  pedido.estadoFlujo = 'apartado_sucursal'
  transitarDesdeFlujo(clienteId, 'apartado_sucursal')
  pedido.cerradoEn = new Date().toISOString()
  console.log(`[bot] 📦 Pedido apartado: ${venta.cliente} — ${venta.producto} — ${venta.total}`)
  await registrarVenta(venta.cliente, numeroReal, venta.producto, totalDashboardPedido(clienteId, venta.total), venta.direccion, metodoPago)
  await persistirPedido(clienteId, numeroReal, 'apartado')
  eventBus.emit(EventType.PAYMENT_PENDING, {
    telefono: numeroReal,
    cliente: venta.cliente,
    producto: venta.producto,
    total: parseFloat(venta.total.replace(/[^0-9.]/g, '')) || 0,
    sucursal: venta.direccion,
    metodoPago,
  })
  resetearPedidoActivo(clienteId)
}

// ════════════════════════════════════════════════════════════════
// PRECIOS DE FLORES (del system prompt)
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// ESTADO DEL BOT (variables globales)
// ════════════════════════════════════════════════════════════════

let BOT_QR_EMITIDO = false
let BOT_QR_ACTUAL: string | null = null
let BOT_QR_GENERADO_EN: number | null = null
const BOT_QR_TTL_MS = 60_000
const QR_SCAN_GRACE_MS = 15 * 60_000
let BOT_RECONNECTING = false
let RECONNECT_START = 0
let WATCHDOG_INICIADO = false
let BOT_ESTADO: 'iniciando' | 'esperando_qr' | 'conectado' | 'reconectando' | 'desconectado' | 'error' = 'iniciando'
let BOT_ESTADO_DETALLE = 'Arrancando bot'
let ULTIMO_COMANDO_BOT: string | null = null
let BOT_READY = false
let sock: ReturnType<typeof makeWASocket> | null = null
let BOT_CONNECTION: 'connecting' | 'open' | 'close' = 'connecting'
let PRESENCE_INTERVAL: NodeJS.Timeout | null = null
let RECONNECT_TIMER: NodeJS.Timeout | null = null

function actualizarEstadoBot(estado: typeof BOT_ESTADO, detalle: string): void {
  BOT_ESTADO = estado
  BOT_ESTADO_DETALLE = detalle
}

async function guardarConfigBot(clave: string, valor: string): Promise<void> {
  let ultimoError: unknown = null
  for (let intento = 1; intento <= 3; intento++) {
    const { error } = await supabaseAdmin
      .from('configuracion_bot')
      .upsert({ clave, valor }, { onConflict: 'clave' })
    if (!error) return
    ultimoError = error
    await new Promise(r => setTimeout(r, 500 * intento))
  }
  throw ultimoError
}

async function publicarEstadoBot(): Promise<void> {
  const qrAgeMs = BOT_QR_GENERADO_EN ? Date.now() - BOT_QR_GENERADO_EN : null
  const estadoReal = BOT_READY && sock?.user ? 'conectado' : BOT_ESTADO
  const conectado = estadoReal === 'conectado'
  const payload = {
    connected: conectado,
    estado: conectado ? 'conectado' : BOT_ESTADO,
    estadoDetalle: conectado ? 'WhatsApp conectado' : BOT_ESTADO_DETALLE,
    reconnecting: BOT_RECONNECTING,
    qrGeneradoEn: BOT_QR_GENERADO_EN ? new Date(BOT_QR_GENERADO_EN).toISOString() : null,
    qrAgeSeconds: qrAgeMs === null ? null : Math.round(qrAgeMs / 1000),
    qrExpiresInSeconds: qrAgeMs === null ? null : Math.max(0, Math.ceil((BOT_QR_TTL_MS - qrAgeMs) / 1000)),
    qrScanGraceSeconds: qrAgeMs === null ? null : Math.max(0, Math.ceil((QR_SCAN_GRACE_MS - qrAgeMs) / 1000)),
    qrVencido: qrAgeMs === null ? false : qrAgeMs > BOT_QR_TTL_MS,
    ultimaActividad: `${Math.round((Date.now() - ultimaActividad) / 60_000)} min`,
    heartbeat: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await guardarConfigBot('bot_status', JSON.stringify(payload))
}

async function revisarComandoRemoto(): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'bot_command')
      .maybeSingle()
    if (error || !data?.valor) return

    const comando = JSON.parse(data.valor) as { id?: string; action?: string }
    if (!comando.id || comando.id === ULTIMO_COMANDO_BOT) return

    ULTIMO_COMANDO_BOT = comando.id
    await guardarConfigBot('bot_command', '')

    if (comando.action === 'reconnect') {
      reiniciarProceso('Reinicio remoto desde dashboard', false)
    } else if (comando.action === 'recover') {
      reiniciarProceso('Rescate remoto desde dashboard', false)
    }
  } catch (err) {
    console.warn('[bot] No se pudo revisar comando remoto:', err)
  }
}

function reiniciarProceso(motivo: string, contarCrash = true): never {
  console.error(`[bot] 🔄 Reinicio forzado: ${motivo}`)
  if (contarCrash) registrarCrash()
  process.exit(1)
}

function limpiarSocketActual(): void {
  if (PRESENCE_INTERVAL) {
    clearInterval(PRESENCE_INTERVAL)
    PRESENCE_INTERVAL = null
  }

  const actual = sock
  sock = null
  if (!actual) return

  try { (actual.ev as any)?.removeAllListeners?.() } catch {}
  try { actual.end(undefined) } catch {}
}

function programarReinicioBaileys(motivo: string, delayMs = 5_000): void {
  if (RECONNECT_TIMER) return

  BOT_RECONNECTING = true
  RECONNECT_START = Date.now()
  actualizarEstadoBot('reconectando', motivo)
  publicarEstadoBot().catch(() => {})

  RECONNECT_TIMER = setTimeout(() => {
    RECONNECT_TIMER = null
    limpiarSocketActual()
    iniciarBaileys().catch(err => {
      console.error('[bot] ❌ Error reconectando:', err)
      registrarCrash()
      process.exit(1)
    })
  }, delayMs)
  RECONNECT_TIMER.unref()
}

// ════════════════════════════════════════════════════════════════
// INICIALIZACIÓN BAILEYS
// ════════════════════════════════════════════════════════════════

async function iniciarBaileys(): Promise<void> {
  BOT_CONNECTION = 'connecting'
  actualizarEstadoBot(BOT_RECONNECTING ? 'reconectando' : 'iniciando', BOT_RECONNECTING ? 'Reconectando WhatsApp' : 'Arrancando bot')

  const { state, saveCreds } = await useMultiFileAuthState(
    process.env.BAILEYS_DATA_PATH || './.baileys_auth'
  )
  setBaileysKeys(state.keys)

  // Verificar versión más reciente de Baileys para alerta de API
  verificarVersionBaileys().catch(() => {})

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.windows('Jardin RoCe'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    // shouldSyncHistory no disponible en v7
    markOnlineOnConnect: true,
    emitOwnEvents: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      BOT_QR_EMITIDO = true
      BOT_QR_ACTUAL = qr
      BOT_QR_GENERADO_EN = Date.now()
      actualizarEstadoBot('esperando_qr', 'QR generado, esperando escaneo')
      console.log('\n📱 Subiendo nuevo QR a Supabase...')
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data, error } = await supabaseAdmin
            .from('configuracion_agente')
            .update({ qr_code: qr })
            .eq('id', 1)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data) {
            const { error: insErr } = await supabaseAdmin
              .from('configuracion_agente')
              .insert({ id: 1, qr_code: qr, bot_pausado: false })
            if (insErr) throw insErr
          }
          console.log(data ? '✅ QR guardado.' : '✅ QR guardado (INSERT).')
          break
        } catch (err) {
          console.error(`❌ Error QR Supabase (intento ${attempt + 1}/3):`, err)
          if (attempt < 2) await new Promise(r => setTimeout(r, 3000))
        }
      }
      publicarEstadoBot().catch(() => {})
      console.log('\n⚡ ¡NUEVO QR! Escanéalo ahora:')
      qrcode.generate(qr, { small: true })
      eventBus.emit(EventType.QR_GENERATED, { telefono: 'system' })
    }

    if (connection === 'open') {
      BOT_CONNECTION = 'open'
      BOT_RECONNECTING = false
      RECONNECT_START = 0
      BOT_READY = true
      actualizarEstadoBot('conectado', 'WhatsApp conectado')
      publicarEstadoBot().catch(() => {})
      console.log('\n✅ Bot de Jardín RoCe conectado!')
      console.log('🌸 Flora está escuchando...\n')
      ultimaActividad = Date.now()
      resetearEstadoCrash()
      if (BOT_QR_EMITIDO) eventBus.emit(EventType.BOT_CONNECTED, { telefono: 'system' })
      BOT_QR_ACTUAL = null
      BOT_QR_GENERADO_EN = null
      try {
        await supabaseAdmin.from('configuracion_agente').update({ qr_code: null }).eq('id', 1)
      } catch {}
    }

    if (connection === 'close') {
      BOT_CONNECTION = 'close'
      BOT_READY = false
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
      const isLoggedOut = reason === DisconnectReason.loggedOut
      const isBadSession = reason === DisconnectReason.badSession
      const isForbidden = reason === DisconnectReason.forbidden
      const isRestart = reason === DisconnectReason.restartRequired

      console.warn(`⚠️ Conexión cerrada: ${reason || 'desconocido'}`)

      if (isRestart) {
        programarReinicioBaileys('WhatsApp solicitó reinicio de conexión', 1_500)
        return
      }

      actualizarEstadoBot('desconectado', `Conexión cerrada (${reason})`)
      publicarEstadoBot().catch(() => {})
      eventBus.emit(EventType.BOT_DISCONNECTED, { telefono: 'system', descripcion: `Conexión cerrada (${reason || 'desconocido'})` })

      if (isLoggedOut || isBadSession || isForbidden) {
        reiniciarProceso(`Sesión inválida (${reason})`)
      } else {
        programarReinicioBaileys(`Reconectando tras cierre (${reason || 'desconocido'})`, 5_000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        await messageEntry.procesarMensajeEntrante(msg)
      } catch (err) {
        console.error('[bot] Error en messages.upsert:', err)
      }
    }
  })

  sock.ev.on('messaging-history.set', async ({ chats, messages, isLatest }) => {
    if (!isLatest) return
    try {
      await messageEntry.rescatarMensajesNoLeidos(chats, messages)
    } catch (err) {
      console.error('[bot] Error rescatando mensajes no leídos:', err)
    }
  })

  // Mantener presencia activa cada 2 minutos
  if (PRESENCE_INTERVAL) clearInterval(PRESENCE_INTERVAL)
  PRESENCE_INTERVAL = setInterval(() => {
    if (sock) {
      sock.sendPresenceUpdate('available').catch(() => {})
    }
  }, 2 * 60_000)
  PRESENCE_INTERVAL.unref()
}

// ════════════════════════════════════════════════════════════════
// VERIFICACIÓN DE VERSIÓN DE BAILEYS
// ════════════════════════════════════════════════════════════════

const BAILEYS_VERSION = '7.0.0-rc13'
let ULTIMA_VERIF_BAILEYS = 0

async function verificarVersionBaileys(): Promise<void> {
  try {
    const res = await fetch('https://registry.npmjs.org/@whiskeysockets/baileys/latest')
    const data = await res.json() as { version?: string }
    const latest = data?.version
    if (latest && latest !== BAILEYS_VERSION) {
      console.warn(`[bot] ⚠️ Nueva versión de Baileys disponible: ${latest} (instalada: ${BAILEYS_VERSION})`)
      console.warn('[bot] ⚠️ Revisa breaking changes antes de actualizar: https://github.com/WhiskeySockets/Baileys/releases')
      await guardarConfigBot('baileys_version_alerta', JSON.stringify({
        instalada: BAILEYS_VERSION,
        disponible: latest,
        detectada: new Date().toISOString(),
      })).catch(() => {})
    }
  } catch {
    // Si no hay internet, ignorar
  }
}

// ════════════════════════════════════════════════════════════════
// PUBLICACIÓN DE ESTADO Y COMANDOS REMOTOS
// ════════════════════════════════════════════════════════════════

setInterval(() => {
  publicarEstadoBot().catch(() => {})
}, 15_000).unref()

setInterval(() => {
  revisarComandoRemoto().catch(() => {})
}, 5_000).unref()

// Verificar versión de Baileys cada 24h
setInterval(() => {
  verificarVersionBaileys().catch(() => {})
}, 24 * 60 * 60_000).unref()

// ════════════════════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════════════════════

console.log('🌸 Iniciando bot de Jardín RoCe...')

const BOT_START_TIME = Date.now()
const STARTUP_WARN_SECONDS = 180
const STARTUP_RESTART_SECONDS = 600
const QR_SCAN_TIMEOUT_SECONDS = 300

const startupWatchdog = setInterval(() => {
  const elapsed = Math.round((Date.now() - BOT_START_TIME) / 1000)
  if (BOT_READY) { clearInterval(startupWatchdog); return }

  if (BOT_QR_EMITIDO) {
    const qrAgeMs = BOT_QR_GENERADO_EN ? Date.now() - BOT_QR_GENERADO_EN : Date.now() - BOT_START_TIME
    if (elapsed % 120 < 31) console.log(`[Startup] ⏳ Esperando escaneo QR... (${Math.round(elapsed / 60)} min)`)
    if (qrAgeMs > QR_SCAN_GRACE_MS) {
      reiniciarProceso(`QR sin escanear por ${Math.round(qrAgeMs / 60_000)} min`)
    }
    return
  }

  if (elapsed > STARTUP_WARN_SECONDS && elapsed % 60 < 31) {
    console.warn(`[Startup] ⏰ ${elapsed}s sin conexión. Estado: ${BOT_CONNECTION}`)
  }

  if (elapsed > STARTUP_RESTART_SECONDS && !BOT_READY) {
    clearInterval(startupWatchdog)
    reiniciarProceso(`${elapsed}s sin conexión`)
  }
}, 30_000)
startupWatchdog.unref()

const msgHandler = createMessageHandler({
  pedidoActual,
  responderMensaje,
  ventaCerradaHandler,
  pedidoApartadoHandler,
  ventaDesdeEstado,
  persistirPedido,
  ventaListaParaCerrar,
  ventaListaParaPagoTransferencia,
  pedidoEstaCerrado,
  tieneArregloVerificado,
  tienePrecioConfirmado,
  tieneNombreValido,
  resetearPedidoActivo,
  marcarFotosDisponibles,
  hayFotosDisponiblesRecientes,
  totalExtrasPedido,
  extrasPedidoTexto,
  totalDashboardPedido,
  precioArregloTexto,
  MEDIA_POR_CLIENTE,
  apartadoSucursalListo,
})
const messageEntry = createMessageEntry({
  responderMensaje,
  marcarFotosDisponibles,
  encolarPorCliente,
  encolarMensajeAgrupado,
  procesarMensajeEquipo,
  verificarSiBotPausado,
  mediaToBase64,
  TIPOS_MEDIA_NO_SOPORTADOS,
  registrarActividad,
})
cargarEstado().catch(() => {})
subscribeTelegramEvents()
subscribeLogEvents()
logger.info('bot', 'Bot iniciado — observabilidad activa')
setInterval(() => {
  Promise.resolve(
    supabaseAdmin
      .from('configuracion_bot')
      .upsert({ clave: 'bot_metrics', valor: JSON.stringify(metrics.getSnapshot()) })
  ).catch(() => {})
}, 30_000).unref?.()
iniciarPersistenciaPeriodica()
cargarPedidosDesdeBD().catch(() => {})
iniciarBaileys().catch((err) => { console.error('❌ Error:', err); registrarCrash(); process.exit(1) })

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚠️ ${signal} recibido — cerrando graceful...`)
  const timer = setTimeout(() => {
    console.warn('[shutdown] Timeout 10s — forzando exit.')
    process.exit(1)
  }, 10_000)
  timer.unref()

  try {
    await guardarEstado()
  } catch (e) {
    console.error('[shutdown] Error guardando estado:', e)
  }

  try {
    if (sock) sock.end(undefined)
  } catch (e) {
    console.error('[shutdown] Error al cerrar:', e)
  }
  clearTimeout(timer)
  process.exit(0)
}

function getDiagnosticoChat(chatId: string): import('./src/api/server').DiagnosticoChat | null {
  const pedido = pedidoActual(chatId)
  const pedidoEngine = obtenerPedido(chatId)
  const arreglo = pedidoActual(chatId).arreglo ?? null
  return {
    clienteId: chatId,
    pedidoEnCurso: pedido as unknown as Record<string, unknown> | null,
    ventaCerrada: pedidoEstaCerrado(chatId),
    arregloElegido: arreglo,
    pedidoEngine: (pedidoEngine ? { ...pedidoEngine, fotoReferenciaBase64: pedidoEngine.fotoReferenciaBase64 ? '(presente)' : undefined } : null) as unknown as Record<string, unknown> | null,
    casoActivo: null,
    tienePrecio: tienePrecioConfirmado(chatId),
    tieneNombre: tieneNombreValido(chatId),
    fechaHora: pedido.fechaEntrega || pedido.horaEntrega ? { fecha: pedido.fechaEntrega, hora: pedido.horaEntrega } : null,
    tieneFotoReferencia: Boolean(pedido.fotoReferenciaBase64),
    estadoFlujo: pedido?.estadoFlujo ?? null,
  }
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('uncaughtException',  (err) => {
  logger.error('bot', 'Excepción no capturada', { error: String(err), stack: (err as Error)?.stack })
})
process.on('unhandledRejection', (r) => {
  logger.error('bot', 'Promesa rechazada sin manejar', { reason: String(r) })
})
process.on('beforeExit', () => {
  void flushLogsNow()
  Promise.resolve(
    supabaseAdmin
      .from('configuracion_bot')
      .upsert({ clave: 'bot_metrics', valor: JSON.stringify(metrics.getSnapshot()) })
  ).catch(() => {})
})


startServer({
  getPausado: () => BOT_PAUSADO,
  setPausado: (v) => { BOT_PAUSADO = v; ultimaVerifPausa = Date.now() },
  reiniciarProceso: (motivo, contarCrash = true) => reiniciarProceso(motivo, contarCrash),
  getEstado: () => BOT_ESTADO,
  getEstadoDetalle: () => BOT_ESTADO_DETALLE,
  getReconectando: () => BOT_RECONNECTING,
  getReady: () => BOT_READY,
  getQrActual: () => BOT_QR_ACTUAL,
  getQrGeneradoEn: () => BOT_QR_GENERADO_EN,
  getUltimaActividad: () => ultimaActividad,
  getSock: () => sock,
  obtenerVentasHoy: () => obtenerVentasHoy(),
  obtenerClientesAtendidosHoy: () => obtenerClientesAtendidosHoy(),
  getDiagnosticoChat,
  syncPedidoFromDashboard,
})
