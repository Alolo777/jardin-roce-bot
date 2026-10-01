// src/whatsapp/lid-backfill.service.ts — Reconciliación de clientes legacy
//
// Contexto: filas antiguas de `clientes.telefono` guardadas como LID
// (`162...@lid`, o dígitos largos sin '+') en vez del teléfono canónico
// `+52...`. El dashboard y el historial esperan formato canónico.
//
// Este servicio (solo VM, corre 1 vez al arrancar el bot):
//   1. Detecta filas no canónicas (LIDs y dígitos sin '+').
//   2. Resuelve cada LID a su número real con las claves de Baileys
//      (resolverLidInverso — solo disponible en la VM).
//   3. Reescribe la fila al formato `+<digitos>`, fusionando el historial
//      si ya existía la fila canónica (mueve mensajes, borra duplicada).
//   4. Omite grupos (@g.us / 120363*) y filas ya canónicas.
//
// Seguro de correr en cada arranque: sin cambios pendientes no escribe nada.

import { supabaseAdmin } from '../../lib/supabase'
import { resolverLidInverso } from './contact.service'
import { telefonoPorLid, lidADigitos } from './lid-mapping'

function conMas(digitos: string): string {
  return `+${digitos}`
}

// Determina el teléfono canónico objetivo SIN resolver LID.
// Devuelve { tipo: 'ok' } (ya canónica), { tipo: 'canon', valor } (normalizar
// directo), { tipo: 'lid' } (requiere resolverLidInverso) o { tipo: 'omitir' }.
function clasificarFila(telefono: string):
  | { tipo: 'ok' }
  | { tipo: 'canon'; valor: string }
  | { tipo: 'lid' }
  | { tipo: 'omitir' } {
  const t = String(telefono ?? '').trim()
  if (!t) return { tipo: 'omitir' }
  const d = t.replace(/\D/g, '')
  if (t.includes('@g.us') || d.startsWith('120363')) return { tipo: 'omitir' }
  if (t.includes('@lid')) return { tipo: 'lid' }
  if (t.startsWith('+')) return { tipo: 'ok' }
  if (!d) return { tipo: 'omitir' }
  if (d.length === 10) return { tipo: 'canon', valor: conMas(`52${d}`) }
  if (d.length > 10 && d.length <= 13 && d.startsWith('52')) {
    return { tipo: 'canon', valor: conMas(d) }
  }
  if (d.length > 13) return { tipo: 'lid' }
  return { tipo: 'omitir' }
}

function normalizarResuelto(resuelto: string): string | null {
  const d = String(resuelto ?? '').replace(/\D/g, '')
  if (!d) return null
  return conMas(d)
}

export async function reconciliarLidsHuerfanos(): Promise<{
  revisados: number
  normalizados: number
  resueltos: number
  fusionados: number
}> {
  const resumen = { revisados: 0, normalizados: 0, resueltos: 0, fusionados: 0 }
  try {
    const { data: filas, error } = await supabaseAdmin
      .from('clientes')
      .select('id, telefono')
    if (error) throw error

    for (const fila of filas ?? []) {
      const actual = fila.telefono as string
      const clase = clasificarFila(actual)
      if (clase.tipo === 'ok' || clase.tipo === 'omitir') continue
      resumen.revisados++

      let objetivo: string | null = null
      if (clase.tipo === 'canon') {
        objetivo = clase.valor
      } else {
        // 1) tabla de mapeo (manual o aprendida) — funciona sin claves Baileys
        const mapeado = await telefonoPorLid(lidADigitos(actual) || actual)
        if (mapeado) {
          objetivo = normalizarResuelto(mapeado)
          if (objetivo) resumen.resueltos++
        } else {
          // 2) claves de Baileys en la VM
          const resuelto = await resolverLidInverso(actual)
          if (!resuelto) continue // sin mapeo: se deja como está
          objetivo = normalizarResuelto(resuelto)
          if (!objetivo) continue
          resumen.resueltos++
        }
      }
      if (!objetivo || objetivo === actual) continue

      // ¿Ya existe la fila canónica? Fusionar historial en ella.
      const { data: existente } = await supabaseAdmin
        .from('clientes')
        .select('id')
        .eq('telefono', objetivo)
        .maybeSingle()

      if (existente && existente.id !== fila.id) {
        await supabaseAdmin
          .from('historial_chat')
          .update({ cliente_id: existente.id })
          .eq('cliente_id', fila.id)
        await supabaseAdmin.from('clientes').delete().eq('id', fila.id)
        resumen.fusionados++
        console.log(`[lid-backfill] 🔀 Fusionado ${actual} → ${objetivo}`)
      } else if (!existente) {
        await supabaseAdmin
          .from('clientes')
          .update({ telefono: objetivo })
          .eq('id', fila.id)
        resumen.normalizados++
        console.log(`[lid-backfill] ✏️ Normalizado ${actual} → ${objetivo}`)
      }
    }

    if (resumen.revisados > 0 || resumen.normalizados > 0) {
      console.log(
        `[lid-backfill] Revisados: ${resumen.revisados}, normalizados: ${resumen.normalizados}, ` +
          `resueltos por LID: ${resumen.resueltos}, fusionados: ${resumen.fusionados}`
      )
    }
    return resumen
  } catch (err) {
    console.error('[lid-backfill] Error (no fatal):', err)
    return resumen
  }
}
