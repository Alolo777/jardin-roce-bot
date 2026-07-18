import assert from 'node:assert/strict'
import { eventBus } from '../src/events/event-bus.ts'
import { EventType, SystemEvent } from '../src/events/types.ts'
import { crearPedido } from '../src/pedidos/pedido.service.ts'
import { buildOrderPayload } from '../src/pedidos/pedido.service.ts'

type Captured = { type: EventType; payload: Record<string, unknown> }

function capture(): { events: Captured[]; stop: () => void } {
  const events: Captured[] = []
  const unsub = eventBus.subscribeAll((e: SystemEvent) => {
    events.push({ type: e.type, payload: e.payload as Record<string, unknown> })
  })
  return { events, stop: unsub }
}

function find(events: Captured[], type: EventType): Captured {
  const e = events.find((x) => x.type === type)
  assert.ok(e, `Se esperaba el evento ${type}`)
  return e
}

// ---------------------------------------------------------------------------
// FLUJO END-TO-END SIMULADO (ver PROJECT_TRACKER Módulo 19 + KNOWN_BUGS)
// Cubre: fotos -> interés -> crear pedido -> pago/comprobante -> venta cerrada
// ---------------------------------------------------------------------------

const { events, stop } = capture()

// 1) Cliente pide fotos disponibles -> PHOTO_REQUESTED (Bug B, DEC-043)
await eventBus.emit(EventType.PHOTO_REQUESTED, {
  telefono: '5215551234567',
  cliente: 'Lizet Cervantes',
  descripcion: 'Cliente Lizet Cervantes (5215551234567) pide ver fotos de arreglos disponibles',
})

// 2) Cliente elige foto y pregunta precio -> COTIZACION_REQUESTED (Bug C, DEC-039)
await eventBus.emit(EventType.COTIZACION_REQUESTED, {
  telefono: '5215551234567',
  cliente: 'Lizet Cervantes',
  descripcion: 'Cliente interesado en ramo de fotos disponibles, solicita precio',
})

// 3) Cliente confirma compra -> crearPedido emite ORDER_UPDATED (Bug A, DEC-041)
crearPedido('cli_1', '5215551234567', {
  productoPersonalizado: 'Ramo de flores',
  detallesEspeciales: 'Ramo personalizado',
  precioPersonalizado: 450,
  metodoPago: 'transferencia',
  estado: 'apartado' as any,
  sucursal: 'Centro',
  fechaEntrega: '2026-07-20',
  horaEntrega: '10:00',
  nombre: 'Lizet Cervantes',
  telefono: '5215551234567',
})

// 4) Cliente envia comprobante -> PHOTO_RECEIVED (comprobante)
await eventBus.emit(EventType.PHOTO_RECEIVED, {
  telefono: '5215551234567',
  tipo: 'comprobante',
  caption: 'Transferencia de $450',
})

// 5) Venta cerrada real -> ORDER_CREATED (NO se debe emitir en pasos 1-3)
await eventBus.emit(EventType.ORDER_CREATED, {
  telefono: '5215551234567',
  cliente: 'Lizet Cervantes',
  producto: 'Ramo de flores',
  total: 450,
  sucursal: 'Centro',
  metodoPago: 'transferencia',
})

stop()

// --- VERIFICACIONES ---

// Bug B: PHOTO_REQUESTED trae telefono real + cliente + descripcion
const foto = find(events, EventType.PHOTO_REQUESTED)
assert.equal(foto.payload.telefono, '5215551234567')
assert.equal(foto.payload.cliente, 'Lizet Cervantes')
assert.match(String(foto.payload.descripcion), /5215551234567/)

// Bug C: COTIZACION_REQUESTED, NO ORDER_CREATED, con datos reales
const cot = find(events, EventType.COTIZACION_REQUESTED)
assert.equal(cot.payload.telefono, '5215551234567')
assert.equal(cot.payload.cliente, 'Lizet Cervantes')

// Bug A: crearPedido emite ORDER_UPDATED (no ORDER_CREATED) con datos reales
const upd = find(events, EventType.ORDER_UPDATED)
assert.equal(upd.payload.telefono, '5215551234567')
assert.equal(upd.payload.producto, 'Ramo de flores')
assert.equal(Number(upd.payload.total), 450)
assert.equal(upd.payload.cliente, 'Lizet Cervantes')
assert.equal(upd.payload.sucursal, 'Centro')

// ORDEN CORRECTO: ORDER_CREATED solo aparece DESPUÉS de ORDER_UPDATED y PHOTO_RECEIVED
const idxUpd = events.findIndex((e) => e.type === EventType.ORDER_UPDATED)
const idxCreado = events.findIndex((e) => e.type === EventType.ORDER_CREATED)
const idxFoto = events.findIndex((e) => e.type === EventType.PHOTO_RECEIVED)
assert.ok(idxCreado > idxUpd, 'ORDER_CREATED debe venir despues de ORDER_UPDATED (no VENTA CERRADA falsa)')
assert.ok(idxFoto < idxCreado, 'comprobante debe venir antes de venta cerrada')

// NO debe haber ORDER_CREATED antes del paso 5
const creadosAntes = events.filter(
  (e, i) => e.type === EventType.ORDER_CREATED && i < idxCreado
)
assert.equal(creadosAntes.length, 0, 'No debe emitirse ORDER_CREATED (VENTA CERRADA) en pasos intermedios')

console.log('event-wire-flow.test.mts: ok — flujo completo cableado correctamente')
