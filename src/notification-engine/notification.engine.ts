import type { SystemEvent } from '../events/types'
import type { AccionNotificacion, DatosVerificados } from './types'
import type { BusinessRuleWarning } from './business-rules.validator'
import { buildTimeline } from './timeline.builder'
import { extractDecision } from './decision.extractor'
import { detectConflicts } from './conflict.detector'
import { reconstructOrder } from './order.reconstructor'
import { auditReconstruction } from './order.auditor'
import { validateBusinessRules } from './business-rules.validator'
import { buildTelegramMessage } from './template.builder'
import {
  logPipelineStart,
  logPipelineComplete,
  logPipelineError,
} from './pipeline-logger'
import { enviarMensajeTelegram } from '../../lib/telegram'

export interface PipelineResult {
  accion: AccionNotificacion
  razonBloqueo: string | null
  conflictos: { campo: string; descripcion: string; severity: string }[]
  advertencias: string[]
  ruleViolations: BusinessRuleWarning[]
  message: string | null
}

export async function processNotificationPipeline(
  event: SystemEvent
): Promise<PipelineResult> {
  const eventType = event.type
  const payload = event.payload
  const telefono = payload.telefono

  try {

  if (!telefono) {
    return {
      accion: 'NOTIFICAR',
      razonBloqueo: null,
      conflictos: [],
      advertencias: ['Evento sin teléfono — se notifica igual'],
      ruleViolations: [],
      message: null,
    }
  }

  const timeline = await buildTimeline(telefono).catch(err => {
    console.warn(`[NotifEngine] Timeline falló para ${eventType}:`, (err as Error)?.message ?? err)
    return null
  })

  logPipelineStart(event, timeline)

  if (!timeline) {
    return {
      accion: 'NOTIFICAR',
      razonBloqueo: null,
      conflictos: [],
      advertencias: ['Timeline no disponible — se notifica sin verificación'],
      ruleViolations: [],
      message: null,
    }
  }

  const datos = extractDecision(eventType, payload, timeline)
  const resultado = detectConflicts(eventType, datos, timeline)

  if (resultado.accion === 'BLOQUEAR') {
    const pipeResult: PipelineResult = {
      accion: 'BLOQUEAR',
      razonBloqueo: resultado.razonBloqueo,
      conflictos: resultado.conflictos.map(c => ({
        campo: c.campo,
        descripcion: c.descripcion,
        severity: c.severity,
      })),
      advertencias: [],
      ruleViolations: [],
      message: null,
    }
    logPipelineComplete(event, pipeResult)
    return pipeResult
  }

  const advertencias: string[] = []

  if (resultado.accion === 'ALERTA') {
    advertencias.push('Conflictos detectados — notificación enviada con precaución')
    for (const c of resultado.conflictos) {
      advertencias.push(`${c.campo}: ${c.descripcion}`)
    }
  }

  if (datos.requiereRevision) {
    advertencias.push(datos.razonRevision ?? 'Datos incompletos')
  }

  const reconstruction = await reconstructOrder(eventType, payload, timeline)

  if (reconstruction.warnings.length > 0) {
    for (const w of reconstruction.warnings) {
      advertencias.push(`[Reconstructor] ${w}`)
    }
  }

  const auditoria = await auditReconstruction(eventType, payload, timeline, reconstruction)

  if (auditoria.errors.length > 0) {
    for (const err of auditoria.errors) {
      advertencias.push(`[Auditor] ${err}`)
    }
  }

  if (!auditoria.approved) {
    advertencias.push('IA #2 rechazó la reconstrucción — revisar manualmente')
    if (auditoria.corrections.length > 0) {
      for (const c of auditoria.corrections) {
        advertencias.push(`[Corrección] ${c.field}: "${c.original}" → "${c.corrected}"`)
      }
    }
  }

  const ruleResults = validateBusinessRules({
    nombre: reconstruction.fields.name.value,
    sucursal: reconstruction.fields.sucursal.value,
    fecha: reconstruction.fields.fecha.value,
    hora: reconstruction.fields.hora.value,
    precio: reconstruction.fields.precio.value,
    producto: reconstruction.fields.producto.value,
    estado: reconstruction.fields.estado.value,
    metodoPago: payload.metodoPago ?? null,
    telefono: payload.telefono,
    requiereRevision: datos.requiereRevision,
    tipoEnvio: (payload.tipoEnvio as 'domicilio' | 'sucursal' | null) ?? null,
  })

  const tieneReglaError = ruleResults.some(r => r.severity === 'error')
  for (const r of ruleResults) {
    advertencias.push(`[R${r.ruleId}] ${r.message}`)
  }

  const accionFinal: AccionNotificacion =
    tieneReglaError ? 'ALERTA'
    : !auditoria.approved ? 'ALERTA'
    : resultado.accion

  const verified: DatosVerificados = {
    nombre: reconstruction.fields.name.value,
    sucursal: reconstruction.fields.sucursal.value,
    fecha: reconstruction.fields.fecha.value,
    hora: reconstruction.fields.hora.value,
    precio: reconstruction.fields.precio.value,
    producto: reconstruction.fields.producto.value,
    estado: reconstruction.fields.estado.value,
    metodoPago: payload.metodoPago ?? null,
    telefono: payload.telefono,
    pedidoId: null,
    casoId: null,
    prioridad: datos.prioridad,
    requiereRevision: datos.requiereRevision,
    razonRevision: datos.razonRevision,
    advertencias: advertencias,
  }

  const mensaje = buildTelegramMessage(eventType, payload, verified, {
    accion: accionFinal,
    razonBloqueo: null,
    conflictos: resultado.conflictos.map(c => ({
      campo: c.campo,
      descripcion: c.descripcion,
      severity: c.severity,
    })),
    advertencias,
    ruleViolations: ruleResults,
    message: null,
  })

  const pipeResult: PipelineResult = {
    accion: accionFinal,
    razonBloqueo: null,
    conflictos: resultado.conflictos.map(c => ({
      campo: c.campo,
      descripcion: c.descripcion,
      severity: c.severity,
    })),
    advertencias,
    ruleViolations: ruleResults,
    message: mensaje,
  }

  logPipelineComplete(event, pipeResult)
  return pipeResult

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logPipelineError(event, error)
    return {
      accion: 'NOTIFICAR',
      razonBloqueo: null,
      conflictos: [],
      advertencias: [`Error interno del pipeline: ${error.message}`],
      ruleViolations: [],
      message: null,
    }
  }
}

const EVENTOS_MEDIA: ReadonlySet<string> = new Set([
  'PHOTO_RECEIVED',
])

export async function withPipeline(
  event: SystemEvent,
  sendNotification: () => Promise<void>
): Promise<void> {
  const result = await processNotificationPipeline(event)

  if (result.accion === 'BLOQUEAR') {
    return
  }

  if (result.message && !EVENTOS_MEDIA.has(event.type)) {
    await enviarMensajeTelegram(result.message)
    return
  }

  await sendNotification()
}
