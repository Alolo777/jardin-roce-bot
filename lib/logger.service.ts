import { supabaseAdmin } from './supabase'
import { eventBus } from '../src/events/event-bus'
import { EventType } from '../src/events/types'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id?: number
  level: LogLevel
  module: string
  message: string
  metadata?: Record<string, unknown>
  created_at?: string
}

const MAX_BUFFER = 500
const buffer: LogEntry[] = []
let flushTimer: NodeJS.Timeout | null = null
let pending: LogEntry[] = []

function pushBuffer(entry: LogEntry): void {
  buffer.push(entry)
  if (buffer.length > MAX_BUFFER) buffer.shift()
}

function consoleOut(level: LogLevel, module: string, message: string, metadata?: Record<string, unknown>): void {
  const prefix = `[${module}]`
  const meta = metadata && Object.keys(metadata).length ? ' ' + JSON.stringify(metadata) : ''
  if (level === 'error') console.error(prefix, message, meta)
  else if (level === 'warn') console.warn(prefix, message, meta)
  else console.log(prefix, message, meta)
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => { void flush() }, 1500)
  if (typeof flushTimer.unref === 'function') flushTimer.unref()
}

async function flush(): Promise<void> {
  flushTimer = null
  if (pending.length === 0) return
  const batch = pending
  pending = []
  try {
    await supabaseAdmin.from('logs').insert(batch)
  } catch (err) {
    console.error('[logger] Fallo al escribir logs en Supabase:', err)
  }
}

export const logger = {
  debug(module: string, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'debug', module, message, metadata: metadata ?? {} }
    pushBuffer(entry)
    consoleOut('debug', module, message, metadata)
  },
  info(module: string, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'info', module, message, metadata: metadata ?? {} }
    pushBuffer(entry)
    consoleOut('info', module, message, metadata)
    pending.push(entry)
    scheduleFlush()
  },
  warn(module: string, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'warn', module, message, metadata: metadata ?? {} }
    pushBuffer(entry)
    consoleOut('warn', module, message, metadata)
    pending.push(entry)
    scheduleFlush()
  },
  error(module: string, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = { level: 'error', module, message, metadata: metadata ?? {} }
    pushBuffer(entry)
    consoleOut('error', module, message, metadata)
    pending.push(entry)
    scheduleFlush()
  },
  getBuffer(): LogEntry[] {
    return [...buffer].reverse()
  },
}

export function subscribeLogEvents(): void {
  eventBus.subscribeAll((event) => {
    logger.info('event', `Evento ${event.type}`, {
      telefono: event.payload.telefono,
      cliente: event.payload.cliente,
      descripcion: event.payload.descripcion ? String(event.payload.descripcion).slice(0, 200) : undefined,
    })
  })
}

export function flushLogsNow(): Promise<void> {
  return flush()
}

export type { EventType }
