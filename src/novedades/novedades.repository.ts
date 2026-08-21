// src/novedades/novedades.repository.ts
// Persistencia del digest diario de novedades en Supabase (configuracion_bot)
// y acceso a la lista de administradores del bot.

import { supabaseAdmin } from '../../lib/supabase'
import type { NovedadesDiarias } from './types'

export const CLAVE_NOVEDADES = 'novedades_diarias'
export const CLAVE_ADMINS = 'admins_bot'

// ─── Digest diario ───────────────────────────────────────────────

export async function guardarNovedades(digest: NovedadesDiarias): Promise<void> {
  const valor = JSON.stringify(digest)
  let ultimoError: unknown = null
  for (let intento = 1; intento <= 3; intento++) {
    const { error } = await supabaseAdmin
      .from('configuracion_bot')
      .upsert({ clave: CLAVE_NOVEDADES, valor }, { onConflict: 'clave' })
    if (!error) return
    ultimoError = error
    await new Promise(r => setTimeout(r, 500 * intento))
  }
  throw ultimoError
}

// Devuelve el digest guardado o null si no existe / está corrupto.
export async function cargarNovedades(): Promise<NovedadesDiarias | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', CLAVE_NOVEDADES)
      .maybeSingle()
    if (error || !data?.valor) return null
    const parsed = JSON.parse(data.valor) as NovedadesDiarias
    if (!parsed || !Array.isArray(parsed.novedades) || !parsed.fechaAnalizada) return null
    return parsed
  } catch (err) {
    console.error('[novedades] Error cargando digest:', err)
    return null
  }
}

// ─── Administradores del bot ─────────────────────────────────────

let CACHE_ADMINS: { numeros: string[]; ts: number } | null = null

// Números que pueden pedirle novedades al bot por WhatsApp. Lista separada
// de empleados_notificar (DEC-084). Formato: 521234567890[@c.us], separados por coma.
export async function obtenerAdminsBot(): Promise<string[]> {
  const ahora = Date.now()
  if (CACHE_ADMINS && ahora - CACHE_ADMINS.ts < 120_000) return CACHE_ADMINS.numeros
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', CLAVE_ADMINS)
      .maybeSingle()
    if (error) throw error
    const numeros = (data?.valor ?? '')
      .split(',')
      .map((n: string) => n.trim().replace(/\s/g, ''))
      .filter(Boolean)
    CACHE_ADMINS = { numeros, ts: ahora }
    return numeros
  } catch {
    return []
  }
}

// Verifica si un número/jid pertenece a la lista de admins.
// Compara solo dígitos para tolerar variantes (+52, @c.us, LID).
export async function esAdminBot(numeroOJid: string): Promise<boolean> {
  const digitos = String(numeroOJid ?? '').replace(/\D/g, '')
  if (!digitos) return false
  const admins = await obtenerAdminsBot()
  return admins.some(admin => {
    const adminDigitos = admin.replace(/\D/g, '')
    // Mínimo 10 dígitos para evitar falsos positivos con entradas cortas
    if (adminDigitos.length < 10) return false
    // Coincidencia exacta o por sufijo (52 + 10 dígitos vs 10 dígitos)
    return digitos === adminDigitos || digitos.endsWith(adminDigitos) || adminDigitos.endsWith(digitos)
  })
}

export function limpiarCacheAdmins(): void {
  CACHE_ADMINS = null
}
