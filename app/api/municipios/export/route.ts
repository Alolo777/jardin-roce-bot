import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('municipios_envio')
      .select('municipio, codigo_postal, colonia, zona, precio_envio')
      .order('municipio', { ascending: true })

    if (error) throw error

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No hay municipios registrados para exportar' },
        { status: 404 }
      )
    }

    const cabeceras = 'municipio,codigo_postal,colonia,zona,precio_envio'
    const filas = data.map(r => {
      const colonia = (r.colonia || '').includes(',') ? `"${r.colonia || ''}"` : (r.colonia || '')
      return `${r.municipio},${r.codigo_postal},${colonia},${r.zona},${r.precio_envio}`
    }).join('\n')

    const csv = `${cabeceras}\n${filas}\n`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="municipios_envio_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error('[API /municipios/export GET]', error)
    return NextResponse.json(
      { error: 'Error al exportar municipios' },
      { status: 500 }
    )
  }
}
