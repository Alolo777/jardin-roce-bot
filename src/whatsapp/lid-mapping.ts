// src/whatsapp/lid-mapping.ts — Mapeo persistente LID → teléfono real
//
// WhatsApp identifica algunos chats con LID (ej. 162195161755844@lid) en vez
// del número. La tabla `mapeo_lid_telefono` guarda el par conocido para que
// bot y dashboard operen sobre la fila canónica (+52...):
//   - se llena sola cuando el bot resuelve un LID (origen='auto'),
//   - acepta filas manuales desde Supabase (origen='manual').
// Lookup con caché en memoria (10 min) para no sumar queries al flujo.

import { supabaseAdmin } from '../../lib/supabase'

const CACHE_TTL_MS = 10 * 60_000
const CACHE = new Map<string, { telefono: string | null; ts: number }>()

export function lidADigitos(lid: string): string {
  return String(lid ?? '')
    .replace(/@lid$/, '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '')
}

export function esValorLid(telefono: string): boolean {
  const t = String(telefono ?? '').trim()
  if (!t || t.startsWith('+')) return false
  if (t.includes('@lid')) return true
  const d = t.replace(/\D/g, '')
  return d.length > 13 && !d.startsWith('52')
}

export async function telefonoPorLid(lid: string): Promise<string | null> {
  const clave = lidADigitos(lid)
  if (!clave) return null
  const cached = CACHE.get(clave)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.telefono
  try {
    const { data } = await supabaseAdmin
      .from('mapeo_lid_telefono')
      .select('telefono')
      .eq('lid', clave)
      .maybeSingle()
    const telefono = (data?.telefono as string) ?? null
    CACHE.set(clave, { telefono, ts: Date.now() })
    return telefono
  } catch {
    return cached?.telefono ?? null
  }
}

export async function registrarMapeoLid(
  lid: string,
  telefono: string,
  origen: 'auto' | 'manual' = 'auto'
): Promise<void> {
  const clave = lidADigitos(lid)
  const digitos = String(telefono ?? '').replace(/\D/g, '')
  if (!clave || !digitos) return
  const canon = `+${digitos}`
  try {
    await supabaseAdmin.from('mapeo_lid_telefono').upsert(
      { lid: clave, telefono: canon, origen, actualizado_en: new Date().toISOString() },
      { onConflict: 'lid' }
    )
    CACHE.set(clave, { telefono: canon, ts: Date.now() })
  } catch (err) {
    console.error('[lid-mapping] Error registrando mapeo (no fatal):', err)
  }
}

// Fusiona la fila legacy (LID) en la canónica (+teléfono): mueve el
// historial y elimina la duplicada. Si no existe la canónica, renombra.
// Devuelve el teléfono canónico final o null si no se pudo.
export async function canonicalizarClienteLid(
  lidValor: string,
  telefonoCanon: string
): Promise<string | null> {
  const digitos = String(telefonoCanon ?? '').replace(/\D/g, '')
  if (!digitos) return null
  const canon = `+${digitos}`
  try {
    const { data: filas } = await supabaseAdmin
      .from('clientes')
      .select('id, telefono')
      .in('telefono', [String(lidValor), `+${lidADigitos(lidValor)}`, lidADigitos(lidValor)])
      .limit(10)
    const origen = (filas ?? []).find(
      (r) => (r.telefono as string) !== canon
    )
    if (!origen) {
      // Ya está canónica (o no existe): asegurar que exista la fila destino.
      const { data: dest } = await supabaseAdmin
        .from('clientes')
        .select('id')
        .eq('telefono', canon)
        .maybeSingle()
      if (!dest) {
        await supabaseAdmin.from('clientes').insert({ telefono: canon })
      }
      return canon
    }
    const { data: destino } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('telefono', canon)
      .maybeSingle()
    if (destino && destino.id !== origen.id) {
      await supabaseAdmin
        .from('historial_chat')
        .update({ cliente_id: destino.id })
        .eq('cliente_id', origen.id)
      await supabaseAdmin.from('clientes').delete().eq('id', origen.id)
      console.log(`[lid-mapping] 🔀 Fusionado ${origen.telefono} → ${canon}`)
    } else if (!destino) {
      await supabaseAdmin
        .from('clientes')
        .update({ telefono: canon })
        .eq('id', origen.id)
      console.log(`[lid-mapping] ✏️ Normalizado ${origen.telefono} → ${canon}`)
    }
    return canon
  } catch (err) {
    console.error('[lid-mapping] Error canonicalizando (no fatal):', err)
    return null
  }
}
