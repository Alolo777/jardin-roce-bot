import { logger } from '../../lib/logger.service'
import type { SystemEvent } from '../events/types'
import type { TimelineData } from './types'
import type { PipelineResult } from './notification.engine'

const MODULE = 'pipeline'

function trunc(val: unknown, max = 500): string {
  const s = typeof val === 'string' ? val : JSON.stringify(val)
  if (!s || s.length <= max) return s ?? ''
  return s.slice(0, max) + '…'
}

export function logPipelineStart(event: SystemEvent, timeline: TimelineData | null): void {
  logger.info(MODULE, `Inicio pipeline · ${event.type}`, {
    eventType: event.type,
    telefono: event.payload.telefono,
    cliente: event.payload.cliente ?? null,
    producto: event.payload.producto ?? null,
    tieneTimeline: timeline !== null,
    existeCaso: timeline?.caso !== null,
    existePedido: timeline?.pedido !== null,
    estadoActual: timeline?.estadoActual ?? null,
  })
}

export function logPipelineComplete(event: SystemEvent, result: PipelineResult): void {
  const level = result.accion === 'BLOQUEAR' ? 'warn' : result.accion === 'ALERTA' ? 'warn' : 'info'
  logger[level](MODULE, `Pipeline ${result.accion} · ${event.type}`, {
    eventType: event.type,
    telefono: event.payload.telefono,
    accion: result.accion,
    razonBloqueo: result.razonBloqueo,
    conflictos: result.conflictos.length > 0
      ? result.conflictos.map(c => ({ campo: c.campo, severity: c.severity, desc: trunc(c.descripcion, 200) }))
      : undefined,
    advertencias: result.advertencias.length > 0
      ? result.advertencias.map(w => trunc(w, 200))
      : undefined,
    ruleViolations: result.ruleViolations.length > 0
      ? result.ruleViolations.map(r => ({ ruleId: r.ruleId, field: r.field, severity: r.severity }))
      : undefined,
    tieneMensaje: result.message !== null,
  })
}

export function logPipelineError(event: SystemEvent, error: Error): void {
  logger.error(MODULE, `Pipeline error · ${event.type}`, {
    eventType: event.type,
    telefono: event.payload.telefono,
    error: error.message,
    stack: trunc(error.stack, 500),
  })
}

export function logPipelineStep(
  event: SystemEvent,
  step: string,
  data?: Record<string, unknown>
): void {
  logger.info(MODULE, `Paso: ${step} · ${event.type}`, {
    eventType: event.type,
    telefono: event.payload.telefono,
    ...(data ? { data: trunc(JSON.stringify(data), 800) } : {}),
  })
}
