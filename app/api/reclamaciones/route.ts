import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('reclamaciones')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({ reclamaciones: data ?? [] })
  } catch (error) {
    console.error('[API /reclamaciones GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener reclamaciones' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { cliente_telefono, tipo, descripcion, arreglo_referencia } = body

    if (!cliente_telefono || !tipo || !descripcion) {
      return NextResponse.json(
        { error: 'Faltan campos: cliente_telefono, tipo, descripcion' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('reclamaciones')
      .insert({
        cliente_telefono,
        tipo,
        descripcion,
        arreglo_referencia: arreglo_referencia || null,
        estado: 'pendiente',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ reclamacion: data }, { status: 201 })
  } catch (error) {
    console.error('[API /reclamaciones POST]', error)
    return NextResponse.json(
      { error: 'Error al crear reclamación' },
      { status: 500 }
    )
  }
}
