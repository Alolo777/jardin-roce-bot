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

// ─── Cargar precios de flores desde Supabase ────────────────────────────────
let cachePreciosFlores: { data: string; ts: number } | null = null

async function obtenerPreciosFlores(): Promise<string | null> {
  const ahora = Date.now()
  if (cachePreciosFlores && ahora - cachePreciosFlores.ts < 120_000) return cachePreciosFlores.data
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'precios_flores')
      .maybeSingle()
    if (error) throw error
    if (!data?.valor) return null
    cachePreciosFlores = { data: data.valor, ts: ahora }
    return data.valor
  } catch {
    return null
  }
}

// ─── Función principal del agente ────────────────────────────────────────────
export async function getAIResponse(
  historial: MensajeChat[],
  contextoExtra?: string
): Promise<AIResponse> {
  try {
    const systemPromptBase = await obtenerSystemPrompt()
    const preciosFlores = await obtenerPreciosFlores()

    let systemPromptFinal = systemPromptBase

    if (contextoExtra) {
      systemPromptFinal += `\n\n--- CONTEXTO EXTRA ---\n${contextoExtra}\n--- FIN DEL CONTEXTO EXTRA ---`
    }

    if (preciosFlores) {
      systemPromptFinal += `\n\n--- PRECIOS DE FLORES DISPONIBLES ---\n${preciosFlores}\n--- FIN DE PRECIOS ---\n\n` +
        `INSTRUCCION: Usa estos precios para calcular cotizaciones cuando el cliente pregunte por un arreglo personalizado. ` +
        `Suma los precios de las flores según la cantidad que pida el cliente. ` +
        `Pregunta por tipo de arreglo (ramo, bouquet, centro de mesa), tamaño y cuántas flores de cada tipo quiere. ` +
        `Da un estimado basado en los precios de las flores individuales. Si te falta información para calcular, pide los datos que necesites.`
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

// ─── Obtener inventario diario de Supabase ───────────────────────────────────
export async function obtenerInventarioDiario(): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('arreglos_diarios')
      .select('nombre, descripcion, precio, foto_url')
      .eq('estado', 'disponible')
      .order('creado_en', { ascending: false })

    if (error) throw error

    if (!data || data.length === 0) {
      return 'Hoy no tenemos arreglos armados disponibles para entrega inmediata.'
    }

    return data
      .map((a, i) =>
        `${i + 1}. ${a.nombre} — $${a.precio} MXN` +
        (a.descripcion ? `\n   Descripción: ${a.descripcion}` : '') +
        `\n   Foto: ${a.foto_url}`
      )
      .join('\n\n')
  } catch (error) {
    console.error('[ai.ts] Error al obtener inventario diario:', error)
    return 'No pude consultar el inventario en este momento.'
  }
}