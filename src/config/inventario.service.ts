// src/config/inventario.service.ts — Jardín RoCe 🌸
// Inventario disponible desde Supabase (tabla `inventario`).
// Caché en memoria con TTL de 5 min, igual que configuracion.service.
// Si la tabla no existe o está vacía, se devuelve inventario vacío
// (el bot no confirma stock que no pueda verificar).

import { supabaseAdmin } from '../../lib/supabase'
import { normalizarTexto } from '../conversation/conversation.service'
import type { ProductoDetalle } from '../models/types'

const CACHE_TTL_MS = 5 * 60_000

interface FilaInventario {
  id: number
  nombre: string
  categoria: string
  precio: number
  disponible: boolean
  existencias: number
  imagen_url?: string | null
  temporada?: string | null
}

let inventarioDisponible: ProductoDetalle[] = []
let ultimaCarga = 0

function filaAProducto(fila: FilaInventario): ProductoDetalle {
  return {
    id: String(fila.id),
    nombre: fila.nombre,
    precio: Number(fila.precio),
    categoria: fila.categoria,
    imagenUrl: fila.imagen_url ?? undefined,
    disponible: fila.disponible,
    existencias: fila.existencias,
    temporada: fila.temporada ?? undefined,
  }
}

export async function refrescarInventario(forzar = false): Promise<void> {
  const ahora = Date.now()
  if (!forzar && ahora - ultimaCarga < CACHE_TTL_MS) return

  try {
    const { data } = await supabaseAdmin
      .from('inventario')
      .select('*')
      .order('nombre', { ascending: true })

    if (data) {
      inventarioDisponible = (data as FilaInventario[])
        .map(filaAProducto)
        .filter((p) => p.disponible && (p.existencias ?? 0) > 0)
      ultimaCarga = ahora
      console.log(`[inventario] ${inventarioDisponible.length} productos disponibles`)
    }
  } catch (err) {
    console.warn('[inventario] No se pudo refrescar inventario (se mantiene el vigente):', err)
  }
}

export function obtenerInventarioDisponible(): ProductoDetalle[] {
  return inventarioDisponible
}

export function verificarDisponibilidad(producto: string): boolean {
  const n = normalizarTexto(producto)
  if (!n) return false
  return inventarioDisponible.some((p) => {
    const nombre = normalizarTexto(p.nombre)
    return nombre === n || nombre.includes(n) || n.includes(nombre)
  })
}

export function obtenerTextoDisponibilidad(): string | null {
  if (inventarioDisponible.length === 0) return null
  const lista = inventarioDisponible
    .slice(0, 25)
    .map((p) => `${p.nombre} ($${p.precio})`)
    .join(', ')
  if (inventarioDisponible.length > 25) {
    return `${lista}, y más (solicita al backend antes de confirmar algo fuera de esta lista)`
  }
  return lista
}
