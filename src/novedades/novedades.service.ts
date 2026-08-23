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
import { resumirNovedadesChats, responderConsultaAdmin, type ChatParaResumen } from '../../lib/ai'
import { logger } from '../../lib/logger.service'
import { listarPedidosActivosGlobales } from '../pedidos/pedido.service'
import { listarCasosRequierenAtencion } from '../casos/caso.service'
import { enviarTextoANumeros } from '../whatsapp/notification.service'
import { resolverLidInverso } from '../whatsapp/contact.service'
import { variantesTelefono } from '../conversation/conversation.service'
import { detectarCasosAtencion, detectarPedidosAtascos, extraerUltimos4, filtrarNovedadesDeChatsActivos, fusionarNovedades, mascararTelefono, normalizarNovedadIA, coincideAdminPorVariantes } from './novedad.detector'
import { cargarNovedades, guardarNovedades, obtenerAdminsBot } from './novedades.repository'
import { TipoNovedad, type Novedad, type NovedadesDiarias, type TranscripcionChat } from './types'

const MENSAJES_POR_CHAT = 60
const CHATS_POR_LOTE_IA = 30
const MAX_NOVEDADES_EN_MENSAJE = 20
const LIMITE_MENSAJES_CONSULTA = 8000

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

// Ventana de las ÚLTIMAS 48 HORAS (hoy + ayer) para la regeneración manual
// desde el dashboard. Cubre chats con actividad reciente aunque el job de las
// 3 am aún no los haya analizado.
export function ventanaRecienteCdmx(): { inicioIso: string; finIso: string } {
  const fin = new Date()
  const inicio = new Date(fin.getTime() - 48 * 60 * 60_000)
  return { inicioIso: inicio.toISOString(), finIso: fin.toISOString() }
}

// ─── Transcripciones del período analizado ───────────────────────

async function obtenerTranscripciones(inicioIso: string, finIso: string, limiteMensajes: number = LIMITE_MENSAJES_CONSULTA): Promise<TranscripcionChat[]> {
  const { data, error } = await supabaseAdmin
    .from('historial_chat')
    .select('cliente_id, rol, contenido, creado_en, origen')
    .gte('creado_en', inicioIso)
    .lt('creado_en', finIso)
    .order('creado_en', { ascending: true })
    .limit(limiteMensajes)
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
    let telefono = mapaTelefonos.get(clienteId)
    if (!telefono) continue
    // BUG-025: clientes.telefono puede contener dígitos de LID (no el número
    // real). Se intenta resolver contra el mapeo LID→PN que Baileys guarda.
    try {
      const real = await resolverLidInverso(telefono)
      if (real && real.replace(/\D/g, '') !== telefono.replace(/\D/g, '')) telefono = real
    } catch { /* sin claves o sin mapeo: se usa el teléfono guardado */ }
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

export async function generarNovedadesDiarias(
  opciones: { forzar?: boolean; ventana?: 'dia_anterior' | 'reciente' } = {}
): Promise<NovedadesDiarias | null> {
  const tipoVentana = opciones.ventana ?? 'dia_anterior'
  const { inicioIso, finIso } = tipoVentana === 'reciente'
    ? ventanaRecienteCdmx()
    : ventanaDiaAnteriorCdmx()

  // Idempotencia SOLO para el job automático del día anterior (protege cuota
  // ante reinicios). La regeneración manual siempre recalcula.
  const fechaAnalizada = ventanaDiaAnteriorCdmx().fechaAnalizada
  if (!opciones.forzar && tipoVentana === 'dia_anterior') {
    const existente = await cargarNovedades()
    if (existente && existente.tipoVentana !== 'reciente' && existente.fechaAnalizada === fechaAnalizada) return existente
  }

  console.log(`[novedades] 🌙 Generando digest (${tipoVentana})...`)
  logger.info('novedades', `Generando digest (${tipoVentana}, forzado=${!!opciones.forzar})`)

  // BUG-025: solo chats con actividad DENTRO de la ventana analizada.
  // Los pedidos/casos antiguos que no escribieron en este período se omiten.
  const novedadesIA: Novedad[] = []
  let telefonosActivos: string[] = []
  try {
    const chats = await obtenerTranscripciones(inicioIso, finIso)
    telefonosActivos = chats.map(c => c.telefono)
    console.log(`[novedades] ${chats.length} chat(s) activo(s) en la ventana ${tipoVentana}`)
    logger.info('novedades', `${chats.length} chat(s) activo(s) en la ventana (${tipoVentana})`)
    for (let i = 0; i < chats.length; i += CHATS_POR_LOTE_IA) {
      // BUG-023: tope de tiempo por lote. Si un proveedor se cuelga, seguimos
      // con lo que haya para que el digest SIEMPRE se guarde.
      const crudas = await Promise.race([
        resumirNovedadesChats(chats.slice(i, i + CHATS_POR_LOTE_IA)),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 150_000)),
      ])
      if (!crudas) break // proveedor caído o lento: no insistir (protege cuota)
      novedadesIA.push(...crudas.map(normalizarNovedadIA).filter((n): n is Novedad => n !== null))
    }
  } catch (err) {
    console.error('[novedades] Error en análisis IA (se usan solo reglas):', err)
    logger.warn('novedades', `Análisis IA falló, solo reglas: ${String(err)}`)
  }

  const todasLasReglas: Novedad[] = [
    ...detectarPedidosAtascos(listarPedidosActivosGlobales()),
    ...detectarCasosAtencion(listarCasosRequierenAtencion()),
  ]
  const reglas = telefonosActivos.length > 0
    ? filtrarNovedadesDeChatsActivos(todasLasReglas, telefonosActivos)
    : []

  const novedades = fusionarNovedades(reglas, novedadesIA)
  // BUG-026: los administradores son internos — si alguno disparó una novedad
  // (p. ej. mandó una foto de prueba al bot), se omite del digest.
  const admins = await obtenerAdminsBot()
  const finales = admins.length > 0
    ? novedades.filter(n => !coincideAdminPorVariantes(n.telefono, admins))
    : novedades
  const digest: NovedadesDiarias = {
    fechaAnalizada,
    tipoVentana,
    generadaEn: new Date().toISOString(),
    novedades: finales,
  }
  await guardarNovedades(digest)
  console.log(`[novedades] ✅ Digest guardado: ${finales.length} novedad(es) (${reglas.length} reglas + ${novedadesIA.length} IA)`)
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
  [TipoNovedad.ENTREGA_PROGRAMADA]: 'tiene entrega/recogida programada',
  [TipoNovedad.ESPERANDO_RESPUESTA_EQUIPO]: 'espera respuesta del equipo',
  [TipoNovedad.DUDA_SIN_RESPONDER]: 'tiene una duda sin responder',
  [TipoNovedad.QUEJA]: 'tiene una queja o reclamo',
  [TipoNovedad.OTRO]: 'tiene un tema pendiente',
}

export function construirMensajeNovedades(digest: NovedadesDiarias | null): string {
  if (!digest || digest.novedades.length === 0) {
    return '🌸 No hay novedades pendientes. Todo en orden.'
  }
  const ordenPrioridad = { alta: 0, media: 1, baja: 2 } as const
  const ordenadas = [...digest.novedades].sort((a, b) => ordenPrioridad[a.prioridad] - ordenPrioridad[b.prioridad])

  const lineas = ordenadas.slice(0, MAX_NOVEDADES_EN_MENSAJE).map((n, i) => {
    const etiqueta = ETIQUETA_TIPO[n.tipo] ?? ETIQUETA_TIPO[TipoNovedad.OTRO]
    const cliente = n.cliente ? ` (${n.cliente})` : ''
    const marca = n.prioridad === 'alta' ? '🔴' : n.prioridad === 'media' ? '🟡' : '⚪'
    return `${marca} ${i + 1}. *${mascararTelefono(n.telefono)}*${cliente}: ${etiqueta}${n.resumen ? ` — ${n.resumen}` : ''}`
  })

  const restantes = ordenadas.length - Math.min(ordenadas.length, MAX_NOVEDADES_EN_MENSAJE)
  const encabezado = digest.tipoVentana === 'reciente'
    ? '📋 *Novedades — últimas 48 horas*'
    : (() => {
      const [y, m, d] = digest.fechaAnalizada.split('-')
      return `📋 *Novedades del ${d}/${m}/${y}*`
    })()
  return [
    encabezado,
    '',
    ...lineas,
    ...(restantes > 0 ? ['', `_...y ${restantes} más._`] : []),
    '',
    '_Resumen generado automáticamente a las 3 am._',
  ].join('\n')
}

// ─── Envío proactivo (6 am) ──────────────────────────────────────
// BUG-023: usa enviarTextoANumeros (resuelve el JID real con onWhatsApp,
// tolerando variantes MX 52/521 y entradas duplicadas). Envía SIEMPRE una
// confirmación diaria, aunque no haya novedades, para que el admin sepa
// que el sistema está vivo.

export async function enviarNovedadesProactivo(sock: any): Promise<void> {
  try {
    const admins = await obtenerAdminsBot()
    if (admins.length === 0) {
      console.warn('[novedades] Sin admins_bot configurados — no se envía digest proactivo')
      return
    }
    const digest = await obtenerNovedadesDelDia()
    const mensaje = construirMensajeNovedades(digest)
    const exitosos = await enviarTextoANumeros(sock, admins, mensaje)
    console.log(`[novedades] ☀️ Digest proactivo enviado a ${exitosos}/${admins.length} admin(s)`)
  } catch (err) {
    console.error('[novedades] Error en envío proactivo:', err)
  }
}

// ─── Consulta de detalle de un chat (seguimiento del admin, BUG-026) ─────────
// El admin pregunta algo específico ("¿qué pasó con el 7890?" / "¿y Lizet?")
// y aquí se localiza el chat (por últimos 4 dígitos del teléfono real o por
// nombre en pedidos), se leen sus últimos mensajes y la IA responde.

const STOPWORDS_ADMIN = new Set([
  'que', 'como', 'cuando', 'donde', 'paso', 'para', 'por', 'los', 'las', 'del',
  'una', 'uno', 'este', 'esta', 'esto', 'quiero', 'saber', 'dice', 'dijo',
  'chats', 'chat', 'cliente', 'numero', 'hace', 'hay', 'mas', 'cual', 'quien',
  'todo', 'toda', 'todos', 'sobre', 'entre', 'pero', 'aun', 'dime', 'tell',
  'manda', 'muestra', 'revisa', 'revisas', 'puedes', 'podrias', 'favor',
])

function candidatosNombre(texto: string): string[] {
  return [...new Set(
    texto
      .split(/[^a-záéíóúñü]+/i)
      .map(w => w.trim())
      .filter(w => w.length >= 4 && !STOPWORDS_ADMIN.has(w.toLowerCase()))
      .slice(0, 3),
  )]
}

function coincideEnVariantes(numero: string, lista: string[]): boolean {
  const variantes = new Set(variantesTelefono(numero))
  if (variantes.size === 0) return false
  return lista.some(t => variantesTelefono(t).some(v => variantes.has(v)))
}

export async function consultarChatParaAdmin(pregunta: string): Promise<string> {
  try {
    const ult4 = extraerUltimos4(pregunta)
    const nombres = ult4 ? [] : candidatosNombre(pregunta)
    if (!ult4 && nombres.length === 0) return ''

    // Cargar clientes y resolver número real (cache LID→PN de Baileys)
    const { data: clientesRows } = await supabaseAdmin.from('clientes').select('id, telefono').limit(2000)
    let candidatas: { clienteId: string; stored: string; real: string }[] = []
    for (const c of clientesRows ?? []) {
      const stored = String(c.telefono ?? '').trim()
      if (!stored) continue
      let real = stored
      try {
        const r = await resolverLidInverso(stored)
        if (r) real = r
      } catch { /* sin mapeo */ }
      candidatas.push({ clienteId: c.id, stored, real })
    }

    if (ult4) {
      candidatas = candidatas.filter(e => e.stored.endsWith(ult4) || e.real.endsWith(ult4))
    }
    if (nombres.length > 0 && candidatas.length !== 1) {
      // Desambiguar por nombre registrado en pedidos
      for (const nombre of nombres) {
        const { data: peds } = await supabaseAdmin
          .from('pedidos_bot')
          .select('telefono')
          .ilike('cliente_nombre', `%${nombre}%`)
          .limit(5)
        const tels = (peds ?? []).map(p => String(p.telefono ?? '')).filter(Boolean)
        if (tels.length > 0) {
          const porNombre = candidatas.filter(e => coincideEnVariantes(e.real, tels) || coincideEnVariantes(e.stored, tels))
          if (porNombre.length > 0) { candidatas = porNombre; break }
        }
      }
    }

    if (candidatas.length === 0) {
      return '🤔 No encontré un chat que coincida. Prueba con otros 4 dígitos del número o el nombre del pedido.'
    }
    candidatas = candidatas.slice(0, 3)

    const bloques: ChatParaResumen[] = []
    for (const cand of candidatas) {
      const { data } = await supabaseAdmin
        .from('historial_chat')
        .select('rol, contenido, creado_en, origen')
        .eq('cliente_id', cand.clienteId)
        .order('creado_en', { ascending: false })
        .limit(MENSAJES_POR_CHAT)
      const mensajes = (data ?? []).reverse()
      if (mensajes.length === 0) continue
      const lineas = mensajes.map(m => {
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
      bloques.push({ telefono: mascararTelefono(cand.real), lineas })
    }

    if (bloques.length === 0) return '🤔 Encontré el chat pero no tiene mensajes guardados recientes.'

    const respuesta = await responderConsultaAdmin(pregunta, bloques)
    if (!respuesta) return '🌸 No pude analizar el chat ahorita. Intenta de nuevo en un momento.'
    logger.info('novedades', `Consulta de admin respondida (${bloques.length} chat(s))`)
    return respuesta
  } catch (err) {
    console.error('[novedades] Error en consulta de admin:', err)
    return ''
  }
}
