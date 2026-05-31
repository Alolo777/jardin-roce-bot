// lib/telegram.ts
// Helper para enviar notificaciones a Telegram

interface TelegramAlertData {
  cliente: string
  producto: string
  total: string
  direccion: string
  numeroCliente: string
}

export async function enviarAlertaTelegram(datos: TelegramAlertData): Promise<void> {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Variables de entorno no configuradas. Omitiendo alerta.')
    return
  }

  const emoji = '🌸'
  const mensaje = `
${emoji} *¡NUEVA VENTA CERRADA!* ${emoji}

👤 *Cliente:* ${escapeMarkdown(datos.cliente)}
📱 *WhatsApp:* ${escapeMarkdown(datos.numeroCliente)}
💐 *Producto:* ${escapeMarkdown(datos.producto)}
💰 *Total:* ${escapeMarkdown(datos.total)}
📍 *Dirección:* ${escapeMarkdown(datos.direccion)}

⏰ ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}
  `.trim()

  // Telegram rechaza mensajes de más de 4096 caracteres. Truncamos por seguridad
  // (los datos vienen del token de la IA y podrían venir inflados).
  const TELEGRAM_MAX = 4096
  const mensajeFinal = mensaje.length > TELEGRAM_MAX
    ? mensaje.slice(0, TELEGRAM_MAX - 1) + '…'
    : mensaje

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: mensajeFinal,
      parse_mode: 'Markdown',
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`Telegram API error: ${JSON.stringify(errorData)}`)
  }
}

// Escapar caracteres especiales de Markdown de Telegram
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}