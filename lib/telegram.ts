// lib/telegram.ts — Jardín RoCe 🌸
// Notificaciones a Telegram

const API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID ?? ''

// ── Escapar caracteres especiales de Markdown ────────────────────────────────
function esc(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

// ── Limpiar número de WhatsApp ────────────────────────────────────────────────
// Convierte "5215512345678@c.us" o "162195@lid" → "+5215512345678"
function limpiarNumero(raw: string): string {
  const limpio = raw.replace(/@[^\s]*/g, '').trim()
  return limpio.startsWith('52') ? `+${limpio}` : limpio
}

// ── Hora en México ────────────────────────────────────────────────────────────
function horaActual(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone:  'America/Mexico_City',
    day:       '2-digit',
    month:     '2-digit',
    year:      'numeric',
    hour:      '2-digit',
    minute:    '2-digit',
  })
}

// ── Enviar mensaje a Telegram ─────────────────────────────────────────────────
async function enviar(texto: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Variables no configuradas, omitiendo alerta.')
    return
  }

  // Telegram tiene límite de 4096 chars por mensaje
  const textoCortado = texto.length > 4000
    ? texto.slice(0, 4000) + '\n…_(recortado)_'
    : texto

  const res = await fetch(`${API_BASE}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:    CHAT_ID,
      text:       textoCortado,
      parse_mode: 'Markdown',
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Telegram API error: ${JSON.stringify(err)}`)
  }
}

// ════════════════════════════════════════════════════════════════
// 1. VENTA CERRADA  (via conversación normal con Flora)
// ════════════════════════════════════════════════════════════════

export interface DatosVentaCerrada {
  cliente:       string
  producto:      string
  total:         string
  direccion:     string
  numeroCliente: string   // raw de WhatsApp, se limpia aquí
}

export async function enviarAlertaVentaCerrada(datos: DatosVentaCerrada): Promise<void> {
  const numero = limpiarNumero(datos.numeroCliente)

  const msg = [
    '🌸 *¡VENTA CERRADA!* 🌸',
    '',
    `👤 *Cliente:* ${esc(datos.cliente)}`,
    `📱 *WhatsApp:* ${esc(numero)}`,
    `💐 *Producto:* ${esc(datos.producto)}`,
    `💰 *Total:* ${esc(datos.total)}`,
    `📍 *Entrega:* ${esc(datos.direccion)}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '✅ _Recuerda apartar el arreglo y confirmar el pago_',
  ].join('\n')

  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 2. PEDIDO DEL COTIZADOR WEB
// El cliente armó su ramo en la web y lo envió por WhatsApp
// ════════════════════════════════════════════════════════════════

export interface DatosPedidoWeb {
  numeroCliente: string
  total:         string
  entrega:       string
  flores:        string
  tamano:        string
  envoltura:     string
  accesorios?:   string
  nota?:         string
  imagenUrl?:    string
}

export async function enviarAlertaPedidoWeb(datos: DatosPedidoWeb): Promise<void> {
  const numero = limpiarNumero(datos.numeroCliente)

  const lineas = [
    '🛒 *PEDIDO VÍA COTIZADOR WEB*',
    '',
    `📱 *WhatsApp:* ${esc(numero)}`,
    `💐 *Flores:* ${esc(datos.flores)}`,
  ]

  if (datos.accesorios) {
    lineas.push(`🎀 *Accesorios:* ${esc(datos.accesorios)}`)
  }

  lineas.push(
    `📐 *Tamaño:* ${esc(datos.tamano)}`,
    `🎁 *Envoltura:* ${esc(datos.envoltura)}`,
    `📍 *Entrega:* ${esc(datos.entrega)}`,
    `💰 *Total:* ${esc(datos.total)}`,
  )

  if (datos.nota) {
    lineas.push(`📝 *Nota:* ${esc(datos.nota)}`)
  }

  lineas.push(
    `⏰ *Hora:* ${esc(horaActual())}`,
  )

  if (datos.imagenUrl) {
    lineas.push('', `🖼️ [Ver imagen de referencia](${datos.imagenUrl})`)
  }

  lineas.push('', '⚠️ _Confirmar disponibilidad y proceder al cobro_')

  await enviar(lineas.join('\n'))
}

// ════════════════════════════════════════════════════════════════
// 3. CLIENTE INTERESADO EN COTIZACIÓN PERSONALIZADA
// Se le envió el link del cotizador web o pide algo especial
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaCotizacion(
  numeroCliente: string,
  descripcion:   string
): Promise<void> {
  const numero = limpiarNumero(numeroCliente)

  const msg = [
    '🌷 *CLIENTE QUIERE COTIZACIÓN*',
    '',
    `📱 *WhatsApp:* ${esc(numero)}`,
    `💬 *Busca:* ${esc(descripcion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Se le envió el link del cotizador web — puede que necesite tu ayuda para el costo de envío_',
  ].join('\n')

  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// EXPORT LEGACY — compatibilidad con imports anteriores
// ════════════════════════════════════════════════════════════════
export async function enviarAlertaTelegram(datos: DatosVentaCerrada): Promise<void> {
  return enviarAlertaVentaCerrada(datos)
}