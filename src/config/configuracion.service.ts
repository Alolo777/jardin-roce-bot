// src/config/configuracion.service.ts — Jardín RoCe 🌸
// Configuración de negocio dinámica desde Supabase (precios y horarios).
// Las reglas de negocio viven en TypeScript, pero sus VALORES son editables
// sin redeploy desde las tablas configuracion_precios y configuracion_horarios.
// Principio 1: única fuente de verdad para precios y horarios.

import { supabaseAdmin } from '../../lib/supabase'

export interface ConfigPrecios {
  rosa: number
  hortensia: number
  lishianthus: number
  margarita: number
  gerbera: number
  lily: number
  girasol: number
  tulipan: number
  clavel: number
  precioMinimo: number
}

export interface ConfigHorarios {
  apertura: number
  cierreSemana: number
  cierreFinSemana: number
}

export const PRECIOS_DEFAULT: ConfigPrecios = {
  rosa: 25,
  hortensia: 40,
  lishianthus: 35,
  margarita: 20,
  gerbera: 30,
  lily: 35,
  girasol: 35,
  tulipan: 40,
  clavel: 15,
  precioMinimo: 60,
}

export const HORARIOS_DEFAULT: ConfigHorarios = {
  apertura: 10,
  cierreSemana: 19,
  cierreFinSemana: 17,
}

const CACHE_TTL_MS = 5 * 60_000

const CLAVES_PRECIOS: Record<keyof ConfigPrecios, string> = {
  rosa: 'rosa',
  hortensia: 'hortensia',
  lishianthus: 'lishianthus',
  margarita: 'margarita',
  gerbera: 'gerbera',
  lily: 'lily',
  girasol: 'girasol',
  tulipan: 'tulipan',
  clavel: 'clavel',
  precioMinimo: 'precio_minimo',
}

const CLAVES_HORARIOS: Record<keyof ConfigHorarios, string> = {
  apertura: 'apertura',
  cierreSemana: 'cierre_semana',
  cierreFinSemana: 'cierre_fin_semana',
}

let preciosActuales: ConfigPrecios = { ...PRECIOS_DEFAULT }
let horariosActuales: ConfigHorarios = { ...HORARIOS_DEFAULT }
let ultimaCarga = 0

export async function refrescarConfiguracion(forzar = false): Promise<void> {
  const ahora = Date.now()
  if (!forzar && ahora - ultimaCarga < CACHE_TTL_MS) return

  try {
    const [{ data: precios }, { data: horarios }] = await Promise.all([
      supabaseAdmin.from('configuracion_precios').select('clave, valor'),
      supabaseAdmin.from('configuracion_horarios').select('clave, valor'),
    ])

    if (precios) {
      const map = new Map(precios.map(r => [r.clave, Number(r.valor)]))
      const nuevo = { ...preciosActuales }
      for (const [k, clave] of Object.entries(CLAVES_PRECIOS)) {
        const v = map.get(clave)
        if (typeof v === 'number' && Number.isFinite(v)) nuevo[k as keyof ConfigPrecios] = v
      }
      preciosActuales = nuevo
    }

    if (horarios) {
      const map = new Map(horarios.map(r => [r.clave, Number(r.valor)]))
      const nuevo = { ...horariosActuales }
      for (const [k, clave] of Object.entries(CLAVES_HORARIOS)) {
        const v = map.get(clave)
        if (typeof v === 'number' && Number.isFinite(v)) nuevo[k as keyof ConfigHorarios] = v
      }
      horariosActuales = nuevo
    }

    ultimaCarga = ahora
    console.log(`[config] Configuración refrescada: ${precios?.length ?? 0} precios, ${horarios?.length ?? 0} horarios`)
  } catch (err) {
    console.warn('[config] No se pudo refrescar configuración (se usan valores vigentes):', err)
  }
}

export function obtenerPrecios(): ConfigPrecios {
  return preciosActuales
}

export function obtenerHorarios(): ConfigHorarios {
  return horariosActuales
}

export function obtenerTextoPrecios(): string {
  const p = preciosActuales
  return [
    `- Rosa: $${p.rosa} c/u | Hortensia: $${p.hortensia} c/u | Lishianthus: $${p.lishianthus} c/u`,
    `- Margarita: $${p.margarita} c/u | Gerbera: $${p.gerbera} c/u | Lily: $${p.lily} c/u`,
    `- Girasol: $${p.girasol} c/u | Tulipán: $${p.tulipan} c/u | Clavel: $${p.clavel} c/u`,
    `- Desde $${p.precioMinimo} MXN se arma algo sencillo con 1 flor, follaje y papel.`,
  ].join('\n')
}

export function obtenerPreciosReferencia(): Record<string, number> {
  const p = preciosActuales
  return {
    'rosa': p.rosa,
    'hortensia': p.hortensia,
    'lishianthus': p.lishianthus,
    'margarita': p.margarita,
    'gerbera': p.gerbera,
    'lily': p.lily,
    'girasol': p.girasol,
    'tulip[aá]n': p.tulipan,
    'clavel': p.clavel,
  }
}
