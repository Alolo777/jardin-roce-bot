// src/novedades/novedades.service.ts
// Motor de Novedades — genera UN digest diario (3 am CDMX) con los temas
// pendientes de cada chat del día anterior y lo sirve a los administradores
// sin gastar llamadas de IA al consultarlo (DEC-084).
//
// Flujo:
//   3 am  → generarNovedadesDiarias(): reglas backend + 1 pasada LLM
//   6 am  → enviarNovedadesProactivo(): envía el digest a los admins
//   cualquier hora → un admin escribe al bot y recibe el digest guardado

import { supabaseAdmin } from '../../lib/supabase'
import { resumirNovedadesChats } from '../../lib/ai'
import { listarPedidosActivosGlobales } from '../pedidos/pedido.service'
import { listarCasosRequierenAtencion } from '../casos/caso.service'
import { detectarCasosAtencion, detectarPedidosAtascos, fusionarNovedades, normalizarNovedadIA } from './novedad.detector'
import { cargarNovedades, guardarNovedades, obtenerAdminsBot } from './novedades.repository'
import { TipoNovedad, type Novedad, type NovedadesDiarias, type TranscripcionChat } from './types'
import { limpiarTelefono } from '../parser'

const MENSAJES_POR_CHAT = 50
const CHATS_POR_LOTE_IA = 30
const MAX_NOVEDADES_EN_MENSAJE = 20

// ─── Fechas CDMX ─────────────────────────────────────────────────

function partesCdmx(fecha = new Date()): { y: number; m: number; d: number } {
  const s = fecha.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
  const f = new Date(s)
  return { y: f.getFullYear(), m: f.getMonth(), d: f.getDate() }
}

// Ventana del día ANTERIOR en CDMX expresada como ISO UTC.
// México abolió el horario de verano (2022): CDMX = UTC-6 todo el año.
export function ventanaDiaAnteriorCdmx(): { inicioIso: string; finIso: string; fechaAnalizada: string } {
  const hoy = partesCdmx()
  const ayerUtc = new Date(Date.UTC(hoy.y, hoy.m, hoy.d - 1))
  const y = ayerUtc.getUTCFullYear()
  const m = ayerUtc.getUTCMonth()
  const d = ayerUtc.getUTCDate()
  const inicio = new Date(Date.UTC(y, m, d, 6, 0, 0))
  const fin = new Date(inicio.getTime() + 24 * 60 * 60_000)
  const fechaAnalizada = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { inicioIso: inicio.toISOString(), finIso: fin.toISOString(), fechaAnalizada }
}

// ─── Transcripciones del día anterior ────────────────────────────

async function obtenerTranscripcionesDeAyer(): Promise<TranscripcionChat[]> {
  const { inicioIso, finIso } = ventanaDiaAnteriorCdmx()
  const { data, error } = await supabaseAdmin
    .from('historial_chat')
    .select('cliente_id, rol, contenido, creado_en, origen')
    .gte('creado_en', inicioIso)
    .lt('creado_en', finIso)
    .order('creado_en', { ascending: true })
    .limit(5000)
  if (error) throw error
  if (!data?.length) return []

  // Mapa cliente_id -> teléfono (consulta por lotes)
  const clienteIds = [...new Set(data.map((m: any) => m.cliente_id))] as string[]
  const mapaTelefonos = new Map<string, string>()
  for (let i = 0; i < clienteIds.length; i += 100) {
    const lote = clienteIds.slice(i, i + 100)
    const { data: clientes } = await supabaseAdmin.from('clientes').select('id, telefono').in('id', lote)
    for (const c of clientes ?? []) mapaTelefonos.set(c.id, c.telefono)
  }

  // Agrupar por chat y tomar los últimos N mensajes
  const porChat = new Map<string, any[]>()
  for (const m of data) {
    const lista = porChat.get(m.cliente_id) ?? []
    lista.push(m)
    porChat.set(m.cliente_id, lista)
  }

  const chats: TranscripcionChat[] = []
  for (const [clienteId, mensajes] of porChat) {
    const telefono = mapaTelefonos.get(clienteId)
    if (!telefono) continue
    const lineas = mensajes.slice(-MENSAJES_POR_CHAT).map(m => {
      let hora = ''
      if (m.creado_en) {
        hora = new Date(m.creado_en)
          .toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true })
          .replace('a. m.', 'am').replace('p. m.', 'pm')
      }
      const origen = m.origen === 'equipo' ? 'equipo' : m.origen === 'sistema' ? 'sistema' : m.rol === 'user' ? 'cliente' : 'flora'
      const contenido = String(m.contenido ?? '').replace(/\s+/g, ' ').slice(0, 200)
      return `[${hora}] ${origen}: ${contenido}`
    })
    chats.push({ telefono, lineas })
  }
  return chats
}

// ─── Generación del digest (3 am) ────────────────────────────────
// Idempotente: si ya existe un digest del día analizado, no regenera
// (protege la cuota de la API aunque el bot se reinicie varias veces).

export async function generarNovedadesDiarias(opciones: { forzar?: boolean } = {}): Promise<NovedadesDiarias | null> {
  const { fechaAnalizada } = ventanaDiaAnteriorCdmx()
  if (!opciones.forzar) {
    const existente = await cargarNovedades()
    if (existente && existente.fechaAnalizada === fechaAnalizada) return existente
  }

  console.log(`[novedades] 🌙 Generando digest del día ${fechaAnalizada}...`)
  const reglas: Novedad[] = [
    ...detectarPedidosAtascos(listarPedidosActivosGlobales()),
    ...detectarCasosAtencion(listarCasosRequierenAtencion()),
  ]

  const novedadesIA: Novedad[] = []
  try {
    const chats = await obtenerTranscripcionesDeAyer()
    console.log(`[novedades] ${chats.length} chat(s) activo(s) el ${fechaAnalizada}`)
    for (let i = 0; i < chats.length; i += CHATS_POR_LOTE_IA) {
      const crudas = await resumirNovedadesChats(chats.slice(i, i + CHATS_POR_LOTE_IA))
      if (!crudas) break // proveedor caído: no insistir (protege cuota)
      novedadesIA.push(...crudas.map(normalizarNovedadIA).filter((n): n is Novedad => n !== null))
    }
  } catch (err) {
    console.error('[novedades] Error en análisis IA (se usan solo reglas):', err)
  }

  const novedades = fusionarNovedades(reglas, novedadesIA)
  const digest: NovedadesDiarias = {
    fechaAnalizada,
    generadaEn: new Date().toISOString(),
    novedades,
  }
  await guardarNovedades(digest)
  console.log(`[novedades] ✅ Digest guardado: ${novedades.length} novedad(es) (${reglas.length} reglas + ${novedadesIA.length} IA)`)
  return digest
}

// ─── Consulta del digest (sin LLM) ───────────────────────────────

export async function obtenerNovedadesDelDia(): Promise<NovedadesDiarias | null> {
  return cargarNovedades()
}

// ─── Mensaje para el administrador (plantilla, sin IA) ───────────

const ETIQUETA_TIPO: Record<TipoNovedad, string> = {
  [TipoNovedad.COTIZACION_PENDIENTE]: 'quiere una cotización',
  [TipoNovedad.PEDIDO_SIN_TRATAR]: 'quiere apartar un pedido y no ha avanzado',
  [TipoNovedad.CAMBIO_FECHA]: 'intentó cambiar la fecha/hora de entrega',
  [TipoNovedad.MODIFICACION_ARREGLO]: 'quiere modificar su arreglo floral',
  [TipoNovedad.PAGO_PENDIENTE]: 'queda pendiente su comprobante de pago',
  [TipoNovedad.DUDA_SIN_RESPONDER]: 'tiene una duda sin responder',
  [TipoNovedad.QUEJA]: 'tiene una queja o reclamo',
  [TipoNovedad.OTRO]: 'tiene un tema pendiente',
}

export function construirMensajeNovedades(digest: NovedadesDiarias | null): string {
  if (!digest || digest.novedades.length === 0) {
    return '🌸 No hay novedades pendientes. Todo en orden.'
  }
  const [y, m, d] = digest.fechaAnalizada.split('-')
  const ordenPrioridad = { alta: 0, media: 1, baja: 2 } as const
  const ordenadas = [...digest.novedades].sort((a, b) => ordenPrioridad[a.prioridad] - ordenPrioridad[b.prioridad])

  const lineas = ordenadas.slice(0, MAX_NOVEDADES_EN_MENSAJE).map((n, i) => {
    const etiqueta = ETIQUETA_TIPO[n.tipo] ?? ETIQUETA_TIPO[TipoNovedad.OTRO]
    const cliente = n.cliente ? ` (${n.cliente})` : ''
    const marca = n.prioridad === 'alta' ? '🔴' : n.prioridad === 'media' ? '🟡' : '⚪'
    return `${marca} ${i + 1}. *${n.telefono}*${cliente}: ${etiqueta}${n.resumen ? ` — ${n.resumen}` : ''}`
  })

  const restantes = ordenadas.length - Math.min(ordenadas.length, MAX_NOVEDADES_EN_MENSAJE)
  return [
    `📋 *Novedades del ${d}/${m}/${y}*`,
    '',
    ...lineas,
    ...(restantes > 0 ? ['', `_...y ${restantes} más._`] : []),
    '',
    '_Resumen generado automáticamente a las 3 am._',
  ].join('\n')
}

// ─── Envío proactivo (6 am) ──────────────────────────────────────

export async function enviarNovedadesProactivo(sock: any): Promise<void> {
  try {
    const admins = await obtenerAdminsBot()
    if (admins.length === 0) return
    const digest = await obtenerNovedadesDelDia()
    if (!digest || digest.novedades.length === 0) return // nada que reportar: no molestar
    const mensaje = construirMensajeNovedades(digest)
    for (const admin of admins) {
      try {
        const telefono = limpiarTelefono(admin)
        const jid = admin.includes('@') ? admin : `${telefono}@s.whatsapp.net`
        await sock?.sendMessage(jid, { text: mensaje })
      } catch (err) {
        console.warn(`[novedades] Error enviando digest a admin ${admin}:`, err)
      }
    }
    console.log(`[novedades] ☀️ Digest proactivo enviado a ${admins.length} admin(s)`)
  } catch (err) {
    console.error('[novedades] Error en envío proactivo:', err)
  }
}
