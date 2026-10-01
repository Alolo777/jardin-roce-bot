import { NextResponse, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  telefonoADigitos,
  ultimos10,
  resolverTelefonoCanonical,
  telefonoParaMostrar,
  TOMA_HUMANA_DESCRIPCION,
} from '@/lib/chat-dashboard'

export const dynamic = 'force-dynamic'

const LIMITE_MENSAJES = 200

type Lado = 'cliente' | 'flora' | 'equipo' | 'sistema'

function clasificar(rol: string, origen: string | null, contenido: string): Lado {
  if (rol === 'user') return 'cliente'
  if (origen === 'equipo' || contenido.startsWith('[Agente:')) return 'equipo'
  if (origen === 'sistema' || contenido.startsWith('[Flora omitió')) return 'sistema'
  return 'flora'
}

function paraMostrar(lado: Lado, contenido: string): string {
  if (lado === 'equipo') return contenido.replace(/^\[Agente:\s*|\]$/g, '').trim()
  return contenido
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const telefonoParam = (searchParams.get('telefono') ?? '').trim()
    const limite = Math.min(
      Math.max(Number(searchParams.get('limit')) || 100, 1),
      LIMITE_MENSAJES
    )
    if (telefonoADigitos(telefonoParam).length < 10) {
      return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })
    }

    const canonico = await resolverTelefonoCanonical(telefonoParam)
    const { data: cliente } = await supabaseAdmin
      .from('clientes')
      .select('id, telefono')
      .eq('telefono', canonico)
      .maybeSingle()
    if (!cliente) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })
    }

    const { data: historial, error } = await supabaseAdmin
      .from('historial_chat')
      .select('id, rol, contenido, origen, creado_en')
      .eq('cliente_id', cliente.id)
      .order('creado_en', { ascending: true })
      .limit(limite)
    if (error) throw error

    const mensajes = (historial ?? []).map((m) => {
      const lado = clasificar(m.rol, m.origen, m.contenido)
      return {
        id: m.id,
        lado,
        texto: paraMostrar(lado, m.contenido),
        creadoEn: m.creado_en,
      }
    })

    // Contexto del contacto: pedido + caso + pausa (mismo match por dígitos que la bandeja)
    const d10 = ultimos10(cliente.telefono)
    let pedido: any = null
    let caso: any = null
    let pausado = false
    let pausaPropia = false
    try {
      const { data } = await supabaseAdmin
        .from('pedidos_bot')
        .select(
          'telefono, cliente_nombre, producto, estado, estado_flujo, total, sucursal, direccion, metodo_pago, fecha_entrega, hora_entrega, zona_envio, precio_envio, requiere_revision, actualizado_en'
        )
        .order('actualizado_en', { ascending: false })
        .limit(300)
      pedido = (data ?? []).find((p) => ultimos10(p.telefono ?? '') === d10) ?? null
    } catch {
      // tabla opcional
    }
    try {
      const { data, error } = await supabaseAdmin
        .from('casos')
        .select('telefono, tipo, prioridad, estado, ultima_actividad')
        .eq('estado', 'ACTIVO')
        .order('ultima_actividad', { ascending: false })
        .limit(300)
      if (error) throw error
      caso = (data ?? []).find((c) => ultimos10(c.telefono ?? '') === d10) ?? null
    } catch {
      // tabla opcional o columna telefono inexistente en instalaciones viejas
    }
    try {
      const { data } = await supabaseAdmin
        .from('numeros_ignorados')
        .select('numero, descripcion')
      const fila = (data ?? []).find((n) => ultimos10(n.numero ?? '') === d10)
      pausado = Boolean(fila)
      pausaPropia = fila?.descripcion === TOMA_HUMANA_DESCRIPCION
    } catch {
      // tabla opcional
    }

    // Estado del outbox para este chat (pendientes + último error visible en el composer)
    let outboxPendientes = 0
    let outboxUltimoError: { texto: string; detalle: string | null; fecha: string } | null = null
    try {
      const { data } = await supabaseAdmin
        .from('mensajes_outbox_equipo')
        .select('estado, texto, error_detalle, actualizado_en')
        .eq('telefono', canonico)
        .order('creado_en', { ascending: false })
        .limit(10)
      outboxPendientes = (data ?? []).filter((o) =>
        ['pendiente', 'enviando'].includes(o.estado)
      ).length
      const ultimoError = (data ?? []).find((o) => o.estado === 'error')
      if (ultimoError) {
        outboxUltimoError = {
          texto: ultimoError.texto,
          detalle: ultimoError.error_detalle,
          fecha: ultimoError.actualizado_en,
        }
      }
    } catch {
      // tabla aún sin migración aplicada
    }

    return NextResponse.json({
      telefono: cliente.telefono,
      mostrar: telefonoParaMostrar(cliente.telefono),
      mensajes,
      contacto: {
        nombre: pedido?.cliente_nombre ?? null,
        pedido,
        caso,
        pausado,
        pausaPropia,
      },
      outbox: { pendientes: outboxPendientes, ultimoError: outboxUltimoError },
    })
  } catch (err) {
    console.error('[API /chat/mensajes GET]', err)
    return NextResponse.json(
      { error: 'No se pudieron cargar los mensajes' },
      { status: 500 }
    )
  }
}
