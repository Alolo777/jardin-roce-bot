import { NextResponse, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  telefonoADigitos,
  ultimos10,
  TOMA_HUMANA_DESCRIPCION,
} from '@/lib/chat-dashboard'

export const dynamic = 'force-dynamic'

const LIMITE_CONVERSACIONES = 60
const VENTANA_MENSAJES = 1000

type Lado = 'cliente' | 'flora' | 'equipo' | 'sistema'

function clasificarLado(rol: string, origen: string | null, contenido: string): Lado {
  if (rol === 'user') return 'cliente'
  if (origen === 'equipo' || contenido.startsWith('[Agente:')) return 'equipo'
  if (origen === 'sistema' || contenido.startsWith('[Flora omitió')) return 'sistema'
  return 'flora'
}

function vistaPrevia(contenido: string): string {
  return contenido
    .replace(/^\[Agente:\s*|\]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()
    const qDigitos = telefonoADigitos(q)
    const qTexto = q.toLowerCase()

    // 1. Últimos mensajes (1 sola query, orden global descendente)
    const { data: recientes, error } = await supabaseAdmin
      .from('historial_chat')
      .select('cliente_id, rol, contenido, origen, creado_en')
      .order('creado_en', { ascending: false })
      .limit(VENTANA_MENSAJES)
    if (error) throw error

    // 2. Agrupar por cliente (el orden de inserción = última actividad)
    const porCliente = new Map<
      string,
      {
        ultimo: { rol: string; contenido: string; origen: string | null; creado_en: string }
        noLeidos: number
        cerrado: boolean
      }
    >()
    for (const m of recientes ?? []) {
      let e = porCliente.get(m.cliente_id)
      if (!e) {
        e = {
          ultimo: {
            rol: m.rol,
            contenido: m.contenido,
            origen: m.origen,
            creado_en: m.creado_en,
          },
          noLeidos: 0,
          cerrado: false,
        }
        porCliente.set(m.cliente_id, e)
      }
      if (!e.cerrado) {
        if (m.rol === 'user') e.noLeidos++
        else e.cerrado = true
      }
    }

    const ids = [...porCliente.keys()].slice(0, LIMITE_CONVERSACIONES)

    // 3. Teléfonos de esos clientes (batch)
    const telPorId = new Map<string, string>()
    if (ids.length > 0) {
      const { data: clientes } = await supabaseAdmin
        .from('clientes')
        .select('id, telefono')
        .in('id', ids)
      for (const c of clientes ?? []) telPorId.set(c.id, c.telefono)
    }

    // 4. Pedidos recientes para nombre/producto/estado (match por últimos 10 dígitos)
    const pedidoPorDigitos = new Map<string, any>()
    try {
      const { data: pedidos } = await supabaseAdmin
        .from('pedidos_bot')
        .select('telefono, cliente_nombre, producto, estado, estado_flujo, total, actualizado_en')
        .order('actualizado_en', { ascending: false })
        .limit(300)
      for (const p of pedidos ?? []) {
        const d10 = ultimos10(p.telefono ?? '')
        if (d10 && !pedidoPorDigitos.has(d10)) pedidoPorDigitos.set(d10, p)
      }
    } catch {
      // tabla opcional
    }

    // 5. Casos activos (match por últimos 10 dígitos del teléfono)
    const casoPorDigitos = new Map<string, any>()
    try {
      const { data: casos } = await supabaseAdmin
        .from('casos')
        .select('telefono, tipo, prioridad, ultima_actividad')
        .eq('estado', 'ACTIVO')
        .order('ultima_actividad', { ascending: false })
        .limit(300)
      for (const c of casos ?? []) {
        const d10 = ultimos10(c.telefono ?? '')
        if (d10 && !casoPorDigitos.has(d10)) casoPorDigitos.set(d10, c)
      }
    } catch {
      // tabla opcional
    }

    // 6. Silenciados (pausa por chat + permanentes)
    const pausaPorDigitos = new Map<string, string | null>()
    try {
      const { data: ignorados } = await supabaseAdmin
        .from('numeros_ignorados')
        .select('numero, descripcion')
      for (const n of ignorados ?? []) {
        pausaPorDigitos.set(ultimos10(n.numero ?? ''), n.descripcion ?? null)
      }
    } catch {
      // tabla opcional
    }

    // 7. Armar respuesta + filtro de búsqueda
    const conversaciones: any[] = []
    for (const id of ids) {
      const telefono = telPorId.get(id)
      if (!telefono) continue
      const e = porCliente.get(id)!
      const d10 = ultimos10(telefono)
      const pedido = pedidoPorDigitos.get(d10) ?? null
      const caso = casoPorDigitos.get(d10) ?? null
      const descripcionPausa = pausaPorDigitos.get(d10)
      const nombre = pedido?.cliente_nombre ?? null

      if (q) {
        const coincide =
          (qDigitos && telefonoADigitos(telefono).includes(qDigitos)) ||
          (qTexto && (nombre ?? '').toLowerCase().includes(qTexto)) ||
          (qTexto && vistaPrevia(e.ultimo.contenido).toLowerCase().includes(qTexto))
        if (!coincide) continue
      }

      conversaciones.push({
        telefono,
        nombre,
        ultimoMensaje: vistaPrevia(e.ultimo.contenido),
        ultimoLado: clasificarLado(e.ultimo.rol, e.ultimo.origen, e.ultimo.contenido),
        ultimaActividad: e.ultimo.creado_en,
        noLeidos: Math.min(e.noLeidos, 99),
        pausado: descripcionPausa !== undefined,
        pausaPropia: descripcionPausa === TOMA_HUMANA_DESCRIPCION,
        pedido: pedido
          ? {
              producto: pedido.producto ?? null,
              estado: pedido.estado ?? null,
              estadoFlujo: pedido.estado_flujo ?? null,
              total: pedido.total ?? null,
            }
          : null,
        caso: caso ? { tipo: caso.tipo ?? null, prioridad: caso.prioridad ?? null } : null,
      })
    }

    return NextResponse.json({ conversaciones })
  } catch (err) {
    console.error('[API /chat/conversaciones GET]', err)
    return NextResponse.json(
      { error: 'No se pudieron cargar las conversaciones' },
      { status: 500 }
    )
  }
}
