// src/pedidos/poda.service.ts
// PODA AUTOMÁTICA de pedidos estancados (DEC-090).
// Sin poda, el mapa PEDIDOS crece para siempre: había 123 "activos" con
// apartados de 24+ días sin pago. Política aprobada por el usuario:
//
//   cotización/NUEVO/COTIZANDO/PRECIO_CONFIRMADO/ESPERANDO_DATOS → archivo a los 7 días
//   ESPERANDO_PAGO / APARTADO                                    → recordatorio día 5, archivo día 10
//   LISTO                                                        → archivo a los 30 días
//   ENTREGADO                                                    → archivo a los 7 días
//   sin teléfono (huérfano)                                      → archivo directo
//   EN_PRODUCCION / QUEJA / POSTVENTA                            → nunca automático
//
// Silencioso: no se le escribe al cliente al archivar. Los recordatorios del
// día 5 se encolan y se envían en horario de atención (bot.ts).

import { EstadoPedido, type PedidoActual } from '../models/types'
import { archivarPedido, listarPedidosActivosGlobales, persistirPedidosEngine } from './pedido.service'
import { logger } from '../../lib/logger.service'

export type DecisionPoda = 'archivar' | 'recordar' | null

const DIAS_ARCHIVO_COTIZACION = 7
const DIAS_RECORDATORIO_APARTADO = 5
const DIAS_ARCHIVO_APARTADO = 10
const DIAS_ARCHIVO_LISTO = 30
const DIAS_ARCHIVO_ENTREGADO = 7

// Política PURA: decide qué hacer con un pedido según su antigüedad real
// (actualizadoEn que el Order Engine solo toca con actividad verdadera).
export function decidirPoda(p: PedidoActual): DecisionPoda {
  const telefono = String(p.telefono ?? '').trim()
  if (!telefono) return 'archivar' // huérfano

  const base = p.actualizadoEn || p.creadoEn
  if (!base) return null
  const dias = (Date.now() - new Date(base).getTime()) / 86_400_000
  if (!Number.isFinite(dias)) return null

  switch (p.estado) {
    case EstadoPedido.NUEVO:
    case EstadoPedido.COTIZANDO:
    case EstadoPedido.PRECIO_CONFIRMADO:
    case EstadoPedido.ESPERANDO_DATOS:
      return dias >= DIAS_ARCHIVO_COTIZACION ? 'archivar' : null
    case EstadoPedido.ESPERANDO_PAGO:
    case EstadoPedido.APARTADO:
      if (dias >= DIAS_ARCHIVO_APARTADO) return 'archivar'
      if (dias >= DIAS_RECORDATORIO_APARTADO) return 'recordar'
      return null
    case EstadoPedido.LISTO:
      return dias >= DIAS_ARCHIVO_LISTO ? 'archivar' : null
    case EstadoPedido.ENTREGADO:
      return dias >= DIAS_ARCHIVO_ENTREGADO ? 'archivar' : null
    default:
      return null // EN_PRODUCCION, QUEJA, POSTVENTA, ARCHIVADO…
  }
}

function mascara(t?: string): string {
  const d = String(t ?? '').replace(/\D/g, '')
  return d ? `••••${d.slice(-4)}` : '(s/tel)'
}

export interface ResultadoPoda {
  archivados: number
  recordatorios: { telefono: string; nombre?: string }[]
  detalles: string[]
}

let ultimaPodaResumen = ''
export function obtenerUltimaPodaResumen(): string {
  return ultimaPodaResumen
}

// Ejecuta la poda sobre TODOS los pedidos activos del Order Engine.
export async function ejecutarPodaPedidos(): Promise<ResultadoPoda> {
  const resultado: ResultadoPoda = { archivados: 0, recordatorios: [], detalles: [] }

  for (const { clienteId, pedido } of listarPedidosActivosGlobales()) {
    const decision = decidirPoda(pedido)
    if (!decision) continue
    const tel = mascara(pedido.telefono)
    const base = pedido.actualizadoEn || pedido.creadoEn
    const dias = base ? Math.floor((Date.now() - new Date(base).getTime()) / 86_400_000) : -1

    if (decision === 'recordar') {
      resultado.recordatorios.push({ telefono: String(pedido.telefono ?? ''), nombre: pedido.nombre })
      resultado.detalles.push(`⏰ ${tel} apartado ${dias}d — recordatorio`)
      continue
    }

    const motivo = `Poda automática: ${pedido.estado} sin actividad ${dias}d`
    const ok = archivarPedido(clienteId, motivo)
    if (ok) {
      resultado.archivados++
      resultado.detalles.push(`🗄️ ${tel} ${pedido.estado} ${dias}d`)
      logger.info('poda', `Archivado ${tel} (${pedido.estado}, ${dias}d inactivo)`)
    }
  }

  if (resultado.archivados > 0) {
    await persistirPedidosEngine()
  }
  ultimaPodaResumen = `🗄️ Poda: ${resultado.archivados} archivado(s)`
  console.log(`[poda] 🗄️ ${resultado.archivados} archivado(s), ${resultado.recordatorios.length} recordatorio(s) pendiente(s) de envío en horario`)
  return resultado
}
