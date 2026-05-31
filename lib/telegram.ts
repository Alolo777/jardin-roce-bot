// lib/telegram.ts — Jardín RoCe 🌸

const API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID ?? ''

// ── Escapar Markdown ──────────────────────────────────────────────────────────
function esc(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

// ── Hora México ───────────────────────────────────────────────────────────────
function horaActual(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Enviar con retry y timeout ────────────────────────────────────────────────
async function enviar(texto: string, intentos = 3): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Variables no configuradas.')
    return
  }

  const textoCortado = texto.length > 4000 ? texto.slice(0, 4000) + '\n…_(recortado)_' : texto

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const controller = new AbortController()
      const timeout    = setTimeout(() => controller.abort(), 10_000)

      const res = await fetch(`${API_BASE}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body:    JSON.stringify({
          chat_id:    CHAT_ID,
          text:       textoCortado,
          parse_mode: 'Markdown',
        }),
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(`Telegram ${res.status}: ${JSON.stringify(err)}`)
      }
      return // éxito

    } catch (err) {
      const ultimo = intento === intentos
      console.warn(`[Telegram] Intento ${intento}/${intentos} fallido:`, (err as Error).message)
      if (ultimo) {
        console.error('[Telegram] Todos los intentos fallaron. Mensaje descartado.')
        return // nunca bloquear el bot por Telegram
      }
      await new Promise(r => setTimeout(r, 2000 * intento)) // backoff exponencial
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 1. VENTA CERRADA
// ════════════════════════════════════════════════════════════════

export interface DatosVentaCerrada {
  cliente:       string
  producto:      string
  total:         string
  direccion:     string
  numeroCliente: string // número real obtenido de getContact()
}

export async function enviarAlertaVentaCerrada(datos: DatosVentaCerrada): Promise<void> {
  const msg = [
    '🌸 *¡VENTA CERRADA!* 🌸',
    '',
    `👤 *Cliente:* ${esc(datos.cliente)}`,
    `📱 *WhatsApp:* ${esc(datos.numeroCliente)}`,
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
  const lineas = [
    '🛒 *PEDIDO VÍA COTIZADOR WEB*',
    '',
    `📱 *WhatsApp:* ${esc(datos.numeroCliente)}`,
    `💐 *Flores:* ${esc(datos.flores)}`,
  ]
  if (datos.accesorios) lineas.push(`🎀 *Accesorios:* ${esc(datos.accesorios)}`)
  lineas.push(
    `📐 *Tamaño:* ${esc(datos.tamano)}`,
    `🎁 *Envoltura:* ${esc(datos.envoltura)}`,
    `📍 *Entrega:* ${esc(datos.entrega)}`,
    `💰 *Total:* ${esc(datos.total)}`,
  )
  if (datos.nota)     lineas.push(`📝 *Nota:* ${esc(datos.nota)}`)
  lineas.push(`⏰ *Hora:* ${esc(horaActual())}`)
  if (datos.imagenUrl) lineas.push('', `🖼️ [Ver imagen de referencia](${datos.imagenUrl})`)
  lineas.push('', '⚠️ _Confirmar disponibilidad y proceder al cobro_')
  await enviar(lineas.join('\n'))
}

// ════════════════════════════════════════════════════════════════
// 3. CLIENTE QUIERE COTIZACIÓN PERSONALIZADA
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaCotizacion(
  numeroCliente: string,
  descripcion:   string
): Promise<void> {
  const msg = [
    '🌷 *CLIENTE QUIERE COTIZACIÓN*',
    '',
    `📱 *WhatsApp:* ${esc(numeroCliente)}`,
    `💬 *Busca:* ${esc(descripcion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Se le envió el link del cotizador — puede necesitar ayuda con costo de envío_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 4. CLIENTE CON PROBLEMA / FRUSTRADO
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaClienteFrustrado(
  numeroCliente: string,
  ultimoMensaje: string
): Promise<void> {
  const msg = [
    '⚠️ *CLIENTE NECESITA ATENCIÓN HUMANA*',
    '',
    `📱 *WhatsApp:* ${esc(numeroCliente)}`,
    `💬 *Último mensaje:* ${esc(ultimoMensaje.slice(0, 200))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '🙋 _Escríbele directamente para ayudarle mejor_',
  ].join('\n')
  await enviar(msg)
}

// ── Export legacy ─────────────────────────────────────────────────────────────
export async function enviarAlertaTelegram(datos: DatosVentaCerrada): Promise<void> {
  return enviarAlertaVentaCerrada(datos)
}