// lib/chat-dashboard.ts — Helpers compartidos de la pestaña WhatsApp
//
// Usado por:
//   - src/whatsapp/outbox-poller.ts (bot en la VM)
//   - app/api/chat/*/route.ts (dashboard en Vercel)
//
// No contiene lógica de negocio del bot, solo normalización de teléfonos
// y constantes del canal dashboard → outbox → WhatsApp.

import { supabaseAdmin } from './supabase'
import { variantesTelefono } from '../src/conversation/conversation.service'
import { telefonoPorLid } from '../src/whatsapp/lid-mapping'

// Descripción que identifica en `numeros_ignorados` las pausas creadas
// desde el dashboard (toma humana por chat). El bot ya filtra esos
// números en message-entry.ts sin necesidad de cambios.
export const TOMA_HUMANA_DESCRIPCION = 'Toma humana desde dashboard'

// Límite de texto por mensaje (igual que el tope del bot: 1000 chars).
export const MAX_TEXTO_OUTBOX = 1000

export function telefonoADigitos(telefono: string): string {
  return String(telefono ?? '').replace(/\D/g, '')
}

export function ultimos10(telefono: string): string {
  return telefonoADigitos(telefono).slice(-10)
}

// Candidatos para buscar la pausa de un chat en `numeros_ignorados`.
// Un mismo chat puede estar registrado con dígitos distintos (LID legacy,
// variantes 52/521, canónico +...): se expanden variantes y se cruza con la
// tabla de mapeo LID→teléfono en ambas direcciones. Sin esto, pausar y
// reanudar no se encuentran entre sí.
export async function candidatosPausa(telefono: string): Promise<string[]> {
  const set = new Set<string>()
  const agregar = (d: string) => {
    const limpio = telefonoADigitos(d)
    if (!limpio) return
    set.add(limpio)
    for (const v of variantesTelefono(limpio)) set.add(v)
  }
  agregar(telefono)
  try {
    const canon = await resolverTelefonoCanonical(telefono)
    agregar(canon)
    const mapeado = await telefonoPorLid(telefonoADigitos(telefono))
    if (mapeado) agregar(mapeado)
    const { data: maps } = await supabaseAdmin
      .from('mapeo_lid_telefono')
      .select('lid, telefono')
    for (const m of (maps ?? []) as any[]) {
      const telMap = telefonoADigitos(String(m.telefono ?? ''))
      if (telMap && set.has(telMap)) agregar(String(m.lid ?? ''))
    }
  } catch {
    // best effort: al menos van las variantes directas
  }
  return [...set]
}

export async function estadoPausa(
  telefono: string
): Promise<{ pausado: boolean; pausaPropia: boolean }> {
  const cands = await candidatosPausa(telefono)
  if (cands.length === 0) return { pausado: false, pausaPropia: false }
  try {
    const { data } = await supabaseAdmin
      .from('numeros_ignorados')
      .select('numero, descripcion')
      .in('numero', cands)
    const filas = data ?? []
    if (filas.length === 0) return { pausado: false, pausaPropia: false }
    return {
      pausado: true,
      pausaPropia: filas.some((f: any) => f.descripcion === TOMA_HUMANA_DESCRIPCION),
    }
  } catch {
    return { pausado: false, pausaPropia: false }
  }
}

// Resuelve el valor EXACTO guardado en `clientes.telefono` para un
// identificador de chat. Tolera: formato canónico (+52...), dígitos sin
// '+' (filas legacy), JIDs crudos (...@lid) y variantes MX 52/521.
// Devuelve el valor almacenado (para operar sobre la misma fila) o un
// fallback `+<digitos>` si no existe.
export async function resolverTelefonoCanonical(telefono: string): Promise<string> {
  const crudo = String(telefono ?? '').trim()
  if (!crudo) return telefono
  const digitos = telefonoADigitos(crudo)
  try {
    const preferencia: string[] = []
    if (digitos) {
      for (const v of variantesTelefono(digitos)) preferencia.push(`+${v}`)
    }
    preferencia.push(crudo)
    if (digitos) {
      for (const v of variantesTelefono(digitos)) preferencia.push(v)
    }
    const unicos = [...new Set(preferencia)]
    const { data } = await supabaseAdmin
      .from('clientes')
      .select('telefono')
      .in('telefono', unicos)
      .limit(20)
    const encontrados = new Set((data ?? []).map((r) => r.telefono as string))
    for (const c of unicos) {
      if (encontrados.has(c)) return c
    }
  } catch {
    // fallback silencioso
  }
  return digitos ? `+${digitos}` : crudo
}

// Texto seguro para mostrar en la UI: nunca expone JIDs crudos (@lid/@g.us).
// Los LIDs sin resolver se muestran como dígitos agrupados.
export function telefonoParaMostrar(telefono: string): string {
  const crudo = String(telefono ?? '').trim()
  if (!crudo) return '—'
  if (crudo.includes('@')) {
    const d = telefonoADigitos(crudo)
    if (!d) return 'WhatsApp'
    return `${d.replace(/(\d{4})(?=\d)/g, '$1 ').trim()} (WhatsApp)`
  }
  const d = telefonoADigitos(crudo)
  if (!d) return crudo
  if (d.length === 10) return `+52${d}`
  if (d.length > 10 && d.length <= 13) return `+${d}`
  if (d.length > 13) return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
  return `+${d}`
}

// JIDs de grupo de WhatsApp (empiezan con 120363): artefactos legacy que
// no son conversaciones 1:1 y se excluyen de la bandeja.
export function esChatGrupal(telefono: string): boolean {
  return telefonoADigitos(telefono).startsWith('120363')
}
