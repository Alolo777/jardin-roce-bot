// bot.ts — Jardín RoCe 🌸
// Ejecutar con: npx tsx bot.ts

import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

import { getAIResponse, obtenerInventarioDiario } from './lib/ai'
import { enviarAlertaTelegram } from './lib/telegram'
import { supabaseAdmin } from './lib/supabase'
import type { MensajeChat } from './lib/ai'

// ════════════════════════════════════════════════════════════════
// HISTORIAL DE CONVERSACIONES
// ════════════════════════════════════════════════════════════════

const HISTORIAL_POR_CLIENTE = new Map<string, MensajeChat[]>()
const MAX_TURNOS_HISTORIAL = 10

function obtenerHistorial(clienteId: string): MensajeChat[] {
  if (!HISTORIAL_POR_CLIENTE.has(clienteId)) {
    HISTORIAL_POR_CLIENTE.set(clienteId, [])
  }
  return HISTORIAL_POR_CLIENTE.get(clienteId)!
}

function agregarAlHistorial(
  clienteId: string,
  role: 'user' | 'assistant',
  content: string
): void {
  const historial = obtenerHistorial(clienteId)
  historial.push({ role, content })
  if (historial.length > MAX_TURNOS_HISTORIAL * 2) {
    historial.splice(0, 2)
  }
}

// ════════════════════════════════════════════════════════════════
// CONTROL DE FOTOS YA ENVIADAS POR SESION
// Evita reenviar las mismas fotos en la misma conversacion
// ════════════════════════════════════════════════════════════════

const FOTOS_YA_ENVIADAS = new Set<string>()

// ── Monitor de memoria cada 5 minutos ────────────────────────────────────────
setInterval(() => {
  const mem = process.memoryUsage()
  const rss = Math.round(mem.rss / 1024 / 1024)
  const heap = Math.round(mem.heapUsed / 1024 / 1024)
  console.log(`[RAM] RSS: ${rss}MB | Heap: ${heap}MB`)

  if (rss > 400) {
    console.warn('[RAM] ⚠️ Memoria alta, limpiando historiales...')
    limpiarHistorialesViejos()
  }
}, 5 * 60 * 1000)

function limpiarHistorialesViejos(): void {
  const clientes = Array.from(HISTORIAL_POR_CLIENTE.keys())
  const aClear = Math.floor(clientes.length * 0.3)
  for (let i = 0; i < aClear; i++) {
    HISTORIAL_POR_CLIENTE.delete(clientes[i])
  }
  FOTOS_YA_ENVIADAS.clear()
  console.log(`[RAM] 🧹 Limpié ${aClear} historiales`)
}

function yaSeEnviaronFotos(clienteId: string): boolean {
  return FOTOS_YA_ENVIADAS.has(clienteId)
}

function marcarFotosEnviadas(clienteId: string): void {
  FOTOS_YA_ENVIADAS.add(clienteId)
  // Limpiar a la medianoche para el inventario del dia siguiente
  const ahora = new Date()
  const manana = new Date(ahora)
  manana.setDate(manana.getDate() + 1)
  manana.setHours(0, 0, 0, 0)
  const msHastaManana = manana.getTime() - ahora.getTime()
  setTimeout(() => FOTOS_YA_ENVIADAS.delete(clienteId), msHastaManana)
}

// ════════════════════════════════════════════════════════════════
// DETECCION DE INTENCION — tres categorias separadas
// ════════════════════════════════════════════════════════════════

const KEYWORDS_INVENTARIO = [
  'disponible', 'disponibles', 'armado', 'armados',
  'tienes hoy', 'hay hoy', 'entrega inmediata', 'para hoy',
  'que tienes', 'que tienen', 'tienen algo', 'hay algo',
  'ramitos', 'que ramitos', 'que ramos', 'ramos de hoy',
  'tienen hoy', 'hoy tienen', 'muestrame', 'muestrame',
]

const KEYWORDS_CATALOGO = [
  'catalogo', 'drive', 'ver mas', 'ver mas',
  'mas opciones', 'mas opciones', 'otros ramos',
  'que mas tienen', 'que mas tienen', 'ver fotos',
]

const KEYWORDS_COTIZADOR = [
  'cotizar', 'cotizacion', 'cuanto cuesta', 'cuanto vale',
  'precio de un ramo', 'hacer un ramo', 'ramo personalizado',
  'armar un ramo', 'me hacen uno', 'pedido especial',
  'tienen web', 'tienes web', 'pagina',
]

function detectarIntencion(texto: string): 'inventario' | 'catalogo' | 'cotizador' | 'normal' {
  const norm = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (KEYWORDS_INVENTARIO.some(k => norm.includes(k))) return 'inventario'
  if (KEYWORDS_CATALOGO.some(k => norm.includes(k))) return 'catalogo'
  if (KEYWORDS_COTIZADOR.some(k => norm.includes(k))) return 'cotizador'
  return 'normal'
}

// ════════════════════════════════════════════════════════════════
// ARREGLOS DEL DIA
// ════════════════════════════════════════════════════════════════

interface ArregloConFoto {
  id: string
  nombre: string
  precio: number
  descripcion: string | null
  foto_url: string
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
  } catch (error) {
    console.error('[bot] Error al obtener arreglos:', error)
    return []
  }
}

async function enviarFotosArreglos(
  client: Client,
  chatId: string,
  arreglos: ArregloConFoto[]
): Promise<void> {
  for (const arreglo of arreglos) {
    try {
      const media = await MessageMedia.fromUrl(arreglo.foto_url, { unsafeMime: true })
      const caption =
        `💐 *${arreglo.nombre}*\n` +
        `💰 $${arreglo.precio.toFixed(2)} MXN` +
        (arreglo.descripcion ? `\n📝 ${arreglo.descripcion}` : '')
      await client.sendMessage(chatId, media, { caption })
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000))
    } catch (err) {
      console.error(`[bot] Error foto "${arreglo.nombre}":`, err)
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
  const base = Math.min(Math.max((texto.length / 200) * 12000, 1500), 6000)
  return base + (Math.random() * 1000 - 500)
}

async function simularEscritura(chat: any, duracionMs: number): Promise<void> {
  try {
    await chat.sendStateTyping()
    await new Promise(resolve => setTimeout(resolve, duracionMs))
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
// PROCESAMIENTO DE MENSAJES
// ════════════════════════════════════════════════════════════════

async function procesarMensaje(message: any): Promise<void> {
  // 1. EL FILTRO SALVA-VIDAS: Ignorar grupos, estados y mensajes fantasma (@lid)
  if (message.isGroupMsg) return
  if (!message.body?.trim()) return
  if (message.from === 'status@broadcast' || message.from.includes('@lid')) return

  const clienteId: string = message.from
  const textoCliente: string = message.body.trim()

  console.log(`[${new Date().toLocaleTimeString('es-MX')}] 📨 ${clienteId}: ${textoCliente.substring(0, 80)}`)

  // 2. EL PARACAÍDAS: Si falla algo aquí, capturamos el error sin reiniciar
  try {
    const chat = await message.getChat()
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 700))

    agregarAlHistorial(clienteId, 'user', textoCliente)

    const intencion = detectarIntencion(textoCliente)
    let contextoExtra = `[Fecha actual: ${getFechaActual()}]`
    let arreglosParaEnviar: ArregloConFoto[] = []
    let enviarFotos = false

    // ── INVENTARIO DEL DIA ───────────────────────────────────────
    if (intencion === 'inventario') {
      const arreglos = await obtenerArreglosConFotos()

      if (arreglos.length > 0) {
        const resumen = arreglos
          .map((a, i) => `Foto ${i + 1}: "${a.nombre}" — $${a.precio} MXN`)
          .join('\n')

        if (!yaSeEnviaronFotos(clienteId)) {
          contextoExtra +=
            `\n\nINVENTARIO HOY:\n${resumen}\n` +
            `INSTRUCCION: Responde en maximo 1 linea confirmando que hay opciones y que ya van las fotos.`
          arreglosParaEnviar = arreglos
          enviarFotos = true
        } else {
          contextoExtra +=
            `\n\nINVENTARIO HOY (fotos ya enviadas anteriormente):\n${resumen}\n` +
            `INSTRUCCION: El cliente ya vio las fotos. Menciona los arreglos por nombre y precio en maximo 2 lineas.`
        }
      } else {
        contextoExtra +=
          `\n\nHoy NO hay arreglos listos para entrega inmediata.` +
          `Ofrece pedido personalizado con 24-48h de anticipacion. Maximo 2 lineas.`
      }
    }

    // ── CATALOGO ─────────────────────────────────────────────────
    else if (intencion === 'catalogo') {
      contextoExtra +=
        `\n\nINSTRUCCION: El cliente quiere ver el catalogo. ` +
        `Envia DIRECTAMENTE este link sin hacer preguntas ni preambulos: ` +
        `https://drive.google.com/drive/folders/1s7Hs5JKBSezcqVznKwl6TT866UqRCB4N ` +
        `Maximo 2 lineas, link como texto plano.`
    }

    // ── COTIZADOR ────────────────────────────────────────────────
    else if (intencion === 'cotizador') {
      contextoExtra +=
        `\n\nINSTRUCCION: El cliente quiere cotizar. ` +
        `Envia DIRECTAMENTE este link sin hacer preguntas: ` +
        `https://floreria-app-mauve.vercel.app/ ` +
        `Menciona brevemente que ahi puede armar su ramo, subir foto de referencia y calcular precio. ` +
        `Si quiere algo muy especifico puede pedirlo aqui por WhatsApp. Maximo 3 lineas.`
    }

    // ── RESPUESTA DE LA IA ───────────────────────────────────────
    await chat.sendStateTyping()
    const historial = obtenerHistorial(clienteId)
    const { mensaje, ventaCerrada } = await getAIResponse(historial, contextoExtra)
    await chat.clearState()

    agregarAlHistorial(clienteId, 'assistant', mensaje)

    // ── TELEGRAM SI HAY VENTA ────────────────────────────────────
    if (ventaCerrada) {
      console.log(`[bot] 🎉 VENTA CERRADA: ${ventaCerrada.cliente}`)
      enviarAlertaTelegram({
        ...ventaCerrada,
        numeroCliente: clienteId.replace('@c.us', ''),
      }).catch(err => console.error('[bot] Telegram error:', err))
    }

    // ── ENVIAR RESPUESTA AL CLIENTE ──────────────────────────────
    const mensajeFinal = limpiarRespuestaIA(mensaje)
    await simularEscritura(chat, calcularDelayEscritura(mensajeFinal))
    await message.reply(mensajeFinal)

    // ── ENVIAR FOTOS (solo primera vez) ──────────────────────────
    if (enviarFotos && arreglosParaEnviar.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      await enviarFotosArreglos(whatsappClient, clienteId, arreglosParaEnviar)
      marcarFotosEnviadas(clienteId)

      const resumenEnviado = arreglosParaEnviar
        .map((a, i) => `Foto ${i + 1}: ${a.nombre} ($${a.precio} MXN)`)
        .join(', ')
      agregarAlHistorial(
        clienteId,
        'assistant',
        `[Sistema] Fotos enviadas al cliente: ${resumenEnviado}`
      )

      await new Promise(resolve => setTimeout(resolve, 1500))
      await simularEscritura(chat, 1800)
      await whatsappClient.sendMessage(
        clienteId,
        '¿Alguno te llamo la atencion? 🌸\nSolo dime y lo aparto para ti. 🌹'
      )
    }

    console.log(`[${new Date().toLocaleTimeString('es-MX')}] ✅ Listo para ${clienteId}`)

  } catch (error) {
    // 3. EL ATERRIZAJE SEGURO: Reportar error sin explotar la app
    console.error(`[bot] Error procesando mensaje de ${clienteId}:`, error)
    try {
      const chat = await message.getChat()
      await chat.clearState()
      await message.reply('Disculpa, tuve un pequeño mareo digital 🌸. ¿Me lo puedes repetir?')
    } catch { /* Ignorar si no pudo ni enviar el mensaje de error */ }
  }
}

// ════════════════════════════════════════════════════════════════
// CLIENTE WHATSAPP
// ════════════════════════════════════════════════════════════════

const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'jardin-roce-bot',
    dataPath: '/app/.wwebjs_auth',
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    timeout: 60000,
    args: [
      // Sandbox — obligatorio en Docker
      '--no-sandbox',
      '--disable-setuid-sandbox',

      // Proceso único — ahorra ~100MB en entorno controlado
      '--single-process',

      // Memoria compartida — usa /tmp en vez de /dev/shm
      '--disable-dev-shm-usage',

      // GPU — desactivar todo lo gráfico
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--use-gl=swiftshader',
      '--disable-software-rasterizer',

      // Features innecesarias
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',

      // UI y medios
      '--disable-notifications',
      '--disable-speech-api',
      '--disable-print-preview',
      '--mute-audio',
      '--hide-scrollbars',

      // Misceláneos
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

      // Limitar heap de V8 dentro de Chromium
      '--js-flags=--max-old-space-size=256',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,AudioServiceOutOfProcess',
    ],
  },
})    

whatsappClient.on('qr', async (qr) => {
  console.log('\n📱 Se generó un nuevo Código QR. Subiendo a Supabase...')
  try {
    const { error } = await supabaseAdmin
      .from('configuracion_agente')
      .update({ qr_code: qr })
      .eq('id', 1)

    if (error) throw error
    console.log('✅ QR guardado exitosamente. Ábrelo desde tu Dashboard o lee la base de datos.')
  } catch (error) {
    console.error('❌ Error al subir el QR a Supabase:', error)
  }
})

whatsappClient.on('ready', async () => {
  console.log('\n✅ Bot de Jardin RoCe conectado!')
  console.log('🌸 Flora está escuchando...\n')

  // Limpiar QR de Supabase
  await supabaseAdmin
    .from('configuracion_agente')
    .update({ qr_code: null })
    .eq('id', 1)
    .catch(console.error)

  // Interceptar y bloquear recursos que no necesita WhatsApp Web
  try {
    const page = whatsappClient.pupPage
    if (page) {
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const tipo = request.resourceType()
        const url = request.url()

        const bloquear =
          tipo === 'image' ||
          tipo === 'media' ||
          tipo === 'font' ||
          url.includes('google-analytics') ||
          url.includes('doubleclick') ||
          url.includes('crashlogs') ||
          url.includes('sentry.io')

        if (bloquear) {
          request.abort()
        } else {
          request.continue()
        }
      })
      console.log('🛡️ Interceptor de requests activado — ahorrando RAM')
    }
  } catch (err) {
    console.warn('[bot] Interceptor no disponible:', err)
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

whatsappClient.on('message_create', (message: any) => {
  if (message.fromMe) return
  procesarMensaje(message).catch(err => console.error('[bot] Error de promesas no capturadas:', err))
})

// ════════════════════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════════════════════

console.log('🌸 Iniciando bot de Jardin RoCe...')
whatsappClient.initialize().catch((err) => {
  console.error('❌ Error al inicializar:', err)
  process.exit(1)
})

process.on('SIGINT', async () => {
  console.log('\n⚠️ Cerrando...')
  await whatsappClient.destroy().catch(console.error)
  process.exit(0)
})

process.on('uncaughtException', (err) => console.error('❌ Excepcion:', err))
process.on('unhandledRejection', (r) => console.error('❌ Rechazo:', r))

// ════════════════════════════════════════════════════════════════
// SERVIDOR WEB
// ════════════════════════════════════════════════════════════════
import express from 'express'
const app = express()

app.get('/', (req, res) => {
  res.send('🌸 Bot de Jardin RoCe está en línea y funcionando 24/7.')
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`🌐 Servidor web escuchando en el puerto ${port}`)
})