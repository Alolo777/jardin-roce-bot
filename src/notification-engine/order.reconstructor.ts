import OpenAI from 'openai'
import type { EventType, EventPayload } from '../events/types'
import type { TimelineData } from './types'

const IA1_TOKEN = process.env.IA1_TOKEN ?? ''
const IA1_MODEL = process.env.IA1_MODEL ?? 'gpt-4o-mini'
const IA1_BASE_URL = process.env.IA1_BASE_URL ?? 'https://models.inference.ai.azure.com'

const TIMEOUT_MS = 15_000

export interface ReconstructorResult {
  verified: boolean
  fields: {
    name: { value: string | null; confidence: number; source: string }
    sucursal: { value: string | null; confidence: number; source: string }
    fecha: { value: string | null; confidence: number; source: string }
    hora: { value: string | null; confidence: number; source: string }
    precio: { value: number | null; confidence: number; source: string }
    producto: { value: string | null; confidence: number; source: string }
    estado: { value: string | null; confidence: number; source: string }
  }
  warnings: string[]
  auditRequired: boolean
  auditReason: string | null
}

export async function reconstructOrder(
  eventType: EventType,
  payload: EventPayload,
  timeline: TimelineData
): Promise<ReconstructorResult> {
  if (!IA1_TOKEN) {
    return fallbackSinToken(eventType, payload, timeline)
  }

  const client = new OpenAI({
    baseURL: IA1_BASE_URL,
    apiKey: IA1_TOKEN,
  })

  const systemPrompt = `Eres un reconstructor de pedidos florales. Tu función es tomar datos de un evento del sistema y una línea de tiempo de base de datos, y devolver SOLO un JSON estructurado.

REGLAS:
- NO inventes información
- NO corrijas datos
- Si no puedes verificar un campo, devuelve null
- Usa el timeline (DB) como fuente principal de verdad
- El evento es la fuente secundaria
- Si evento y DB coinciden, confianza alta
- Si solo uno tiene el dato, confianza media
- Si difieren, marca warning y confianza baja

Devuelve SOLO este JSON (sin markdown, sin texto extra):
{
  "verified": true/false,
  "fields": {
    "name": { "value": "...", "confidence": 0.9, "source": "timeline" },
    "sucursal": { "value": "...", "confidence": 0.8, "source": "event" },
    "fecha": { "value": "...", "confidence": 0.7, "source": "event" },
    "hora": { "value": "...", "confidence": 0.7, "source": "event" },
    "precio": { "value": 500, "confidence": 0.9, "source": "timeline" },
    "producto": { "value": "...", "confidence": 0.8, "source": "timeline" },
    "estado": { "value": "cotizacion", "confidence": 0.9, "source": "timeline" }
  },
  "warnings": ["nombre no coincide entre evento y timeline"],
  "auditRequired": false,
  "auditReason": null
}`

  const userPrompt = construirPromptUsuario(eventType, payload, timeline)

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model: IA1_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1000,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout IA #1 Reconstructor')), TIMEOUT_MS)
      ),
    ])

    const content = response.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(content)
    return parsed as ReconstructorResult
  } catch (err) {
    console.warn('[NotifEngine] IA #1 falló:', (err as Error)?.message ?? err)
    return fallbackSinToken(eventType, payload, timeline)
  }
}

function construirPromptUsuario(
  eventType: EventType,
  payload: EventPayload,
  timeline: TimelineData
): string {
  return `Evento del sistema:
Tipo: ${eventType}
Teléfono: ${payload.telefono}
Cliente: ${payload.cliente ?? '(vacio)'}
Producto: ${payload.producto ?? '(vacio)'}
Total: ${payload.total ?? '(vacio)'}
Sucursal: ${payload.sucursal ?? '(vacio)'}
Método pago: ${payload.metodoPago ?? '(vacio)'}
Descripción: ${payload.descripcion ?? '(vacio)'}

Timeline desde DB:
Caso activo: ${timeline.caso ? `${timeline.caso.tipo} (${timeline.caso.estado})` : 'ninguno'}
Pedido en DB: ${timeline.pedido ? `estado=${timeline.pedido.estado}, nombre=${timeline.pedido.nombre ?? '(vacio)'}, producto=${(timeline.pedido as any).arreglo?.nombre ?? '(vacio)'}, precio=${(timeline.pedido as any).precioPersonalizado ?? '(vacio)'}, sucursal=${timeline.pedido.sucursal ?? '(vacio)'}, fecha=${timeline.pedido.fechaEntrega ?? '(vacio)'}, hora=${timeline.pedido.horaEntrega ?? '(vacio)'}` : 'ninguno'}
Última actividad: ${timeline.ultimaActividad ?? 'desconocida'}
Pedido cancelado/archivado: ${timeline.pedidoCanceladoOArchivado ? 'SÍ' : 'no'}`
}

function fallbackSinToken(
  eventType: EventType,
  payload: EventPayload,
  timeline: TimelineData
): ReconstructorResult {
  return {
    verified: true,
    fields: {
      name: { value: payload.cliente ?? timeline.pedido?.nombre ?? null, confidence: 0.5, source: 'fallback' },
      sucursal: { value: payload.sucursal ?? timeline.pedido?.sucursal ?? null, confidence: 0.5, source: 'fallback' },
      fecha: { value: timeline.pedido?.fechaEntrega ?? null, confidence: 0.5, source: 'fallback' },
      hora: { value: timeline.pedido?.horaEntrega ?? null, confidence: 0.5, source: 'fallback' },
      precio: { value: payload.total ?? (timeline.pedido as any)?.precioPersonalizado ?? null, confidence: 0.5, source: 'fallback' },
      producto: { value: payload.producto ?? (timeline.pedido as any)?.arreglo?.nombre ?? null, confidence: 0.5, source: 'fallback' },
      estado: { value: timeline.estadoActual ?? 'desconocido', confidence: 0.5, source: 'fallback' },
    },
    warnings: ['IA #1 no disponible — fallback a datos crudos'],
    auditRequired: true,
    auditReason: 'Fallback activado por falta de token o error de IA',
  }
}
