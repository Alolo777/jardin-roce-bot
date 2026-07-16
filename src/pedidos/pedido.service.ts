import { EstadoPedido, PedidoActual } from '../models/types'
import { eventBus } from '../events/event-bus'
import { EventType } from '../events/types'

const TRANSICIONES_VALIDAS: Record<string, EstadoPedido[]> = {
  [EstadoPedido.NUEVO]: [EstadoPedido.COTIZANDO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.COTIZANDO]: [EstadoPedido.PRECIO_CONFIRMADO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.PRECIO_CONFIRMADO]: [EstadoPedido.ESPERANDO_DATOS, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.ESPERANDO_DATOS]: [EstadoPedido.ESPERANDO_PAGO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.ESPERANDO_PAGO]: [EstadoPedido.APARTADO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.APARTADO]: [EstadoPedido.EN_PRODUCCION, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.EN_PRODUCCION]: [EstadoPedido.LISTO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.LISTO]: [EstadoPedido.ENTREGADO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.ENTREGADO]: [EstadoPedido.POSTVENTA, EstadoPedido.ARCHIVADO],
  [EstadoPedido.ARCHIVADO]: [],
  [EstadoPedido.CANCELADO]: [],
  [EstadoPedido.QUEJA]: [EstadoPedido.POSTVENTA, EstadoPedido.ARCHIVADO],
  [EstadoPedido.POSTVENTA]: [EstadoPedido.ARCHIVADO],
}

const PEDIDOS = new Map<string, PedidoActual>()
let pedidoCounter = 0

function generarId(): string {
  return `ped_${Date.now()}_${++pedidoCounter}`
}

export function crearPedido(clienteId: string, telefono: string): PedidoActual {
  const pedido: PedidoActual = {
    id: generarId(),
    estado: EstadoPedido.NUEVO,
    telefono,
    creadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
  }

  PEDIDOS.set(clienteId, pedido)

  eventBus.emit(EventType.ORDER_CREATED, {
    orderId: pedido.id,
    telefono,
    descripcion: 'Pedido creado',
  })

  return pedido
}

export function obtenerPedido(clienteId: string): PedidoActual | null {
  return PEDIDOS.get(clienteId) ?? null
}

export function transitar(pedido: PedidoActual, nuevoEstado: EstadoPedido): boolean {
  const actual = pedido.estado
  if (!actual) return false

  const permitidos = TRANSICIONES_VALIDAS[actual]
  if (!permitidos || !permitidos.includes(nuevoEstado)) {
    console.warn(`[pedidos] Transición inválida: ${actual} → ${nuevoEstado}`)
    return false
  }

  pedido.estado = nuevoEstado
  pedido.actualizadoEn = new Date().toISOString()

  eventBus.emit(EventType.ORDER_UPDATED, {
    orderId: pedido.id,
    telefono: pedido.telefono ?? '',
    descripcion: `Estado: ${actual} → ${nuevoEstado}`,
  })

  if (nuevoEstado === EstadoPedido.PRECIO_CONFIRMADO) {
    eventBus.emit(EventType.PRICE_CONFIRMED, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
    })
  }

  if (nuevoEstado === EstadoPedido.LISTO) {
    eventBus.emit(EventType.ORDER_READY, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
      descripcion: 'Pedido listo para entrega',
    })
  }

  if (nuevoEstado === EstadoPedido.ENTREGADO) {
    eventBus.emit(EventType.ORDER_DELIVERED, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
    })
    eventBus.emit(EventType.DELIVERY_COMPLETED, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
    })
  }

  return true
}

export function archivarPedido(clienteId: string, motivo?: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido || !pedido.estado) return false

  if (!transitar(pedido, EstadoPedido.ARCHIVADO)) {
    pedido.estado = EstadoPedido.ARCHIVADO
    pedido.actualizadoEn = new Date().toISOString()
  }

  PEDIDOS.delete(clienteId)

  eventBus.emit(EventType.ORDER_UPDATED, {
    orderId: pedido.id,
    telefono: pedido.telefono ?? '',
    descripcion: motivo ?? 'Pedido archivado',
  })

  return true
}

export function cancelarPedido(clienteId: string, motivo?: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido || !pedido.estado) return false

  if (!transitar(pedido, EstadoPedido.CANCELADO)) {
    pedido.estado = EstadoPedido.CANCELADO
    pedido.actualizadoEn = new Date().toISOString()
  }

  PEDIDOS.delete(clienteId)

  eventBus.emit(EventType.CANCELACION_REQUESTED, {
    orderId: pedido.id,
    telefono: pedido.telefono ?? '',
    descripcion: motivo ?? 'Pedido cancelado',
  })

  return true
}

export function transitarDesdeFlujo(clienteId: string, flujo: string, motivo?: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido || !pedido.estado) return false

  const mapping: Record<string, EstadoPedido> = {
    cotizando: EstadoPedido.COTIZANDO,
    precio_confirmado: EstadoPedido.PRECIO_CONFIRMADO,
    esperando_fecha_hora: EstadoPedido.ESPERANDO_DATOS,
    esperando_datos: EstadoPedido.ESPERANDO_DATOS,
    esperando_nombre: EstadoPedido.ESPERANDO_DATOS,
    esperando_pago: EstadoPedido.ESPERANDO_PAGO,
    esperando_entrega: EstadoPedido.ESPERANDO_PAGO,
    apartado_sucursal: EstadoPedido.APARTADO,
    pagado_transferencia: EstadoPedido.EN_PRODUCCION,
    cerrado: EstadoPedido.ENTREGADO,
    cancelado: EstadoPedido.CANCELADO,
  }

  const nuevo = mapping[flujo]
  if (!nuevo) return false

  if (!transitar(pedido, nuevo)) {
    pedido.estado = nuevo
    pedido.actualizadoEn = new Date().toISOString()
  }
  return true
}

export function limpiarCachesPedidos(): void {
  const ahora = Date.now()
  for (const [clienteId, pedido] of PEDIDOS) {
    if (pedido.actualizadoEn) {
      const horas = (ahora - new Date(pedido.actualizadoEn).getTime()) / (1000 * 60 * 60)
      if (horas > 72) PEDIDOS.delete(clienteId)
    }
  }
}
