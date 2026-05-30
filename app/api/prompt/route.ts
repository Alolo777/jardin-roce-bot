import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const CLAVE_PROMPT = 'system_prompt'

// GET /api/prompt — Obtener prompt actual
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor, actualizado_en')
      .eq('clave', CLAVE_PROMPT)
      .single()

    if (error) throw error

    return NextResponse.json({
      prompt: data.valor,
      actualizado_en: data.actualizado_en,
    })
  } catch (error) {
    console.error('[API /prompt GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener el prompt' },
      { status: 500 }
    )
  }
}

// PUT /api/prompt — Actualizar prompt
export async function PUT(request: NextRequest) {
  try {
    const { prompt } = await request.json()

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 20) {
      return NextResponse.json(
        { error: 'El prompt debe tener al menos 20 caracteres' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .update({ valor: prompt.trim() })
      .eq('clave', CLAVE_PROMPT)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      ok: true,
      actualizado_en: data.actualizado_en,
    })
  } catch (error) {
    console.error('[API /prompt PUT]', error)
    return NextResponse.json(
      { error: 'Error al actualizar el prompt' },
      { status: 500 }
    )
  }
}