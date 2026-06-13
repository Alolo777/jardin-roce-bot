import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const botPort = process.env.BOT_PORT || 10000
    const res = await fetch(`http://localhost:${botPort}/qr`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })

    if (res.ok) {
      const data = await res.json()
      if (data?.qr) return NextResponse.json({ ...data, source: 'bot' })
    }
  } catch {
    // Fallback abajo: Supabase guarda el último QR como respaldo.
  }

  try {
    const { data } = await supabaseAdmin
      .from('configuracion_agente')
      .select('qr_code')
      .eq('id', 1)
      .single()

    return NextResponse.json({
      qr: data?.qr_code ?? null,
      qrGeneradoEn: null,
      qrAgeSeconds: null,
      qrExpiresInSeconds: null,
      qrScanGraceSeconds: null,
      qrVencido: false,
      source: data?.qr_code ? 'supabase' : null,
    })
  } catch (error) {
    console.error('[API /bot/qr GET]', error)
    return NextResponse.json({ qr: null, source: null })
  }
}
