import { supabaseAdmin } from '../../lib/supabase'
import type { TimelineData } from './types'

const MAX_HISTORIAL = 20

export async function buildTimeline(
  telefono: string
): Promise<TimelineData> {
  const clienteId = await buscarClienteId(telefono)

  const [caso, pedido, historial] = await Promise.all([
    buscarCasoActivo(clienteId, telefono),
    buscarPedidoReciente(clienteId, telefono),
    cargarHistorial(clienteId),
  ])

  const ultimaActividad = [
    caso?.ultima_actividad,
    pedido?.actualizado_en,
    historial[0]?.creadoEn,
  ].filter(Boolean).sort().reverse()[0] || null

  const estadoActual = pedido?.estado ?? caso?.estado ?? null
  const pedidoCanceladoOArchivado = pedido?.estado === 'cancelado' || pedido?.estado === 'entregado'

  return {
    telefono,
    clienteId,
    caso: caso ? mapearCaso(caso) : null,
    pedido: pedido ? mapearPedido(pedido) : null,
    historial,
    ultimaActividad,
    estadoActual,
    existePedidoActivo: !!pedido && !pedidoCanceladoOArchivado,
    pedidoCanceladoOArchivado,
  }
}

async function buscarClienteId(telefono: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('telefono', telefono)
      .maybeSingle()
    return data?.id ?? null
  } catch {
    return null
  }
}

async function buscarCasoActivo(
  clienteId: string | null,
  telefono: string
) {
  if (clienteId) {
    const { data } = await supabaseAdmin
      .from('casos')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('estado', 'ACTIVO')
      .order('ultima_actividad', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  const { data } = await supabaseAdmin
    .from('casos')
    .select('*')
    .eq('telefono', telefono)
    .eq('estado', 'ACTIVO')
    .order('ultima_actividad', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function buscarPedidoReciente(
  clienteId: string | null,
  telefono: string
) {
  let data: any = null

  if (clienteId) {
    const result = await supabaseAdmin
      .from('pedidos_bot')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('actualizado_en', { ascending: false })
      .limit(1)
      .maybeSingle()
    data = result.data ?? null
  }

  if (!data) {
    const result = await supabaseAdmin
      .from('pedidos_bot')
      .select('*')
      .eq('telefono', telefono)
      .order('actualizado_en', { ascending: false })
      .limit(1)
      .maybeSingle()
    data = result.data ?? null
  }

  return data
}

function mapearCaso(data: Record<string, any>) {
  return {
    id: data.id,
    clienteId: data.cliente_id,
    telefono: data.telefono,
    tipo: data.tipo,
    estado: data.estado,
    prioridad: data.prioridad,
    pedidoId: data.pedido_id,
    creadoEn: data.creado_en,
    ultimaActividad: data.ultima_actividad,
    archivadoEn: data.archivado_en,
  }
}

function mapearPedido(data: Record<string, any>) {
  return {
    id: data.cliente_id,
    estado: data.estado,
    estadoFlujo: data.estado_flujo,
    telefono: data.telefono,
    nombre: data.cliente_nombre,
    actualizadoEn: data.actualizado_en,
    creadoEn: data.creado_en,
    arreglo: data.producto ? { nombre: data.producto, precio: data.precio_arreglo } : undefined,
    precioPersonalizado: data.precio_arreglo ?? undefined,
    sucursal: data.sucursal,
    fechaEntrega: data.fecha_entrega,
    horaEntrega: data.hora_entrega,
    direccion: data.direccion,
    metodoPago: data.metodo_pago,
    envio: data.zona_envio ? { zona: data.zona_envio, precio: data.precio_envio } : undefined,
    requiereRevision: data.requiere_revision,
    detallesEspeciales: data.detalles_especiales,
  }
}

async function cargarHistorial(clienteId: string | null) {
  if (!clienteId) return []
  try {
    const { data } = await supabaseAdmin
      .from('historial_chat')
      .select('rol, contenido, creado_en')
      .eq('cliente_id', clienteId)
      .order('creado_en', { ascending: false })
      .limit(MAX_HISTORIAL)

    return (data ?? []).map(m => ({
      rol: m.rol,
      contenido: m.contenido,
      creadoEn: m.creado_en,
    })).reverse()
  } catch {
    return []
  }
}
