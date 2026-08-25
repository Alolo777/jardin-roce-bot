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
import { resumirNovedadesChats, responderConsultaAdmin, analizarChatDetalle, type ChatParaResumen, type AnalisisChatItem, type DetalleChatIA } from '../../lib/ai'
import { logger } from '../../lib/logger.service'
import { listarPedidosActivosGlobales } from '../pedidos/pedido.service'
import { enviarTextoANumeros } from '../whatsapp/notification.service'
import { resolverLidInverso } from '../whatsapp/contact.service'
import { variantesTelefono } from '../conversation/conversation.service'
import { extraerUltimos4, esPedidoPendiente, filtrarChatsRuido, mascararTelefono, normalizarNovedadIA, coincideAdminPorVariantes, type PedidoConCliente } from './novedad.detector'
import { cargarNovedades, guardarNovedades, obtenerAdminsBot } from './novedades.repository'
import { obtenerImagenesPorTelefono } from './media-chat.repository'
import type { ImagenVisionAdmin } from '../../lib/ai'
import { TipoNovedad, type AnalisisProfundo, type DetalleChatDia, type EstadoChatDia, type Novedad, type NovedadesDiarias, type TranscripcionChat } from './types'
import { fechaYHoraCdmx } from '../whatsapp/message-utils'

const MENSAJES_POR_CHAT = 60
const CHATS_POR_LOTE_IA = 30
const MAX_NOVEDADES_EN_MENSAJE = 8
const MAX_ESTADOS_EN_MENSAJE = 12
const LIMITE_MENSAJES_CONSULTA = 8000

// ─── Transcripción de mensajes (compartida) ──────────────────────

const fmtHoraMsg = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true })
const fmtDiaMsg = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: '2-digit', month: '2-digit' })

// Convierte mensajes de historial a líneas compactas para la IA.
// DEC-086: inserta marcador [📅 sábado 22/08] cuando cambia el día calendario,
// para que la IA resuelva "mañana"/"hoy" según EL DÍA DEL MENSAJE.
function mensajesALineas(mensajes: any[]): string[] {
  const lineas: string[] = []
  let diaActual = ''
  for (const m of mensajes) {
    let hora = ''
    if (m.creado_en) {
      const d = new Date(m.creado_en)
      hora = fmtHoraMsg.format(d).replace('a. m.', 'am').replace('p. m.', 'pm')
      const dia = fmtDiaMsg.format(d)
      if (dia !== diaActual) {
        diaActual = dia
        lineas.push(`[📅 ${dia}]`)
      }
    }
    const origen = m.origen === 'equipo' ? 'equipo' : m.origen === 'sistema' ? 'sistema' : m.rol === 'user' ? 'cliente' : 'flora'
    const contenido = String(m.contenido ?? '').replace(/\s+/g, ' ').slice(0, 200)
    lineas.push(`[${hora}] ${origen}: ${contenido}`)
  }
  return lineas
}

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

async function obtenerTranscripciones(
  inicioIso: string,
  finIso: string,
  pedidos: PedidoConCliente[] = [],
  limiteMensajes: number = LIMITE_MENSAJES_CONSULTA
): Promise<TranscripcionChat[]> {
  const { data, error } = await supabaseAdmin
    .from('historial_chat')
    .select('cliente_id, rol, contenido, creado_en, origen')
    .gte('creado_en', inicioIso)
    .lt('creado_en', finIso)
    .order('creado_en', { ascending: true })
    .limit(limiteMensajes)
  if (error) throw error
  if (!data?.length) return []

  // DEC-090b: variantes de teléfono con pedido pendiente (para tienePedidoAbierto)
  const pedidosPendientes = new Set<string>()
  for (const { pedido } of pedidos) {
    if (!esPedidoPendiente(pedido)) continue
    const tel = String(pedido.telefono ?? '')
    if (tel) for (const v of variantesTelefono(tel)) pedidosPendientes.add(v)
  }

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
    const recortados = mensajes.slice(-MENSAJES_POR_CHAT)
    const lineas = mensajesALineas(recortados)
    // DEC-089: origen del último mensaje
    const ultimo = recortados[recortados.length - 1]
    const ultimoOrigen = ultimo
      ? (ultimo.origen === 'equipo' ? 'equipo' : ultimo.origen === 'sistema' ? 'sistema' : ultimo.rol === 'user' ? 'cliente' : 'flora')
      : undefined

    // DEC-090b: tienePedidoAbierto por variantes de teléfono contra pedidos
    let tienePedidoAbierto = false
    if (pedidosPendientes.size > 0) {
      tienePedidoAbierto = variantesTelefono(telefono).some(v => pedidosPendientes.has(v))
    }

    chats.push({ telefono, lineas, ultimoOrigen, tienePedidoAbierto })
  }

  // DEC-089: omitir chats ruidosos (equipo habló último sin pedido pendiente)
  const { pasan, omitidos } = filtrarChatsRuido(chats, pedidos)
  if (omitidos > 0 || chats.length === 0) {
    console.log(`[novedades] 🔎 Filtro ruido: ${chats.length} crudos → ${pasan.length} pasan (${omitidos} omitidos)`)
    logger.info('novedades', `Filtro ruido: ${chats.length} crudos → ${pasan.length} pasan, ${omitidos} omitidos`)
  }
  // DEC-090b guardia NUNCA-VACÍO: si había chats con actividad y el filtro se
  // llevó todos (p. ej. LIDs sin resolver), se analizan los más activos para
  // que "Flora" jamás responda vacío habiendo conversaciones reales.
  if (pasan.length === 0 && chats.length > 0) {
    const rescate = [...chats].sort((a, b) => b.lineas.length - a.lineas.length).slice(0, 10)
    console.warn(`[novedades] ⚠️ Filtro dejó 0 de ${chats.length} — rescatando los ${rescate.length} más activos`)
    logger.warn('novedades', `Filtro anti-ruido dejó 0 de ${chats.length}; rescatando top-${rescate.length} activos`)
    return rescate
  }
  return pasan
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

  // DEC-089: pre-filtro de ruido ANTES de gastar IA — chats donde el equipo
  // habló último sin pedido pendiente ni siquiera se analizan.
  const pedidosGlobales = listarPedidosActivosGlobales()

  const novedadesIA: Novedad[] = []
  const estadosChats: EstadoChatDia[] = []
  try {
    const chats = await obtenerTranscripciones(inicioIso, finIso, pedidosGlobales)
    console.log(`[novedades] ${chats.length} chat(s) relevantes en la ventana ${tipoVentana}`)
    logger.info('novedades', `${chats.length} chat(s) relevantes en la ventana (${tipoVentana})`)
    for (let i = 0; i < chats.length; i += CHATS_POR_LOTE_IA) {
      // BUG-023: tope de tiempo por lote. Si un proveedor se cuelga, seguimos
      // con lo que haya para que el digest SIEMPRE se guarde.
      const crudas: AnalisisChatItem[] | null = await Promise.race([
        resumirNovedadesChats(chats.slice(i, i + CHATS_POR_LOTE_IA)),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 150_000)),
      ])
      if (!crudas) break // proveedor caído o lento: no insistir (protege cuota)
      for (const item of crudas) {
        const telefono = String(item.telefono ?? '').trim()
        if (!telefono) continue
        // DEC-086: estado de TODOS los chats (incluso cerrados)
        if (item.estado) {
          estadosChats.push({ telefono, estado: String(item.estado).slice(0, 120) })
        }
        // Novedad opcional del mismo item
        if (item.novedad?.resumen) {
          const n = normalizarNovedadIA({
            telefono,
            tipo: String(item.novedad.tipo ?? 'otro'),
            resumen: String(item.novedad.resumen),
            prioridad: item.novedad.prioridad,
          })
          if (n) novedadesIA.push(n)
        }
      }
    }
  } catch (err) {
    console.error('[novedades] Error en análisis IA:', err)
    logger.warn('novedades', `Análisis IA falló: ${String(err)}`)
  }

  // DEC-089: el detector de reglas queda DORMIDO — solo la IA decide qué es
  // novedad (ver DEC-084/DEC-089).
  const novedades = novedadesIA
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
    estadosChats: estadosChats.slice(0, 40),
  }
  await guardarNovedades(digest)
  console.log(`[novedades] ✅ Digest guardado: ${finales.length} novedad(es) + estado de ${estadosChats.length} chat(s)`)
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
  if (!digest || (digest.novedades.length === 0 && !(digest.estadosChats?.length))) {
    return '🌸 No hay novedades pendientes. Todo en orden.'
  }
  const ordenPrioridad = { alta: 0, media: 1, baja: 2 } as const
  const ordenadas = [...digest.novedades].sort((a, b) => ordenPrioridad[a.prioridad] - ordenPrioridad[b.prioridad])

  // Sección 1: novedades pendientes (máx 8, prioridad primero)
  const lineas = ordenadas.slice(0, MAX_NOVEDADES_EN_MENSAJE).map((n, i) => {
    const etiqueta = ETIQUETA_TIPO[n.tipo] ?? ETIQUETA_TIPO[TipoNovedad.OTRO]
    const cliente = n.cliente ? ` (${n.cliente})` : ''
    const marca = n.prioridad === 'alta' ? '🔴' : n.prioridad === 'media' ? '🟡' : '⚪'
    return `${marca} *${mascararTelefono(n.telefono)}*${cliente}: ${etiqueta}${n.resumen ? ` — ${n.resumen}` : ''}`
  })

  const restantesNov = ordenadas.length - Math.min(ordenadas.length, MAX_NOVEDADES_EN_MENSAJE)

  // DEC-086: sección 2 — estado de TODOS los chats analizados
  const estados = digest.estadosChats ?? []
  const lineasEstados = estados.slice(0, MAX_ESTADOS_EN_MENSAJE).map(e =>
    `• *${mascararTelefono(e.telefono)}*${e.cliente ? ` (${e.cliente})` : ''}: ${e.estado}`
  )
  const restantesEstados = estados.length - Math.min(estados.length, MAX_ESTADOS_EN_MENSAJE)

  const encabezado = digest.tipoVentana === 'reciente'
    ? '📋 *Novedades — últimas 48 horas*'
    : (() => {
      const [y, m, d] = digest.fechaAnalizada.split('-')
      return `📋 *Novedades del ${d}/${m}/${y}*`
    })()

  const partes: string[] = [encabezado]
  if (lineas.length > 0) {
    partes.push('', ...lineas)
    if (restantesNov > 0) partes.push(`_…y ${restantesNov} más._`)
  }
  if (lineasEstados.length > 0) {
    partes.push('', '💬 *Todos los chats:*', ...lineasEstados)
    if (restantesEstados > 0) partes.push(`_…y ${restantesEstados} más._`)
  }

  // DEC-088: sección compacta del análisis profundo (si ya corrió)
  const profundo = digest.profundo
  if (profundo) {
    const aRevisar = profundo.detalleChats.filter(d => d.requiereRevision)
    const preguntas = profundo.detalleChats.flatMap(d => d.preguntasAbiertas.slice(0, 1)).slice(0, 5)
    if (aRevisar.length > 0 || preguntas.length > 0) {
      partes.push('', `🔬 *Revisar (${profundo.totalChats} chats analizados):*`)
      for (const d of aRevisar.slice(0, 5)) {
        partes.push(`• *${mascararTelefono(d.telefono)}*${d.motivoRevision ? ` — ${d.motivoRevision}` : ''}`)
      }
      for (const p of preguntas) partes.push(`❓ ${p}`)
    }
  }
  return partes.join('\n')
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

export interface RespuestaAdminChat {
  texto: string
  // DEC-089: última foto disponible del chat para adjuntar al admin
  ultimaFoto?: { base64: string; mimetype?: string; caption?: string }
}

export async function consultarChatParaAdmin(pregunta: string): Promise<RespuestaAdminChat> {
  const vacio = (texto: string): RespuestaAdminChat => ({ texto })
  try {
    const ult4 = extraerUltimos4(pregunta)
    const nombres = ult4 ? [] : candidatosNombre(pregunta)
    if (!ult4 && nombres.length === 0) return vacio('')

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
      return vacio('🤔 No encontré un chat que coincida. Prueba con otros 4 dígitos del número o el nombre del pedido.')
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
      const lineas = mensajesALineas(mensajes)
      bloques.push({ telefono: mascararTelefono(cand.real), lineas })
    }

    if (bloques.length === 0) return vacio('🤔 Encontré el chat pero no tiene mensajes guardados recientes.')

    // DEC-085/089: hasta 2 imágenes para visión + la MÁS RECIENTE se adjunta
    // al admin en WhatsApp (además de la descripción de la IA).
    let imagenes: ImagenVisionAdmin[] = []
    try {
      imagenes = await obtenerImagenesPorTelefono(
        candidatas.flatMap(c => [c.real, c.stored]),
        2
      )
      if (imagenes.length > 0 && bloques[0]) {
        bloques[0].lineas.push(`[*${imagenes.length} IMAGEN(ES) ADJUNTA(S) EN ESTA CONSULTA*]`)
      }
    } catch { /* sin imágenes: se responde solo con texto */ }

    const respuesta = await responderConsultaAdmin(pregunta, bloques, imagenes)
    if (!respuesta) return vacio('🌸 No pude analizar el chat ahorita. Intenta de nuevo en un momento.')
    logger.info('novedades', `Consulta de admin respondida (${bloques.length} chat(s), ${imagenes.length} imagen(es))`)
    const ultimaFoto = imagenes[0]
      ? { base64: imagenes[0].base64, mimetype: imagenes[0].mimetype, caption: imagenes[0].caption }
      : undefined
    return { texto: respuesta, ultimaFoto }
  } catch (err) {
    console.error('[novedades] Error en consulta de admin:', err)
    return vacio('')
  }
}

// ─── Análisis PROFUNDO por conversación (DEC-088) ────────────────
// 1 llamada IA POR CHAT, espaciadas 15–25 s (≈3 min con 10 chats) para no
// saturar al proveedor. Guardia anti-solapamiento.

let analisisProfundoEnCurso = false

function esperarMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export async function ejecutarAnalisisProfundo(
  ventana: 'dia_anterior' | 'reciente' = 'reciente'
): Promise<AnalisisProfundo | null> {
  if (analisisProfundoEnCurso) {
    logger.info('novedades', 'Análisis profundo ya en curso — se omite')
    return null
  }
  analisisProfundoEnCurso = true
  try {
    const { inicioIso, finIso } = ventana === 'reciente' ? ventanaRecienteCdmx() : ventanaDiaAnteriorCdmx()
    const chats = await obtenerTranscripciones(inicioIso, finIso, listarPedidosActivosGlobales())
    if (chats.length === 0) {
      logger.info('novedades', 'Análisis profundo: sin chats en la ventana')
      return null
    }

    // Contexto temporal para que la IA razone fechas relativas
    const ahora = fechaYHoraCdmx()
    const diaSemana = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long' }).format(new Date())
    const hora12 = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()).replace('a. m.', 'am').replace('p. m.', 'pm')
    const ctxTiempo = { fecha: ahora.fecha, diaSemana, hora: hora12 }

    console.log(`[novedades] 🔬 Análisis profundo (${ventana}): ${chats.length} chat(s), espaciado 15–25 s`)
    logger.info('novedades', `Análisis profundo iniciado (${ventana}, ${chats.length} chats)`)

    const detalleChats: DetalleChatDia[] = []
    for (let i = 0; i < chats.length; i++) {
      const chat = chats[i]
      let det: DetalleChatIA | null = null
      try {
        det = await Promise.race([
          analizarChatDetalle(chat, ctxTiempo),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 90_000)),
        ])
      } catch { /* cuenta como fallo individual */ }
      if (det) {
        detalleChats.push({ telefono: chat.telefono, ...det })
      }
      logger.info('novedades', `Análisis profundo ${i + 1}/${chats.length} ${det ? 'ok' : 'sin resultado'}`)
      if (i < chats.length - 1) {
        await esperarMs(15_000 + Math.floor(Math.random() * 10_000))
      }
    }

    // Resumen global compuesto SIN IA (conteo por categoría)
    const conteo = new Map<string, number>()
    for (const d of detalleChats) conteo.set(d.categoria, (conteo.get(d.categoria) ?? 0) + 1)
    const partes = [...conteo.entries()].map(([cat, n]) => `${n} ${cat.replace(/_/g, ' ')}`)
    const resumenGlobal = `${detalleChats.length} chats analizados: ${partes.join(', ') || 'sin contenido'}`

    const profundo: AnalisisProfundo = {
      generadoEn: new Date().toISOString(),
      tipoVentana: ventana,
      totalChats: detalleChats.length,
      resumenGlobal,
      detalleChats,
    }

    // Fusionar con el digest actual y persistir
    const digestActual = await cargarNovedades()
    if (digestActual) {
      digestActual.profundo = profundo
      await guardarNovedades(digestActual)
    }
    const aRevisar = detalleChats.filter(d => d.requiereRevision).length
    console.log(`[novedades] 🔬 Análisis profundo listo: ${detalleChats.length} chat(s), ${aRevisar} requieren revisión`)
    logger.info('novedades', `Análisis profundo completado: ${resumenGlobal} — ${aRevisar} requieren revisión`)
    return profundo
  } catch (err) {
    console.error('[novedades] Error en análisis profundo:', err)
    logger.error('novedades', `Error análisis profundo: ${String(err)}`)
    return null
  } finally {
    analisisProfundoEnCurso = false
  }
}

// Mensaje compacto de WhatsApp: SOLO los chats interesantes + preguntas abiertas
export function construirMensajeInteresantes(profundo: AnalisisProfundo | null): string | null {
  if (!profundo) return null
  const aRevisar = profundo.detalleChats.filter(d => d.requiereRevision)
  const preguntas = profundo.detalleChats.flatMap(d => d.preguntasAbiertas.slice(0, 2)).slice(0, 5)
  if (aRevisar.length === 0 && preguntas.length === 0) return null

  const lineas: string[] = [`🔬 *Análisis detallado* (${profundo.resumenGlobal})`]
  if (aRevisar.length > 0) {
    lineas.push('', '👀 *Vale la pena revisar:*')
    for (const d of aRevisar.slice(0, 6)) {
      lineas.push(`• *${mascararTelefono(d.telefono)}*${d.motivoRevision ? ` — ${d.motivoRevision}` : ''}`)
    }
  }
  if (preguntas.length > 0) {
    lineas.push('', '❓ *Por confirmar:*')
    for (const p of preguntas) lineas.push(`• ${p}`)
  }
  return lineas.join('\n')
}
