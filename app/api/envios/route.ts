import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('zonas_envio')
      .select('*')
      .order('precio', { ascending: true })

    if (error) throw error

    return NextResponse.json({ zonas: data })
  } catch (error) {
    console.error('[API /envios GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener zonas de envío' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { zona, precio, palabras_clave } = await request.json()

    if (!zona || !precio || !palabras_clave) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: zona, precio, palabras_clave' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('zonas_envio')
      .insert({ zona, precio, palabras_clave })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ zona: data }, { status: 201 })
  } catch (error) {
    console.error('[API /envios POST]', error)
    return NextResponse.json(
      { error: 'Error al crear zona de envío' },
      { status: 500 }
    )
  }
}
