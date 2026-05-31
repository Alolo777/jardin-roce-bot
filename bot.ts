// bot.ts — Jardín RoCe 🌸
// Ejecutar con: npx tsx bot.ts

import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

import { getAIResponse } from './lib/ai'
import {
  enviarAlertaVentaCerrada,
  enviarAlertaPedidoWeb,
  enviarAlertaCotizacion,
  enviarAlertaClienteFrustrado,
} from './lib/telegram'
import { supabaseAdmin } from './lib/supabase'
import type { MensajeChat } from './lib/ai'

// ════════════════════════════════════════════════════════════════
// HISTORIAL DE CONVERSACIONES
// ════════════════════════════════════════════════════════════════

const HISTORIAL_POR_CLIENTE = new Map<string, MensajeChat[]>()
const MAX_TURNOS_HISTORIAL  = 10

function obtenerHistorial(id: string): MensajeChat[] {
  if (!HISTORIAL_POR_CLIENTE.has(id)) HISTORIAL_POR_CLIENTE.set(id, [])
  return HISTORIAL_POR_CLIENTE.get(id)!
}

function agregarAlHistorial(id: string, role: 'user' | 'assistant', content: string): void {
  const h = obtenerHistorial(id)
  h.push({ role, content })
  if (h.length > MAX_TURNOS_HISTORIAL * 2) h.splice(0, 2)
}

// ════════════════════════════════════════════════════════════════
// CONTROL DE FOTOS ENVIADAS (una vez por día)
// ════════════════════════════════════════════════════════════════

const FOTOS_YA_ENVIADAS = new Set<string>()

function yaSeEnviaronFotos(id: string): boolean { return FOTOS_YA_ENVIADAS.has(id) }

function marcarFotosEnviadas(id: string): void {
  FOTOS_YA_ENVIADAS.add(id)
  const manana = new Date()
  manana.setDate(manana.getDate() + 1)
  manana.setHours(0, 0, 0, 0)
  setTimeout(() => FOTOS_YA_ENVIADAS.delete(id), manana.getTime() - Date.now())
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE FRUSTRACIÓN
// ════════════════════════════════════════════════════════════════

const KW_FRUSTRACION = [
  'que show', 'qué show', 'no me ayudas', 'no sirves', 'pesimo', 'pésimo',
  'mal servicio', 'molesta', 'molesto', 'enojada', 'enojado', 'horrible',
  'no entiendes', 'no me entiendes', 'quiero hablar con una persona',
  'quiero hablar con alguien', 'con un humano', 'eres un bot inutil',
  'no funciona', 'nunca me contestas', 'llevo esperando', 'tardas mucho',
  'cuando me van a contestar', 'necesito ayuda urgente',
]

// Llevar cuenta de cuántas veces se notificó frustración por cliente
const FRUSTRACION_NOTIFICADA = new Map<string, number>()

function detectarFrustracion(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_FRUSTRACION.some(k => n.includes(k))
}

async function manejarFrustracion(clienteId: string, numeroReal: string, texto: string): Promise<void> {
  const veces = (FRUSTRACION_NOTIFICADA.get(clienteId) ?? 0) + 1
  FRUSTRACION_NOTIFICADA.set(clienteId, veces)
  // Solo notificar las primeras 2 veces por sesión para no spamear
  if (veces <= 2) {
    enviarAlertaClienteFrustrado(numeroReal, texto)
      .catch(err => console.error('[bot] Telegram frustración:', err))
  }
}

// ════════════════════════════════════════════════════════════════
// PAUSA DEL BOT (modo humano)
// ════════════════════════════════════════════════════════════════

let BOT_PAUSADO       = false
let ultimaVerifPausa  = 0
const PAUSA_CACHE_MS  = 30_000 // verificar cada 30 segundos

async function verificarSiBotPausado(): Promise<boolean> {
  if (Date.now() - ultimaVerifPausa < PAUSA_CACHE_MS) return BOT_PAUSADO
  try {
    const { data } = await supabaseAdmin
      .from('configuracion_agente')
      .select('bot_pausado')
      .eq('id', 1)
      .single()
    BOT_PAUSADO      = data?.bot_pausado ?? false
    ultimaVerifPausa = Date.now()
  } catch (err) {
    console.error('[bot] Error verificando pausa:', err)
  }
  return BOT_PAUSADO
}

// ════════════════════════════════════════════════════════════════
// WATCHDOG — detectar desconexión silenciosa
// ════════════════════════════════════════════════════════════════

let ultimaActividad = Date.now()
const WATCHDOG_TIMEOUT_MS = 90 * 60_000 // 90 min sin mensajes → verificar

function registrarActividad(): void { ultimaActividad = Date.now() }

setInterval(async () => {
  const min = Math.round((Date.now() - ultimaActividad) / 60_000)
  if (min > 30) console.warn(`[Watchdog] ${min} min sin mensajes`)

  if (Date.now() - ultimaActividad > WATCHDOG_TIMEOUT_MS) {
    console.warn('[Watchdog] ⚠️ Posible desconexión silenciosa. Verificando...')
    try {
      const state = await whatsappClient.getState()
      console.log(`[Watchdog] Estado: ${state}`)
      if (state !== 'CONNECTED') {
        console.warn('[Watchdog] 🔄 Reiniciando cliente...')
        await whatsappClient.destroy().catch(console.error)
        await new Promise(r => setTimeout(r, 3000))
        await whatsappClient.initialize().catch(console.error)
        ultimaActividad = Date.now()
      }
    } catch (err) {
      console.error('[Watchdog] Error:', err)
    }
  }
}, 15 * 60_000) // cada 15 minutos

// ════════════════════════════════════════════════════════════════
// MONITOR DE MEMORIA
// ════════════════════════════════════════════════════════════════

setInterval(() => {
  const rss  = Math.round(process.memoryUsage().rss      / 1024 / 1024)
  const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  console.log(`[RAM] RSS: ${rss}MB | Heap: ${heap}MB`)
  if (rss > 400) {
    console.warn('[RAM] ⚠️ Memoria alta — limpiando historiales...')
    const clientes = Array.from(HISTORIAL_POR_CLIENTE.keys())
    const n = Math.floor(clientes.length * 0.3)
    for (let i = 0; i < n; i++) HISTORIAL_POR_CLIENTE.delete(clientes[i])
    FOTOS_YA_ENVIADAS.clear()
    FRUSTRACION_NOTIFICADA.clear()
    console.log(`[RAM] 🧹 Limpié ${n} historiales`)
  }
}, 5 * 60_000)

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
  RATE_TIMESTAMPS.set(id, recientes)
  return recientes.length > RATE_LIMIT_MAX
}

function avisarRateLimitUnaVez(message: any, id: string): void {
  if (RATE_AVISADOS.has(id)) return
  RATE_AVISADOS.add(id)
  message.reply('Voy un poquito rápido 🌸 Dame un momento y te respondo todo. ¿Va?').catch(() => {})
  setTimeout(() => RATE_AVISADOS.delete(id), RATE_LIMIT_WINDOW_MS)
}

// ── Cola por cliente ──────────────────────────────────────────────
const COLA_POR_CLIENTE = new Map<string, Promise<void>>()

function encolarPorCliente(id: string, tarea: () => Promise<void>): void {
  const previa    = COLA_POR_CLIENTE.get(id) ?? Promise.resolve()
  const siguiente = previa.catch(() => {}).then(tarea).catch(e => console.error(`[bot] Cola ${id}:`, e))
  COLA_POR_CLIENTE.set(id, siguiente)
  siguiente.finally(() => { if (COLA_POR_CLIENTE.get(id) === siguiente) COLA_POR_CLIENTE.delete(id) })
}

// ════════════════════════════════════════════════════════════════
// NÚMERO REAL DEL CONTACTO
// ════════════════════════════════════════════════════════════════

async function obtenerNumeroReal(message: any): Promise<string> {
  try {
    const contact = await message.getContact()
    if (contact?.number) {
      const num = contact.number
      return num.startsWith('52') ? `+${num}` : num
    }
  } catch { /* fallback */ }
  // Si falla getContact, limpiar manualmente el @lid/@c.us
  const raw = (message.from as string).replace(/@[^\s]*/g, '').trim()
  return raw.startsWith('52') ? `+${raw}` : raw
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DEL PEDIDO DEL COTIZADOR WEB
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

  const lineas = texto.split('\n')
  const flores = lineas
    .filter(l => l.trim().startsWith('•') && !l.includes('🧸') && !l.includes('🎀') && !l.toLowerCase().includes('peluche'))
    .slice(0, 8).map(l => l.trim().replace(/^[•\*]\s*/, '')).join(', ')

  const accesorios = lineas
    .filter(l => l.trim().startsWith('•') && (l.includes('🧸') || l.includes('🎀') || l.toLowerCase().includes('peluche')))
    .map(l => l.trim().replace(/^[•\*]\s*/, '')).join(', ')

  let entrega = 'Por confirmar'
  if (texto.includes('Envío a domicilio') || texto.includes('Envio a domicilio')) {
    const z = texto.match(/Zona:\s*([^\n]+)/i)
    entrega = z ? `Envío — ${z[1].trim()}` : 'Envío a domicilio'
  } else if (texto.includes('Recolección en tienda') || texto.includes('Sucursal')) {
    const s = texto.match(/Sucursal\s+([^\n]+)/i)
    entrega = s ? `Recoger — Sucursal ${s[1].trim()}` : 'Recoger en sucursal'
  }

  return {
    total:      matchTotal  ? `$${matchTotal[1]} MXN`           : 'Por confirmar',
    tamano:     matchTamano ? matchTamano[1].trim().replace(/\*/g, '') : 'Por definir',
    envoltura:  matchEnvolt ? matchEnvolt[1].trim().replace(/\*/g, '') : 'Incluida',
    imagenUrl:  matchImg    ? matchImg[1]                        : '',
    nota:       matchNota   ? matchNota[1].trim().replace(/\*/g, '') : '',
    flores:     flores      || 'Ver imagen de referencia',
    accesorios,
    entrega,
  }
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE INTENCIÓN
// ════════════════════════════════════════════════════════════════

const KW_INVENTARIO = [
  'disponible', 'disponibles', 'armado', 'armados',
  'tienes hoy', 'hay hoy', 'entrega inmediata', 'para hoy',
  'que tienes', 'que tienen', 'tienen algo', 'hay algo',
  'ramitos', 'que ramitos', 'que ramos', 'ramos de hoy',
  'tienen hoy', 'hoy tienen', 'muestrame', 'muéstrame',
  'fotos', 'foto', 'ver ramos', 'ver arreglos',
  'enviame fotos', 'envíame fotos', 'manda fotos', 'mandame fotos',
]

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

function detectarIntencion(texto: string): 'inventario' | 'catalogo' | 'cotizador' | 'normal' {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (KW_INVENTARIO.some(k => n.includes(k))) return 'inventario'
  if (KW_CATALOGO.some(k => n.includes(k)))   return 'catalogo'
  if (KW_COTIZADOR.some(k => n.includes(k)))  return 'cotizador'
  return 'normal'
}

// ════════════════════════════════════════════════════════════════
// ARREGLOS DEL DÍA
// ════════════════════════════════════════════════════════════════

interface ArregloConFoto {
  id: string; nombre: string; precio: number
  descripcion: string | null; foto_url: string
}

async function obtenerArreglosConFotos(): Promise<ArregloConFoto[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('arreglos_diarios')
      .select('id, nombre, precio, descripcion, foto_url')
      .eq('estado', 'disponible')
      .order('creado_en', { ascending: false })
    if (error) throw error
    return data ?? []
  } catch (err) {
    console.error('[bot] Error obteniendo arreglos:', err)
    return []
  }
}

async function apartarArreglo(nombreProducto: string): Promise<void> {
  try {
    const { data: arreglos } = await supabaseAdmin
      .from('arreglos_diarios').select('id, nombre').eq('estado', 'disponible')
    if (!arreglos?.length) return

    const norm     = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const normProd = norm(nombreProducto)
    const match    = arreglos.find(a => { const n = norm(a.nombre); return normProd.includes(n) || n.includes(normProd) })

    if (match) {
      await supabaseAdmin.from('arreglos_diarios').update({ estado: 'apartado' }).eq('id', match.id)
      console.log(`[bot] 📦 "${match.nombre}" → apartado`)
    }
  } catch (err) {
    console.error('[bot] Error apartando arreglo:', err)
  }
}

// Descargar en paralelo, enviar secuencial con delay mínimo
async function enviarFotosArreglos(client: Client, chatId: string, arreglos: ArregloConFoto[]): Promise<void> {
  if (!arreglos.length) return

  // Descargar todos en paralelo
  const resultados = await Promise.all(
    arreglos.map(a =>
      MessageMedia.fromUrl(a.foto_url, { unsafeMime: true })
        .then(media => ({ ok: true as const, media, arreglo: a }))
        .catch(err  => { console.error(`[bot] Error descargando "${a.nombre}":`, err); return { ok: false as const, arreglo: a } })
    )
  )

  // Enviar secuencialmente (WhatsApp no soporta parallel send bien)
  for (const r of resultados) {
    if (!r.ok) continue
    try {
      const caption =
        `💐 *${r.arreglo.nombre}*\n💰 $${r.arreglo.precio.toFixed(2)} MXN` +
        (r.arreglo.descripcion ? `\n📝 ${r.arreglo.descripcion}` : '')
      await client.sendMessage(chatId, r.media, { caption })
      await new Promise(res => setTimeout(res, 800)) // delay mínimo entre fotos
    } catch (err) {
      console.error(`[bot] Error enviando "${r.arreglo.nombre}":`, err)
    }
  }
}

// ════════════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════════════

function limpiarRespuestaIA(texto: string): string {
  return texto
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/https:\/\/[^\s]+supabase\.co\/storage\/[^\s]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function calcularDelayEscritura(texto: string): number {
  const base = Math.min(Math.max((texto.length / 200) * 4000, 1000), 4000)
  return base + (Math.random() * 500 - 250)
}

async function simularEscritura(chat: any, ms: number): Promise<void> {
  try {
    await chat.sendStateTyping()
    await new Promise(r => setTimeout(r, ms))
    await chat.clearState()
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

async function procesarPedidoWeb(message: any): Promise<void> {
  const clienteId  = message.from as string
  const texto      = message.body as string
  const chat       = await message.getChat()
  const pedido     = parsearPedidoCotizador(texto)
  const numeroReal = await obtenerNumeroReal(message)

  console.log(`[bot] 🛒 Pedido cotizador web de ${numeroReal}`)

  await simularEscritura(chat, 2000)
  await message.reply(
    `¡Qué bonita elección! 🌸 Ya recibimos tu pedido.\n\n` +
    `💐 ${pedido.flores.slice(0, 60)}${pedido.flores.length > 60 ? '...' : ''}\n` +
    `💰 Total: *${pedido.total}*\n` +
    `📍 ${pedido.entrega}\n\n` +
    `Para confirmar tu pago:\n` +
    `BBVA | 4152314097305273 | Devi América Cerenil\n` +
    `_(Concepto: tu nombre o usuario de WhatsApp)_\n\n` +
    `Mándame tu comprobante y listo. ¡Con mucho gusto! 🌹`
  )

  enviarAlertaPedidoWeb({
    numeroCliente: numeroReal,
    total:         pedido.total,
    entrega:       pedido.entrega,
    flores:        pedido.flores,
    accesorios:    pedido.accesorios  || undefined,
    tamano:        pedido.tamano,
    envoltura:     pedido.envoltura,
    nota:          pedido.nota        || undefined,
    imagenUrl:     pedido.imagenUrl   || undefined,
  }).catch(err => console.error('[bot] Telegram pedido web:', err))
}

// ════════════════════════════════════════════════════════════════
// FLUJO PRINCIPAL
// ════════════════════════════════════════════════════════════════

async function procesarMensaje(message: any): Promise<void> {
  const clienteId    = message.from as string
  let   textoCliente = (message.body as string).trim()

  if (textoCliente.length > MAX_LONGITUD_MENSAJE) {
    textoCliente = textoCliente.slice(0, MAX_LONGITUD_MENSAJE)
  }

  console.log(`[${new Date().toLocaleTimeString('es-MX')}] 📨 ${clienteId}: ${textoCliente.substring(0, 80)}`)

  // Obtener número real una sola vez (usado en alertas)
  const numeroReal = await obtenerNumeroReal(message)

  // Detectar frustración y notificar
  if (detectarFrustracion(textoCliente)) {
    console.warn(`[bot] ⚠️ Frustración detectada de ${numeroReal}`)
    manejarFrustracion(clienteId, numeroReal, textoCliente)
  }

  try {
    const chat = await message.getChat()
    await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

    agregarAlHistorial(clienteId, 'user', textoCliente)

    const intencion        = detectarIntencion(textoCliente)
    let   contextoExtra    = `[Fecha actual: ${getFechaActual()}]`
    let   arreglosParaEnviar: ArregloConFoto[] = []
    let   enviarFotos      = false

    // ── INVENTARIO ────────────────────────────────────────────────
    if (intencion === 'inventario') {
      const arreglos = await obtenerArreglosConFotos()
      if (arreglos.length > 0) {
        const resumen = arreglos.map((a, i) => `Foto ${i + 1}: "${a.nombre}" — $${a.precio} MXN`).join('\n')
        if (!yaSeEnviaronFotos(clienteId)) {
          contextoExtra +=
            `\n\nINVENTARIO HOY:\n${resumen}\n\n` +
            `INSTRUCCION CRITICA: Las fotos se envían automáticamente después de tu mensaje. ` +
            `NUNCA digas que no puedes enviarlas. Responde máximo 1 línea cálida confirmando que ya van.`
          arreglosParaEnviar = arreglos
          enviarFotos        = true
        } else {
          contextoExtra +=
            `\n\nINVENTARIO HOY (fotos ya enviadas):\n${resumen}\n\n` +
            `INSTRUCCION: Menciona nombre y precio en máximo 2 líneas. NUNCA digas que no puedes enviar fotos.`
        }
      } else {
        contextoExtra += `\n\nHoy NO hay arreglos listos. Ofrece pedido personalizado 24-48h. Máximo 2 líneas.`
      }
    }

    // ── CATÁLOGO ──────────────────────────────────────────────────
    else if (intencion === 'catalogo') {
      contextoExtra +=
        `\n\nINSTRUCCION: Envía DIRECTAMENTE este link: ` +
        `https://drive.google.com/drive/folders/1s7Hs5JKBSezcqVznKwl6TT866UqRCB4N Máximo 2 líneas.`
    }

    // ── COTIZADOR ─────────────────────────────────────────────────
    else if (intencion === 'cotizador') {
      contextoExtra +=
        `\n\nINSTRUCCION: Envía DIRECTAMENTE: https://floreria-app-mauve.vercel.app/ ` +
        `Menciona que puede armar su ramo y subir foto. Si quiere algo especial puede pedirlo aquí. Máximo 3 líneas.`

      enviarAlertaCotizacion(numeroReal, textoCliente)
        .catch(err => console.error('[bot] Telegram cotizacion:', err))
    }

    // ── IA ────────────────────────────────────────────────────────
    await chat.sendStateTyping()
    const { mensaje, ventaCerrada } = await getAIResponse(obtenerHistorial(clienteId), contextoExtra)
    await chat.clearState()

    agregarAlHistorial(clienteId, 'assistant', mensaje)

    // ── VENTA CERRADA ─────────────────────────────────────────────
    if (ventaCerrada) {
      console.log(`[bot] 🎉 VENTA CERRADA: ${ventaCerrada.cliente} | ${numeroReal}`)

      enviarAlertaVentaCerrada({
        cliente:       ventaCerrada.cliente,
        producto:      ventaCerrada.producto,
        total:         ventaCerrada.total,
        direccion:     ventaCerrada.direccion,
        numeroCliente: numeroReal,
      }).catch(err => console.error('[bot] Telegram venta:', err))

      apartarArreglo(ventaCerrada.producto)
        .catch(err => console.error('[bot] Error apartando:', err))
    }

    // ── RESPONDER ─────────────────────────────────────────────────
    const mensajeFinal = limpiarRespuestaIA(mensaje)
    await simularEscritura(chat, calcularDelayEscritura(mensajeFinal))
    await message.reply(mensajeFinal)

    // ── FOTOS (primera vez del día) ───────────────────────────────
    if (enviarFotos && arreglosParaEnviar.length > 0) {
      await new Promise(r => setTimeout(r, 800))
      await enviarFotosArreglos(whatsappClient, clienteId, arreglosParaEnviar)
      marcarFotosEnviadas(clienteId)

      const resumenFotos = arreglosParaEnviar.map((a, i) => `Foto ${i + 1}: ${a.nombre} ($${a.precio} MXN)`).join(', ')
      agregarAlHistorial(clienteId, 'assistant', `[Sistema] Fotos enviadas: ${resumenFotos}`)

      await new Promise(r => setTimeout(r, 1000))
      await simularEscritura(chat, 1200)
      await whatsappClient.sendMessage(clienteId, '¿Alguno te llamó la atención? 🌸\nSolo dime cuál y lo aparto para ti. 🌹')
    }

    console.log(`[${new Date().toLocaleTimeString('es-MX')}] ✅ Listo para ${clienteId}`)

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const esContextoDestruido =
      errMsg.includes('Execution context was destroyed') ||
      errMsg.includes('Protocol error') ||
      errMsg.includes('Target closed') ||
      errMsg.includes('Session closed')

    if (esContextoDestruido) {
      console.warn('[bot] ⚠️ Contexto destruido. El cliente puede reenviar su mensaje.')
      return
    }

    console.error(`[bot] Error con ${clienteId}:`, error)
    try {
      const chat = await message.getChat()
      await chat.clearState()
      await message.reply('Disculpa, tuve un pequeño mareo digital 🌸. ¿Me lo puedes repetir?')
    } catch { /* ignorar */ }
  }
}

// ════════════════════════════════════════════════════════════════
// CLIENTE DE WHATSAPP
// ════════════════════════════════════════════════════════════════

const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'jardin-roce-bot',
    dataPath: process.env.WWEBJS_DATA_PATH || '/app/.wwebjs_auth',
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    timeout: 60000,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-gpu-sandbox', '--use-gl=swiftshader',
      '--disable-software-rasterizer', '--disable-extensions', '--disable-plugins',
      '--disable-default-apps', '--disable-sync', '--disable-background-networking',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-ipc-flooding-protection',
      '--disable-notifications', '--disable-speech-api', '--disable-print-preview',
      '--mute-audio', '--hide-scrollbars', '--disable-client-side-phishing-detection',
      '--disable-hang-monitor', '--disable-prompt-on-repost', '--disable-breakpad',
      '--no-first-run', '--no-default-browser-check', '--no-pings',
      '--password-store=basic', '--use-mock-keychain', '--metrics-recording-only',
      '--js-flags=--max-old-space-size=256',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,AudioServiceOutOfProcess',
    ],
  },
})

whatsappClient.on('qr', async (qr) => {
  console.log('\n📱 Nuevo QR. Subiendo a Supabase...')
  try {
    const { error } = await supabaseAdmin.from('configuracion_agente').update({ qr_code: qr }).eq('id', 1)
    if (error) throw error
    console.log('✅ QR guardado.')
  } catch (err) { console.error('❌ Error QR:', err) }
})

whatsappClient.on('ready', async () => {
  console.log('\n✅ Bot de Jardín RoCe conectado!')
  console.log('🌸 Flora está escuchando...\n')
  ultimaActividad = Date.now()

  try {
    const { error } = await supabaseAdmin.from('configuracion_agente').update({ qr_code: null }).eq('id', 1)
    if (error) throw error
  } catch (err) { console.error('[bot] Error limpiando QR:', err) }

  try {
    const page = whatsappClient.pupPage
    if (page) {
      page.on('framenavigated', async (frame: any) => {
        if (frame === page.mainFrame()) {
          console.warn('[bot] 🔄 WhatsApp Web se recargó. Esperando...')
          await new Promise(r => setTimeout(r, 5000))
          console.log('[bot] ✅ Página estabilizada.')
          ultimaActividad = Date.now()
        }
      })
    }
  } catch (err) { console.warn('[bot] No se pudo registrar framenavigated:', err) }
})

whatsappClient.on('auth_failure', (msg) => { console.error('❌ Auth:', msg); process.exit(1) })

whatsappClient.on('disconnected', (reason) => {
  console.warn('⚠️ Desconectado:', reason)
  setTimeout(() => { console.log('🔄 Reconectando...'); whatsappClient.initialize().catch(console.error) }, 5000)
})

// ── UN SOLO manejador ──────────────────────────────────────────────
function manejarMensajeEntrante(message: any): void {
  registrarActividad()
  console.log(`[DIAG] from: ${message.from} | type: ${message.type} | fromMe: ${message.fromMe}`)

  if (message.fromMe)     return
  if (message.isGroupMsg) return
  if (!message.from || message.from === 'status@broadcast') return
  if (message.from.includes('@lid') && !message.body?.trim()) return

  const clienteId = message.from as string

  if (message.type && message.type !== 'chat') {
    if (TIPOS_MEDIA_NO_SOPORTADOS.has(message.type)) {
      message.reply('Por ahora solo puedo leer mensajes de *texto* 🌸. Escríbeme qué necesitas. 🌹').catch(() => {})
    }
    return
  }

  if (!message.body?.trim()) return

  if (estaRateLimited(clienteId)) { avisarRateLimitUnaVez(message, clienteId); return }

  // Verificar pausa (async, encolar igualmente)
  verificarSiBotPausado().then(pausado => {
    if (pausado) {
      console.log(`[bot] ⏸️ Bot pausado — mensaje de ${clienteId} ignorado`)
      return
    }
    if (esPedidoCotizador(message.body)) {
      encolarPorCliente(clienteId, () => procesarPedidoWeb(message))
    } else {
      encolarPorCliente(clienteId, () => procesarMensaje(message))
    }
  }).catch(err => {
    console.error('[bot] Error verificando pausa:', err)
    encolarPorCliente(clienteId, () => procesarMensaje(message))
  })
}

whatsappClient.on('message_create', manejarMensajeEntrante)

// ════════════════════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════════════════════

console.log('🌸 Iniciando bot de Jardín RoCe...')
whatsappClient.initialize().catch((err) => { console.error('❌ Error al inicializar:', err); process.exit(1) })

process.on('SIGINT', async () => {
  console.log('\n⚠️ Cerrando...')
  await whatsappClient.destroy().catch(console.error)
  process.exit(0)
})
process.on('uncaughtException',  (err) => console.error('❌ Excepción:', err))
process.on('unhandledRejection', (r)   => console.error('❌ Rechazo:', r))

// ════════════════════════════════════════════════════════════════
// SERVIDOR WEB (anti-sleep Render)
// ════════════════════════════════════════════════════════════════

import express from 'express'
const app  = express()
const port = process.env.PORT || 3000
app.get('/', (_req, res) => res.send('🌸 Jardín RoCe Bot — en línea.'))
app.listen(port, () => console.log(`🌐 Servidor web en puerto ${port}`))