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
  enviarAlertaCancelacion,
  enviarAlertaQueja,
  enviarAlertaAtencionHumana,
  enviarAlertaPedidoApartado,
  enviarAlertaZonaAmbigua,
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

const FOTOS_ENVIADAS_HOY = new Map<string, number>()
const MAX_ENVIOS_FOTOS_DIA = 3
const MENSAJES_PROCESADOS = new Map<string, number>()
const MENSAJE_PROCESADO_TTL_MS = 2 * 60 * 60_000

function enviosFotosRestantes(id: string): number {
  return Math.max(0, MAX_ENVIOS_FOTOS_DIA - (FOTOS_ENVIADAS_HOY.get(id) ?? 0))
}

function puedeEnviarFotos(id: string): boolean { return enviosFotosRestantes(id) > 0 }

function marcarFotosEnviadas(id: string): void {
  FOTOS_ENVIADAS_HOY.set(id, (FOTOS_ENVIADAS_HOY.get(id) ?? 0) + 1)
  const manana = new Date()
  manana.setDate(manana.getDate() + 1)
  manana.setHours(0, 0, 0, 0)
  setTimeout(() => FOTOS_ENVIADAS_HOY.delete(id), manana.getTime() - Date.now())
}

const MENSAJES_RESCATADOS = new Set<string>()

function obtenerMensajeId(message: any): string | null {
  return message?.id?._serialized || null
}

function marcarMensajeProcesado(id: string): void {
  MENSAJES_PROCESADOS.set(id, Date.now())
}

function yaProcesadoRecientemente(message: any): boolean {
  const id = obtenerMensajeId(message)
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
// VALIDACIÓN POST-AI DE PRECIOS
// ════════════════════════════════════════════════════════════════

function validarPreciosEnRespuesta(respuesta: string, arreglos: ArregloConFoto[]): { valido: boolean; advertencia?: string } {
  // Extraer montos en formato $XXX del texto
  const preciosMencionados = respuesta.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*MXN/g)
  if (!preciosMencionados) return { valido: true }

  const preciosReales = new Set(arreglos.map(a => a.precio))
  const preciosConTexto = respuesta.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*MXN/g) || []

  for (const p of preciosConTexto) {
    const monto = parseFloat(p.replace(/[$,]\s*/g, '').replace(/,/g, ''))
    // Si menciona un precio que no existe en inventario ni es $60 (precio general) ni es precio de envío
    if (!preciosReales.has(monto) && monto !== 60 && !respuesta.includes('envío') && !respuesta.includes('Envío')) {
      // Checar si está mencionando un arreglo específico con este precio
      const contextoAlrededor = respuesta.substring(
        Math.max(0, respuesta.indexOf(p) - 40),
        Math.min(respuesta.length, respuesta.indexOf(p) + 40)
      )
      // Si el contexto incluye "desde" o "base", es un precio general, no un arreglo específico
      if (contextoAlrededor.includes('desde') || contextoAlrededor.includes('base')) continue
      return {
        valido: false,
        advertencia: `La IA mencionó el precio ${p} que no coincide con ningún arreglo disponible (${arreglos.map(a => `$${a.precio}`).join(', ')})`
      }
    }
  }
  return { valido: true }
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

function detectarFrustracion(texto: string): boolean {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return KW_FRUSTRACION.some(k => n.includes(k))
}

function detectarAtencionHumana(texto: string): string | null {
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

// ════════════════════════════════════════════════════════════════
// UTILIDAD: Encontrar mejor coincidencia de arreglo en texto
// ════════════════════════════════════════════════════════════════

function encontrarMejorCoincidencia(texto: string, arreglos: ArregloConFoto[]): { arreglo: ArregloConFoto; score: number } | null {
  const textoLower = normalizarTexto(texto)

  // 1. Por precio exacto
  const precioMatch = texto.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)
  if (precioMatch) {
    const precio = parseFloat(precioMatch[1].replace(/,/g, ''))
    const exacto = arreglos.find(a => Math.abs(a.precio - precio) < 0.01)
    if (exacto) return { arreglo: exacto, score: 999 }
  }

  // 2. Por palabras del nombre (scoring)
  const STOP_MATCH_ARREGLOS = new Set([
    'ramo', 'ramos', 'arreglo', 'arreglos', 'bouquet', 'flor', 'flores',
    'este', 'esta', 'ese', 'esa', 'bien', 'chido', 'padre', 'bonito', 'bonita',
    'gusto', 'gustaria', 'quiero', 'porfavor', 'favor', 'mucho', 'uno', 'una',
  ])
  const palabrasCliente = textoLower
    .split(/\s+/)
    .map(p => p.replace(/[^a-z0-9]/g, ''))
    .filter(p => p.length > 2 && !STOP_MATCH_ARREGLOS.has(p))
  if (palabrasCliente.length === 0) return null

  let mejor = { arreglo: arreglos[0], score: 0 }
  for (const a of arreglos) {
    const palabrasArreglo = normalizarTexto(a.nombre)
      .split(/\s+/)
      .map(p => p.replace(/[^a-z0-9]/g, ''))
      .filter(p => p.length > 2 && !STOP_MATCH_ARREGLOS.has(p))
    const score = palabrasCliente.filter(pc =>
      palabrasArreglo.some(pa => pa.includes(pc) || pc.includes(pa))
    ).length
    if (score > mejor.score) mejor = { arreglo: a, score }
  }

  return mejor.score >= 2 ? mejor : null
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
    const sessionPath = process.env.WWEBJS_DATA_PATH || './.wwebjs_auth'
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
    FOTOS_ENVIADAS_HOY.clear()
    CACHE_NUMEROS.clear()
    FRUSTRACION_NOTIFICADA.clear()
    RATE_TIMESTAMPS.clear()
    MENSAJES_RESCATADOS.clear()
    MENSAJES_PROCESADOS.clear()
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

// ════════════════════════════════════════════════════════════════
// REPORTE DE VENTAS
// ════════════════════════════════════════════════════════════════

async function registrarVenta(clienteNombre: string, telefono: string, producto: string, total: string, direccion: string): Promise<void> {
  try {
    const precioNumerico = parseFloat(total.replace(/[^0-9.]/g, '')) || 0
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

async function obtenerVentasHoy(): Promise<{ total: number; cantidad: number }> {
  try {
    const hoy = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
    const inicio = new Date(hoy)
    inicio.setHours(0, 0, 0, 0)
    const fin = new Date(hoy)
    fin.setHours(23, 59, 59, 999)

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
    const hoy = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
    const inicio = new Date(hoy)
    inicio.setHours(0, 0, 0, 0)
    const fin = new Date(hoy)
    fin.setHours(23, 59, 59, 999)

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

function encolarMensajeAgrupado(clienteId: string, message: any): void {
  const actual = MENSAJES_POR_AGRUPAR.get(clienteId)
  if (actual) clearTimeout(actual.timer)

  const mensajes = [...(actual?.mensajes ?? []), message]
  const timer = setTimeout(() => {
    MENSAJES_POR_AGRUPAR.delete(clienteId)
    const textos = mensajes.map(m => String(m.body || '').trim()).filter(Boolean)
    if (textos.length === 0) return

    const base = mensajes.find(m => m.hasQuotedMsg) ?? mensajes[mensajes.length - 1]
    base.body = textos.join('\n')
    for (const msg of mensajes) {
      const id = obtenerMensajeId(msg)
      if (id && msg !== base) marcarMensajeProcesado(id)
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

// ════════════════════════════════════════════════════════════════
// FOTOS PENDIENTES (cuando la IA pregunta "¿quieres ver?")
// ════════════════════════════════════════════════════════════════

const FOTOS_PENDIENTES = new Map<string, { arreglos: ArregloConFoto[] }>()
const ULTIMOS_ARREGLOS = new Map<string, ArregloConFoto[]>()
const FOTOS_ENVIANDO = new Set<string>()
const FOTOS_CANCELADAS = new Set<string>()
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
  FOTOS_PENDIENTES.delete(clienteId)
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

const KW_INVENTARIO = [
  'disponible', 'disponibles', 'armado', 'armados',
  'tienes hoy', 'hay hoy', 'entrega inmediata', 'para hoy',
  'que tienes', 'que tienen', 'tienen algo', 'hay algo',
  'ramitos', 'que ramitos', 'que ramos', 'ramos de hoy',
  'tienen hoy', 'hoy tienen', 'muestrame', 'muéstrame',
  'fotos', 'foto', 'ver ramos', 'ver arreglos',
  'verlos', 'verlas', 'averlos', 'averlas', 'a verlos', 'a verlas',
  'si aver', 'sí aver', 'si a ver', 'sí a ver',
  'mandar de nuevo', 'manda de nuevo', 'mandamelas de nuevo', 'mándamelas de nuevo',
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

  if (/ya no quiero fotos|no quiero fotos|sin fotos/.test(n)) return 'normal'

  if (ULTIMOS_ARREGLOS.has(clienteId) && /(me gusto|me gustaria|quiero|aparta|apartes|ramo de|el de|la segunda foto|segunda foto|primer foto|primera foto|tercer foto|tercera foto|lily|lilys|girasol|hortencia|hortensia)/.test(n) && !/(ver|manda|mandar|envia|enviar|reenviar).{0,15}foto/.test(n)) {
    return 'normal'
  }

  if (/foto.*(entrega|entreguen|entregado|repartidor)|comprobante.*entrega|cuando.*entreguen/.test(n)) {
    return 'normal'
  }

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

  // 1. Buscar por scoring: CP > municipio > colonia. Evita que "centro" gane sobre "San Andrés".
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
      const esMatchFuerte = mejor.score >= 120 || tieneDatoDireccion
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

async function apartarArreglo(nombreProducto: string, numeroCliente: string): Promise<void> {
  try {
    const prodSeguro = nombreProducto ? String(nombreProducto).trim() : 'Desconocido'
    console.log(`[bot] 🔍 Buscando en DB: "${prodSeguro}"`)

    const { data: arreglos, error } = await supabaseAdmin
      .from('arreglos_diarios').select('id, nombre, precio, estado').in('estado', ['disponible', 'apartado'])

    if (error) { console.error('[bot] ❌ Error DB:', error.message); return }
    if (!arreglos?.length) { console.log('[bot] ⚠️ No hay arreglos disponibles.'); return }

    const quitarEmojis = (s: string) => s.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}]/gu, '').trim()
    const norm     = (s: string) => quitarEmojis(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const normProd = norm(prodSeguro)
    const normPals = normProd.split(/\s+/).filter(Boolean)

    let match: { id: string; nombre: string; precio: number; estado: string } | undefined
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
    const palabrasClave = normPals.filter(p => !['ramo', 'ramos', 'arreglo', 'arreglos', 'bouquet', 'flor', 'flores'].includes(p))
    if (!match && palabrasClave.length >= 2) {
      for (const a of arreglos) {
        const n = norm(a.nombre)
        const aciertos = palabrasClave.filter(p => n.includes(p))
        if (aciertos.length >= Math.ceil(palabrasClave.length * 0.75)) { match = a; break }
      }
    }

    if (match) {
      if (match.estado !== 'apartado') {
        const { error: updateError } = await supabaseAdmin
          .from('arreglos_diarios').update({ estado: 'apartado' }).eq('id', match.id)
        if (updateError) throw updateError
      }
      console.log(`[bot] 📦 "${match.nombre}" → apartado`)
      enviarAlertaArregloApartado(match.nombre, match.precio, numeroCliente)
        .catch(err => console.error('[bot] Telegram apartado:', err))
    } else {
      console.warn(`[bot] ⚠️ Sin match para "${prodSeguro}". Disponibles:`, arreglos.map(a => a.nombre).join(', '))
    }
  } catch (err) { console.error('[bot] Error apartando:', err) }
}

async function enviarFotosArreglos(client: Client, chatId: string, arreglos: ArregloConFoto[]): Promise<number> {
  if (!arreglos.length) return 0

  const resultados = await Promise.all(
    arreglos.map(a =>
      MessageMedia.fromUrl(a.foto_url, { unsafeMime: true })
        .then(media => ({ ok: true as const, media, arreglo: a }))
        .catch(() => ({ ok: false as const, arreglo: a }))
    )
  )

  let enviadas = 0
  for (const r of resultados) {
    if (FOTOS_CANCELADAS.has(chatId)) {
      console.log(`[bot] 🛑 Envío de fotos cancelado por cliente: ${chatId}`)
      break
    }
    if (!r.ok) continue
    try {
      const caption =
        `💐 *${r.arreglo.nombre}*\n💰 $${r.arreglo.precio.toFixed(2)} MXN` +
        (r.arreglo.descripcion ? `\n📝 ${r.arreglo.descripcion}` : '')
      await client.sendMessage(chatId, r.media, { caption })
      enviadas++
      await new Promise(res => setTimeout(res, 200))
    } catch (err) {
      const errStr = String(err)
      if (errStr.includes('Execution context was destroyed') || errStr.includes('Target closed')) {
        console.warn(`[bot] ⚠️ Recarga durante envío de fotos a ${chatId}. Abortando lote.`)
        break
      }
      console.error(`[bot] Error enviando "${r.arreglo.nombre}":`, err)
    }
  }

  return enviadas
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
            ARREGLO_ELEGIDO.set(clienteId, match)
            pedidoActual(clienteId).arreglo = match
            console.log(`[bot] 📸 Cliente respondió a foto de "${match.nombre}"`)
          }
        }
      } catch { /* ignorar si falla getQuotedMessage */ }
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

    let   arreglosParaEnviar: ArregloConFoto[] = []
    let   enviarFotos   = false

    if (intencion === 'inventario') {
      const arreglos = await obtenerArreglosConFotos()
      if (arreglos.length > 0) {
        if (!puedeEnviarFotos(clienteId)) {
          const avisoLimite = 'Ya te reenvié las fotos varias veces hoy 🌸. Dime cuál arreglo quieres ver o cuál te gustó y te confirmo precio.'
          await agregarAlHistorial(telefono, 'assistant', avisoLimite)
          await message.reply(avisoLimite)
          return
        }

        const respuestaFotos = '¡Claro! Ahorita te mando las fotos de lo que tenemos disponible hoy 🌸'
        await agregarAlHistorial(telefono, 'assistant', respuestaFotos)
        await simularEscritura(chat, 900)
        await message.reply(respuestaFotos)

        FOTOS_CANCELADAS.delete(clienteId)
        FOTOS_ENVIANDO.add(clienteId)
        const fotosEnviadas = await enviarFotosArreglos(whatsappClient, clienteId, arreglos)
          .finally(() => FOTOS_ENVIANDO.delete(clienteId))
        if (fotosEnviadas > 0) {
          marcarFotosEnviadas(clienteId)
          ULTIMOS_ARREGLOS.set(clienteId, arreglos)
        }
        FOTOS_PENDIENTES.delete(clienteId)

        const resumenFotos = arreglos.map((a, i) => `Foto ${i + 1}: ${a.nombre} ($${a.precio} MXN)`).join(', ')
        if (fotosEnviadas > 0) {
          await agregarAlHistorial(telefono, 'assistant', `[Sistema] Fotos enviadas: ${resumenFotos}`)
        }
        const cta = fotosEnviadas > 0
          ? '¿Alguno te llamó la atención? 🌸\nSolo dime cuál y lo aparto para ti. 🌹'
          : 'Perdón, se me atoraron las fotos ahorita 😅 Dime si quieres que intentemos de nuevo o te paso nombres y precios.'
        await whatsappClient.sendMessage(clienteId, cta)
        await agregarAlHistorial(telefono, 'assistant', cta)
        return
      }

      contextoExtra += `\n\nHoy NO hay arreglos listos. Ofrece pedido personalizado 24-48h. Máximo 2 líneas.`
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
      const pareceDireccion = /\b(calle|av\.?|avenida|col\.?|colonia|num\.?|n[uú]mero|#|cp\s*\d{5}|\d{2,})\b/i.test(textoCliente)
      if (pareceDireccion && ARREGLO_ELEGIDO.has(clienteId)) pedidoActual(clienteId).direccion = limpiarDireccionCliente(textoCliente)
      if (envioMatch && 'ambiguo' in envioMatch) {
        const numeroRealTmp = await numeroRealPromise.catch(() => null)
        const candidatosTxt = envioMatch.candidatos.map(c => `${c.zona} ($${c.precio})`).join(', ')
        registrarZonaAmbigua(textoCliente, numeroRealTmp, envioMatch.candidatos).catch(() => {})
        if (numeroRealTmp) enviarAlertaZonaAmbigua(numeroRealTmp, textoCliente, candidatosTxt).catch(err => console.error('[bot] Telegram zona ambigua:', err))
        contextoExtra +=
          `\n\n[ZONA DE ENVIO AMBIGUA] El texto "${textoCliente}" coincide con varias zonas o no es suficiente. ` +
          `INSTRUCCION: NO des precio. Pide colonia, municipio completo, codigo postal o direccion completa.`
      } else if (envioMatch) {
        pedidoActual(clienteId).envio = { zona: envioMatch.zona, precio: envioMatch.precio }
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

    // ── CANCELACIÓN ─────────────────────────────────────────────
    if (detectarCancelacion(textoCliente)) {
      contextoExtra +=
        `\n\n[CLIENTE QUIERE CANCELAR UN PEDIDO]` +
        `\nINSTRUCCION: Responde con empatía. Di que notificarás al equipo. ` +
        `NO prometas reembolsos ni descuentos. El sistema notificará automáticamente al administrador.`
    }

    // ── QUEJA / RECLAMO ─────────────────────────────────────────
    if (detectarQueja(textoCliente)) {
      contextoExtra +=
        `\n\n[CLIENTE REPORTA UN PROBLEMA]` +
        `\nINSTRUCCION: Discúlpate sinceramente UNA vez. Di que reportarás al equipo inmediatamente. ` +
        `NO ofrezcas compensaciones ni descuentos sin autorización. El sistema notificará al administrador.`
    }

    // ── EVENTOS ESPECIALES ─────────────────────────────────────
    const eventoDetectado = detectarEvento(textoCliente)
    if (eventoDetectado) {
      const guias: Record<string, string> = {
        'boda': 'Sugiere: arreglos elegantes, colores coordinados con la temática. Podemos trabajar con anticipación.',
        'casamiento': 'Sugiere: arreglos elegantes, colores coordinados con la temática.',
        'xv': 'Sugiere: arreglos llamativos y coloridos, ideales para celebración.',
        'quinceañera': 'Sugiere: arreglos llamativos y coloridos, ideales para celebración.',
        'funeral': 'Sugiere: arreglos sobrios y elegantes, tonos blancos y verdes.',
        'velorio': 'Sugiere: arreglos sobrios y elegantes, tonos blancos y verdes.',
        'aniversario': 'Sugiere: flores con significado especial, preguntar por flor favorita.',
        'graduación': 'Sugiere: arreglos vibrantes y modernos para celebrar el logro.',
        'baby shower': 'Sugiere: arreglos tiernos y pasteles, ideales para recibir al bebé.',
        'san valentín': 'Sugiere: arreglos románticos con rosas rojas, colores pasión.',
        'madres': 'Sugiere: arreglos coloridos y alegres, ideales para consentir a mamá.',
      }
      const guia = Object.entries(guias).find(([k]) => eventoDetectado.includes(k))?.[1] || 'Sugiere arreglos acordes al evento.'
      contextoExtra +=
        `\n\n[CLIENTE MENCIONÓ UN EVENTO ESPECIAL: "${eventoDetectado}"]` +
        `\nINSTRUCCION: ${guia} Pregunta por colores o estilo que busca. Máximo 3 líneas.`
    }

    // ── Cliente con venta ya cerrada ─────────────────────────────
    if (VENTAS_CERRADAS.has(clienteId)) {
      const venta = VENTA_ACTUAL.get(clienteId)
      const detalleVenta = venta
        ? `Pedido actual: ${venta.producto}, total ${venta.total}, entrega ${venta.direccion}. `
        : ''
      contextoExtra +=
        `\n\n[VENTA YA CERRADA PARA ESTE CLIENTE] ${detalleVenta}El usuario ya completó su compra. ` +
        `Atiende dudas post-venta (seguimiento, quejas, cambios) pero NO ofrezcas nuevos arreglos ni preguntes "cuál te gustó". ` +
        `Si pide foto de entrega o comprobante de entrega, responde: "Claro, se lo comento al equipo/repartidor para que puedan apoyarte con eso 🌸". ` +
        `No digas que no puedes coordinarlo. No lo prometas como garantía. ` +
        `Si quiere cancelar o reporta problema, NO le pidas nombre/precio si ya aparece en el pedido actual; di que notificarás al equipo.`
      enviarFotos = false // no enviar fotos nuevas
    }

    // Detectar si el usuario está eligiendo un arreglo de la lista mostrada
    const ultimosArreglos = ULTIMOS_ARREGLOS.get(clienteId)
    if (ultimosArreglos?.length && textoCliente.length < 200) {
      const esEleccion = /me gust[oó]|quiero|ese|este|esye|eate|el[^a-zA-Z]|prefiero|me llevo|aparta|reply/i.test(textoCliente)
      const ordinalFoto = textoCliente.match(/(?:foto\s*)?\b([1-7])\b|(?:primer[ao]?|segunda|tercer[ao]?|cuart[ao]|quint[ao]|sext[ao]|septim[ao])\s+foto/i)?.[0]?.toLowerCase() ?? ''
      const indiceOrdinal = ordinalFoto.includes('1') || ordinalFoto.includes('primer') ? 0
        : ordinalFoto.includes('2') || ordinalFoto.includes('segunda') ? 1
        : ordinalFoto.includes('3') || ordinalFoto.includes('tercer') ? 2
        : ordinalFoto.includes('4') || ordinalFoto.includes('cuart') ? 3
        : ordinalFoto.includes('5') || ordinalFoto.includes('quint') ? 4
        : ordinalFoto.includes('6') || ordinalFoto.includes('sext') ? 5
        : ordinalFoto.includes('7') || ordinalFoto.includes('sept') ? 6
        : -1
      const matchPorFoto = indiceOrdinal >= 0 && ultimosArreglos[indiceOrdinal]
        ? { arreglo: ultimosArreglos[indiceOrdinal], score: 999 }
        : null
      const match = matchPorFoto ?? encontrarMejorCoincidencia(textoCliente, ultimosArreglos)
      const eleccionAmbigua = esEleccion && !match && !arregloReferenciado && !message.hasQuotedMsg
      if (eleccionAmbigua) {
        const nombres = ultimosArreglos.map(a => `- ${a.nombre}: $${a.precio.toFixed(2)} MXN`).join('\n')
        const aviso = `¿Me confirmas el nombre del arreglo que elegiste? 🌸\nTambién puedes responder directo a la foto.\n\n${nombres}`
        await agregarAlHistorial(telefono, 'assistant', aviso)
        await message.reply(aviso)
        return
      }
      if (match || esEleccion) {
        const lista = ultimosArreglos.map((a, i) => `"${a.nombre}" — $${a.precio} MXN`).join(' | ')
        let instruccion = `\n\n[ARREGLOS MOSTRADOS: ${lista}]`
        if (match && match.score >= 2) {
          ARREGLO_ELEGIDO.set(clienteId, match.arreglo)
          pedidoActual(clienteId).arreglo = match.arreglo
          instruccion += `\n[CLIENTE ELIGIÓ: "${match.arreglo.nombre}" — $${match.arreglo.precio} MXN (coincidencia exacta)]`
        } else if (match) {
          ARREGLO_ELEGIDO.set(clienteId, match.arreglo)
          pedidoActual(clienteId).arreglo = match.arreglo
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
    const KW_CONFIRMA_PAGO = /ya pague|ya pagué|listo|comprobante|ya quedó|ya quedo|ya lo hice|ya la hice|ya la hizo|ya.*dep[oó]sito|hice.*dep[oó]sito|dep[oó]sito.*hecho|ya transfer[ií]|transfer[ií]|ya lo envi[eé]|ya lo mande|ya lo mand[eé]|ya llegó|ya llego|sipi|si ya|confirmo|confirmado|ya esta pagado/i.test(textoCliente)
    const consultaPagoEnviado = /le lleg[oó]|si lleg[oó]|sí lleg[oó]|recibieron|recibiste|dep[oó]sito|transfer/i.test(textoCliente)
    const pagoAlRecoger = /pago\s+al\s+recog?er|pagar[eé]?\s+al\s+recog?er|efectivo\s+al\s+recog?er|al\s+recog?er\s+gracias/i.test(textoCliente)
    const pagoTransferencia = /transfer|tranfer|tranferencia|transferencia|dep[oó]sito|bbva/i.test(textoCliente)

    if (/\bcentro\b/i.test(textoCliente) && /sucursal|ubicaci[oó]n|recog|ursal/i.test(textoCliente)) pedidoActual(clienteId).sucursal = 'Centro'
    if (/\bnorte\b/i.test(textoCliente) && /sucursal|ubicaci[oó]n|recog|ursal/i.test(textoCliente)) pedidoActual(clienteId).sucursal = 'Norte'
    if (pagoAlRecoger) pedidoActual(clienteId).metodoPago = 'efectivo_recoger'
    if (pagoTransferencia) pedidoActual(clienteId).metodoPago = 'transferencia'

    const notaMatch = textoCliente.match(/(?:notita|nota).*?(?:diga|decir|ponerle|poner)\s+(.+)/i)
    if (notaMatch && ARREGLO_ELEGIDO.has(clienteId)) pedidoActual(clienteId).nota = notaMatch[1].trim().slice(0, 500)

    const nombreMatch = textoCliente.match(/(?:a\s+nombre\s+de|nombre\s+de|a\s+)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,5})/i)
      ?? textoCliente.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,5})\b(?=.*\b(entregar|entrega|apart|nombre|4\s*pm|[0-9]{1,2}\s*(?:am|pm)))/)
    if (nombreMatch && ARREGLO_ELEGIDO.has(clienteId)) {
      pedidoActual(clienteId).nombre = nombreMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase())
    }

    if (KW_PAGO && intencion === 'normal') {
      contextoExtra +=
        `\n\n[CONTEXTO DE PAGO] El usuario está respondiendo sobre pago o confirmación. ` +
        `Revisa el historial. Si el usuario YA CONFIRMÓ el pago (dijo "ya pague", "listo", "comprobante", "transfer"): ` +
        `AGRADECE el pago, confirma que el pedido queda apartado y CIERRA con el token. ` +
        `NO le pidas más confirmación ni le digas "déjame revisar". ` +
        `El token [VENTA_CERRADA:...] debe ir AL FINAL de tu mensaje.`
    }

    if (pagoAlRecoger) {
      contextoExtra +=
        `\n\n[PAGO AL RECOGER] El cliente pagará en efectivo al recoger. ` +
        `NO generes token [VENTA_CERRADA]. Solo confirma apartado, sucursal, nombre y resumen. ` +
        `No lo reportes como venta pagada todavía.`
    }

    if (consultaPagoEnviado && ARREGLO_ELEGIDO.has(clienteId)) {
      contextoExtra +=
        `\n\n[CLIENTE HABLA DE PAGO YA ENVIADO/RECIBIDO] ` +
        `No reinicies la venta, no preguntes de nuevo cuál arreglo quiere y no digas que no compartió datos. ` +
        `Si pregunta si llegó el depósito, responde que lo reportas al equipo para verificarlo. ` +
        `Si afirma que ya pagó o ya hizo depósito, agradece y cierra la venta con el token usando el pedido en curso.`
    }

    if (/transferencia|tranferencia|transfer/i.test(textoCliente) && /a nombre de|nombre de/i.test(textoCliente) && !KW_CONFIRMA_PAGO) {
      contextoExtra +=
        `\n\n[CLIENTE DIO NOMBRE Y ELIGIÓ TRANSFERENCIA] ` +
        `INSTRUCCION: NO vuelvas a preguntar el nombre. NO digas "gracias por el pago" todavía. ` +
        `Comparte la cuenta BBVA y pide que mande el comprobante cuando quede listo.`
    }

    const pedido = PEDIDO_EN_CURSO.get(clienteId)
    if (pedido?.arreglo) {
      const totalPedido = pedido.arreglo.precio + (pedido.envio?.precio ?? 0)
      contextoExtra +=
        `\n\n[PEDIDO EN CURSO VERIFICADO POR SISTEMA] ` +
        `Producto elegido: "${pedido.arreglo.nombre}" — $${pedido.arreglo.precio.toFixed(2)} MXN. ` +
        `${pedido.envio ? `Envío: ${pedido.envio.zona} — $${pedido.envio.precio.toFixed(2)} MXN. ` : ''}` +
        `Total actual: $${totalPedido.toFixed(2)} MXN. ` +
        `${pedido.nombre ? `Nombre: ${pedido.nombre}. ` : ''}` +
        `NO cambies el producto por otro del historial. Si cierras venta, usa exactamente estos datos. ` +
        `${pedido.envio ? 'Como es ENVIO A DOMICILIO, el pago debe ser por transferencia antes de preparar/enviar. NO ofrezcas efectivo al recibir ni efectivo al recoger. ' : ''}`
    }

    await chat.sendStateTyping()
    const historialAI = await obtenerHistorial(telefono)
    const { mensaje, ventaCerrada } = await getAIResponse(historialAI, contextoExtra)
    await chat.clearState()

    // ── Validación post-AI de precios ─────────────────────────────
    const arreglosAI = await obtenerArreglosConFotos()
    if (arreglosAI.length > 0) {
      const validacion = validarPreciosEnRespuesta(mensaje, arreglosAI)
      if (!validacion.valido) {
        console.warn(`[bot] ⚠️ ${validacion.advertencia}`)
      }
    }

    await agregarAlHistorial(telefono, 'assistant', mensaje)

    const mensajeFinal = limpiarRespuestaIA(mensaje)
    await simularEscritura(chat, calcularDelayEscritura(mensajeFinal))
    try {
      await message.reply(mensajeFinal)
    } catch (sendErr) {
      console.warn(`[bot] ⚠️ message.reply falló, intentando chat.sendMessage:`, (sendErr as Error)?.message?.slice(0, 80))
      try {
        await chat.sendMessage(mensajeFinal)
      } catch (chatSendErr) {
        console.warn(`[bot] ⚠️ chat.sendMessage también falló:`, (chatSendErr as Error)?.message?.slice(0, 80))
      }
    }

    const numeroReal = await numeroRealPromise
    if (tieneArregloVerificado(clienteId)) {
      persistirPedido(clienteId, numeroReal, VENTAS_CERRADAS.has(clienteId) ? 'pagado' : 'cotizacion', textoCliente).catch(() => {})
    }

    if (motivoAtencionHumana && debeNotificarAtencionHumana(clienteId)) {
      const contexto = historialCompleto
        .slice(-5)
        .map(m => `${m.role === 'user' ? 'Cliente' : 'Flora'}: ${m.content}`)
        .concat(`Cliente: ${textoCliente}`)
        .join('\n')
      enviarAlertaAtencionHumana(numeroReal, motivoAtencionHumana, contexto)
        .catch(err => console.error('[bot] Telegram atención humana:', err))
    }

    // Alerta cotización de envío
    if (mensajeFinal.toLowerCase().includes('verificar el costo') && /\b(calle|av\.?|avenida|col\.?|colonia|cp\s*\d{5}|\d{2,})\b/i.test(textoCliente)) {
      enviarAlertaCotizacion(numeroReal, `📍 Cotización de envío solicitada.\nDirección/colonia: ${textoCliente}`)
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

    // ── CANCELACIÓN: Alerta al admin ────────────────────────────
    if (detectarCancelacion(textoCliente)) {
      console.log(`[bot] 🚫 Cancelación solicitada por ${numeroReal}`)
      enviarAlertaCancelacion(numeroReal, textoCliente)
        .catch(err => console.error('[bot] Telegram cancelación:', err))
    }

    // ── QUEJA: Alerta al admin ──────────────────────────────────
    if (detectarQueja(textoCliente)) {
      console.log(`[bot] ⚠️ Queja reportada por ${numeroReal}`)
      enviarAlertaQueja(numeroReal, textoCliente)
        .catch(err => console.error('[bot] Telegram queja:', err))
    }

    // Venta cerrada
    if (ventaCerrada) {
      if (VENTAS_CERRADAS.has(clienteId)) {
        console.warn(`[bot] ⚠️ Token venta cerrada duplicado ignorado para ${clienteId}`)
        return
      }
      if (!tieneArregloVerificado(clienteId)) {
        console.warn(`[bot] ⚠️ Token venta cerrada ignorado: no hay arreglo verificado para ${clienteId}`)
        return
      }
      const ventaVerificada = ventaDesdeEstado(clienteId, ventaCerrada) ?? ventaCerrada
      console.log(`[bot] 🎉 VENTA CERRADA: ${ventaVerificada.cliente} | ${numeroReal}`)
      const esPagoAlRecoger = PEDIDO_EN_CURSO.get(clienteId)?.metodoPago === 'efectivo_recoger'
      if (!esPagoAlRecoger) {
        const pedido = PEDIDO_EN_CURSO.get(clienteId)
        const arreglo = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
        enviarAlertaVentaCerrada({
          cliente: ventaVerificada.cliente, producto: ventaVerificada.producto,
          total: ventaVerificada.total, direccion: ventaVerificada.direccion,
          numeroCliente: numeroReal,
          precioArreglo: arreglo ? `$${arreglo.precio.toFixed(2)} MXN` : undefined,
          precioEnvio: pedido?.envio ? `$${pedido.envio.precio.toFixed(2)} MXN (${pedido.envio.zona})` : undefined,
          metodoPago: pedido?.metodoPago ?? 'transferencia',
        }).catch(err => console.error('[bot] Telegram venta:', err))
        registrarVenta(ventaVerificada.cliente, numeroReal, ventaVerificada.producto, ventaVerificada.total, ventaVerificada.direccion)
          .catch(err => console.error('[bot] Error registrando venta:', err))
        persistirPedido(clienteId, numeroReal, 'pagado', textoCliente).catch(() => {})
      } else {
        console.warn('[bot] Venta token ignorado como venta pagada: pago al recoger')
        const pedido = PEDIDO_EN_CURSO.get(clienteId)
        const arreglo = pedido?.arreglo ?? ARREGLO_ELEGIDO.get(clienteId)
        if (arreglo) {
          enviarAlertaPedidoApartado({
            cliente: ventaVerificada.cliente,
            producto: ventaVerificada.producto,
            precioArreglo: `$${arreglo.precio.toFixed(2)} MXN`,
            total: `$${arreglo.precio.toFixed(2)} MXN`,
            entrega: ventaVerificada.direccion,
            metodoPago: 'Efectivo/tarjeta al recoger',
            numeroCliente: numeroReal,
          }).catch(err => console.error('[bot] Telegram apartado pedido:', err))
        }
        persistirPedido(clienteId, numeroReal, 'apartado', textoCliente).catch(() => {})
      }
      apartarArreglo(ventaVerificada.producto, numeroReal)
        .catch(err => console.error('[bot] Error apartando:', err))
      VENTAS_CERRADAS.add(clienteId)
      VENTA_ACTUAL.set(clienteId, ventaVerificada)
      FOTOS_PENDIENTES.delete(clienteId) // limpiar fotos pendientes
    }

    // Fallback: si el cliente confirmó pago pero la IA no generó el token
    if (!ventaCerrada && !VENTAS_CERRADAS.has(clienteId) && KW_CONFIRMA_PAGO && (ARREGLO_ELEGIDO.has(clienteId) || (mensajeFinal.length < 150 && !mensajeFinal.includes('?')))) {
      const ventaVerificada = ventaDesdeEstado(clienteId)
      const ultimos = ULTIMOS_ARREGLOS.get(clienteId)
      const elegido = ARREGLO_ELEGIDO.get(clienteId)
      const nombreArreglo = ventaVerificada?.producto ?? elegido?.nombre ?? ultimos?.[0]?.nombre ?? 'Pedido'
      const totalArreglo = ventaVerificada?.total ?? `$${(elegido?.precio ?? ultimos?.[0]?.precio ?? 0).toFixed(2)} MXN`
      const clienteVenta = ventaVerificada?.cliente ?? 'Verificar en chat'
      const direccionVenta = ventaVerificada?.direccion ?? 'Por confirmar'
      const pedido = PEDIDO_EN_CURSO.get(clienteId)
      console.log(`[bot] ⚠️ Cliente confirmó pago pero IA no generó token. Notificando igual.`)
      enviarAlertaVentaCerrada({
        cliente: clienteVenta,
        producto: nombreArreglo,
        total: totalArreglo,
        direccion: direccionVenta,
        numeroCliente: numeroReal,
        precioArreglo: elegido ? `$${elegido.precio.toFixed(2)} MXN` : undefined,
        precioEnvio: pedido?.envio ? `$${pedido.envio.precio.toFixed(2)} MXN (${pedido.envio.zona})` : undefined,
        metodoPago: pedido?.metodoPago ?? 'transferencia',
      }).catch(err => console.error('[bot] Telegram venta fallback:', err))
      apartarArreglo(nombreArreglo, numeroReal)
        .catch(err => console.error('[bot] Error apartando fallback:', err))
      registrarVenta(clienteVenta, numeroReal, nombreArreglo, totalArreglo, direccionVenta)
        .catch(err => console.error('[bot] Error registrando venta fallback:', err))
      VENTAS_CERRADAS.add(clienteId)
      persistirPedido(clienteId, numeroReal, 'pagado', textoCliente).catch(() => {})
      VENTA_ACTUAL.set(clienteId, {
        cliente: clienteVenta,
        producto: nombreArreglo,
        total: totalArreglo,
        direccion: direccionVenta,
        rawToken: '',
      })
    }

    // Detectar "venta cerrada" explícito del usuario/humano
    if (/venta\s*cerrada|venta.*cerrada|sale.*closed|closed.*sale/i.test(textoCliente)) {
      console.log(`[bot] 🚨 Usuario indicó venta cerrada manualmente: ${numeroReal}`)
      const ventaVerificada = ventaDesdeEstado(clienteId)
      const ultimos = ULTIMOS_ARREGLOS.get(clienteId)
      const elegido = ARREGLO_ELEGIDO.get(clienteId)
      const nombreArreglo = ventaVerificada?.producto ?? elegido?.nombre ?? ultimos?.[0]?.nombre ?? 'Pedido'
      const totalVenta = ventaVerificada?.total ?? `$${(elegido?.precio ?? ultimos?.[0]?.precio ?? 0).toFixed(2)} MXN`
      const direccionVenta = ventaVerificada?.direccion ?? 'Verificar en chat'
      const clienteVenta = ventaVerificada?.cliente ?? 'Manual'
      enviarAlertaVentaCerrada({
        cliente: clienteVenta,
        producto: nombreArreglo,
        total: totalVenta,
        direccion: direccionVenta,
        numeroCliente: numeroReal,
      }).catch(err => console.error('[bot] Telegram venta manual:', err))
      apartarArreglo(nombreArreglo, numeroReal)
        .catch(err => console.error('[bot] Error apartando manual:', err))
      VENTAS_CERRADAS.add(clienteId)
      VENTA_ACTUAL.set(clienteId, {
        cliente: clienteVenta,
        producto: nombreArreglo,
        total: totalVenta,
        direccion: direccionVenta,
        rawToken: '',
      })
      FOTOS_PENDIENTES.delete(clienteId)
      registrarVenta(clienteVenta, numeroReal, nombreArreglo, totalVenta, direccionVenta)
        .catch(err => console.error('[bot] Error registrando venta manual:', err))
    }

    // Fotos — desde intent detection o desde FOTOS_PENDIENTES
    const fotosPendientes = VENTAS_CERRADAS.has(clienteId) ? undefined : FOTOS_PENDIENTES.get(clienteId)
    const arreglosFinales = arreglosParaEnviar.length > 0 ? arreglosParaEnviar : (fotosPendientes?.arreglos ?? [])

    if (enviarFotos || (intencion === 'inventario' && fotosPendientes)) {
      if (!puedeEnviarFotos(clienteId)) {
        FOTOS_PENDIENTES.delete(clienteId)
        const avisoLimite = 'Ya te reenvié las fotos varias veces hoy 🌸. Dime cuál te interesa y te ayudo con el apartado.'
        await agregarAlHistorial(telefono, 'assistant', avisoLimite)
        await message.reply(avisoLimite)
        return
      }
      FOTOS_PENDIENTES.delete(clienteId)

      if (arreglosFinales.length > 0) {
        await new Promise(r => setTimeout(r, 500))
        FOTOS_CANCELADAS.delete(clienteId)
        FOTOS_ENVIANDO.add(clienteId)
        const fotosEnviadas = await enviarFotosArreglos(whatsappClient, clienteId, arreglosFinales)
          .finally(() => FOTOS_ENVIANDO.delete(clienteId))
        if (fotosEnviadas > 0) marcarFotosEnviadas(clienteId)

        const resumenFotos = arreglosFinales.map((a, i) => `Foto ${i + 1}: ${a.nombre} ($${a.precio} MXN)`).join(', ')
        await agregarAlHistorial(telefono, 'assistant', `[Sistema] Fotos enviadas: ${resumenFotos}`)
        // Guardar lista para matching en próximos mensajes
        if (fotosEnviadas > 0) ULTIMOS_ARREGLOS.set(clienteId, arreglosFinales)

        await new Promise(r => setTimeout(r, 600))
        await simularEscritura(chat, 800)
        await whatsappClient.sendMessage(
          clienteId,
          fotosEnviadas > 0
            ? '¿Alguno te llamó la atención? 🌸\nSolo dime cuál y lo aparto para ti. 🌹'
            : 'Perdón, se me atoraron las fotos ahorita 😅 Dime si quieres que intentemos de nuevo o te paso nombres y precios.'
        )
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

    // FIX: Verificar que pupPage exista antes de getChats()
    if (!whatsappClient.pupPage) {
      console.log('[bot] ⚠️ Página de WhatsApp no disponible (pupPage undefined). Omitiendo rescate.')
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
        const pendientes = mensajes
          .filter(msg => !msg.fromMe && msg.type === 'chat' && msg.body?.trim())
          .slice(-8)

        if (pendientes.length === 0) return

        const mensajeBase = pendientes[pendientes.length - 1] as any
        const textoAgrupado = pendientes
          .map(msg => String(msg.body).trim())
          .filter(Boolean)
          .join('\n')

        for (const msg of pendientes) {
          const msgId = obtenerMensajeId(msg)
          if (!msgId) continue
          MENSAJES_RESCATADOS.add(msgId)
          if (msg !== mensajeBase) marcarMensajeProcesado(msgId)
        }

        mensajeBase.body = textoAgrupado
        console.log(`[bot] ♻️ Inyectando ${pendientes.length} mensajes agrupados de ${chat.id._serialized}`)
        await manejarMensajeEntrante(mensajeBase)
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
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process',
  '--disk-cache-size=0', '--media-cache-size=0', '--disable-application-cache',
  '--disable-gpu', '--disable-gpu-sandbox', '--use-gl=swiftshader',
  '--disable-accelerated-2d-canvas',
  '--disable-software-rasterizer', '--disable-extensions', '--disable-plugins',
  '--disable-default-apps', '--disable-sync', '--disable-background-networking',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-ipc-flooding-protection',
  '--disable-notifications', '--disable-speech-api', '--disable-print-preview',
  '--mute-audio', '--disable-alsa', '--hide-scrollbars', '--disable-client-side-phishing-detection',
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
  qrMaxRetries:  20,
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
let BOT_QR_GENERADO_EN: number | null = null
const BOT_QR_TTL_MS = 60_000
const QR_SCAN_GRACE_MS = 15 * 60_000
let BOT_RECONNECTING = false
let WATCHDOG_INICIADO = false
let ULTIMA_RECARGA_WEB = 0
let CONTADOR_RECARGAS_WEB = 0
let PRIMERA_RECARGA_WEB = 0
const MAX_RECARGAS_WEB = 5 // si recarga >5 veces en 2min, forzamos reconexión
let BOT_ESTADO: 'iniciando' | 'esperando_qr' | 'conectado' | 'reconectando' | 'desconectado' | 'error' = 'iniciando'
let BOT_ESTADO_DETALLE = 'Arrancando bot'
let ULTIMO_COMANDO_BOT: string | null = null

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
  const estadoReal = BOT_READY && whatsappClient?.info && !!whatsappClient.pupPage ? 'conectado' : BOT_ESTADO
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

    if (comando.action === 'recover') {
      console.log('[bot] ♻️ Rescate remoto solicitado desde dashboard')
      recuperarMensajesPerdidos().catch(err => console.error('[bot] Error en rescate remoto:', err))
      return
    }

    if (comando.action === 'reconnect') {
      reiniciarProceso('Reinicio remoto desde dashboard', false)
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

async function reconectarWhatsapp(motivo: string): Promise<void> {
  if (BOT_RECONNECTING) {
    console.log(`[bot] Reconexión ya en curso (${motivo})`)
    return
  }

  BOT_RECONNECTING = true
  BOT_READY = false
  actualizarEstadoBot('reconectando', motivo)
  console.warn(`[bot] 🔄 Reconectando WhatsApp: ${motivo}`)

  try {
    await whatsappClient.destroy().catch(() => {})
    await new Promise(r => setTimeout(r, 5000))
    await whatsappClient.initialize()
  } catch (err) {
    BOT_RECONNECTING = false
    actualizarEstadoBot('error', 'Fallo reconectando WhatsApp')
    console.error('[bot] ❌ No se pudo reconectar — forzando reinicio:', err)
    registrarCrash()
    process.exit(1)
  }
}

whatsappClient.on('qr', async (qr) => {
  BOT_QR_EMITIDO = true
  BOT_QR_ACTUAL = qr
  BOT_QR_GENERADO_EN = Date.now()
  actualizarEstadoBot('esperando_qr', 'QR generado, esperando escaneo')
  console.log('\n📱 Subiendo nuevo QR a Supabase...')
  let qrGuardado = false
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
      qrGuardado = true
      break
    } catch (err) {
      console.error(`❌ Error QR Supabase (intento ${attempt + 1}/3):`, err)
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000))
    }
  }
  if (!qrGuardado) console.warn('⚠️ No se pudo guardar el QR en Supabase; se muestra solo en consola.')
  publicarEstadoBot().catch(err => console.warn('[bot] No se pudo publicar estado QR:', err))
  console.log('\n⚡ ¡NUEVO QR! Escanéalo ahora:')
  qrcode.generate(qr, { small: true })
  enviarAlertaQr()
})

whatsappClient.on('ready', async () => {
  BOT_READY = true
  BOT_RECONNECTING = false
  actualizarEstadoBot('conectado', 'WhatsApp conectado')
  publicarEstadoBot().catch(err => console.warn('[bot] No se pudo publicar estado ready:', err))
  console.log('\n✅ Bot de Jardín RoCe conectado!')
  console.log('🌸 Flora está escuchando...\n')
  ultimaActividad = Date.now()
  if (BOT_QR_EMITIDO) enviarAlertaReconectado()

  if (!WATCHDOG_INICIADO) setInterval(async () => {
    const minSinMensajes = Math.round((Date.now() - ultimaActividad) / 60_000)

    if (BOT_RECONNECTING || Date.now() - ULTIMA_RECARGA_WEB < 2 * 60_000) {
      console.log('[Watchdog] ⏳ Reconexión/recarga en curso — esperando...')
      return
    }

    try {
      const state = await whatsappClient.getState()

      if (state !== 'CONNECTED') {
        console.warn(`[Watchdog] ⚠️ Estado: ${state}. Esperando próximo ciclo antes de reconectar.`)
        ultimaActividad = Date.now()
        return
      }

      // ZOMBIE DETECTION: conectado pero sin mensajes por mucho tiempo en horario laboral.
      // En VM chica WhatsApp Web puede tardar en estabilizarse; 15 min era demasiado agresivo.
      if (minSinMensajes >= 45 && estaEnHorario()) {
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
      if (BOT_RECONNECTING || Date.now() - ULTIMA_RECARGA_WEB < 2 * 60_000) {
        console.warn('[Watchdog] getState falló durante recarga; no se reinicia proceso.')
        return
      }
      if (minSinMensajes >= 5) {
        console.error('[Watchdog] Error crítico en getState — forzando reinicio:', err)
        registrarCrash()
        process.exit(1)
      }
    }
  }, 5 * 60_000)
  WATCHDOG_INICIADO = true

  BOT_QR_ACTUAL = null
  BOT_QR_GENERADO_EN = null
  try {
    await supabaseAdmin.from('configuracion_agente').update({ qr_code: null }).eq('id', 1)
  } catch (err) { console.error('[bot] Error limpiando QR:', err) }

  // 👇 FIX MÁGICO: Ejecutar el rescate de mensajes justo al arrancar en limpio
  recuperarMensajesPerdidos().catch(err => console.error('[bot] Error recuperando:', err))

  try {
    const page = whatsappClient.pupPage
    if (page) {
      page.removeAllListeners('framenavigated')
      page.on('framenavigated', (frame: any) => {
        if (frame !== page.mainFrame() || BOT_RECONNECTING) return
        ULTIMA_RECARGA_WEB = Date.now()
        const ahora = Date.now()
        if (ahora - PRIMERA_RECARGA_WEB > 120_000) {
          CONTADOR_RECARGAS_WEB = 0
          PRIMERA_RECARGA_WEB = ahora
        }
        CONTADOR_RECARGAS_WEB++
        console.warn(`[bot] 🔄 WhatsApp Web navegó/recargó (${CONTADOR_RECARGAS_WEB}/${MAX_RECARGAS_WEB})`)
        if (CONTADOR_RECARGAS_WEB >= MAX_RECARGAS_WEB) {
          console.error(`[bot] 🔄 Demasiadas recargas (${CONTADOR_RECARGAS_WEB}) — forzando reconexión`)
          CONTADOR_RECARGAS_WEB = 0
          reconectarWhatsapp('Demasiadas recargas de WhatsApp Web').catch(console.error)
        }
      })
    }
  } catch (err) { console.warn('[bot] No se pudo registrar framenavigated:', err) }
})

whatsappClient.on('auth_failure', (msg) => { console.error('❌ Auth:', msg); registrarCrash(); process.exit(1) })

whatsappClient.on('disconnected', (reason) => {
  console.warn('⚠️ Desconectado:', reason)
  BOT_READY = false
  actualizarEstadoBot('desconectado', String(reason || 'WhatsApp desconectado'))
  publicarEstadoBot().catch(err => console.warn('[bot] No se pudo publicar estado disconnected:', err))
  if (String(reason).toLowerCase().includes('max qrcode retries reached')) {
    reiniciarProceso('WhatsApp agotó los intentos de QR sin escaneo')
  }
  setTimeout(() => { reconectarWhatsapp(`evento disconnected: ${reason}`).catch(console.error) }, 5000)
})

async function manejarMensajeEntrante(message: any): Promise<void> {
  registrarActividad()
  console.log(`[DIAG] from: ${message.from} | type: ${message.type} | fromMe: ${message.fromMe}`)

  if (message.isGroupMsg) return
  if (!message.from || message.from === 'status@broadcast') return
  if (message.from.includes('@lid') && !message.body?.trim()) return
  if (!message.fromMe && yaProcesadoRecientemente(message)) {
    console.log(`[bot] ↩️ Mensaje duplicado ignorado: ${obtenerMensajeId(message)}`)
    return
  }

  // Ignorar números silenciados (repartidor, admin, etc.)
  const ignorados = await cargarIgnorados()
  const numeroParaIgnorar = message.from.includes('@lid')
    ? await obtenerNumeroReal(message)
    : message.from.replace(/@[^\s]*/g, '')
  const variantesMensaje = variantesTelefono(numeroParaIgnorar)
  if (!message.fromMe && variantesMensaje.some(n => ignorados.includes(n))) {
    console.log(`[bot] 🔇 Número ignorado: ${numeroParaIgnorar}`)
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
  if (/ya no quiero fotos|no quiero fotos|sin fotos/i.test(message.body.trim())) {
    FOTOS_CANCELADAS.add(clienteId)
    FOTOS_PENDIENTES.delete(clienteId)
  }
  if (FOTOS_ENVIANDO.has(clienteId) && /^(gracias|graciass+|ok|va|espero|espero su mensaje)$/i.test(message.body.trim())) {
    console.log(`[bot] 🖼️ Ignorando cortesía mientras se envían fotos: ${clienteId}`)
    return
  }
  if (estaRateLimited(clienteId)) { avisarRateLimitUnaVez(message, clienteId); return }

  verificarSiBotPausado().then(pausado => {
    if (pausado) { console.log(`[bot] ⏸️ Pausado — ${clienteId} ignorado`); return }
    encolarMensajeAgrupado(clienteId, message)
  }).catch(() => encolarMensajeAgrupado(clienteId, message))
}

whatsappClient.on('message_create', manejarMensajeEntrante)

setInterval(() => {
  publicarEstadoBot().catch(err => console.warn('[bot] No se pudo publicar estado remoto:', err))
}, 15_000).unref()

setInterval(() => {
  revisarComandoRemoto().catch(err => console.warn('[bot] Error revisando comando remoto:', err))
}, 5_000).unref()

// ════════════════════════════════════════════════════════════════
// ARRANQUE
// ════════════════════════════════════════════════════════════════

console.log('🌸 Iniciando bot de Jardín RoCe...')

// ── Startup Watchdog: en VM chica Chrome/WhatsApp puede tardar varios minutos ──
// Si hay QR, damos margen para escanear; si expira, reiniciamos para generar uno fresco.
const BOT_START_TIME = Date.now()
const STARTUP_WARN_SECONDS = 180
const STARTUP_RESTART_SECONDS = 600
let BOT_READY = false

const startupWatchdog = setInterval(() => {
  const elapsed = Math.round((Date.now() - BOT_START_TIME) / 1000)
  if (BOT_READY) { clearInterval(startupWatchdog); return }

  // Si ya salió QR, esperamos un tiempo razonable a que el usuario escanee.
  if (BOT_QR_EMITIDO) {
    const qrAgeMs = BOT_QR_GENERADO_EN ? Date.now() - BOT_QR_GENERADO_EN : Date.now() - BOT_START_TIME
    if (elapsed % 120 < 31) console.log(`[Startup] ⏳ Esperando escaneo QR... (${Math.round(elapsed / 60)} min)`)
    if (qrAgeMs > QR_SCAN_GRACE_MS) {
      reiniciarProceso(`QR sin escanear por ${Math.round(qrAgeMs / 60_000)} min`)
    }
    return
  }

  if (elapsed > STARTUP_WARN_SECONDS && elapsed % 60 < 31) {
    console.warn(`[Startup] ⏰ ${elapsed}s sin "ready". Verificando estado...`)
    whatsappClient.getState()
      .then(state => console.warn(`[Startup] Estado: ${state}`))
      .catch(err => console.warn(`[Startup] Error getState:`, err))
  }

  if (elapsed > STARTUP_RESTART_SECONDS) {
    // Forzar reconexión completa
    clearInterval(startupWatchdog)
    reiniciarProceso(`${elapsed}s sin "ready" ni QR`)
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

app.post('/reconnect', (_req, res) => {
  console.warn('[bot] 🔄 Reinicio manual solicitado vía API')
  res.json({ ok: true, mensaje: 'Reinicio solicitado. El proceso volverá a levantar con systemd.' })
  setTimeout(() => reiniciarProceso('Reinicio manual desde dashboard', false), 500)
})

app.post('/recover', (_req, res) => {
  console.log('[bot] ♻️ Rescate manual solicitado vía API')
  recuperarMensajesPerdidos()
    .then(() => console.log('[bot] ✅ Rescate manual terminado'))
    .catch(err => console.error('[bot] Error en rescate manual:', err))
  res.json({ ok: true, mensaje: 'Rescate de mensajes iniciado' })
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
      connected: BOT_READY && whatsappClient?.info ? true : false,
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
      version: '2.0.0',
      uptime: Math.round(process.uptime() / 60) + ' min',
    })
  } catch {
    res.json({
      pausado: BOT_PAUSADO,
      connected: BOT_READY && whatsappClient?.info ? true : false,
      estado: BOT_ESTADO,
      estadoDetalle: BOT_ESTADO_DETALLE,
    })
  }
})

app.listen(port, () => console.log(`🌐 Servidor web en puerto ${port}`))
console.log(`⚠️ Bot escuchando en :${port}. Next.js debe usar otro puerto (default 3000).`)





