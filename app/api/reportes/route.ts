import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const ESTADOS_VENTA = ['pagado', 'entregado']
const ESTADOS_COTIZACION = ['cotizacion']

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const desde = searchParams.get('desde') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const hasta = searchParams.get('hasta') || new Date().toISOString().slice(0, 10)
    const sucursal = searchParams.get('sucursal')

    const inicio = new Date(desde + 'T00:00:00.000Z')
    const fin = new Date(hasta + 'T23:59:59.999Z')

    if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
      return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
    }

    let queryVentas = supabaseAdmin
      .from('reporte_ventas')
      .select('cliente_telefono, cliente_nombre, producto, precio_total, direccion_entrega, metodo_pago, estado, creado_en')
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())
      .in('estado', ESTADOS_VENTA)
      .order('creado_en', { ascending: false })

    let queryPedidos = supabaseAdmin
      .from('pedidos_bot')
      .select('id, telefono, cliente_nombre, producto, total, sucursal, zona_envio, direccion, metodo_pago, estado, creado_en, actualizado_en')
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())
      .order('actualizado_en', { ascending: false })

    let queryCotizaciones = supabaseAdmin
      .from('pedidos_bot')
      .select('id', { count: 'exact', head: true })
      .in('estado', ESTADOS_COTIZACION)
      .gte('creado_en', inicio.toISOString())
      .lte('creado_en', fin.toISOString())

    if (sucursal) {
      queryVentas = queryVentas.ilike('direccion_entrega', `%${sucursal}%`)
      queryPedidos = queryPedidos.eq('sucursal', sucursal)
      queryCotizaciones = queryCotizaciones.eq('sucursal', sucursal)
    }

    const [ventasRes, pedidosRes, cotizacionesRes] = await Promise.all([
      queryVentas,
      queryPedidos,
      queryCotizaciones,
    ])

    if (ventasRes.error) throw ventasRes.error
    if (pedidosRes.error) throw pedidosRes.error
    if (cotizacionesRes.error) throw cotizacionesRes.error

    const ventas = ventasRes.data || []
    const pedidos = pedidosRes.data || []
    const totalCotizaciones = cotizacionesRes.count || 0

    const totalVentas = ventas.reduce((s, v) => s + Number(v.precio_total || 0), 0)
    const cantidadVentas = ventas.length
    const promedioVenta = cantidadVentas > 0 ? totalVentas / cantidadVentas : 0
    const ticketMayor = ventas.reduce((max, v) => Math.max(max, Number(v.precio_total || 0)), 0)

    const envios = ventas.filter(v => /env[ií]o|domicilio/i.test(`${v.direccion_entrega || ''} ${v.metodo_pago || ''}`)).length
    const recogidas = ventas.filter(v => /sucursal|recoger|centro|norte|sur|oriente|poniente/i.test(v.direccion_entrega || '')).length

    const productosMap = new Map<string, { cantidad: number; total: number }>()
    for (const v of ventas) {
      const prod = v.producto || 'Pedido'
      const prev = productosMap.get(prod) || { cantidad: 0, total: 0 }
      prev.cantidad++
      prev.total += Number(v.precio_total || 0)
      productosMap.set(prod, prev)
    }
    const productosTop = [...productosMap.entries()]
      .map(([producto, { cantidad, total }]) => ({ producto, cantidad, total }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10)

    const sucursalMap = new Map<string, { cantidad: number; total: number; envios: number }>()
    for (const p of pedidos) {
      const key = p.sucursal || 'Sin sucursal'
      const prev = sucursalMap.get(key) || { cantidad: 0, total: 0, envios: 0 }
      prev.cantidad++
      prev.total += Number(p.total || 0)
      if (p.zona_envio) prev.envios++
      sucursalMap.set(key, prev)
    }
    const porSucursal = [...sucursalMap.entries()]
      .map(([sucursal, { cantidad, total, envios }]) => ({ sucursal, cantidad, total, envios }))
      .sort((a, b) => b.total - a.total)

    const diario = new Map<string, { total: number; cantidad: number }>()
    for (const v of ventas) {
      const dia = (v.creado_en || '').slice(0, 10)
      if (!dia) continue
      const prev = diario.get(dia) || { total: 0, cantidad: 0 }
      prev.total += Number(v.precio_total || 0)
      prev.cantidad++
      diario.set(dia, prev)
    }
    const ventasDiario = [...diario.entries()]
      .map(([fecha, { total, cantidad }]) => ({ fecha, total, cantidad }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

    const ventasRecientes = ventas.slice(0, 20).map(v => ({
      cliente_nombre: v.cliente_nombre,
      cliente_telefono: v.cliente_telefono,
      producto: v.producto || 'Pedido',
      precio_total: Number(v.precio_total || 0),
      direccion_entrega: v.direccion_entrega,
      metodo_pago: v.metodo_pago,
      estado: v.estado,
      creado_en: v.creado_en,
    }))

    return NextResponse.json({
      desde,
      hasta,
      ventas: {
        total: totalVentas,
        cantidad: cantidadVentas,
        promedio: promedioVenta,
        ticketMayor,
        envios,
        recogidas,
        productosTop,
        porSucursal,
        diario: ventasDiario,
        recientes: ventasRecientes,
      },
      cotizaciones: {
        cantidad: totalCotizaciones,
      },
    })
  } catch (error) {
    console.error('[API reportes]', error)
    return NextResponse.json({ error: 'No se pudieron obtener los reportes' }, { status: 500 })
  }
}
