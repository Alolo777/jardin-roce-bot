// lib/ai.ts
// Motor de IA con prompt dinámico, detección de venta y parseo de token

import OpenAI from 'openai'
import { supabaseAdmin } from './supabase'
import { callGeminiText, callGeminiVision } from './gemini-ai'
import type { AIResponse, VentaCerrada } from './types'

// ─── Cliente OpenAI apuntando a GitHub Models ───────────────────────────────
const client = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: process.env.GITHUB_TOKEN,
})

const MODEL = process.env.GITHUB_MODEL ?? 'gpt-4o'
const REVIEW_MODEL = process.env.GITHUB_REVIEW_MODEL ?? MODEL

// ─── Semáforo global: máximo 2 llamadas concurrentes a la API ───────────────
const MAX_CONCURRENT = 2
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

const API_CALL_TIMEOUT_MS = 30_000

async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
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

async function callWithFallback<T>(
  githubFn: () => Promise<T>,
  geminiFn: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await githubFn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ai.ts] 🟡 Fallback → Gemini para "${label}": ${msg}`)
    try {
      return await geminiFn()
    } catch (geminiErr) {
      const gmsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr)
      console.error(`[ai.ts] 🔴 Gemini también falló para "${label}": ${gmsg}`)
      throw geminiErr
    }
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

    // Fallback: usar caché expirado si existe, o un prompt mínimo
    if (cachePrompt) {
      console.warn('[ai.ts] Usando caché expirado del prompt como fallback')
      return cachePrompt.valor
    }

    return 'Eres Flora, asistente virtual de Jardin RoCe. Ayuda a los clientes con sus pedidos de flores.'
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
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(-3000)

  const prompt = [
    'Clasifica las imagenes del cliente en una venta de floreria.',
    'Responde SOLO JSON valido, sin markdown, con este formato: {"tipo":"comprobante|referencia|otra|incierto","razon":"max 120 caracteres"}.',
    'comprobante = captura/foto de transferencia, recibo, ticket, deposito, banco o pago.',
    'referencia = flores, ramo, arreglo floral, imagen de inspiracion/cotizacion o producto deseado.',
    'otra = imagen no relacionada con pago ni flores.',
    'incierto = no se puede determinar.',
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

    const rawTexto = await callWithFallback(
      async () => {
        const body = JSON.stringify({
          model: REVIEW_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...imagenes.slice(0, 2).map(img => ({
                  type: 'image_url',
                  image_url: { url: `data:${img.mimetype || 'image/jpeg'};base64,${img.base64}` },
                })),
              ],
            },
          ],
          max_tokens: 120,
          temperature: 0,
        })
        const raw = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 25_000)
          try {
            const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'api-key': process.env.GITHUB_VISION_TOKEN || process.env.GITHUB_TOKEN! },
              body,
              signal: controller.signal,
            })
            if (!res.ok) {
              const errText = await res.text().catch(() => '')
              throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
            }
            return (await res.json()) as { choices: { message: { content: string } }[] }
          } finally {
            clearTimeout(timeoutId)
          }
        }, 2)
        return raw.choices?.[0]?.message?.content?.trim() || ''
      },
      async () => {
        return await callGeminiVision(prompt, imagenes)
      },
      'Vision classify'
    )
    console.timeEnd('[ai.ts] Vision classify')

    const parsed = JSON.parse(rawTexto) as { tipo?: string; razon?: string }
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
    .map(m => `${m.role === 'user' ? 'cliente' : 'flora/equipo'}: ${m.content}`)
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
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10_000)
          try {
            return await client.chat.completions.create(
              {
                model: REVIEW_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 220,
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
      async () => {
        return await callGeminiText(prompt, { maxTokens: 220, temperature: 0 })
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

export async function revisarRespuestaFlora(
  historial: MensajeChat[],
  mensajeCliente: string,
  respuestaFlora: string,
  contextoOperativo: string
): Promise<RevisionRespuestaFlora> {
  const historialReciente = historial
    .slice(-30)
    .map(m => `${m.role === 'user' ? 'cliente' : 'flora/equipo'}: ${m.content}`)
    .join('\n')
    .slice(-9000)

  const prompt = [
    'Eres revisor de calidad de Flora, asistente de una floreria.',
    'Evalua si la respuesta propuesta es la mejor para el ultimo mensaje considerando el historial reciente. Ignora historial viejo que no aplique al pedido actual.',
    'No apruebes respuestas que inventen precios, disponibilidad, envio, pagos, promesas, compensaciones o que ignoren una cotizacion humana reciente.',
    'Si hay un precio dado por el equipo en el historial reciente, la respuesta debe usarlo o reconocerlo; no debe pedir confirmarlo otra vez salvo que falten datos.',
    'Responde SOLO JSON valido: {"approved":true,"mensaje":"respuesta corregida opcional","razon":"max 160 caracteres","riesgo":"bajo|medio|alto","debeAlertarTelegram":false,"debeAlertarWhatsApp":false}.',
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
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 12_000)
          try {
            return await client.chat.completions.create(
              {
                model: REVIEW_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 350,
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
      async () => {
        return await callGeminiText(prompt, { maxTokens: 350, temperature: 0 })
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
export async function getAIResponse(
  historial: MensajeChat[],
  contextoExtra?: string
): Promise<AIResponse> {
  try {
    const systemPromptBase = await obtenerSystemPrompt()

    let systemPromptFinal = systemPromptBase

    if (contextoExtra) {
      systemPromptFinal += `\n\n--- CONTEXTO EXTRA ---\n${contextoExtra}\n--- FIN DEL CONTEXTO EXTRA ---`
    }

    console.time('[ai.ts] LLM call')
    const respuestaRaw = await callWithFallback(
      async () => {
        const completion = await conRetry(async () => {
          const controller = new AbortController()
          const timeoutId  = setTimeout(() => controller.abort(), 15_000)
          try {
            return await client.chat.completions.create(
              {
                model: REVIEW_MODEL,
                messages: [
                  { role: 'system', content: systemPromptFinal },
                  ...historial,
                ],
                max_tokens: 800,
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
      async () => {
        const historialTexto = historial
          .map(m => `${m.role === 'user' ? 'cliente' : 'flora'}: ${m.content}`)
          .join('\n')
        const prompt = `${systemPromptFinal}\n\n--- Conversación ---\n${historialTexto}`
        const texto = await callGeminiText(prompt, { maxTokens: 800, temperature: 0.7 })
        return texto && texto.length > 0
          ? texto
          : 'Lo siento, no pude procesar tu mensaje. ¿Puedes repetirlo? 🌸'
      },
      'getAIResponse'
    )
    console.timeEnd('[ai.ts] LLM call')

    // Detectar si hay un token de venta cerrada
    const ventaCerrada = parsearTokenVenta(respuestaRaw)

    // Limpiar el token del mensaje que verá el cliente
    const mensajeLimpio = ventaCerrada && ventaCerrada.rawToken
      ? respuestaRaw.replace(ventaCerrada.rawToken, '').trim()
      : respuestaRaw

    return { mensaje: mensajeLimpio, ventaCerrada }
  } catch (error) {
    console.error('[ai.ts] Error en getAIResponse:', error)
    throw error
  }
}

