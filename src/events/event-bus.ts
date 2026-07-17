import { EventType, SystemEvent, EventPayload } from './types'

type EventHandler = (event: SystemEvent) => void | Promise<void>

interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>()
  private history: SystemEvent[] = []
  private maxHistory = 200
  private retryConfig: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }

  setRetryConfig(config: Partial<RetryConfig>): void {
    Object.assign(this.retryConfig, config)
  }

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
      promises.push(this.executeWithRetry(handler, event, type))
    }

    await Promise.allSettled(promises)
  }

  private async executeWithRetry(handler: EventHandler, event: SystemEvent, type: EventType): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const result = handler(event)
        if (result instanceof Promise) await result
        return
      } catch (err) {
        lastError = err
        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt),
            this.retryConfig.maxDelayMs
          )
          console.warn(`[EventBus] Handler failed for ${type} (retry ${attempt + 1}/${this.retryConfig.maxRetries} in ${delay}ms):`, (err as Error)?.message ?? err)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    console.error(`[EventBus] Handler exhausted retries for ${type}:`, lastError)
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
