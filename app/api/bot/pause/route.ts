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

    // Notificar al bot vía su Express interno (no crítico si falla)
    const botPort = process.env.BOT_PORT || '10000'
    const endpoint = `http://127.0.0.1:${botPort}/${pausado ? 'pause' : 'resume'}`

    fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(3000) })
      .catch(() => console.warn('[api/pause] Bot Express no respondió — igual se sincronizará por Supabase'))

    return NextResponse.json({ ok: true, pausado })
  } catch (err) {
    console.error('[api/pause] Error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
