import { EventType, SystemEvent, EventPayload } from './types'

type EventHandler = (event: SystemEvent) => void | Promise<void>

class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>()
  private history: SystemEvent[] = []
  private maxHistory = 200

  subscribe(type: EventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => { this.handlers.get(type)?.delete(handler) }
  }

  subscribeAll(handler: EventHandler): () => void {
    const unsubscribers: (() => void)[] = []
    for (const type of Object.values(EventType)) {
      unsubscribers.push(this.subscribe(type, handler))
    }
    return () => { for (const unsub of unsubscribers) unsub() }
  }

  async emit(type: EventType, payload: EventPayload): Promise<void> {
    const event: SystemEvent = {
      id: generateId(),
      type,
      payload: { ...payload, timestamp: payload.timestamp ?? new Date().toISOString() },
      timestamp: new Date().toISOString(),
    }

    this.history.push(event)
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }

    const handlers = this.handlers.get(type)
    if (!handlers || handlers.size === 0) return

    const promises: Promise<void>[] = []
    for (const handler of handlers) {
      try {
        const result = handler(event)
        if (result instanceof Promise) promises.push(result)
      } catch (err) {
        console.error(`[EventBus] Error in handler for ${type}:`, err)
      }
    }

    if (promises.length > 0) await Promise.allSettled(promises)
  }

  getHistory(type?: EventType): SystemEvent[] {
    if (type) return this.history.filter(e => e.type === type)
    return [...this.history]
  }

  clear(): void {
    this.history = []
    this.handlers.clear()
  }
}

let counter = 0

function generateId(): string {
  return `evt_${Date.now()}_${++counter}`
}

export const eventBus = new EventBus()
