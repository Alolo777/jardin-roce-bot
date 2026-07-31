import { EventType, SystemEvent } from './types'
import { withPipeline } from '../notification-engine'

const EVENTOS_CRITICOS: ReadonlySet<EventType> = new Set([
  EventType.HUMAN_REQUIRED,
  EventType.CUSTOMER_ANGRY,
  EventType.CUSTOMER_WAITING,
  EventType.PAYMENT_CONFIRMED,
  EventType.CANCELACION_REQUESTED,
  EventType.PROVIDER_FAILURE,
  EventType.BOT_DISCONNECTED,
  EventType.BOT_CONNECTED,
  EventType.BOT_DAILY_ALERT,
  EventType.BOT_DAILY_SUMMARY,
])

const EVENTOS_INFORMATIVOS: ReadonlySet<EventType> = new Set([
  EventType.ORDER_UPDATED,
  EventType.PRICE_CONFIRMED,
  EventType.PHOTO_SENT,
  EventType.CASE_ARCHIVED,
])

const PENDING_NOTIFICATIONS = new Map<string, { event: SystemEvent; timer: NodeJS.Timeout }>()
export const AGGREGATION_WINDOW_MS = 2 * 60_000

export function routeNotification(event: SystemEvent): Promise<void> | void {
  if (EVENTOS_CRITICOS.has(event.type)) {
    return withPipeline(event)
  }

  if (EVENTOS_INFORMATIVOS.has(event.type)) {
    return
  }

  const key = event.payload.orderId ?? event.payload.telefono
  if (!key) {
    return withPipeline(event)
  }

  const existing = PENDING_NOTIFICATIONS.get(key)
  if (existing) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    PENDING_NOTIFICATIONS.delete(key)
    void withPipeline(event)
  }, AGGREGATION_WINDOW_MS)
  timer.unref?.()

  PENDING_NOTIFICATIONS.set(key, { event, timer })
}

export function getPendingNotificationsCount(): number {
  return PENDING_NOTIFICATIONS.size
}
