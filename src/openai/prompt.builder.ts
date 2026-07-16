import { Decision } from '../decision/decision.engine'
import { Caso, PedidoActual, EstadoPedido } from '../../models/types'

export interface ContextoPrompt {
  decision: Decision
  caso: Caso | null
  pedido: PedidoActual | null
  textoCliente: string
  horaActual: string
  fechaActual: string
}

function formatearPedido(pedido: PedidoActual | null): string {
  if (!pedido) return 'Sin pedido activo'
  const partes: string[] = [`Estado: ${pedido.estado ?? 'Sin estado'}`]
  if (pedido.nombre) partes.push(`Nombre: ${pedido.nombre}`)
  if (pedido.sucursal) partes.push(`Sucursal: ${pedido.sucursal}`)
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

  partes.push(`[CASO ACTIVO: ${formatearCaso(ctx.caso)}]`)
  partes.push(`[PEDIDO ACTIVO: ${formatearPedido(ctx.pedido)}]`)

  partes.push(`[INTENCION DETECTADA: ${ctx.decision.intencion}]`)
  partes.push(`[PRIORIDAD: ${ctx.decision.prioridad}]`)

  if (ctx.decision.requiereHumano) {
    partes.push('[NOTA: Esta conversación puede requerir intervención humana]')
  }

  if (ctx.decision.contextoAdicional) {
    partes.push(`[CONTEXTO: ${ctx.decision.contextoAdicional}]`)
  }

  return partes.join('\n')
}

export function construirPromptCompleto(
  systemPrompt: string,
  contextoExtra: string,
  historialTexto: string
): string {
  return [
    systemPrompt,
    '',
    '--- CONTEXTO DEL SISTEMA ---',
    contextoExtra,
    '--- FIN DEL CONTEXTO ---',
    '',
    '--- CONVERSACION ---',
    historialTexto,
  ].join('\n')
}
