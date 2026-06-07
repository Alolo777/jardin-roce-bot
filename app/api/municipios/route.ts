import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')

    let query = supabaseAdmin
      .from('municipios_envio')
      .select('*')
      .order('municipio', { ascending: true })

    if (q) {
      query = query.or(`municipio.ilike.%${q}%,colonia.ilike.%${q}%,codigo_postal.ilike.%${q}%`)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ municipios: data })
  } catch (error) {
    console.error('[API /municipios GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener municipios' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { municipio, codigo_postal, colonia, zona, precio_envio } = body

    if (!municipio || !codigo_postal || !zona || precio_envio === undefined) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: municipio, codigo_postal, zona, precio_envio' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('municipios_envio')
      .insert({ municipio, codigo_postal, colonia: colonia || null, zona, precio_envio })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ municipio: data }, { status: 201 })
  } catch (error) {
    console.error('[API /municipios POST]', error)
    return NextResponse.json(
      { error: 'Error al crear municipio' },
      { status: 500 }
    )
  }
}
