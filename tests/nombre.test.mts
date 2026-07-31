import assert from 'node:assert/strict'
import { parseNombre, pareceNombreCliente, esNombrePlausible } from '../src/parser/nombre.parser.ts'

// Caso Lizet (AGENTS.md ERROR #1): no consumir texto tras la coma.
assert.equal(
  parseNombre('A nombre de Lizet Cervantes Vargas, cree que podría...'),
  'Lizet Cervantes Vargas',
  'ERROR #1: no consumir texto tras la coma'
)
assert.equal(
  parseNombre('Apartar a nombre de María Fernanda López y me avisas'),
  'María Fernanda López',
  'Cortar en conectores'
)
assert.equal(
  parseNombre('se lo aparto a nombre de Juan Pérez'),
  'Juan Pérez',
  'Prefijo "se lo aparto a nombre de"'
)
assert.equal(
  parseNombre('a nombre de Lizet'),
  'Lizet',
  'Nombre simple tras prefijo'
)

// Palabras que no son nombre.
for (const t of ['gracias', 'ok', 'okay', 'si', 'sí', 'vale', 'dale', 'va', 'listo', 'claro', 'bueno', 'ahí', 'ahi', 'luego', 'después', 'despues', 'exacto', 'perfecto', 'adelante', 'porfavor', 'está bien', 'esta bien', 'por favor']) {
  assert.equal(parseNombre(t), null, `"${t}" no debe parsearse como nombre`)
  assert.equal(pareceNombreCliente(t), false, `"${t}" no debe parecer nombre de cliente`)
}

// Límites: mínimo 2 caracteres, máximo 5 palabras.
assert.equal(parseNombre('a nombre de A'), null, 'Una sola letra no es nombre valido')
assert.equal(parseNombre('a nombre de Ana'), 'Ana', 'Nombre corto valido')
assert.equal(
  parseNombre('a nombre de Juan Carlos María José Fernández García'),
  null,
  '6+ palabras no es nombre (max 5)'
)
assert.equal(
  parseNombre('a nombre de Juan Carlos María José Fernández'),
  'Juan Carlos María José Fernández',
  '5 palabras es el maximo permitido'
)

// Los numeros/emojis/URLs despues del nombre se truncan (como con la coma);
// si contaminan el candidato completo (sin prefijo), se rechazan.
assert.equal(parseNombre('a nombre de Juan 123'), 'Juan', 'Numero despues del nombre se trunca')
assert.equal(parseNombre('a nombre de Juan https://x.com'), 'Juan', 'URL despues del nombre se trunca')
assert.equal(parseNombre('a nombre de Juan www.ejemplo.com'), 'Juan', 'www despues del nombre se trunca')
assert.equal(parseNombre('a nombre de Juan 😊'), 'Juan', 'Emoji despues del nombre se trunca')
assert.equal(parseNombre('a nombre de Juan!!'), 'Juan', 'Puntuacion despues del nombre se trunca')
assert.equal(parseNombre('Juan 123'), null, 'Candidato completo con numero se rechaza')
assert.equal(parseNombre('Juan 😊'), null, 'Candidato completo con emoji se rechaza')
assert.equal(parseNombre('https://x.com'), null, 'URL como candidato completo se rechaza')

// Datos limpios siguen siendo validos.
assert.equal(parseNombre('a nombre de José Luis Hernández'), 'José Luis Hernández', 'Nombre con acentos y ñ')
assert.equal(pareceNombreCliente('Lizet Cervantes Vargas'), true, 'Frase de 3 palabras que es nombre real')
assert.equal(pareceNombreCliente('María Fernanda de la Cruz'), true, 'Nombre con conectores sigue siendo nombre')
assert.equal(pareceNombreCliente('necesito un ramo'), false, 'Frase con "necesito" no es nombre')
assert.equal(esNombrePlausible('Lizet Cervantes Vargas'), true, 'esNombrePlausible acepta nombre real')

console.log('nombre.test.mts: ok — parser de nombre cubre casos frontera del plan 4.1')
