import { NextResponse, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  telefonoADigitos,
  resolverTelefonoCanonical,
  candidatosPausa,
  estadoPausa,
  TOMA_HUMANA_DESCRIPCION,
} from '@/lib/chat-dashboard'

// Pausa o reanuda a Flora en UN chat usando `numeros_ignorados`
// (el bot ya filtra esos números; ver message-entry.ts).
// La coincidencia usa TODOS los formatos del número (LID legacy, variantes
// 52/521, canónico) para que pausar y reanudar siempre se encuentren.
// Nunca elimina silenciados permanentes (otra descripción).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const telefonoParam = String(body.telefono ?? '')
    const digitos = telefonoADigitos(telefonoParam)
    const pausar = Boolean(body.pausar)

    if (digitos.length < 10) {
      return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })
    }

    if (pausar) {
      // Guardar con los dígitos del canónico almacenado (formato estable).
      const canonico = await resolverTelefonoCanonical(telefonoParam)
      const { error } = await supabaseAdmin
        .from('numeros_ignorados')
        .upsert(
          { numero: telefonoADigitos(canonico), descripcion: TOMA_HUMANA_DESCRIPCION },
          { onConflict: 'numero', ignoreDuplicates: true }
        )
      if (error) throw error
      return NextResponse.json({ ok: true, pausado: true })
    }

    // Reanudar: borrar TODAS las filas de toma-humana en cualquier formato.
    const candidatos = await candidatosPausa(telefonoParam)
    if (candidatos.length > 0) {
      const { error } = await supabaseAdmin
        .from('numeros_ignorados')
        .delete()
        .in('numero', candidatos)
        .eq('descripcion', TOMA_HUMANA_DESCRIPCION)
      if (error) throw error
    }

    const estado = await estadoPausa(telefonoParam)
    if (estado.pausado && !estado.pausaPropia) {
      return NextResponse.json({
        ok: true,
        pausado: true,
        nota: 'El número sigue silenciado permanente (otra descripción en Silenciados).',
      })
    }
    return NextResponse.json({ ok: true, pausado: estado.pausado })
  } catch (err) {
    console.error('[API /chat/pausar POST]', err)
    return NextResponse.json(
      { error: 'No se pudo cambiar la pausa del chat' },
      { status: 500 }
    )
  }
}
