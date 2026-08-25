// src/novedades/novedad.detector.ts
// Detector de novedades por REGLAS del backend (sin LLM), según AGENTS.md:
// las decisiones críticas pertenecen al backend; el LLM solo redacta.
// Funciones puras para facilitar pruebas.

import { EstadoPedido, Prioridad, TipoCaso, type Caso, type PedidoActual } from '../models/types'
import { variantesTelefono } from '../conversation/conversation.service'
import { TipoNovedad, type Novedad, type NovedadIA, type TranscripcionChat } from './types'

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

// ─── Matching de administradores por variantes de teléfono ──────────────────
// BUG-023: en México el mismo número existe como 521XXXXXXXXXX (13 dígitos,
// formato WhatsApp móvil) y 52XXXXXXXXXX (12 dígitos); el dígito extra va en
// MEDIO, así que una comparación por sufijo no lo detecta. Se comparan los
// conjuntos de variantes (misma lógica que usa el filtro de ignorados).
export function coincideAdminPorVariantes(numeroOJid: string, admins: string[]): boolean {
  const variantesMensaje = new Set(variantesTelefono(String(numeroOJid ?? '')))
  if (variantesMensaje.size === 0) return false
  return admins.some(admin => variantesTelefono(admin).some(v => variantesMensaje.has(v)))
}

// ─── Filtro de ruido (DEC-089) ───────────────────────────────────
// Regla del usuario: si el ÚLTIMO mensaje fue del EQUIPO y no hay pedido
// pendiente, el chat ya fue atendido — sin respuesta = no interesó. Se OMITE
// del resumen (novedades Y estados) para no saturar. Los chats donde el
// CLIENTE habló último siempre pasan; y los que tienen pedido pendiente
// (esperando nombre/fecha/pago o apartados) pasan aunque el equipo haya
// hablado último.

export function esPedidoPendiente(pedido: PedidoActual): boolean {
  const flujo = pedido.estadoFlujo ?? ''
  if (FLUJOS_ATASCADOS[flujo]) return true
  return pedido.estado === EstadoPedido.APARTADO || pedido.estado === EstadoPedido.EN_PRODUCCION
}

export function filtrarChatsRuido(
  chats: TranscripcionChat[],
  pedidos: PedidoConCliente[]
): { pasan: TranscripcionChat[]; omitidos: number } {
  // Teléfonos con pedido pendiente (todas las variantes)
  const pendientes = new Set<string>()
  for (const { pedido } of pedidos) {
    if (!esPedidoPendiente(pedido)) continue
    const tel = String(pedido.telefono ?? '')
    if (!tel) continue
    for (const v of variantesTelefono(tel)) pendientes.add(v)
  }
  const pasan: TranscripcionChat[] = []
  let omitidos = 0
  for (const c of chats) {
    // Cliente último → siempre pasa. Sistema último → anotación interna, neutro.
    if (c.ultimoOrigen === 'cliente' || c.ultimoOrigen === 'sistema') { pasan.push(c); continue }
    if (c.tienePedidoAbierto) { pasan.push(c); continue }
    const matchPend = variantesTelefono(c.telefono).some(v => pendientes.has(v))
    if (matchPend) { pasan.push(c); continue }
    omitidos++
  }
  return { pasan, omitidos }
}

// ─── Utilidades de presentación y detección de intención ────────────────────

// BUG-026: el digest muestra solo los últimos 4 dígitos del celular,
// nunca el número completo.
export function mascararTelefono(telefono: string): string {
  const d = String(telefono ?? '').replace(/\D/g, '')
  return d ? `•••• ${d.slice(-4)}` : '—'
}

// Extrae los últimos 4 dígitos cuando el admin menciona un número en su
// pregunta (ej. "¿qué pasó con el 7890?" → "7890").
export function extraerUltimos4(texto: string): string | null {
  const m = String(texto ?? '').match(/\d{3,}/)
  return m ? m[0].slice(-4) : null
}

// ─── Filtrar novedades a solo los chats activos de la ventana ───────────────
// BUG-025: el usuario pidió OMITIR chats antiguos. Las reglas del backend
// (pedidos/casos) pueden señalar teléfonos sin actividad reciente; aquí se
// descartan si el chat no tuvo mensajes dentro de la ventana analizada.
export function filtrarNovedadesDeChatsActivos(reglas: Novedad[], telefonosActivos: string[]): Novedad[] {
  const activos = new Set<string>()
  for (const t of telefonosActivos) {
    for (const v of variantesTelefono(t)) activos.add(v)
  }
  if (activos.size === 0) return []
  return reglas.filter(n => variantesTelefono(n.telefono).some(v => activos.has(v)))
}

export function fusionarNovedades(reglas: Novedad[], ia: Novedad[]): Novedad[] {
  const resultado: Novedad[] = [...reglas]
  for (const n of ia) {
    const duplicada = resultado.some(r => r.telefono === n.telefono && r.tipo === n.tipo)
    if (!duplicada) resultado.push(n)
  }
  return resultado
}
