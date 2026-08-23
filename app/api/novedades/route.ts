import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// DEC-084: devuelve el digest de novedades actual (lectura directa de
// configuracion_bot). La página /admin/administradores lo muestra y usa
// generadaEn para detectar cuándo el bot terminó la regeneración manual.

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'novedades_diarias')
      .maybeSingle()
    if (error) throw error
    if (!data?.valor) {
      return NextResponse.json({ digest: null })
    }
    const digest = JSON.parse(data.valor)
    return NextResponse.json({
      digest: {
        fechaAnalizada: digest.fechaAnalizada ?? null,
        tipoVentana: digest.tipoVentana ?? 'dia_anterior',
        generadaEn: digest.generadaEn ?? null,
        novedades: Array.isArray(digest.novedades) ? digest.novedades : [],
      },
    })
  } catch (error) {
    console.error('[API /novedades GET]', error)
    return NextResponse.json({ error: 'Error al cargar novedades' }, { status: 500 })
  }
}
