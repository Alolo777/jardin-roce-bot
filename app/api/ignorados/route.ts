import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('numeros_ignorados')
      .select('*')
      .order('creado_en', { ascending: false })

    if (error) throw error

    return NextResponse.json({ numeros: data })
  } catch (error) {
    console.error('[API /ignorados GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener números ignorados' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { numero, descripcion } = await request.json()

    if (!numero) {
      return NextResponse.json(
        { error: 'El número es obligatorio' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('numeros_ignorados')
      .insert({ numero: numero.replace(/\D/g, ''), descripcion: descripcion || null })
      .select()
      .single()

    if (error) {
      if (error.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'Ese número ya está en la lista' },
          { status: 409 }
        )
      }
      throw error
    }

    return NextResponse.json({ numero: data }, { status: 201 })
  } catch (error) {
    console.error('[API /ignorados POST]', error)
    return NextResponse.json(
      { error: 'Error al agregar número' },
      { status: 500 }
    )
  }
}
