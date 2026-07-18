import OpenAI from 'openai'
import type { EventType, EventPayload } from '../events/types'
import type { TimelineData } from './types'
import type { ReconstructorResult } from './order.reconstructor'

const IA2_TOKEN = process.env.IA2_TOKEN ?? ''
const IA2_MODEL = process.env.IA2_MODEL ?? 'gpt-4o'
const IA2_BASE_URL = process.env.IA2_BASE_URL ?? 'https://models.inference.ai.azure.com'

const TIMEOUT_MS = 15_000

export interface AuditorResult {
  approved: boolean
  errors: string[]
  corrections: { field: string; original: string; corrected: string }[]
}

export async function auditReconstruction(
  eventType: EventType,
  payload: EventPayload,
  timeline: TimelineData,
  reconstruction: ReconstructorResult
): Promise<AuditorResult> {
  if (!IA2_TOKEN) {
    return { approved: true, errors: ['IA #2 sin token — auditoría saltada'], corrections: [] }
  }

  const client = new OpenAI({
    baseURL: IA2_BASE_URL,
    apiKey: IA2_TOKEN,
  })

  const systemPrompt = `Eres un auditor de reconstrucción de pedidos florales. Tu función es verificar que el Order Reconstructor (IA #1) no haya alucinado ni inventado información.

REGLAS DE DETECCIÓN:
1. NOMBRE: Si el nombre contiene comas, puntos, conectores ("cree que", "por favor"), rechazar
2. SUCURSAL: Si la sucursal no existe en los datos de timeline, marcar
3. FECHA: Si la fecha es pasada y el estado no es ENTREGADO/POSTVENTA, rechazar
4. PRECIO: Si es 0 o extremadamente bajo (< 50 MXN) o alto (> 50000 MXN), marcar
5. PRODUCTO: Si parece inventado ("Por definir", "Arreglo floral genérico"), marcar
6. ESTADO: Si el estado no coincide con el timeline, marcar

Devuelve SOLO este JSON (sin markdown, sin texto extra):
{
  "approved": true/false,
  "errors": ["descripción del error"],
  "corrections": [
    { "field": "nombre", "original": "valor inventado", "corrected": "valor real" }
  ]
}`

  const userPrompt = `Auditar la siguiente reconstrucción de pedido:

Evento original:
- Tipo: ${eventType}
- Teléfono: ${payload.telefono}
- Cliente (evento): ${payload.cliente ?? '(vacio)'}
- Producto (evento): ${payload.producto ?? '(vacio)'}
- Total (evento): ${payload.total ?? '(vacio)'}
- Sucursal (evento): ${payload.sucursal ?? '(vacio)'}

Timeline (DB):
- Pedido en DB: ${timeline.pedido ? `estado=${timeline.pedido.estado}, nombre=${timeline.pedido.nombre ?? '(vacio)'}` : 'ninguno'}
- Caso activo: ${timeline.caso ? `${timeline.caso.tipo}` : 'ninguno'}
- Última actividad: ${timeline.ultimaActividad ?? 'desconocida'}

Reconstrucción de IA #1:
${JSON.stringify(reconstruction, null, 2)}

Verifica que IA #1:
1. No haya inventado valores que no están en evento ni timeline
2. No haya omitido conflictos evidentes
3. El nombre no tenga texto extra
4. La sucursal sea coherente
5. El precio tenga sentido
6. El producto no parezca inventado`

  try {
    const response = await Promise.race([
      client.chat.completions.create({
        model: IA2_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1000,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout IA #2 Auditor')), TIMEOUT_MS)
      ),
    ])

    const content = response.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(content)
    return parsed as AuditorResult
  } catch (err) {
    console.warn('[NotifEngine] IA #2 falló:', (err as Error)?.message ?? err)
    return { approved: true, errors: ['IA #2 falló — auditoría saltada'], corrections: [] }
  }
}
