import { eventBus } from './event-bus'
import { EventType } from './types'

import {
  enviarAlertaVentaCerrada,
  enviarAlertaPedidoWeb,
  enviarAlertaCotizacion,
  enviarAlertaClienteFrustrado,
  enviarAlertaArregloApartado,
  enviarAlertaQr,
  enviarAlertaReconectado,
  enviarAlertaDiariaDesconexion,
  enviarAlertaCancelacion,
  enviarAlertaQueja,
  enviarAlertaAtencionHumana,
  enviarAlertaPedidoApartado,
  enviarAlertaZonaAmbigua,
  enviarAlertaClienteInteresado,
  enviarAlertaEmpleadoFotos,
  enviarAlertaEmpleadoEnvio,
  enviarAlertaCasoNuevo,
  enviarAlertaCasoArchivado,
  enviarAlertaPagoRecibido,
  enviarAlertaPagoPendiente,
  enviarFotoTelegram,
} from '../lib/telegram'

export function subscribeTelegramEvents(): void {
  eventBus.subscribe(EventType.ORDER_CREATED, (event) => {
    enviarAlertaVentaCerrada({
      cliente: event.payload.cliente ?? '',
      producto: event.payload.producto ?? '',
      total: event.payload.total?.toString() ?? '',
      direccion: event.payload.sucursal ?? '',
      numeroCliente: event.payload.telefono,
      precioArreglo: (event.payload as any).precioArreglo,
      precioExtras: (event.payload as any).precioExtras,
      precioEnvio: (event.payload as any).precioEnvio,
      metodoPago: event.payload.metodoPago,
      detalles: event.payload.descripcion,
      fechaHora: (event.payload as any).fechaHora,
      tieneFotoReferencia: (event.payload as any).tieneFotoReferencia,
    }).catch(() => {})
  })

  eventBus.subscribe(EventType.ORDER_UPDATED, (event) => {
    enviarAlertaPedidoApartado({
      cliente: event.payload.cliente ?? '',
      producto: event.payload.producto ?? '',
      precioArreglo: (event.payload as any).precioArreglo ?? '',
      precioExtras: (event.payload as any).precioExtras,
      precioEnvio: (event.payload as any).precioEnvio,
      total: event.payload.total?.toString() ?? '',
      entrega: event.payload.sucursal ?? '',
      metodoPago: event.payload.metodoPago ?? '',
      numeroCliente: event.payload.telefono,
      detalles: event.payload.descripcion,
      fechaHora: (event.payload as any).fechaHora,
      tieneFotoReferencia: (event.payload as any).tieneFotoReferencia,
    }).catch(() => {})
  })

  eventBus.subscribe(EventType.HUMAN_REQUIRED, (event) => {
    if (event.payload.prioridad === 'critica') {
      enviarAlertaClienteFrustrado(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      ).catch(() => {})
    } else {
      enviarAlertaAtencionHumana(
        event.payload.telefono,
        event.payload.cliente,
        event.payload.descripcion,
        (event.payload as any).contexto,
      ).catch(() => {})
    }
  })

  eventBus.subscribe(EventType.CUSTOMER_ANGRY, (event) => {
    enviarAlertaQueja(
      event.payload.telefono,
      event.payload.descripcion ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.PHOTO_REQUESTED, (event) => {
    enviarAlertaEmpleadoFotos(
      event.payload.telefono,
      event.payload.cliente ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.COTIZACION_REQUESTED, (event) => {
    enviarAlertaCotizacion(
      event.payload.telefono,
      event.payload.descripcion ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.ENVIO_REQUESTED, (event) => {
    enviarAlertaEmpleadoEnvio(
      event.payload.telefono,
      event.payload.descripcion ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.CASE_CREATED, (event) => {
    enviarAlertaCasoNuevo(
      event.payload.telefono,
      event.payload.descripcion ?? '',
      event.payload.prioridad ?? 'media',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.CASE_ARCHIVED, (event) => {
    enviarAlertaCasoArchivado(
      event.payload.telefono,
      event.payload.descripcion ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.PAYMENT_RECEIVED, (event) => {
    enviarAlertaPagoRecibido(
      event.payload.telefono,
      event.payload.cliente ?? '',
      event.payload.producto ?? '',
      event.payload.total ?? 0,
      event.payload.metodoPago ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.PAYMENT_PENDING, (event) => {
    enviarAlertaPagoPendiente(
      event.payload.telefono,
      event.payload.cliente ?? '',
      event.payload.producto ?? '',
      event.payload.total ?? 0,
      event.payload.sucursal ?? '',
      event.payload.metodoPago ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.ZONA_AMBIGUA, (event) => {
    enviarAlertaZonaAmbigua(
      event.payload.telefono,
      event.payload.descripcion ?? '',
      (event.payload as any).candidatos,
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.CANCELACION_REQUESTED, (event) => {
    enviarAlertaCancelacion(
      event.payload.telefono,
      event.payload.descripcion ?? '',
    ).catch(() => {})
  })

  eventBus.subscribe(EventType.QR_GENERATED, () => {
    enviarAlertaQr().catch(() => {})
  })

  eventBus.subscribe(EventType.BOT_CONNECTED, () => {
    enviarAlertaReconectado().catch(() => {})
  })

  eventBus.subscribe(EventType.BOT_DAILY_ALERT, () => {
    enviarAlertaDiariaDesconexion().catch(() => {})
  })

  eventBus.subscribe(EventType.PHOTO_RECEIVED, (event) => {
    const { telefono, base64, mimetype, caption, tipo } = event.payload as any
    const prefix = tipo === 'comprobante'
      ? '📸 *Comprobante de pago*'
      : tipo === 'referencia'
        ? '📷 *Foto de referencia*'
        : '📸 *Imagen del cliente*'
    const texto = `${prefix} — ${telefono}${caption ? `\n\n${caption}` : ''}`
    enviarFotoTelegram(base64, texto, mimetype).catch(() => {})
  })
}
