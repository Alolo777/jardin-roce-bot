// src/reclamaciones/reclamacion.service.ts — Jardín RoCe 🌸
// Seguimiento de reclamaciones: listar pendientes y marcarlas resueltas.
// Única fuente de verdad para el flujo de quejas/cancelaciones registradas.

import { supabaseAdmin } from '../../lib/supabase'

export interface Reclamacion {
  id: string
  cliente_telefono: string
  tipo: 'cancelacion' | 'queja' | 'devolucion' | 'otro'
  descripcion: string
  arreglo_referencia?: string | null
  estado: 'pendiente' | 'en_proceso' | 'resuelto'
  creado_en?: string
  actualizado_en?: string
}

export async function listarReclamaciones(estado?: Reclamacion['estado']): Promise<Reclamacion[]> {
  let query = supabaseAdmin.from('reclamaciones').select('*').order('creado_en', { ascending: false }).limit(50)
  if (estado) query = query.eq('estado', estado)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Reclamacion[]
}

export async function marcarReclamacionResuelta(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('reclamaciones')
    .update({ estado: 'resuelto', actualizado_en: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return !!data
}

export function formatearReclamaciones(lista: Reclamacion[]): string {
  if (lista.length === 0) return '📭 No hay reclamaciones pendientes.'
  return lista
    .map((r) => {
      const fecha = r.creado_en ? new Date(r.creado_en).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '?'
      const tipo = { cancelacion: '❌ Cancelación', queja: '⚠️ Queja', devolucion: '↩️ Devolución', otro: '📝 Otro' }[r.tipo] ?? r.tipo
      return `🆔 ${r.id.slice(0, 8)}\n${tipo} · ${fecha}\n📞 ${r.cliente_telefono}${r.arreglo_referencia ? `\n🌸 ${r.arreglo_referencia}` : ''}\n💬 ${r.descripcion.slice(0, 200)}`
    })
    .join('\n\n')
}
