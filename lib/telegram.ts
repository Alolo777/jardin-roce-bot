// lib/telegram.ts — Jardín RoCe 🌸

const API_BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const CHAT_IDS  = (process.env.TELEGRAM_CHAT_ID ?? '').split(',').map(s => s.trim()).filter(Boolean)

function esc(text: string): string {
  return String(text ?? '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

function ultimos4(numero: string): string {
  const limpio = String(numero ?? '').replace(/\D/g, '')
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
        const error = err as Error & { cause?: { code?: string; syscall?: string }; code?: string }
        const detalles = error.cause
          ? ` (cause: ${error.cause.code ?? error.cause.syscall ?? 'unknown'})`
          : error.code
            ? ` (code: ${error.code})`
            : ''
        console.warn(`[Telegram] Intento ${intento}/${intentos} fallido: ${error.message}${detalles}`)
        if (intento === intentos) {
          console.error(`[Telegram] Todos los intentos fallaron para chat ${chatId}.${detalles} Verifica: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, y conectividad de red (api.telegram.org).`)
        }
        await new Promise(r => setTimeout(r, 2000 * intento))
      }
    }
  }
}

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
    const error = err as Error & { cause?: { code?: string; syscall?: string }; code?: string }
    const detalles = error.cause
      ? ` (cause: ${error.cause.code ?? error.cause.syscall ?? 'unknown'})`
      : error.code
        ? ` (code: ${error.code})`
        : ''
    console.warn(`[Telegram] Error enviando foto: ${error.message}${detalles}`)
  }
}

export async function enviarMensajeTelegram(texto: string): Promise<void> {
  await enviar(texto)
}

export async function verificarConexionTelegram(): Promise<{ ok: boolean; detalle: string }> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, detalle: 'TELEGRAM_BOT_TOKEN no configurado' }
  }
  if (CHAT_IDS.length === 0) {
    return { ok: false, detalle: 'TELEGRAM_CHAT_ID no configurado' }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    const res = await fetch(`${API_BASE}/getMe`, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, detalle: `API respondió ${res.status}: ${JSON.stringify(err)}` }
    }

    const data = await res.json() as { result?: { username?: string } }
    const botName = data?.result?.username ?? 'desconocido'
    return { ok: true, detalle: `Bot @${botName} — ${CHAT_IDS.length} chat(s) configurado(s)` }
  } catch (err) {
    const error = err as Error & { cause?: { code?: string; syscall?: string }; code?: string }
    const detalles = error.cause
      ? `${error.cause.code ?? error.cause.syscall ?? 'unknown'}`
      : error.code ?? error.message
    return { ok: false, detalle: `No se puede alcanzar api.telegram.org — ${detalles}. Verifica DNS y reglas de firewall de la VM.` }
  }
}
