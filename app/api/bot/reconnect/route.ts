import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function enviarComandoRemoto(action: string) {
  const payload = JSON.stringify({ action, id: `${action}-${Date.now()}` })
  const { error } = await supabaseAdmin
    .from('configuracion_bot')
    .upsert({ clave: 'bot_command', valor: payload }, { onConflict: 'clave' })
  if (error) throw error
}

export async function POST() {
  try {
    const botPort = process.env.BOT_PORT || 10000
    const res = await fetch(`http://localhost:${botPort}/reconnect`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    })

    if (!res.ok) throw new Error(`Bot respondió ${res.status}`)
    return NextResponse.json(await res.json())
  } catch (error) {
    console.error('[API /bot/reconnect POST]', error)
    try {
      await enviarComandoRemoto('reconnect')
      return NextResponse.json({ ok: true, mensaje: 'Comando de reinicio enviado a la VM' })
    } catch (fallbackError) {
      console.error('[API /bot/reconnect fallback]', fallbackError)
      return NextResponse.json({ error: 'No se pudo solicitar reconexión' }, { status: 503 })
    }
  }
}
