import assert from 'node:assert/strict'
import {
  detectarPedidosAtascos,
  detectarCasosAtencion,
  normalizarNovedadIA,
  fusionarNovedades,
} from '../src/novedades/novedad.detector.ts'
import { construirMensajeNovedades, ventanaDiaAnteriorCdmx } from '../src/novedades/novedades.service.ts'
import { TipoNovedad, type Novedad, type NovedadesDiarias } from '../src/novedades/types.ts'
import { EstadoPedido, Prioridad, TipoCaso, type Caso, type PedidoActual } from '../src/models/types.ts'

// ─── detectarPedidosAtascos ──────────────────────────────────────

function pedidoBase(overrides: Partial<PedidoActual>): PedidoActual {
  return { telefono: '+521234567890', ...overrides }
}

let novedades = detectarPedidosAtascos([
  { clienteId: 'c1', pedido: pedidoBase({ estadoFlujo: 'esperando_precio_equipo', productoPersonalizado: 'Ramo de rosas' }) },
  { clienteId: 'c2', pedido: pedidoBase({ telefono: '+521876543210', estadoFlujo: 'esperando_pago', nombre: 'Ana' }) },
  { clienteId: 'c3', pedido: pedidoBase({ telefono: '+521111111111', estadoFlujo: 'esperando_pago', estado: EstadoPedido.ENTREGADO }) },
  { clienteId: 'c4', pedido: pedidoBase({ telefono: '', estadoFlujo: 'esperando_precio_equipo' }) },
  { clienteId: 'c5', pedido: pedidoBase({ estadoFlujo: 'cotizando' }) },
])

assert.equal(novedades.length, 2, 'Solo 2 pedidos atascados deben detectarse')
assert.equal(novedades[0].tipo, TipoNovedad.COTIZACION_PENDIENTE, 'esperando_precio_equipo -> cotizacion_pendiente')
assert.equal(novedades[1].tipo, TipoNovedad.PAGO_PENDIENTE, 'esperando_pago -> pago_pendiente')
assert.equal(novedades[1].cliente, 'Ana', 'Nombre del pedido se arrastra a la novedad')

// ─── detectarCasosAtencion ───────────────────────────────────────

function casoBase(overrides: Partial<Caso>): Caso {
  return {
    id: 'caso-1',
    clienteId: 'c1',
    telefono: '+521234567890',
    tipo: TipoCaso.DUDA,
    estado: 'ACTIVO' as Caso['estado'],
    prioridad: Prioridad.MEDIA,
    creadoEn: new Date().toISOString(),
    ultimaActividad: new Date().toISOString(),
    ...overrides,
  }
}

novedades = detectarCasosAtencion([
  casoBase({ id: 'a', tipo: TipoCaso.QUEJA, prioridad: Prioridad.BAJA }),
  casoBase({ id: 'b', tipo: TipoCaso.DUDA, prioridad: Prioridad.ALTA }),
  casoBase({ id: 'c', tipo: TipoCaso.DUDA, prioridad: Prioridad.MEDIA }),
])

assert.equal(novedades.length, 2, 'Queja y prioridad alta se detectan; media no')
assert.ok(novedades.some(n => n.tipo === TipoNovedad.QUEJA), 'La queja se marca como QUEJA')
assert.ok(novedades.some(n => n.tipo === TipoNovedad.DUDA_SIN_RESPONDER), 'Prioridad alta se marca como duda_sin_responder')

// ─── normalizarNovedadIA ─────────────────────────────────────────

const valida = normalizarNovedadIA({ telefono: '+521234567890', tipo: 'cambio_fecha', resumen: 'pide cambiar a el viernes', prioridad: 'alta' })
assert.ok(valida, 'Novedad IA válida se acepta')
assert.equal(valida!.tipo, TipoNovedad.CAMBIO_FECHA, 'Tipo válido se conserva')
assert.equal(valida!.fuente, 'ia', 'Fuente marcada como ia')
assert.equal(valida!.prioridad, 'alta', 'Prioridad válida se conserva')

const tipoRaro = normalizarNovedadIA({ telefono: '+521234567890', tipo: 'algo_inexistente', resumen: 'tema pendiente' })
assert.equal(tipoRaro!.tipo, TipoNovedad.OTRO, 'Tipo desconocido cae en OTRO')
assert.equal(tipoRaro!.prioridad, 'media', 'Prioridad por defecto es media')

assert.equal(normalizarNovedadIA({ telefono: '', tipo: 'otro', resumen: 'x' }), null, 'Sin teléfono se descarta')
assert.equal(normalizarNovedadIA({ telefono: '+52', tipo: 'otro', resumen: '' }), null, 'Sin resumen se descarta')

// ─── fusionarNovedades ───────────────────────────────────────────

const regla: Novedad = { telefono: '+521234567890', tipo: TipoNovedad.PAGO_PENDIENTE, resumen: 'de reglas', prioridad: 'media', fuente: 'reglas' }
const iaDuplicada: Novedad = { telefono: '+521234567890', tipo: TipoNovedad.PAGO_PENDIENTE, resumen: 'de ia', prioridad: 'baja', fuente: 'ia' }
const iaOtra: Novedad = { telefono: '+521999999999', tipo: TipoNovedad.COTIZACION_PENDIENTE, resumen: 'cotiza gerberas', prioridad: 'media', fuente: 'ia' }

const fusion = fusionarNovedades([regla], [iaDuplicada, iaOtra])
assert.equal(fusion.length, 2, 'Duplicada telefono+tipo se elimina')
assert.ok(fusion.every(n => !(n.telefono === '+521234567890' && n.fuente === 'ia')), 'Gana la versión de reglas')
assert.ok(fusion.some(n => n.telefono === '+521999999999'), 'Distinto teléfono se conserva')

// ─── construirMensajeNovedades ───────────────────────────────────

assert.match(construirMensajeNovedades(null), /No hay novedades/, 'Digest nulo -> mensaje de tranquilidad')

const digest: NovedadesDiarias = {
  fechaAnalizada: '2026-08-19',
  generadaEn: new Date().toISOString(),
  novedades: [
    { telefono: '+521234567890', tipo: TipoNovedad.CAMBIO_FECHA, resumen: 'pide entregar el viernes', prioridad: 'media', fuente: 'ia' },
    { telefono: '+521555555555', cliente: 'Lizet', tipo: TipoNovedad.QUEJA, resumen: 'reclamo por entrega tardía', prioridad: 'alta', fuente: 'reglas' },
  ],
}
const mensaje = construirMensajeNovedades(digest)
assert.match(mensaje, /Novedades del 19\/08\/2026/, 'Encabezado con fecha analizada')
assert.match(mensaje, /\+521555555555\* \(Lizet\): tiene una queja/, 'Formato telefono + etiqueta')
assert.match(mensaje, /\+521234567890\*: intentó cambiar la fecha\/hora/, 'Etiqueta de cambio de fecha')
const idxAlta = mensaje.indexOf('+521555555555')
const idxMedia = mensaje.indexOf('+521234567890')
assert.ok(idxAlta < idxMedia, 'Prioridad alta aparece primero')

// ─── ventanaDiaAnteriorCdmx ──────────────────────────────────────

const ventana = ventanaDiaAnteriorCdmx()
assert.match(ventana.fechaAnalizada, /^\d{4}-\d{2}-\d{2}$/, 'Fecha analizada en formato YYYY-MM-DD')
const duracion = new Date(ventana.finIso).getTime() - new Date(ventana.inicioIso).getTime()
assert.equal(duracion, 24 * 60 * 60_000, 'La ventana cubre exactamente 24 horas')
assert.ok(new Date(ventana.finIso).getTime() < Date.now(), 'La ventana siempre queda en el pasado')

console.log('novedades.test.mts: ok — detector de reglas, fusión y plantilla del digest correctos (DEC-084)')
