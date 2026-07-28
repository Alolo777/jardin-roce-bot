import { eventBus } from './event-bus'
import { EventType } from './types'

import {
  enviarFotoTelegram,
} from '../../lib/telegram'

import { withPipeline, withPipelinePhoto } from '../notification-engine'

export function subscribeTelegramEvents(): void {
  eventBus.subscribe(EventType.ORDER_CREATED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.ORDER_UPDATED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.ORDER_READY, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.ORDER_DELIVERED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.HUMAN_REQUIRED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.CUSTOMER_ANGRY, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PHOTO_REQUESTED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.COTIZACION_REQUESTED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.ENVIO_REQUESTED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.CASE_CREATED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.CASE_ARCHIVED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PAYMENT_RECEIVED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PAYMENT_PENDING, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.ZONA_AMBIGUA, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.CANCELACION_REQUESTED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PAYMENT_CONFIRMED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PRICE_CONFIRMED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.DELIVERY_COMPLETED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.BOT_DISCONNECTED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.CUSTOMER_WAITING, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PHOTO_SENT, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.QR_GENERATED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.BOT_CONNECTED, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.BOT_DAILY_ALERT, (event) => {
    return withPipeline(event)
  })

  eventBus.subscribe(EventType.PHOTO_RECEIVED, (event) => {
    return withPipelinePhoto(event, enviarFotoTelegram)
  })

  eventBus.subscribe(EventType.PROVIDER_FAILURE, (event) => {
    return withPipeline(event)
  })
}
