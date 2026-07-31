import assert from 'node:assert/strict'
import { formatearReclamaciones } from '../src/reclamaciones/reclamacion.service.ts'

const lista = [
  { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001', cliente_telefono: '+521234567890', tipo: 'queja' as const, descripcion: 'El ramo llegó maltratado y se ve marchito.', arreglo_referencia: 'Ramo de rosas', estado: 'pendiente' as const, creado_en: '2026-07-31T12:00:00Z' },
  { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0002', cliente_telefono: '+529999999999', tipo: 'cancelacion' as const, descripcion: 'Ya no lo necesito para ese día.', estado: 'pendiente' as const, creado_en: '2026-07-31T10:00:00Z' },
]

const texto = formatearReclamaciones(lista)
assert.ok(texto.includes('aaaaaaa'), 'Incluye el id truncado de la primera reclamación')
assert.ok(texto.includes('⚠️ Queja'), 'Mapea tipo queja')
assert.ok(texto.includes('❌ Cancelación'), 'Mapea tipo cancelacion')
assert.ok(texto.includes('Ramo de rosas'), 'Incluye arreglo_referencia')
assert.ok(texto.includes('+521234567890'), 'Incluye teléfono')
assert.ok(texto.length > 100, 'El texto formateado tiene contenido')

const vacio = formatearReclamaciones([])
assert.equal(vacio, '📭 No hay reclamaciones pendientes.', 'Lista vacía devuelve mensaje amigable')

console.log('reclamaciones.test.mts: ok — formateo de reclamaciones correcto')
