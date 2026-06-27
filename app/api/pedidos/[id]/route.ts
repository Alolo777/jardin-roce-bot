import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const allowed = ['estado', 'estado_flujo', 'cliente_nombre', 'producto', 'precio_arreglo', 'zona_envio', 'precio_envio', 'direccion', 'sucursal', 'metodo_pago', 'nota', 'total', 'requiere_revision', 'fecha_entrega', 'hora_entrega', 'detalles_especiales', 'precio_confirmado_por']
    const update: Record<string, unknown> = { actualizado_en: new Date().toISOString() }

    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    let { data, error } = await supabaseAdmin
      .from('pedidos_bot')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error && /estado_flujo|fecha_entrega|hora_entrega|detalles_especiales|precio_confirmado_por|schema cache|column/i.test(error.message || '')) {
      for (const key of ['estado_flujo', 'fecha_entrega', 'hora_entrega', 'detalles_especiales', 'precio_confirmado_por']) delete update[key]
      const retry = await supabaseAdmin
        .from('pedidos_bot')
        .update(update)
        .eq('id', id)
        .select()
        .single()
      data = retry.data
      error = retry.error
    }

    if (error) throw error
    return NextResponse.json({ ok: true, pedido: data })
  } catch (error) {
    console.error('[API /pedidos PATCH]', error)
    return NextResponse.json({ error: 'No se pudo actualizar pedido' }, { status: 500 })
  }
}
