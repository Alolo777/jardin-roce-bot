import assert from 'node:assert/strict'
import { buildTelegramMessage } from '../src/notification-engine/template.builder.ts'
import type { DatosVerificados } from '../src/notification-engine/types.ts'
import type { EventPayload } from '../src/events/types.ts'

// Base de datos verificados vacia para aislar el test de la DB.
const verifiedVacio = (): DatosVerificados => ({
  nombre: null,
  sucursal: null,
  fecha: null,
  hora: null,
  precio: null,
  producto: null,
  estado: null,
  metodoPago: null,
  telefono: '5215512345678',
  pedidoId: null,
  casoId: null,
  prioridad: 'alta',
  requiereRevision: false,
  razonRevision: null,
  advertencias: [],
})

const pipelineBase = {
  accion: 'NOTIFICAR' as const,
  razonBloqueo: null,
  conflictos: [],
  advertencias: [],
  ruleViolations: [],
  message: null,
}

function payloadBase(): EventPayload {
  return {
    telefono: '5215512345678',
    cliente: 'Lizet',
    producto: 'Ramosa 100 peces',
    total: 500,
    sucursal: 'Centro',
    metodoPago: 'transferencia',
    descripcion: '',
  }
}

// 1) VENTA CERRADA (PAYMENT_RECEIVED) debe mostrar fecha y hora de entrega cuando existen.
{
  const verified = verifiedVacio()
  verified.fecha = '2026-08-10'
  verified.hora = '14:00'
  const msg = buildTelegramMessage('PAYMENT_RECEIVED' as any, payloadBase(), verified, pipelineBase)
  assert.ok(msg.includes('2026\\-08\\-10'), 'Venta cerrada incluye fecha de entrega (escapada)')
  assert.ok(msg.includes('14:00'), 'Venta cerrada incluye hora de entrega')
  assert.ok(msg.includes('*VENTA CERRADA*'), 'Encabeza con VENTA CERRADA')
}

// 2) PAYMENT_PENDING tambien debe arrastrar la fecha/hora.
{
  const verified = verifiedVacio()
  verified.fecha = '2026-08-12'
  verified.hora = '17:00'
  const msg = buildTelegramMessage('PAYMENT_PENDING' as any, payloadBase(), verified, pipelineBase)
  assert.ok(msg.includes('2026\\-08\\-12'), 'Pago pendiente incluye fecha de entrega (escapada)')
  assert.ok(msg.includes('17:00'), 'Pago pendiente incluye hora de entrega')
}

// 3) Sin fecha/hora, no debe aparecer la linea vacia.
{
  const msg = buildTelegramMessage('PAYMENT_RECEIVED' as any, payloadBase(), verifiedVacio(), pipelineBase)
  assert.ok(!msg.includes('📅 '), 'Sin fecha no se renderiza linea de fecha')
}

console.log('template-payment.test.mts: ok — fecha/hora arrastradas a los templates operativos')