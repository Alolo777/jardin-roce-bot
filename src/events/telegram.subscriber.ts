import { eventBus } from './event-bus'
import { EventType } from './types'

import {
  enviarFotoTelegram,
} from '../../lib/telegram'

import { withPipelinePhoto } from '../notification-engine'
import { routeNotification } from './notification-aggregator'

export function subscribeTelegramEvents(): void {
  eventBus.subscribe(EventType.ORDER_CREATED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.ORDER_UPDATED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.ORDER_READY, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.ORDER_DELIVERED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.HUMAN_REQUIRED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.CUSTOMER_ANGRY, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PHOTO_REQUESTED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.COTIZACION_REQUESTED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.ENVIO_REQUESTED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.CASE_CREATED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.CASE_ARCHIVED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PAYMENT_RECEIVED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PAYMENT_PENDING, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.ZONA_AMBIGUA, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.CANCELACION_REQUESTED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PAYMENT_CONFIRMED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PRICE_CONFIRMED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.DELIVERY_COMPLETED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.BOT_DISCONNECTED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.CUSTOMER_WAITING, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PHOTO_SENT, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.BOT_CONNECTED, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.BOT_DAILY_ALERT, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.BOT_DAILY_SUMMARY, (event) => {
    return routeNotification(event)
  })

  eventBus.subscribe(EventType.PHOTO_RECEIVED, (event) => {
    return withPipelinePhoto(event, enviarFotoTelegram)
  })

  eventBus.subscribe(EventType.PROVIDER_FAILURE, (event) => {
    return routeNotification(event)
  })
}
