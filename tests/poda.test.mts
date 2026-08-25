import assert from 'node:assert/strict'
import { decidirPoda } from '../src/pedidos/poda.service.ts'
import { EstadoPedido, type PedidoActual } from '../src/models/types.ts'

function pedido(overrides: Partial<PedidoActual>): PedidoActual {
  const dias = overrides._dias ?? 0
  delete (overrides as any)._dias
  return {
    telefono: '+521234567890',
    estado: EstadoPedido.COTIZANDO,
    actualizadoEn: new Date(Date.now() - dias * 86_400_000).toISOString(),
    ...overrides,
  }
}

// Huérfano sin teléfono → archivar directo
assert.equal(decidirPoda(pedido({ telefono: '', _dias: 0 })), 'archivar', 'Sin teléfono se archiva')

// Cotizaciones: 7 días
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.COTIZANDO, _dias: 6 })), null, 'Cotización 6d se queda')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.NUEVO, _dias: 7 })), 'archivar', 'NUEVO 7d se archiva')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.PRECIO_CONFIRMADO, _dias: 20 })), 'archivar', 'PRECIO_CONFIRMADO viejo se archiva')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.ESPERANDO_DATOS, _dias: 7 })), 'archivar', 'ESPERANDO_DATOS 7d se archiva')

// Apartado / esperando pago: archivo a los 10 días, SIN recordatorios (enmienda DEC-090a)
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.APARTADO, _dias: 4 })), null, 'Apartado 4d tranquilo')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.APARTADO, _dias: 5 })), null, 'Apartado 5d NO genera recordatorio (silencioso)')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.ESPERANDO_PAGO, _dias: 9 })), null, 'Esperando pago 9d tranquilo')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.APARTADO, _dias: 10 })), 'archivar', 'Apartado 10d se archiva')

// LISTO y ENTREGADO
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.LISTO, _dias: 29 })), null, 'LISTO 29d se espera')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.LISTO, _dias: 30 })), 'archivar', 'LISTO 30d se archiva')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.ENTREGADO, _dias: 7 })), 'archivar', 'ENTREGADO 7d se archiva')

// Nunca automático
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.EN_PRODUCCION, _dias: 60 })), null, 'EN_PRODUCCION nunca automático')
assert.equal(decidirPoda(pedido({ estado: EstadoPedido.QUEJA, _dias: 60 })), null, 'QUEJA nunca automático')

console.log('poda.test.mts: ok — política de poda automática correcta (DEC-090)')
