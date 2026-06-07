import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { pausado } = await req.json()
    if (typeof pausado !== 'boolean') {
      return NextResponse.json({ error: 'pausado debe ser boolean' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('configuracion_agente')
      .update({ bot_pausado: pausado })
      .eq('id', 1)
    if (error) throw error

    // El bot lee bot_pausado desde Supabase cada ~30s — no hace falta notificarlo vía Express
    return NextResponse.json({ ok: true, pausado })
  } catch (err) {
    console.error('[api/pause] Error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
