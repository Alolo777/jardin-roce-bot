// lib/ai.ts
// Motor de IA con prompt dinámico, detección de venta y parseo de token

import OpenAI from 'openai'
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from './supabase'
import { eventBus } from '../src/events/event-bus'
import { EventType } from '../src/events/types'
import { metrics } from './metrics.service'
import { logger } from './logger.service'
import { SYSTEM_PROMPT_CORREGIDO } from '../src/prompts/system-prompt.corregido'
import type { AIResponse, VentaCerrada } from './types'
import { formatearFechaHoraMensaje } from '../src/whatsapp/message-utils'

// ─── Proveedores OpenAI-compatibles (fallback en cadena) ────────────────────
// Cada proveedor tiene SU PROPIA cuota diaria independiente. Al repartir las
// tareas de IA entre varios proveedores/modelos, se multiplica la capacidad
// total del sistema (las cuotas de Gemini se aplican por modelo + proyecto).
// Orden de fallback: Gemini (primario) → OpenRouter → Groq → Cerebras → GitHub.
interface OpenAICompatProvider {
  name: string
  client: OpenAI | null
  model: string
  soportaVision: boolean
}

function crearProviderOpenAI(
  name: string,
  baseURL: string,
  apiKey: string | undefined,
  model: string,
  soportaVision: boolean
): OpenAICompatProvider {
  return {
    name,
    client: apiKey ? new OpenAI({ baseURL, apiKey }) : null,
    model,
    soportaVision,
  }
}

// ─── Cliente Gemini (primario) ───────────────────────────────────────────────
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null

// gemini-2.5-flash tiene free tier de ~20 RPD (recortado dic-2025).
// gemini-2.5-flash-lite quedó DEPRECADO (404, ya no disponible). El modelo
// gratuito vigente (verificado 2026-08-04) es gemini-3.1-flash-lite.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite'
const GITHUB_MODEL = process.env.GITHUB_MODEL ?? 'gpt-4o-mini'

// Cadena de proveedores OpenAI-compatibles (solo se incluyen los configurados).
// OpenRouter: 20 RPM / 50 RPD free (1000 RPD con $10 de créditos).
// Groq: 30 RPM / 1,000 RPD free (llama-3.3-70b). Cerebras: ~1M tokens/día free.
// GitHub Models: retirado desde 2026-07-30, se conserva como último respaldo.
const OPENAI_COMPAT_PROVIDERS: OpenAICompatProvider[] = [
  crearProviderOpenAI(
    'OpenRouter',
    'https://openrouter.ai/api/v1',
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_MODEL ?? 'openrouter/free',
    true
  ),
  crearProviderOpenAI(
    'Groq',
    'https://api.groq.com/openai/v1',
    process.env.GROQ_API_KEY,
    process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    false
  ),
  crearProviderOpenAI(
    'Cerebras',
    'https://api.cerebras.ai/v1',
    process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b',
    false
  ),
  crearProviderOpenAI(
    'GitHub Models',
    'https://models.inference.ai.azure.com',
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_MODEL ?? 'gpt-4o-mini',
    false
  ),
]

// ─── Semáforo global: máximo 3 llamadas concurrentes a la API ───────────────
// GitHub Models/Azure permite ~3 por cuenta; 3 evita colas cuando NotifEngine + bot actúan juntos
const MAX_CONCURRENT = 3
const SLOT_TIMEOUT_MS = 30_000
let activeRequests = 0
const requestQueue: Array<() => void> = []

async function concurrencySlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++
    return
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = requestQueue.indexOf(cb)
      if (idx >= 0) requestQueue.splice(idx, 1)
      console.warn(`[ai.ts] ⚠️ Timeout esperando slot (${SLOT_TIMEOUT_MS}ms) — forzando request`)
      resolve()
    }, SLOT_TIMEOUT_MS)
    const cb = () => {
      clearTimeout(timer)
      activeRequests++
      resolve()
    }
    requestQueue.push(cb)
  })
}

function releaseSlot(): void {
  const next = requestQueue.shift()
  if (next) next()
  else activeRequests--
}

const API_CALL_TIMEOUT_MS = 60_000

export async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  await concurrencySlot()
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`[ai.ts] ⏱️ Timeout ${API_CALL_TIMEOUT_MS}ms`)), API_CALL_TIMEOUT_MS)
      ),
    ])
  } finally {
    releaseSlot()
  }
}

// ─── Wrapper con cadena de proveedores OpenAI-compatibles ────────────────────
// Gemini es el proveedor primario. Si falla (429 por cuota, 5xx, timeout), se
// recorre la cadena de proveedores OpenAI-compatibles configurados en orden
// (OpenRouter → Groq → Cerebras → GitHub). Cada proveedor tiene su propia cuota
// diaria, por lo que repartir las tareas entre varios multiplica la capacidad.
type LlamadaOpenAICompat<T> = (provider: OpenAICompatProvider) => Promise<T>

async function callWithFallback<T>(
  geminiCall: () => Promise<T>,
  openAICall: LlamadaOpenAICompat<T>,
  operacion: string,
  requiereVision: boolean = false
): Promise<T> {
  try {
    return await geminiCall()
  } catch (error) {
    console.warn(`[ai.ts] ⚠️ Gemini falló en ${operacion} — intentando proveedores OpenAI-compatibles:`,
      error instanceof Error ? error.message : error)
    for (const provider of OPENAI_COMPAT_PROVIDERS) {
      if (!provider.client) continue
      if (requiereVision && !provider.soportaVision) continue
      try {
        return await openAICall(provider)
      } catch (provError) {
        console.warn(`[ai.ts] ❌ ${provider.name} falló en ${operacion}:`,
          provError instanceof Error ? provError.message : provError)
      }
    }
    throw error // lanzar el error original de Gemini
  }
}

// ─── Caché del System Prompt (TTL: 60 segundos) ─────────────────────────────
interface CachePrompt {
  valor: string
  cargadoEn: number
}

let cachePrompt: CachePrompt | null = null
const CACHE_TTL_MS = 60 * 1000 // 60 segundos

async function obtenerSystemPrompt(): Promise<string> {
  const ahora = Date.now()

  // Usar caché si está vigente
  if (cachePrompt && ahora - cachePrompt.cargadoEn < CACHE_TTL_MS) {
    return cachePrompt.valor
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'system_prompt')
      .single()

    if (error) throw error

    cachePrompt = { valor: data.valor, cargadoEn: ahora }
    return data.valor
  } catch (error) {
    console.error('[ai.ts] Error al cargar system prompt:', error)

    // Fallback: usar caché expirado si existe, o el prompt corregido del repo.
    // BUG-027: el fallback anterior era un prompt VIEJO hardcodeado con datos
    // desactualizados (horarios, anticipo 50%) — Flora contestaba "distinta"
    // sin rastro visible. Ahora usa el espejo actualizado y deja LOG en la
    // tabla `logs` (visible en /admin/logs).
    if (cachePrompt) {
      console.warn('[ai.ts] Usando caché expirado del prompt como fallback')
      logger.warn('prompt', 'System prompt: Supabase falló — usando CACHÉ EXPIRADO (hasta 60s de antigüedad extra)')
      return cachePrompt.valor
    }

    logger.error('prompt', 'System prompt: Supabase falló sin caché — usando SYSTEM_PROMPT_CORREGIDO del repositorio como fallback')
    return SYSTEM_PROMPT_CORREGIDO
  }
}

// ─── Patrón del token de venta cerrada ───────────────────────────────────────
// Formato esperado: [VENTA_CERRADA: Cliente | Producto | $Precio | Dirección]
const REGEX_VENTA = /\[VENTA_CERRADA:\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^\]]+)\]/i

function parsearTokenVenta(texto: string): VentaCerrada | null {
  const match = texto.match(REGEX_VENTA)
  if (!match) return null

  const cliente = match[1].trim()
  const producto = match[2].trim()
  const total = match[3].trim()
  const direccion = match[4].trim()

  // Validar que ningún campo quede vacío. Un token malformado
  // (p. ej. "[VENTA_CERRADA: | | | ]") NO debe disparar alerta de Telegram.
  if (!cliente || !producto || !total || !direccion) {
    console.warn('[ai.ts] Token VENTA_CERRADA malformado (campos vacíos), se ignora:', match[0])
    return null
  }

  return {
    cliente,
    producto,
    total,
    direccion,
    rawToken: match[0],
  }
}

// ─── Retry con backoff exponencial para la API de GitHub Models ──────────────
// La API puede dar timeouts o errores 5xx transitorios; reintentamos con
// esperas crecientes (500ms, 1s, 2s) + jitter antes de rendirnos.
// Genérico sobre un thunk para preservar el tipo de retorno exacto.
async function conRetry<T>(fn: () => Promise<T>, maxIntentos = 3): Promise<T> {
  let ultimoError: unknown
  for (let intento = 0; intento < maxIntentos; intento++) {
    try {
      return await withLimit(fn)
    } catch (error) {
      ultimoError = error
      if (intento === maxIntentos - 1) break
      const espera = 500 * 2 ** intento + Math.floor(Math.random() * 300)
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes('429') && !msg.includes('Rate limit')) {
        console.warn(
          `[ai.ts] Error en LLM (intento ${intento + 1}/${maxIntentos}), reintentando en ${espera}ms:`,
          msg
        )
      }
      await new Promise(resolve => setTimeout(resolve, espera))
    }
  }
  throw ultimoError
}

// ─── Estructura del historial de conversación ────────────────────────────────
export interface MensajeChat {
  role: 'user' | 'assistant'
  content: string
  creadoEn?: string
  // Quién escribió el mensaje: 'cliente' | 'flora' | 'equipo' | 'sistema'.
  // Permite distinguir respuestas verificadas del equipo de las generadas por la IA.
  origen?: string
}

export type IntencionConversacion =
  | 'saludo'
  | 'consulta_producto'
  | 'cotizacion'
  | 'envio'
  | 'pago_comprobante'
  | 'venta'
  | 'cancelacion'
  | 'queja'
  | 'atencion_humana'
  | 'seguimiento'
  | 'off_topic'
  | 'incierto'

export type SeveridadAlerta = 'ninguna' | 'baja' | 'media' | 'alta' | 'critica'

export interface ClasificacionConversacion {
  intencion: IntencionConversacion
  severidad: SeveridadAlerta
  confianza: number
  debeResponder: boolean
  debeAlertarTelegram: boolean
  debeAlertarWhatsApp: boolean
  debePausarPorHumano: boolean
  razon: string
}

export interface RevisionRespuestaFlora {
  approved: boolean
  mensaje?: string
  razon: string
  riesgo: 'bajo' | 'medio' | 'alto'
  debeAlertarTelegram: boolean
  debeAlertarWhatsApp: boolean
}

function extraerJsonObjeto(texto: string): string {
  const limpio = texto.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  const inicio = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  return inicio >= 0 && fin > inicio ? limpio.slice(inicio, fin + 1) : limpio
}

function normalizarBoolean(valor: unknown, fallback: boolean): boolean {
  return typeof valor === 'boolean' ? valor : fallback
}

function normalizarConfianza(valor: unknown): number {
  const n = Number(valor)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

export type ClasificacionImagenVenta = 'comprobante' | 'referencia' | 'otra' | 'incierto'

interface ImagenCliente {
  base64: string
  mimetype: string
  caption?: string
}

export async function clasificarImagenVenta(
  historial: MensajeChat[],
  contexto: string,
  imagenes: ImagenCliente[]
): Promise<{ tipo: ClasificacionImagenVenta; razon: string }> {
  if (imagenes.length === 0) return { tipo: 'incierto', razon: 'sin imagenes' }

  const historialReciente = historial
    .slice(-8)
    .map(m => `${etiquetaOrigen(m)}: ${m.content}`)
    .join('\n')
    .slice(-3000)

  const prompt = [
    'Clasifica las imagenes del cliente en una venta de floreria.',
    'Responde SOLO JSON valido, sin markdown, con este formato: {"tipo":"comprobante|referencia|otra|incierto","razon":"max 120 caracteres"}.',
    'comprobante = captura/foto de transferencia, recibo, ticket, deposito, banco o pago.',
    'referencia = flores, ramo, arreglo floral, imagen de inspiracion/cotizacion o producto deseado.',
    'otra = imagen no relacionada con pago ni flores.',
    'incierto = no se puede determinar.',
    'Prioriza como comprobante si el historial indica que el equipo humano (humano, VERIFICADO) pidio el pago o el comprobante, aunque la imagen sea ambigua.',
    'Si el historial dice que esperaba pago pero la imagen muestra flores, clasifica referencia.',
    'Si el historial dice que cotizaba flores pero la imagen muestra banco/recibo, clasifica comprobante.',
    '',
    `Contexto operativo: ${contexto}`,
    '',
    `Historial reciente:\n${historialReciente || 'Sin historial'}`,
    '',
    `Captions: ${imagenes.map(i => i.caption).filter(Boolean).join(' | ') || 'Sin texto'}`,
  ].join('\n')

  try {
    console.time('[ai.ts] Vision classify')

    const rawTexto = await (async () => {
        // Gemini primario: soporta imágenes inline (base64) en una sola llamada.
        const llamarGemini = async (): Promise<string> => {
          if (!geminiClient) throw new Error('Gemini no configurado')
          const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
          const result = await model.generateContent({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  ...imagenes.slice(0, 2).map(img => ({
                    inlineData: { mimeType: img.mimetype || 'image/jpeg', data: img.base64 },
                  })),
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 1024, temperature: 0 },
          })
          return result.response.text() || ''
        }

        // Proveedores OpenAI-compatibles (OpenRouter soporta visión).
        const llamarOpenAICompat = async (provider: OpenAICompatProvider): Promise<string> => {
          if (!provider.client) throw new Error(`${provider.name} no configurado`)
          const content: ChatCompletionContentPart[] = [
            { type: 'text', text: prompt },
            ...imagenes.slice(0, 2).map(img => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mimetype || 'image/jpeg'};base64,${img.base64}` },
            })),
          ]
          const completion = await conRetry(async () => {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 25_000)
            try {
              const res = await provider.client!.chat.completions.create(
                {
                  model: provider.model,
                  messages: [{ role: 'user', content }],
                  max_tokens: 1024,
                  temperature: 0,
                },
                { signal: controller.signal }
              )
              return res.choices[0]?.message?.content?.trim() || ''
            } finally {
              clearTimeout(timeoutId)
            }
          }, 2)
          return completion
        }

        return await callWithFallback(
          () => conRetry(llamarGemini, 3),
          llamarOpenAICompat,
          'clasificarImagenVenta',
          true
        )
      })()
    console.timeEnd('[ai.ts] Vision classify')

    const parsed = JSON.parse(extraerJsonObjeto(rawTexto)) as { tipo?: string; razon?: string }
    const tipo = parsed.tipo === 'comprobante' || parsed.tipo === 'referencia' || parsed.tipo === 'otra' || parsed.tipo === 'incierto'
      ? parsed.tipo
      : 'incierto'
    return { tipo, razon: String(parsed.razon || '').slice(0, 160) }
  } catch (error) {
    console.warn('[ai.ts] Error clasificando imagen:', error instanceof Error ? error.message : error)
    return { tipo: 'incierto', razon: 'error vision' }
  }
}

export async function clasificarConversacion(
  historial: MensajeChat[],
  mensajeCliente: string,
  contextoOperativo: string
): Promise<ClasificacionConversacion> {
  const historialReciente = historial
    .slice(-30)
    .map(m => `${etiquetaOrigen(m)}: ${m.content}`)
    .join('\n')
    .slice(-9000)

  const prompt = [
    'Eres un clasificador operativo para un bot de floreria llamado Flora.',
    'Analiza la conversacion completa reciente y el ultimo mensaje. Ignora mensajes de dias/semanas anteriores si ya no son relevantes para la solicitud actual.',
    'Responde SOLO JSON valido, sin markdown.',
    'Formato exacto: {"intencion":"saludo|consulta_producto|cotizacion|envio|pago_comprobante|venta|cancelacion|queja|atencion_humana|seguimiento|off_topic|incierto","severidad":"ninguna|baja|media|alta|critica","confianza":0.0,"debeResponder":true,"debeAlertarTelegram":false,"debeAlertarWhatsApp":false,"debePausarPorHumano":false,"razon":"max 160 caracteres"}.',
    'Reglas: no marques venta si solo hay interes o un ok ambiguo. No marques pago_comprobante sin contexto de pago o evidencia clara. Cotizacion/envio normalmente es severidad media si requiere equipo. Queja/cancelacion/atencion_humana son alta o critica.',
    '',
    `Contexto operativo:\n${contextoOperativo || 'Sin contexto'}`,
    '',
    `Historial reciente:\n${historialReciente || 'Sin historial'}`,
    '',
    `Ultimo mensaje del cliente:\n${mensajeCliente}`,
  ].join('\n')

  try {
    const rawJson = await callWithFallback(
      async () => {
        if (!geminiClient) throw new Error('Gemini no configurado')
        const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
        const result = await conRetry(() => model.generateContent(prompt), 3)
        return result.response.text() || ''
      },
      async (provider: OpenAICompatProvider) => {
        if (!provider.client) throw new Error(`${provider.name} no configurado`)
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10_000)
          try {
            return await provider.client!.chat.completions.create(
              {
                model: provider.model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1024,
                temperature: 0,
              },
              { signal: controller.signal }
            )
          } finally {
            clearTimeout(timeoutId)
          }
        }, 2)
        return completion.choices[0]?.message?.content || ''
      },
      'clasificarConversacion'
    )

    const parsed = JSON.parse(extraerJsonObjeto(rawJson)) as Partial<ClasificacionConversacion>
    const intenciones: IntencionConversacion[] = ['saludo', 'consulta_producto', 'cotizacion', 'envio', 'pago_comprobante', 'venta', 'cancelacion', 'queja', 'atencion_humana', 'seguimiento', 'off_topic', 'incierto']
    const severidades: SeveridadAlerta[] = ['ninguna', 'baja', 'media', 'alta', 'critica']
    const intencion = intenciones.includes(parsed.intencion as IntencionConversacion) ? parsed.intencion as IntencionConversacion : 'incierto'
    const severidad = severidades.includes(parsed.severidad as SeveridadAlerta) ? parsed.severidad as SeveridadAlerta : 'baja'
    return {
      intencion,
      severidad,
      confianza: normalizarConfianza(parsed.confianza),
      debeResponder: normalizarBoolean(parsed.debeResponder, true),
      debeAlertarTelegram: normalizarBoolean(parsed.debeAlertarTelegram, severidad === 'alta' || severidad === 'critica'),
      debeAlertarWhatsApp: normalizarBoolean(parsed.debeAlertarWhatsApp, severidad === 'critica'),
      debePausarPorHumano: normalizarBoolean(parsed.debePausarPorHumano, false),
      razon: String(parsed.razon || '').slice(0, 180),
    }
  } catch (error) {
    console.warn('[ai.ts] Error clasificando conversacion:', error instanceof Error ? error.message : error)
    return { intencion: 'incierto', severidad: 'baja', confianza: 0, debeResponder: true, debeAlertarTelegram: false, debeAlertarWhatsApp: false, debePausarPorHumano: false, razon: 'fallback por error' }
  }
}

// ─── Novedades diarias para administradores (DEC-084/086) ────────────────────
// Un único análisis al día (3 am CDMX) o manual (botón, últimas 48 h).
// El LLM SOLO clasifica dentro de categorías del backend y redacta; nunca
// decide qué notificar ni toca la base de datos.

function extraerJsonArray(texto: string): string {
  const limpio = texto.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  const inicio = limpio.indexOf('[')
  const fin = limpio.lastIndexOf(']')
  return inicio >= 0 && fin > inicio ? limpio.slice(inicio, fin + 1) : limpio
}

export interface ChatParaResumen {
  telefono: string
  lineas: string[]
}

// DEC-086: por cada chat la IA devuelve el ESTADO (qué se habló y en qué
// quedó — SIEMPRE, incluso ventas cerradas) y una NOVEDAD opcional si hay
// algo pendiente para el equipo humano.
export interface AnalisisChatItem {
  telefono: string
  estado: string
  novedad?: {
    tipo: string
    prioridad?: string
    resumen: string
  }
}

const TIPOS_NOVEDAD_PERMITIDOS =
  'cotizacion_pendiente|pedido_sin_tratar|cambio_fecha|modificacion_arreglo|pago_pendiente|entrega_programada|esperando_respuesta_equipo|duda_sin_responder|queja|otro'

export async function resumirNovedadesChats(chats: ChatParaResumen[]): Promise<AnalisisChatItem[] | null> {
  if (chats.length === 0) return []

  const bloques = chats
    .map(c => `CHAT ${c.telefono}:\n${c.lineas.join('\n').slice(-1600)}`)
    .join('\n\n')

  const prompt = [
    'Analiza las conversaciones de una floreria (Flora es la asistente virtual).',
    'COBERTURA TOTAL (DEC-091): devuelve EXACTAMENTE un objeto por CADA bloque "CHAT <telefono>" listado, usando su telefono EXACTO. PROHIBIDO omitir bloques; si un chat es trivial, igual devuelve su objeto con estado breve y sin novedad.',
    'DIA DE LA SEMANA: cada bloque o marca 📅 indica la fecha real en que se escribieron esos mensajes. Interpreta palabras relativas ("hoy", "mañana", "el viernes") segun EL DIA DEL MENSAJE, no segun hoy. Ej: si un SABADO dice "mañana paso por el ramo", se refiere al DOMINGO.',
    'Para CADA chat devuelve SIEMPRE un objeto con:',
    '- estado (OBLIGATORIO, max 90 caracteres): que se hablo y en que quedo, INCLUYENDO conversaciones cerradas (ej: "cotizo girasoles; quedo de mandar foto" / "venta cerrada ramo $300; recoge domingo 11 am").',
    '- novedad (SOLO si hay algo pendiente para el equipo humano): { tipo, prioridad, resumen } donde tipo es una de:',
    `    ${TIPOS_NOVEDAD_PERMITIDOS}`,
    '  PRIORIDADES DE ALERTA a detectar: (1) comprobante que prometio y falta → pago_pendiente; (2) ramo/arreglo por COTIZAR sin precio del equipo → cotizacion_pendiente; (3) arreglo PENDIENTE DE ENTREGA o recogida confirmada → entrega_programada; (4) duda que quedo SIN RESPONDER en el chat → duda_sin_responder.',
    '  Reglas de novedad: cotizacion_pendiente reportala aunque luego diga ok/gracias si nadie del equipo confirmo precio; entrega_programada SIEMPRE aunque la venta este cerrada; pago_pendiente si prometio comprobante y no hay confirmacion.',
    '  prioridad: baja|media|alta · resumen: max 90 caracteres, con fecha/hora cuando aplique ("recoge domingo 11 am").',
    'SIN NOVEDAD (pero CON estado) cuando: el ULTIMO mensaje es de equipo/flora y no hay pedido pendiente ni entrega futura ("...esperando respuesta del cliente"), o el chat fue solo saludo/cortesia.',
    'REGLAS: No inventes telefonos: usa EXACTAMENTE los de los bloques CHAT. Hasta 2 novedades por chat SOLO si son temas distintos (duplica el objeto). espanol mexicano.',
    `Responde SOLO JSON valido, sin markdown, formato: [{"telefono":"...","estado":"...","novedad":{"tipo":"cotizacion_pendiente","prioridad":"baja|media|alta","resumen":"..."}}]. El campo novedad se omite si no aplica.`,
    '',
    bloques,
  ].join('\n')

  try {
    console.time('[ai.ts] Novedades diarias')
    const rawTexto = await callWithFallback(
      async () => {
        if (!geminiClient) throw new Error('Gemini no configurado')
        const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
        const result = await conRetry(() => model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0 },
        }), 3)
        return result.response.text() || ''
      },
      async (provider: OpenAICompatProvider) => {
        if (!provider.client) throw new Error(`${provider.name} no configurado`)
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30_000)
          try {
            return await provider.client!.chat.completions.create(
              {
                model: provider.model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 2048,
                temperature: 0,
              },
              { signal: controller.signal }
            )
          } finally {
            clearTimeout(timeoutId)
          }
        }, 2)
        return completion.choices[0]?.message?.content?.trim() || ''
      },
      'resumirNovedadesChats'
    )
    console.timeEnd('[ai.ts] Novedades diarias')

    const parsed = JSON.parse(extraerJsonArray(rawTexto)) as AnalisisChatItem[]
    if (!Array.isArray(parsed)) return null
    return parsed.filter(n => n && typeof n.telefono === 'string' && typeof n.estado === 'string')
  } catch (error) {
    console.warn('[ai.ts] Error generando novedades diarias:', error instanceof Error ? error.message : error)
    return null
  }
}

// ─── Análisis PROFUNDO de UNA conversación (DEC-088) ─────────────────────────
// 1 llamada por chat, espaciadas 15–25 s desde el servicio. Conoce la fecha,
// día de la semana y hora actuales + las marcas 📅/hora del transcript para
// razonar fechas relativas ("mañana" dicho sábado = domingo) y detectar si un
// pedido con recogida programada ya debió entregarse.

export interface DetalleChatIA {
  categoria: string
  resumen: string
  puntosClave: string[]
  requiereRevision: boolean
  motivoRevision?: string
  preguntasAbiertas: string[]
  fechasMencionadas?: string[]
}

const CATEGORIAS_CHAT =
  'venta_cerrada|cotizacion|pedido_en_proceso|duda|queja|postventa|saludo|otro'

export async function analizarChatDetalle(
  chat: ChatParaResumen,
  ahora: { fecha: string; diaSemana: string; hora: string }
): Promise<DetalleChatIA | null> {
  const prompt = [
    'Eres analista interno de una floreria. Analiza ESTA conversacion atendida y responde SOLO JSON valido, sin markdown.',
    `HOY es ${ahora.diaSemana} ${ahora.fecha} y son las ${ahora.hora} (CDMX). El transcript tiene marcas [📅 dia fecha] (cuando cambio el dia) y [hora] por mensaje.`,
    'FECHAS RELATIVAS: interpreta "hoy/mañana/el viernes" segun EL DIA DEL MENSAJE (la marca 📅 vigente), no segun hoy. Ej: sabado dice "mañana paso" → domingo.',
    'Con eso, razona el estado temporal: ej. si quedo de recoger el sabado 11 am y ya paso, marca que falta confirmar si se lo llevaron.',
    '',
    'Devuelve exactamente:',
    `{ "categoria": "${CATEGORIAS_CHAT}",`,
    '  "resumen": "2-4 lineas detalladas de como se dio la conversacion",',
    '  "puntosClave": ["dato importante", "..."],',
    '  "requiereRevision": true|false,   // true SOLO si vale la pena que el admin la lea: dinero pendiente, queja, promesa sin confirmar, cambio de fecha, entrega que ya debio ocurrir',
    '  "motivoRevision": "porque (solo si requiereRevision=true)",',
    '  "preguntasAbiertas": ["pregunta concreta que el equipo debe verificar, ej: ¿Ya recogio su pedido del sabado 11 am?"],',
    '  "fechasMencionadas": ["sabado 22/08 11 am"] }',
    'Si algo no aplica, usa array vacio. No inventes datos que no esten en el transcript.',
    'RUIDO (DEC-089): si el ULTIMO mensaje es del equipo/flora y no hay pedido pendiente (datos/pago/comprobante) ni entrega futura, marca requiereRevision=false, sin preguntasAbiertas: ya fue atendido; sin respuesta del cliente = no interesó.',
    '',
    `CHAT ${chat.telefono}:`,
    chat.lineas.join('\n').slice(-2400),
  ].join('\n')

  try {
    const rawTexto = await callWithFallback(
      async () => {
        if (!geminiClient) throw new Error('Gemini no configurado')
        const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
        const result = await conRetry(() => model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.2 },
        }), 2)
        return result.response.text() || ''
      },
      async (provider: OpenAICompatProvider) => {
        if (!provider.client) throw new Error(`${provider.name} no configurado`)
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 30_000)
          try {
            return await provider.client!.chat.completions.create(
              {
                model: provider.model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 700,
                temperature: 0.2,
              },
              { signal: controller.signal }
            )
          } finally {
            clearTimeout(timeoutId)
          }
        }, 2)
        return completion.choices[0]?.message?.content?.trim() || ''
      },
      'analizarChatDetalle'
    )

    const parsed = JSON.parse(extraerJsonObjeto(rawTexto)) as DetalleChatIA
    if (!parsed || typeof parsed.resumen !== 'string') return null
    return {
      categoria: CATEGORIAS_CHAT.split('|').includes(parsed.categoria) ? parsed.categoria : 'otro',
      resumen: String(parsed.resumen).slice(0, 600),
      puntosClave: Array.isArray(parsed.puntosClave) ? parsed.puntosClave.slice(0, 5).map(String) : [],
      requiereRevision: !!parsed.requiereRevision,
      motivoRevision: parsed.motivoRevision ? String(parsed.motivoRevision).slice(0, 200) : undefined,
      preguntasAbiertas: Array.isArray(parsed.preguntasAbiertas) ? parsed.preguntasAbiertas.slice(0, 4).map(String) : [],
      fechasMencionadas: Array.isArray(parsed.fechasMencionadas) ? parsed.fechasMencionadas.slice(0, 6).map(String) : undefined,
    }
  } catch (error) {
    console.warn('[ai.ts] Error analizando chat detalle:', error instanceof Error ? error.message : error)
    return null
  }
}

// ─── Consulta de seguimiento de un admin sobre un chat concreto (BUG-026) ────
// El administrador pregunta algo específico ("¿qué pasó con el 7890?") y el
// LLM responde leyendo la transcripción reciente de ESE chat. Una llamada
// pequeña SOLO cuando el admin pregunta; nunca en el flujo del cliente.

export interface ImagenVisionAdmin {
  base64: string
  mimetype?: string
  caption?: string
}

export async function responderConsultaAdmin(
  pregunta: string,
  chats: ChatParaResumen[],
  imagenes: ImagenVisionAdmin[] = []
): Promise<string | null> {
  if (chats.length === 0) return null

  const adjuntas = imagenes.slice(0, 2)
  const bloques = chats
    .map(c => `CHAT ${c.telefono}:\n${c.lineas.join('\n').slice(-2400)}`)
    .join('\n\n')

  const prompt = [
    'Eres el asistente interno del equipo de una floreria. Un ADMINISTRADOR te pregunta sobre un chat de cliente.',
    'Con base SOLO en la transcripción e imágenes, responde su pregunta de forma breve (max 6 lineas), en espanol mexicano.',
    'Incluye: que pidió/hizo el cliente, en qué quedó la conversación y qué falta por hacer del lado del equipo.',
    ...(adjuntas.length > 0 ? [
      `Se adjuntan ${adjuntas.length} imagen(es) del chat. Para CADA imagen indica brevemente QUÉ ES — dirección/ubicación, comprobante de pago, foto de referencia de un arreglo para cotizar, u otro — y el dato clave visible (calle y número, banco/monto, tipo de flores...). Ej: "La primera es un comprobante BBVA de $350 y la segunda una dirección en papel".`,
      `Captions de las imágenes: ${adjuntas.map(i => i.caption).filter(Boolean).join(' | ') || 'sin texto'}`,
    ] : []),
    'Si la transcripcion no contiene la respuesta, dilo claramente sin inventar datos (no inventes precios ni fechas).',
    'No uses markdown pesado ni listas largas; texto plano amable y directo.',
    '',
    `Pregunta del administrador: ${pregunta}`,
    '',
    bloques,
  ].join('\n')

  try {
    console.time('[ai.ts] Consulta admin')
    const texto = await callWithFallback(
      async () => {
        if (!geminiClient) throw new Error('Gemini no configurado')
        const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
        const result = await conRetry(() => model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              ...adjuntas.map(img => ({
                inlineData: { mimeType: img.mimetype || 'image/jpeg', data: img.base64 },
              })),
            ],
          }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
        }), 2)
        return result.response.text() || ''
      },
      async (provider: OpenAICompatProvider) => {
        if (!provider.client) throw new Error(`${provider.name} no configurado`)
        const content: ChatCompletionContentPart[] = [
          { type: 'text', text: prompt },
          ...adjuntas.map(img => ({
            type: 'image_url' as const,
            image_url: { url: `data:${img.mimetype || 'image/jpeg'};base64,${img.base64}` },
          })),
        ]
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 25_000)
          try {
            return await provider.client!.chat.completions.create(
              {
                model: provider.model,
                messages: [{ role: 'user', content }],
                max_tokens: 500,
                temperature: 0.3,
              },
              { signal: controller.signal }
            )
          } finally {
            clearTimeout(timeoutId)
          }
        }, 2)
        return completion.choices[0]?.message?.content?.trim() || ''
      },
      'responderConsultaAdmin',
      true
    )
    console.timeEnd('[ai.ts] Consulta admin')
    return texto && texto.length > 0 ? texto.slice(0, 900) : null
  } catch (error) {
    console.warn('[ai.ts] Error en consulta de admin:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function revisarRespuestaFlora(
  historial: MensajeChat[],
  mensajeCliente: string,
  respuestaFlora: string,
  contextoOperativo: string
): Promise<RevisionRespuestaFlora> {
  const historialReciente = historial
    .slice(-30)
    .map(m => `${etiquetaOrigen(m)}: ${m.content}`)
    .join('\n')
    .slice(-9000)

  const prompt = [
    'Eres revisor de calidad de Flora, asistente de una floreria.',
    'Evalua si la respuesta propuesta es la mejor para el ultimo mensaje considerando el historial reciente. Ignora historial viejo que no aplique al pedido actual.',
    'REGLA DE PRECIOS: Si la respuesta propuesta contiene un PRECIO (simbolo $ o cifras monetarias) que NO aparece en el contexto operativo ni en una cotizacion del equipo en el historial, DESAPRUEBALA (approved:false, riesgo:alto) y en "mensaje" escribe una respuesta corregida que diga "Déjame verificarlo con mi equipo" sin cifras. Flora nunca debe inventar precios.',
    'REGLA DE NO INSISTIR: Si el ultimo mensaje del cliente es solo un agradecimiento, "ok", "gracias", "listo", un saludo ya respondido, o no requiere accion de Flora, y la respuesta propuesta vuelve a preguntar algo ya resuelto o insiste en vender, DESAPRUEBALA (approved:false, riesgo:bajo) y en "mensaje" escribe una respuesta corta (max 1 linea) o deja "mensaje" vacio para no responder.',
    'Si la respuesta propuesta es buena y no inventa datos, APRUEBALA (approved:true) y deja "mensaje" vacio.',
    'No apruebes respuestas que inventen disponibilidad, envio, pagos, promesas, compensaciones o que ignoren una cotizacion humana reciente.',
    'TONO AL CORREGIR (BUG-027): si escribes un "mensaje" corregido, usa la voz de Flora: espanol mexicano dulce y breve (max 3 lineas), 1-2 emojis maximo, maximo UNA pregunta, nunca robotica ni corporativa.',
    'Si hay un precio dado por el equipo en el historial reciente, la respuesta debe usarlo o reconocerlo; no debe pedir confirmarlo otra vez salvo que falten datos.',
    'Responde SOLO JSON valido: {"approved":true,"mensaje":"respuesta corregida opcional o vacio","razon":"max 160 caracteres","riesgo":"bajo|medio|alto","debeAlertarTelegram":false,"debeAlertarWhatsApp":false}.',
    '',
    `Contexto operativo:\n${contextoOperativo || 'Sin contexto'}`,
    '',
    `Historial reciente:\n${historialReciente || 'Sin historial'}`,
    '',
    `Ultimo mensaje del cliente:\n${mensajeCliente}`,
    '',
    `Respuesta propuesta de Flora:\n${respuestaFlora}`,
  ].join('\n')

  try {
    const rawJson = await callWithFallback(
      async () => {
        if (!geminiClient) throw new Error('Gemini no configurado')
        const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
        const result = await conRetry(() => model.generateContent(prompt), 3)
        return result.response.text() || ''
      },
      async (provider: OpenAICompatProvider) => {
        if (!provider.client) throw new Error(`${provider.name} no configurado`)
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 12_000)
          try {
            return await provider.client!.chat.completions.create(
              {
                model: provider.model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1024,
                temperature: 0,
              },
              { signal: controller.signal }
            )
          } finally {
            clearTimeout(timeoutId)
          }
        }, 2)
        return completion.choices[0]?.message?.content || ''
      },
      'revisarRespuestaFlora'
    )

    const parsed = JSON.parse(extraerJsonObjeto(rawJson)) as Partial<RevisionRespuestaFlora>
    const riesgo = parsed.riesgo === 'medio' || parsed.riesgo === 'alto' ? parsed.riesgo : 'bajo'
    return {
      approved: normalizarBoolean(parsed.approved, true),
      mensaje: parsed.mensaje ? String(parsed.mensaje).trim().slice(0, 1200) : undefined,
      razon: String(parsed.razon || '').slice(0, 180),
      riesgo,
      debeAlertarTelegram: normalizarBoolean(parsed.debeAlertarTelegram, riesgo === 'alto'),
      debeAlertarWhatsApp: normalizarBoolean(parsed.debeAlertarWhatsApp, false),
    }
  } catch (error) {
    console.warn('[ai.ts] Error revisando respuesta:', error instanceof Error ? error.message : error)
    return { approved: true, razon: 'fallback por error', riesgo: 'medio', debeAlertarTelegram: false, debeAlertarWhatsApp: false }
  }
}

// ─── Función principal del agente ────────────────────────────────────────────
// Origen efectivo de un mensaje. Los mensajes guardados antes de que existiera
// la columna `origen` (DEC-082) no tienen valor; se infieren por su contenido
// (`[Agente: ...]` = equipo verificado, anotaciones del sistema).
function origenEfectivo(m: MensajeChat): string {
  if (m.origen) return m.origen
  const contenido = (m.content || '').trim()
  if (contenido.startsWith('[Agente:')) return 'equipo'
  if (contenido.startsWith('[Flora omitió respuesta') || contenido.startsWith('[ANOTACIÓN DEL SISTEMA')) return 'sistema'
  return 'flora'
}

// Etiqueta cada mensaje según quién lo escribió para que el LLM distinga
// respuestas verificadas del equipo de las generadas por la propia IA.
function etiquetaOrigen(m: MensajeChat): string {
  if (m.role === 'user') return 'cliente'
  const origen = origenEfectivo(m)
  if (origen === 'equipo') return 'equipo (humano, VERIFICADO)'
  if (origen === 'sistema') return 'sistema'
  return 'flora (IA)'
}

function formatearHistorialConFechas(historial: MensajeChat[]): MensajeChat[] {
  return historial.map(m => {
    const marca = m.creadoEn ? formatearFechaHoraMensaje(m.creadoEn) : ''
    let anotacion = ''
    if (m.role === 'assistant') {
      const origen = origenEfectivo(m)
      if (origen === 'equipo') anotacion = ' [EQUIPO HUMANO, VERIFICADO]'
      else if (origen === 'sistema') anotacion = ' [ANOTACIÓN DEL SISTEMA]'
      else if (origen === 'flora') anotacion = ' [RESPUESTA DE FLORA]'
    }
    const prefijo = anotacion ? `[${marca}]${anotacion}` : (marca ? `[${marca}]` : '')
    return prefijo ? { ...m, content: `${prefijo} ${m.content}` } : m
  })
}

export async function getAIResponse(
  historial: MensajeChat[],
  contextoExtra?: string
): Promise<AIResponse | null> {
  try {
    const systemPromptBase = await obtenerSystemPrompt()

    let systemPromptFinal = systemPromptBase

    if (contextoExtra) {
      systemPromptFinal += `\n\n--- CONTEXTO EXTRA ---\n${contextoExtra}\n--- FIN DEL CONTEXTO EXTRA ---`
    }

    const historialConFechas = formatearHistorialConFechas(historial)

    console.time('[ai.ts] LLM call')
    const inicioIA = Date.now()
    const respuestaRaw = await callWithFallback(
      async () => {
        if (!geminiClient) throw new Error('Gemini no configurado')
        const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL })
        const historyParts: { role: 'user' | 'model'; parts: { text: string }[] }[] =
          historialConFechas.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
        // generateContent requiere al menos un turno de usuario; si no hay historial,
        // enviamos un saludo vacío para que el system prompt responda.
        const contents = historyParts.length > 0
          ? historyParts
          : [{ role: 'user' as const, parts: [{ text: 'Hola' }] }]
        const resultContent = await conRetry(() => model.generateContent({
          systemInstruction: systemPromptFinal,
          contents,
          generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
        }), 3)
        const texto = resultContent.response.text() || ''
        return texto.trim().length > 0 ? texto : 'Lo siento, no pude procesar tu mensaje. ¿Puedes repetirlo? 🌸'
      },
      async (provider: OpenAICompatProvider) => {
        if (!provider.client) throw new Error(`${provider.name} no configurado`)
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId  = setTimeout(() => controller.abort(), 15_000)
          try {
            return await provider.client!.chat.completions.create(
              {
                model: provider.model,
                messages: [
                  { role: 'system', content: systemPromptFinal },
                  ...historialConFechas,
                ],
                max_tokens: 2048,
                temperature: 0.7,
              },
              { signal: controller.signal }
            )
          } finally {
            clearTimeout(timeoutId)
          }
        })
        const contenido = completion.choices[0]?.message?.content?.trim()
        return contenido && contenido.length > 0
          ? contenido
          : 'Lo siento, no pude procesar tu mensaje. ¿Puedes repetirlo? 🌸'
      },
      'getAIResponse'
    )
    console.timeEnd('[ai.ts] LLM call')
    metrics.recordAiLatency(Date.now() - inicioIA)

    // Detectar si hay un token de venta cerrada
    const ventaCerrada = parsearTokenVenta(respuestaRaw)

    // Limpiar el token del mensaje que verá el cliente
    const mensajeLimpio = ventaCerrada && ventaCerrada.rawToken
      ? respuestaRaw.replace(ventaCerrada.rawToken, '').trim()
      : respuestaRaw

    return { mensaje: mensajeLimpio, ventaCerrada }
  } catch (error) {
    metrics.recordAiError()
    console.error('[ai.ts] 🔴 Error en getAIResponse (ambos proveedores fallaron):', error)
    try {
      eventBus.emit(EventType.PROVIDER_FAILURE, {
        telefono: 'system',
        descripcion: error instanceof Error ? error.message.slice(0, 200) : 'Error desconocido en proveedor IA',
      })
    } catch {}
    return null
  }
}

