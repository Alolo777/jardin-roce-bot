import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    // Obtener estado de pausa desde Supabase
    const { data: config, error: configError } = await supabaseAdmin
      .from('configuracion_agente')
      .select('bot_pausado')
      .eq('id', 1)
      .single()

    if (configError) throw configError

    // Obtener ventas de hoy
    const hoy = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
    const inicio = new Date(hoy)
    inicio.setHours(0, 0, 0, 0)
    const fin = new Date(hoy)
    fin.setHours(23, 59, 59, 999)

    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from('reporte_ventas')
      .select('precio_total')
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())

    if (ventasError) throw ventasError

    const cantidadVentas = ventas?.length ?? 0
    const totalVentas = ventas?.reduce((sum, v) => sum + (v.precio_total || 0), 0) ?? 0

    // Obtener mensajes de hoy
    const { count: mensajesHoy, error: msgsError } = await supabaseAdmin
      .from('historial_chat')
      .select('*', { count: 'exact', head: true })
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())

    if (msgsError) throw msgsError

    // Intentar obtener status del bot Express
    let botConnected = false
    let ultimaActividad = 'Desconocido'
    try {
      const botPort = process.env.BOT_PORT || 10000
      const res = await fetch(`http://localhost:${botPort}/status`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const botStatus = await res.json()
        botConnected = botStatus.connected
        ultimaActividad = botStatus.ultimaActividad || ultimaActividad
      }
    } catch {
      // El bot Express puede no estar disponible
    }

    return NextResponse.json({
      pausado: config?.bot_pausado ?? false,
      connected: botConnected,
      ultimaActividad,
      ventasHoy: cantidadVentas,
      totalVentasHoy: totalVentas,
      clientesAtendidosHoy: mensajesHoy ?? 0,
    })
  } catch (error) {
    console.error('[API /bot/status GET]', error)
    return NextResponse.json(
      { pausado: false, connected: false, ultimaActividad: 'Error', ventasHoy: 0, totalVentasHoy: 0, clientesAtendidosHoy: 0 }
    )
  }
}
