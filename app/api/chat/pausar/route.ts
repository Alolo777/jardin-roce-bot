import { NextResponse, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { telefonoADigitos } from '@/lib/chat-dashboard'
import { TOMA_HUMANA_DESCRIPCION } from '@/lib/chat-dashboard'

// Pausa o reanuda a Flora en UN chat usando `numeros_ignorados`
// (el bot ya filtra esos números; ver message-entry.ts).
// Nunca elimina silenciados permanentes (otra descripción).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const digitos = telefonoADigitos(String(body.telefono ?? ''))
    const pausar = Boolean(body.pausar)

    if (digitos.length < 10) {
      return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })
    }

    if (pausar) {
      const { error } = await supabaseAdmin
        .from('numeros_ignorados')
        .upsert(
          { numero: digitos, descripcion: TOMA_HUMANA_DESCRIPCION },
          { onConflict: 'numero', ignoreDuplicates: true }
        )
      if (error) throw error
      return NextResponse.json({ ok: true, pausado: true })
    }

    // Reanudar: solo borrar si la fila es nuestra (toma del dashboard)
    const { data: existentes } = await supabaseAdmin
      .from('numeros_ignorados')
      .select('numero, descripcion')
      .eq('numero', digitos)
    const propia = (existentes ?? []).find(
      (n) => n.descripcion === TOMA_HUMANA_DESCRIPCION
    )
    if (propia) {
      const { error } = await supabaseAdmin
        .from('numeros_ignorados')
        .delete()
        .eq('numero', digitos)
        .eq('descripcion', TOMA_HUMANA_DESCRIPCION)
      if (error) throw error
      return NextResponse.json({ ok: true, pausado: false })
    }
    const permanente = (existentes ?? []).length > 0
    return NextResponse.json({
      ok: true,
      pausado: permanente,
      nota: permanente
        ? 'El número sigue silenciado permanente (otra descripción en Silenciados).'
        : undefined,
    })
  } catch (err) {
    console.error('[API /chat/pausar POST]', err)
    return NextResponse.json(
      { error: 'No se pudo cambiar la pausa del chat' },
      { status: 500 }
    )
  }
}
