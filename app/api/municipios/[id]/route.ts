import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { zona, precio_envio } = body

    if (!zona || precio_envio === undefined) {
      return NextResponse.json(
        { error: 'Faltan campos: zona, precio_envio' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('municipios_envio')
      .update({ zona, precio_envio })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ municipio: data })
  } catch (error) {
    console.error('[API /municipios PUT]', error)
    return NextResponse.json(
      { error: 'Error al actualizar municipio' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { error } = await supabaseAdmin
      .from('municipios_envio')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[API /municipios DELETE]', error)
    return NextResponse.json(
      { error: 'Error al eliminar municipio' },
      { status: 500 }
    )
  }
}
