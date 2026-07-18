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
  enviarAlertaPedidoListo,
  enviarAlertaPedidoEntregado,
  enviarAlertaPagoConfirmado,
  enviarAlertaPrecioConfirmado,
  enviarAlertaEntregaCompletada,
  enviarAlertaBotDesconectado,
  enviarAlertaClienteEsperando,
  enviarAlertaFotoEnviada,
  enviarAlertaProveedorCaido,
  enviarFotoTelegram,
} from '../../lib/telegram'

import { withPipeline } from '../notification-engine'

export function subscribeTelegramEvents(): void {
  eventBus.subscribe(EventType.ORDER_CREATED, (event) => {
    return withPipeline(event, async () => {
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
      })
    })
  })

  eventBus.subscribe(EventType.ORDER_UPDATED, (event) => {
    return withPipeline(event, async () => {
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
      })
    })
  })

  eventBus.subscribe(EventType.ORDER_READY, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaPedidoListo(event.payload.telefono)
    })
  })

  eventBus.subscribe(EventType.ORDER_DELIVERED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaPedidoEntregado(event.payload.telefono)
    })
  })

  eventBus.subscribe(EventType.HUMAN_REQUIRED, (event) => {
    return withPipeline(event, async () => {
      if (event.payload.prioridad === 'critica') {
        enviarAlertaClienteFrustrado(
          event.payload.telefono,
          event.payload.descripcion ?? '',
        )
      } else {
        enviarAlertaAtencionHumana(
          event.payload.telefono,
          event.payload.cliente,
          event.payload.descripcion,
          (event.payload as any).contexto,
        )
      }
    })
  })

  eventBus.subscribe(EventType.CUSTOMER_ANGRY, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaQueja(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.PHOTO_REQUESTED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaEmpleadoFotos(
        event.payload.telefono,
        event.payload.cliente ?? '',
        event.payload.descripcion,
      )
    })
  })

  eventBus.subscribe(EventType.COTIZACION_REQUESTED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaCotizacion(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.ENVIO_REQUESTED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaEmpleadoEnvio(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.CASE_CREATED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaCasoNuevo(
        event.payload.telefono,
        event.payload.descripcion ?? '',
        event.payload.prioridad ?? 'media',
      )
    })
  })

  eventBus.subscribe(EventType.CASE_ARCHIVED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaCasoArchivado(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.PAYMENT_RECEIVED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaPagoRecibido(
        event.payload.telefono,
        event.payload.cliente ?? '',
        event.payload.producto ?? '',
        event.payload.total ?? 0,
        event.payload.metodoPago ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.PAYMENT_PENDING, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaPagoPendiente(
        event.payload.telefono,
        event.payload.cliente ?? '',
        event.payload.producto ?? '',
        event.payload.total ?? 0,
        event.payload.sucursal ?? '',
        event.payload.metodoPago ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.ZONA_AMBIGUA, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaZonaAmbigua(
        event.payload.telefono,
        event.payload.descripcion ?? '',
        (event.payload as any).candidatos,
      )
    })
  })

  eventBus.subscribe(EventType.CANCELACION_REQUESTED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaCancelacion(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.PAYMENT_CONFIRMED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaPagoConfirmado(
        event.payload.telefono,
        event.payload.cliente ?? '',
        event.payload.total ?? 0,
        event.payload.metodoPago ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.PRICE_CONFIRMED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaPrecioConfirmado(event.payload.telefono)
    })
  })

  eventBus.subscribe(EventType.DELIVERY_COMPLETED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaEntregaCompletada(event.payload.telefono)
    })
  })

  eventBus.subscribe(EventType.BOT_DISCONNECTED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaBotDesconectado(
        event.payload.descripcion ?? 'Sin motivo',
      )
    })
  })

  eventBus.subscribe(EventType.CUSTOMER_WAITING, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaClienteEsperando(event.payload.telefono)
    })
  })

  eventBus.subscribe(EventType.PHOTO_SENT, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaFotoEnviada(
        event.payload.telefono,
        event.payload.descripcion ?? '',
      )
    })
  })

  eventBus.subscribe(EventType.QR_GENERATED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaQr()
    })
  })

  eventBus.subscribe(EventType.BOT_CONNECTED, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaReconectado()
    })
  })

  eventBus.subscribe(EventType.BOT_DAILY_ALERT, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaDiariaDesconexion()
    })
  })

  eventBus.subscribe(EventType.PHOTO_RECEIVED, (event) => {
    return withPipeline(event, async () => {
      const { telefono, base64, mimetype, caption, tipo } = event.payload as any
      const prefix = tipo === 'comprobante'
        ? '📸 *Comprobante de pago*'
        : tipo === 'referencia'
          ? '📷 *Foto de referencia*'
          : '📸 *Imagen del cliente*'
      const texto = `${prefix} — ${telefono}${caption ? `\n\n${caption}` : ''}`
      enviarFotoTelegram(base64, texto, mimetype)
    })
  })

  eventBus.subscribe(EventType.PROVIDER_FAILURE, (event) => {
    return withPipeline(event, async () => {
      enviarAlertaProveedorCaido(event.payload.descripcion ?? 'Error desconocido')
    })
  })
}
