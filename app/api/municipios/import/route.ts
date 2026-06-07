import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { registros } = await request.json()

    if (!Array.isArray(registros) || registros.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere un array de registros' },
        { status: 400 }
      )
    }

    const validados = registros.map((r: any) => ({
      municipio: String(r.municipio ?? '').trim(),
      codigo_postal: String(r.codigo_postal ?? '').trim(),
      colonia: r.colonia ? String(r.colonia).trim() : null,
      zona: String(r.zona ?? '').trim(),
      precio_envio: parseFloat(r.precio_envio),
    }))

    const invalidos = validados.filter(
      v => !v.municipio || !v.codigo_postal || !v.zona || isNaN(v.precio_envio)
    )

    if (invalidos.length > 0) {
      return NextResponse.json(
        { error: `${invalidos.length} registros tienen campos inválidos` },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('municipios_envio')
      .insert(validados)
      .select()

    if (error) throw error

    return NextResponse.json({
      importados: data.length,
      municipios: data,
    }, { status: 201 })
  } catch (error) {
    console.error('[API /municipios/import POST]', error)
    return NextResponse.json(
      { error: 'Error al importar municipios' },
      { status: 500 }
    )
  }
}
