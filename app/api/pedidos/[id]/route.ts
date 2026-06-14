import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const allowed = ['estado', 'cliente_nombre', 'producto', 'precio_arreglo', 'zona_envio', 'precio_envio', 'direccion', 'sucursal', 'metodo_pago', 'nota', 'total', 'requiere_revision']
    const update: Record<string, unknown> = { actualizado_en: new Date().toISOString() }

    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    const { data, error } = await supabaseAdmin
      .from('pedidos_bot')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ ok: true, pedido: data })
  } catch (error) {
    console.error('[API /pedidos PATCH]', error)
    return NextResponse.json({ error: 'No se pudo actualizar pedido' }, { status: 500 })
  }
}
