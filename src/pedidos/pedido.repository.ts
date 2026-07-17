import { supabaseAdmin } from '../../lib/supabase'
import { PedidoActual } from '../models/types'

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

export async function guardarPedidos(mapa: Map<string, PedidoActual>): Promise<void> {
  if (mapa.size === 0) return
  const obj: Record<string, PedidoActual> = {}
  for (const [id, pedido] of mapa) {
    obj[id] = sanitizarParaCache(pedido)
  }
  try {
    const { error } = await supabaseAdmin
      .from('bot_cache')
      .upsert({ key: PEDIDOS_CACHE_KEY, value: obj, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) console.warn('[pedido-repo] Error guardando:', error.message)
  } catch (err) {
    console.warn('[pedido-repo] Error guardando:', err)
  }
}

export async function cargarPedidos(): Promise<Map<string, PedidoActual>> {
  const mapa = new Map<string, PedidoActual>()
  try {
    const { data, error } = await supabaseAdmin
      .from('bot_cache')
      .select('value')
      .eq('key', PEDIDOS_CACHE_KEY)
      .single()
    if (error) {
      if (error.code !== 'PGRST116') console.warn('[pedido-repo] Error cargando:', error.message)
      return mapa
    }
    if (!data?.value) return mapa
    const obj = data.value as Record<string, PedidoActual>
    for (const [id, pedido] of Object.entries(obj)) {
      mapa.set(id, pedido)
    }
    console.log(`[pedido-repo] Cargados ${mapa.size} pedidos activos desde bot_cache`)
  } catch (err) {
    console.warn('[pedido-repo] Error cargando:', err)
  }
  return mapa
}
