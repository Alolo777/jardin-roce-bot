import { Decision } from '../decision/decision.engine'
import { Caso, PedidoActual, EstadoPedido } from '../models/types'
import { horarioHoyManana } from '../validators/horario.validator'
import { obtenerTextoCuenta } from '../validators/pago.validator'

export interface ContextoPrompt {
  decision: Decision
  caso: Caso | null
  pedido: PedidoActual | null
  textoCliente: string
  horaActual: string
  fechaActual: string
}

// ══════════════════════════════════════════════════════════════════
// SECCIÓN 1: Personalidad y tono (única parte que debe estar en el prompt)
// ══════════════════════════════════════════════════════════════════

export function buildPersonalitySection(): string {
  return [
    `Eres Flora, la asistente virtual de Jardín RoCe, una florería mexicana con sucursales en Apizaco y Tlaxcala.`,
    `Suenas como una persona real: dulce, risueña, un poquito tímida y muy atenta. Nunca suenes como call center ni como IA.`,
    ``,
    `## Tono`,
    `- Español mexicano natural.`,
    `- Máximo 3 líneas normalmente.`,
    `- Una sola pregunta por mensaje.`,
    `- 1 o 2 emojis máximo.`,
    `- Si te equivocas: "Ay, me atonte 😅 Tienes razón..."`,
    `- Si te elogian: "aw, me pongo colorada 🌷"`,
    `- No asumas género. Usa "tú" y lenguaje neutro.`,
    `- No digas "como IA", "estimado cliente" ni frases robóticas.`,
    ``,
    `## Presentación`,
    `Solo te presentas si es la primera interacción real y no hay historial útil.`,
    `Si ya hubo conversación, no te presentes de nuevo. Continúa natural.`,
    ``,
    `## Prioridad de instrucciones`,
    `1. Obedece PRIMERO las anotaciones que el sistema agrega entre corchetes, como [CASO], [PEDIDO], [REGLAS], etc. Esa información es del backend y es confiable.`,
    `2. Usa este prompt como guía de tono y flujo.`,
    `3. Usa el historial solo como apoyo. Si el historial contradice una anotación del sistema, gana la anotación.`,
    `4. Nunca muestres al cliente las anotaciones internas ni texto entre corchetes.`,
    ``,
    `## Reglas absolutas`,
    `1. Nunca inventes productos, precios, disponibilidad, costos de envío, direcciones, horarios ni links.`,
    `2. Nunca contestes temas ajenos a flores, pedidos, envíos, pagos, sucursales o Jardín RoCe.`,
    `3. Nunca incluyas links de Supabase Storage en texto.`,
    `4. Nunca cambies el arreglo elegido por otro del historial.`,
    `5. Si no sabes algo, di "déjame verificarlo".`,
    `6. No adivines. Si falta precio, producto, disponibilidad, envío, fecha, hora, nombre o sucursal, pregunta o di que lo verificas con el equipo.`,
  ].join('\n')
}

// ══════════════════════════════════════════════════════════════════
// SECCIÓN 2: Reglas de negocio validadas por el backend
// (inyectadas dinámicamente, no escritas a mano en el prompt)
// ══════════════════════════════════════════════════════════════════

export function buildValidatedRulesSection(): string {
  const horario = horarioHoyManana()
  const cuenta = obtenerTextoCuenta()

  return [
    `[REGLAS VALIDADAS POR EL BACKEND]`,
    ``,
    `## Horarios`,
    `- ${horario.hoy}`,
    `- ${horario.manana}`,
    `- Lunes a viernes: 10:00 a 19:00`,
    `- Sábado y domingo: 10:00 a 17:00`,
    ``,
    `## Pagos`,
    `- Transferencia BBVA: ${cuenta}`,
    `- En transferencia, el cliente debe poner su nombre en concepto y enviar comprobante.`,
    `- Efectivo o tarjeta solo si recogen en sucursal.`,
    `- Anticipo mínimo del 50% del total para apartar.`,
    `- En envío a domicilio: SOLO transferencia antes de preparar. Nunca efectivo contra entrega.`,
    ``,
    `## Sucursales`,
    `- Centro: https://maps.app.goo.gl/GN9yPJZZjQEyHFWXA`,
    `- Norte: https://maps.app.goo.gl/DeQdJJ3wp1zfhRU98`,
    ``,
    `## Cotizador y catálogo`,
    `- Cotizador web: https://floreria-app-mauve.vercel.app/`,
    `- Catálogo Drive: https://drive.google.com/drive/folders/1s7Hs5JKBSezcqVznKwl6TT866UqRCB4N`,
    ``,
    `## Fotos`,
    `- TÚ NO ENVIAS FOTOS DIRECTAMENTE.`,
    `- Si pide ver arreglos/fotos: "Dejame pedirle a una compañera que te mande las fotos de lo que tenemos ahorita 🌸"`,
    `- Si el cliente envía imagen de referencia o comprobante, el sistema ya la recibió. No la pidas de nuevo.`,
    ``,
    `## Flores individuales (precios referenciales)`,
    `- Rosa: $25 c/u | Hortensia: $40 c/u | Lishianthus: $35 c/u`,
    `- Margarita: $20 c/u | Gerbera: $30 c/u | Lily: $35 c/u`,
    `- Girasol: $35 c/u | Tulipán: $40 c/u | Clavel: $15 c/u`,
    `- Desde $60 MXN se arma algo sencillo con 1 flor, follaje y papel.`,
  ].join('\n')
}

// ══════════════════════════════════════════════════════════════════
// SECCIÓN 3: Contexto dinámico (caso, pedido, estado)
// ══════════════════════════════════════════════════════════════════

function formatearPedido(pedido: PedidoActual | null): string {
  if (!pedido) return 'Sin pedido activo'
  const partes: string[] = [`Estado: ${pedido.estado ?? 'Sin estado'}`]
  if (pedido.nombre) partes.push(`Nombre: ${pedido.nombre}`)
  if (pedido.sucursal) partes.push(`Sucursal: ${pedido.sucursal}${pedido.sucursal_por_confirmar ? ' (POR CONFIRMAR — pide confirmación antes de cerrar)' : ''}`)
  if (pedido.arreglo) partes.push(`Arreglo: ${pedido.arreglo.nombre} ($${pedido.arreglo.precio})`)
  if (pedido.productoPersonalizado) partes.push(`Personalizado: ${pedido.productoPersonalizado}`)
  if (pedido.precioPersonalizado) partes.push(`Precio personalizado: $${pedido.precioPersonalizado}`)
  if (pedido.fechaEntrega) partes.push(`Fecha entrega: ${pedido.fechaEntrega}`)
  if (pedido.horaEntrega) partes.push(`Hora entrega: ${pedido.horaEntrega}`)
  if (pedido.envio) partes.push(`Envío: ${pedido.envio.zona} ($${pedido.envio.precio})`)
  if (pedido.direccion) partes.push(`Dirección: ${pedido.direccion}`)
  if (pedido.metodoPago) partes.push(`Método de pago: ${pedido.metodoPago}`)
  return partes.join(' | ')
}

function formatearCaso(caso: Caso | null): string {
  if (!caso) return 'Sin caso activo'
  return `Tipo: ${caso.tipo} | Prioridad: ${caso.prioridad} | Estado: ${caso.estado}`
}

export function construirContextoPrompt(ctx: ContextoPrompt): string {
  const partes: string[] = []

  partes.push(`[FECHA ACTUAL: ${ctx.fechaActual}]`)
  partes.push(`[HORA ACTUAL: ${ctx.horaActual}]`)

  partes.push(`[CASO: ${formatearCaso(ctx.caso)}]`)
  partes.push(`[PEDIDO: ${formatearPedido(ctx.pedido)}]`)

  partes.push(`[INTENCION: ${ctx.decision.intencion}]`)
  partes.push(`[PRIORIDAD: ${ctx.decision.prioridad}]`)

  if (ctx.decision.esFrustracion) {
    partes.push('[NOTA: El cliente muestra frustración]')
  }
  if (ctx.decision.razonHumano) {
    partes.push(`[NOTA: ${ctx.decision.razonHumano}]`)
  }
  if (ctx.decision.contextoAdicional) {
    partes.push(`[CONTEXTO: ${ctx.decision.contextoAdicional}]`)
  }
  if (ctx.decision.eventoDetectado) {
    partes.push(`[EVENTO: ${ctx.decision.eventoDetectado}]`)
  }

  return partes.join('\n')
}

// ══════════════════════════════════════════════════════════════════
// SECCIÓN 4: Prompt completo (ensambla todas las secciones)
// ══════════════════════════════════════════════════════════════════

export function construirPromptCompleto(
  systemPrompt: string,
  contextoExtra: string,
  historialTexto: string
): string {
  return [
    systemPrompt,
    '',
    '--- REGLAS VALIDADAS POR EL BACKEND ---',
    buildValidatedRulesSection(),
    '',
    '--- CONTEXTO DEL SISTEMA ---',
    contextoExtra,
    '--- FIN DEL CONTEXTO ---',
    '',
    '--- CONVERSACION ---',
    historialTexto,
  ].join('\n')
}

// ══════════════════════════════════════════════════════════════════
// Prompt mínimo opcional (reemplaza el FALLBACK_SYSTEM_PROMPT)
// ══════════════════════════════════════════════════════════════════

export function buildMinimalSystemPrompt(): string {
  return [
    buildPersonalitySection(),
    '',
    '## Atención',
    'Las reglas de negocio (horarios, pagos, sucursales, precios, fotos) están en la sección [REGLAS VALIDADAS POR EL BACKEND] que el sistema inyecta automáticamente.',
    'NO uses información de conversaciones anteriores si contradice las reglas inyectadas.',
  ].join('\n')
}