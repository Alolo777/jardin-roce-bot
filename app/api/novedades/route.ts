import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// BUG-026: muestra solo los últimos 4 dígitos del celular, nunca el completo.
function mascararTelefono(telefono: string): string {
  const d = String(telefono ?? '').replace(/\D/g, '')
  return d ? `•••• ${d.slice(-4)}` : '—'
}

// DEC-084: devuelve el digest de novedades actual (lectura directa de
// configuracion_bot) con los teléfonos enmascarados.

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
        novedades: (Array.isArray(digest.novedades) ? digest.novedades : []).map((n: Record<string, unknown>) => ({
          ...n,
          telefono: mascararTelefono(String(n.telefono ?? '')),
        })),
        estadosChats: (Array.isArray(digest.estadosChats) ? digest.estadosChats : []).map((e: Record<string, unknown>) => ({
          ...e,
          telefono: mascararTelefono(String(e.telefono ?? '')),
        })),
      },
    })
  } catch (error) {
    console.error('[API /novedades GET]', error)
    return NextResponse.json({ error: 'Error al cargar novedades' }, { status: 500 })
  }
}
