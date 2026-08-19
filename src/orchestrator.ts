import { analizarIntencion, Decision } from './decision/decision.engine'
import { crearCaso, obtenerCasoActivo, actualizarActividad, detectarCambioTema } from './casos/caso.service'
import { crearPedido, obtenerPedido, sincronizarConCaso } from './pedidos/pedido.service'
import { construirContextoPrompt, buildValidatedRulesSection } from './openai/prompt.builder'
import { Caso, PedidoActual } from './models/types'
import { ahoraCdmx } from './whatsapp/message-utils'

export interface MensajeEntrante {
  texto: string
  clienteId: string
  telefono: string
  horasInactivo: number
}

export interface ContextoProcesamiento {
  decision: Decision
  casoActivo: Caso | null
  pedidoActivo: PedidoActual | null
  contextoPrompt: string
}

export function procesarMensajePre(mensaje: MensajeEntrante): ContextoProcesamiento {
  const decision = analizarIntencion({
    texto: mensaje.texto,
    horasInactivo: mensaje.horasInactivo,
  })

  let casoActivo = obtenerCasoActivo(mensaje.clienteId)
  if (!casoActivo || detectarCambioTema(mensaje.texto, mensaje.horasInactivo)) {
    casoActivo = crearCaso(mensaje.clienteId, mensaje.telefono, undefined, undefined, { decisionIntencion: decision.intencion })
  }
  actualizarActividad(casoActivo)

  let pedidoActivo = obtenerPedido(mensaje.clienteId)
  if (!pedidoActivo) {
    pedidoActivo = crearPedido(mensaje.clienteId, mensaje.telefono)
    if (casoActivo?.id && pedidoActivo.id) sincronizarConCaso(pedidoActivo, casoActivo.id)
  }
  const contextoPrompt = [
    buildValidatedRulesSection(),
    construirContextoPrompt({
      decision,
      caso: casoActivo,
      pedido: pedidoActivo,
      textoCliente: mensaje.texto,
      horaActual: ahoraCdmx().etiqueta12,
      fechaActual: new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' }),
    }),
  ].join('\n\n')

  return { decision, casoActivo, pedidoActivo, contextoPrompt }
}
