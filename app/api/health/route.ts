import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'bot_metrics')
      .maybeSingle()

    if (error) throw error

    const snapshot = data?.valor ? JSON.parse(data.valor) : null
    if (!snapshot) {
      return NextResponse.json({ ok: false, mensaje: 'Sin métricas aún (bot no ha reportado)', metrics: null })
    }

    const aiOk = snapshot.ai && snapshot.ai.totalErrores / Math.max(1, snapshot.ai.totalLlamadas) < 0.2
    const supabaseOk = (snapshot.supabase?.totalErrores ?? 0) < 100

    return NextResponse.json({
      ok: true,
      salud: aiOk && supabaseOk ? 'saludable' : 'degradado',
      ultimaActualizacion: snapshot.ultimaActualizacion,
      metrics: snapshot,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, salud: 'desconocido', error: String(error) },
      { status: 500 }
    )
  }
}
