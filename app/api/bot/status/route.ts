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
    const ahora = new Date()
    const cdmxStr = ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
    const cdmx = new Date(cdmxStr)
    const inicio = new Date(Date.UTC(cdmx.getFullYear(), cdmx.getMonth(), cdmx.getDate()))
    const fin = new Date(Date.UTC(cdmx.getFullYear(), cdmx.getMonth(), cdmx.getDate(), 23, 59, 59, 999))

    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from('reporte_ventas')
      .select('cliente_nombre, cliente_telefono, producto, precio_total, direccion_entrega, metodo_pago, estado, creado_en')
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())
      .order('creado_en', { ascending: false })

    if (ventasError) throw ventasError

    let pedidosMetricas: any[] = []
    try {
      const { data: pedidos } = await supabaseAdmin
        .from('pedidos_bot')
        .select('telefono, cliente_nombre, producto, total, zona_envio, precio_envio, direccion, sucursal, metodo_pago, estado, actualizado_en')
        .in('estado', ['apartado', 'pagado', 'entregado'])
        .gte('actualizado_en', inicio.toISOString())
        .lte('actualizado_en', fin.toISOString())
      pedidosMetricas = pedidos ?? []
    } catch {
      pedidosMetricas = []
    }

    const metricas = [
      ...(ventas ?? []).map(v => ({
        cliente_nombre: v.cliente_nombre,
        cliente_telefono: v.cliente_telefono,
        producto: v.producto,
        precio_total: Number(v.precio_total || 0),
        direccion_entrega: v.direccion_entrega,
        metodo_pago: v.metodo_pago,
        estado: v.estado,
        creado_en: v.creado_en,
        precio_envio: 0,
        fuente: 'venta',
      })),
    ]

    const clavesVenta = new Set(metricas.map(v => `${v.cliente_telefono || ''}|${v.producto || ''}|${v.precio_total || 0}`))
    for (const pedido of pedidosMetricas) {
      const precio = Number(pedido.total || 0)
      const clave = `${pedido.telefono || ''}|${pedido.producto || ''}|${precio}`
      if (clavesVenta.has(clave)) continue
      metricas.push({
        cliente_nombre: pedido.cliente_nombre,
        cliente_telefono: pedido.telefono,
        producto: pedido.producto || 'Pedido',
        precio_total: precio,
        direccion_entrega: pedido.zona_envio || pedido.direccion || (pedido.sucursal ? `Sucursal ${pedido.sucursal}` : ''),
        metodo_pago: pedido.metodo_pago,
        estado: pedido.estado,
        creado_en: pedido.actualizado_en,
        precio_envio: Number(pedido.precio_envio || 0),
        fuente: 'pedido',
      })
    }

    const cantidadVentas = metricas.length
    const totalVentas = metricas.reduce((sum, v) => sum + (v.precio_total || 0), 0)
    const ventasRecientes = metricas.sort((a, b) => new Date(b.creado_en || 0).getTime() - new Date(a.creado_en || 0).getTime()).slice(0, 6)
    const promedioVenta = cantidadVentas > 0 ? totalVentas / cantidadVentas : 0
    const ticketMayor = metricas.reduce((max, v) => Math.max(max, v.precio_total || 0), 0)
    const enviosHoy = metricas.filter(v => v.precio_envio > 0 || /env[ií]o|domicilio/i.test(`${v.direccion_entrega || ''} ${v.metodo_pago || ''}`)).length
    const recogidasHoy = metricas.filter(v => /sucursal|recoger|centro|norte/i.test(v.direccion_entrega || '')).length
    const ultimaVentaHora = ventasRecientes[0]?.creado_en ?? null
    const productosTop = Object.entries(metricas.reduce<Record<string, number>>((acc, v) => {
      const producto = v.producto || 'Pedido'
      acc[producto] = (acc[producto] ?? 0) + 1
      return acc
    }, {}))
      .map(([producto, cantidad]) => ({ producto, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5)

    // Obtener mensajes de hoy
    const { count: mensajesHoy, error: msgsError } = await supabaseAdmin
      .from('historial_chat')
      .select('*', { count: 'exact', head: true })
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())

    if (msgsError) throw msgsError

    let pedidosActivos: any[] = []
    let zonasAmbiguasPendientes = 0
    try {
      const { data: pedidos } = await supabaseAdmin
        .from('pedidos_bot')
        .select('id, cliente_id, telefono, estado, cliente_nombre, producto, precio_arreglo, zona_envio, precio_envio, direccion, sucursal, metodo_pago, nota, total, ultimo_mensaje, requiere_revision, actualizado_en')
        .in('estado', ['cotizacion', 'apartado'])
        .order('actualizado_en', { ascending: false })
        .limit(8)
      pedidosActivos = pedidos ?? []

      const { count } = await supabaseAdmin
        .from('zonas_envio_ambiguas')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      zonasAmbiguasPendientes = count ?? 0
    } catch {
      // Tablas nuevas opcionales hasta aplicar migración.
    }

    // Intentar obtener status del bot — en Vercel solo vía Supabase
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
    const FRESCURA_MS = 10 * 60_000 // 10 min de tolerancia en Vercel

    async function cargarEstadoRemoto() {
      const { data } = await supabaseAdmin
        .from('configuracion_bot')
        .select('valor')
        .eq('clave', 'bot_status')
        .maybeSingle()

      if (!data?.valor) return

      const remoto = JSON.parse(data.valor)
      const heartbeat = remoto.heartbeat ? new Date(remoto.heartbeat).getTime() : (remoto.updatedAt ? new Date(remoto.updatedAt).getTime() : 0)
      const fresco = Date.now() - heartbeat < FRESCURA_MS
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

    const enVercel = process.env.VERCEL === '1'
    if (enVercel) {
      // En Vercel no hay Express local, solo Supabase
      await cargarEstadoRemoto().catch(() => {})
    } else {
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
        } else {
          await cargarEstadoRemoto()
        }
      } catch {
        await cargarEstadoRemoto().catch(() => {})
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
      promedioVenta,
      ticketMayor,
      enviosHoy,
      recogidasHoy,
      ultimaVentaHora,
      productosTop,
      ventasRecientes,
      pedidosActivos,
      zonasAmbiguasPendientes,
      clientesAtendidosHoy: mensajesHoy ?? 0,
    })
  } catch (error) {
    console.error('[API /bot/status GET]', error)
    return NextResponse.json(
      { pausado: false, connected: false, ultimaActividad: 'Error', ventasHoy: 0, totalVentasHoy: 0, clientesAtendidosHoy: 0 }
    )
  }
}
