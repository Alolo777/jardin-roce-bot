import { EstadoPedido, EstadoFlujo, PedidoActual, PedidoResumenDTO, TransicionEstado, MetodoPago } from '../models/types'
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
  // N6: máquina secuencial estricta (AGENTS.md) — sin saltos. NUEVO solo va a
  // COTIZANDO; COTIZANDO solo a PRECIO_CONFIRMADO. transitarDesdeFlujo usa BFS
  // (encontrarCaminoEstados) así que los flujos largos siguen funcionando paso
  // a paso. Terminales (CANCELADO/ARCHIVADO/QUEJA) permitidos desde cualquier
  // estado porque el cliente puede cancelar o quejarse en cualquier momento.
  [EstadoPedido.NUEVO]: [EstadoPedido.COTIZANDO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.COTIZANDO]: [EstadoPedido.PRECIO_CONFIRMADO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.PRECIO_CONFIRMADO]: [EstadoPedido.ESPERANDO_DATOS, EstadoPedido.ESPERANDO_PAGO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.ESPERANDO_DATOS]: [EstadoPedido.ESPERANDO_PAGO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.ESPERANDO_PAGO]: [EstadoPedido.APARTADO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.APARTADO]: [EstadoPedido.EN_PRODUCCION, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.EN_PRODUCCION]: [EstadoPedido.LISTO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.LISTO]: [EstadoPedido.ENTREGADO, EstadoPedido.CANCELADO, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.ENTREGADO]: [EstadoPedido.POSTVENTA, EstadoPedido.ARCHIVADO, EstadoPedido.QUEJA],
  [EstadoPedido.ARCHIVADO]: [],
  [EstadoPedido.CANCELADO]: [],
  [EstadoPedido.QUEJA]: [EstadoPedido.POSTVENTA, EstadoPedido.ARCHIVADO, EstadoPedido.CANCELADO],
  [EstadoPedido.POSTVENTA]: [EstadoPedido.ARCHIVADO],
}

const PEDIDOS = new Map<string, PedidoActual[]>()
let pedidoCounter = 0

const MAX_RETRIES_PERSISTENCIA = 3

async function persistirConRetry(): Promise<boolean> {
  for (let i = 0; i < MAX_RETRIES_PERSISTENCIA; i++) {
    try {
      await guardarPedidos(PEDIDOS)
      await sincronizarPedidosBot(PEDIDOS)
      return true
    } catch (err) {
      console.error(`[pedidos] Error persistencia (intento ${i + 1}/${MAX_RETRIES_PERSISTENCIA}):`, err)
      if (i < MAX_RETRIES_PERSISTENCIA - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      }
    }
  }
  console.error(`[pedidos] Persistencia fallo despues de ${MAX_RETRIES_PERSISTENCIA} intentos`)
  return false
}

function persistir(): void {
  persistirConRetry().catch(err => {
    console.error('[pedidos] Error persistencia en background:', err)
  })
}

export async function persistirPedidosEngine(): Promise<void> {
  await persistirConRetry()
}

function esPedidoActivo(pedido: PedidoActual): boolean {
  return pedido.estado !== EstadoPedido.ARCHIVADO && pedido.estado !== EstadoPedido.CANCELADO
}

function obtenerPedidosDeCliente(clienteId: string): PedidoActual[] {
  return PEDIDOS.get(clienteId) ?? []
}

function generarId(): string {
  return `ped_${Date.now()}_${++pedidoCounter}`
}

export async function cargarPedidosDesdeBD(): Promise<void> {
  const restaurados = await cargarPedidos()
  for (const [id, pedidos] of restaurados) {
    PEDIDOS.set(id, pedidos)
  }
  if (restaurados.size > 0) {
    console.log(`[pedidos] Restaurados ${restaurados.size} clientes con pedidos activos`)
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
    descripcion: pedido.descripcion ?? 'Pedido creado',
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

const TRANSICIONES_INVALIDAS_NOTIFICADAS = new Map<string, number>()

function emitirEventoTransicionInvalida(pedido: PedidoActual, hasta: EstadoPedido, flujo: string, motivo?: string): void {
  const clave = `${pedido.id}:${hasta}:${flujo}`
  const ahora = Date.now()
  const ultima = TRANSICIONES_INVALIDAS_NOTIFICADAS.get(clave) ?? 0
  if (ahora - ultima < 30 * 60_000) return
  TRANSICIONES_INVALIDAS_NOTIFICADAS.set(clave, ahora)

  eventBus.emit(EventType.PROVIDER_FAILURE, {
    telefono: pedido.telefono ?? '',
    orderId: pedido.id,
    cliente: pedido.nombre ?? '',
    descripcion: `Transición inválida: ${pedido.estado} → ${hasta} (${flujo})${motivo ? ` — ${motivo}` : ''}`,
    contexto: 'Máquina de estados (transitarDesdeFlujo)',
  })
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

  const existentes = obtenerPedidosDeCliente(clienteId)
  existentes.push(pedido)
  PEDIDOS.set(clienteId, existentes)
  persistir()

  eventBus.emit(EventType.ORDER_CREATED, {
    ...buildOrderPayload(pedido),
    descripcion: 'Pedido creado',
  })

  return pedido
}

export function obtenerPedidosActivos(clienteId: string): PedidoActual[] {
  return obtenerPedidosDeCliente(clienteId).filter(esPedidoActivo)
}

export function contarPedidosPorEstado(): Record<string, number> {
  const conteo: Record<string, number> = { ACTIVOS: 0 }
  for (const pedidos of PEDIDOS.values()) {
    for (const pedido of pedidos) {
      if (!esPedidoActivo(pedido)) continue
      conteo.ACTIVOS++
      const estado = pedido.estado ?? EstadoPedido.NUEVO
      conteo[estado] = (conteo[estado] ?? 0) + 1
    }
  }
  return conteo
}

export function listarPedidosActivosGlobales(): { clienteId: string; pedido: PedidoActual }[] {
  const resultado: { clienteId: string; pedido: PedidoActual }[] = []
  for (const [clienteId, pedidos] of PEDIDOS) {
    for (const pedido of pedidos) {
      if (!esPedidoActivo(pedido)) continue
      resultado.push({ clienteId, pedido })
    }
  }
  return resultado
}

export function obtenerPedido(clienteId: string): PedidoActual | null {
  const activos = obtenerPedidosActivos(clienteId)
  return activos[activos.length - 1] ?? null
}

export function obtenerPedidoPorId(pedidoId: string): { clienteId: string; pedido: PedidoActual } | null {
  for (const [clienteId, pedidos] of PEDIDOS) {
    const pedido = pedidos.find(p => p.id === pedidoId && esPedidoActivo(p))
    if (pedido) return { clienteId, pedido }
  }
  return null
}

export function serializarPedidoParaDashboard(clienteId: string, pedido: PedidoActual): PedidoResumenDTO {
  return {
    id: pedido.id ?? '',
    clienteId,
    telefono: pedido.telefono,
    nombre: pedido.nombre,
    estado: pedido.estado,
    estadoFlujo: pedido.estadoFlujo,
    producto: pedido.arreglo?.nombre ?? pedido.productoPersonalizado,
    precio: pedido.precioPersonalizado ?? pedido.arreglo?.precio ?? null,
    precioConfirmadoPor: pedido.precioConfirmadoPor,
    sucursal: pedido.sucursal,
    direccion: pedido.direccion,
    fechaEntrega: pedido.fechaEntrega,
    horaEntrega: pedido.horaEntrega,
    metodoPago: pedido.metodoPago,
    nota: pedido.nota,
    extras: pedido.extras,
    tieneFotoReferencia: !!pedido.fotoReferenciaBase64,
    requiereAtencionEquipo: pedido.estadoFlujo === EstadoFlujo.ESPERANDO_PRECIO_EQUIPO,
    creadoEn: pedido.creadoEn,
    actualizadoEn: pedido.actualizadoEn,
  }
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
  const pedido = obtenerPedido(clienteId)
  if (!pedido || !pedido.estado) return false

  const ok = transitar(pedido, EstadoPedido.ARCHIVADO)
  if (!ok) {
    pedido.estado = EstadoPedido.ARCHIVADO
    pedido.actualizadoEn = new Date().toISOString()
  }

  persistir()
  return true
}

export function archivarSilencioso(clienteId: string): boolean {
  const pedido = obtenerPedido(clienteId)
  if (!pedido) return false
  pedido.estado = EstadoPedido.ARCHIVADO
  pedido.actualizadoEn = new Date().toISOString()
  persistir()
  return true
}

export function cancelarPedido(clienteId: string, motivo?: string): boolean {
  const pedido = obtenerPedido(clienteId)
  if (!pedido || !pedido.estado) return false

  if (!transitar(pedido, EstadoPedido.CANCELADO)) {
    pedido.estado = EstadoPedido.CANCELADO
    pedido.actualizadoEn = new Date().toISOString()
  }

  persistir()
  return true
}

export function transitarDesdeFlujo(clienteId: string, flujo: string, motivo?: string): boolean {
  const pedido = obtenerPedido(clienteId)
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
    queja: EstadoPedido.QUEJA,
  }

  const nuevo = mapping[flujo]
  if (!nuevo) return false

  if (pedido.estado === nuevo) return true

  // Caminar la máquina de estados paso a paso (no saltar estados)
  const camino = encontrarCaminoEstados(pedido.estado, nuevo)
  if (!camino || camino.length === 0) {
    console.error(`[pedidos] ⚠️ transitarDesdeFlujo: sin camino válido ${pedido.estado} → ${nuevo} (${flujo}) para ${clienteId}`)
    emitirEventoTransicionInvalida(pedido, nuevo, flujo, motivo)
    return false
  }

  let ok = true
  for (const estadoIntermedio of camino) {
    const resultado = transitar(pedido, estadoIntermedio)
    if (!resultado) {
      ok = false
      console.error(`[pedidos] ⚠️ transitarDesdeFlujo: fallo en paso ${pedido.estado} → ${estadoIntermedio} (${flujo}) para ${clienteId}`)
      emitirEventoTransicionInvalida(pedido, estadoIntermedio, flujo, motivo)
      break
    }
  }
  return ok
}

function encontrarCaminoEstados(desde: EstadoPedido, hasta: EstadoPedido): EstadoPedido[] {
  if (desde === hasta) return []
  const visitados = new Set<EstadoPedido>()
  const cola: { estado: EstadoPedido; camino: EstadoPedido[] }[] = [{ estado: desde, camino: [] }]

  while (cola.length > 0) {
    const { estado, camino } = cola.shift()!
    if (estado === hasta) return camino
    if (visitados.has(estado)) continue
    visitados.add(estado)

    const siguientes = TRANSICIONES_VALIDAS[estado] ?? []
    for (const sig of siguientes) {
      if (!visitados.has(sig)) {
        cola.push({ estado: sig, camino: [...camino, sig] })
      }
    }
  }
  return []
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
  const pedido = obtenerPedido(clienteId)
  if (!pedido) return
  const existentes = obtenerPedidosDeCliente(clienteId).filter(p => p.id !== pedido.id)
  if (existentes.length === 0) PEDIDOS.delete(clienteId)
  else PEDIDOS.set(clienteId, existentes)
  persistir()
}

export function sincronizarConCaso(pedido: PedidoActual, casoId: string): void {
  pedido.casoId = casoId
  pedido.actualizadoEn = new Date().toISOString()
  persistir()
}

export function limpiarCachesPedidos(): void {
  const ahora = Date.now()
  for (const [clienteId, pedidos] of PEDIDOS) {
    const vigentes = pedidos.filter(pedido => {
      if (pedido.actualizadoEn) {
        const horas = (ahora - new Date(pedido.actualizadoEn).getTime()) / (1000 * 60 * 60)
        return horas <= 72
      }
      return true
    })
    if (vigentes.length === 0) PEDIDOS.delete(clienteId)
    else if (vigentes.length !== pedidos.length) PEDIDOS.set(clienteId, vigentes)
  }
}

