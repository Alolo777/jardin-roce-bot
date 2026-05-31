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
} from './lib/telegram'
import { supabaseAdmin } from './lib/supabase'
import type { MensajeChat } from './lib/ai'

// ════════════════════════════════════════════════════════════════
// HISTORIAL DE CONVERSACIONES (últimos 10 turnos por cliente)
// ════════════════════════════════════════════════════════════════

const HISTORIAL_POR_CLIENTE = new Map<string, MensajeChat[]>()
const MAX_TURNOS_HISTORIAL  = 10

function obtenerHistorial(clienteId: string): MensajeChat[] {
  if (!HISTORIAL_POR_CLIENTE.has(clienteId)) {
    HISTORIAL_POR_CLIENTE.set(clienteId, [])
  }
  return HISTORIAL_POR_CLIENTE.get(clienteId)!
}

function agregarAlHistorial(clienteId: string, role: 'user' | 'assistant', content: string): void {
  const h = obtenerHistorial(clienteId)
  h.push({ role, content })
  if (h.length > MAX_TURNOS_HISTORIAL * 2) h.splice(0, 2)
}

// ════════════════════════════════════════════════════════════════
// CONTROL DE FOTOS ENVIADAS (una vez por día por cliente)
// ════════════════════════════════════════════════════════════════

const FOTOS_YA_ENVIADAS = new Set<string>()

function yaSeEnviaronFotos(id: string): boolean { return FOTOS_YA_ENVIADAS.has(id) }

function marcarFotosEnviadas(id: string): void {
  FOTOS_YA_ENVIADAS.add(id)
  const ahora  = new Date()
  const manana = new Date(ahora)
  manana.setDate(manana.getDate() + 1)
  manana.setHours(0, 0, 0, 0)
  setTimeout(() => FOTOS_YA_ENVIADAS.delete(id), manana.getTime() - ahora.getTime())
}

// ════════════════════════════════════════════════════════════════
// MONITOR DE MEMORIA (cada 5 min)
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
    console.log(`[RAM] 🧹 Limpié ${n} historiales`)
  }
}, 5 * 60 * 1000)

// ════════════════════════════════════════════════════════════════
// LÍMITES Y PROTECCIONES
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

// ── Cola por cliente — procesa mensajes en orden, uno a la vez ──
const COLA_POR_CLIENTE = new Map<string, Promise<void>>()

function encolarPorCliente(id: string, tarea: () => Promise<void>): void {
  const previa    = COLA_POR_CLIENTE.get(id) ?? Promise.resolve()
  const siguiente = previa.catch(() => {}).then(tarea).catch(e => console.error(`[bot] Cola ${id}:`, e))
  COLA_POR_CLIENTE.set(id, siguiente)
  siguiente.finally(() => { if (COLA_POR_CLIENTE.get(id) === siguiente) COLA_POR_CLIENTE.delete(id) })
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
  total:       string
  entrega:     string
  flores:      string
  accesorios:  string
  tamano:      string
  envoltura:   string
  nota:        string
  imagenUrl:   string
}

function parsearPedidoCotizador(texto: string): PedidoWebParseado {
  // Total
  const matchTotal = texto.match(/TOTAL A COBRAR[:\s*]*\$?([\d,\.]+)\s*MXN/i)
  const total      = matchTotal ? `$${matchTotal[1]} MXN` : 'Por confirmar'

  // Tamaño
  const matchTamano = texto.match(/Tamaño[:\s*]*([^\n]+)/i)
  const tamano      = matchTamano ? matchTamano[1].trim().replace(/\*/g, '') : 'Por definir'

  // Envoltura
  const matchEnvolt = texto.match(/Envoltura[:\s*]*([^\n]+)/i)
  const envoltura   = matchEnvolt ? matchEnvolt[1].trim().replace(/\*/g, '') : 'Incluida'

  // URL de imagen
  const matchImg = texto.match(/(https?:\/\/[^\s]+(?:supabase|storage)[^\s]*)/i)
  const imagenUrl = matchImg ? matchImg[1] : ''

  // Flores (líneas que empiezan con •, sin accesorios)
  const lineasFlores = texto
    .split('\n')
    .filter(l => l.trim().startsWith('•') &&
      !l.includes('🧸') && !l.includes('🎀') &&
      !l.toLowerCase().includes('peluche') &&
      !l.toLowerCase().includes('accesorio'))
    .slice(0, 8)
    .map(l => l.trim().replace(/^•\s*/, ''))
    .join(', ')

  // Accesorios
  const lineasAccesorios = texto
    .split('\n')
    .filter(l => l.trim().startsWith('•') && (l.includes('🧸') || l.includes('🎀') || l.toLowerCase().includes('peluche')))
    .map(l => l.trim().replace(/^•\s*/, ''))
    .join(', ')

  // Nota
  const matchNota = texto.match(/Nota[:\s*]*([^\n]+)/i)
  const nota      = matchNota ? matchNota[1].trim().replace(/\*/g, '') : ''

  // Entrega
  let entrega = 'Por confirmar'
  if (texto.includes('Envío a domicilio') || texto.includes('Envio a domicilio')) {
    const matchZona = texto.match(/Zona:\s*([^\n]+)/i)
    entrega = matchZona ? `Envío — ${matchZona[1].trim()}` : 'Envío a domicilio'
  } else if (texto.includes('Recolección en tienda') || texto.includes('Sucursal')) {
    const matchSuc = texto.match(/Sucursal\s+([^\n]+)/i)
    entrega = matchSuc ? `Recoger — Sucursal ${matchSuc[1].trim()}` : 'Recoger en sucursal'
  }

  return { total, entrega, flores: lineasFlores || 'Ver imagen', accesorios: lineasAccesorios, tamano, envoltura, nota, imagenUrl }
}

// ════════════════════════════════════════════════════════════════
// DETECCIÓN DE INTENCIÓN
// ════════════════════════════════════════════════════════════════

// INVENTARIO: palabras que indican querer ver los arreglos del día
const KW_INVENTARIO = [
  'disponible', 'disponibles', 'armado', 'armados',
  'tienes hoy', 'hay hoy', 'entrega inmediata', 'para hoy',
  'que tienes', 'que tienen', 'tienen algo', 'hay algo',
  'ramitos', 'que ramitos', 'que ramos', 'ramos de hoy',
  'tienen hoy', 'hoy tienen', 'muestrame', 'muéstrame',
  // "fotos" o "foto" sola = quiere ver arreglos del día
  'fotos', 'foto', 'ver ramos', 'ver arreglos', 'envíame fotos',
  'enviame fotos', 'manda fotos', 'mandame fotos',
]

// CATÁLOGO: quiere ver más opciones en Drive
const KW_CATALOGO = [
  'catalogo', 'catálogo', 'drive', 'ver mas', 'ver más',
  'mas opciones', 'más opciones', 'otros ramos', 'que mas tienen',
  'que más tienen',
]

// COTIZADOR: quiere armar/cotizar un ramo personalizado
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
  id:          string
  nombre:      string
  precio:      number
  descripcion: string | null
  foto_url:    string
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
    console.error('[bot] Error al obtener arreglos:', err)
    return []
  }
}

// Marcar como "apartado" en la BD cuando se cierra una venta
async function apartarArreglo(nombreProducto: string): Promise<void> {
  try {
    const { data: arreglos } = await supabaseAdmin
      .from('arreglos_diarios')
      .select('id, nombre')
      .eq('estado', 'disponible')

    if (!arreglos?.length) return

    const norm    = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const normProd = norm(nombreProducto)

    const match = arreglos.find(a => {
      const n = norm(a.nombre)
      return normProd.includes(n) || n.includes(normProd)
    })

    if (match) {
      await supabaseAdmin
        .from('arreglos_diarios')
        .update({ estado: 'apartado' })
        .eq('id', match.id)
      console.log(`[bot] 📦 Arreglo "${match.nombre}" → apartado en Supabase`)
    }
  } catch (err) {
    console.error('[bot] Error al apartar arreglo:', err)
  }
}

async function enviarFotosArreglos(client: Client, chatId: string, arreglos: ArregloConFoto[]): Promise<void> {
  for (const a of arreglos) {
    try {
      const media   = await MessageMedia.fromUrl(a.foto_url, { unsafeMime: true })
      const caption =
        `💐 *${a.nombre}*\n💰 $${a.precio.toFixed(2)} MXN` +
        (a.descripcion ? `\n📝 ${a.descripcion}` : '')
      await client.sendMessage(chatId, media, { caption })
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000))
    } catch (err) {
      console.error(`[bot] Error foto "${a.nombre}":`, err)
      // Fallback silencioso — no interrumpir el flujo de fotos
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
  // Máximo 4 segundos — más natural, menos espera
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
  const clienteId = message.from as string
  const texto     = message.body as string
  const chat      = await message.getChat()
  const pedido    = parsearPedidoCotizador(texto)

  console.log(`[bot] 🛒 Pedido cotizador web de ${clienteId}`)

  // Respuesta corta y cálida al cliente
  await simularEscritura(chat, 2500)
  await message.reply(
    `¡Qué bonita elección! 🌸 Ya recibimos tu pedido.\n\n` +
    `💐 ${pedido.flores.slice(0, 60)}${pedido.flores.length > 60 ? '...' : ''}\n` +
    `💰 Total: *${pedido.total}*\n` +
    `📍 ${pedido.entrega}\n\n` +
    `Para confirmar, realiza tu pago:\n` +
    `BBVA | 4152314097305273 | Devi América Cerenil\n` +
    `_(Concepto: tu nombre o usuario de WhatsApp)_\n\n` +
    `Mándame tu comprobante y listo. ¡Con mucho gusto! 🌹`
  )

  // Notificar a Telegram con todos los detalles
  enviarAlertaPedidoWeb({
    numeroCliente: clienteId,
    total:         pedido.total,
    entrega:       pedido.entrega,
    flores:        pedido.flores,
    accesorios:    pedido.accesorios || undefined,
    tamano:        pedido.tamano,
    envoltura:     pedido.envoltura,
    nota:          pedido.nota || undefined,
    imagenUrl:     pedido.imagenUrl || undefined,
  }).catch(err => console.error('[bot] Telegram pedido web:', err))
}

// ════════════════════════════════════════════════════════════════
// FLUJO PRINCIPAL: PROCESAMIENTO DE MENSAJES
// ════════════════════════════════════════════════════════════════

async function procesarMensaje(message: any): Promise<void> {
  const clienteId    = message.from as string
  let   textoCliente = (message.body as string).trim()

  if (textoCliente.length > MAX_LONGITUD_MENSAJE) {
    console.warn(`[bot] Truncando mensaje largo de ${clienteId}`)
    textoCliente = textoCliente.slice(0, MAX_LONGITUD_MENSAJE)
  }

  console.log(`[${new Date().toLocaleTimeString('es-MX')}] 📨 ${clienteId}: ${textoCliente.substring(0, 80)}`)

  try {
    const chat = await message.getChat()
    // Pausa natural — simula que "leyó" el mensaje
    await new Promise(r => setTimeout(r, 800 + Math.random() * 700))

    agregarAlHistorial(clienteId, 'user', textoCliente)

    const intencion = detectarIntencion(textoCliente)
    let   contextoExtra      = `[Fecha actual: ${getFechaActual()}]`
    let   arreglosParaEnviar: ArregloConFoto[] = []
    let   enviarFotos        = false

    // ── INVENTARIO DEL DÍA ────────────────────────────────────────
    if (intencion === 'inventario') {
      const arreglos = await obtenerArreglosConFotos()

      if (arreglos.length > 0) {
        const resumen = arreglos.map((a, i) => `Foto ${i + 1}: "${a.nombre}" — $${a.precio} MXN`).join('\n')

        if (!yaSeEnviaronFotos(clienteId)) {
          // Primera vez: mandar fotos
          contextoExtra +=
            `\n\nINVENTARIO HOY:\n${resumen}\n\n` +
            `INSTRUCCION CRITICA: El sistema enviará las fotos automáticamente justo después de tu mensaje. ` +
            `ABSOLUTAMENTE NUNCA digas que no puedes enviar fotos. ` +
            `Tu respuesta: máximo 1 línea, confirma brevemente que hay opciones lindas y que ya manda las fotos.`
          arreglosParaEnviar = arreglos
          enviarFotos        = true
        } else {
          // Ya las vio: solo mencionar por nombre
          contextoExtra +=
            `\n\nINVENTARIO HOY (fotos ya enviadas antes):\n${resumen}\n\n` +
            `INSTRUCCION: El cliente ya vio las fotos. Menciona nombre y precio en máximo 2 líneas. ` +
            `NUNCA digas que no puedes enviar fotos.`
        }
      } else {
        contextoExtra +=
          `\n\nHoy NO hay arreglos listos para entrega inmediata. ` +
          `Ofrece pedido personalizado con 24-48h de anticipación. Máximo 2 líneas.`
      }
    }

    // ── CATÁLOGO ──────────────────────────────────────────────────
    else if (intencion === 'catalogo') {
      contextoExtra +=
        `\n\nINSTRUCCION: Envía DIRECTAMENTE este link sin preámbulos: ` +
        `https://drive.google.com/drive/folders/1s7Hs5JKBSezcqVznKwl6TT866UqRCB4N ` +
        `Máximo 2 líneas.`
    }

    // ── COTIZADOR ─────────────────────────────────────────────────
    else if (intencion === 'cotizador') {
      contextoExtra +=
        `\n\nINSTRUCCION: El cliente quiere cotizar o pide algo especial. ` +
        `Envía DIRECTAMENTE este link: https://floreria-app-mauve.vercel.app/ ` +
        `Menciona que puede armar su ramo, subir foto de referencia y calcular precio. ` +
        `Si necesita algo muy específico puede pedirlo aquí. Máximo 3 líneas.`

      // Notificar a Telegram (fire & forget)
      enviarAlertaCotizacion(clienteId, textoCliente)
        .catch(err => console.error('[bot] Telegram cotizacion:', err))
    }

    // ── LLAMAR A LA IA ────────────────────────────────────────────
    await chat.sendStateTyping()
    const historial = obtenerHistorial(clienteId)
    const { mensaje, ventaCerrada } = await getAIResponse(historial, contextoExtra)
    await chat.clearState()

    agregarAlHistorial(clienteId, 'assistant', mensaje)

    // ── VENTA CERRADA ─────────────────────────────────────────────
    if (ventaCerrada) {
      console.log(`[bot] 🎉 VENTA CERRADA: ${ventaCerrada.cliente}`)

      // Alerta Telegram con número limpio
      enviarAlertaVentaCerrada({
        cliente:       ventaCerrada.cliente,
        producto:      ventaCerrada.producto,
        total:         ventaCerrada.total,
        direccion:     ventaCerrada.direccion,
        numeroCliente: clienteId,
      }).catch(err => console.error('[bot] Telegram venta:', err))

      // Marcar arreglo como apartado en Supabase
      apartarArreglo(ventaCerrada.producto)
        .catch(err => console.error('[bot] Error apartando:', err))
    }

    // ── RESPONDER AL CLIENTE ──────────────────────────────────────
    const mensajeFinal = limpiarRespuestaIA(mensaje)
    await simularEscritura(chat, calcularDelayEscritura(mensajeFinal))
    await message.reply(mensajeFinal)

    // ── ENVIAR FOTOS (solo la primera vez del día) ────────────────
    if (enviarFotos && arreglosParaEnviar.length > 0) {
      await new Promise(r => setTimeout(r, 1200))
      await enviarFotosArreglos(whatsappClient, clienteId, arreglosParaEnviar)
      marcarFotosEnviadas(clienteId)

      // Registrar en historial para que la IA sepa qué se envió
      const resumenFotos = arreglosParaEnviar
        .map((a, i) => `Foto ${i + 1}: ${a.nombre} ($${a.precio} MXN)`)
        .join(', ')
      agregarAlHistorial(clienteId, 'assistant', `[Sistema] Fotos enviadas: ${resumenFotos}`)

      await new Promise(r => setTimeout(r, 1500))
      await simularEscritura(chat, 1500)
      await whatsappClient.sendMessage(
        clienteId,
        '¿Alguno te llamó la atención? 🌸\nSolo dime cuál y lo aparto para ti. 🌹'
      )
    }

    console.log(`[${new Date().toLocaleTimeString('es-MX')}] ✅ Listo para ${clienteId}`)

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)

    // Contexto de Chromium destruido — WhatsApp Web se recargó
    const esContextoDestruido =
      errMsg.includes('Execution context was destroyed') ||
      errMsg.includes('Protocol error') ||
      errMsg.includes('Target closed') ||
      errMsg.includes('Session closed')

    if (esContextoDestruido) {
      console.warn('[bot] ⚠️ Contexto destruido (WhatsApp Web se recargó). El cliente puede reenviar su mensaje.')
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
    headless:       true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    timeout:        60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--use-gl=swiftshader',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--disable-notifications',
      '--disable-speech-api',
      '--disable-print-preview',
      '--mute-audio',
      '--hide-scrollbars',
      '--disable-client-side-phishing-detection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-breakpad',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
      '--metrics-recording-only',
      '--js-flags=--max-old-space-size=256',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,AudioServiceOutOfProcess',
    ],
  },
})

// ── Eventos ───────────────────────────────────────────────────────

whatsappClient.on('qr', async (qr) => {
  console.log('\n📱 Nuevo QR. Subiendo a Supabase...')
  try {
    const { error } = await supabaseAdmin
      .from('configuracion_agente').update({ qr_code: qr }).eq('id', 1)
    if (error) throw error
    console.log('✅ QR guardado en Supabase.')
  } catch (err) {
    console.error('❌ Error al subir QR:', err)
  }
})

whatsappClient.on('ready', async () => {
  console.log('\n✅ Bot de Jardín RoCe conectado!')
  console.log('🌸 Flora está escuchando...\n')

  // Limpiar QR de Supabase
  try {
    const { error } = await supabaseAdmin
      .from('configuracion_agente').update({ qr_code: null }).eq('id', 1)
    if (error) throw error
  } catch (err) {
    console.error('[bot] Error limpiando QR:', err)
  }

  // Detectar recargas de página de WhatsApp Web
  try {
    const page = whatsappClient.pupPage
    if (page) {
      page.on('framenavigated', async (frame: any) => {
        if (frame === page.mainFrame()) {
          console.warn('[bot] 🔄 WhatsApp Web se recargó. Esperando estabilización...')
          await new Promise(r => setTimeout(r, 5000))
          console.log('[bot] ✅ Página estabilizada.')
        }
      })
    }
  } catch (err) {
    console.warn('[bot] No se pudo registrar listener de navegación:', err)
  }
})

whatsappClient.on('auth_failure', (msg) => {
  console.error('❌ Auth error:', msg)
  process.exit(1)
})

whatsappClient.on('disconnected', (reason) => {
  console.warn('⚠️ Desconectado:', reason)
  setTimeout(() => {
    console.log('🔄 Reconectando...')
    whatsappClient.initialize().catch(console.error)
  }, 5000)
})

// ── UN SOLO manejador ─────────────────────────────────────────────
function manejarMensajeEntrante(message: any): void {
  console.log(`[DIAG] from: ${message.from} | type: ${message.type} | fromMe: ${message.fromMe}`)

  if (message.fromMe)    return
  if (message.isGroupMsg) return
  if (!message.from || message.from === 'status@broadcast') return
  // Permitir @lid con body (multi-device), bloquear @lid sin body
  if (message.from.includes('@lid') && !message.body?.trim()) return

  const clienteId = message.from as string

  // Multimedia — solo avisar que no procesamos
  if (message.type && message.type !== 'chat') {
    if (TIPOS_MEDIA_NO_SOPORTADOS.has(message.type)) {
      message
        .reply('Por ahora solo puedo leer mensajes de *texto* 🌸. Escríbeme qué necesitas. 🌹')
        .catch(() => {})
    }
    return
  }

  if (!message.body?.trim()) return

  // Rate limiting
  if (estaRateLimited(clienteId)) {
    avisarRateLimitUnaVez(message, clienteId)
    return
  }

  // Detectar pedido del cotizador web (va a flujo aparte)
  if (esPedidoCotizador(message.body)) {
    encolarPorCliente(clienteId, () => procesarPedidoWeb(message))
    return
  }

  // Flujo normal con la IA
  encolarPorCliente(clienteId, () => procesarMensaje(message))
}

whatsappClient.on('message_create', manejarMensajeEntrante)

// ════════════════════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════════════════════

console.log('🌸 Iniciando bot de Jardín RoCe...')
whatsappClient.initialize().catch((err) => {
  console.error('❌ Error al inicializar:', err)
  process.exit(1)
})

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