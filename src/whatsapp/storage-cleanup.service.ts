// src/whatsapp/storage-cleanup.service.ts — Limpieza automática del bucket
//
// Supabase gratuito da ~1GB de Storage. Cada 6h se mide el uso de
// `whatsapp-media inbox/`: al alcanzar 900MB se borran los archivos
// ENVIADOS más viejos (con más de 7 días) hasta liberar 350MB.
//
// Solo toca enviados (rutas registradas en el outbox como 'enviado'): lo
// recibido por clientes se conserva siempre. El timeline muestra un aviso
// cuando un archivo ya fue limpiado (ver page.tsx onError).

import { supabaseAdmin } from '../../lib/supabase'
import {
  MEDIA_BUCKET,
  UMBRAL_LIMPIEZA_BYTES,
  OBJETIVO_LIBERAR_BYTES,
  GRACIA_LIMPIEZA_DIAS,
} from '../../lib/chat-media'

const INTERVALO_MS = 6 * 60 * 60_000
const LOTE_LISTA = 1000
const LOTE_BORRADO = 100
const CONCURRENCIA = 10

let timer: NodeJS.Timeout | null = null

type ObjetoStorage = {
  nombre: string
  tamano: number
  creadoEn: number
}

export function iniciarLimpiezaStorage(): void {
  if (timer) return
  timer = setInterval(() => {
    ejecutarLimpiezaStorage().catch((err) =>
      console.error('[limpieza] Error en ciclo:', err)
    )
  }, INTERVALO_MS)
  timer.unref?.()
  console.log('[limpieza] 🧹 Limpieza de Storage programada (cada 6h, umbral 900MB)')
}

export function detenerLimpiezaStorage(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function mb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

// Lista recursiva inbox/<digitos>/<archivo> (la API lista un nivel por vez).
async function listarTodo(): Promise<ObjetoStorage[]> {
  const objetos: ObjetoStorage[] = []
  let offsetCarpetas = 0
  for (;;) {
    const { data: carpetas, error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .list('inbox', { limit: 100, offset: offsetCarpetas })
    if (error) throw error
    if (!carpetas || carpetas.length === 0) break
    const dirs = carpetas.filter((c: any) => c.id === null)
    // Algunos objetos podrían estar directo en inbox/ (sin subcarpeta).
    for (const f of carpetas.filter((c: any) => c.id !== null)) {
      objetos.push({
        nombre: `inbox/${f.name}`,
        tamano: Number((f as any).metadata?.size ?? 0),
        creadoEn: new Date((f as any).created_at ?? 0).getTime() || 0,
      })
    }
    for (let i = 0; i < dirs.length; i += CONCURRENCIA) {
      const lote = dirs.slice(i, i + CONCURRENCIA)
      const resultados = await Promise.all(
        lote.map((d: any) =>
          supabaseAdmin.storage.from(MEDIA_BUCKET).list(`inbox/${d.name}`, { limit: LOTE_LISTA })
        )
      )
      for (let j = 0; j < lote.length; j++) {
        const archivos = resultados[j].data ?? []
        for (const a of archivos) {
          if ((a as any).id === null) continue // subcarpeta inesperada
          objetos.push({
            nombre: `inbox/${lote[j].name}/${a.name}`,
            tamano: Number((a as any).metadata?.size ?? 0),
            creadoEn: new Date((a as any).created_at ?? 0).getTime() || 0,
          })
        }
      }
    }
    if (carpetas.length < 100) break
    offsetCarpetas += 100
  }
  return objetos
}

export async function ejecutarLimpiezaStorage(): Promise<{
  total: number
  liberado: number
  eliminados: number
}> {
  const resultado = { total: 0, liberado: 0, eliminados: 0 }
  const objetos = await listarTodo()
  resultado.total = objetos.reduce((s, o) => s + o.tamano, 0)
  console.log(`[limpieza] Uso actual: ${mb(resultado.total)} en ${objetos.length} archivo(s)`)

  if (resultado.total < UMBRAL_LIMPIEZA_BYTES) return resultado

  // Rutas enviadas por el equipo (outbox). Solo esas son candidatas.
  const { data: enviados } = await supabaseAdmin
    .from('mensajes_outbox_equipo')
    .select('media_path')
    .neq('tipo', 'texto')
    .eq('estado', 'enviado')
    .not('media_path', 'is', null)
    .limit(10000)
  const rutasEnviadas = new Set((enviados ?? []).map((r: any) => r.media_path as string))

  const corte = Date.now() - GRACIA_LIMPIEZA_DIAS * 24 * 60 * 60_000
  const candidatos = objetos
    .filter((o) => rutasEnviadas.has(o.nombre) && o.creadoEn > 0 && o.creadoEn < corte)
    .sort((a, b) => a.creadoEn - b.creadoEn)

  if (candidatos.length === 0) {
    console.warn('[limpieza] ⚠️ Umbral alcanzado pero no hay enviados con +7 días para borrar')
    return resultado
  }

  const aBorrar: string[] = []
  let acumulado = 0
  for (const c of candidatos) {
    if (acumulado >= OBJETIVO_LIBERAR_BYTES) break
    aBorrar.push(c.nombre)
    acumulado += c.tamano
  }

  for (let i = 0; i < aBorrar.length; i += LOTE_BORRADO) {
    const lote = aBorrar.slice(i, i + LOTE_BORRADO)
    const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).remove(lote)
    if (error) {
      console.error('[limpieza] Error borrando lote:', error.message)
      break
    }
    resultado.eliminados += lote.length
    resultado.liberado += candidatos
      .filter((c) => lote.includes(c.nombre))
      .reduce((s, c) => s + c.tamano, 0)
  }

  console.log(
    `[limpieza] 🧹 Eliminados ${resultado.eliminados} archivo(s) enviados viejos, liberados ${mb(resultado.liberado)}`
  )
  return resultado
}
