// lib/telegram.ts — Jardín RoCe 🌸

const API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const CHAT_IDS  = (process.env.TELEGRAM_CHAT_ID ?? '').split(',').map(s => s.trim()).filter(Boolean)

function esc(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

function ultimos4(numero: string): string {
  const limpio = String(numero ?? '').replace(/\D/g, '')
  // Si el número es muy largo (>13 dígitos), probablemente es un LID (Linked ID)
  // — no podemos extraer el teléfono real; mostramos los últimos 4 del LID
  return 'xxx' + limpio.slice(-4)
}

function esLid(numero: string): boolean {
  return numero.includes('@lid') || (String(numero ?? '').replace(/[^0-9]/g, '').length > 13)
}

function formatearNumero(numero: string, nombre?: string): string {
  const nombreParte = nombre ? ` (${esc(nombre)})` : ''
  if (esLid(numero)) {
    const lid = String(numero ?? '').replace(/@.*$/, '')
    const last4 = lid.replace(/\D/g, '').slice(-4)
    return `Cuenta vinculada — xxx${last4}${nombreParte}`
  }
  return `${ultimos4(numero)}${nombreParte}`
}

function horaActual(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

async function enviar(texto: string, intentos = 3): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('[Telegram] Variables no configuradas.')
    return
  }

  const textoCortado = texto.length > 4000 ? texto.slice(0, 4000) + '\n…_(recortado)_' : texto

  for (const chatId of CHAT_IDS) {
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        const controller = new AbortController()
        const timeout    = setTimeout(() => controller.abort(), 10_000)

        const res = await fetch(`${API_BASE}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            chat_id: chatId, text: textoCortado, parse_mode: 'Markdown',
          }),
        })
        clearTimeout(timeout)

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(`Telegram ${res.status}: ${JSON.stringify(err)}`)
        }
        break

      } catch (err) {
        console.warn(`[Telegram] Intento ${intento}/${intentos} fallido:`, (err as Error).message)
        if (intento === intentos) { console.error('[Telegram] Todos los intentos fallaron.'); return }
        await new Promise(r => setTimeout(r, 2000 * intento))
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 1. VENTA CERRADA
// ════════════════════════════════════════════════════════════════

export interface DatosVentaCerrada {
  cliente: string; producto: string; total: string
  direccion: string; numeroCliente: string
  precioArreglo?: string; precioExtras?: string; precioEnvio?: string; metodoPago?: string
  detalles?: string; tieneFotoReferencia?: boolean; fechaHora?: string
}

export async function enviarAlertaVentaCerrada(datos: DatosVentaCerrada): Promise<void> {
  const msg = [
    '🌸 *¡VENTA CERRADA!* 🌸',
    '',
    `👤 *Cliente:* ${esc(datos.cliente)}`,
    `📱 *Teléfono:* ${formatearNumero(datos.numeroCliente)}`,
    `💐 *Producto:* ${esc(datos.producto)}`,
    ...(datos.detalles ? [`📝 *Detalles:* ${esc(datos.detalles)}`] : []),
    ...(datos.tieneFotoReferencia !== undefined ? [`🖼️ *Foto referencia:* ${datos.tieneFotoReferencia ? 'sí' : 'no'}`] : []),
    ...(datos.precioArreglo ? [`🌷 *Ramo:* ${esc(datos.precioArreglo)}`] : []),
    ...(datos.precioExtras ? [`➕ *Extras:* ${esc(datos.precioExtras)}`] : []),
    ...(datos.precioEnvio ? [`🚚 *Envío:* ${esc(datos.precioEnvio)}`] : []),
    `💰 *Total:* ${esc(datos.total)}`,
    `📍 *Entrega:* ${esc(datos.direccion)}`,
    ...(datos.fechaHora ? [`📅 *Fecha/hora:* ${esc(datos.fechaHora)}`] : []),
    ...(datos.metodoPago ? [`💳 *Pago:* ${esc(datos.metodoPago)}`] : []),
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '✅ _Confirmar pago y preparar el pedido_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 2. ARREGLO APARTADO (desde inventario del día)
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaArregloApartado(
  nombreArreglo: string,
  precio: number,
  numeroCliente: string
): Promise<void> {
  const msg = [
    '📦 *ARREGLO APARTADO*',
    '',
      `💐 *Arreglo:* ${esc(nombreArreglo)}`,
      `💰 *Precio:* $${precio.toFixed(2)} MXN`,
      `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '⚠️ _Marcar como APARTADO en la tienda para no venderlo_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 3. PEDIDO DEL COTIZADOR WEB
// ════════════════════════════════════════════════════════════════

export interface DatosPedidoWeb {
  numeroCliente: string; total: string; entrega: string; flores: string
  tamano: string; envoltura: string; accesorios?: string; nota?: string; imagenUrl?: string
}

export async function enviarAlertaPedidoWeb(datos: DatosPedidoWeb): Promise<void> {
  const lineas = [
    '🛒 *PEDIDO VÍA COTIZADOR WEB*',
    '',
    `📱 *Teléfono:* ${ultimos4(datos.numeroCliente)}`,
    `💐 *Flores:* ${esc(datos.flores)}`,
  ]
  if (datos.accesorios) lineas.push(`🎀 *Accesorios:* ${esc(datos.accesorios)}`)
  lineas.push(
    `📐 *Tamaño:* ${esc(datos.tamano)}`,
    `🎁 *Envoltura:* ${esc(datos.envoltura)}`,
    `📍 *Entrega:* ${esc(datos.entrega)}`,
    `💰 *Total:* ${esc(datos.total)}`,
  )
  if (datos.nota) lineas.push(`📝 *Nota:* ${esc(datos.nota)}`)
  lineas.push(`⏰ *Hora:* ${esc(horaActual())}`)
  if (datos.imagenUrl) lineas.push('', `🖼️ [Ver imagen de referencia](${datos.imagenUrl})`)
  lineas.push('', '⚠️ _Confirmar disponibilidad y cobrar_')
  await enviar(lineas.join('\n'))
}

// ════════════════════════════════════════════════════════════════
// 4. CLIENTE QUIERE COTIZACIÓN
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaCotizacion(
  numeroCliente: string,
  descripcion: string
): Promise<void> {
  const msg = [
    '🌷 *INTERÉS / COTIZACIÓN*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💬 *Detalle:* ${esc(descripcion.slice(0, 400))}`,
    '⚠️ *Acción:* cotizar precio y confirmar disponibilidad',
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Dar seguimiento al cliente y confirmar si desea apartar_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 5. CLIENTE FRUSTRADO
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaClienteFrustrado(
  numeroCliente: string,
  ultimoMensaje: string
): Promise<void> {
  const msg = [
    '⚠️ *CLIENTE NECESITA ATENCIÓN HUMANA*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💬 *Mensaje:* ${esc(ultimoMensaje.slice(0, 200))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '🙋 _Escríbele directamente para ayudarle_',
  ].join('\n')
  await enviar(msg)
}

export interface DatosApartadoPedido {
  cliente: string
  producto: string
  precioArreglo: string
  precioExtras?: string
  precioEnvio?: string
  total: string
  entrega: string
  metodoPago: string
  numeroCliente: string
  detalles?: string
  tieneFotoReferencia?: boolean
  fechaHora?: string
}

export async function enviarAlertaPedidoApartado(datos: DatosApartadoPedido): Promise<void> {
  const msg = [
    '📦 *PEDIDO APARTADO*',
    '',
    `👤 *Cliente:* ${esc(datos.cliente)}`,
    `📱 *Teléfono:* ${ultimos4(datos.numeroCliente)}`,
    `💐 *Producto:* ${esc(datos.producto)}`,
    ...(datos.detalles ? [`📝 *Detalles:* ${esc(datos.detalles)}`] : []),
    ...(datos.tieneFotoReferencia !== undefined ? [`🖼️ *Foto referencia:* ${datos.tieneFotoReferencia ? 'sí' : 'no'}`] : []),
    `🌷 *Ramo:* ${esc(datos.precioArreglo)}`,
    ...(datos.precioExtras ? [`➕ *Extras:* ${esc(datos.precioExtras)}`] : []),
    ...(datos.precioEnvio ? [`🚚 *Envío:* ${esc(datos.precioEnvio)}`] : []),
    `💰 *Total:* ${esc(datos.total)}`,
    `📍 *Entrega:* ${esc(datos.entrega)}`,
    ...(datos.fechaHora ? [`📅 *Fecha/hora:* ${esc(datos.fechaHora)}`] : []),
    `💳 *Pago:* ${esc(datos.metodoPago)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Pedido apartado, pendiente de pago/confirmación final si aplica_',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaZonaAmbigua(numeroCliente: string, texto: string, candidatos?: string): Promise<void> {
  const msg = [
    '🧭 *ZONA DE ENVÍO AMBIGUA*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💬 *Cliente escribió:* ${esc(texto.slice(0, 300))}`,
    candidatos ? `📍 *Posibles zonas:* ${esc(candidatos.slice(0, 500))}` : '',
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Revisar municipio/colonia antes de dar precio_',
  ].filter(Boolean).join('\n')
  await enviar(msg)
}

export async function enviarAlertaAtencionHumana(
  numeroCliente: string,
  nombreCliente?: string,
  motivo?: string,
  contexto?: string
): Promise<void> {
  const msg = [
    '🙋 *ATENCIÓN HUMANA REQUERIDA*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente, nombreCliente)}`,
    motivo ? `🧭 *Motivo:* ${esc(motivo.slice(0, 180))}` : '',
    contexto ? `💬 *Contexto:* ${esc(contexto.slice(0, 700))}` : '',
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Revisar WhatsApp y responder directamente si hace falta_',
  ].filter(Boolean).join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 6. QR / DESCONEXIÓN — Alertas inteligentes
// ════════════════════════════════════════════════════════════════

let ultimaAlertaQr     = 0
let ultimoDiaAlerta    = ''
let alertaNocturnaEnviada = false

function horaCDMX(): { hora: number; dia: string } {
  const ahora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
  const d     = new Date(ahora)
  return {
    hora: d.getHours(),
    dia:  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  }
}

/** ¿Podemos enviar una alerta ahora según las reglas de horario? */
function puedeEnviarAlerta(): boolean {
  const { hora, dia } = horaCDMX()
  const ahora = Date.now()

  // Si cambió el día, reiniciamos contadores nocturnos
  if (dia !== ultimoDiaAlerta) {
    ultimoDiaAlerta    = dia
    alertaNocturnaEnviada = false
  }

  // Horario nocturno (23:00 - 07:59): NO enviar (ya se avisó a las 23:00)
  if (hora >= 23 || hora < 8) {
    if (!alertaNocturnaEnviada && hora >= 23) {
      // Una última alerta a las 23:00
      alertaNocturnaEnviada = true
      return true
    }
    return false
  }

  // Horario diurno (08:00 - 22:59): máximo 1 vez por hora
  if (ahora - ultimaAlertaQr < 60 * 60 * 1000) return false

  ultimaAlertaQr = ahora
  return true
}

export async function enviarAlertaQr(): Promise<void> {
  const { hora } = horaCDMX()
  const esNoche   = hora >= 23 || hora < 8

  // Si no podemos enviar ahora, salir silenciosamente
  if (!puedeEnviarAlerta()) return

  const msg = [
    '📱 *BOT DESCONECTADO*',
    '',
    'La sesión de WhatsApp expiró o se perdió.',
    'Escanea el QR en el dashboard para reconectar:',
    'https://jardin-roce-bot.vercel.app/admin',
    '',
    esNoche ? '🌙 *Último aviso de la noche. Se reanudará a las 8 AM.*' : '',
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].filter(Boolean).join('\n')
  await enviar(msg)
}

export async function enviarAlertaReconectado(): Promise<void> {
  const msg = [
    '✅ *BOT RECONECTADO*',
    '',
    'WhatsApp conectado exitosamente.',
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
  // Resetear contadores al reconectar
  ultimaAlertaQr = 0
  alertaNocturnaEnviada = false
}

export async function enviarAlertaDiariaDesconexion(): Promise<void> {
  const msg = [
    '☀️ *BUENOS DÍAS — BOT SIGUE DESCONECTADO*',
    '',
    'Anoche no se pudo restablecer la conexión de WhatsApp.',
    'Escanea el QR en el dashboard para reconectar:',
    'https://jardin-roce-bot.vercel.app/admin',
    '',
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 7. SOLICITUD DE CANCELACIÓN
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaCancelacion(
  numeroCliente: string,
  descripcion: string
): Promise<void> {
  const msg = [
    '🚫 *SOLICITUD DE CANCELACIÓN*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💬 *Motivo:* ${esc(descripcion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '⚠️ _Revisar pedido y contactar al cliente_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 8. QUEJA O PRODUCTO DAÑADO
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaQueja(
  numeroCliente: string,
  descripcion: string
): Promise<void> {
  const msg = [
    '⚠️ *QUEJA DEL CLIENTE*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💬 *Reporta:* ${esc(descripcion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '🙋 _Atención prioritaria requerida_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 9. VENTA DEL DÍA (para reportes)
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaVentaDelDia(
  totalVentas: number,
  cantidadVentas: number
): Promise<void> {
  const msg = [
    '📊 *RESUMEN DE VENTAS*',
    '',
    `💰 *Total vendido:* $${totalVentas.toFixed(2)} MXN`,
    `📦 *Ventas hoy:* ${cantidadVentas}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 10. CLIENTE QUIERE COMPRAR/INTERESADO EN FLORES
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaClienteInteresado(
  numeroCliente: string,
  descripcion: string
): Promise<void> {
  const msg = [
    '💐 *CLIENTE QUIERE COMPRAR*',
    '',
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💬 *Dice:* ${esc(descripcion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Cliente está preguntando por flores/arreglos — dar seguimiento_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 11. AVISO A EMPLEADOS POR WHATSAPP (FOTOS / ENVÍO)
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaEmpleadoFotos(
  numeroCliente: string,
  nombreCliente: string,
  contexto?: string
): Promise<void> {
  const msg = [
    '📸 *CLIENTE PIDE FOTOS*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente, nombreCliente || undefined)}`,
    `💬 Quiere ver fotos de los arreglos disponibles.`,
    ...(contexto ? [`📝 *Contexto:* ${esc(contexto.slice(0, 300))}`] : []),
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Envíale las fotos actuales de lo que tenemos disponible directamente por WhatsApp_',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaEmpleadoEnvio(
  numeroCliente: string,
  ubicacion: string
): Promise<void> {
  const msg = [
    '🚚 *CLIENTE PIDE COTIZACIÓN DE ENVÍO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `📍 *Ubicación:* ${esc(ubicacion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Cotiza el precio exacto de envío y confírmalo al cliente_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 14A. ALERTAS DE PEDIDO (LISTO / ENTREGADO)
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaPedidoListo(
  numeroCliente: string
): Promise<void> {
  const msg = [
    '✅ *PEDIDO LISTO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_El pedido está listo para entrega o recogida_',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaPedidoEntregado(
  numeroCliente: string
): Promise<void> {
  const msg = [
    '🚚 *PEDIDO ENTREGADO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_El pedido fue entregado al cliente_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 14AA. EVENTOS RESTANTES
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaPagoConfirmado(
  numeroCliente: string,
  cliente: string,
  total: number,
  metodoPago: string
): Promise<void> {
  const msg = [
    '💳 *PAGO CONFIRMADO*',
    '',
    `👤 *Cliente:* ${esc(cliente)}`,
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `💵 *Total:* $${(total || 0).toFixed(2)}`,
    `💳 *Método:* ${esc(metodoPago)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaPrecioConfirmado(
  numeroCliente: string
): Promise<void> {
  const msg = [
    '💲 *PRECIO CONFIRMADO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_El cliente aceptó el precio, esperando datos para continuar_',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaEntregaCompletada(
  numeroCliente: string
): Promise<void> {
  const msg = [
    '📬 *ENTREGA COMPLETADA*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_El proceso de entrega finalizó_',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaBotDesconectado(
  motivo: string
): Promise<void> {
  const msg = [
    '🔴 *BOT DESCONECTADO*',
    '',
    `📝 *Motivo:* ${esc(motivo)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_El bot se desconectó. Intentando reconectar automáticamente..._',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaClienteEsperando(
  numeroCliente: string
): Promise<void> {
  const msg = [
    '⏱️ *CLIENTE ESPERANDO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_El cliente está esperando respuesta del equipo_',
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaFotoEnviada(
  numeroCliente: string,
  caption: string
): Promise<void> {
  const msg = [
    '🖼️ *FOTO ENVIADA*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `💬 *Descripción:* ${esc(caption.slice(0, 200))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Se envió una foto al equipo para su revisión_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 14B. ALERTAS DE CASOS
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaProveedorCaido(error: string): Promise<void> {
  const msj = [
    `🚨 *Proveedor de IA caído*`,
    ``,
    `Flora no puede generar respuestas en este momento.`,
    `Error: ${esc(error.slice(0, 300))}`,
    ``,
    `📅 ${horaActual()}`,
  ].join('\n')
  await enviar(msj)
}

export async function enviarAlertaCasoNuevo(
  numeroCliente: string,
  tipoCaso: string,
  prioridad: string
): Promise<void> {
  const emojiPrioridad = prioridad === 'critica' ? '🔴' : prioridad === 'alta' ? '🟠' : '🟢'
  const msg = [
    '📋 *NUEVO CASO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `🏷️ *Tipo:* ${esc(tipoCaso)}`,
    `${emojiPrioridad} *Prioridad:* ${esc(prioridad)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaCasoArchivado(
  numeroCliente: string,
  motivo: string
): Promise<void> {
  const msg = [
    '🗂️ *CASO ARCHIVADO*',
    '',
    `📱 *Cliente:* ${formatearNumero(numeroCliente)}`,
    `📝 *Motivo:* ${esc(motivo)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 14C. ALERTAS DE PAGO
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaPagoRecibido(
  numeroCliente: string,
  cliente: string,
  producto: string,
  total: number,
  metodoPago: string
): Promise<void> {
  const msg = [
    '💰 *PAGO RECIBIDO*',
    '',
    `👤 *Cliente:* ${esc(cliente)}`,
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `🌸 *Producto:* ${esc(producto || '—')}`,
    `💵 *Total:* $${(total || 0).toFixed(2)}`,
    `💳 *Método:* ${esc(metodoPago)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
  await enviar(msg)
}

export async function enviarAlertaPagoPendiente(
  numeroCliente: string,
  cliente: string,
  producto: string,
  total: number,
  sucursal: string,
  metodoPago: string
): Promise<void> {
  const msg = [
    '⏳ *PAGO PENDIENTE*',
    '',
    `👤 *Cliente:* ${esc(cliente)}`,
    `📱 *Teléfono:* ${formatearNumero(numeroCliente)}`,
    `🌸 *Producto:* ${esc(producto || '—')}`,
    `💵 *Total:* $${(total || 0).toFixed(2)}`,
    `📍 *Sucursal:* ${esc(sucursal || '—')}`,
    `💳 *Método:* ${esc(metodoPago)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '⚠️ *Esperando confirmación de pago*',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 15. ENVIAR FOTO (BASE64) A TELEGRAM
// ════════════════════════════════════════════════════════════════

export async function enviarFotoTelegram(
  base64: string,
  caption: string,
  mimetype = 'image/png'
): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('[Telegram] Variables no configuradas para foto.')
    return
  }

  try {
    const buf = Buffer.from(base64, 'base64')
    const blob = new Blob([buf], { type: mimetype })
    const ext = mimetype.includes('png') ? 'png' : 'jpg'

    for (const chatId of CHAT_IDS) {
      const form = new FormData()
      form.append('chat_id', chatId)
      form.append('photo', blob, `comprobante.${ext}`)
      form.append('caption', caption)
      form.append('parse_mode', 'Markdown')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      const res = await fetch(`${API_BASE}/sendPhoto`, {
        method: 'POST',
        body: form as any,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.warn(`[Telegram] Error sendPhoto a ${chatId}:`, JSON.stringify(err))
      }
    }
  } catch (err) {
    console.warn('[Telegram] Error enviando foto:', (err as Error).message)
  }
}

export async function enviarArchivoTelegram(
  base64: string,
  caption: string,
  mimetype = 'application/octet-stream'
): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('[Telegram] Variables no configuradas para archivo.')
    return
  }

  try {
    const buf = Buffer.from(base64, 'base64')
    const blob = new Blob([buf], { type: mimetype })
    const filename = mimetype.includes('pdf') ? 'comprobante.pdf' : 'archivo-cliente'

    for (const chatId of CHAT_IDS) {
      const form = new FormData()
      form.append('chat_id', chatId)
      form.append('document', blob, filename)
      form.append('caption', caption)
      form.append('parse_mode', 'Markdown')

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      const res = await fetch(`${API_BASE}/sendDocument`, {
        method: 'POST',
        body: form as any,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.warn(`[Telegram] Error sendDocument a ${chatId}:`, JSON.stringify(err))
      }
    }
  } catch (err) {
    console.warn('[Telegram] Error enviando archivo:', (err as Error).message)
  }
}

// ── Export legacy ─────────────────────────────────────────────────────────────
export async function enviarAlertaTelegram(datos: DatosVentaCerrada): Promise<void> {
  return enviarAlertaVentaCerrada(datos)
}
