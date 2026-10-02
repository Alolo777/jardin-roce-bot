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

// Descripción de la fila en `numeros_ignorados` que coincide con alguna
// variante del número (o null si no está silenciado). Se usa para distinguir
// la toma humana del dashboard (sí se guarda en historial para la bandeja)
// de los silenciados permanentes (no se guardan). Sin caché: solo se llama
// para mensajes ya filtrados como ignorados (volumen bajo).
export async function obtenerDescripcionIgnorado(variantes: string[]): Promise<string | null> {
  if (!variantes || variantes.length === 0) return null
  try {
    const { data } = await supabaseAdmin
      .from('numeros_ignorados')
      .select('numero, descripcion')
      .in('numero', variantes)
      .limit(10)
    if (!data || data.length === 0) {
      // El número base puede ser otra variante MX (52/521): comparar expandido.
      const { data: todos } = await supabaseAdmin
        .from('numeros_ignorados')
        .select('numero, descripcion')
      const buscados = new Set(variantes)
      for (const fila of todos ?? []) {
        const expandidas = variantesTelefono(String(fila.numero ?? ''))
        if (expandidas.some((v) => buscados.has(v))) {
          return (fila.descripcion as string) ?? null
        }
      }
      return null
    }
    return (data[0].descripcion as string) ?? null
  } catch {
    return null
  }
}
