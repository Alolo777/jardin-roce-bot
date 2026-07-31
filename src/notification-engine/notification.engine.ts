import { EventType, type SystemEvent } from '../events/types'
import type { AccionNotificacion, DatosVerificados } from './types'
import type { BusinessRuleWarning } from './business-rules.validator'
import { buildTimeline } from './timeline.builder'
import { extractDecision } from './decision.extractor'
import { detectConflicts } from './conflict.detector'
import { validateBusinessRules } from './business-rules.validator'
import { buildTelegramMessage } from './template.builder'
import {
  logPipelineStart,
  logPipelineComplete,
  logPipelineError,
} from './pipeline-logger'
import { enviarMensajeTelegram } from '../../lib/telegram'

// ─── Eventos de sistema que no necesitan verificación de datos ──────────────
const SYSTEM_EVENTS_SKIP_AI: ReadonlySet<string> = new Set([
  EventType.BOT_DISCONNECTED,
  EventType.BOT_CONNECTED,
  EventType.QR_GENERATED,
  EventType.PROVIDER_FAILURE,
  EventType.BOT_DAILY_ALERT,
  EventType.BOT_DAILY_SUMMARY,
])

const LIGHTWEIGHT_EVENTS_SKIP_AI: ReadonlySet<string> = new Set([
  EventType.COTIZACION_REQUESTED,
  EventType.ENVIO_REQUESTED,
  EventType.PHOTO_RECEIVED,
  EventType.PHOTO_SENT,
])

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

  const esEventoSistema = SYSTEM_EVENTS_SKIP_AI.has(eventType)
  const esEventoLightweight = LIGHTWEIGHT_EVENTS_SKIP_AI.has(eventType)
  const saltarVerificacion = esEventoSistema || esEventoLightweight

  let ruleResults: BusinessRuleWarning[] = []

  if (!saltarVerificacion) {
    ruleResults = validateBusinessRules({
      nombre: payload.cliente ?? timeline.pedido?.nombre ?? null,
      sucursal: payload.sucursal ?? timeline.pedido?.sucursal ?? null,
      fecha: timeline.pedido?.fechaEntrega ?? null,
      hora: timeline.pedido?.horaEntrega ?? null,
      precio: payload.total ?? (timeline.pedido as any)?.precioPersonalizado ?? null,
      producto: payload.producto ?? (timeline.pedido as any)?.arreglo?.nombre ?? null,
      estado: (timeline.pedido?.estado as string) ?? null,
      metodoPago: payload.metodoPago ?? null,
      telefono: payload.telefono,
      requiereRevision: datos.requiereRevision,
      tipoEnvio: (payload.tipoEnvio as 'domicilio' | 'sucursal' | null) ?? null,
    })

    for (const r of ruleResults) {
      advertencias.push(`[R${r.ruleId}] ${r.message}`)
    }
  } else {
    advertencias.push(esEventoSistema
      ? '[Pipeline] Evento de sistema — verificación omitida'
      : '[Pipeline] Evento informativo — verificación omitida')
  }

  const tieneReglaError = ruleResults.some(r => r.severity === 'error')

  const accionFinal: AccionNotificacion =
    tieneReglaError ? 'ALERTA'
    : resultado.accion

  const verified: DatosVerificados = {
    nombre: payload.cliente ?? timeline.pedido?.nombre ?? null,
    sucursal: payload.sucursal ?? timeline.pedido?.sucursal ?? null,
    fecha: timeline.pedido?.fechaEntrega ?? null,
    hora: timeline.pedido?.horaEntrega ?? null,
    precio: payload.total ?? (timeline.pedido as any)?.precioPersonalizado ?? null,
    producto: payload.producto ?? (timeline.pedido as any)?.arreglo?.nombre ?? null,
    estado: (timeline.pedido?.estado as string) ?? null,
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

export async function withPipeline(
  event: SystemEvent
): Promise<void> {
  const result = await processNotificationPipeline(event)

  if (result.accion === 'BLOQUEAR') {
    return
  }

  const mensaje = result.message ?? buildTelegramMessage(event.type, event.payload, {
    nombre: null,
    sucursal: null,
    fecha: null,
    hora: null,
    precio: null,
    producto: null,
    estado: null,
    metodoPago: null,
    telefono: event.payload.telefono,
    pedidoId: null,
    casoId: null,
    prioridad: 'media',
    requiereRevision: false,
    razonRevision: null,
    advertencias: [],
  }, {
    accion: 'NOTIFICAR',
    razonBloqueo: null,
    conflictos: [],
    advertencias: [],
    ruleViolations: [],
    message: null,
  })

  await enviarMensajeTelegram(mensaje)
}

export async function withPipelinePhoto(
  event: SystemEvent,
  sendPhoto: (base64: string, caption: string, mimetype: string) => Promise<void>
): Promise<void> {
  const result = await processNotificationPipeline(event)

  if (result.accion === 'BLOQUEAR') {
    return
  }

  const { telefono, base64, caption, mimetype } = event.payload as any

  if (base64 && sendPhoto) {
    const prefix = event.payload.tipo === 'comprobante'
      ? '📸 *Comprobante de pago*'
      : event.payload.tipo === 'referencia'
        ? '📷 *Foto de referencia*'
        : '📸 *Imagen del cliente*'
    const texto = `${prefix} — ${telefono}${caption ? `\n\n${caption}` : ''}`
    await sendPhoto(base64, texto, mimetype ?? 'image/jpeg')
  }
}
