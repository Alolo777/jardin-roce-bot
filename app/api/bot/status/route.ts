import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    // Obtener estado de pausa desde Supabase
    const { data: config, error: configError } = await supabaseAdmin
      .from('configuracion_agente')
      .select('bot_pausado, qr_code')
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
      .select('cliente_nombre, cliente_telefono, producto, precio_total, direccion_entrega, metodo_pago, estado, creado_en')
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())
      .order('creado_en', { ascending: false })

    if (ventasError) throw ventasError

    const cantidadVentas = ventas?.length ?? 0
    const totalVentas = ventas?.reduce((sum, v) => sum + (v.precio_total || 0), 0) ?? 0
    const ventasRecientes = (ventas ?? []).slice(0, 6)

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
    let botQr: string | null = null
    let qrGeneradoEn: string | null = null
    let qrAgeSeconds: number | null = null
    let qrExpiresInSeconds: number | null = null
    let qrScanGraceSeconds: number | null = null
    let qrVencido = false
    let estado = 'desconectado'
    let estadoDetalle = 'Bot Express no disponible'
    let reconnecting = false
    try {
      const botPort = process.env.BOT_PORT || 10000
      const res = await fetch(`http://localhost:${botPort}/status`, { signal: AbortSignal.timeout(3000), cache: 'no-store' })
      if (res.ok) {
        const botStatus = await res.json()
        botConnected = botStatus.connected
        estado = botStatus.estado || (botConnected ? 'conectado' : 'desconectado')
        estadoDetalle = botStatus.estadoDetalle || estadoDetalle
        reconnecting = botStatus.reconnecting ?? false
        ultimaActividad = botStatus.ultimaActividad || ultimaActividad
        botQr = botStatus.qr || null
        qrGeneradoEn = botStatus.qrGeneradoEn || null
        qrAgeSeconds = botStatus.qrAgeSeconds ?? null
        qrExpiresInSeconds = botStatus.qrExpiresInSeconds ?? null
        qrScanGraceSeconds = botStatus.qrScanGraceSeconds ?? null
        qrVencido = botStatus.qrVencido ?? false
      }
    } catch {
      try {
        const { data } = await supabaseAdmin
          .from('configuracion_bot')
          .select('valor')
          .eq('clave', 'bot_status')
          .maybeSingle()

        if (data?.valor) {
          const remoto = JSON.parse(data.valor)
          const updatedAt = remoto.updatedAt ? new Date(remoto.updatedAt).getTime() : 0
          const fresco = Date.now() - updatedAt < 5 * 60_000
          botConnected = fresco ? remoto.connected ?? false : false
          estado = fresco ? remoto.estado || estado : 'desconectado'
          estadoDetalle = fresco ? remoto.estadoDetalle || estadoDetalle : 'Sin pulso reciente de la VM'
          reconnecting = fresco ? remoto.reconnecting ?? false : false
          qrGeneradoEn = remoto.qrGeneradoEn ?? null
          qrAgeSeconds = remoto.qrAgeSeconds ?? null
          qrExpiresInSeconds = remoto.qrExpiresInSeconds ?? null
          qrScanGraceSeconds = remoto.qrScanGraceSeconds ?? null
          qrVencido = remoto.qrVencido ?? false
          ultimaActividad = remoto.ultimaActividad || ultimaActividad
        }
      } catch {
        // Sin Express ni estado remoto.
      }
    }

    return NextResponse.json({
      pausado: config?.bot_pausado ?? false,
      connected: botConnected,
      estado,
      estadoDetalle,
      reconnecting,
      qr: botQr || config?.qr_code || null,
      qrGeneradoEn,
      qrAgeSeconds,
      qrExpiresInSeconds,
      qrScanGraceSeconds,
      qrVencido,
      ultimaActividad,
      ventasHoy: cantidadVentas,
      totalVentasHoy: totalVentas,
      ventasRecientes,
      clientesAtendidosHoy: mensajesHoy ?? 0,
    })
  } catch (error) {
    console.error('[API /bot/status GET]', error)
    return NextResponse.json(
      { pausado: false, connected: false, ultimaActividad: 'Error', ventasHoy: 0, totalVentasHoy: 0, clientesAtendidosHoy: 0 }
    )
  }
}
