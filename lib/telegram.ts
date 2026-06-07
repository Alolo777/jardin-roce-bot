// lib/telegram.ts — Jardín RoCe 🌸

const API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID ?? ''

function esc(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

function ultimos4(numero: string): string {
  const limpio = String(numero ?? '').replace(/\D/g, '')
  return 'xxx' + limpio.slice(-4)
}

function horaActual(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: CHAT_ID, text: textoCortado, parse_mode: 'Markdown',
        }),
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(`Telegram ${res.status}: ${JSON.stringify(err)}`)
      }
      return

    } catch (err) {
      console.warn(`[Telegram] Intento ${intento}/${intentos} fallido:`, (err as Error).message)
      if (intento === intentos) { console.error('[Telegram] Todos los intentos fallaron.'); return }
      await new Promise(r => setTimeout(r, 2000 * intento))
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 1. VENTA CERRADA
// ════════════════════════════════════════════════════════════════

export interface DatosVentaCerrada {
  cliente: string; producto: string; total: string
  direccion: string; numeroCliente: string
}

export async function enviarAlertaVentaCerrada(datos: DatosVentaCerrada): Promise<void> {
  const msg = [
    '🌸 *¡VENTA CERRADA!* 🌸',
    '',
    `👤 *Cliente:* ${esc(datos.cliente)}`,
    `📱 *Teléfono:* ${ultimos4(datos.numeroCliente)}`,
    `💐 *Producto:* ${esc(datos.producto)}`,
    `💰 *Total:* ${esc(datos.total)}`,
    `📍 *Entrega:* ${esc(datos.direccion)}`,
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
      `📱 *Teléfono:* ${ultimos4(numeroCliente)}`,
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
    '🌷 *CLIENTE QUIERE COTIZACIÓN*',
    '',
    `📱 *Teléfono:* ${ultimos4(numeroCliente)}`,
    `💬 *Busca:* ${esc(descripcion.slice(0, 300))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '_Se le envió el cotizador web — puede necesitar ayuda con precio de envío_',
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
    `📱 *Teléfono:* ${ultimos4(numeroCliente)}`,
    `💬 *Mensaje:* ${esc(ultimoMensaje.slice(0, 200))}`,
    `⏰ *Hora:* ${esc(horaActual())}`,
    '',
    '🙋 _Escríbele directamente para ayudarle_',
  ].join('\n')
  await enviar(msg)
}

// ════════════════════════════════════════════════════════════════
// 6. QR / DESCONEXIÓN
// ════════════════════════════════════════════════════════════════

export async function enviarAlertaQr(): Promise<void> {
  const msg = [
    '📱 *BOT DESCONECTADO*',
    '',
    'La sesión de WhatsApp expiró o se perdió.',
    'Escanea el QR en el dashboard para reconectar:',
    'https://floreria-app-mauve.vercel.app/admin',
    '',
    `⏰ *Hora:* ${esc(horaActual())}`,
  ].join('\n')
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
}

// ── Export legacy ─────────────────────────────────────────────────────────────
export async function enviarAlertaTelegram(datos: DatosVentaCerrada): Promise<void> {
  return enviarAlertaVentaCerrada(datos)
}