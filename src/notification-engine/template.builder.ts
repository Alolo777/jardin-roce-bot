import type { EventType, EventPayload } from '../events/types'
import type { DatosVerificados } from './types'
import type { PipelineResult } from './notification.engine'

function esc(text: string | number | null | undefined): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

function ultimos4(numero: string): string {
  const limpio = String(numero ?? '').replace(/\D/g, '')
  return 'xxx' + limpio.slice(-4)
}

function formatearNumero(numero: string, nombre?: string): string {
  const parte = nombre ? ` — ${esc(nombre)}` : ''
  return `${ultimos4(numero)}${parte}`
}

function horaActual(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildWarningResumen(pipelineResult: PipelineResult): string | null {
  if (pipelineResult.accion !== 'ALERTA') return null
  const n = pipelineResult.advertencias.length + pipelineResult.conflictos.length
  if (n === 0) return null
  const principales = pipelineResult.advertencias
    .filter(w => w.includes('IA #1') || w.includes('IA #2') || w.includes('R00'))
    .slice(0, 2)
    .map(w => esc(w.length > 80 ? w.slice(0, 80) + '...' : w))
  const lineas = [`⚠️ ${n} advertencia(s)`]
  for (const p of principales) lineas.push(`└ ${p}`)
  return lineas.join('\n')
}

export function buildTelegramMessage(
  eventType: EventType,
  payload: EventPayload,
  verified: DatosVerificados,
  pipelineResult: PipelineResult
): string {
  const advertencia = buildWarningResumen(pipelineResult)
  const base = getTemplate(eventType, payload, verified)
  const partes = [base, `🕐 ${esc(horaActual())}`]
  if (advertencia) partes.push(advertencia)
  return partes.join('\n')
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

function clienteLine(nombre: string | null, telefono: string): string {
  return nombre ? `${esc(nombre)} — ${formatearNumero(telefono)}` : formatearNumero(telefono)
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

  const header = () => `📱 ${clienteLine(nombre, telefono)}`

  switch (eventType) {
    case 'ORDER_CREATED':
    case 'PAYMENT_RECEIVED':
    case 'PAYMENT_CONFIRMED':
      return [
        '🌸 *VENTA CERRADA*',
        header(),
        ...(producto ? [esc(producto)] : []),
        ...(precio ? [`💰 ${esc(precio)}`] : []),
        ...(sucursal ? [`📍 ${esc(sucursal)}`] : []),
        ...(metodoPago ? [`💳 ${esc(metodoPago)}`] : []),
        ...(descripcion ? [esc(descripcion)] : []),
      ].join('\n')

    case 'ORDER_UPDATED':
      return [
        '📦 *PEDIDO APARTADO*',
        header(),
        ...(producto ? [esc(producto)] : []),
        ...(precio ? [`💰 ${esc(precio)}`] : []),
        ...(sucursal ? [`📍 ${esc(sucursal)}`] : []),
        ...(metodoPago ? [`💳 ${esc(metodoPago)}`] : []),
      ].join('\n')

    case 'HUMAN_REQUIRED':
      return [
        '⚠️ *ATENCIÓN HUMANA*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 200))] : []),
      ].join('\n')

    case 'CUSTOMER_ANGRY':
      return [
        '⚠️ *QUEJA*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 300))] : []),
      ].join('\n')

    case 'PAYMENT_PENDING':
      return [
        '⏳ *PAGO PENDIENTE*',
        header(),
        ...(producto ? [esc(producto)] : []),
        ...(precio ? [`💰 ${esc(precio)}`] : []),
        ...(sucursal ? [`📍 ${esc(sucursal)}`] : []),
      ].join('\n')

    case 'PHOTO_REQUESTED':
      return [
        '📸 *PIDEN FOTOS*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 200))] : []),
      ].join('\n')

    case 'PHOTO_RECEIVED':
      return [
        '🖼️ *FOTO RECIBIDA*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 200))] : []),
      ].join('\n')

    case 'PHOTO_SENT':
      return [
        '🖼️ *FOTO ENVIADA*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 200))] : []),
      ].join('\n')

    case 'ENVIO_REQUESTED':
      return [
        '🚚 *COTIZAR ENVÍO*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 300))] : []),
      ].join('\n')

    case 'CANCELACION_REQUESTED':
      return [
        '🚫 *CANCELACIÓN*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 300))] : []),
      ].join('\n')

    case 'CASE_CREATED':
      return [
        '📋 *NUEVO CASO*',
        header(),
        ...(descripcion ? [`🏷️ ${esc(descripcion)}`] : []),
      ].join('\n')

    case 'CASE_ARCHIVED':
      return [
        '🗂️ *CASO ARCHIVADO*',
        header(),
        ...(descripcion ? [esc(descripcion)] : []),
      ].join('\n')

    case 'COTIZACION_REQUESTED':
      return [
        '🌷 *COTIZACIÓN*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 400))] : []),
      ].join('\n')

    case 'ORDER_READY':
      return [
        '✅ *PEDIDO LISTO*',
        header(),
        ...(producto ? [esc(producto)] : []),
      ].join('\n')

    case 'ORDER_DELIVERED':
    case 'DELIVERY_COMPLETED':
      return [
        '🚚 *ENTREGADO*',
        header(),
        ...(producto ? [esc(producto)] : []),
      ].join('\n')

    case 'CUSTOMER_WAITING':
      return [
        '⏱️ *CLIENTE ESPERA*',
        header(),
      ].join('\n')

    case 'PRICE_CONFIRMED':
      return [
        '💲 *PRECIO CONFIRMADO*',
        header(),
        ...(precio ? [`💰 ${esc(precio)}`] : []),
        ...(producto ? [esc(producto)] : []),
      ].join('\n')

    case 'ZONA_AMBIGUA':
      return [
        '🧭 *ZONA AMBIGUA*',
        header(),
        ...(descripcion ? [esc(descripcion.slice(0, 300))] : []),
      ].join('\n')

    default:
      return [
        `📋 ${esc(eventType)}`,
        header(),
        ...(producto ? [esc(producto)] : []),
        ...(precio ? [`💰 ${esc(precio)}`] : []),
      ].join('\n')
  }
}
