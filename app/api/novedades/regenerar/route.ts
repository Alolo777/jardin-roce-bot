import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// DEC-084 / BUG-024: botón "Actualizar novedades" del dashboard.
// Envía el comando 'regenerar_novedades' vía configuracion_bot (mismo canal
// que reconnect/recover). El bot lo recoge en ≤5s y regenera el digest con
// ventana de 48h y 60 mensajes por chat. No esperamos la ejecución aquí:
// los límites de función de Vercel son cortos; el resultado se consulta con
// GET /api/novedades.

export async function POST() {
  try {
    const payload = JSON.stringify({ action: 'regenerar_novedades', id: `regen-${Date.now()}` })
    const { error } = await supabaseAdmin
      .from('configuracion_bot')
      .upsert({ clave: 'bot_command', valor: payload }, { onConflict: 'clave' })
    if (error) throw error

    return NextResponse.json({
      ok: true,
      mensaje: 'Comando enviado. El bot está actualizando las novedades (puede tardar hasta 1 minuto).',
    })
  } catch (error) {
    console.error('[API /novedades/regenerar POST]', error)
    return NextResponse.json({ error: 'No se pudo enviar el comando de actualización' }, { status: 500 })
  }
}
