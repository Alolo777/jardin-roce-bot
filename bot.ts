// bot.ts — Jardín RoCe 🌸
// Optimizado para GCP e2-micro (1GB RAM) con systemd

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
  enviarAlertaArregloApartado,
  enviarAlertaQr,
  enviarAlertaReconectado,
  enviarAlertaDiariaDesconexion,
} from './lib/telegram'
import { supabaseAdmin } from './lib/supabase'
import type { MensajeChat } from './lib/ai'

// ════════════════════════════════════════════════════════════════
// HISTORIAL DE CONVERSACIONES
// ════════════════════════════════════════════════════════════════

const MAX_TURNOS_HISTORIAL  = 10
const CACHE_CLIENTE_UUID = new Map<string, string>()
let IGNORADOS_CACHE: string[] = []
let IGNORADOS_ULTIMA = 0

async function cargarIgnorados(): Promise<string[]> {
  const ahora = Date.now()
  if (ahora - IGNORADOS_ULTIMA < 60_000) return IGNORADOS_CACHE
  try {
    const { data } = await supabaseAdmin.from('numeros_ignorados').select('numero')
    IGNORADOS_CACHE = (data || []).map(n => n.numero.replace(/\D/g, ''))
    IGNORADOS_ULTIMA = ahora
  } catch { /* mantener caché anterior */ }
  return IGNORADOS_CACHE
}

function extraerTelefono(message: any): string {
  const raw = message.from as string
  const limpio = raw.replace(/@[^\s]*/g, '').trim()
  return limpio.startsWith('52') ? `+${limpio}` : limpio
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
// CONTROL DE FOTOS ENVIADAS
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

const MENSAJES_RESCATADOS = new Set<string>()

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
  
  // Detectar si es antes de abrir (mañana) o después de cerrar (tarde/noche)
  const estadoHorario = hora < 10 
    ? 'Aún no abrimos (abrimos a las 10:00 am).' 
    : 'Ya cerramos por hoy (abrimos mañana a las 10:00 am).';

  return (
    `\n\n[CONTEXTO: Fuera de Horario] ${estadoHorario} ` +
    `REGLA DE ORO: NUNCA le digas al cliente "mañana te muestro" o "mañana te atiendo". ` +
    `SÍ PUEDES y DEBES enviarle el inventario de hoy, el link del catálogo o el cotizador web (https://floreria-app-mauve.vercel.app/) en este momento para que adelante su pedido y quede agendado para nuestra apertura. ` +
    `Para cotizaciones de envío complejas que no estén en la web, dile amablemente que a las 10 am le confirmas el costo exacto.`
  );
}

// ════════════════════════════════════════════════════════════════
// NÚMERO REAL DEL CONTACTO
// ════════════════════════════════════════════════════════════════

const CACHE_NUMEROS = new Map<string, string>()

async function obtenerNumeroReal(message: any): Promise<string> {
  const raw = message.from as string
  if (CACHE_NUMEROS.has(raw)) return CACHE_NUMEROS.get(raw)!

  if (CACHE_NUMEROS.size > 500) CACHE_NUMEROS.clear()

  // Detectar @lid (Low-Integrity Device) — el número real requiere más tiempo
  const esLid = raw.includes('@lid')

  try {
    // Timeout más largo en e2-micro (15s vs 5s) para LIDs
    const timeoutMs = esLid ? 20_000 : 10_000
    const contact = await Promise.race([
      message.getContact(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]) as any

    // contact.number tiene el teléfono real; contact.id.user puede ser un LID
    let num = contact?.number || ''

    // Si contact.number no dio resultado, intentar contact.id.user
    if (!num || esLid && String(num).length > 13) {
      num = contact?.id?.user || ''
    }

    // Último recurso: extraer de message.from
    if (!num) num = raw.replace(/@[^\s]*/g, '').trim()

    const real = String(num).startsWith('52') ? `+${num}` : String(num)
    CACHE_NUMEROS.set(raw, real)
    return real
  } catch {
    const limpio = raw.replace(/@[^\s]*/g, '').trim()
    const numero = limpio.startsWith('52') ? `+${limpio}` : limpio
    CACHE_NUMEROS.set(raw, numero)
    return numero
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

function detectarFrustracion(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_FRUSTRACION.some(k => n.includes(k))
}

// ════════════════════════════════════════════════════════════════
// UTILIDAD: Encontrar mejor coincidencia de arreglo en texto
// ════════════════════════════════════════════════════════════════

function encontrarMejorCoincidencia(texto: string, arreglos: ArregloConFoto[]): { arreglo: ArregloConFoto; score: number } | null {
  const textoLower = texto.toLowerCase()

  // 1. Por precio exacto
  const precioMatch = texto.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)
  if (precioMatch) {
    const precio = parseFloat(precioMatch[1].replace(/,/g, ''))
    const exacto = arreglos.find(a => Math.abs(a.precio - precio) < 0.01)
    if (exacto) return { arreglo: exacto, score: 999 }
  }

  // 2. Por palabras del nombre (scoring)
  const palabrasCliente = textoLower.split(/\s+/).filter(p => p.length > 2)
  if (palabrasCliente.length === 0) return null

  let mejor = { arreglo: arreglos[0], score: 0 }
  for (const a of arreglos) {
    const palabrasArreglo = a.nombre.toLowerCase().split(/\s+/).filter(p => p.length > 2)
    const score = palabrasCliente.filter(pc =>
      palabrasArreglo.some(pa => pa.includes(pc) || pc.includes(pa))
    ).length
    if (score > mejor.score) mejor = { arreglo: a, score }
  }

  return mejor.score > 0 ? mejor : null
}

// ════════════════════════════════════════════════════════════════
// PAUSA DEL BOT
// ════════════════════════════════════════════════════════════════

let BOT_PAUSADO        = false
let ultimaVerifPausa   = 0
let verificacionEnCurso = false // FIX: mutex para evitar llamadas concurrentes a Supabase
const PAUSA_CACHE_MS   = 5_000

async function verificarSiBotPausado(): Promise<boolean> {
  if (Date.now() - ultimaVerifPausa < PAUSA_CACHE_MS) return BOT_PAUSADO
  if (verificacionEnCurso) return BOT_PAUSADO // FIX: si ya hay una consulta en curso, usar valor actual

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
// WATCHDOG — UNA SOLA DECLARACIÓN (fix: eliminado el duplicado)
// ════════════════════════════════════════════════════════════════

let ultimaActividad = Date.now()
function registrarActividad(): void { ultimaActividad = Date.now() }

// ════════════════════════════════════════════════════════════════
// CONTADOR DE REINICIOS — limpia sesión tras 3 fallos en 10 min
// ════════════════════════════════════════════════════════════════

let crashCount      = 0
let crashWindowStart = Date.now()
const MAX_CRASHES    = 3
const CRASH_WINDOW_MS = 10 * 60 * 1000

function registrarCrash(): void {
  const ahora = Date.now()
  if (ahora - crashWindowStart > CRASH_WINDOW_MS) {
    crashCount = 0
    crashWindowStart = ahora
  }
  crashCount++
  console.warn(`[Crash] ${crashCount}/${MAX_CRASHES} reinicios en ventana de 10 min`)

  if (crashCount >= MAX_CRASHES) {
    const sessionPath = process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth'
    console.warn(`[Crash] 🧹 Demasiados reinicios — limpiando sesión WhatsApp en ${sessionPath}...`)
    import('fs').then(fs => {
      fs.rmSync(sessionPath, { recursive: true, force: true })
      console.warn('[Crash] ✅ Sesión eliminada. Se generará QR fresco al reiniciar.')
    }).catch(err => console.error('[Crash] Error limpiando sesión:', err))
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
    FOTOS_YA_ENVIADAS.clear()
    CACHE_NUMEROS.clear()
    FRUSTRACION_NOTIFICADA.clear()
    RATE_TIMESTAMPS.clear()
    MENSAJES_RESCATADOS.clear()
    console.log('[RAM] 🧹 Cachés limpiadas')
  }
}, 5 * 60_000)

// ════════════════════════════════════════════════════════════════
// AUTO-LIMPIEZA CHROMIUM (FIX: destruir CDPSession después de usar)
// ════════════════════════════════════════════════════════════════

setInterval(async () => {
  try {
    const page = whatsappClient.pupPage
    if (!page) return
    console.log('[bot] 🧹 Vaciando caché de Chromium...')
    const cdp = await page.target().createCDPSession()
    await cdp.send('Network.clearBrowserCache')
    await cdp.detach() // FIX: destruir la session para no acumularlas
    console.log('[bot] ✨ Caché limpia.')
  } catch { /* ignorar si la página se estaba recargando */ }
}, 45 * 60_000)

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

  // A las 8:00-8:30 AM, si sigue desconectado y no hemos avisado hoy
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
    RATE_TIMESTAMPS.delete(id) // FIX: liberar key cuando no hay actividad reciente
  } else {
    RATE_TIMESTAMPS.set(id, recientes)
  }

  return recientes.length > RATE_LIMIT_MAX
}

function avisarRateLimitUnaVez(message: any, id: string): void {
  if (RATE_AVISADOS.has(id)) return
  RATE_AVISADOS.add(id)
  message.reply('Voy un poquito rápido 🌸 Dame un momento. ¿Va?').catch(() => {})
  setTimeout(() => RATE_AVISADOS.delete(id), RATE_LIMIT_WINDOW_MS)
}

const COLA_POR_CLIENTE = new Map<string, Promise<void>>()

function encolarPorCliente(id: string, tarea: () => Promise<void>): void {
  const previa    = COLA_POR_CLIENTE.get(id) ?? Promise.resolve()
  const siguiente = previa.catch(() => {}).then(tarea).catch(e => console.error(`[bot] Cola ${id}:`, e))
  COLA_POR_CLIENTE.set(id, siguiente)
  siguiente.finally(() => { if (COLA_POR_CLIENTE.get(id) === siguiente) COLA_POR_CLIENTE.delete(id) })
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

// ════════════════════════════════════════════════════════════════
// FOTOS PENDIENTES (cuando la IA pregunta "¿quieres ver?")
// ════════════════════════════════════════════════════════════════

const FOTOS_PENDIENTES = new Map<string, { arreglos: ArregloConFoto[] }>()
const ULTIMOS_ARREGLOS = new Map<string, ArregloConFoto[]>()
const VENTAS_CERRADAS  = new Set<string>()

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

// FIX: eliminado 'precio', 'qué precio', 'que precio', 'cuanto sale' — demasiado genéricos
// y causaban Telegram spam cuando preguntaban por el precio de arreglos del día
const KW_COTIZADOR = [
  'cotizar', 'cotizacion', 'cotización', 'cuanto cuesta', 'cuánto cuesta',
  'cuanto vale', 'cuánto vale', 'precio de un ramo', 'hacer un ramo',
  'ramo personalizado', 'armar un ramo', 'pedido especial',
  'tienen web', 'tienes web', 'pagina', 'página', 'diseñar',
]

function detectarIntencion(texto: string, clienteId: string): 'inventario' | 'catalogo' | 'cotizador' | 'normal' {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (VENTAS_CERRADAS.has(clienteId)) {
    // Cliente ya compró — no ofrecer inventario ni fotos
    return 'normal'
  }

  if (FOTOS_PENDIENTES.has(clienteId)) {
    const esAfirmativo = /^(s[ií]+|si+|ok|dale|va|quiero|enseñame|muestra|ci|claro|por favor|porfavor|sip|sii+|ándale|andele|yes|adelante|manda|mandame|envía|enviame|oka+s?|hí|súbelas|súbelos|muéstralos)/i.test(n.trim())
    if (esAfirmativo) {
      console.log(`[bot] ✅ Afirmativo detectado para fotos pendientes de ${clienteId}`)
      return 'inventario'
    }
  }

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
      .from('arreglos_diarios').select('id, nombre, precio, descripcion, foto_url')
      .eq('estado', 'disponible').order('creado_en', { ascending: false })
    if (error) throw error
    return data ?? []
  } catch (err) { console.error('[bot] Error obteniendo arreglos:', err); return [] }
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

async function buscarPrecioEnvio(texto: string): Promise<{ zona: string; precio: number; fuente: string } | null> {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  // 1. Buscar en municipios_envio (más preciso)
  const municipios = await obtenerMunicipiosEnvio()
  if (municipios.length > 0) {
    const match = municipios.find(m => {
      const nomMunicipio = m.municipio.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const nomColonia = (m.colonia ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const cp = m.codigo_postal.trim()
      return nomMunicipio.includes(n) || n.includes(nomMunicipio) || (nomColonia && (nomColonia.includes(n) || n.includes(nomColonia))) || n.includes(cp)
    })
    if (match) return { zona: match.zona, precio: match.precio_envio, fuente: 'municipios' }
  }

  // 2. Fallback: buscar en zonas_envio por palabras clave
  const zonas = await obtenerZonasEnvio()
  if (zonas.length > 0) {
    const zonaMatch = zonas.find(z =>
      z.palabras_clave.split(',').some(p =>
        n.includes(p.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      )
    )
    if (zonaMatch) return { zona: zonaMatch.zona, precio: zonaMatch.precio, fuente: 'zonas' }
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

async function apartarArreglo(nombreProducto: string, numeroCliente: string): Promise<void> {
  try {
    const prodSeguro = nombreProducto ? String(nombreProducto).trim() : 'Desconocido'
    console.log(`[bot] 🔍 Buscando en DB: "${prodSeguro}"`)

    const { data: arreglos, error } = await supabaseAdmin
      .from('arreglos_diarios').select('id, nombre, precio').eq('estado', 'disponible')

    if (error) { console.error('[bot] ❌ Error DB:', error.message); return }
    if (!arreglos?.length) { console.log('[bot] ⚠️ No hay arreglos disponibles.'); return }

    const quitarEmojis = (s: string) => s.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}]/gu, '').trim()
    const norm     = (s: string) => quitarEmojis(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const normProd = norm(prodSeguro)
    const normPals = normProd.split(/\s+/).filter(Boolean)

    let match: { id: string; nombre: string; precio: number } | undefined
    for (const a of arreglos) {
      const n = norm(a.nombre)
      if (n === normProd) { match = a; break }
    }
    if (!match) {
      for (const a of arreglos) {
        const n = norm(a.nombre)
        if (n.includes(normProd) || normProd.includes(n)) { match = a; break }
      }
    }
    if (!match && normPals.length >= 2) {
      for (const a of arreglos) {
        const n = norm(a.nombre)
        const aciertos = normPals.filter(p => n.includes(p))
        if (aciertos.length >= normPals.length * 0.6) { match = a; break }
      }
    }

    if (match) {
      const { error: updateError } = await supabaseAdmin
        .from('arreglos_diarios').update({ estado: 'apartado' }).eq('id', match.id)
      if (updateError) throw updateError
      console.log(`[bot] 📦 "${match.nombre}" → apartado`)
      enviarAlertaArregloApartado(match.nombre, match.precio, numeroCliente)
        .catch(err => console.error('[bot] Telegram apartado:', err))
    } else {
      console.warn(`[bot] ⚠️ Sin match para "${prodSeguro}". Disponibles:`, arreglos.map(a => a.nombre).join(', '))
    }
  } catch (err) { console.error('[bot] Error apartando:', err) }
}

async function enviarFotosArreglos(client: Client, chatId: string, arreglos: ArregloConFoto[]): Promise<void> {
  if (!arreglos.length) return

  const resultados = await Promise.all(
    arreglos.map(a =>
      MessageMedia.fromUrl(a.foto_url, { unsafeMime: true })
        .then(media => ({ ok: true as const, media, arreglo: a }))
        .catch(() => ({ ok: false as const, arreglo: a }))
    )
  )

  for (const r of resultados) {
    if (!r.ok) continue
    try {
      const caption =
        `💐 *${r.arreglo.nombre}*\n💰 $${r.arreglo.precio.toFixed(2)} MXN` +
        (r.arreglo.descripcion ? `\n📝 ${r.arreglo.descripcion}` : '')
      await client.sendMessage(chatId, r.media, { caption })
      await new Promise(res => setTimeout(res, 600))
    } catch (err) {
      const errStr = String(err)
      if (errStr.includes('Execution context was destroyed') || errStr.includes('Target closed')) {
        console.warn(`[bot] ⚠️ Recarga durante envío de fotos a ${chatId}. Abortando lote.`)
        break
      }
      console.error(`[bot] Error enviando "${r.arreglo.nombre}":`, err)
    }
  }
}

// ════════════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════════════

function limpiarRespuestaIA(texto: string): string {
  return texto
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2')
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$2')
    .replace(/https:\/\/[^\s]+supabase\.co\/storage\/[^\s]*/g, '')
    // Eliminar anotaciones internas que la IA a veces reproduce
    .replace(/\[(?:CLIENTE|CONTEXTO|INSTRUCCION|ARREGLO|TODOS|EXPRESIÓN|POSIBLE)[^\]]*\]\n?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function calcularDelayEscritura(texto: string): number {
  const base = Math.min(Math.max((texto.length / 200) * 2000, 600), 2500)
  return base + (Math.random() * 300 - 150)
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
  const clienteId        = message.from as string
  const texto            = message.body as string
  const chat             = await message.getChat()
  const pedido           = parsearPedidoCotizador(texto)
  const numeroRealPromise = obtenerNumeroReal(message)

  await simularEscritura(chat, 1500)
  await message.reply(
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

async function procesarMensaje(message: any): Promise<void> {
  const clienteId    = message.from as string
  const telefono     = extraerTelefono(message)
  let   textoCliente = (message.body as string).trim()

  if (textoCliente.length > MAX_LONGITUD_MENSAJE) textoCliente = textoCliente.slice(0, MAX_LONGITUD_MENSAJE)

  console.log(`[${new Date().toLocaleTimeString('es-MX')}] 📨 ${clienteId}: ${textoCliente.substring(0, 80)}`)

  const numeroRealPromise = obtenerNumeroReal(message)
  const esFrustrado       = detectarFrustracion(textoCliente)

  try {
    const chat = await message.getChat()
    await new Promise(r => setTimeout(r, 400 + Math.random() * 300))

    await agregarAlHistorial(telefono, 'user', textoCliente)

    const intencion     = detectarIntencion(textoCliente, clienteId)
    const horario       = getContextoHorario()
    let contextoExtra   = `[Fecha actual: ${getFechaActual()}]${horario}`

    // ── Detección de reply (quote) ────────────────────────────────
    let arregloReferenciado: ArregloConFoto | null = null
    let textoCitado = ''
    if (message.hasQuotedMsg) {
      try {
        const quoted = await message.getQuotedMessage()
        textoCitado = (quoted?.caption || quoted?.body || '').trim()
        // Intentar emparejar con foto mostrada
        if (textoCitado) {
          const ultimosArreglos = ULTIMOS_ARREGLOS.get(clienteId) ?? []
          const match = ultimosArreglos.find(a =>
            textoCitado.includes(a.nombre) ||
            textoCitado.includes(a.precio.toFixed(2))
          )
          if (match) {
            arregloReferenciado = match
            console.log(`[bot] 📸 Cliente respondió a foto de "${match.nombre}"`)
          }
        }
      } catch { /* ignorar si falla getQuotedMessage */ }
    }

    // ── Saludo dinámico en primer mensaje ─────────────────────────
    const historialCompleto = await obtenerHistorial(telefono)
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

    let   arreglosParaEnviar: ArregloConFoto[] = []
    let   enviarFotos   = false

    if (intencion === 'inventario') {
      const arreglos = await obtenerArreglosConFotos()
      if (arreglos.length > 0) {
        const resumen = arreglos.map((a, i) => `Foto ${i + 1}: "${a.nombre}" — $${a.precio} MXN`).join('\n')
        contextoExtra +=
          `\n\nINVENTARIO HOY:\n${resumen}\n\n` +
          `INSTRUCCION CRITICA: Las fotos se envían automáticamente. ` +
          `NUNCA digas que no puedes enviarlas. ` +
          `Responde máximo 1 línea cálida.`
        arreglosParaEnviar = arreglos
        enviarFotos        = true
      } else {
        contextoExtra += `\n\nHoy NO hay arreglos listos. Ofrece pedido personalizado 24-48h. Máximo 2 líneas.`
      }
    }

    else if (intencion === 'catalogo') {
      contextoExtra +=
        `\n\nINSTRUCCION: Envía DIRECTAMENTE: ` +
        `https://drive.google.com/drive/folders/1s7Hs5JKBSezcqVznKwl6TT866UqRCB4N Máximo 2 líneas.`
    }

    // ── COTIZADOR ─────────────────────────────────────────────────
    else if (intencion === 'cotizador') {
      const arreglosHoy = await obtenerArreglosConFotos()

      if (!estaEnHorario()) {
        if (arreglosHoy.length > 0) {
          FOTOS_PENDIENTES.set(clienteId, { arreglos: arreglosHoy })
        }
        contextoExtra +=
          `\n\nINSTRUCCION (Fuera de horario): ` +
          `Primero envía el cotizador: https://floreria-app-mauve.vercel.app/ ` +
          `${arreglosHoy.length > 0 ? 'También ofrecele ver las fotos de los ramos del día que sí podemos apartar para mañana.' : ''} ` +
          `Para envío complejo: confirmamos a las 10am. Máximo 4 líneas.`
      } else {
        if (arreglosHoy.length > 0) {
          const resumen = arreglosHoy.map((a, i) => `Foto ${i + 1}: "${a.nombre}" — $${a.precio} MXN`).join('\n')
          FOTOS_PENDIENTES.set(clienteId, { arreglos: arreglosHoy })
          contextoExtra +=
            `\n\nINVENTARIO HOY LISTO PARA MOSTRAR:\n${resumen}\n\n` +
            `INSTRUCCION: Pregunta si quiere ver los arreglos del día (son más rápidos y ya están listos). ` +
            `Si prefiere personalizado: https://floreria-app-mauve.vercel.app/ Máximo 3 líneas.`
        } else {
          contextoExtra +=
            `\n\nINSTRUCCION: Envía DIRECTAMENTE el cotizador: ` +
            `https://floreria-app-mauve.vercel.app/ Menciona que puede subir foto de referencia. Máximo 3 líneas.`
        }
      }
    }

    // ── GOOGLE MAPS / ZONAS DE ENVÍO ──────────────────────────────
    if (detectarLinkMaps(textoCliente)) {
      const zonas = await obtenerZonasEnvio()
      const hayMunicipios = cacheMunicipios && cacheMunicipios.data.length > 0
      if (zonas.length > 0 || hayMunicipios) {
        contextoExtra +=
          `\n\n[CLIENTE COMPARTIÓ LINK DE GOOGLE MAPS]\n` +
          `ZONAS DE ENVÍO DISPONIBLES:\n${formatearZonasParaPrompt(zonas)}\n\n` +
          `INSTRUCCION: Pregunta amablemente el nombre de su colonia o municipio para asignar la zona correcta. ` +
          `NUNCA inventes el precio del envío, solo di lo que está en las zonas. Cuando el cliente responda con un municipio o colonia, el sistema lo reconocerá automáticamente.`
      } else {
        contextoExtra +=
          `\n\n[CLIENTE COMPARTIÓ LINK DE GOOGLE MAPS]\n` +
          `INSTRUCCION: No hay zonas de envío configuradas. Di: "Déjame verificarlo y te confirmo el costo 🌸"`
      }
    } else {
      const envioMatch = await buscarPrecioEnvio(textoCliente)
      if (envioMatch) {
        contextoExtra +=
          `\n\n[CLIENTE MENCIONÓ UNA ZONA: "${envioMatch.zona}" — $${envioMatch.precio.toFixed(2)} MXN (${envioMatch.fuente})]\n` +
          `INSTRUCCION: Usa este precio de envío exacto. Confirma: "El envío a esa zona cuesta $${envioMatch.precio.toFixed(2)} MXN, ¿te parece bien?" NUNCA inventes precios.`
      }
    }

    // Inyectar contexto del arreglo referenciado si aplica
    if (arregloReferenciado) {
      const ultimosArreglos = ULTIMOS_ARREGLOS.get(clienteId) ?? []
      const lista = ultimosArreglos.map(a => `"${a.nombre}" — $${a.precio} MXN`).join(' | ')
      contextoExtra +=
        `\n\n[CLIENTE RESPONDIÓ A LA FOTO DE: "${arregloReferenciado.nombre}" — $${arregloReferenciado.precio} MXN]` +
        `\n[TODOS LOS ARREGLOS MOSTRADOS: ${lista}]` +
        `\nINSTRUCCION URGENTE: El cliente eligió ESE arreglo específico. ` +
        `Confirma nombre y precio en 1 línea y pregunta SOLO: "¿Lo recoges en sucursal o necesitas envío?"`
    }

    // ── Contexto genérico de reply (aunque no sea foto) ──────────
    if (message.hasQuotedMsg && !arregloReferenciado && textoCitado) {
      contextoExtra +=
        `\n\n[CLIENTE RESPONDIÓ AL MENSAJE: "${textoCitado.replace(/"/g, "'")}"]` +
        `\nINSTRUCCION: El usuario respondió específicamente a ese mensaje. Úsalo para entender a qué se refiere.`
    }

    // ── Cliente con venta ya cerrada ─────────────────────────────
    if (VENTAS_CERRADAS.has(clienteId)) {
      contextoExtra +=
        `\n\n[VENTA YA CERRADA PARA ESTE CLIENTE] El usuario ya completó su compra. ` +
        `Atiende dudas post-venta (seguimiento, quejas, cambios) pero NO ofrezcas nuevos arreglos ni preguntes "cuál te gustó". ` +
        `Si pide fotos, dile que su pedido ya está apartado y confirma los detalles.`
      enviarFotos = false // no enviar fotos nuevas
    }

    // Detectar si el usuario está eligiendo un arreglo de la lista mostrada
    const ultimosArreglos = ULTIMOS_ARREGLOS.get(clienteId)
    if (ultimosArreglos?.length && textoCliente.length < 200) {
      const esEleccion = /me gust[oó]|quiero|ese|este|el[^a-zA-Z]|prefiero|me llevo|aparta|reply/i.test(textoCliente)
      const match = encontrarMejorCoincidencia(textoCliente, ultimosArreglos)
      if (match || esEleccion) {
        const lista = ultimosArreglos.map((a, i) => `"${a.nombre}" — $${a.precio} MXN`).join(' | ')
        let instruccion = `\n\n[ARREGLOS MOSTRADOS: ${lista}]`
        if (match && match.score >= 2) {
          instruccion += `\n[CLIENTE ELIGIÓ: "${match.arreglo.nombre}" — $${match.arreglo.precio} MXN (coincidencia exacta)]`
        } else if (match) {
          instruccion += `\n[POSIBLE ELECCIÓN: "${match.arreglo.nombre}" — $${match.arreglo.precio} MXN]`
        }
        if (esEleccion) {
          instruccion += `\n[EXPRESIÓN DE ELECCIÓN DETECTADA: "${textoCliente}"]`
        }
        instruccion +=
          `\nINSTRUCCION: Confirma el nombre y precio exacto del arreglo elegido en 1 línea` +
          ` y pasa DIRECTAMENTE a preguntar si lo recoge o necesita envío. ` +
          `NO preguntes "cuál te gustó" — el usuario ya lo dijo.`
        contextoExtra += instruccion
      }
    }

    // Detectar continuacion de venta (pago/envio)
    const KW_PAGO = /pago|pagar|transferencia|deposito|depósito|bbva|banco|tarjeta|efectivo|oxxo|okei|okis|okas|ok|va|dale|acuerdo|confirmo|si[^a-zA-Z]|simon|sip|sipo|está bien|esta bien|le pago|voy a pagar|ya pague|ya pagué|ya me dijo|listo|comprobante/i.test(textoCliente)
    const KW_CONFIRMA_PAGO = /ya pague|ya pagué|listo|transfer|comprobante|ya quedó|ya quedo|ya la hice|ya la hizo|ya llegó|ya llego|sipi|si ya|confirmo|confirmado|ya esta pagado/i.test(textoCliente)

    if (KW_PAGO && intencion === 'normal') {
      contextoExtra +=
        `\n\n[CONTEXTO DE PAGO] El usuario está respondiendo sobre pago o confirmación. ` +
        `Revisa el historial. Si el usuario YA CONFIRMÓ el pago (dijo "ya pague", "listo", "comprobante", "transfer"): ` +
        `AGRADECE el pago, confirma que el pedido queda apartado y CIERRA con el token. ` +
        `NO le pidas más confirmación ni le digas "déjame revisar". ` +
        `El token [VENTA_CERRADA:...] debe ir AL FINAL de tu mensaje.`
    }

    await chat.sendStateTyping()
    const historialAI = await obtenerHistorial(telefono)
    const { mensaje, ventaCerrada } = await getAIResponse(historialAI, contextoExtra)
    await chat.clearState()

    await agregarAlHistorial(telefono, 'assistant', mensaje)

    const mensajeFinal = limpiarRespuestaIA(mensaje)
    await simularEscritura(chat, calcularDelayEscritura(mensajeFinal))
    await message.reply(mensajeFinal)

    const numeroReal = await numeroRealPromise

    // Alerta cotización de envío
    if (mensajeFinal.toLowerCase().includes('verificar el costo')) {
      enviarAlertaCotizacion(numeroReal, `📍 Cotización de envío solicitada.\nDirección: ${textoCliente}`)
        .catch(err => console.error('[bot] Telegram envío:', err))
    }
    // Alerta cotizador web
    else if (intencion === 'cotizador') {
      enviarAlertaCotizacion(numeroReal, textoCliente)
        .catch(err => console.error('[bot] Telegram cotizacion:', err))
    }

    // Frustración
    if (esFrustrado) {
      const veces = (FRUSTRACION_NOTIFICADA.get(clienteId) ?? 0) + 1
      FRUSTRACION_NOTIFICADA.set(clienteId, veces)
      if (veces <= 2) {
        enviarAlertaClienteFrustrado(numeroReal, textoCliente)
          .catch(err => console.error('[bot] Telegram frustración:', err))
      }
    }

    // Venta cerrada
    if (ventaCerrada) {
      console.log(`[bot] 🎉 VENTA CERRADA: ${ventaCerrada.cliente} | ${numeroReal}`)
      enviarAlertaVentaCerrada({
        cliente: ventaCerrada.cliente, producto: ventaCerrada.producto,
        total: ventaCerrada.total, direccion: ventaCerrada.direccion,
        numeroCliente: numeroReal,
      }).catch(err => console.error('[bot] Telegram venta:', err))
      apartarArreglo(ventaCerrada.producto, numeroReal)
        .catch(err => console.error('[bot] Error apartando:', err))
      VENTAS_CERRADAS.add(clienteId)
      FOTOS_PENDIENTES.delete(clienteId) // limpiar fotos pendientes
    }

    // Fallback: si el cliente confirmó pago pero la IA no generó el token
    if (!ventaCerrada && KW_CONFIRMA_PAGO && mensajeFinal.length < 150 && !mensajeFinal.includes('?')) {
      const ultimos = ULTIMOS_ARREGLOS.get(clienteId)
      const nombreArreglo = ultimos?.[0]?.nombre ?? 'Pedido'
      const precioArreglo = ultimos?.[0]?.precio ?? 0
      console.log(`[bot] ⚠️ Cliente confirmó pago pero IA no generó token. Notificando igual.`)
      enviarAlertaVentaCerrada({
        cliente: 'Verificar en chat',
        producto: nombreArreglo,
        total: `$${precioArreglo.toFixed(2)} MXN`,
        direccion: 'Por confirmar',
        numeroCliente: numeroReal,
      }).catch(err => console.error('[bot] Telegram venta fallback:', err))
    }

    // Detectar "venta cerrada" explícito del usuario/humano
    if (/venta\s*cerrada|venta.*cerrada|sale.*closed|closed.*sale/i.test(textoCliente)) {
      console.log(`[bot] 🚨 Usuario indicó venta cerrada manualmente: ${numeroReal}`)
      const ultimos = ULTIMOS_ARREGLOS.get(clienteId)
      const nombreArreglo = ultimos?.[0]?.nombre ?? 'Pedido'
      const precioArreglo = ultimos?.[0]?.precio ?? 0
      enviarAlertaVentaCerrada({
        cliente: 'Manual',
        producto: nombreArreglo,
        total: `$${precioArreglo.toFixed(2)} MXN`,
        direccion: 'Verificar en chat',
        numeroCliente: numeroReal,
      }).catch(err => console.error('[bot] Telegram venta manual:', err))
      apartarArreglo(nombreArreglo, numeroReal)
        .catch(err => console.error('[bot] Error apartando manual:', err))
      VENTAS_CERRADAS.add(clienteId)
      FOTOS_PENDIENTES.delete(clienteId)
    }

    // Fotos — desde intent detection o desde FOTOS_PENDIENTES
    const fotosPendientes = VENTAS_CERRADAS.has(clienteId) ? undefined : FOTOS_PENDIENTES.get(clienteId)
    const arreglosFinales = arreglosParaEnviar.length > 0 ? arreglosParaEnviar : (fotosPendientes?.arreglos ?? [])

    if (enviarFotos || fotosPendientes) {
      FOTOS_PENDIENTES.delete(clienteId)

      if (arreglosFinales.length > 0) {
        await new Promise(r => setTimeout(r, 500))
        await enviarFotosArreglos(whatsappClient, clienteId, arreglosFinales)
        marcarFotosEnviadas(clienteId)

        const resumenFotos = arreglosFinales.map((a, i) => `Foto ${i + 1}: ${a.nombre} ($${a.precio} MXN)`).join(', ')
        await agregarAlHistorial(telefono, 'assistant', `[Sistema] Fotos enviadas: ${resumenFotos}`)
        // Guardar lista para matching en próximos mensajes
        ULTIMOS_ARREGLOS.set(clienteId, arreglosFinales)

        await new Promise(r => setTimeout(r, 600))
        await simularEscritura(chat, 800)
        await whatsappClient.sendMessage(clienteId, '¿Alguno te llamó la atención? 🌸\nSolo dime cuál y lo aparto para ti. 🌹')
      }
    }

    console.log(`[${new Date().toLocaleTimeString('es-MX')}] ✅ Listo para ${clienteId}`)

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const esPuppeteerError =
      errMsg.includes('Execution context was destroyed') ||
      errMsg.includes('Protocol error') ||
      errMsg.includes('Target closed') ||
      errMsg.includes('Session closed') ||
      errMsg.includes('timed out') ||
      errMsg.includes('getChat') ||
      errMsg.includes('evaluate')

    if (esPuppeteerError) {
      console.warn(`[bot] ⚠️ Recarga de WhatsApp. El cliente puede reenviar.`)
      return
    }

    console.error(`[bot] Error con ${clienteId}:`, error)

    const msgId = (message as any).id?._serialized
    const esRescatado = msgId && MENSAJES_RESCATADOS.has(msgId)

    if (!esRescatado) {
      try {
        const chat = await Promise.race([
          message.getChat(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
        ]) as any
        await chat.clearState().catch(() => {})
        await message.reply('Disculpa, tuve un pequeño mareo digital 🌸. ¿Me lo puedes repetir?').catch(() => {})
      } catch { /* ignorar */ }
    } else {
      MENSAJES_RESCATADOS.delete(msgId!)
      console.warn(`[bot] ⚠️ Mensaje rescatado falló silenciosamente (sin "mareo digital")`)
    }
  }
}

// ════════════════════════════════════════════════════════════════
// RESCATE DE MENSAJES HUÉRFANOS
// FIX: espera unificada y await correcto
// ════════════════════════════════════════════════════════════════

async function recuperarMensajesPerdidos(): Promise<void> {
  // FIX: espera unificada de 10s (antes eran 8s en ready + 8s dentro = 16s)
  await new Promise(r => setTimeout(r, 10_000))

  try {
    const state = await whatsappClient.getState().catch(() => null)
    if (state !== 'CONNECTED') {
      console.log('[bot] ⚠️ No conectado. Omitiendo rescate.')
      return
    }

    console.log('[bot] 🧹 Buscando mensajes no leídos...')
    const chats = await whatsappClient.getChats()
    const chatsPendientes = chats.filter(c => c.unreadCount > 0 && !c.isGroup)

    if (chatsPendientes.length === 0) {
      console.log('[bot] ✨ Sin mensajes atrasados.')
      return
    }

    console.log(`[bot] 📥 Rescatando ${chatsPendientes.length} chats (lotes de 2)...`)
    const BATCH_SIZE_RESCATE = 2
    for (let i = 0; i < chatsPendientes.length; i += BATCH_SIZE_RESCATE) {
      const batch = chatsPendientes.slice(i, i + BATCH_SIZE_RESCATE)
      await Promise.all(batch.map(async (chat) => {
        const mensajes = await chat.fetchMessages({ limit: chat.unreadCount })
        for (const msg of mensajes) {
          if (!msg.fromMe) {
            const msgId = (msg as any).id?._serialized
            if (msgId) MENSAJES_RESCATADOS.add(msgId)

            console.log(`[bot] ♻️ Inyectando mensaje rescatado de ${chat.id._serialized}`)
            manejarMensajeEntrante(msg)
          }
          await new Promise(r => setTimeout(r, 150))
        }
      }))
    }
  } catch (err) {
    console.error('[bot] Error en rescate:', err)
  }
}

// ════════════════════════════════════════════════════════════════
// CLIENTE DE WHATSAPP
// ════════════════════════════════════════════════════════════════

// 1. Detectamos automáticamente si estamos en el servidor Linux (Google Cloud)
const isProduction = process.platform === 'linux';

// 2. Asignamos las banderas según el sistema operativo
const puppeteerArgs = isProduction ? [
  // Banderas extremas para sobrevivir en Google Cloud
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disk-cache-size=0', '--media-cache-size=0', '--disable-application-cache',
  '--disable-gpu', '--disable-gpu-sandbox', '--use-gl=swiftshader',
  '--disable-accelerated-2d-canvas',
  '--disable-software-rasterizer', '--disable-extensions', '--disable-plugins',
  '--disable-default-apps', '--disable-sync', '--disable-background-networking',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-ipc-flooding-protection',
  '--disable-notifications', '--disable-speech-api', '--disable-print-preview',
  '--mute-audio', '--hide-scrollbars', '--disable-client-side-phishing-detection',
  '--disable-hang-monitor', '--disable-prompt-on-repost', '--disable-breakpad',
  '--no-first-run', '--no-default-browser-check', '--no-pings',
  '--password-store=basic', '--use-mock-keychain', '--metrics-recording-only',
  '--js-flags=--max-old-space-size=512',
  '--disable-features=TranslateUI,BlinkGenPropertyTrees,AudioServiceOutOfProcess,AudioServiceSandbox',
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--disable-component-extensions-with-background-pages',
  '--disable-component-update',
  '--safebrowsing-disable-auto-updates',
  '--disable-domain-reliability',
  '--disable-backing-store-limit',
  '--max_old_space_size=256',
] : [
  // Banderas relajadas para que funcione perfecto en tu Windows local
  '--no-sandbox', '--disable-setuid-sandbox'
];

// 3. Inicializamos el cliente
const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'jardin-roce-bot',
    dataPath: process.env.WWEBJS_DATA_PATH || './.wwebjs_auth',
  }),
  authTimeoutMs: 0,   // Paciencia infinita
  qrMaxRetries:  100,
  puppeteer: {
    headless:        true,
    dumpio:          true, //Activar para ver logs detallados de Puppeteer
    executablePath:  process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    timeout:         120000,
    protocolTimeout: 600000, // 10 minutos de paciencia
    args:            puppeteerArgs, // Pasamos las banderas dinámicas
  },
})

let BOT_QR_EMITIDO = false
let BOT_QR_ACTUAL: string | null = null

whatsappClient.on('qr', async (qr) => {
  BOT_QR_EMITIDO = true
  BOT_QR_ACTUAL = qr
  console.log('\n⚡ ¡NUEVO QR! Escanéalo ahora:')
  qrcode.generate(qr, { small: true })
  console.log('\n📱 Subiendo a Supabase como respaldo...')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await supabaseAdmin.from('configuracion_agente').update({ qr_code: qr }).eq('id', 1)
      if (error?.message?.includes('0 rows')) {
        // La fila no existe — crearla
        const { error: insErr } = await supabaseAdmin.from('configuracion_agente').insert({ id: 1, qr_code: qr, bot_pausado: false })
        if (insErr) throw insErr
        console.log('✅ QR guardado (INSERT).')
        break
      }
      if (error) throw error
      console.log('✅ QR guardado.')
      break
    } catch (err) {
      console.error(`❌ Error QR Supabase (intento ${attempt + 1}/3):`, err)
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000))
    }
  }
  enviarAlertaQr()
})

whatsappClient.on('ready', async () => {
  BOT_READY = true
  console.log('\n✅ Bot de Jardín RoCe conectado!')
  console.log('🌸 Flora está escuchando...\n')
  ultimaActividad = Date.now()
  if (BOT_QR_EMITIDO) enviarAlertaReconectado()

  setInterval(async () => {
    const minSinMensajes = Math.round((Date.now() - ultimaActividad) / 60_000)

    try {
      const state = await whatsappClient.getState()

      if (state !== 'CONNECTED') {
        console.warn(`[Watchdog] ⚠️ Estado: ${state}. Reconectando...`)
        await whatsappClient.destroy().catch(console.error)
        await new Promise(r => setTimeout(r, 3000))
        await whatsappClient.initialize().catch(console.error)
        ultimaActividad = Date.now()
        return
      }

      // ZOMBIE DETECTION: conectado pero sin mensajes en horario laboral
      // Si llevamos 15+ min en horario de atención sin recibir NADA → estado zombie
      if (minSinMensajes >= 15 && estaEnHorario()) {
        console.error(`[Watchdog] 🧟 ESTADO ZOMBIE detectado: ${minSinMensajes} min sin mensajes en horario laboral. getState()=CONNECTED pero hooks muertos.`)
        process.exit(1) // systemd Restart=always lo levanta limpio
        return
      }

      // Fuera de horario es normal no recibir mensajes
      if (minSinMensajes >= 30) {
        console.log(`[Watchdog] ℹ️ ${minSinMensajes} min sin mensajes (fuera de horario — normal)`)
      }

    } catch (err) {
      // getState() falló — el cliente está desconectado
      if (minSinMensajes >= 5) {
        console.error('[Watchdog] Error crítico en getState — forzando reinicio:', err)
        registrarCrash()
        process.exit(1)
      }
    }
  }, 5 * 60_000)

  BOT_QR_ACTUAL = null
  try {
    await supabaseAdmin.from('configuracion_agente').update({ qr_code: null }).eq('id', 1)
  } catch (err) { console.error('[bot] Error limpiando QR:', err) }

  // 👇 FIX MÁGICO: Ejecutar el rescate de mensajes justo al arrancar en limpio
  recuperarMensajesPerdidos().catch(err => console.error('[bot] Error recuperando:', err))

  try {
    const page = whatsappClient.pupPage
    if (page) {
      page.removeAllListeners('framenavigated')
      let reconectando = false
      page.on('framenavigated', async (frame: any) => {
        if (frame !== page.mainFrame() || reconectando) return
        reconectando = true

        console.warn('[bot] 🔄 WhatsApp Web recargado. Intentando reconectar sin reiniciar proceso...')

        try {
          await whatsappClient.destroy().catch(() => {})
          await new Promise(r => setTimeout(r, 5000))
          BOT_READY = false
          BOT_QR_EMITIDO = false
          await whatsappClient.initialize()
          console.log('[bot] ✅ Reconexión tras recarga exitosa.')
        } catch (err) {
          console.error('[bot] ❌ No se pudo reconectar tras recarga — forzando reinicio:', err)
          registrarCrash()
          process.exit(1)
        }
      })
    }
  } catch (err) { console.warn('[bot] No se pudo registrar framenavigated:', err) }
})

whatsappClient.on('auth_failure', (msg) => { console.error('❌ Auth:', msg); registrarCrash(); process.exit(1) })

whatsappClient.on('disconnected', (reason) => {
  console.warn('⚠️ Desconectado:', reason)
  setTimeout(() => { console.log('🔄 Reconectando...'); whatsappClient.initialize().catch(console.error) }, 5000)
})

function manejarMensajeEntrante(message: any): void {
  registrarActividad()
  console.log(`[DIAG] from: ${message.from} | type: ${message.type} | fromMe: ${message.fromMe}`)

  if (message.isGroupMsg) return
  if (!message.from || message.from === 'status@broadcast') return
  if (message.from.includes('@lid') && !message.body?.trim()) return

  // Ignorar números silenciados (repartidor, admin, etc.)
  const numMsg = message.from.replace(/@[^\s]*/g, '').replace(/\D/g, '')
  if (!message.fromMe && IGNORADOS_CACHE.includes(numMsg)) {
    console.log(`[bot] 🔇 Número ignorado: ${numMsg}`)
    return
  }

  // Guardar mensajes enviados desde la cuenta (agente humano) al historial para contexto
  if (message.fromMe) {
    const telefonoDestino = message.to
      ? (message.to as string).replace(/@[^\s]*/g, '').trim()
      : null
    if (telefonoDestino && message.body?.trim()) {
      const num = telefonoDestino.startsWith('52') ? `+${telefonoDestino}` : telefonoDestino
      agregarAlHistorial(num, 'assistant', `[Agente: ${message.body.trim()}]`)
    }
    return
  }

  const clienteId = message.from as string

  if (message.type && message.type !== 'chat') {
    if (TIPOS_MEDIA_NO_SOPORTADOS.has(message.type)) {
      message.reply('Por ahora solo puedo leer mensajes de *texto* 🌸. ¿Qué necesitas?').catch(() => {})
    }
    return
  }

  if (!message.body?.trim()) return
  if (estaRateLimited(clienteId)) { avisarRateLimitUnaVez(message, clienteId); return }

  verificarSiBotPausado().then(pausado => {
    if (pausado) { console.log(`[bot] ⏸️ Pausado — ${clienteId} ignorado`); return }
    if (esPedidoCotizador(message.body)) {
      encolarPorCliente(clienteId, () => procesarPedidoWeb(message))
    } else {
      encolarPorCliente(clienteId, () => procesarMensaje(message))
    }
  }).catch(() => encolarPorCliente(clienteId, () => procesarMensaje(message)))
}

whatsappClient.on('message_create', manejarMensajeEntrante)

// ════════════════════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════════════════════

console.log('🌸 Iniciando bot de Jardín RoCe...')

// ── Startup Watchdog: si no hay "ready" en 3 minutos, reinicia ──
// (NO reinicia si ya se emitió un QR — el usuario necesita tiempo para escanear)
const BOT_START_TIME = Date.now()
let BOT_READY = false

const startupWatchdog = setInterval(() => {
  const elapsed = Math.round((Date.now() - BOT_START_TIME) / 1000)
  if (BOT_READY) { clearInterval(startupWatchdog); return }

  // Si ya salió QR, esperamos pacientemente a que el usuario escanee
  if (BOT_QR_EMITIDO) {
    if (elapsed % 120 < 31) console.log(`[Startup] ⏳ Esperando escaneo QR... (${Math.round(elapsed / 60)} min)`)
    return
  }

  if (elapsed > 180) {
    console.warn(`[Startup] ⏰ ${elapsed}s sin "ready". Verificando estado...`)
    whatsappClient.getState()
      .then(state => console.warn(`[Startup] Estado: ${state}`))
      .catch(err => console.warn(`[Startup] Error getState:`, err))

    // Forzar reconexión completa
    console.warn('[Startup] 🔄 Forzando reinicio por timeout de inicialización...')
    clearInterval(startupWatchdog)
    registrarCrash()
    process.exit(1)
  }
}, 30_000)
startupWatchdog.unref()

whatsappClient.initialize().catch((err) => { console.error('❌ Error:', err); registrarCrash(); process.exit(1) })

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚠️ ${signal} recibido — cerrando graceful...`)
  const timer = setTimeout(() => {
    console.warn('[shutdown] Timeout 10s — forzando exit.')
    process.exit(1)
  }, 10_000)
  timer.unref()

  try {
    await whatsappClient.destroy()
  } catch (e) {
    console.error('[shutdown] Error al destruir:', e)
  }
  clearTimeout(timer)
  process.exit(0)
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('uncaughtException',  (err) => console.error('❌ Excepción:', err))
process.on('unhandledRejection', (r)   => console.error('❌ Rechazo:', r))

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

app.get('/', (_req, res) => res.send('🌸 Jardín RoCe Bot — en línea.'))

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

app.get('/qr', (_req, res) => {
  res.json({ qr: BOT_QR_ACTUAL })
})

app.get('/status', (_req, res) => {
  res.json({
    pausado: BOT_PAUSADO,
    connected: whatsappClient?.info ? true : false,
  })
})

app.listen(port, () => console.log(`🌐 Servidor web en puerto ${port}`))
console.log(`⚠️ Bot escuchando en :${port}. Next.js debe usar otro puerto (default 3000).`)





