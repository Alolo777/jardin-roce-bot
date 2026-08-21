// src/novedades/novedad.detector.ts
// Detector de novedades por REGLAS del backend (sin LLM), según AGENTS.md:
// las decisiones críticas pertenecen al backend; el LLM solo redacta.
// Funciones puras para facilitar pruebas.

import { EstadoPedido, Prioridad, TipoCaso, type Caso, type PedidoActual } from '../models/types'
import { TipoNovedad, type Novedad, type NovedadIA } from './types'

export interface PedidoConCliente {
  clienteId: string
  pedido: PedidoActual
}

// Estados de flujo que indican un pedido detenido esperando acción del equipo
const FLUJOS_ATASCADOS: Record<string, string> = {
  esperando_precio_equipo: 'espera que el equipo confirme el precio',
  esperando_precio_envio: 'espera el costo de envío confirmado por el equipo',
  precio_confirmado: 'tiene precio confirmado y no ha dado seguimiento al pago',
  esperando_pago: 'tiene pedido apartado y aún no manda comprobante de pago',
  esperando_fecha_hora: 'falta fecha/hora de entrega para cerrar su pedido',
  esperando_nombre: 'falta el nombre para cerrar su pedido',
}

function telefonoDePedido(pedido: PedidoActual): string {
  return String(pedido.telefono ?? '').trim()
}

function descripcionPedido(pedido: PedidoActual): string {
  return pedido.arreglo?.nombre || pedido.productoPersonalizado || pedido.descripcion || 'su pedido'
}

// ─── Pedidos atascados (señales de pedidos_bot / Order Engine) ──────────────

export function detectarPedidosAtascos(pedidos: PedidoConCliente[]): Novedad[] {
  const novedades: Novedad[] = []
  for (const { pedido } of pedidos) {
    const telefono = telefonoDePedido(pedido)
    if (!telefono) continue
    if (pedido.estado && [EstadoPedido.ENTREGADO, EstadoPedido.ARCHIVADO, EstadoPedido.CANCELADO].includes(pedido.estado)) continue

    const flujo = pedido.estadoFlujo ?? ''
    const motivo = FLUJOS_ATASCADOS[flujo]
    if (!motivo) continue

    let tipo = TipoNovedad.PEDIDO_SIN_TRATAR
    if (flujo === 'esperando_precio_equipo' || flujo === 'esperando_precio_envio') tipo = TipoNovedad.COTIZACION_PENDIENTE
    if (flujo === 'esperando_pago') tipo = TipoNovedad.PAGO_PENDIENTE

    novedades.push({
      telefono,
      cliente: pedido.nombre,
      tipo,
      resumen: `${descripcionPedido(pedido)} — ${motivo}`,
      prioridad: tipo === TipoNovedad.PAGO_PENDIENTE ? 'media' : 'media',
      fuente: 'reglas',
    })
  }
  return novedades
}

// ─── Casos que requieren atención humana (quejas / prioridad alta) ──────────

export function detectarCasosAtencion(casos: Caso[]): Novedad[] {
  const novedades: Novedad[] = []
  for (const caso of casos) {
    if (!caso.telefono) continue
    const esQueja = caso.tipo === TipoCaso.QUEJA
    const esUrgente = caso.prioridad === Prioridad.ALTA || caso.prioridad === Prioridad.CRITICA
    if (!esQueja && !esUrgente) continue
    novedades.push({
      telefono: caso.telefono,
      tipo: esQueja ? TipoNovedad.QUEJA : TipoNovedad.DUDA_SIN_RESPONDER,
      resumen: esQueja
        ? 'tiene una queja o reclamo abierto que requiere atención del equipo'
        : `caso ${String(caso.tipo).toLowerCase()} con prioridad ${caso.prioridad} sin resolver`,
      prioridad: caso.prioridad === Prioridad.CRITICA ? 'alta' : 'media',
      fuente: 'reglas',
    })
  }
  return novedades
}

// ─── Fusión de novedades (reglas + IA) con deduplicación ────────────────────
// Prioriza 'reglas' sobre 'ia' para el mismo teléfono+tipo. Las novedades IA
// del mismo teléfono con distinto tipo se conservan (un chat puede tener varias).

const TIPOS_IA_VALIDOS = new Set<string>(Object.values(TipoNovedad))

// Normaliza la salida cruda del LLM a Novedad válida (o null si viene inválida).
export function normalizarNovedadIA(cruda: NovedadIA): Novedad | null {
  const telefono = String(cruda?.telefono ?? '').trim()
  const resumen = String(cruda?.resumen ?? '').trim().slice(0, 160)
  if (!telefono || !resumen) return null
  const tipo = TIPOS_IA_VALIDOS.has(cruda?.tipo) ? (cruda.tipo as TipoNovedad) : TipoNovedad.OTRO
  const prioridad = cruda?.prioridad === 'alta' || cruda?.prioridad === 'baja' ? cruda.prioridad : 'media'
  return { telefono, tipo, resumen, prioridad, fuente: 'ia' }
}

export function fusionarNovedades(reglas: Novedad[], ia: Novedad[]): Novedad[] {
  const resultado: Novedad[] = [...reglas]
  for (const n of ia) {
    const duplicada = resultado.some(r => r.telefono === n.telefono && r.tipo === n.tipo)
    if (!duplicada) resultado.push(n)
  }
  return resultado
}
