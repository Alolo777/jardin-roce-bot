import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TOMA_HUMANA_DESCRIPCION } from '@/lib/chat-dashboard'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('numeros_ignorados')
      .select('*')
      .order('creado_en', { ascending: false })

    if (error) throw error

    // Las pausas por chat del dashboard (toma humana) se gestionan desde la
    // propia conversación (botón Reanudar), no desde aquí: se ocultan para no
    // confundir (parecía que el número "volvía solo" a la lista).
    const numeros = (data ?? []).filter((n: any) => n.descripcion !== TOMA_HUMANA_DESCRIPCION)
    return NextResponse.json({ numeros })
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
