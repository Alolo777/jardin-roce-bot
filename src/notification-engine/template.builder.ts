import type { EventType, EventPayload } from '../events/types'
import type { DatosVerificados, AccionNotificacion } from './types'
import type { PipelineResult } from './notification.engine'

function esc(text: string | number | null | undefined): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

function ultimos4(numero: string): string {
  const limpio = String(numero ?? '').replace(/\D/g, '')
  return 'xxx' + limpio.slice(-4)
}

function esLid(numero: string): boolean {
  return numero.includes('@lid') || (String(numero ?? '').replace(/[^0-9]/g, '').length > 13)
}

function formatearNumero(numero: string, nombre?: string): string {
  const nombreParte = nombre ? ` (${esc(nombre)})` : ''
  if (esLid(numero)) {
    const lid = String(numero ?? '').replace(/@.*$/, '')
    const last4 = lid.replace(/\D/g, '').slice(-4)
    return `Cuenta vinculada — xxx${last4}${nombreParte}`
  }
  return `${ultimos4(numero)}${nombreParte}`
}

function horaActual(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildWarningBanner(pipelineResult: PipelineResult): string[] {
  if (pipelineResult.accion !== 'ALERTA') return []
  const lines: string[] = ['', '⚠️ *VERIFICACIÓN*']
  for (const w of pipelineResult.advertencias) {
    lines.push(`⚠️ ${esc(w)}`)
  }
  for (const c of pipelineResult.conflictos) {
    const icono = c.severity === 'error' ? '🚫' : '⚠️'
    lines.push(`${icono} *${esc(c.campo)}:* ${esc(c.descripcion)}`)
  }
  return lines
}

export function buildTelegramMessage(
  eventType: EventType,
  payload: EventPayload,
  verified: DatosVerificados,
  pipelineResult: PipelineResult
): string {
  const base = getTemplate(eventType, payload, verified)
  const warnings = buildWarningBanner(pipelineResult)
  const footer = [
    ...warnings,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    getFooter(eventType),
  ].join('\n')
  return `${base}\n${footer}`
}

function getNombre(verified: DatosVerificados, payload: EventPayload): string | null {
  return verified.nombre ?? (payload.cliente as string | undefined) ?? null
}

function getProducto(verified: DatosVerificados, payload: EventPayload): string | null {
  return verified.producto ?? (payload.producto as string | undefined) ?? null
}

function getPrecio(verified: DatosVerificados, payload: EventPayload): string | null {
  if (verified.precio !== null && verified.precio !== undefined) return `$${verified.precio.toFixed(2)}`
  if (payload.total !== null && payload.total !== undefined) return `$${Number(payload.total).toFixed(2)}`
  return null
}

function getSucursal(verified: DatosVerificados, payload: EventPayload): string | null {
  return verified.sucursal ?? (payload.sucursal as string | undefined) ?? null
}

function getMetodoPago(verified: DatosVerificados, payload: EventPayload): string | null {
  return verified.metodoPago ?? (payload.metodoPago as string | undefined) ?? null
}

function getTelefono(payload: EventPayload): string {
  return payload.telefono
}

function getDescripcion(payload: EventPayload): string | null {
  return (payload.descripcion as string | undefined) ?? null
}

function getTemplate(
  eventType: EventType,
  payload: EventPayload,
  verified: DatosVerificados
): string {
  const nombre = getNombre(verified, payload)
  const telefono = getTelefono(payload)
  const producto = getProducto(verified, payload)
  const precio = getPrecio(verified, payload)
  const sucursal = getSucursal(verified, payload)
  const metodoPago = getMetodoPago(verified, payload)
  const descripcion = getDescripcion(payload)

  switch (eventType) {
    case 'ORDER_CREATED':
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED':
      return [
        '🌸 *¡VENTA CERRADA!* 🌸',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(producto ? [`💐 *Producto:* ${esc(producto)}`] : []),
        ...(descripcion ? [`📝 *Detalles:* ${esc(descripcion)}`] : []),
        ...(precio ? [`💰 *Total:* ${esc(precio)}`] : []),
        ...(sucursal ? [`📍 *Entrega:* ${esc(sucursal)}`] : []),
        ...(metodoPago ? [`💳 *Pago:* ${esc(metodoPago)}`] : []),
      ].join('\n')

    case 'ORDER_UPDATED':
      return [
        '📦 *PEDIDO APARTADO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(producto ? [`💐 *Producto:* ${esc(producto)}`] : []),
        ...(descripcion ? [`📝 *Detalles:* ${esc(descripcion)}`] : []),
        ...(precio ? [`💰 *Total:* ${esc(precio)}`] : []),
        ...(sucursal ? [`📍 *Entrega:* ${esc(sucursal)}`] : []),
        ...(metodoPago ? [`💳 *Pago:* ${esc(metodoPago)}`] : []),
      ].join('\n')

    case 'HUMAN_REQUIRED':
      return [
        `⚠️ *CLIENTE NECESITA ATENCIÓN HUMANA*`,
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Mensaje:* ${esc(descripcion.slice(0, 200))}`] : []),
      ].join('\n')

    case 'CUSTOMER_ANGRY':
      return [
        '⚠️ *QUEJA DEL CLIENTE*',
        '',
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Reporta:* ${esc(descripcion.slice(0, 300))}`] : []),
      ].join('\n')

    case 'PAYMENT_PENDING':
      return [
        '⏳ *PAGO PENDIENTE*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(producto ? [`🌸 *Producto:* ${esc(producto)}`] : []),
        ...(precio ? [`💵 *Total:* ${esc(precio)}`] : []),
        ...(sucursal ? [`📍 *Sucursal:* ${esc(sucursal)}`] : []),
        ...(metodoPago ? [`💳 *Método:* ${esc(metodoPago)}`] : []),
      ].join('\n')

    case 'PHOTO_REQUESTED':
      return [
        '📸 *CLIENTE PIDE FOTOS*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${formatearNumero(telefono, nombre)}`] : [`📱 *Cliente:* ${formatearNumero(telefono)}`]),
        `💬 Quiere ver fotos de los arreglos disponibles.`,
        ...(descripcion ? [`📝 *Contexto:* ${esc(descripcion.slice(0, 300))}`] : []),
      ].join('\n')

    case 'PHOTO_RECEIVED':
      return [
        '🖼️ *FOTO RECIBIDA*',
        '',
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Descripción:* ${esc(descripcion.slice(0, 200))}`] : []),
      ].join('\n')

    case 'PHOTO_SENT':
      return [
        '🖼️ *FOTO ENVIADA AL CLIENTE*',
        '',
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Detalle:* ${esc(descripcion.slice(0, 200))}`] : []),
      ].join('\n')

    case 'ENVIO_REQUESTED':
      return [
        '🚚 *CLIENTE PIDE COTIZACIÓN DE ENVÍO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${formatearNumero(telefono, nombre)}`] : [`📱 *Cliente:* ${formatearNumero(telefono)}`]),
        ...(sucursal ? [`📍 *Ubicación:* ${esc(sucursal)}`] : []),
        ...(descripcion ? [`📍 *Ubicación:* ${esc(descripcion.slice(0, 300))}`] : []),
      ].join('\n')

    case 'CANCELACION_REQUESTED':
      return [
        '🚫 *SOLICITUD DE CANCELACIÓN*',
        '',
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Motivo:* ${esc(descripcion.slice(0, 300))}`] : []),
      ].join('\n')

    case 'CASE_CREATED':
      return [
        '📋 *NUEVO CASO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${formatearNumero(telefono, nombre)}`] : [`📱 *Cliente:* ${formatearNumero(telefono)}`]),
        ...(descripcion ? [`🏷️ *Tipo:* ${esc(descripcion)}`] : []),
        ...(sucursal ? [`${sucursal === 'critica' ? '🔴' : sucursal === 'alta' ? '🟠' : '🟢'} *Prioridad:* ${esc(sucursal)}`] : []),
      ].join('\n')

    case 'CASE_ARCHIVED':
      return [
        '🗂️ *CASO ARCHIVADO*',
        '',
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`📝 *Motivo:* ${esc(descripcion)}`] : []),
      ].join('\n')

    case 'COTIZACION_REQUESTED':
      return [
        '🌷 *INTERÉS / COTIZACIÓN*',
        '',
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Detalle:* ${esc(descripcion.slice(0, 400))}`] : []),
      ].join('\n')

    case 'ORDER_READY':
      return [
        '✅ *PEDIDO LISTO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(producto ? [`💐 *Producto:* ${esc(producto)}`] : []),
      ].join('\n')

    case 'ORDER_DELIVERED':
    case 'DELIVERY_COMPLETED':
      return [
        '🚚 *PEDIDO ENTREGADO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(producto ? [`💐 *Producto:* ${esc(producto)}`] : []),
      ].join('\n')

    case 'CUSTOMER_WAITING':
      return [
        '⏱️ *CLIENTE ESPERANDO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
      ].join('\n')

    case 'PRICE_CONFIRMED':
      return [
        '💲 *PRECIO CONFIRMADO*',
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(precio ? [`💰 *Precio:* ${esc(precio)}`] : []),
        ...(producto ? [`💐 *Producto:* ${esc(producto)}`] : []),
      ].join('\n')

    case 'ZONA_AMBIGUA':
      return [
        '🧭 *ZONA DE ENVÍO AMBIGUA*',
        '',
        `📱 *Cliente:* ${formatearNumero(telefono)}`,
        ...(descripcion ? [`💬 *Cliente escribió:* ${esc(descripcion.slice(0, 300))}`] : []),
        ...(sucursal ? [`📍 *Posibles zonas:* ${esc(sucursal.slice(0, 500))}`] : []),
      ].join('\n')

    default:
      return [
        `📋 *EVENTO: ${esc(eventType)}*`,
        '',
        ...(nombre ? [`👤 *Cliente:* ${esc(nombre)}`] : []),
        `📱 *Teléfono:* ${formatearNumero(telefono)}`,
        ...(producto ? [`💐 *Producto:* ${esc(producto)}`] : []),
        ...(precio ? [`💰 *Total:* ${esc(precio)}`] : []),
      ].join('\n')
  }
}

function getFooter(eventType: EventType): string {
  switch (eventType) {
    case 'ORDER_CREATED':
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED':
      return '✅ _Pago recibido — preparar pedido_'

    case 'ORDER_UPDATED':
      return '_Pedido apartado, pendiente de pago/confirmación final_'

    case 'HUMAN_REQUIRED':
      return '🙋 _Revisar WhatsApp y responder directamente_'

    case 'CUSTOMER_ANGRY':
      return '🙋 _Atención prioritaria requerida_'

    case 'PAYMENT_PENDING':
      return '⚠️ _Esperando confirmación de pago_'

    case 'PHOTO_REQUESTED':
      return '_Envíale las fotos actuales de lo que tenemos disponible_'

    case 'PHOTO_RECEIVED':
      return '_Revisar la foto para cotizar el arreglo_'

    case 'PHOTO_SENT':
      return '_Se envió una foto al cliente_'

    case 'ENVIO_REQUESTED':
      return '_Cotiza el precio exacto de envío y confírmalo al cliente_'

    case 'CANCELACION_REQUESTED':
      return '⚠️ _Revisar pedido y contactar al cliente_'

    case 'CASE_CREATED':
      return '_Dar seguimiento al nuevo caso_'

    case 'CASE_ARCHIVED':
      return '_Caso archivado_'

    case 'COTIZACION_REQUESTED':
      return '_Dar seguimiento al cliente y confirmar si desea apartar_'

    case 'ORDER_READY':
      return '_El pedido está listo para entrega o recogida_'

    case 'ORDER_DELIVERED':
    case 'DELIVERY_COMPLETED':
      return '_El pedido fue entregado al cliente_'

    case 'CUSTOMER_WAITING':
      return '_El cliente está esperando respuesta del equipo_'

    case 'PRICE_CONFIRMED':
      return '_El cliente aceptó el precio, esperando datos para continuar_'

    case 'ZONA_AMBIGUA':
      return '_Revisar municipio/colonia antes de dar precio_'

    default:
      return '_Revisar evento_'
  }
}
