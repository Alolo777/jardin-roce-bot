import assert from 'node:assert/strict'
import { validarRespuestaIA, sanitizarRespuestaIA, extraerPreciosRespuesta } from '../src/validators/response.validator.ts'

const CONTEXTO = [
  '[REGLAS VALIDADAS POR EL BACKEND]',
  '## Horarios',
  '- Lunes a viernes: 10:00 a 19:00',
  '- Sábado y domingo: 10:00 a 17:00',
  '## Sucursales',
  '- Centro: https://maps.app.goo.gl/GN9yPJZZjQEyHFWXA',
  '- Norte: https://maps.app.goo.gl/DeQdJJ3wp1zfhRU98',
  '## Flores individuales (precios referenciales)',
  '- Rosa: $25 c/u | Hortensia: $40 c/u',
  '- Desde $60 MXN se arma algo sencillo',
  '[PEDIDO: Estado: PRECIO_CONFIRMADO | Arreglo: Ramo de rosas ($350) | Fecha entrega: 5 de agosto]',
].join('\n')

// 1) Precios inventados se rechazan.
let r = validarRespuestaIA('Serían $1200 por ese ramo.', CONTEXTO)
assert.equal(r.valido, false, 'Precio alto no verificado en contexto debe rechazarse')
assert.match(r.razon ?? '', /Precio \$1200/, 'Razon debe mencionar el precio')

// Precio presente en contexto (referencia) se acepta.
r = validarRespuestaIA('La rosa suelta cuesta $25.', CONTEXTO)
assert.equal(r.valido, true, 'Precio referencial presente en contexto debe aceptarse')

// Total derivado de suma de precios del contexto se acepta.
r = validarRespuestaIA('Serían $350 por el ramo.', CONTEXTO)
assert.equal(r.valido, true, 'Total que coincide con precio del pedido debe aceptarse')

// 2) Confirmacion de horario fuera de rango se rechaza.
r = validarRespuestaIA('Sí podemos tenerlo listo a las 8:30.', CONTEXTO)
assert.equal(r.valido, false, 'Confirmar horario antes de apertura debe rechazarse')
assert.match(r.razon ?? '', /fuera del horario/, 'Razon debe indicar horario fuera de rango')

// Horario dentro de rango sin confirmacion se acepta.
r = validarRespuestaIA('Podrías recoger a las 15:00.', CONTEXTO)
assert.equal(r.valido, true, 'Mencion de hora sin confirmar debe aceptarse')

// BUG-022: formato 12 horas — "3:00 pm" es 15:00 y debe ACEPTARSE
// (antes se interpretaba como 3:00 AM y se rechazaba).
r = validarRespuestaIA('Sí, podemos tenerlo listo a las 3:00 pm.', CONTEXTO)
assert.equal(r.valido, true, 'Confirmar horario en 12h dentro de rango (3:00 pm) debe aceptarse')

// BUG-022: "7:00 am" es antes de apertura y debe RECHAZARSE.
r = validarRespuestaIA('Sí, podemos tenerlo listo a las 7:00 am.', CONTEXTO)
assert.equal(r.valido, false, 'Confirmar horario en 12h antes de apertura debe rechazarse')
assert.match(r.razon ?? '', /fuera del horario/, 'Razon debe indicar horario fuera de rango')

// BUG-022: "10:00 am" es la apertura (10:00) y debe ACEPTARSE.
r = validarRespuestaIA('Podemos tenerlo listo a las 10:00 am.', CONTEXTO)
assert.equal(r.valido, true, 'Confirmar horario en 12h en apertura debe aceptarse')

// 3) Prometer inventario sin respaldo se rechaza.
r = validarRespuestaIA('Sí, tenemos ese ramo disponible.', CONTEXTO)
assert.equal(r.valido, false, 'Confirmar disponibilidad sin inventario debe rechazarse')
assert.match(r.razon ?? '', /inventario/, 'Razon debe indicar inventario')

// 4) Confirmar entrega con fecha sin respaldo se rechaza.
r = validarRespuestaIA('Se entrega el 12 de diciembre, sin problema.', CONTEXTO)
assert.equal(r.valido, false, 'Confirmar entrega con fecha no registrada debe rechazarse')
assert.match(r.razon ?? '', /entrega/, 'Razon debe indicar entrega')

// 5) Sucursal no reconocida se rechaza; sucursal existente se acepta.
r = validarRespuestaIA('Te esperamos en la sucursal Guadalajara.', CONTEXTO)
assert.equal(r.valido, false, 'Sucursal no reconocida debe rechazarse')
assert.match(r.razon ?? '', /Sucursal no reconocida/, 'Razon debe indicar sucursal no reconocida')

r = validarRespuestaIA('Te esperamos en la sucursal Centro.', CONTEXTO)
assert.equal(r.valido, true, 'Sucursal existente debe aceptarse')

// Respuesta limpia sin alucinaciones se acepta.
r = validarRespuestaIA('Claro, consulto con el equipo y te confirmo el precio. 🌷', CONTEXTO)
assert.equal(r.valido, true, 'Respuesta neutra debe aceptarse')

// sanitizarRespuestaIA quita markdown y storage links.
const limpio = sanitizarRespuestaIA('Mira [esto](https://xyz.supabase.co/storage/v1/a) ![alt](img)')
assert.equal(limpio.includes('supabase.co'), false, 'Sanitizar debe quitar links de storage')
assert.equal(limpio.includes('[esto]'), false, 'Sanitizar debe quitar markdown de link')

// extraerPreciosRespuesta detecta flor con precio que se desvía del referencial.
const precios = extraerPreciosRespuesta('El ramo de rosas sale en $32')
assert.ok(precios.some(p => p.producto === 'rosa' && Math.abs(p.precio - 32) <= 1 && p.confianza === 'baja'), 'Debe detectar rosa ~$32 como sospechosa')

console.log('response.validator.test.mts: ok — cubre casos del plan 4.2')
