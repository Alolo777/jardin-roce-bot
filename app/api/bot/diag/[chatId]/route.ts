import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params
  if (!chatId) return NextResponse.json({ error: 'Falta chatId' }, { status: 400 })

  const enVercel = process.env.VERCEL === '1'

  if (!enVercel) {
    try {
      const botPort = process.env.BOT_PORT || 10000
      const res = await fetch(`http://localhost:${botPort}/diag/${encodeURIComponent(chatId)}`, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      })
      if (res.ok) return NextResponse.json(await res.json())
    } catch {
      // fall through
    }
  }

  // Fallback: devolver respuesta parcial desde Supabase
  try {
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { data } = await supabaseAdmin
      .from('pedidos_bot')
      .select('*')
      .eq('cliente_id', chatId)
      .single()

    return NextResponse.json({
      clienteId: chatId,
      pedidoEnCurso: null,
      ventaCerrada: false,
      pedidoBot: data ?? null,
      nota: enVercel ? 'Diagnóstico parcial desde Vercel (sin acceso al bot en tiempo real)' : 'Bot local no disponible',
    })
  } catch (error) {
    console.error('[API /bot/diag]', error)
    return NextResponse.json({ error: 'Diagnóstico no disponible' }, { status: 503 })
  }
}
