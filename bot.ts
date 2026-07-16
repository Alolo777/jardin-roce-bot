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
import { eventBus } from './events/event-bus'
import { EventType } from './events/types'
import { subscribeTelegramEvents } from './events/telegram.subscriber'
import { supabaseAdmin } from './lib/supabase'
import type { VentaCerrada } from './lib/types'
import { startServer } from './api/server'
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
import { parseNombre, pareceNombreCliente, parseFecha, extraerFecha, parseHora, extraerHora, parseSucursal, parsePrecio, parseDireccion, limpiarTelefono } from './parser'
import { getContenidoMensaje, getMessageBody, getMensajeTexto, getMessageType, hasQuotedMsg, getQuotedText, descargarMedia, jidANumero, ahoraCdmx, estaEnHorario, getFechaActual, getContextoHorario } from './src/whatsapp/message-utils'
import { crearCaso, obtenerCasoActivo, actualizarActividad, detectarCambioTema, clasificarTipoCaso, limpiarCachesCasos } from './src/casos/caso.service'
import { crearPedido, obtenerPedido, transitar, transitarDesdeFlujo, archivarPedido, cancelarPedido, limpiarCachesPedidos } from './src/pedidos/pedido.service'
import { analizarIntencion, Decision } from './src/decision/decision.engine'
import { Intencion } from './models/types'
import { construirContextoPrompt } from './src/openai/prompt.builder'
import { cargarIgnorados, MENSAJES_RESCATADOS } from './src/whatsapp/preferences.service'
import { obtenerNumeroReal, setBaileysKeys, limpiarCacheNumeros } from './src/whatsapp/contact.service'
import { notificarEmpleadosWhatsApp, enviarFotoEmpleadosWhatsApp } from './src/whatsapp/notification.service'
import { detectarCancelacion, detectarQueja, detectarEvento, detectarInteresCompra } from './src/decision/intent-detector'

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE FRUSTRACIÓN
// ════════════════════════════════════════════════════════════════

const KW_FRUSTRACION = [
  'que show', 'qué show', 'no me ayudas', 'no sirves', 'pesimo', 'pésimo',
  'mal servicio', 'molesta', 'molesto', 'enojada', 'enojado', 'horrible',
  'no entiendes', 'quiero hablar con una persona', 'quiero hablar con alguien',
  'con un humano', 'inutil', 'inútil', 'no funciona', 'tardas mucho',
  'cuando me van a contestar', 'tardaste mucho', 'porque tardaste',
]

const FRUSTRACION_NOTIFICADA = new Map<string, number>()
const ATENCION_HUMANA_NOTIFICADA = new Map<string, number>()
const INTERES_COMPRA_NOTIFICADO = new Map<string, number>()
const RECLAMACION_NOTIFICADA = new Map<string, number>()
const ENVIO_NOTIFICADO = new Map<string, number>()
const FOTOS_NOTIFICADO = new Map<string, number>()
const FOTOS_DISPONIBLES_RECIENTES = new Map<string, number>()
const ALERTAS_DEDUP = new Map<string, number>()
const ULTIMA_INTERVENCION_HUMANA = new Map<string, { ts: number; texto: string; precio?: number }>()
const FOTOS_DISPONIBLES_TTL_MS = 2 * 60 * 60_000
const INTERVENCION_HUMANA_TTL_MS = 10 * 60_000

function detectarFrustracion(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_FRUSTRACION.some(k => n.includes(k))
}

function detectarAtencionHumana(texto: string): string | null {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Si el texto contiene un link de maps y dirección, el cliente está compartiendo su ubicación, no preguntando por la sucursal
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

function debeNotificarAtencionHumana(clienteId: string): boolean {
  const ahora = Date.now()
  const ultima = ATENCION_HUMANA_NOTIFICADA.get(clienteId) ?? 0
  if (ahora - ultima < 20 * 60_000) return false
  ATENCION_HUMANA_NOTIFICADA.set(clienteId, ahora)
  return true
}

function debeNotificarReclamacion(clienteId: string, tipo: 'cancelacion' | 'queja'): boolean {
  const ahora = Date.now()
  const key = `${tipo}:${clienteId}`
  const ultima = RECLAMACION_NOTIFICADA.get(key) ?? 0
  if (ahora - ultima < 20 * 60_000) return false
  RECLAMACION_NOTIFICADA.set(key, ahora)
  return true
}

function debeEnviarAlertaDedup(clienteId: string, tipo: string, detalle: string, ttlMs: number): boolean {
  const ahora = Date.now()
  const huella = normalizarTexto(detalle).slice(0, 120)
  const key = `${tipo}:${clienteId}:${huella}`
  const ultima = ALERTAS_DEDUP.get(key) ?? 0
  if (ahora - ultima < ttlMs) return false
  ALERTAS_DEDUP.set(key, ahora)
  if (ALERTAS_DEDUP.size > 500) {
    for (const [k, ts] of ALERTAS_DEDUP) {
      if (ahora - ts > 24 * 60 * 60_000) ALERTAS_DEDUP.delete(k)
    }
  }
  return true
}

function registrarIntervencionHumana(clienteId: string, texto: string): void {
  const precio = extraerPrecioRespuesta(texto)
  ULTIMA_INTERVENCION_HUMANA.set(clienteId, { ts: Date.now(), texto: texto.trim().slice(0, 500), precio: precio ?? undefined })
}

function obtenerIntervencionHumanaReciente(clienteId: string): { texto: string; precio?: number; haceMs: number } | null {
  const dato = ULTIMA_INTERVENCION_HUMANA.get(clienteId)
  if (!dato) return null
  const haceMs = Date.now() - dato.ts
  if (haceMs > INTERVENCION_HUMANA_TTL_MS) {
    ULTIMA_INTERVENCION_HUMANA.delete(clienteId)
    return null
  }
  return { texto: dato.texto, precio: dato.precio, haceMs }
}

// ════════════════════════════════════════════════════════════════
// PAUSA DEL BOT
// ════════════════════════════════════════════════════════════════

let BOT_PAUSADO        = false
let ultimaVerifPausa   = 0
let verificacionEnCurso = false
const PAUSA_CACHE_MS   = 5_000

async function verificarSiBotPausado(): Promise<boolean> {
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

let ultimaActividad = Date.now()
function registrarActividad(): void { ultimaActividad = Date.now() }

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
    FRUSTRACION_NOTIFICADA.clear()
    RATE_TIMESTAMPS.clear()
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
const TIPOS_MEDIA_NO_SOPORTADOS = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker'])
const RATE_LIMIT_MAX            = 8
const RATE_LIMIT_WINDOW_MS      = 30_000
const RATE_TIMESTAMPS           = new Map<string, number[]>()
const RATE_AVISADOS             = new Set<string>()

function estaRateLimited(id: string): boolean {
  const ahora     = Date.now()
  const recientes = (RATE_TIMESTAMPS.get(id) ?? []).filter(t => ahora - t < RATE_LIMIT_WINDOW_MS)
  recientes.push(ahora)

  if (recientes.length === 0) {
    RATE_TIMESTAMPS.delete(id)
  } else {
    RATE_TIMESTAMPS.set(id, recientes)
  }

  return recientes.length > RATE_LIMIT_MAX
}

async function responderMensaje(msg: any, texto: string): Promise<any> {
  if (!sock) return
  const jid = msg.key?.remoteJid
  if (!jid) return
  return sock.sendMessage(jid, { text: texto }, { quoted: msg })
}

function avisarRateLimitUnaVez(msg: any, id: string): void {
  if (RATE_AVISADOS.has(id)) return
  RATE_AVISADOS.add(id)
  responderMensaje(msg, 'Voy un poquito rápido 🌸 Dame un momento. ¿Va?').catch(() => {})
  setTimeout(() => RATE_AVISADOS.delete(id), RATE_LIMIT_WINDOW_MS)
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

function extraerPrecioRespuesta(texto: string): number | null {
  return parsePrecio(texto)
}

function describirPedidoPersonalizado(texto: string): string {
  return texto
    .replace(/^(me gustar[ií]a|quiero|quisiera|ocupo|necesito)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Ramo personalizado'
}

function mediaToBase64(media: Buffer | Uint8Array | ArrayBuffer): string {
  return Buffer.from(media as any).toString('base64' as BufferEncoding)
}

function esTextoComprobante(texto: string): boolean {
  return /\b(comprobante|ya\s*pag[uú]e|pagado|pago\s*hecho|ya\s*qued[oó]|ya\s*transfer[ií]|transfer[ií]|transferencia|dep[oó]sito|recibo|ticket|bbva|devi\s+america|devi\s+américa|4152)\b/i.test(texto)
}

function esTextoReferenciaOCotizacion(texto: string): boolean {
  return /\b(cotiz|cotizar|cotizaci[oó]n|cu[aá]nto|cuanto|precio|saldr[ií]a|costar[ií]a|ramo\s+as[ií]|como\s+(este|esta|la\s+foto|imagen)|referencia|foto\s+de\s+referencia|imagen\s+de\s+referencia|hacer\s+un\s+ramo|podr[ií]an\s+hacer|hortensias?|lilis?|rosas?|flores?\s+de\s+la\s+imagen)\b/i.test(texto)
}

function extraerFechaHoraPedido(texto: string): { fecha?: string; hora?: string } {
  return { fecha: extraerFecha(texto) ?? undefined, hora: extraerHora(texto) ?? undefined }
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

const COLA_POR_CLIENTE = new Map<string, Promise<void>>()
const MENSAJES_POR_AGRUPAR = new Map<string, { mensajes: any[]; timer: NodeJS.Timeout }>()
const MEDIA_POR_CLIENTE = new Map<string, { base64: string; mimetype: string; caption: string }[]>()
const AGRUPAR_MENSAJES_MS = 60_000 // Agrupa mensajes seguidos antes de responder

function encolarPorCliente(id: string, tarea: () => Promise<void>): void {
  const previa    = COLA_POR_CLIENTE.get(id) ?? Promise.resolve()
  const siguiente = previa.catch(() => {}).then(tarea).catch(e => console.error(`[bot] Cola ${id}:`, e))
  COLA_POR_CLIENTE.set(id, siguiente)
  siguiente.finally(() => { if (COLA_POR_CLIENTE.get(id) === siguiente) COLA_POR_CLIENTE.delete(id) })
}

function encolarMensajeAgrupado(clienteId: string, msg: any): void {
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
      encolarPorCliente(clienteId, () => procesarMensaje(base))
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

const VENTAS_CERRADAS  = new Set<string>()
const VENTA_ACTUAL     = new Map<string, VentaCerrada>()
const ARREGLO_ELEGIDO  = new Map<string, ArregloConFoto>()
type EstadoFlujoPedido = 'sin_pedido' | 'cotizando' | 'esperando_precio_equipo' | 'precio_confirmado' | 'esperando_fecha_hora' | 'esperando_entrega' | 'esperando_nombre' | 'esperando_pago' | 'apartado_sucursal' | 'pagado_transferencia' | 'cerrado' | 'cancelado'

interface PedidoExtra {
  nombre: string
  precio: number
}

interface PedidoEnCurso {
  arreglo?: ArregloConFoto
  productoPersonalizado?: string
  precioPersonalizado?: number
  envio?: { zona: string; precio: number }
  nombre?: string
  direccion?: string
  sucursal?: string
  metodoPago?: 'transferencia' | 'efectivo_recoger' | 'tarjeta_recoger'
  nota?: string
  estadoFlujo?: EstadoFlujoPedido
  fechaEntrega?: string
  horaEntrega?: string
  fotoReferenciaBase64?: string
  fotoReferenciaMimetype?: string
  fotoReferenciaCaption?: string
  fotoReferenciaRecibidaEn?: string
  detallesEspeciales?: string
  extras?: PedidoExtra[]
  precioConfirmadoPor?: 'equipo' | 'ia' | 'cliente' | 'manual'
  esperandoPrecioEnvio?: boolean
  cerradoEn?: string
}

const PEDIDO_EN_CURSO  = new Map<string, PedidoEnCurso>()

function pedidoActual(clienteId: string) {
  const pedido = PEDIDO_EN_CURSO.get(clienteId) ?? {}
  PEDIDO_EN_CURSO.set(clienteId, pedido)
  return pedido
}

function marcarFotosDisponibles(clienteId: string): void {
  FOTOS_DISPONIBLES_RECIENTES.set(clienteId, Date.now())
}

function hayFotosDisponiblesRecientes(clienteId: string): boolean {
  const timestamp = FOTOS_DISPONIBLES_RECIENTES.get(clienteId)
  return Boolean(timestamp && Date.now() - timestamp < FOTOS_DISPONIBLES_TTL_MS)
}

function esSolicitudFotosDisponibles(texto: string): boolean {
  return /\b(fotos?|ver.*arregl|muestra|enseña|manda.*foto|averlos|verlos|qu[eé].*(?:ramos?|ramitos?|arreglos?|flores?).*tiene(?:n)?|qu[eé]\s+tiene(?:n)?\s+disponible|hay.*foto|puedo.*ver|quisiera.*ver|ramitos?.*disponibles?|ramos?.*disponibles?|arreglos?.*disponibles?|disponibles?\s+hoy)\b/i.test(texto)
}

function esMensajeFotosDisponiblesEquipo(texto: string): boolean {
  return /\b(esos?|estos?|ramitos?|ramos?|arreglos?)\b.*\b(disponibles?|tenemos|hay)\b|\b(disponibles?|tenemos|hay)\b.*\b(esos?|estos?|ramitos?|ramos?|arreglos?)\b/i.test(texto)
}

function clienteEligeFotoDisponible(texto: string): boolean {
  return /\b(me\s+gust[oó]|me\s+interesa|quiero|quisiera|ap[aá]rtame|apartame|apartarlo|este|esta|ese|esa|el\s+de\s+la\s+foto|la\s+de\s+la\s+foto|qu[eé]\s+precio|cu[aá]nto|cuanto)\b/i.test(texto)
}

function detectarExtrasPedido(texto: string): PedidoExtra[] {
  const extras = new Map<string, PedidoExtra>()
  if (/\b(notita|nota\s+personalizada|nota|tarjeta|dedicatoria|mensaje\s+(?:escrito|impreso)|papelito)\b/i.test(texto)) {
    extras.set('Nota personalizada', { nombre: 'Nota personalizada', precio: 10 })
  }
  return [...extras.values()]
}

function agregarExtrasPedido(clienteId: string, extras: PedidoExtra[]): void {
  if (extras.length === 0) return
  const pedido = pedidoActual(clienteId)
  const actuales = new Map((pedido.extras ?? []).map(extra => [extra.nombre.toLowerCase(), extra]))
  for (const extra of extras) actuales.set(extra.nombre.toLowerCase(), extra)
  pedido.extras = [...actuales.values()]
}

function totalExtrasPedido(clienteId: string): number {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  return (pedido?.extras ?? []).reduce((sum, extra) => sum + extra.precio, 0)
}

function extrasPedidoTexto(clienteId: string): string | null {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const extras = pedido?.extras ?? []
  if (extras.length === 0) return null
  return extras.map(extra => `${extra.nombre} $${extra.precio.toFixed(2)} MXN`).join(', ')
}

function detallesConExtras(clienteId: string, detalles?: string | null): string | undefined {
  const extras = extrasPedidoTexto(clienteId)
  return [detalles || '', extras ? `Extras: ${extras}` : ''].filter(Boolean).join('\n') || undefined
}

function limpiarDireccionCliente(texto: string): string {
  return String(texto || '')
    .replace(GOOGLE_MAPS_REGEX, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^,|,$/g, '')
    .trim()
}

function totalPedidoNumerico(clienteId: string): number | null {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const arreglo = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
  const subtotal = arreglo?.precio ?? pedido?.precioPersonalizado
  if (!subtotal) return null
  return subtotal + totalExtrasPedido(clienteId) + (pedido?.envio?.precio ?? 0)
}

function estadoFlujoDesdeEstado(estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado', pedido?: PedidoEnCurso): EstadoFlujoPedido {
  if (estado === 'cancelado') return 'cancelado'
  if (estado === 'entregado') return 'cerrado'
  if (estado === 'pagado') return 'pagado_transferencia'
  if (pedido?.estadoFlujo) return pedido.estadoFlujo
  if (estado === 'apartado') return pedido?.metodoPago === 'transferencia' ? 'esperando_pago' : 'apartado_sucursal'
  if (pedido?.fotoReferenciaBase64) return 'esperando_precio_equipo'
  if (pedido?.precioPersonalizado) return 'precio_confirmado'
  return 'cotizando'
}

function resumirPedidoOperativo(clienteId: string, telefono: string | null): string {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const arreglo = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
  const subtotal = arreglo?.precio ?? pedido?.precioPersonalizado ?? 0
  const extras = totalExtrasPedido(clienteId)
  const envio = pedido?.envio?.precio ?? 0
  const total = subtotal + extras + envio
  return [
    `cliente_nombre: ${pedido?.nombre ?? 'Por confirmar'}`,
    `telefono: ${telefono ?? 'Por confirmar'}`,
    `producto: ${arreglo?.nombre ?? pedido?.productoPersonalizado ?? 'Por confirmar'}`,
    `detalles_especiales: ${pedido?.detallesEspeciales ?? pedido?.nota ?? 'Sin notas'}`,
    `precio_arreglo: ${subtotal || 'Por confirmar'}`,
    `extras: ${extrasPedidoTexto(clienteId) ?? 'Sin extras'}`,
    `precio_envio: ${envio || 0}`,
    `total: ${total || 'Por confirmar'}`,
    `entrega: ${pedido?.envio ? 'domicilio' : (pedido?.sucursal ? 'sucursal' : 'Por confirmar')}`,
    `sucursal/direccion: ${pedido?.direccion ?? pedido?.sucursal ?? pedido?.envio?.zona ?? 'Por confirmar'}`,
    `fecha/hora: ${[pedido?.fechaEntrega, pedido?.horaEntrega].filter(Boolean).join(' ') || 'Por confirmar'}`,
    `metodo_pago: ${pedido?.metodoPago ?? 'Por confirmar'}`,
    `tiene_foto_referencia: ${pedido?.fotoReferenciaBase64 ? 'si' : 'no'}`,
  ].join('\n')
}

async function persistirPedido(clienteId: string, telefono: string | null, estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado', ultimoMensaje?: string): Promise<void> {
  try {
    const pedido = PEDIDO_EN_CURSO.get(clienteId)
    const arreglo = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
    const total = totalPedidoNumerico(clienteId)
    const base = {
      cliente_id: clienteId,
      telefono,
      estado,
      cliente_nombre: pedido?.nombre ?? null,
      producto: arreglo?.nombre ?? pedido?.productoPersonalizado ?? null,
      arreglo_id: arreglo?.id ?? null,
      precio_arreglo: arreglo?.precio ?? pedido?.precioPersonalizado ?? null,
      zona_envio: pedido?.envio?.zona ?? null,
      precio_envio: pedido?.envio?.precio ?? null,
      direccion: pedido?.direccion ?? null,
      sucursal: pedido?.sucursal ?? null,
      metodo_pago: pedido?.metodoPago ?? null,
      nota: pedido?.nota ?? null,
      total,
      ultimo_mensaje: ultimoMensaje ?? null,
      requiere_revision: false,
      actualizado_en: new Date().toISOString(),
    }
    const extendido = {
      ...base,
      estado_flujo: estadoFlujoDesdeEstado(estado, pedido),
      fecha_entrega: pedido?.fechaEntrega ?? null,
      hora_entrega: pedido?.horaEntrega ?? null,
      foto_referencia_base64: pedido?.fotoReferenciaBase64 ?? null,
      foto_referencia_mimetype: pedido?.fotoReferenciaMimetype ?? null,
      foto_referencia_caption: pedido?.fotoReferenciaCaption ?? null,
      foto_referencia_recibida_en: pedido?.fotoReferenciaRecibidaEn ?? null,
      resumen_pedido: resumirPedidoOperativo(clienteId, telefono),
      detalles_especiales: detallesConExtras(clienteId, pedido?.detallesEspeciales ?? pedido?.nota) ?? null,
      precio_confirmado_por: pedido?.precioConfirmadoPor ?? null,
      cerrado_en: pedido?.cerradoEn ?? null,
    }
    let { error } = await supabaseAdmin.from('pedidos_bot').upsert(extendido, { onConflict: 'cliente_id' })
    if (error && /estado_flujo|fecha_entrega|foto_referencia|resumen_pedido|detalles_especiales|precio_confirmado_por|cerrado_en|schema cache|column/i.test(error.message || '')) {
      const retry = await supabaseAdmin.from('pedidos_bot').upsert(base, { onConflict: 'cliente_id' })
      error = retry.error
    }
    if (error) throw error
  } catch (err) {
    console.warn('[pedidos_bot] No se pudo persistir pedido:', err)
  }
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

function resetearPedidoCliente(clienteId: string): void {
  PEDIDO_EN_CURSO.delete(clienteId)
  ARREGLO_ELEGIDO.delete(clienteId)
  VENTAS_CERRADAS.delete(clienteId)
  VENTA_ACTUAL.delete(clienteId)
  FOTOS_DISPONIBLES_RECIENTES.delete(clienteId)
}

function resetearPedidoActivo(clienteId: string): void {
  PEDIDO_EN_CURSO.delete(clienteId)
  ARREGLO_ELEGIDO.delete(clienteId)
  VENTA_ACTUAL.delete(clienteId)
}

function ventaDesdeEstado(clienteId: string, fallback?: VentaCerrada): VentaCerrada | null {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const elegido = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
  if (!elegido && !pedido?.productoPersonalizado && !fallback) return null

  const producto = elegido?.nombre ?? pedido?.productoPersonalizado ?? fallback?.producto ?? 'Pedido'
  const subtotal = elegido?.precio ?? pedido?.precioPersonalizado ?? (parseFloat(String(fallback?.total ?? '').replace(/[^0-9.]/g, '')) || 0)
  const extras = totalExtrasPedido(clienteId)
  const envio = pedido?.envio?.precio ?? 0
  const total = subtotal + extras + envio
  const direccion = pedido?.envio?.zona
    ? `${pedido.envio.zona}${pedido.direccion ? ` — ${pedido.direccion}` : ''}`
    : (pedido?.sucursal ? `Sucursal ${pedido.sucursal}` : (pedido?.direccion ?? fallback?.direccion ?? 'Por confirmar'))

  const desglose = [`ramo $${subtotal.toFixed(2)}`]
  if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
  if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
  const totalTexto = desglose.length > 1
    ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})`
    : `$${total.toFixed(2)} MXN`

  return {
    cliente: pedido?.nombre ?? fallback?.cliente ?? 'Verificar en chat',
    producto,
    total: totalTexto,
    direccion,
  }
}

function precioPedidoActual(clienteId: string): number {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  return pedido?.arreglo?.precio ?? ARREGLO_ELEGIDO.get(clienteId)?.precio ?? pedido?.precioPersonalizado ?? 0
}

function tienePrecioConfirmado(clienteId: string): boolean {
  return precioPedidoActual(clienteId) > 0
}

function tieneNombreValido(clienteId: string): boolean {
  const nombre = PEDIDO_EN_CURSO.get(clienteId)?.nombre
  return Boolean(nombre && !/verificar|confirmar|chat/i.test(nombre))
}

function ventaListaParaCerrar(clienteId: string): boolean {
  return tienePrecioConfirmado(clienteId) && tieneNombreValido(clienteId) && !faltaFechaHoraParaCerrar(clienteId)
}

function ventaListaParaPagoTransferencia(clienteId: string): boolean {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  return Boolean(tienePrecioConfirmado(clienteId) && tieneNombreValido(clienteId) && (pedido?.direccion || pedido?.sucursal || pedido?.envio?.zona))
}

function apartadoSucursalListo(clienteId: string): boolean {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  return Boolean(pedido?.sucursal && ventaListaParaCerrar(clienteId))
}

function extraerNombrePedido(texto: string): string | null {
  return parseNombre(texto)
}

function aplicarDatosPedidoDesdeTexto(clienteId: string, texto: string): void {
  if (!tieneArregloVerificado(clienteId)) return
  const pedido = pedidoActual(clienteId)
  agregarExtrasPedido(clienteId, detectarExtrasPedido(texto))
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
  }
}

function contextoEsperaComprobante(clienteId: string, textoTurno: string, historialRecienteTexto: string): boolean {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const contextoPago = pedido?.metodoPago === 'transferencia' || pedido?.estadoFlujo === 'esperando_pago' || /comprobante|pago\s+por\s+transferencia|mandame\s+(?:tu\s+)?comprobante|m[aá]ndame\s+(?:tu\s+)?comprobante|cuenta\s*(?:bbva)?\s*:?\s*4152|bbva|devi\s+am[eé]rica|pon\s+tu\s+nombre\s+en\s+concepto|cuando\s+est[eé]\s+listo/i.test(historialRecienteTexto)
  const confirmaTurno = /\b(listo|claro|va|vale|ya\s+est[aá]|hecho|te\s+lo\s+mand[oó]|lo\s+mand[oó])\b/i.test(textoTurno)
  const imagenSinTexto = !textoTurno.trim() || /^\[Imagen sin texto\]$/i.test(textoTurno.trim())
  return Boolean(contextoPago && (imagenSinTexto || confirmaTurno || esTextoComprobante(textoTurno)))
}

function respuestaPideComprobante(texto: string): boolean {
  return /(?:bbva|4152|devi\s+am[eé]rica|m[aá]ndame\s+(?:tu\s+)?comprobante|comprobante\s+cuando\s+est[eé]\s+listo|pon\s+tu\s+nombre\s+en\s+concepto)/i.test(texto)
}

function tieneArregloVerificado(clienteId: string): boolean {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  return Boolean(pedido?.arreglo || pedido?.productoPersonalizado || ARREGLO_ELEGIDO.get(clienteId))
}

function precioArregloTexto(clienteId: string): string {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const precio = pedido?.arreglo?.precio ?? ARREGLO_ELEGIDO.get(clienteId)?.precio ?? pedido?.precioPersonalizado ?? 0
  return `$${precio.toFixed(2)} MXN`
}

function totalDashboardPedido(clienteId: string, fallback: string): string {
  const total = totalPedidoNumerico(clienteId)
  return total && total > 0 ? `$${total.toFixed(2)} MXN` : fallback
}

function faltaFechaHoraParaCerrar(clienteId: string): boolean {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  return !pedido?.fechaEntrega || !pedido?.horaEntrega
}

async function pedirFechaHoraSiFalta(msg: any, telefono: string, clienteId: string): Promise<boolean> {
  if (!faltaFechaHoraParaCerrar(clienteId)) return false
  const pedido = pedidoActual(clienteId)
  pedido.estadoFlujo = 'esperando_fecha_hora'
  await persistirPedido(clienteId, telefono, 'apartado', 'Falta fecha/hora antes de cerrar')
  const pregunta = '¿Para qué fecha y hora lo necesitas? 🌷'
  await responderMensaje(msg, pregunta)
  await agregarAlHistorial(telefono, 'assistant', pregunta)
  return true
}

async function procesarMediaAcumulado(clienteId: string, telefono: string, textoCliente: string, pushName?: string): Promise<'referencia' | 'comprobante' | 'imagen' | null> {
  const mediaAcumulado = MEDIA_POR_CLIENTE.get(clienteId)
  if (!mediaAcumulado || mediaAcumulado.length === 0) return null

  MEDIA_POR_CLIENTE.delete(clienteId)
  const historial = await obtenerHistorial(telefono)
  const historialRecienteTexto = historial.slice(-8).map(m => m.content).join(' ')
  const captionsTexto = mediaAcumulado.map(m => m.caption).filter(Boolean).join(' ')
  const textoTurno = `${textoCliente} ${captionsTexto}`.trim()
  const textoClasificacion = `${textoTurno} ${historialRecienteTexto}`

  const quiereCotizarTurno = esTextoReferenciaOCotizacion(textoTurno)
  const pagoEnTurno = esTextoComprobante(textoTurno)
  const pagoReciente = esTextoComprobante(textoClasificacion)
  const esperaComprobante = contextoEsperaComprobante(clienteId, textoTurno, historialRecienteTexto)
  let esComprobante = esperaComprobante || (!quiereCotizarTurno && (pagoEnTurno || pagoReciente))
  let esReferencia = !esComprobante && (quiereCotizarTurno || (!pagoEnTurno && !pagoReciente))

  const tieneImagen = mediaAcumulado.some(m => m.mimetype.startsWith('image/'))

  if (tieneImagen) {
    console.log(`[bot] 👁️ Enviando ${mediaAcumulado.length} imagen(es) a visión IA para ${telefono}...`)
    const pedido = PEDIDO_EN_CURSO.get(clienteId)
    const contextoVision = [
      `estado_flujo: ${pedido?.estadoFlujo ?? 'sin_pedido'}`,
      `metodo_pago: ${pedido?.metodoPago ?? 'sin_confirmar'}`,
      `tiene_arreglo: ${tieneArregloVerificado(clienteId) ? 'si' : 'no'}`,
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
    const pedido = pedidoActual(clienteId)
    pedido.metodoPago = 'transferencia'
    pedido.estadoFlujo = 'pagado_transferencia'
    const venta = ventaDesdeEstado(clienteId)
    if (venta && ventaListaParaPagoTransferencia(clienteId)) {
      await ventaCerradaHandler(clienteId, venta, telefono)
    } else {
      await persistirPedido(clienteId, telefono, 'apartado', 'Comprobante recibido, faltan datos para cierre')
      if (debeEnviarAlertaDedup(clienteId, 'comprobante-pendiente', textoTurno || 'comprobante', 30 * 60_000)) {
        eventBus.emit(EventType.ORDER_CREATED, {
          telefono,
          cliente: pedido.nombre ?? 'Verificar en chat',
          producto: pedido.productoPersonalizado ?? 'Verificar en conversación',
          total: parseFloat(totalDashboardPedido(clienteId, '0').replace(/[^0-9.]/g, '')) || 0,
          sucursal: pedido.direccion ?? pedido.sucursal ?? pedido.envio?.zona ?? 'Por confirmar',
          metodoPago: 'Transferencia',
          descripcion: 'comprobante-pendiente',
          precioArreglo: tienePrecioConfirmado(clienteId) ? precioArregloTexto(clienteId) : undefined,
          precioExtras: extrasPedidoTexto(clienteId) ?? undefined,
        } as any)
      }
    }
    return 'comprobante'
  }

  if (esReferencia) {
    const descripcion = mediaAcumulado.map(m => m.caption).filter(Boolean).join(' | ') || 'Envió foto(s) de referencia'
    const pedido = pedidoActual(clienteId)
    pedido.productoPersonalizado ||= descripcion === 'Envió foto(s) de referencia' ? 'Ramo personalizado con foto de referencia' : descripcion
    pedido.estadoFlujo = 'esperando_precio_equipo'
    pedido.fotoReferenciaBase64 = mediaAcumulado[0]?.base64
    pedido.fotoReferenciaMimetype = mediaAcumulado[0]?.mimetype
    pedido.fotoReferenciaCaption = descripcion
    pedido.fotoReferenciaRecibidaEn = new Date().toISOString()
    pedido.detallesEspeciales = descripcion
    await persistirPedido(clienteId, telefono, 'cotizacion', descripcion)
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

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE INTENCIÓN
// ════════════════════════════════════════════════════════════════

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

function detectarIntencion(texto: string, clienteId: string): 'catalogo' | 'cotizador' | 'normal' {
  if (/foto.*(entrega|entreguen|entregado|repartidor)|comprobante.*entrega|cuando.*entreguen/.test(texto.toLowerCase())) {
    return 'normal'
  }

  if (VENTAS_CERRADAS.has(clienteId)) {
    return 'normal'
  }

  const decision = analizarIntencion({ texto, horasInactivo: 0 })
  if (decision.intencion === Intencion.CATALOGO || decision.intencion === Intencion.FOTOS) return 'catalogo'
  if (decision.intencion === Intencion.COTIZACION || decision.intencion === Intencion.PERSONALIZADO) return 'cotizador'
  return 'normal'
}

// ════════════════════════════════════════════════════════════════
// TIPOS DE ARREGLO
// ════════════════════════════════════════════════════════════════

interface ArregloConFoto {
  id: string; nombre: string; precio: number
  descripcion: string | null; foto_url: string
}

// ════════════════════════════════════════════════════════════════
// ZONAS DE ENVÍO (keywords — fallback)
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
// MUNICIPIOS DE ENVÍO (datos exactos desde Supabase)
// ════════════════════════════════════════════════════════════════

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



function contieneFrase(texto: string, frase: string): boolean {
  if (!frase) return false
  const segura = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${segura}(\\s|$)`).test(texto)
}

type ResultadoEnvio = { zona: string; precio: number; fuente: string } | { ambiguo: true; candidatos: Array<{ zona: string; precio: number; fuente: string }> }

async function buscarPrecioEnvio(texto: string): Promise<ResultadoEnvio | null> {
  const n = normalizarTexto(texto)
  const tieneDatoDireccion = parseDireccion(texto).confianza !== 'ninguna'

  // 1. Buscar por scoring: CP > municipio > colonia.
  const municipios = await obtenerMunicipiosEnvio()
  if (municipios.length > 0) {
    const candidatos = municipios
      .map(m => {
        const nomMunicipio = normalizarTexto(m.municipio)
        const nomColonia = normalizarTexto(m.colonia ?? '')
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

  // 2. Fallback: buscar en zonas_envio por palabras clave exactas por frase.
  const zonas = await obtenerZonasEnvio()
  if (zonas.length > 0) {
    const zonaMatch = zonas.find(z =>
      z.palabras_clave.split(',').some(p => {
        const palabra = normalizarTexto(p.trim())
        return palabra && contieneFrase(n, palabra)
      })
    )
    if (zonaMatch && tieneDatoDireccion) return { zona: zonaMatch.zona, precio: zonaMatch.precio, fuente: 'zonas' }
  }

  return null
}

const GOOGLE_MAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z]+\/maps|goo\.gl\/maps)[^\s]*/i
const COORDS_REGEX = /@(-?\d+\.\d+),(-?\d+\.\d+)/

function detectarLinkMaps(texto: string): boolean {
  return GOOGLE_MAPS_REGEX.test(texto)
}

function formatearZonasParaPrompt(zonas: ZonaEnvioData[]): string {
  if (!zonas.length) return ''
  return zonas.map(z => `- ${z.zona}: $${z.precio.toFixed(2)} MXN (${z.palabras_clave})`).join('\n')
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

function calcularDelayEscritura(texto: string): number {
  const base = Math.min(Math.max((texto.length / 200) * 2000, 600), 2500)
  return base + (Math.random() * 300 - 150)
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
// FLUJO PRINCIPAL
// ════════════════════════════════════════════════════════════════

async function procesarMensaje(msg: any): Promise<void> {
  const clienteId    = msg.key?.remoteJid as string
  if (!clienteId) return
  const telefono     = extraerTelefono(msg)
  let   textoCliente = (getMensajeTexto(msg) || '').trim()

  if (!textoCliente) return
  if (textoCliente.length > MAX_LONGITUD_MENSAJE) textoCliente = textoCliente.slice(0, MAX_LONGITUD_MENSAJE)

  console.log(`[${new Date().toLocaleTimeString('es-MX')}] 📨 ${clienteId}: ${textoCliente.substring(0, 80)}`)

  const numeroRealPromise = obtenerNumeroReal(msg)
  const esFrustrado       = detectarFrustracion(textoCliente)
  const esInteresCompra   = detectarInteresCompra(textoCliente)

  try {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 300))

    await agregarAlHistorial(telefono, 'user', textoCliente)

    const pideEmpezarDesdeCero = /empecemos\s+desde\s+cero|desde\s+cero|borr[oó]n\s+y\s+cuenta\s+nueva|nuevo\s+pedido|otro\s+pedido|otro\s+ramo|es\s+aparte|aparte\s+ese|ya\s+hab[ií]a\s+finalizado|ya\s+se\s+finaliz[oó]|ese\s+ya\s+qued[oó]/i.test(textoCliente)
    if (pideEmpezarDesdeCero) resetearPedidoActivo(clienteId)

    // ── CASE ENGINE: asegurar caso activo ─────────────────────
    let casoActivo = obtenerCasoActivo(clienteId)
    const horasInactivo = casoActivo
      ? (Date.now() - new Date(casoActivo.ultimaActividad).getTime()) / (1000 * 60 * 60)
      : 99
    if (casoActivo && detectarCambioTema(textoCliente, horasInactivo)) {
      casoActivo = crearCaso(clienteId, telefono, clasificarTipoCaso(textoCliente))
    } else if (!casoActivo) {
      casoActivo = crearCaso(clienteId, telefono, clasificarTipoCaso(textoCliente))
    }
    actualizarActividad(casoActivo)

    // ── ORDER ENGINE: asegurar pedido en máquina de estados ──
    if (!obtenerPedido(clienteId)) {
      crearPedido(clienteId, telefono)
    }

    // ── DECISION ENGINE: analizar intención ───────────────────
    const decision: Decision = analizarIntencion({
      texto: textoCliente,
      horasInactivo,
    })

    const fechaHoraDetectada = extraerFechaHoraPedido(textoCliente)
    if ((fechaHoraDetectada.fecha || fechaHoraDetectada.hora) && tieneArregloVerificado(clienteId)) {
      const pedido = pedidoActual(clienteId)
      if (fechaHoraDetectada.fecha) pedido.fechaEntrega = fechaHoraDetectada.fecha
      if (fechaHoraDetectada.hora) pedido.horaEntrega = fechaHoraDetectada.hora
    }

    const intencion     = detectarIntencion(textoCliente, clienteId)
    const horario       = getContextoHorario()
    const pedidoEngine = obtenerPedido(clienteId)
    const contextoPrompt = construirContextoPrompt({
      decision,
      caso: casoActivo,
      pedido: pedidoEngine,
      textoCliente,
      horaActual: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      fechaActual: getFechaActual(),
    })
    let contextoExtra   = `${contextoPrompt}${horario}`

    if (pideEmpezarDesdeCero) {
      contextoExtra +=
        `\n\n[CLIENTE QUIERE EMPEZAR DESDE CERO] ` +
        `El pedido anterior ya no debe mezclarse con este. Usa SOLO la última solicitud del cliente para el pedido nuevo. No reutilices flores, precio, sucursal, pago ni nombre del pedido anterior.`
    }

    // ── Múltiples mensajes agrupados ─────────────────────────────
    if (textoCliente.includes('\n---\n')) {
      const partes = textoCliente.split('\n---\n').filter(Boolean)
      contextoExtra +=
        `\n\n[CLIENTE ENVIÓ VARIOS MENSAJES SEGUIDOS] El cliente escribió ${partes.length} mensajes ` +
        `en poco tiempo. Léelos TODOS antes de responder para entender el contexto completo. ` +
        `Responde considerando el último mensaje como lo más reciente, pero usa los anteriores como contexto.`
    }

    // ── Detección de reply (quote) ────────────────────────────────
    let textoCitado = ''
    if (hasQuotedMsg(msg)) {
      textoCitado = getQuotedText(msg)
    }

    // ── Saludo dinámico en primer mensaje ─────────────────────────
    const historialCompleto = await obtenerHistorial(telefono)
    const historialTexto = historialCompleto.map(m => m.content).join('\n').toLowerCase()

    // ── Informar a la IA si el equipo humano ya intervino ────────────
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
        `estado_pedido: ${PEDIDO_EN_CURSO.get(clienteId)?.estadoFlujo ?? 'sin_pedido'}`,
        `tiene_arreglo: ${tieneArregloVerificado(clienteId) ? 'si' : 'no'}`,
        `precio_confirmado: ${tienePrecioConfirmado(clienteId) ? 'si' : 'no'}`,
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
      resetearPedidoActivo(clienteId)
      marcarFotosDisponibles(clienteId)
      contextoExtra +=
        `\n\n[CLIENTE INICIA NUEVA SELECCION CON FOTOS DISPONIBLES] ` +
        `El cliente esta dejando atras cualquier cotizacion inconclusa anterior. No reutilices productos, precios, envio, nombre ni pago anteriores. ` +
        `Pide al equipo que le mande fotos disponibles y espera a que el cliente elija una foto nueva.`
    }

    const seleccionaFotoDisponible = !pideFotosDisponibles && hayFotosDisponiblesRecientes(clienteId) && clienteEligeFotoDisponible(textoCliente)
    if (seleccionaFotoDisponible) {
      resetearPedidoActivo(clienteId)
      FOTOS_DISPONIBLES_RECIENTES.delete(clienteId)
      const pedido = pedidoActual(clienteId)
      pedido.productoPersonalizado = 'Ramo elegido de fotos disponibles'
      pedido.detallesEspeciales = 'Cliente eligio un ramo de las fotos disponibles enviadas por el equipo'
      pedido.estadoFlujo = 'esperando_precio_equipo'
      contextoExtra +=
        `\n\n[CLIENTE ELIGIO UNA FOTO DISPONIBLE RECIENTE] ` +
        `Es un pedido nuevo basado en fotos que envio el equipo. NO uses precios de cotizaciones anteriores. ` +
        `Si el cliente pregunta precio, di que lo confirmas con el equipo; no inventes ni reutilices $400, $600 u otro precio viejo.`
    }

    const mediaPendiente = MEDIA_POR_CLIENTE.get(clienteId)
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
        `INSTRUCCION: Para entrega a domicilio, pide el nombre para apartarlo y comparte la cuenta BBVA. ` +
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

    // ── COTIZADOR ─────────────────────────────────────────────────
    if (intencion === 'cotizador') {
      contextoExtra +=
        `\n\nINSTRUCCION: Envía DIRECTAMENTE el cotizador: ` +
        `https://floreria-app-mauve.vercel.app/ Menciona que puede subir foto de referencia. Máximo 3 líneas.`
    }

    // ── GOOGLE MAPS / ZONAS DE ENVÍO ──────────────────────────────
    const mencionaEnvio = /\b(env[ií]o|env[ií]ar|domicilio|entrega|mandar|llevar|reparto)\b/i.test(textoCliente)
    const dirParsed = parseDireccion(textoCliente)
    const mencionaDireccion = dirParsed.confianza !== 'ninguna'
    const pareceEnvio = mencionaEnvio || mencionaDireccion || detectarLinkMaps(textoCliente)

    if (pareceEnvio) {
      if ((mencionaDireccion || detectarLinkMaps(textoCliente)) && tieneArregloVerificado(clienteId)) {
        const pedido = pedidoActual(clienteId)
        pedido.direccion = limpiarDireccionCliente(textoCliente)
        pedido.esperandoPrecioEnvio = true
      }
      contextoExtra +=
        `\n\n[CLIENTE PREGUNTA POR ENVÍO] El cliente quiere saber sobre envío a domicilio. ` +
        `INSTRUCCION: Responde que el costo exacto de envío depende de la ubicación, ` +
        `y que una compañera del equipo le confirmará el precio exacto. ` +
        `Menciona que el equipo le contactará pronto. Máximo 3 líneas.`
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

    // ── Contexto genérico de reply ──────────────────────────────
    if (hasQuotedMsg(msg) && textoCitado) {
      contextoExtra +=
        `\n\n[CLIENTE RESPONDIÓ AL MENSAJE: "${textoCitado.replace(/"/g, "'")}"]` +
        `\nINSTRUCCION: El usuario respondió específicamente a ese mensaje. Úsalo para entender a qué se refiere.`
    }

    // ── CANCELACIÓN ─────────────────────────────────────────────
    const cancelacionDetectada = detectarCancelacion(textoCliente) || (clasificacionIA.intencion === 'cancelacion' && clasificacionIA.confianza >= 0.65)
    const cancelacionDescartadaPorIA = detectarCancelacion(textoCliente) && clasificacionIA.confianza >= 0.75 && clasificacionIA.intencion !== 'cancelacion'
    if (cancelacionDetectada && !cancelacionDescartadaPorIA) {
      contextoExtra +=
        `\n\n[CLIENTE QUIERE CANCELAR UN PEDIDO]` +
        `\nINSTRUCCION: Responde con empatía. Di que notificarás al equipo. ` +
        `NO prometas reembolsos ni descuentos. El sistema notificará automáticamente al administrador.`
      if ((clasificacionIA.severidad === 'alta' || clasificacionIA.severidad === 'critica' || clasificacionIA.intencion === 'cancelacion') && debeNotificarReclamacion(clienteId, 'cancelacion')) {
        const telefonoReal = await numeroRealPromise
        const referencia = PEDIDO_EN_CURSO.get(clienteId)?.arreglo?.nombre ?? ARREGLO_ELEGIDO.get(clienteId)?.nombre ?? null
        eventBus.emit(EventType.CANCELACION_REQUESTED, { telefono: telefonoReal, descripcion: textoCliente.substring(0, 300) })
        registrarReclamacion(telefonoReal, 'cancelacion', textoCliente, referencia).catch(() => {})
        persistirPedido(clienteId, telefonoReal, 'cancelado', textoCliente).catch(() => {})
      }
    }

    // ── QUEJA ────────────────────────────────────────────────────
    const quejaDetectada = detectarQueja(textoCliente) || (clasificacionIA.intencion === 'queja' && clasificacionIA.confianza >= 0.65)
    const quejaDescartadaPorIA = detectarQueja(textoCliente) && clasificacionIA.confianza >= 0.75 && clasificacionIA.intencion !== 'queja'
    if (quejaDetectada && !quejaDescartadaPorIA) {
      contextoExtra +=
        `\n\n[CLIENTE TIENE UNA QUEJA O RECLAMO]` +
        `\nINSTRUCCION: Responde con empatía. Pide disculpas y di que lo reportas al equipo. ` +
        `NO ofrezcas compensaciones ni descuentos. El sistema notificará automáticamente.`
      if ((clasificacionIA.severidad === 'alta' || clasificacionIA.severidad === 'critica' || clasificacionIA.intencion === 'queja') && debeNotificarReclamacion(clienteId, 'queja')) {
        const telefonoReal = await numeroRealPromise
        const referencia = PEDIDO_EN_CURSO.get(clienteId)?.arreglo?.nombre ?? ARREGLO_ELEGIDO.get(clienteId)?.nombre ?? null
        eventBus.emit(EventType.CUSTOMER_ANGRY, { telefono: telefonoReal, descripcion: textoCliente.substring(0, 300) })
        registrarReclamacion(telefonoReal, 'queja', textoCliente, referencia).catch(() => {})
      }
    }

    // ── EVENTOS ESPECIALES ──────────────────────────────────────
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

    // ── DETECCIÓN DE FRUSTRACIÓN ───────────────────────────────
    if (esFrustrado) {
      const ahoraFrustracion = FRUSTRACION_NOTIFICADA.get(clienteId) ?? 0
      if (Date.now() - ahoraFrustracion > 30 * 60_000) {
        FRUSTRACION_NOTIFICADA.set(clienteId, Date.now())
        const telefonoReal = await numeroRealPromise
        eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: telefonoReal, prioridad: 'critica', descripcion: textoCliente.substring(0, 200) })
        eventBus.emit(EventType.CUSTOMER_WAITING, { telefono: telefonoReal, descripcion: 'Cliente frustrado esperando atención humana' })
      }
    }

    // ── DETECCIÓN DE INTERÉS DE COMPRA ──────────────────────────
    if (esInteresCompra) {
      const ahoraInteres = INTERES_COMPRA_NOTIFICADO.get(clienteId) ?? 0
      if (Date.now() - ahoraInteres > 30 * 60_000) {
        INTERES_COMPRA_NOTIFICADO.set(clienteId, Date.now())
        const telefonoReal = await numeroRealPromise
        console.log(`[bot] 💰 Interés de compra de ${telefonoReal}: ${textoCliente.substring(0, 80)}`)
        eventBus.emit(EventType.ORDER_CREATED, { telefono: telefonoReal, descripcion: textoCliente.substring(0, 300) })
      }
    }

    // ── DETECCIÓN DE PETICIÓN DE FOTOS ──────────────────────────
    const pideFotos = pideFotosDisponibles && !VENTAS_CERRADAS.has(clienteId)
    if (pideFotos) {
      const ahoraFotos = FOTOS_NOTIFICADO.get(clienteId) ?? 0
      if (Date.now() - ahoraFotos > 60 * 60_000) {
        FOTOS_NOTIFICADO.set(clienteId, Date.now())
        const telefonoReal = await numeroRealPromise
        notificarEmpleadosWhatsApp(sock,
          `📸 *Cliente pide fotos de arreglos:* ${telefonoReal}\n\nContáctalo directamente por WhatsApp y envíale fotos de lo que tenemos disponible.`
        ).catch(err => console.error('[bot] WhatsApp empleados fotos:', err))
        eventBus.emit(EventType.PHOTO_REQUESTED, { telefono: telefonoReal, cliente: '' })
        console.log(`[bot] 📸 Alerta de fotos enviada para ${telefonoReal}`)
      }
    }

    aplicarDatosPedidoDesdeTexto(clienteId, textoCliente)
    const extrasDetectados = extrasPedidoTexto(clienteId)
    if (extrasDetectados) {
      contextoExtra +=
        `\n\n[EXTRAS DETECTADOS EN PEDIDO] ${extrasDetectados}. ` +
        `Estos costos NO son precio del ramo. Mantén ramo, extras, envío y total separados. ` +
        `Si aparece $10 por nota/tarjeta/dedicatoria, es solo extra; nunca digas que el ramo cuesta $10.`
    }

    const tipoMediaProcesada = await procesarMediaAcumulado(clienteId, await numeroRealPromise, textoCliente, msg.pushName)
    if (tipoMediaProcesada === 'referencia') {
      const respuesta = 'Ya recibí la foto de referencia 🌷 Se la paso al equipo para que la revise y te confirme el precio.'
      await responderMensaje(msg, respuesta)
      await agregarAlHistorial(telefono, 'assistant', respuesta)
      return
    }
    if (tipoMediaProcesada === 'imagen') {
      const respuesta = 'Ya recibí tu imagen 🌷 Se la paso al equipo para que la revise.'
      await responderMensaje(msg, respuesta)
      await agregarAlHistorial(telefono, 'assistant', respuesta)
      return
    }
    if (tipoMediaProcesada === 'comprobante') {
      const respuesta = 'Gracias, ya recibí tu comprobante 🌷 Lo registro para que el equipo continúe con tu pedido.'
      await responderMensaje(msg, respuesta)
      await agregarAlHistorial(telefono, 'assistant', respuesta)
      return
    }

    if (seleccionaFotoDisponible && /\b(precio|cu[aá]nto|cuanto|saldr[ií]a|costar[ií]a)\b/i.test(textoCliente) && !tienePrecioConfirmado(clienteId)) {
      const telefonoReal = await numeroRealPromise
      await persistirPedido(clienteId, telefonoReal, 'cotizacion', 'Cliente eligio foto disponible, falta precio del equipo')
      notificarEmpleadosWhatsApp(sock,
        `🌷 *Cliente eligió un ramo de las fotos disponibles:* ${telefonoReal}\n\n${textoCliente.slice(0, 300)}\n\nConfirma el precio real del ramo antes de continuar.`
      ).catch(err => console.error('[bot] WhatsApp empleados precio foto disponible:', err))
      const respuesta = detectarLinkMaps(textoCliente) || /\b(env[ií]o|env[ií]ar|domicilio|direcci[oó]n)\b/i.test(textoCliente)
        ? 'Sí, podemos revisar el envío 🌷 Déjame confirmar con el equipo el precio real de ese ramo y el costo de envío antes de apartarlo.'
        : 'Claro 🌷 Déjame confirmar con el equipo el precio real de ese ramo y te digo.'
      await responderMensaje(msg, respuesta)
      await agregarAlHistorial(telefono, 'assistant', respuesta)
      return
    }

    // ── VENTA CERRADA manual ────────────────────────────────────
    if (/venta\s*cerrada/i.test(textoCliente)) {
      const venta = ventaDesdeEstado(clienteId)
      if (venta) {
        if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
        await ventaCerradaHandler(clienteId, venta, await numeroRealPromise)
      }
    }

    // ── EXTRAER DATOS DEL PEDIDO ────────────────────────────────
    const notaMatch = textoCliente.match(/nota[:\s]*([\s\S]{1,500})/i)
    if (notaMatch && tieneArregloVerificado(clienteId)) pedidoActual(clienteId).nota = notaMatch[1].trim().slice(0, 500)

    const nombreMatch = textoCliente.match(/(?:a qué nombre|a nombre de|nombre de|nombre|apartar a nombre de|para quien|para quién|ponerle|se lo aparto a nombre de)[:\s]*([a-záéíóúñ\s]+)/i)
    if (nombreMatch && tieneArregloVerificado(clienteId)) {
      const nombre = extraerNombrePedido(textoCliente) ?? nombreMatch[1].trim().replace(/\s+/g, ' ').slice(0, 80)
      if (!/^(ok|si|sí|vale|dale|va|de acuerdo|esta bien|está bien)$/i.test(nombre)) {
        pedidoActual(clienteId).nombre = nombre
      }
    }

    if (!pedidoActual(clienteId).nombre && tieneArregloVerificado(clienteId) && pareceNombreCliente(textoCliente)) {
      pedidoActual(clienteId).nombre = textoCliente.trim().replace(/\s+/g, ' ').slice(0, 80)
    }

    const primeraLineaNombre = textoCliente.split('\n---\n')[0]?.trim() || ''
    if (!pedidoActual(clienteId).nombre && tieneArregloVerificado(clienteId) && pareceNombreCliente(primeraLineaNombre)) {
      pedidoActual(clienteId).nombre = primeraLineaNombre.replace(/\s+/g, ' ').slice(0, 80)
    }

    let ventaCerrada = false

    // ── MÉTODO DE PAGO ──────────────────────────────────────────
    const consultaPagoEnviado = /(?:ya\s*)?pag[uú]e|comprobante|recibo|ticket|transferencia|ya\s*transfer|transfer[ií]|transfiero|le\s+transfiero|devi\s+america|devi\s+américa/i.test(textoCliente)
    if (consultaPagoEnviado && tieneArregloVerificado(clienteId)) {
      pedidoActual(clienteId).metodoPago = 'transferencia'
      pedidoActual(clienteId).estadoFlujo = 'esperando_pago'
      persistirPedido(clienteId, await numeroRealPromise, 'apartado', textoCliente).catch(() => {})
    }

    const sucParsed = parseSucursal(textoCliente)
    if (sucParsed.confianza === 'alta' && sucParsed.sucursal && tieneArregloVerificado(clienteId)) {
      pedidoActual(clienteId).sucursal = sucParsed.sucursal
      if (!consultaPagoEnviado) {
        pedidoActual(clienteId).metodoPago = /tarjeta/i.test(textoCliente) ? 'tarjeta_recoger' : 'efectivo_recoger'
        pedidoActual(clienteId).estadoFlujo = 'esperando_fecha_hora'
      }
      contextoExtra +=
        `\n\n[CLIENTE RECOGE EN SUCURSAL] ` +
        `INSTRUCCION: Confirma dirección: Av. Hidalgo 12, Apizaco Centro. ` +
        `Pregunta en qué horario pasará y comparte la cuenta BBVA por si quiere adelantar el pago. ` +
        `El equipo preparará su pedido.`
    }

    const pagoEfectivoAlRecoger = /\b(efectivo|tarjeta)\b/i.test(textoCliente) && /\b(recoger|pasar[ií]a|pasaria|paso|sucursal|norte|centro)\b/i.test(textoCliente)
    const pedidoParaCierre = PEDIDO_EN_CURSO.get(clienteId)
    const ventaParaCierre = ventaDesdeEstado(clienteId)
    if (!VENTAS_CERRADAS.has(clienteId) && ventaParaCierre && pagoEfectivoAlRecoger && ventaListaParaCerrar(clienteId) && (pedidoParaCierre?.sucursal || /\b(norte|centro)\b/i.test(textoCliente))) {
      if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
      const confirmacion = `¡Listo, ${ventaParaCierre.cliente}! 🌷 Tu pedido queda apartado para ${ventaParaCierre.direccion}. Total: ${ventaParaCierre.total}. Pagas al recoger.`
      await responderMensaje(msg, confirmacion)
      await agregarAlHistorial(telefono, 'assistant', confirmacion)
      await pedidoApartadoHandler(clienteId, ventaParaCierre, await numeroRealPromise, 'Efectivo al recoger')
      ventaCerrada = true
    }

    const cierrePagoTransferencia = /\b(listo|ya\s+qued[oó]|ya\s+pag[uú]e|ya\s+transfer[ií]|comprobante)\b/i.test(textoCliente) && (consultaPagoEnviado || /\b(bbva|devi\s+america|devi\s+américa|cuenta|transferencia)\b/i.test(historialTexto))
    if (!ventaCerrada && !VENTAS_CERRADAS.has(clienteId) && ventaParaCierre && cierrePagoTransferencia && ventaListaParaCerrar(clienteId)) {
      if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
      const confirmacion = `¡Gracias, ${ventaParaCierre.cliente}! 🌸 Tu pedido queda registrado. Total: ${ventaParaCierre.total}.`
      await responderMensaje(msg, confirmacion)
      await agregarAlHistorial(telefono, 'assistant', confirmacion)
      await ventaCerradaHandler(clienteId, ventaParaCierre, await numeroRealPromise)
      ventaCerrada = true
    }

    // ── CIERRE DE VENTA ─────────────────────────────────────────
    if (!ventaCerrada && !VENTAS_CERRADAS.has(clienteId) && confirmaCorto && ventaListaParaCerrar(clienteId) && (tieneArregloVerificado(clienteId) || (textoCliente.length < 150 && !textoCliente.includes('?')))) {
      const venta = ventaDesdeEstado(clienteId)
      if (venta) {
        const pedido = PEDIDO_EN_CURSO.get(clienteId)
        const subtotal = pedido?.arreglo?.precio ?? ARREGLO_ELEGIDO.get(clienteId)?.precio ?? pedido?.precioPersonalizado ?? 0
        const extras = totalExtrasPedido(clienteId)
        const envio = pedido?.envio?.precio ?? 0
        const total = subtotal + extras + envio
        const desglose = [`ramo $${subtotal.toFixed(2)}`]
        if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
        if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
        const totalTexto = desglose.length > 1 ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})` : `$${total.toFixed(2)} MXN`
        if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
        await ventaCerradaHandler(clienteId, {
          cliente: venta.cliente,
          producto: venta.producto,
          total: totalTexto,
          direccion: venta.direccion,
        }, await numeroRealPromise)
        ventaCerrada = true
      }
    }

    if (!ventaCerrada && !VENTAS_CERRADAS.has(clienteId) && apartadoSucursalListo(clienteId)) {
      const venta = ventaDesdeEstado(clienteId)
      if (venta) {
        const metodo = pedidoActual(clienteId).metodoPago === 'tarjeta_recoger' ? 'Tarjeta al recoger' : 'Efectivo al recoger'
        const confirmacion = `¡Listo, ${venta.cliente}! 🌷 Tu pedido queda apartado para ${venta.direccion}. Total: ${venta.total}. Pagas al recoger.`
        await responderMensaje(msg, confirmacion)
        await agregarAlHistorial(telefono, 'assistant', confirmacion)
        await pedidoApartadoHandler(clienteId, venta, await numeroRealPromise, metodo)
        ventaCerrada = true
      }
    }

    // ── ATENCIÓN HUMANA (notificación de alerta si aplica)
    if (motivoAtencionHumana && debeNotificarAtencionHumana(clienteId) && debeEnviarAlertaDedup(clienteId, 'atencion-humana', motivoAtencionHumana, 20 * 60_000)) {
      eventBus.emit(EventType.HUMAN_REQUIRED, { telefono: await numeroRealPromise, cliente: msg.pushName || '', descripcion: textoCliente.substring(0, 300), contexto: motivoAtencionHumana })
    }

    // ── GENERAR CONTEXTO DE IA ──────────────────────────────────
    if (!ventaCerrada) {
      const zonas = await obtenerZonasEnvio()
      const zonasPrompt = formatearZonasParaPrompt(zonas)
      if (zonasPrompt) contextoExtra += `\n\nZonas de envío disponibles:\n${zonasPrompt}`

      contextoExtra += `\n\nForma de pago:\nBBVA | 4152314097305273 | Devi América Cerenil\n` +
        `(Pregunta el nombre para apartarlo)`

      const respuestaIA = await getAIResponse(
        historialCompleto.length > 0 ? historialCompleto : [],
        contextoExtra,
      )

      if (!respuestaIA) {
        await responderMensaje(msg, '🌷 Dame un momento, estoy revisando...')
        return
      }

      const mensajeFinal       = limpiarRespuestaIA(respuestaIA.mensaje)
      const precioPersonalizado = extraerPrecioRespuesta(mensajeFinal)
      const parecePedidoPersonalizado = /\b(apartar|ramo|ramito|lili|lilis|rosa|rosas|papel|personalizado|as[ií]|referencia)\b/i.test(textoCliente)
      if (!ARREGLO_ELEGIDO.has(clienteId) && precioPersonalizado && parecePedidoPersonalizado) {
        const pedido = pedidoActual(clienteId)
        pedido.productoPersonalizado ||= describirPedidoPersonalizado(textoCliente)
        pedido.precioPersonalizado = precioPersonalizado
        pedido.precioConfirmadoPor ||= 'ia'
        pedido.estadoFlujo = 'precio_confirmado'
        persistirPedido(clienteId, await numeroRealPromise, 'cotizacion', textoCliente).catch(() => {})
      }

      let mensajeParaEnviar = mensajeFinal

      const revision = await revisarRespuestaFlora(
        historialCompleto,
        textoCliente,
        mensajeParaEnviar,
        [
          `clasificacion: ${JSON.stringify(clasificacionIA)}`,
          `estado_pedido: ${PEDIDO_EN_CURSO.get(clienteId)?.estadoFlujo ?? 'sin_pedido'}`,
          `precio_confirmado: ${precioPedidoActual(clienteId) || 'no'}`,
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

    const ventaEstado = ventaDesdeEstado(clienteId)
    if (!VENTAS_CERRADAS.has(clienteId) && ventaEstado && ventaListaParaCerrar(clienteId) && (
      confirmaCorto || /lo[sv]? quiero|me gusta|adelante|procedo|hagamoslo|hag[aá]moslo|d[aá]le|adelante|apartalo|aparta lo|si? (por favor|gracias)/i.test(textoCliente)
    )) {
      const pedido = PEDIDO_EN_CURSO.get(clienteId)
      const subtotal = pedido?.arreglo?.precio ?? ARREGLO_ELEGIDO.get(clienteId)?.precio ?? pedido?.precioPersonalizado ?? 0
      const extras = totalExtrasPedido(clienteId)
      const envio = pedido?.envio?.precio ?? 0
      const total = subtotal + extras + envio
      const desglose = [`ramo $${subtotal.toFixed(2)}`]
      if (extras > 0) desglose.push(`extras $${extras.toFixed(2)}`)
      if (envio > 0) desglose.push(`envío $${envio.toFixed(2)}`)
      const totalTexto = desglose.length > 1 ? `$${total.toFixed(2)} MXN (${desglose.join(' + ')})` : `$${total.toFixed(2)} MXN`
      if (await pedirFechaHoraSiFalta(msg, await numeroRealPromise, clienteId)) return
      ventaCerradaHandler(clienteId, {
        cliente: ventaEstado.cliente,
        producto: ventaEstado.producto,
        total: totalTexto,
        direccion: ventaEstado.direccion,
      }, await numeroRealPromise)
    }

    await responderMensaje(msg, mensajeParaEnviar)
    await agregarAlHistorial(telefono, 'assistant', mensajeParaEnviar)
    if (respuestaPideComprobante(mensajeParaEnviar) && tieneArregloVerificado(clienteId)) {
      const pedido = pedidoActual(clienteId)
      pedido.metodoPago = 'transferencia'
      pedido.estadoFlujo = 'esperando_pago'
      persistirPedido(clienteId, await numeroRealPromise, 'apartado', 'Esperando comprobante de transferencia').catch(() => {})
    }
  }
  } catch (err) {
    console.error('[bot] Error en procesarMensaje:', err)
    try {
      if (msg?.key?.remoteJid) {
        await responderMensaje(msg, '🌷 Perdón, un pequeño mareo digital. ¿Me repites?')
      }
    } catch {}
  } finally {
    const mediaPendiente = MEDIA_POR_CLIENTE.get(clienteId)
    if (mediaPendiente && mediaPendiente.length > 0) {
      MEDIA_POR_CLIENTE.delete(clienteId)
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

// ════════════════════════════════════════════════════════════════
// VENTA CERRADA
// ════════════════════════════════════════════════════════════════

async function ventaCerradaHandler(clienteId: string, venta: VentaCerrada, telefono: string): Promise<void> {
  if (VENTAS_CERRADAS.has(clienteId)) return
  VENTAS_CERRADAS.add(clienteId)

  const numeroReal = telefono.startsWith('+') ? telefono : `+${telefono}`
  const pedido = pedidoActual(clienteId)
  pedido.metodoPago ||= 'transferencia'
  pedido.estadoFlujo = 'pagado_transferencia'
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
  resetearPedidoCliente(clienteId)
}

async function pedidoApartadoHandler(clienteId: string, venta: VentaCerrada, telefono: string, metodoPago: string): Promise<void> {
  const numeroReal = telefono.startsWith('+') ? telefono : `+${telefono}`
  const pedido = pedidoActual(clienteId)
  pedido.estadoFlujo = 'apartado_sucursal'
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
// DESCARGA DE MEDIA
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// MANEJADOR DE MENSAJES ENTRANTES
// ════════════════════════════════════════════════════════════════

async function manejarMensajeEntrante(msg: any): Promise<void> {
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
    console.log(`[bot] ↩️ Mensaje duplicado ignorado: ${obtenerMensajeId(msg)}`)
    return
  }

  // Ignorar números silenciados
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
    console.log(`[bot] 🔇 Número ignorado: ${numeroRealParaIgnorar || remoteJid}`)
    return
  }

  // Guardar mensajes enviados desde la cuenta (agente humano) al historial
  if (msg.key?.fromMe) {
    const telefonoDestino = remoteJid.replace(/@[^\s]*/g, '').trim()
    if (telefonoDestino) {
      const num = telefonoDestino.startsWith('52') ? `+${telefonoDestino}` : telefonoDestino
      if (msgType === 'image' || msgType === 'document') marcarFotosDisponibles(remoteJid)
      if (!body) return
      registrarIntervencionHumana(remoteJid, body)
      await agregarAlHistorial(num, 'assistant', `[Agente: ${body.trim()}]`)
      if (esMensajeFotosDisponiblesEquipo(body)) marcarFotosDisponibles(remoteJid)
      const precioAgente = extraerPrecioRespuesta(body)
      if (precioAgente) {
        const pedido = pedidoActual(remoteJid)
        if (pedido.esperandoPrecioEnvio || /\b(env[ií]o|flete|reparto|domicilio|llevar)\b/i.test(body)) {
          pedido.envio = { zona: pedido.envio?.zona ?? 'Envío confirmado por equipo', precio: precioAgente }
          pedido.esperandoPrecioEnvio = false
          if (pedido.precioPersonalizado || pedido.arreglo || ARREGLO_ELEGIDO.get(remoteJid)) pedido.estadoFlujo = 'esperando_pago'
        } else {
          pedido.productoPersonalizado ||= 'Ramo personalizado'
          pedido.precioPersonalizado = precioAgente
          pedido.precioConfirmadoPor = 'equipo'
          pedido.estadoFlujo = 'precio_confirmado'
        }
        persistirPedido(remoteJid, num, 'cotizacion', `[Agente: ${body.trim()}]`).catch(() => {})
      }
      if (/\b(gracias\s+por\s+(su\s+)?pago|pago\s+recibido|comprobante\s+recibido|le\s+agendamos|queda\s+agendado|pagado)\b/i.test(body)) {
        const pedido = pedidoActual(remoteJid)
        pedido.metodoPago = 'transferencia'
        pedido.estadoFlujo = 'pagado_transferencia'
        const venta = ventaDesdeEstado(remoteJid)
        if (venta && ventaListaParaPagoTransferencia(remoteJid)) {
          ventaCerradaHandler(remoteJid, venta, num).catch(() => {})
        } else {
          persistirPedido(remoteJid, num, 'pagado', `[Agente confirmó pago: ${body.trim()}]`).catch(() => {})
        }
      }
    }
    return
  }

  const clienteId = remoteJid

  // ── STICKERS: ignorar completamente ────────────────────────────
  if (msgType === 'sticker') {
    const stickerId = obtenerMensajeId(msg)
    if (stickerId) marcarMensajeProcesado(stickerId)
    return
  }

  if (msgType !== 'chat' && TIPOS_MEDIA_NO_SOPORTADOS.has(msgType)) {
    if (msgType === 'image' || msgType === 'document') {
      // Descargar la imagen y agregarla al batch junto con mensajes de texto
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
      // Video, audio, ptt — no soportados
      responderMensaje(msg, 'Por ahora solo puedo leer mensajes de *texto* 🌸. ¿Qué necesitas?').catch(() => {})
    }
    return
  }

  if (!body.trim()) return
  if (estaRateLimited(clienteId)) { avisarRateLimitUnaVez(msg, clienteId); return }

  verificarSiBotPausado().then(pausado => {
    if (pausado) { console.log(`[bot] ⏸️ Pausado — ${clienteId} ignorado`); return }
    encolarMensajeAgrupado(clienteId, msg)
  }).catch(() => encolarMensajeAgrupado(clienteId, msg))
}

function timestampMensajeMs(msg: any): number {
  const ts = msg?.messageTimestamp
  const segundos = Number(ts?.toNumber?.() ?? ts ?? 0)
  return Number.isFinite(segundos) ? segundos * 1000 : 0
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
    console.log(`[bot] 🛟 Rescatando ${pendientes.length} mensaje(s) no leído(s) de ${jid}`)
    for (const msg of pendientes) {
      const id = obtenerMensajeId(msg)
      if (id) MENSAJES_RESCATADOS.add(id)
      await manejarMensajeEntrante(msg)
    }
  }
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
        await manejarMensajeEntrante(msg)
      } catch (err) {
        console.error('[bot] Error en messages.upsert:', err)
      }
    }
  })

  sock.ev.on('messaging-history.set', async ({ chats, messages, isLatest }) => {
    if (!isLatest) return
    try {
      await rescatarMensajesNoLeidos(chats, messages)
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

iniciarBaileys().catch((err) => { console.error('❌ Error:', err); registrarCrash(); process.exit(1) })

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚠️ ${signal} recibido — cerrando graceful...`)
  const timer = setTimeout(() => {
    console.warn('[shutdown] Timeout 10s — forzando exit.')
    process.exit(1)
  }, 10_000)
  timer.unref()

  try {
    if (sock) sock.end(undefined)
  } catch (e) {
    console.error('[shutdown] Error al cerrar:', e)
  }
  clearTimeout(timer)
  process.exit(0)
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('uncaughtException',  (err) => console.error('❌ Excepción:', err))
process.on('unhandledRejection', (r)   => console.error('❌ Rechazo:', r))


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
})
