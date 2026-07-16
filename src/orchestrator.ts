import { analizarIntencion, Decision } from './decision/decision.engine'
import { crearCaso, obtenerCasoActivo, actualizarActividad, detectarCambioTema, clasificarTipoCaso } from './casos/caso.service'
import { crearPedido, obtenerPedido } from './pedidos/pedido.service'
import { construirContextoPrompt } from './openai/prompt.builder'
import { Caso, PedidoActual } from '../models/types'

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
    casoActivo = crearCaso(mensaje.clienteId, mensaje.telefono, clasificarTipoCaso(mensaje.texto))
  }
  actualizarActividad(casoActivo)

  if (!obtenerPedido(mensaje.clienteId)) {
    crearPedido(mensaje.clienteId, mensaje.telefono)
  }

  const pedidoActivo = obtenerPedido(mensaje.clienteId)
  const contextoPrompt = construirContextoPrompt({
    decision,
    caso: casoActivo,
    pedido: pedidoActivo,
    textoCliente: mensaje.texto,
    horaActual: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    fechaActual: new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' }),
  })

  return { decision, casoActivo, pedidoActivo, contextoPrompt }
}
