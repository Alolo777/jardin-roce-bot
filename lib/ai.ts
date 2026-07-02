// lib/ai.ts
// Motor de IA con prompt dinámico, detección de venta y parseo de token

import OpenAI from 'openai'
import { supabaseAdmin } from './supabase'
import type { AIResponse, VentaCerrada } from './types'

// ─── Cliente OpenAI apuntando a GitHub Models ───────────────────────────────
const client = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: process.env.GITHUB_TOKEN,
})

const MODEL = process.env.GITHUB_MODEL ?? 'gpt-4o-mini'

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
      return await fn()
    } catch (error) {
      ultimoError = error
      if (intento === maxIntentos - 1) break
      const espera = 500 * 2 ** intento + Math.floor(Math.random() * 300)
      console.warn(
        `[ai.ts] Error en LLM (intento ${intento + 1}/${maxIntentos}), reintentando en ${espera}ms:`,
        error instanceof Error ? error.message : error
      )
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
    const completion = await conRetry(async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 12_000)
      try {
        return await client.chat.completions.create(
          {
            model: MODEL,
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
            ] as any,
            max_tokens: 120,
            temperature: 0,
          },
          { signal: controller.signal }
        )
      } finally {
        clearTimeout(timeoutId)
      }
    }, 2)
    console.timeEnd('[ai.ts] Vision classify')

    const raw = completion.choices[0]?.message?.content?.trim() || ''
    const parsed = JSON.parse(raw) as { tipo?: string; razon?: string }
    const tipo = parsed.tipo === 'comprobante' || parsed.tipo === 'referencia' || parsed.tipo === 'otra' || parsed.tipo === 'incierto'
      ? parsed.tipo
      : 'incierto'
    return { tipo, razon: String(parsed.razon || '').slice(0, 160) }
  } catch (error) {
    console.warn('[ai.ts] Error clasificando imagen:', error instanceof Error ? error.message : error)
    return { tipo: 'incierto', razon: 'error vision' }
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
    const completion = await conRetry(async () => {
      const controller = new AbortController()
      const timeoutId  = setTimeout(() => controller.abort(), 15_000)

      try {
        return await client.chat.completions.create(
          {
            model: MODEL,
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
    console.timeEnd('[ai.ts] LLM call')

    // Fallback robusto: cubre tanto null/undefined como string vacío o solo espacios.
    const contenido = completion.choices[0]?.message?.content?.trim()
    const respuestaRaw = contenido && contenido.length > 0
      ? contenido
      : 'Lo siento, no pude procesar tu mensaje. ¿Puedes repetirlo? 🌸'

    // Detectar si hay un token de venta cerrada
    const ventaCerrada = parsearTokenVenta(respuestaRaw)

    // Limpiar el token del mensaje que verá el cliente
    const mensajeLimpio = ventaCerrada
      ? respuestaRaw.replace(ventaCerrada.rawToken, '').trim()
      : respuestaRaw

    return { mensaje: mensajeLimpio, ventaCerrada }
  } catch (error) {
    console.error('[ai.ts] Error en getAIResponse:', error)
    throw error
  }
}

