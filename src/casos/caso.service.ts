import { Caso, EstadoCaso, TipoCaso, Prioridad } from '../../models/types'
import { eventBus } from '../events/event-bus'
import { EventType } from '../events/types'

const CASOS_ACTIVOS = new Map<string, Caso>()
let casoCounter = 0

function generateCasoId(): string {
  return `caso_${Date.now()}_${++casoCounter}`
}

export function crearCaso(
  clienteId: string,
  telefono: string,
  tipo: TipoCaso,
  prioridad: Prioridad = Prioridad.MEDIA
): Caso {
  const existing = CASOS_ACTIVOS.get(clienteId)

  if (existing && existing.estado === EstadoCaso.ACTIVO) {
    const horasInactivo = (Date.now() - new Date(existing.ultimaActividad).getTime()) / (1000 * 60 * 60)
    if (existing.tipo === tipo && horasInactivo < 24) {
      existing.ultimaActividad = new Date().toISOString()
      return existing
    }
    archivarCaso(existing.id, `Nuevo caso tipo ${tipo} iniciado`)
  }

  const caso: Caso = {
    id: generateCasoId(),
    clienteId,
    telefono,
    tipo,
    estado: EstadoCaso.ACTIVO,
    prioridad,
    creadoEn: new Date().toISOString(),
    ultimaActividad: new Date().toISOString(),
  }

  CASOS_ACTIVOS.set(clienteId, caso)

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

export function archivarCaso(casoId: string, motivo?: string): void {
  for (const [clienteId, caso] of CASOS_ACTIVOS) {
    if (caso.id === casoId) {
      caso.estado = EstadoCaso.ARCHIVADO
      caso.archivadoEn = new Date().toISOString()
      CASOS_ACTIVOS.delete(clienteId)

      eventBus.emit(EventType.CASE_ARCHIVED, {
        caseId: casoId,
        telefono: caso.telefono,
        descripcion: motivo || 'Caso archivado',
      })
      return
    }
  }
}

export function actualizarActividad(caso: Caso): void {
  caso.ultimaActividad = new Date().toISOString()
}

export function detectarCambioTema(
  textoActual: string,
  horasInactivo: number
): boolean {
  if (horasInactivo >= 24) return true

  const soloAgradecimiento = /^(gracias|ok|okay|si|sí|vale|dale|está bien|esta bien|de acuerdo|claro|perfecto|genial|bueno)$/i
  if (soloAgradecimiento.test(textoActual.trim())) return false

  const indicadoresNuevo = /\b(ahora\s+(quiero|necesito|ocupo)|otro\s+(pedido|ramo|arreglo|cosa|tema)|nuevo\s+(pedido|caso)|empezamos\s+de\s+nuevo|desde\s+cero|cambio\s+de\s+tema|es\s+otra\s+(cosa|flor)|ahora\s+(para|es))\b/i
  if (indicadoresNuevo.test(textoActual)) return true

  return false
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
  return TipoCaso.DUDA
}

export function limpiarCachesCasos(): void {
  const ahora = Date.now()
  for (const [clienteId, caso] of CASOS_ACTIVOS) {
    const horasInactivo = (ahora - new Date(caso.ultimaActividad).getTime()) / (1000 * 60 * 60)
    if (horasInactivo > 72) {
      caso.estado = EstadoCaso.ARCHIVADO
      CASOS_ACTIVOS.delete(clienteId)
    }
  }
}
