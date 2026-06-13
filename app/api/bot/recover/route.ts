import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const botPort = process.env.BOT_PORT || 10000
    const res = await fetch(`http://localhost:${botPort}/recover`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    })

    if (!res.ok) throw new Error(`Bot respondió ${res.status}`)
    return NextResponse.json(await res.json())
  } catch (error) {
    console.error('[API /bot/recover POST]', error)
    return NextResponse.json({ error: 'No se pudo iniciar rescate' }, { status: 503 })
  }
}
