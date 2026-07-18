import { EventType } from '../events/types'
import type { EventPayload } from '../events/types'
import type { TimelineData, DatosExtraidos, Conflicto, ResultadoDeteccion, AccionNotificacion } from './types'

const TRANSICIONES_VALIDAS_PEDIDOS_BOT: Record<string, string[]> = {
  'cotizacion': ['apartado', 'pagado', 'cancelado'],
  'apartado': ['pagado', 'cancelado'],
  'pagado': ['entregado', 'cancelado'],
  'entregado': ['cancelado'],
  'cancelado': [],
}

function esTransicionValida(desde: string | null, hasta: string | null): boolean {
  if (!desde || !hasta) return true
  if (desde === hasta) return false
  const validas = TRANSICIONES_VALIDAS_PEDIDOS_BOT[desde]
  if (!validas) return true
  return validas.includes(hasta)
}

function extraerEstadoEvento(eventType: EventType, payload: EventPayload): string | null {
  switch (eventType) {
    case EventType.ORDER_CREATED:
      return 'pagado'
    case EventType.ORDER_UPDATED:
      return 'apartado'
    case EventType.ORDER_READY:
      return 'pagado'
    case EventType.ORDER_DELIVERED:
    case EventType.DELIVERY_COMPLETED:
      return 'entregado'
    case EventType.PAYMENT_RECEIVED:
    case EventType.PAYMENT_CONFIRMED:
      return 'pagado'
    case EventType.PAYMENT_PENDING:
      return 'apartado'
    case EventType.CANCELACION_REQUESTED:
      return 'cancelado'
    default:
      return null
  }
}

export function detectConflicts(
  eventType: EventType,
  datos: DatosExtraidos,
  timeline: TimelineData
): ResultadoDeteccion {
  const conflictos: Conflicto[] = []

  const estadoEvento = extraerEstadoEvento(eventType, datos.payloadRaw)
  const estadoActual = timeline.pedido?.estado as string | undefined

  if (timeline.pedidoCanceladoOArchivado) {
    conflictos.push({
      campo: 'pedido',
      tipo: 'BLOQUEO',
      descripcion: `Pedido en estado "${timeline.estadoActual}" — no se debe notificar`,
      valorEvento: eventType,
      valorTimeline: timeline.estadoActual ?? 'desconocido',
      severity: 'error',
    })
  }

  if (estadoEvento && estadoActual && !esTransicionValida(estadoActual, estadoEvento)) {
    conflictos.push({
      campo: 'estado',
      tipo: 'ESTADO',
      descripcion: `Transición inválida: "${estadoActual}" → "${estadoEvento}"`,
      valorEvento: estadoEvento,
      valorTimeline: estadoActual,
      severity: 'error',
    })
  }

  if (datos.campos.nombre.valor && timeline.pedido?.nombre) {
    const nombreEvento = String(datos.campos.nombre.valor).toLowerCase().trim()
    const nombreTimeline = timeline.pedido.nombre.toLowerCase().trim()

    if (nombreEvento !== nombreTimeline && nombreTimeline.length > 3) {
      if (!nombreEvento.includes(nombreTimeline) && !nombreTimeline.includes(nombreEvento)) {
        conflictos.push({
          campo: 'nombre',
          tipo: 'NOMBRE',
          descripcion: `Nombre en evento "${datos.campos.nombre.valor}" difiere de DB "${timeline.pedido.nombre}"`,
          valorEvento: String(datos.campos.nombre.valor),
          valorTimeline: timeline.pedido.nombre,
          severity: 'warning',
        })
      }
    }
  }

  if (datos.campos.sucursal.valor && timeline.pedido?.sucursal) {
    const sucEvento = String(datos.campos.sucursal.valor).toLowerCase().trim()
    const sucTimeline = timeline.pedido.sucursal.toLowerCase().trim()

    if (sucEvento !== sucTimeline && sucTimeline.length > 2) {
      conflictos.push({
        campo: 'sucursal',
        tipo: 'SUCURSAL',
        descripcion: `Sucursal "${datos.campos.sucursal.valor}" difiere de DB "${timeline.pedido.sucursal}"`,
        valorEvento: String(datos.campos.sucursal.valor),
        valorTimeline: timeline.pedido.sucursal,
        severity: 'warning',
      })
    }
  }

  if (datos.campos.precio.valor && timeline.pedido?.precioPersonalizado) {
    const precEvento = Number(datos.campos.precio.valor)
    const precTimeline = Number(timeline.pedido.precioPersonalizado)

    if (precEvento > 0 && precTimeline > 0 && Math.abs(precEvento - precTimeline) > 10) {
      conflictos.push({
        campo: 'precio',
        tipo: 'PRECIO',
        descripcion: `Precio $${precEvento} difiere de DB $${precTimeline}`,
        valorEvento: String(precEvento),
        valorTimeline: String(precTimeline),
        severity: 'warning',
      })
    }
  }

  if (datos.campos.producto.valor && timeline.pedido?.arreglo?.nombre) {
    const prodEvento = String(datos.campos.producto.valor).toLowerCase().trim()
    const prodTimeline = timeline.pedido.arreglo.nombre.toLowerCase().trim()

    if (prodEvento !== prodTimeline && prodTimeline !== 'por definir' && prodEvento !== 'por definir') {
      conflictos.push({
        campo: 'producto',
        tipo: 'PRODUCTO',
        descripcion: `Producto "${datos.campos.producto.valor}" difiere de DB "${timeline.pedido.arreglo.nombre}"`,
        valorEvento: String(datos.campos.producto.valor),
        valorTimeline: timeline.pedido.arreglo.nombre,
        severity: 'warning',
      })
    }
  }

  const accion = determinarAccion(eventType, conflictos, datos)

  return {
    ok: accion === 'NOTIFICAR',
    accion,
    conflictos,
    razonBloqueo: accion === 'BLOQUEAR'
      ? conflictos.filter(c => c.severity === 'error').map(c => c.descripcion).join('; ')
      : null,
  }
}

function determinarAccion(
  eventType: EventType,
  conflictos: Conflicto[],
  datos: DatosExtraidos
): AccionNotificacion {
  const eventosSiempreNotificar: EventType[] = [
    EventType.HUMAN_REQUIRED,
    EventType.CUSTOMER_ANGRY,
    EventType.CUSTOMER_WAITING,
    EventType.PROVIDER_FAILURE,
    EventType.BOT_DISCONNECTED,
    EventType.PAYMENT_RECEIVED,
    EventType.CANCELACION_REQUESTED,
  ]

  const tieneError = conflictos.some(c => c.severity === 'error')

  if (eventosSiempreNotificar.includes(eventType)) {
    return tieneError ? 'ALERTA' : 'NOTIFICAR'
  }

  if (tieneError) {
    return 'BLOQUEAR'
  }

  if (datos.campos.nombre.valor === null || datos.campos.precio.valor === null) {
    if (eventType === EventType.ORDER_UPDATED || eventType === EventType.CASE_CREATED) {
      return 'BLOQUEAR'
    }
    return 'ALERTA'
  }

  if (conflictos.some(c => c.severity === 'warning')) {
    return 'ALERTA'
  }

  return 'NOTIFICAR'
}
