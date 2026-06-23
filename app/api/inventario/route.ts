import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/inventario — Listar arreglos (filtrable por estado)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const soloDisponibles = searchParams.get('disponibles') === 'true'

    let query = supabaseAdmin
      .from('arreglos_diarios')
      .select('*')
      .order('creado_en', { ascending: false })

    if (soloDisponibles) {
      query = query.eq('estado', 'disponible')
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ arreglos: data })
  } catch (error) {
    console.error('[API /inventario GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener inventario' },
      { status: 500 }
    )
  }
}

// POST /api/inventario — Crear nuevo arreglo (sin foto)
// Body: JSON con nombre, descripcion, precio
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nombre, descripcion, precio } = body

    if (!nombre || precio == null) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: nombre, precio' },
        { status: 400 }
      )
    }

    const { data, error: insertError } = await supabaseAdmin
      .from('arreglos_diarios')
      .insert({
        nombre,
        descripcion: descripcion || null,
        precio: parseFloat(precio),
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ arreglo: data }, { status: 201 })
  } catch (error) {
    console.error('[API /inventario POST]', error)
    return NextResponse.json(
      { error: 'Error al crear arreglo' },
      { status: 500 }
    )
  }
}