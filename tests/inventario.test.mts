import assert from 'node:assert/strict'
import { obtenerTextoDisponibilidad } from '../src/config/inventario.service.ts'
import { buildValidatedRulesSection } from '../src/openai/prompt.builder.ts'
import { validarRespuestaIA, esProductoMencionado } from '../src/validators/response.validator.ts'
import type { ProductoDetalle } from '../src/models/types.ts'

const INVENTARIO_MOCK: ProductoDetalle[] = [
  { id: '1', nombre: 'Ramo de rosas', precio: 350, categoria: 'ramo', disponible: true, existencias: 5 },
  { id: '2', nombre: 'Rosa individual', precio: 25, categoria: 'flor', disponible: true, existencias: 30 },
  { id: '3', nombre: 'Corona funeraria', precio: 900, categoria: 'corona', disponible: false, existencias: 0 },
]
const DISPONIBLE_MOCK = INVENTARIO_MOCK.filter(p => p.disponible && (p.existencias ?? 0) > 0)

// Sin inventario cargado (tabla vacía/ausente), el texto de disponibilidad es null
// y el prompt no debe incluir la sección de disponibilidad.
const textoSinInventario = obtenerTextoDisponibilidad()
assert.equal(textoSinInventario, null, 'Sin inventario no debe haber texto de disponibilidad')

const reglas = buildValidatedRulesSection()
assert.ok(reglas.includes('[REGLAS VALIDADAS POR EL BACKEND]'), 'El prompt incluye reglas del backend')
assert.ok(!reglas.includes('[PRODUCTOS DISPONIBLES]'), 'Sin inventario no debe inyectarse la lista de productos')

// Sin inventario cargado, el validator sigue rechazando confirmar stock sin respaldo.
let r = validarRespuestaIA('Sí, tenemos ese ramo disponible.', '')
assert.equal(r.valido, false, 'Confirmar stock sin inventario cargado debe rechazarse')
assert.match(r.razon ?? '', /inventario/, 'Razon debe indicar inventario')

r = validarRespuestaIA('Sí, tenemos rosas disponibles.', '')
assert.equal(r.valido, false, 'Sin inventario, aun mencionando flores, debe rechazarse (no hay datos)')

// esProductoMencionado: con inventario disponible detecta mención de un producto real.
assert.equal(esProductoMencionado('Sí, tenemos ramos de rosas', DISPONIBLE_MOCK), true, 'Detecta "ramo de rosas"')
assert.equal(esProductoMencionado('Sí, tenemos rosas', DISPONIBLE_MOCK), true, 'Detecta "rosa" (singularizado)')
assert.equal(esProductoMencionado('Sí, tenemos girasoles', DISPONIBLE_MOCK), false, 'No detecta producto fuera del inventario')
assert.equal(esProductoMencionado('Sí, tenemos coronas funerarias', DISPONIBLE_MOCK), false, 'No cuenta producto no disponible')

console.log('inventario.test.mts: ok — sin inventario no se promete stock; con inventario detecta productos reales')
