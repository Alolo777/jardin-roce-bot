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

  return {
    cliente: match[1].trim(),
    producto: match[2].trim(),
    total: match[3].trim(),
    direccion: match[4].trim(),
    rawToken: match[0],
  }
}

// ─── Estructura del historial de conversación ────────────────────────────────
export interface MensajeChat {
  role: 'user' | 'assistant'
  content: string
}

// ─── Función principal del agente ────────────────────────────────────────────
export async function getAIResponse(
  historial: MensajeChat[],
  inventarioDiario?: string
): Promise<AIResponse> {
  try {
    const systemPromptBase = await obtenerSystemPrompt()

    // Adjuntar el inventario diario al prompt si se proporciona
    const systemPromptFinal = inventarioDiario
      ? `${systemPromptBase}\n\n--- INVENTARIO DISPONIBLE HOY ---\n${inventarioDiario}\n--- FIN DEL INVENTARIO ---`
      : systemPromptBase

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPromptFinal },
        ...historial,
      ],
      max_tokens: 800,
      temperature: 0.7,
    })

    const respuestaRaw = completion.choices[0]?.message?.content ?? 
      'Lo siento, no pude procesar tu mensaje. ¿Puedes repetirlo?'

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