import { supabaseAdmin } from '../../lib/supabase'
import { EstadoPedido, PedidoActual } from '../models/types'

const PEDIDOS_CACHE_KEY = 'pedidos_engine'

function sanitizarParaCache(pedido: PedidoActual): PedidoActual {
  const {
    fotoReferenciaBase64: _a,
    fotoReferenciaMimetype: _b,
    fotoReferenciaCaption: _c,
    fotoReferenciaRecibidaEn: _d,
    ...resto
  } = pedido
  return resto
}

export async function guardarPedidos(mapa: Map<string, PedidoActual[]>): Promise<void> {
  if (mapa.size === 0) return
  const obj: Record<string, PedidoActual[]> = {}
  for (const [id, pedidos] of mapa) {
    obj[id] = pedidos.map(sanitizarParaCache)
  }
  const { error } = await supabaseAdmin
    .from('bot_cache')
    .upsert({ key: PEDIDOS_CACHE_KEY, value: obj, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) {
    console.warn('[pedido-repo] Error guardando bot_cache:', error.message)
    throw error
  }
}

export async function cargarPedidos(): Promise<Map<string, PedidoActual[]>> {
  const mapa = new Map<string, PedidoActual[]>()
  try {
    const { data, error } = await supabaseAdmin
      .from('bot_cache')
      .select('value')
      .eq('key', PEDIDOS_CACHE_KEY)
      .single()
    if (error) {
      if (error.code !== 'PGRST116') console.warn('[pedido-repo] Error cargando:', error.message)
    } else if (data?.value) {
      const raw = data.value as Record<string, unknown>
      for (const [id, valor] of Object.entries(raw)) {
        if (Array.isArray(valor)) {
          mapa.set(id, valor as PedidoActual[])
        } else if (valor && typeof valor === 'object') {
          // Retrocompatibilidad: datos antiguos guardados como un solo pedido
          mapa.set(id, [valor as PedidoActual])
        }
      }
      console.log(`[pedido-repo] Cargados ${mapa.size} clientes con pedidos desde bot_cache`)
    }
  } catch (err) {
    console.warn('[pedido-repo] Error cargando:', err)
  }

  if (mapa.size > 0) {
    try {
      const clienteIds = [...mapa.keys()]
      const { data: pedidosBot } = await supabaseAdmin
        .from('pedidos_bot')
        .select('cliente_id, foto_referencia_base64, foto_referencia_mimetype, foto_referencia_caption, foto_referencia_recibida_en')
        .in('cliente_id', clienteIds)
      if (pedidosBot) {
        for (const row of pedidosBot) {
          const pedidos = mapa.get(row.cliente_id)
          if (pedidos && pedidos.length > 0 && row.foto_referencia_base64) {
            const ultimo = pedidos[pedidos.length - 1]!
            ultimo.fotoReferenciaBase64 = row.foto_referencia_base64
            ultimo.fotoReferenciaMimetype = row.foto_referencia_mimetype
            ultimo.fotoReferenciaCaption = row.foto_referencia_caption
            ultimo.fotoReferenciaRecibidaEn = row.foto_referencia_recibida_en
          }
        }
        console.log(`[pedido-repo] Restauradas fotos de referencia para ${pedidosBot.filter(r => r.foto_referencia_base64).length} pedidos`)
      }
    } catch (err) {
      console.warn('[pedido-repo] Error restaurando fotos:', err)
    }
  }

  return mapa
}

const ESTADO_PEDIDOS_BOT: Partial<Record<EstadoPedido, string>> = {
  [EstadoPedido.NUEVO]: 'cotizacion',
  [EstadoPedido.COTIZANDO]: 'cotizacion',
  [EstadoPedido.PRECIO_CONFIRMADO]: 'apartado',
  [EstadoPedido.ESPERANDO_DATOS]: 'apartado',
  [EstadoPedido.ESPERANDO_PAGO]: 'apartado',
  [EstadoPedido.APARTADO]: 'apartado',
  [EstadoPedido.EN_PRODUCCION]: 'pagado',
  [EstadoPedido.LISTO]: 'pagado',
  [EstadoPedido.ENTREGADO]: 'entregado',
  [EstadoPedido.ARCHIVADO]: 'entregado',
  [EstadoPedido.CANCELADO]: 'cancelado',
  [EstadoPedido.QUEJA]: 'apartado',
  [EstadoPedido.POSTVENTA]: 'entregado',
}

function derivarEstado(ep: EstadoPedido | undefined): string {
  if (!ep) return 'cotizacion'
  return ESTADO_PEDIDOS_BOT[ep] ?? 'cotizacion'
}

export async function sincronizarPedidosBot(mapa: Map<string, PedidoActual[]>): Promise<void> {
  if (mapa.size === 0) return
  const errores: string[] = []
  for (const [clienteId, pedidos] of mapa) {
    const activos = pedidos.filter(p => p.estado !== EstadoPedido.ARCHIVADO && p.estado !== EstadoPedido.CANCELADO)
    const pedido = activos[activos.length - 1]
    if (!pedido) continue
    const total = (
      (pedido.precioPersonalizado ?? 0) +
      (pedido.extras?.reduce((s, e) => s + (e.precio ?? 0), 0) ?? 0) +
      (pedido.envio?.precio ?? 0)
    ) || null
    const base = {
      cliente_id: clienteId,
      telefono: pedido.telefono ?? null,
      estado: derivarEstado(pedido.estado),
      cliente_nombre: pedido.nombre ?? null,
      producto: pedido.arreglo?.nombre ?? pedido.productoPersonalizado ?? null,
      arreglo_id: pedido.arreglo?.id ?? null,
      precio_arreglo: pedido.arreglo?.precio ?? pedido.precioPersonalizado ?? null,
      zona_envio: pedido.envio?.zona ?? null,
      precio_envio: pedido.envio?.precio ?? null,
      direccion: pedido.direccion ?? null,
      sucursal: pedido.sucursal ?? null,
      metodo_pago: pedido.metodoPago ?? null,
      nota: pedido.nota ?? null,
      total,
      requiere_revision: false,
      actualizado_en: new Date().toISOString(),
      estado_flujo: pedido.estadoFlujo ?? null,
      fecha_entrega: pedido.fechaEntrega ?? null,
      hora_entrega: pedido.horaEntrega ?? null,
      foto_referencia_base64: pedido.fotoReferenciaBase64 ?? null,
      foto_referencia_mimetype: pedido.fotoReferenciaMimetype ?? null,
      foto_referencia_caption: pedido.fotoReferenciaCaption ?? null,
      foto_referencia_recibida_en: pedido.fotoReferenciaRecibidaEn ?? null,
      detalles_especiales: pedido.detallesEspeciales ?? null,
      precio_confirmado_por: pedido.precioConfirmadoPor ?? null,
      caso_id: pedido.casoId ?? null,
      cerrado_en: pedido.cerradoEn ?? null,
    }
    try {
      const { error } = await supabaseAdmin.from('pedidos_bot').upsert(base, { onConflict: 'cliente_id' })
      if (error && /estado_flujo|fecha_entrega|foto_referencia|detalles_especiales|precio_confirmado_por|caso_id|cerrado_en|schema cache|column/i.test(error.message || '')) {
        const { error: error2 } = await supabaseAdmin.from('pedidos_bot').upsert({
          cliente_id: base.cliente_id,
          telefono: base.telefono,
          estado: base.estado,
          cliente_nombre: base.cliente_nombre,
          producto: base.producto,
          arreglo_id: base.arreglo_id,
          precio_arreglo: base.precio_arreglo,
          zona_envio: base.zona_envio,
          precio_envio: base.precio_envio,
          direccion: base.direccion,
          sucursal: base.sucursal,
          nota: base.nota,
          total: base.total,
          requiere_revision: false,
          actualizado_en: base.actualizado_en,
        }, { onConflict: 'cliente_id' })
        if (error2) errores.push(`${clienteId}: ${error2.message}`)
      } else if (error) {
        errores.push(`${clienteId}: ${error.message}`)
      }
    } catch (err) {
      errores.push(`${clienteId}: ${String(err)}`)
    }
  }
  if (errores.length > 0) {
    const mensaje = `Error sincronizando pedidos_bot (${errores.length}): ${errores.join(' | ')}`
    console.warn(`[pedido-repo] ${mensaje}`)
    throw new Error(mensaje)
  }
}
