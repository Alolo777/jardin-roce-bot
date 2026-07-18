import { EventType } from '../events/types'
import type { EventPayload } from '../events/types'
import type { TimelineData } from './types'
import type { DatosExtraidos, CampoExtraido } from './types'

const EVENTOS_CRITICOS: EventType[] = [
  EventType.HUMAN_REQUIRED,
  EventType.CUSTOMER_ANGRY,
  EventType.CUSTOMER_WAITING,
  EventType.PROVIDER_FAILURE,
  EventType.BOT_DISCONNECTED,
]

const EVENTOS_ALTA_PRIORIDAD: EventType[] = [
  EventType.PAYMENT_RECEIVED,
  EventType.PAYMENT_CONFIRMED,
  EventType.ORDER_CREATED,
  EventType.ORDER_READY,
  EventType.DELIVERY_COMPLETED,
  EventType.CANCELACION_REQUESTED,
]

export function determinarPrioridad(
  eventType: EventType,
  timeline: TimelineData
): 'baja' | 'media' | 'alta' | 'critica' {
  if (EVENTOS_CRITICOS.includes(eventType)) return 'critica'
  if (EVENTOS_ALTA_PRIORIDAD.includes(eventType)) return 'alta'
  const pedidoAny = timeline.pedido as Record<string, any> | null
  if (pedidoAny?.requiereRevision) return 'alta'
  return 'media'
}

function extraerConConfianza(
  valor: string | number | null | undefined,
  fuente: 'evento' | 'timeline',
  confianzaBase: number
): { valor: string | number | null; confianza: number; fuente: 'evento' | 'timeline' } {
  if (!valor || (typeof valor === 'string' && valor.trim() === '')) {
    return { valor: null, confianza: 0, fuente }
  }
  const valorStr = String(valor).trim()
  if (valorStr === '0' || valorStr === 'Por definir' || valorStr === 'Por confirmar') {
    return { valor: null, confianza: 0.1, fuente }
  }
  return { valor: valorStr, confianza: confianzaBase, fuente }
}

function detectarNombreInvalido(nombre: string | null | undefined): CampoExtraido {
  if (!nombre || String(nombre).trim() === '') {
    return { valor: null, confianza: 0, fuente: 'evento', advertencia: 'Nombre vacío' }
  }

  const nombreStr = String(nombre).trim()

  if (/[,;.]/.test(nombreStr) && !nombreStr.endsWith('.')) {
    const truncado = nombreStr.split(/[,;.]+/)[0].trim()
    return {
      valor: truncado,
      confianza: 0.7,
      fuente: 'evento',
      advertencia: `Nombre truncado por separador: original="${nombreStr}"`,
    }
  }

  if (/^(me\s+pasa|verificar|cliente|por\s+definir|sin\s+nombre)$/i.test(nombreStr)) {
    return { valor: null, confianza: 0, fuente: 'evento', advertencia: 'Nombre genérico no válido' }
  }

  if (nombreStr.length > 60) {
    return { valor: nombreStr.substring(0, 60), confianza: 0.5, fuente: 'evento', advertencia: 'Nombre truncado por longitud' }
  }

  return { valor: nombreStr, confianza: 0.9, fuente: 'evento' }
}

export function extractDecision(
  eventType: EventType,
  payload: EventPayload,
  timeline: TimelineData
): DatosExtraidos {
  const prioridad = determinarPrioridad(eventType, timeline)

  const eventoNombre = payload.cliente
  const timelineNombre = timeline.pedido?.nombre

  const nombre = detectarNombreInvalido(
    eventoNombre && eventoNombre !== 'Cuenta vinculada'
      ? eventoNombre
      : timelineNombre
  )

  const precioExtraido = extraerConConfianza(
    payload.total ?? timeline.pedido?.precioPersonalizado,
    payload.total ? 'evento' : 'timeline',
    0.8
  )

  const productoExtraido = extraerConConfianza(
    payload.producto ?? timeline.pedido?.arreglo?.nombre,
    payload.producto ? 'evento' : 'timeline',
    0.7
  )

  const sucursalExtraida = extraerConConfianza(
    payload.sucursal ?? timeline.pedido?.sucursal,
    payload.sucursal ? 'evento' : 'timeline',
    0.7
  )

  const requiereRevision = nombre.confianza < 0.5 || precioExtraido.confianza < 0.3

  const razonRevision = !requiereRevision ? null : [
    nombre.advertencia,
    nombre.valor === null ? 'Falta nombre del cliente' : null,
    precioExtraido.valor === null ? 'Falta precio' : null,
  ].filter(Boolean).join('; ') || null

  return {
    tipoEvento: eventType,
    prioridad,
    requiereRevision,
    razonRevision,
    payloadRaw: payload,
    campos: {
      nombre: {
        valor: nombre.valor,
        confianza: nombre.confianza,
        fuente: nombre.fuente,
        advertencia: nombre.advertencia,
      },
      sucursal: {
        valor: sucursalExtraida.valor as string | null,
        confianza: sucursalExtraida.confianza,
        fuente: sucursalExtraida.fuente as 'evento' | 'timeline',
        advertencia: sucursalExtraida.valor === null ? 'Sucursal no especificada' : undefined,
      },
      fecha: extraerConConfianza(
        (payload as any).fechaHora?.split(' ')[0] ?? timeline.pedido?.fechaEntrega,
        (payload as any).fechaHora ? 'evento' : 'timeline',
        0.7
      ) as CampoExtraido & { valor: string | null },
      hora: extraerConConfianza(
        (payload as any).fechaHora?.split(' ')[1] ?? timeline.pedido?.horaEntrega,
        (payload as any).fechaHora ? 'evento' : 'timeline',
        0.7
      ) as CampoExtraido & { valor: string | null },
      precio: precioExtraido as CampoExtraido & { valor: number | null },
      producto: productoExtraido as CampoExtraido & { valor: string | null },
      estado: {
        valor: (payload as any).estado ?? timeline.estadoActual ?? 'desconocido',
        confianza: 0.8,
        fuente: 'evento',
      },
      metodoPago: extraerConConfianza(
        payload.metodoPago ?? timeline.pedido?.metodoPago,
        payload.metodoPago ? 'evento' : 'timeline',
        0.7
      ) as CampoExtraido & { valor: string | null },
      telefono: {
        valor: payload.telefono,
        confianza: 1,
        fuente: 'evento',
      },
    },
  }
}
