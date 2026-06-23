import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const CLAVE = 'empleados_notificar'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', CLAVE)
      .maybeSingle()

    if (error) throw error

    const numeros = data?.valor
      ? data.valor.split(',').map((n: string) => n.trim()).filter(Boolean)
      : []

    return NextResponse.json({ numeros })
  } catch (error) {
    console.error('[API /empleados GET]', error)
    return NextResponse.json({ error: 'Error al cargar empleados' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { numeros } = await request.json()

    if (!Array.isArray(numeros)) {
      return NextResponse.json({ error: 'Se espera un arreglo de números' }, { status: 400 })
    }

    const valor = numeros.filter(Boolean).join(', ')

    const { error } = await supabaseAdmin
      .from('configuracion_bot')
      .upsert({ clave: CLAVE, valor }, { onConflict: 'clave' })

    if (error) throw error

    return NextResponse.json({ ok: true, numeros: numeros.filter(Boolean) })
  } catch (error) {
    console.error('[API /empleados PUT]', error)
    return NextResponse.json({ error: 'Error al guardar empleados' }, { status: 500 })
  }
}
