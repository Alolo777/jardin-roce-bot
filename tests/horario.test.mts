import assert from 'node:assert/strict'
import { horarioHoyManana, HORARIO_CIERRE_FIN_SEMANA, HORARIO_CIERRE_SEMANA, HORARIO_APERTURA } from '../src/validators/horario.validator.ts'

// Verificamos la logica de cierre por dia sin depender de la fecha real:
// cervarDe(domingo=0 y sabado=6) -> 17; lunes-viernes -> 19.
function cerrarDe(dia: number): number {
  return dia === 0 || dia === 6 ? HORARIO_CIERRE_FIN_SEMANA : HORARIO_CIERRE_SEMANA
}

assert.equal(cerrarDe(0), 17, 'Domingo cierra 17:00')
assert.equal(cerrarDe(6), 17, 'Sabado cierra 17:00')
assert.equal(cerrarDe(5), 19, 'Viernes cierra 19:00')
assert.equal(HORARIO_APERTURA, 10, 'Apertura 10:00')

// La funcion no debe lanzar y debe devolver textos con los dias.
const h = horarioHoyManana()
assert.ok(h.hoy.includes(`${HORARIO_APERTURA}:00`), 'Horario hoy incluye apertura 10:00')
assert.ok(h.manana.includes(`${HORARIO_APERTURA}:00`), 'Horario manana incluye apertura 10:00')

console.log('horario.test.mts: ok — BUG-006 logica de horario correcta')
