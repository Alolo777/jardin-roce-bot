import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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
