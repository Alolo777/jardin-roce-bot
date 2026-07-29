import { EstadoPedido, PedidoActual, TransicionEstado, MetodoPago } from '../models/types'
import { eventBus } from '../events/event-bus'
import { EventType, EventPayload } from '../events/types'
import { guardarPedidos, cargarPedidos, sincronizarPedidosBot } from './pedido.repository'

function jidANumero(jid: string): string {
  const limpio = (jid || '')
    .replace(/@[^\s]*/g, '')
    .replace(/:\d+$/, '')
    .trim()
  return limpio.startsWith('52') ? `+${limpio}` : limpio
}

const TRANSICIONES_VALIDAS: Record<string, EstadoPedido[]> = {
  [EstadoPedido.NUEVO]: [EstadoPedido.COTIZANDO, EstadoPedido.ESPERANDO_PAGO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.COTIZANDO]: [EstadoPedido.PRECIO_CONFIRMADO, EstadoPedido.ESPERANDO_PAGO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
  [EstadoPedido.PRECIO_CONFIRMADO]: [EstadoPedido.ESPERANDO_DATOS, EstadoPedido.ESPERANDO_PAGO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO],
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

function persistir(): void {
  guardarPedidos(PEDIDOS).catch(() => {})
  sincronizarPedidosBot(PEDIDOS).catch(() => {})
}

export function persistirPedidosEngine(): void {
  persistir()
}

export async function cargarPedidosDesdeBD(): Promise<void> {
  const restaurados = await cargarPedidos()
  for (const [id, pedido] of restaurados) {
    PEDIDOS.set(id, pedido)
  }
  if (restaurados.size > 0) {
    console.log(`[pedidos] Restaurados ${restaurados.size} pedidos activos`)
  }
}

function buildOrderPayload(pedido: PedidoActual): EventPayload {
  const total =
    pedido.precioPersonalizado ??
    pedido.arreglo?.precio ??
    0
  const producto =
    pedido.productoPersonalizado ??
    pedido.arreglo?.nombre ??
    'Por definir'
  const entrega =
    pedido.sucursal ??
    pedido.direccion ??
    pedido.envio?.zona ??
    'Por confirmar'
  return {
    orderId: pedido.id,
    telefono: pedido.telefono ?? '',
    cliente: pedido.nombre ?? '',
    producto,
    total: typeof total === 'number' ? total : 0,
    sucursal: entrega,
    metodoPago: pedido.metodoPago ?? '',
    descripcion: 'Pedido creado',
  }
}

function registrarTransicion(
  pedido: PedidoActual,
  desde: EstadoPedido,
  hasta: EstadoPedido,
  motivo?: string,
  usuario?: string,
  automatica?: boolean,
): void {
  const transicion: TransicionEstado = {
    desde,
    hasta,
    timestamp: new Date().toISOString(),
    usuario,
    motivo,
    automatica: automatica ?? false,
  }
  if (!pedido.transiciones) pedido.transiciones = []
  pedido.transiciones.push(transicion)
}

function emitirEventoTransicion(pedido: PedidoActual, desde: EstadoPedido, hasta: EstadoPedido): void {
  const payload: EventPayload = {
    ...buildOrderPayload(pedido),
    descripcion: `Estado: ${desde} → ${hasta}`,
  }

  eventBus.emit(EventType.ORDER_UPDATED, payload)

  if (hasta === EstadoPedido.PRECIO_CONFIRMADO) {
    eventBus.emit(EventType.PRICE_CONFIRMED, {
      ...payload,
      descripcion: 'Precio confirmado por el cliente',
    })
  }
  if (hasta === EstadoPedido.ESPERANDO_PAGO) {
    eventBus.emit(EventType.PAYMENT_PENDING, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
      cliente: pedido.nombre ?? '',
      producto: payload.producto,
      total: payload.total,
      sucursal: payload.sucursal,
      metodoPago: pedido.metodoPago ?? '',
      descripcion: 'Esperando pago del cliente',
    })
  }
  if (hasta === EstadoPedido.APARTADO) {
    eventBus.emit(EventType.PAYMENT_RECEIVED, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
      cliente: pedido.nombre ?? '',
      producto: payload.producto,
      total: payload.total,
      metodoPago: pedido.metodoPago ?? '',
      descripcion: 'Pago recibido, pedido apartado',
    })
  }
  if (hasta === EstadoPedido.LISTO) {
    eventBus.emit(EventType.ORDER_READY, {
      ...payload,
      descripcion: 'Pedido listo para entrega',
    })
  }
  if (hasta === EstadoPedido.ENTREGADO) {
    eventBus.emit(EventType.ORDER_DELIVERED, {
      ...payload,
      descripcion: 'Pedido entregado al cliente',
    })
    eventBus.emit(EventType.DELIVERY_COMPLETED, {
      ...payload,
      descripcion: 'Entrega completada',
    })
  }
  if (hasta === EstadoPedido.CANCELADO) {
    eventBus.emit(EventType.CANCELACION_REQUESTED, {
      orderId: pedido.id,
      telefono: pedido.telefono ?? '',
      descripcion: 'Pedido cancelado',
    })
  }
}

export function crearPedido(clienteId: string, telefono: string, datosIniciales?: Partial<PedidoActual>): PedidoActual {
  const pedido: PedidoActual = {
    id: generarId(),
    estado: EstadoPedido.NUEVO,
    telefono,
    creadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
    transiciones: [],
    ...datosIniciales,
  }

  PEDIDOS.set(clienteId, pedido)
  persistir()

  eventBus.emit(EventType.ORDER_CREATED, {
    orderId: pedido.id,
    telefono: pedido.telefono ?? '',
    cliente: pedido.nombre ?? '',
    producto: pedido.productoPersonalizado ?? pedido.arreglo?.nombre ?? 'Por definir',
    total: pedido.precioPersonalizado ?? pedido.arreglo?.precio ?? 0,
    descripcion: 'Pedido creado',
  })

  return pedido
}

export function obtenerPedido(clienteId: string): PedidoActual | null {
  return PEDIDOS.get(clienteId) ?? null
}

export function syncLegacyToEngine(clienteId: string, telefono: string, legado: Record<string, unknown>): PedidoActual {
  const existente = obtenerPedido(clienteId)
  if (existente) return existente

  const datos: Partial<PedidoActual> = {}
  if (typeof legado.nombre === 'string') datos.nombre = legado.nombre
  if (typeof legado.productoPersonalizado === 'string') datos.productoPersonalizado = legado.productoPersonalizado
  if (typeof legado.precioPersonalizado === 'number') datos.precioPersonalizado = legado.precioPersonalizado
  if (typeof legado.direccion === 'string') datos.direccion = legado.direccion
  if (typeof legado.sucursal === 'string') datos.sucursal = legado.sucursal
  if (typeof legado.metodoPago === 'string') datos.metodoPago = legado.metodoPago as PedidoActual['metodoPago']
  if (typeof legado.nota === 'string') datos.nota = legado.nota
  if (typeof legado.fechaEntrega === 'string') datos.fechaEntrega = legado.fechaEntrega
  if (typeof legado.horaEntrega === 'string') datos.horaEntrega = legado.horaEntrega
  if (typeof legado.detallesEspeciales === 'string') datos.detallesEspeciales = legado.detallesEspeciales
  if (typeof legado.estadoFlujo === 'string') datos.estadoFlujo = legado.estadoFlujo as string
  if (typeof legado.precioConfirmadoPor === 'string') datos.precioConfirmadoPor = legado.precioConfirmadoPor as PedidoActual['precioConfirmadoPor']
  if (typeof legado.esperandoPrecioEnvio === 'boolean') datos.esperandoPrecioEnvio = legado.esperandoPrecioEnvio
  if (typeof legado.cerradoEn === 'string') datos.cerradoEn = legado.cerradoEn
  if (legado.envio && typeof legado.envio === 'object' && 'zona' in legado.envio && 'precio' in legado.envio) {
    datos.envio = { zona: String((legado.envio as { zona: unknown }).zona), precio: Number((legado.envio as { precio: unknown }).precio) }
  }
  if (legado.arreglo && typeof legado.arreglo === 'object' && 'nombre' in legado.arreglo) {
    const a = legado.arreglo as { nombre: string; precio: number; id?: string }
    datos.arreglo = { nombre: a.nombre, precio: a.precio, id: a.id }
  }
  if (Array.isArray(legado.extras)) datos.extras = legado.extras as PedidoActual['extras']
  if (typeof legado.casoId === 'string') datos.casoId = legado.casoId

  return crearPedido(clienteId, telefono, datos)
}

export function transitar(pedido: PedidoActual, nuevoEstado: EstadoPedido): boolean {
  const actual = pedido.estado
  if (!actual) return false

  const permitidos = TRANSICIONES_VALIDAS[actual]
  if (!permitidos || !permitidos.includes(nuevoEstado)) {
    console.warn(`[pedidos] Transición inválida: ${actual} → ${nuevoEstado}`)
    return false
  }

  const desde = actual
  pedido.estado = nuevoEstado
  pedido.actualizadoEn = new Date().toISOString()

  registrarTransicion(pedido, desde, nuevoEstado)
  emitirEventoTransicion(pedido, desde, nuevoEstado)
  persistir()
  return true
}

export function cambiarEstado(
  pedido: PedidoActual,
  nuevoEstado: EstadoPedido,
  motivo?: string,
  usuario?: string,
): boolean {
  const actual = pedido.estado
  if (!actual) return false

  const permitidos = TRANSICIONES_VALIDAS[actual]
  if (!permitidos || !permitidos.includes(nuevoEstado)) {
    console.warn(`[pedidos] Transición inválida: ${actual} → ${nuevoEstado} (${motivo ?? 'sin motivo'})`)
    return false
  }

  pedido.estado = nuevoEstado
  pedido.actualizadoEn = new Date().toISOString()

  registrarTransicion(pedido, actual, nuevoEstado, motivo, usuario, false)
  emitirEventoTransicion(pedido, actual, nuevoEstado)
  persistir()
  return true
}

export function obtenerHistorialTransiciones(pedido: PedidoActual): TransicionEstado[] {
  return pedido.transiciones ?? []
}

export function archivarPedido(clienteId: string, motivo?: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido || !pedido.estado) return false

  const ok = transitar(pedido, EstadoPedido.ARCHIVADO)
  if (!ok) {
    pedido.estado = EstadoPedido.ARCHIVADO
    pedido.actualizadoEn = new Date().toISOString()
  }

  PEDIDOS.delete(clienteId)
  persistir()
  return true
}

export function archivarSilencioso(clienteId: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido) return false
  pedido.estado = EstadoPedido.ARCHIVADO
  pedido.actualizadoEn = new Date().toISOString()
  PEDIDOS.delete(clienteId)
  persistir()
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
  persistir()
  return true
}

export function transitarDesdeFlujo(clienteId: string, flujo: string, motivo?: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido || !pedido.estado) return false

  if (!pedido.telefono) {
    pedido.telefono = jidANumero(clienteId)
  }

  const mapping: Record<string, EstadoPedido> = {
    cotizando: EstadoPedido.COTIZANDO,
    precio_confirmado: EstadoPedido.PRECIO_CONFIRMADO,
    esperando_precio_equipo: EstadoPedido.COTIZANDO,
    esperando_fecha_hora: EstadoPedido.ESPERANDO_DATOS,
    esperando_datos: EstadoPedido.ESPERANDO_DATOS,
    esperando_nombre: EstadoPedido.ESPERANDO_DATOS,
    esperando_pago: EstadoPedido.ESPERANDO_PAGO,
    esperando_entrega: EstadoPedido.ESPERANDO_PAGO,
    apartado_sucursal: EstadoPedido.APARTADO,
    pagado_transferencia: EstadoPedido.APARTADO,
    cerrado: EstadoPedido.ENTREGADO,
    cancelado: EstadoPedido.CANCELADO,
  }

  const nuevo = mapping[flujo]
  if (!nuevo) return false

  transitar(pedido, nuevo)
  return true
}

export function pedidoTieneDatosCompletos(pedido: PedidoActual): boolean {
  return !!(
    pedido.estado &&
    pedido.nombre &&
    (pedido.fechaEntrega || pedido.creadoEn) &&
    (pedido.sucursal || pedido.direccion) &&
    (pedido.metodoPago && pedido.metodoPago !== MetodoPago.PENDIENTE)
  )
}

export function resetearPedido(clienteId: string): void {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido) return
  PEDIDOS.delete(clienteId)
  persistir()
}

export function sincronizarConCaso(pedido: PedidoActual, casoId: string): void {
  pedido.casoId = casoId
  pedido.actualizadoEn = new Date().toISOString()
  persistir()
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

