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

dotenv.config({ path: '.env.local' })

import { getAIResponse } from './lib/ai'
import {
  enviarAlertaVentaCerrada,
  enviarAlertaPedidoWeb,
  enviarAlertaCotizacion,
  enviarAlertaClienteFrustrado,
  enviarAlertaArregloApartado,
  enviarAlertaQr,
  enviarAlertaReconectado,
  enviarAlertaDiariaDesconexion,
  enviarAlertaCancelacion,
  enviarAlertaQueja,
  enviarAlertaAtencionHumana,
  enviarAlertaPedidoApartado,
  enviarAlertaZonaAmbigua,
  enviarAlertaClienteInteresado,
  enviarAlertaEmpleadoFotos,
  enviarAlertaEmpleadoEnvio,
  enviarFotoTelegram,
} from './lib/telegram'
import { supabaseAdmin } from './lib/supabase'
import type { MensajeChat } from './lib/ai'
import type { VentaCerrada } from './lib/types'

// ════════════════════════════════════════════════════════════════
// HISTORIAL DE CONVERSACIONES
// ════════════════════════════════════════════════════════════════

const MAX_TURNOS_HISTORIAL  = 10
const CACHE_CLIENTE_UUID = new Map<string, string>()
let IGNORADOS_CACHE: string[] = []
let IGNORADOS_ULTIMA = 0

function variantesTelefono(numero: string): string[] {
  const limpio = String(numero ?? '').replace(/\D/g, '')
  const variantes = new Set<string>()
  if (!limpio) return []

  variantes.add(limpio)
  if (limpio.startsWith('521') && limpio.length === 13) variantes.add(`52${limpio.slice(3)}`)
  if (limpio.startsWith('52') && limpio.length === 12) variantes.add(`521${limpio.slice(2)}`)
  if (limpio.length === 10) {
    variantes.add(`52${limpio}`)
    variantes.add(`521${limpio}`)
  }
  if (limpio.length > 10) variantes.add(limpio.slice(-10))

  return [...variantes]
}

async function cargarIgnorados(): Promise<string[]> {
  const ahora = Date.now()
  if (ahora - IGNORADOS_ULTIMA < 5_000) return IGNORADOS_CACHE
  try {
    const { data } = await supabaseAdmin.from('numeros_ignorados').select('numero')
    IGNORADOS_CACHE = [...new Set((data || []).flatMap(n => variantesTelefono(n.numero)))]
    IGNORADOS_ULTIMA = ahora
  } catch { /* mantener caché anterior */ }
  return IGNORADOS_CACHE
}

function jidToTelefono(jid: string): string {
  const limpio = (jid || '').replace(/@[^\s]*/g, '').trim()
  return limpio.startsWith('52') ? `+${limpio}` : limpio
}

function extraerTelefono(msg: any): string {
  return jidToTelefono(msg.key?.remoteJid || '')
}

async function obtenerClienteId(telefono: string): Promise<string | null> {
  const cached = CACHE_CLIENTE_UUID.get(telefono)
  if (cached) return cached

  try {
    const { data: existing } = await supabaseAdmin
      .from('clientes').select('id').eq('telefono', telefono).maybeSingle()

    if (existing) {
      CACHE_CLIENTE_UUID.set(telefono, existing.id)
      return existing.id
    }

    const { data: nuevo } = await supabaseAdmin
      .from('clientes').insert({ telefono }).select('id').single()

    if (nuevo) {
      CACHE_CLIENTE_UUID.set(telefono, nuevo.id)
      return nuevo.id
    }
  } catch (err) {
    console.error('[bot] Error en obtenerClienteId:', err)
  }
  return null
}

async function obtenerHistorial(telefono: string): Promise<MensajeChat[]> {
  const clienteId = await obtenerClienteId(telefono)
  if (!clienteId) return []

  try {
    const { data } = await supabaseAdmin
      .from('historial_chat').select('rol, contenido')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(MAX_TURNOS_HISTORIAL * 2)

    return (data ?? []).reverse().map(m => ({
      role: m.rol as 'user' | 'assistant',
      content: m.contenido,
    }))
  } catch (err) {
    console.error('[bot] Error leyendo historial:', err)
    return []
  }
}

async function agregarAlHistorial(telefono: string, role: 'user' | 'assistant', content: string): Promise<void> {
  const clienteId = await obtenerClienteId(telefono)
  if (!clienteId) return

  try {
    await supabaseAdmin.from('historial_chat').insert({
      cliente_id: clienteId,
      rol: role,
      contenido: content,
    })
  } catch (err) {
    console.error('[bot] Error guardando historial:', err)
  }
}

// ════════════════════════════════════════════════════════════════
// DEDUPLICACIÓN DE MENSAJES
// ════════════════════════════════════════════════════════════════

const MENSAJES_PROCESADOS = new Map<string, number>()
const MENSAJE_PROCESADO_TTL_MS = 2 * 60 * 60_000

const MENSAJES_RESCATADOS = new Set<string>()

function obtenerMensajeId(msg: any): string | null {
  return msg?.key?.id || null
}

function marcarMensajeProcesado(id: string): void {
  MENSAJES_PROCESADOS.set(id, Date.now())
}

function yaProcesadoRecientemente(msg: any): boolean {
  const id = obtenerMensajeId(msg)
  if (!id) return false

  const ahora = Date.now()
  const procesadoEn = MENSAJES_PROCESADOS.get(id)
  if (procesadoEn && ahora - procesadoEn < MENSAJE_PROCESADO_TTL_MS) return true

  marcarMensajeProcesado(id)
  if (MENSAJES_PROCESADOS.size > 1000) {
    for (const [msgId, ts] of MENSAJES_PROCESADOS) {
      if (ahora - ts > MENSAJE_PROCESADO_TTL_MS) MENSAJES_PROCESADOS.delete(msgId)
    }
  }
  return false
}

// ════════════════════════════════════════════════════════════════
// EXTRACCIÓN DE TEXTO Y TIPO DE MENSAJE (proto Baileys)
// ════════════════════════════════════════════════════════════════

function getMessageBody(msg: any): string {
  const full = msg?.message
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

function getMensajeTexto(msg: any): string {
  return typeof msg?.body === 'string' ? msg.body : getMessageBody(msg)
}

function getMessageType(msg: any): string {
  const full = msg?.message
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

function hasQuotedMsg(msg: any): boolean {
  const ci = msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.imageMessage?.contextInfo
    || msg?.message?.videoMessage?.contextInfo
  return !!(ci?.stanzaId || ci?.quotedMessage)
}

function getQuotedText(msg: any): string {
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

// ════════════════════════════════════════════════════════════════
// HORARIO DE ATENCIÓN
// ════════════════════════════════════════════════════════════════

function estaEnHorario(): boolean {
  const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const hora  = ahora.getHours() * 60 + ahora.getMinutes()
  const dia   = ahora.getDay()
  const esFinDeSemana = dia === 0 || dia === 6
  return hora >= 10 * 60 && hora < (esFinDeSemana ? 17 * 60 : 19 * 60)
}

function getContextoHorario(): string {
  if (estaEnHorario()) return '';
  
  const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const hora = ahora.getHours();
  
  const estadoHorario = hora < 10 
    ? 'Aún no abrimos (abrimos a las 10:00 am).' 
    : 'Ya cerramos por hoy (abrimos mañana a las 10:00 am).';

  return (
    `\n\n[CONTEXTO: Fuera de Horario] ${estadoHorario} ` +
    `REGLA DE ORO: NUNCA le digas al cliente "mañana te muestro" o "mañana te atiendo". ` +
    `SÍ PUEDES y DEBES enviarle el link del catálogo o el cotizador web (https://floreria-app-mauve.vercel.app/) en este momento para que adelante su pedido y quede agendado para nuestra apertura. ` +
    `Para cotizaciones de envío complejas que no estén en la web, dile amablemente que a las 10 am le confirmas el costo exacto.`
  );
}

// ════════════════════════════════════════════════════════════════
// NÚMERO REAL DEL CONTACTO
// ════════════════════════════════════════════════════════════════

const CACHE_NUMEROS = new Map<string, string>()

async function obtenerNumeroReal(msg: any): Promise<string> {
  const jid = msg.key?.remoteJid || ''
  if (CACHE_NUMEROS.has(jid)) return CACHE_NUMEROS.get(jid)!
  if (CACHE_NUMEROS.size > 500) CACHE_NUMEROS.clear()

  // Si es @lid, no podemos extraer número real — el LID es el identificador
  if (jid.endsWith('@lid')) {
    CACHE_NUMEROS.set(jid, jid)
    return jid
  }

  const limpio = jid.replace(/@[^\s]*/g, '').trim()
  const numero = limpio.startsWith('52') ? `+${limpio}` : limpio
  CACHE_NUMEROS.set(jid, numero)
  return numero
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE CANCELACIÓN, QUEJAS Y EVENTOS ESPECIALES
// ════════════════════════════════════════════════════════════════

const KW_CANCELACION = [
  'cancelar', 'cancela', 'cancelación', 'cancelacion', 'ya no quiero',
  'quiero cancelar', 'mejor ya no', 'ya no lo quiero', 'cancel',
  'quiero revertir', 'reversar',
]

const KW_QUEJA = [
  'queja', 'reclamo', 'producto dañado', 'llegó mal', 'llegó roto',
  'flores marchitas', 'flores feas', 'no es lo que pedí', 'pedido incorrecto',
  'devolución', 'devolucion', 'reembolso', 'me cobraron mal',
  'no llegó', 'no llego', 'pedido incompleto',
]

const KW_EVENTOS = [
  'boda', 'casamiento', 'me caso', 'me voy a casar',
  'xv años', 'quinceañera', 'quince años', 'xv',
  'funeral', 'velorio', 'falleció', 'fallecio', 'muerte', 'luto',
  'aniversario', 'graduación', 'graduacion', 'baby shower',
  'san valentín', 'san valentin', '14 de febrero', '10 de mayo',
  'día de las madres', 'dia de las madres',
]

function detectarCancelacion(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_CANCELACION.some(k => n.includes(k))
}

function detectarQueja(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_QUEJA.some(k => n.includes(k))
}

function detectarEvento(texto: string): string | null {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const matched = KW_EVENTOS.find(k => n.includes(k))
  return matched || null
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE INTERÉS DE COMPRA
// ════════════════════════════════════════════════════════════════

const KW_INTERES_COMPRA = [
  'necesito', 'necesito un', 'busco', 'busco un', 'quiero un', 'quisiera',
  'me gustaría', 'me gustaria', 'anda tener', 'se ocupa',
  'qué flores', 'que flores', 'flores tiene', 'tienes disponibles',
  'flores disponibles', 'qué ramos', 'que ramos', 'qué arreglos',
  'me puede', 'pueden hacer', 'hacen arreglos', 'armar un',
  'ramo para', 'arreglo para', 'flor para',
  'cotización de', 'cotizacion de',
]

function detectarInteresCompra(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_INTERES_COMPRA.some(k => n.includes(k))
}

// ════════════════════════════════════════════════════════════════
// EMPLEADOS A NOTIFICAR (guardados en Supabase configuracion_bot)
// ════════════════════════════════════════════════════════════════

let CACHE_EMPLEADOS: { numeros: string[]; ts: number } | null = null

async function obtenerEmpleadosANotificar(): Promise<string[]> {
  const ahora = Date.now()
  if (CACHE_EMPLEADOS && ahora - CACHE_EMPLEADOS.ts < 120_000) return CACHE_EMPLEADOS.numeros
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'empleados_notificar')
      .maybeSingle()
    if (error) throw error
    const numeros = (data?.valor ?? '')
      .split(',')
      .map((n: string) => n.trim().replace(/\s/g, ''))
      .filter(Boolean)
    CACHE_EMPLEADOS = { numeros, ts: ahora }
    return numeros
  } catch {
    return []
  }
}

async function notificarEmpleadosWhatsApp(mensaje: string): Promise<void> {
  const numeros = await obtenerEmpleadosANotificar()
  if (numeros.length === 0 || !sock?.user) return
  for (const num of numeros) {
    try {
      const jid = num.includes('@') ? num : `${num}@s.whatsapp.net`
      await sock.sendMessage(jid, { text: mensaje })
    } catch (err) {
      console.warn(`[bot] Error notificando a empleado ${num}:`, err)
    }
  }
}

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
    CACHE_CLIENTE_UUID.clear()
    CACHE_NUMEROS.clear()
    FRUSTRACION_NOTIFICADA.clear()
    RATE_TIMESTAMPS.clear()
    MENSAJES_RESCATADOS.clear()
    MENSAJES_PROCESADOS.clear()
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
    enviarAlertaDiariaDesconexion().catch(() => {})
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

async function registrarVenta(clienteNombre: string, telefono: string, producto: string, total: string, direccion: string): Promise<void> {
  try {
    const precioNumerico = extraerTotalNumerico(total)
    const { error } = await supabaseAdmin.from('reporte_ventas').insert({
      cliente_telefono: telefono,
      cliente_nombre: clienteNombre,
      producto,
      precio_total: precioNumerico,
      direccion_entrega: direccion,
      metodo_pago: 'transferencia',
      estado: 'pagado',
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
    return montos.reduce((sum, monto) => sum + normalizar(monto), 0)
  }

  return primero
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
const AGRUPAR_MENSAJES_MS = 2500

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
  const timer = setTimeout(() => {
    MENSAJES_POR_AGRUPAR.delete(clienteId)
    const textos = mensajes.map(m => getMessageBody(m)).filter(Boolean)
    if (textos.length === 0) return

    const base = mensajes.find(m => hasQuotedMsg(m)) ?? mensajes[mensajes.length - 1]
    base.body = textos.join('\n')
    for (const m of mensajes) {
      const id = obtenerMensajeId(m)
      if (id && m !== base) marcarMensajeProcesado(id)
    }

    console.log(`[bot] 🧵 Agrupando ${mensajes.length} mensajes de ${clienteId}`)
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
const PEDIDO_EN_CURSO  = new Map<string, { arreglo?: ArregloConFoto; envio?: { zona: string; precio: number }; nombre?: string; direccion?: string; sucursal?: string; metodoPago?: 'transferencia' | 'efectivo_recoger'; nota?: string }>()

function pedidoActual(clienteId: string) {
  const pedido = PEDIDO_EN_CURSO.get(clienteId) ?? {}
  PEDIDO_EN_CURSO.set(clienteId, pedido)
  return pedido
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
  if (!arreglo) return null
  return arreglo.precio + (pedido?.envio?.precio ?? 0)
}

async function persistirPedido(clienteId: string, telefono: string | null, estado: 'cotizacion' | 'apartado' | 'pagado' | 'entregado' | 'cancelado', ultimoMensaje?: string): Promise<void> {
  try {
    const pedido = PEDIDO_EN_CURSO.get(clienteId)
    const arreglo = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
    const total = totalPedidoNumerico(clienteId)
    const { error } = await supabaseAdmin.from('pedidos_bot').upsert({
      cliente_id: clienteId,
      telefono,
      estado,
      cliente_nombre: pedido?.nombre ?? null,
      producto: arreglo?.nombre ?? null,
      arreglo_id: arreglo?.id ?? null,
      precio_arreglo: arreglo?.precio ?? null,
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
    }, { onConflict: 'cliente_id' })
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
}

function ventaDesdeEstado(clienteId: string, fallback?: VentaCerrada): VentaCerrada | null {
  const pedido = PEDIDO_EN_CURSO.get(clienteId)
  const elegido = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
  if (!elegido && !fallback) return null

  const producto = elegido?.nombre ?? fallback?.producto ?? 'Pedido'
  const subtotal = elegido?.precio ?? (parseFloat(String(fallback?.total ?? '').replace(/[^0-9.]/g, '')) || 0)
  const envio = pedido?.envio?.precio ?? 0
  const total = subtotal + envio
  const direccion = pedido?.envio?.zona
    ? `${pedido.envio.zona}${pedido.direccion ? ` — ${pedido.direccion}` : ''}`
    : (pedido?.sucursal ? `Sucursal ${pedido.sucursal}` : (pedido?.direccion ?? fallback?.direccion ?? 'Por confirmar'))

  const totalTexto = pedido?.envio
    ? `$${total.toFixed(2)} MXN (ramo $${subtotal.toFixed(2)} + envío $${envio.toFixed(2)})`
    : `$${total.toFixed(2)} MXN`

  return {
    cliente: pedido?.nombre ?? fallback?.cliente ?? 'Verificar en chat',
    producto,
    total: totalTexto,
    direccion,
    rawToken: fallback?.rawToken ?? '',
  }
}

function tieneArregloVerificado(clienteId: string): boolean {
  return Boolean(PEDIDO_EN_CURSO.get(clienteId)?.arreglo || ARREGLO_ELEGIDO.get(clienteId))
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
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (/foto.*(entrega|entreguen|entregado|repartidor)|comprobante.*entrega|cuando.*entreguen/.test(n)) {
    return 'normal'
  }

  if (VENTAS_CERRADAS.has(clienteId)) {
    return 'normal'
  }

  if (KW_CATALOGO.some(k => n.includes(k)))   return 'catalogo'
  if (KW_COTIZADOR.some(k => n.includes(k)))  return 'cotizador'
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

function normalizarTexto(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function contieneFrase(texto: string, frase: string): boolean {
  if (!frase) return false
  const segura = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${segura}(\\s|$)`).test(texto)
}

type ResultadoEnvio = { zona: string; precio: number; fuente: string } | { ambiguo: true; candidatos: Array<{ zona: string; precio: number; fuente: string }> }

async function buscarPrecioEnvio(texto: string): Promise<ResultadoEnvio | null> {
  const n = normalizarTexto(texto)
  const tieneDatoDireccion = /\b(calle|av\.?|avenida|col\.?|colonia|cp\s*\d{5}|codigo\s*postal|#|num\.?|n[uú]mero|\d{2,})\b/i.test(texto)

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

function getFechaActual(): string {
  return new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City',
  })
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
  enviarAlertaPedidoWeb({
    numeroCliente: numeroReal, total: pedido.total, entrega: pedido.entrega,
    flores: pedido.flores, accesorios: pedido.accesorios || undefined,
    tamano: pedido.tamano, envoltura: pedido.envoltura,
    nota: pedido.nota || undefined, imagenUrl: pedido.imagenUrl || undefined,
  }).catch(err => console.error('[bot] Telegram pedido web:', err))
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

    const pideEmpezarDesdeCero = /empecemos\s+desde\s+cero|desde\s+cero|borr[oó]n\s+y\s+cuenta\s+nueva|nuevo\s+pedido/i.test(textoCliente)
    if (pideEmpezarDesdeCero) resetearPedidoCliente(clienteId)

    const intencion     = detectarIntencion(textoCliente, clienteId)
    const horario       = getContextoHorario()
    let contextoExtra   = `[Fecha actual: ${getFechaActual()}]${horario}`

    if (pideEmpezarDesdeCero) {
      contextoExtra +=
        `\n\n[CLIENTE QUIERE EMPEZAR DESDE CERO] ` +
        `Ignora el pedido anterior de esta conversación. No cierres venta ni uses datos previos.`
    }

    // ── Detección de reply (quote) ────────────────────────────────
    let textoCitado = ''
    if (hasQuotedMsg(msg)) {
      textoCitado = getQuotedText(msg)
    }

    // ── Saludo dinámico en primer mensaje ─────────────────────────
    const historialCompleto = await obtenerHistorial(telefono)
    const historialTexto = historialCompleto.map(m => m.content).join('\n').toLowerCase()
    const motivoAtencionHumana = detectarAtencionHumana(textoCliente)
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
    const mencionaDireccion = /\b(calle|av\.?|avenida|col\.?|colonia|cp\s*\d{5}|codigo\s*postal|#|num\.?|n[uú]mero|\d{2,})\b/i.test(textoCliente)
    const pareceEnvio = mencionaEnvio || mencionaDireccion || detectarLinkMaps(textoCliente)

    if (pareceEnvio) {
      if (mencionaDireccion && ARREGLO_ELEGIDO.has(clienteId)) {
        pedidoActual(clienteId).direccion = limpiarDireccionCliente(textoCliente)
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
        notificarEmpleadosWhatsApp(
          `🚚 *Cliente necesita cotización de envío:* ${telefonoReal}\n\nZona detectada: ${resultadoEnvio.zona} — $${resultadoEnvio.precio}\n\nPor favor confírmale el precio exacto de envío.`
        ).catch(() => {})
      }
    } else if (resultadoEnvio && 'ambiguo' in resultadoEnvio && resultadoEnvio.ambiguo) {
      const telefonoReal = await numeroRealPromise
      registrarZonaAmbigua(textoCliente, telefonoReal, resultadoEnvio.candidatos).catch(() => {})
      if (puedeNotificarEnvio) {
        ENVIO_NOTIFICADO.set(clienteId, Date.now())
        notificarEmpleadosWhatsApp(
          `🚚 *Cliente necesita cotización de envío:* ${telefonoReal}\n\nUbicación: ${textoCliente.slice(0, 100)}\n\nPor favor confírmale el precio exacto de envío.`
        ).catch(() => {})
        enviarAlertaEmpleadoEnvio(clienteId, textoCliente).catch(() => {})
      }
    } else if (pareceEnvio && !resultadoEnvio) {
      const telefonoReal = await numeroRealPromise
      if (puedeNotificarEnvio) {
        ENVIO_NOTIFICADO.set(clienteId, Date.now())
        notificarEmpleadosWhatsApp(
          `🚚 *Cliente necesita cotización de envío:* ${telefonoReal}\n\nUbicación: ${textoCliente.slice(0, 100)}\n\nPor favor confírmale el precio exacto de envío.`
        ).catch(() => {})
        enviarAlertaEmpleadoEnvio(clienteId, textoCliente).catch(() => {})
      }
    }

    // ── Contexto genérico de reply ──────────────────────────────
    if (hasQuotedMsg(msg) && textoCitado) {
      contextoExtra +=
        `\n\n[CLIENTE RESPONDIÓ AL MENSAJE: "${textoCitado.replace(/"/g, "'")}"]` +
        `\nINSTRUCCION: El usuario respondió específicamente a ese mensaje. Úsalo para entender a qué se refiere.`
    }

    // ── CANCELACIÓN ─────────────────────────────────────────────
    if (detectarCancelacion(textoCliente)) {
      contextoExtra +=
        `\n\n[CLIENTE QUIERE CANCELAR UN PEDIDO]` +
        `\nINSTRUCCION: Responde con empatía. Di que notificarás al equipo. ` +
        `NO prometas reembolsos ni descuentos. El sistema notificará automáticamente al administrador.`
      if (debeNotificarReclamacion(clienteId, 'cancelacion')) {
        const telefonoReal = await numeroRealPromise
        const referencia = PEDIDO_EN_CURSO.get(clienteId)?.arreglo?.nombre ?? ARREGLO_ELEGIDO.get(clienteId)?.nombre ?? null
        enviarAlertaCancelacion(telefonoReal, textoCliente.substring(0, 300)).catch(() => {})
        registrarReclamacion(telefonoReal, 'cancelacion', textoCliente, referencia).catch(() => {})
        persistirPedido(clienteId, telefonoReal, 'cancelado', textoCliente).catch(() => {})
      }
    }

    // ── QUEJA ────────────────────────────────────────────────────
    if (detectarQueja(textoCliente)) {
      contextoExtra +=
        `\n\n[CLIENTE TIENE UNA QUEJA O RECLAMO]` +
        `\nINSTRUCCION: Responde con empatía. Pide disculpas y di que lo reportas al equipo. ` +
        `NO ofrezcas compensaciones ni descuentos. El sistema notificará automáticamente.`
      if (debeNotificarReclamacion(clienteId, 'queja')) {
        const telefonoReal = await numeroRealPromise
        const referencia = PEDIDO_EN_CURSO.get(clienteId)?.arreglo?.nombre ?? ARREGLO_ELEGIDO.get(clienteId)?.nombre ?? null
        enviarAlertaQueja(telefonoReal, textoCliente.substring(0, 300)).catch(() => {})
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
        enviarAlertaClienteFrustrado(
          telefono, textoCliente.substring(0, 200)
        ).catch(() => {})
      }
    }

    // ── DETECCIÓN DE INTERÉS DE COMPRA ──────────────────────────
    if (esInteresCompra) {
      const ahoraInteres = INTERES_COMPRA_NOTIFICADO.get(clienteId) ?? 0
      if (Date.now() - ahoraInteres > 30 * 60_000) {
        INTERES_COMPRA_NOTIFICADO.set(clienteId, Date.now())
        const telefonoReal = await numeroRealPromise
        console.log(`[bot] 💰 Interés de compra de ${telefonoReal}: ${textoCliente.substring(0, 80)}`)
        enviarAlertaClienteInteresado(telefonoReal, textoCliente.substring(0, 300)).catch(() => {})
      }
    }

    // ── DETECCIÓN DE PETICIÓN DE FOTOS ──────────────────────────
    const pideFotos = /fotos|ver.*arreglo|muestra|enseña|manda.*foto|averlos|verlos|que.*tiene|hay.*foto|puedo.*ver/i.test(textoCliente) &&
      !(/\b(pague|comprobante|transfer)\b/i.test(textoCliente))
    if (pideFotos && esInteresCompra) {
      const ahoraFotos = FOTOS_NOTIFICADO.get(clienteId) ?? 0
      if (Date.now() - ahoraFotos > 60 * 60_000) {
        FOTOS_NOTIFICADO.set(clienteId, Date.now())
        const telefonoReal = await numeroRealPromise
        enviarAlertaEmpleadoFotos(telefonoReal, 'Cliente pide fotos').catch(() => {})
        console.log(`[bot] 📸 Alerta de fotos enviada para ${telefonoReal}`)
      }
    }

    // ── VENTA CERRADA manual ────────────────────────────────────
    if (/venta\s*cerrada/i.test(textoCliente)) {
      const venta = ventaDesdeEstado(clienteId)
      if (venta) {
        ventaCerradaHandler(clienteId, venta, telefono)
      }
    }

    // ── EXTRAER DATOS DEL PEDIDO ────────────────────────────────
    const notaMatch = textoCliente.match(/nota[:\s]*([\s\S]{1,500})/i)
    if (notaMatch && ARREGLO_ELEGIDO.has(clienteId)) pedidoActual(clienteId).nota = notaMatch[1].trim().slice(0, 500)

    const nombreMatch = textoCliente.match(/(?:a qué nombre|nombre|apartar a nombre de|para quien|para quién|ponerle|se lo aparto a nombre de)[:\s]*([a-záéíóúñ\s]+)/i)
    if (nombreMatch && ARREGLO_ELEGIDO.has(clienteId)) {
      const nombre = nombreMatch[1].trim().replace(/\s+/g, ' ').slice(0, 80)
      if (!/^(ok|si|sí|vale|dale|va|de acuerdo|esta bien|está bien)$/i.test(nombre)) {
        pedidoActual(clienteId).nombre = nombre
      }
    }

    // ── MÉTODO DE PAGO ──────────────────────────────────────────
    const consultaPagoEnviado = /(?:ya\s*)?pag[uú]e|comprobante|transferencia|ya\s*transfer/i.test(textoCliente)

    const esSucursal = /recoger|recojo|paso|pasare|sucursal|ah[ií]|all[aá]|voy/i.test(textoCliente)
    if (esSucursal && ARREGLO_ELEGIDO.has(clienteId) && !consultaPagoEnviado) {
      pedidoActual(clienteId).sucursal = 'Apizaco (sucursal)'
      pedidoActual(clienteId).metodoPago = 'efectivo_recoger'
      contextoExtra +=
        `\n\n[CLIENTE RECOGE EN SUCURSAL] ` +
        `INSTRUCCION: Confirma dirección: Av. Hidalgo 12, Apizaco Centro. ` +
        `Pregunta en qué horario pasará y comparte la cuenta BBVA por si quiere adelantar el pago. ` +
        `El equipo preparará su pedido.`
    }

    // ── CIERRE DE VENTA ─────────────────────────────────────────
    const ventaToken  = textoCliente.match(/\[VENTA_CERRADA:\s*(.+?)\|(.+?)\|(.+?)\|(.+?)\]/i)
    let ventaCerrada = false

    if (ventaToken) {
      const [ , nombre, producto, precio, direccion ] = ventaToken
      const venta: VentaCerrada = {
        cliente: nombre.trim(), producto: producto.trim(),
        total: precio.trim(), direccion: direccion.trim(),
        rawToken: ventaToken[0],
      }
      ventaCerradaHandler(clienteId, venta, telefono)
      ventaCerrada = true
    }

    if (!ventaCerrada && !VENTAS_CERRADAS.has(clienteId) && confirmaCorto && (ARREGLO_ELEGIDO.has(clienteId) || (textoCliente.length < 150 && !textoCliente.includes('?')))) {
      const elegido = ARREGLO_ELEGIDO.get(clienteId)
      if (elegido) {
        const pedido = PEDIDO_EN_CURSO.get(clienteId)
        const total = elegido.precio + (pedido?.envio?.precio ?? 0)
        const totalTexto = pedido?.envio
          ? `$${total.toFixed(2)} MXN (ramo $${elegido.precio.toFixed(2)} + envío $${(pedido?.envio?.precio ?? 0).toFixed(2)})`
          : `$${total.toFixed(2)} MXN`
        ventaCerradaHandler(clienteId, {
          cliente: pedido?.nombre ?? 'Verificar en chat',
          producto: elegido.nombre,
          total: totalTexto,
          direccion: pedido?.envio?.zona ?? 'Por confirmar',
          rawToken: '',
        }, telefono)
      }
    }

    // ── ATENCIÓN HUMANA (notificación de alerta si aplica)
    if (motivoAtencionHumana && debeNotificarAtencionHumana(clienteId)) {
      enviarAlertaAtencionHumana(telefono, textoCliente.substring(0, 300), motivoAtencionHumana).catch(() => {})
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
      const ventaTokenEnResp   = mensajeFinal.match(/\[VENTA_CERRADA:\s*(.+?)\|(.+?)\|(.+?)\|(.+?)\]/i)

      if (ventaTokenEnResp) {
        const [ , nombre, producto, precio, direccion ] = ventaTokenEnResp
        const venta: VentaCerrada = {
          cliente: nombre.trim(), producto: producto.trim(),
          total: precio.trim(), direccion: direccion.trim(),
          rawToken: ventaTokenEnResp[0],
        }

        const msgLimpio = mensajeFinal.replace(ventaTokenEnResp[0], '').trim()
        if (msgLimpio) {
          await responderMensaje(msg, msgLimpio)
          await new Promise(r => setTimeout(r, 1500))
        }
        ventaCerradaHandler(clienteId, venta, telefono)
      } else {
        const elegido = ARREGLO_ELEGIDO.get(clienteId)
        let mensajeParaEnviar = mensajeFinal

        if (!VENTAS_CERRADAS.has(clienteId) && elegido && (
          confirmaCorto || /lo[sv]? quiero|me gusta|adelante|procedo|hagamoslo|hag[aá]moslo|d[aá]le|adelante|apartalo|aparta lo|si? (por favor|gracias)/i.test(textoCliente)
        )) {
          const pedido = PEDIDO_EN_CURSO.get(clienteId)
          const total = elegido.precio + (pedido?.envio?.precio ?? 0)
          const totalTexto = pedido?.envio
            ? `$${total.toFixed(2)} MXN (ramo $${elegido.precio.toFixed(2)} + envío $${(pedido?.envio?.precio ?? 0).toFixed(2)})`
            : `$${total.toFixed(2)} MXN`
          ventaCerradaHandler(clienteId, {
            cliente: pedido?.nombre ?? 'Verificar en chat',
            producto: elegido.nombre,
            total: totalTexto,
            direccion: pedido?.envio?.zona ?? 'Por confirmar',
            rawToken: '',
          }, telefono)
        }

        await responderMensaje(msg, mensajeParaEnviar)
        await agregarAlHistorial(telefono, 'assistant', mensajeParaEnviar)
      }
    }
  } catch (err) {
    console.error('[bot] Error en procesarMensaje:', err)
    try {
      if (msg?.key?.remoteJid) {
        await responderMensaje(msg, '🌷 Perdón, un pequeño mareo digital. ¿Me repites?')
      }
    } catch {}
  }
}

// ════════════════════════════════════════════════════════════════
// VENTA CERRADA
// ════════════════════════════════════════════════════════════════

async function ventaCerradaHandler(clienteId: string, venta: VentaCerrada, telefono: string): Promise<void> {
  if (VENTAS_CERRADAS.has(clienteId)) return
  VENTAS_CERRADAS.add(clienteId)

  const numeroReal = telefono.startsWith('+') ? telefono : `+${telefono}`

  console.log(`[bot] 💰 Venta cerrada: ${venta.cliente} — ${venta.producto} — ${venta.total}`)
  await registrarVenta(venta.cliente, numeroReal, venta.producto, venta.total, venta.direccion)
  await persistirPedido(clienteId, numeroReal, 'pagado')
  resetearPedidoCliente(clienteId)

  const alertaVenta = {
    ...venta,
    numeroCliente: numeroReal,
  }
  enviarAlertaVentaCerrada(alertaVenta).catch(err => console.error('[bot] Telegram venta:', err))
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
  if (remoteJid === 'status@broadcast') return
  if (!msg.key?.fromMe && yaProcesadoRecientemente(msg)) {
    console.log(`[bot] ↩️ Mensaje duplicado ignorado: ${obtenerMensajeId(msg)}`)
    return
  }

  // Ignorar números silenciados
  const ignorados = await cargarIgnorados()
  const numeroParaIgnorar = remoteJid.replace(/@[^\s]*/g, '')
  const variantesMensaje = variantesTelefono(numeroParaIgnorar)
  if (!msg.key?.fromMe && variantesMensaje.some(n => ignorados.includes(n))) {
    console.log(`[bot] 🔇 Número ignorado: ${numeroParaIgnorar}`)
    return
  }

  // Guardar mensajes enviados desde la cuenta (agente humano) al historial
  if (msg.key?.fromMe) {
    const telefonoDestino = remoteJid.replace(/@[^\s]*/g, '').trim()
    if (telefonoDestino && body) {
      const num = telefonoDestino.startsWith('52') ? `+${telefonoDestino}` : telefonoDestino
      agregarAlHistorial(num, 'assistant', `[Agente: ${body.trim()}]`)
    }
    return
  }

  const clienteId = remoteJid

  if (msgType !== 'chat' && TIPOS_MEDIA_NO_SOPORTADOS.has(msgType)) {
    if (msgType === 'image' && (ARREGLO_ELEGIDO.has(clienteId) || PEDIDO_EN_CURSO.has(clienteId))) {
      await responderMensaje(msg, '¡Gracias! He recibido tu comprobante 🌸 Lo estoy registrando y notificando al equipo para que preparen tu pedido.')
      try {
        const stream = await downloadContentFromMessage(msg.message, 'image')
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(chunk)
        const buffer = Buffer.concat(chunks)
        if (buffer.length > 0) {
          const caption = `📸 *Comprobante de pago* — ${clienteId.replace(/@.*$/, '')}`
          enviarFotoTelegram(buffer.toString('base64'), caption, 'image/jpeg').catch(() => {})
        }
      } catch (e) {
        console.warn('[bot] Error descargando media para Telegram:', e)
      }
      const elegido = ARREGLO_ELEGIDO.get(clienteId) ?? PEDIDO_EN_CURSO.get(clienteId)?.arreglo
      if (elegido && !VENTAS_CERRADAS.has(clienteId)) {
        const numeroReal = await obtenerNumeroReal(msg).catch(() => null)
        const pedido = PEDIDO_EN_CURSO.get(clienteId)
        const total = elegido.precio + (pedido?.envio?.precio ?? 0)
        const totalTexto = pedido?.envio
          ? `$${total.toFixed(2)} MXN (ramo $${elegido.precio.toFixed(2)} + envío $${pedido.envio.precio.toFixed(2)})`
          : `$${total.toFixed(2)} MXN`
        enviarAlertaVentaCerrada({
          cliente: pedido?.nombre ?? 'Verificar en chat',
          producto: elegido.nombre,
          total: totalTexto,
          direccion: pedido?.envio?.zona ?? 'Por confirmar',
          numeroCliente: numeroReal ?? 'desconocido',
          precioArreglo: `$${elegido.precio.toFixed(2)} MXN`,
          precioEnvio: pedido?.envio
            ? `$${pedido.envio.precio.toFixed(2)} MXN (${pedido.envio.zona})`
            : undefined,
          metodoPago: 'transferencia',
        }).catch(err => console.error('[bot] Telegram venta img:', err))
        VENTAS_CERRADAS.add(clienteId)
      }
    } else {
      await responderMensaje(msg, 'Por ahora solo puedo leer mensajes de *texto* 🌸. ¿Qué necesitas?')
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

// ════════════════════════════════════════════════════════════════
// INICIALIZACIÓN BAILEYS
// ════════════════════════════════════════════════════════════════

async function iniciarBaileys(): Promise<void> {
  BOT_CONNECTION = 'connecting'
  actualizarEstadoBot(BOT_RECONNECTING ? 'reconectando' : 'iniciando', BOT_RECONNECTING ? 'Reconectando WhatsApp' : 'Arrancando bot')

  const { state, saveCreds } = await useMultiFileAuthState(
    process.env.BAILEYS_DATA_PATH || './.baileys_auth'
  )

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
      enviarAlertaQr()
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
      if (BOT_QR_EMITIDO) enviarAlertaReconectado()
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

// ════════════════════════════════════════════════════════════════
// SERVIDOR WEB (Express)
// ════════════════════════════════════════════════════════════════

import express from 'express'
const app  = express()
const port = process.env.BOT_PORT || 10000

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (_req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})
app.use(express.json())

app.get('/', (_req, res) => res.send('🌸 Jardín RoCe Bot (Baileys) — en línea.'))

app.post('/pause', (_req, res) => {
  BOT_PAUSADO = true
  ultimaVerifPausa = Date.now()
  console.log('[bot] ⏸️ Pausado vía API')
  res.json({ ok: true, pausado: true })
})

app.post('/resume', (_req, res) => {
  BOT_PAUSADO = false
  ultimaVerifPausa = Date.now()
  console.log('[bot] ▶️ Reanudado vía API')
  res.json({ ok: true, pausado: false })
})

app.post('/reconnect', (_req, res) => {
  console.warn('[bot] 🔄 Reinicio manual solicitado vía API')
  res.json({ ok: true, mensaje: 'Reinicio solicitado. El proceso volverá a levantar con systemd.' })
  setTimeout(() => reiniciarProceso('Reinicio manual desde dashboard', false), 500)
})

app.post('/recover', (_req, res) => {
  console.warn('[bot] 🛟 Rescate manual solicitado vía API')
  res.json({ ok: true, mensaje: 'Rescate iniciado. Se reiniciará la conexión para forzar sincronización.' })
  setTimeout(() => reiniciarProceso('Rescate manual desde dashboard', false), 500)
})

app.get('/qr', (_req, res) => {
  const ageMs = BOT_QR_GENERADO_EN ? Date.now() - BOT_QR_GENERADO_EN : null
  res.json({
    qr: BOT_QR_ACTUAL,
    qrGeneradoEn: BOT_QR_GENERADO_EN ? new Date(BOT_QR_GENERADO_EN).toISOString() : null,
    qrAgeSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    qrExpiresInSeconds: ageMs === null ? null : Math.max(0, Math.ceil((BOT_QR_TTL_MS - ageMs) / 1000)),
    qrScanGraceSeconds: ageMs === null ? null : Math.max(0, Math.ceil((QR_SCAN_GRACE_MS - ageMs) / 1000)),
    qrVencido: ageMs === null ? false : ageMs > BOT_QR_TTL_MS,
  })
})

app.get('/status', async (_req, res) => {
  try {
    const ventas = await obtenerVentasHoy().catch(() => ({ total: 0, cantidad: 0 }))
    const clientes = await obtenerClientesAtendidosHoy().catch(() => 0)
    const minutosInactivo = Math.round((Date.now() - ultimaActividad) / 60_000)
    const qrAgeMs = BOT_QR_GENERADO_EN ? Date.now() - BOT_QR_GENERADO_EN : null
    res.json({
      pausado: BOT_PAUSADO,
      connected: BOT_READY && !!sock?.user,
      estado: BOT_ESTADO,
      estadoDetalle: BOT_ESTADO_DETALLE,
      reconnecting: BOT_RECONNECTING,
      qr: BOT_QR_ACTUAL,
      qrGeneradoEn: BOT_QR_GENERADO_EN ? new Date(BOT_QR_GENERADO_EN).toISOString() : null,
      qrAgeSeconds: qrAgeMs === null ? null : Math.round(qrAgeMs / 1000),
      qrExpiresInSeconds: qrAgeMs === null ? null : Math.max(0, Math.ceil((BOT_QR_TTL_MS - qrAgeMs) / 1000)),
      qrScanGraceSeconds: qrAgeMs === null ? null : Math.max(0, Math.ceil((QR_SCAN_GRACE_MS - qrAgeMs) / 1000)),
      qrVencido: qrAgeMs === null ? false : qrAgeMs > BOT_QR_TTL_MS,
      ultimaActividad: `${minutosInactivo} min`,
      ventasHoy: ventas.cantidad,
      totalVentasHoy: ventas.total,
      clientesAtendidosHoy: clientes,
      libreria: 'baileys',
      baileysVersion: BAILEYS_VERSION,
      version: '3.0.0',
      uptime: Math.round(process.uptime() / 60) + ' min',
    })
  } catch {
    res.json({
      pausado: BOT_PAUSADO,
      connected: BOT_READY && !!sock?.user,
      estado: BOT_ESTADO,
      estadoDetalle: BOT_ESTADO_DETALLE,
    })
  }
})

app.listen(port, () => console.log(`🌐 Servidor web en puerto ${port}`))
console.log(`⚠️ Bot escuchando en :${port}. Next.js debe usar otro puerto (default 3000).`)
