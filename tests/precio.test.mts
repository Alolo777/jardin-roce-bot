import assert from 'node:assert/strict'
import { parsePrecio } from '../src/parser/precio.parser.ts'

// Frases comunes del equipo que un empleado escribe en el chat del cliente.
// Antes este parser solo reconocía precios con "$" o con palabras clave muy
// limitadas; por eso el bot seguía diciendo "esperando confirmación del equipo"
// aunque el equipo ya había dado el precio real.
for (const [texto, esperado] of [
  ['Son $450', 450],
  ['Son 450', 450],
  ['Queda en $450', 450],
  ['Queda en 450', 450],
  ['Quedó en 450', 450],
  ['Se queda en 450', 450],
  ['Cuesta 450', 450],
  ['Te sale en 450', 450],
  ['Saldría 450', 450],
  ['El precio es 450', 450],
  ['Total: 450', 450],
  ['$450', 450],
  ['450', 450],
  ['450 pesos', 450],
  ['El ramo aprox. 450', 450],
] as const) {
  assert.equal(parsePrecio(texto), esperado, `"${texto}" debería parsearse como ${esperado}`)
}

// Textos que no contienen un precio no deben parsearse.
for (const texto of ['gracias', 'ok', 'okay', 'hola', 'buenas tardes', 'Sin precio por ahora', 'No tenemos ese ramo', 'Lo checo y te aviso']) {
  assert.equal(parsePrecio(texto), null, `"${texto}" no debe parsearse como precio`)
}

console.log('precio.test.mts: ok — parser de precio cubre respuestas reales del equipo')
