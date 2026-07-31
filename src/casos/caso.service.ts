import { Caso, EstadoCaso, TipoCaso, Prioridad, Intencion } from '../models/types'
import { eventBus } from '../events/event-bus'
import { EventType } from '../events/types'
import { insertarCaso, actualizarCaso, cargarCasosActivos } from './caso.repository'
import { detectarCambioTema, calcularHorasInactivo, INACTIVIDAD_CAMBIO_TEMA_HR, INACTIVIDAD_ARCHIVAR_CASO_HR } from '../conversation/conversation.service'
import { analizarIntencion } from '../decision/decision.engine'

const CASOS_ACTIVOS = new Map<string, Caso>()
let casoCounter = 0

function generateCasoId(): string {
  return `caso_${Date.now()}_${++casoCounter}`
}

export async function cargarCasosDesdeBD(): Promise<void> {
  const restaurados = await cargarCasosActivos()
  for (const [clienteId, caso] of restaurados) {
    CASOS_ACTIVOS.set(clienteId, caso)
  }
  if (restaurados.size > 0) {
    console.log(`[casos] Restaurados ${restaurados.size} casos activos`)
  }
}

export function crearCaso(
  clienteId: string,
  telefono: string,
  tipo?: TipoCaso,
  prioridad?: Prioridad,
  opciones?: { decisionIntencion?: Intencion }
): Caso {
  const tipoFinal = tipo ?? (opciones?.decisionIntencion ? mapearIntencionATipo(opciones.decisionIntencion) : TipoCaso.DUDA)
  const prioridadFinal = prioridad ?? Prioridad.MEDIA
  const existing = CASOS_ACTIVOS.get(clienteId)

  if (existing && existing.estado === EstadoCaso.ACTIVO) {
    const horasInactivo = calcularHorasInactivo(existing.ultimaActividad)
    if (existing.tipo === tipoFinal && horasInactivo < INACTIVIDAD_CAMBIO_TEMA_HR) {
      existing.ultimaActividad = new Date().toISOString()
      actualizarCaso(existing)
      return existing
    }
    archivarCaso(existing.id, `Nuevo caso tipo ${tipoFinal} iniciado`)
  }

  const caso: Caso = {
    id: generateCasoId(),
    clienteId,
    telefono,
    tipo: tipoFinal,
    estado: EstadoCaso.ACTIVO,
    prioridad: prioridadFinal,
    creadoEn: new Date().toISOString(),
    ultimaActividad: new Date().toISOString(),
  }

  CASOS_ACTIVOS.set(clienteId, caso)
  insertarCaso(caso)

  eventBus.emit(EventType.CASE_CREATED, {
    caseId: caso.id,
    telefono,
    prioridad: caso.prioridad,
    descripcion: `Nuevo caso tipo ${caso.tipo}`,
  })

  return caso
}

export function obtenerCasoActivo(clienteId: string): Caso | null {
  const caso = CASOS_ACTIVOS.get(clienteId)
  if (!caso) return null
  if (caso.estado !== EstadoCaso.ACTIVO) {
    CASOS_ACTIVOS.delete(clienteId)
    return null
  }
  return caso
}

export function obtenerCasoPorId(casoId: string): Caso | null {
  for (const caso of CASOS_ACTIVOS.values()) {
    if (caso.id === casoId) return caso
  }
  return null
}

export function buscarCasosPorTelefono(telefono: string): Caso[] {
  const resultados: Caso[] = []
  for (const caso of CASOS_ACTIVOS.values()) {
    if (caso.telefono === telefono) resultados.push(caso)
  }
  return resultados
}

export function contarCasosActivos(): number {
  return CASOS_ACTIVOS.size
}

export function listarCasosRequierenAtencion(): Caso[] {
  const casos: Caso[] = []
  for (const caso of CASOS_ACTIVOS.values()) {
    if (caso.tipo === TipoCaso.QUEJA || caso.prioridad === Prioridad.ALTA || caso.prioridad === Prioridad.CRITICA) {
      casos.push(caso)
    }
  }
  return casos
}

export function contarCasosRequierenAtencionHumana(): number {
  return listarCasosRequierenAtencion().length
}

export function archivarCaso(casoId: string, motivo?: string): void {
  for (const [clienteId, caso] of CASOS_ACTIVOS) {
    if (caso.id === casoId) {
      caso.estado = EstadoCaso.ARCHIVADO
      caso.archivadoEn = new Date().toISOString()
      CASOS_ACTIVOS.delete(clienteId)
      actualizarCaso(caso)

      eventBus.emit(EventType.CASE_ARCHIVED, {
        caseId: casoId,
        telefono: caso.telefono,
        descripcion: motivo || 'Caso archivado',
      })
      return
    }
  }
}

export function reabrirCaso(casoId: string): Caso | null {
  for (const [clienteId, caso] of CASOS_ACTIVOS) {
    if (caso.id === casoId && caso.estado === EstadoCaso.ARCHIVADO) {
      caso.estado = EstadoCaso.ACTIVO
      caso.archivadoEn = undefined
      caso.ultimaActividad = new Date().toISOString()
      CASOS_ACTIVOS.set(clienteId, caso)
      actualizarCaso(caso)
      return caso
    }
  }
  return null
}

export function actualizarActividad(caso: Caso): void {
  caso.ultimaActividad = new Date().toISOString()
  actualizarCaso(caso)
}

export function actualizarTipoCaso(caso: Caso, nuevoTipo: TipoCaso): void {
  if (caso.tipo === nuevoTipo) return
  const anterior = caso.tipo
  caso.tipo = nuevoTipo
  caso.ultimaActividad = new Date().toISOString()
  actualizarCaso(caso)

  eventBus.emit(EventType.CASE_CREATED, {
    caseId: caso.id,
    telefono: caso.telefono,
    prioridad: caso.prioridad,
    descripcion: `Caso actualizado: ${anterior} → ${nuevoTipo}`,
  })
}

export function actualizarPrioridad(caso: Caso, nuevaPrioridad: Prioridad): void {
  if (caso.prioridad === nuevaPrioridad) return
  caso.prioridad = nuevaPrioridad
  caso.ultimaActividad = new Date().toISOString()
  actualizarCaso(caso)
}

export function asociarPedido(caso: Caso, pedidoId: string): void {
  caso.pedidoId = pedidoId
  caso.ultimaActividad = new Date().toISOString()
  actualizarCaso(caso)
}

export function asociarCotizacion(caso: Caso, cotizacionId: string): void {
  caso.cotizacionId = cotizacionId
  caso.ultimaActividad = new Date().toISOString()
  actualizarCaso(caso)
}

export { detectarCambioTema } from '../conversation/conversation.service'

function mapearIntencionATipo(intencion: Intencion): TipoCaso {
  switch (intencion) {
    case Intencion.COTIZACION:
    case Intencion.PRECIO:
    case Intencion.CATALOGO:
    case Intencion.FOTOS:
    case Intencion.PERSONALIZADO:
      return TipoCaso.COTIZACION
    case Intencion.PEDIDO:
    case Intencion.PAGO:
    case Intencion.COMPROBANTE:
    case Intencion.TRANSFERENCIA:
    case Intencion.ENVIO:
    case Intencion.RECOGER:
    case Intencion.CAMBIO:
      return TipoCaso.PEDIDO
    case Intencion.QUEJA:
    case Intencion.CANCELACION:
      return TipoCaso.QUEJA
    case Intencion.POSTVENTA:
      return TipoCaso.POSTVENTA
    case Intencion.UBICACION:
    case Intencion.HORARIOS:
      return TipoCaso.INFORMACION
    case Intencion.HUMANO:
      return TipoCaso.DUDA
    default:
      return TipoCaso.DUDA
  }
}

export function clasificarTipoCaso(texto: string): TipoCaso {
  if (/\b(queja|molest[oa]|reclamo|devoluci[oó]n|reembolso|mal|pésimo|p[eé]simo|incumplido|cancel[ae]r|cancelaci[oó]n|anular|cancelado)\b/i.test(texto)) {
    return TipoCaso.QUEJA
  }
  if (/\b(gracias|qued[oó]|me\s+encant[oó]|hermos[oa]|bell[oa]|precioso)\b/i.test(texto)) {
    return TipoCaso.POSTVENTA
  }
  if (/\b(cu[aá]nto\s+cuesta|precio|saldr[ií]a|cat[aá]logo|cotizaci[oó]n|cotizar|quiero\s+un\s+ramo|quisiera|me\s+gustar[ií]a|personalizado)\b/i.test(texto)) {
    return TipoCaso.COTIZACION
  }
  if (/\b(lo\s+quiero|aparta|reserva|me\s+interesa|necesito|d[aó]nd[ae]\s+pago|c[uú]enta|transferir|pagar|apartar)\b/i.test(texto)) {
    return TipoCaso.PEDIDO
  }
  if (/\b(horarios|ubicaci[oó]n|domicilio|env[ií]o|tel[eé]fono|direcci[oó]n|calle|avenida|estacionamiento)\b/i.test(texto)) {
    return TipoCaso.INFORMACION
  }

  const decision = analizarIntencion({ texto, horasInactivo: 0 })
  return mapearIntencionATipo(decision.intencion)
}

export function limpiarCachesCasos(): void {
  const ahora = Date.now()
  for (const [clienteId, caso] of CASOS_ACTIVOS) {
    const horasInactivo = calcularHorasInactivo(caso.ultimaActividad)
    if (horasInactivo > INACTIVIDAD_ARCHIVAR_CASO_HR) {
      caso.estado = EstadoCaso.ARCHIVADO
      CASOS_ACTIVOS.delete(clienteId)
      actualizarCaso(caso)
    }
  }
}
