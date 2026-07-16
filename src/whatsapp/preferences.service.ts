import { supabaseAdmin } from '../../lib/supabase'
import { variantesTelefono } from '../conversation/conversation.service'

const IGNORADOS_CACHE_STORE: { lista: string[]; ts: number } = { lista: [], ts: 0 }

export async function cargarIgnorados(): Promise<string[]> {
  const ahora = Date.now()
  if (ahora - IGNORADOS_CACHE_STORE.ts < 5_000) return IGNORADOS_CACHE_STORE.lista
  try {
    const { data } = await supabaseAdmin.from('numeros_ignorados').select('numero')
    IGNORADOS_CACHE_STORE.lista = [...new Set((data || []).flatMap(n => variantesTelefono(n.numero)))]
    IGNORADOS_CACHE_STORE.ts = ahora
  } catch { /* mantener caché */ }
  return IGNORADOS_CACHE_STORE.lista
}

export const MENSAJES_RESCATADOS = new Set<string>()
