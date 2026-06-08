import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('historial_prompt')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(50)

    if (error) throw error

    return NextResponse.json({ historial: data ?? [] })
  } catch (error) {
    console.error('[API /prompt/history GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener historial' },
      { status: 500 }
    )
  }
}
