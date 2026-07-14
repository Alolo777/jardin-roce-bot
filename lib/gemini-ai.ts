// lib/gemini-ai.ts
// Cliente para Google Gemini API (fallback cuando GitHub Models falla)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const GEMINI_MODEL = 'gemini-2.0-flash'

const MAX_CONCURRENT = 3
const API_TIMEOUT_MS = 20_000

let activeRequests = 0
const requestQueue: Array<() => void> = []

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  return key
}

async function concurrencySlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++
    return
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      const idx = requestQueue.indexOf(cb)
      if (idx >= 0) requestQueue.splice(idx, 1)
      console.warn(`[gemini] ⚠️ Timeout esperando slot, forzando`)
      resolve()
    }, 15_000)
    const cb = () => {
      clearTimeout(timer)
      activeRequests++
      resolve()
    }
    requestQueue.push(cb)
  })
}

function releaseSlot(): void {
  const next = requestQueue.shift()
  if (next) next()
  else activeRequests--
}

async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  await concurrencySlot()
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`[gemini] ⏱️ Timeout ${API_TIMEOUT_MS}ms`)), API_TIMEOUT_MS)
      ),
    ])
  } finally {
    releaseSlot()
  }
}

async function conRetry<T>(fn: () => Promise<T>, maxIntentos = 2): Promise<T> {
  let ultimoError: unknown
  for (let intento = 0; intento < maxIntentos; intento++) {
    try {
      return await withLimit(fn)
    } catch (error) {
      ultimoError = error
      if (intento === maxIntentos - 1) break
      const espera = 500 * 2 ** intento + Math.floor(Math.random() * 200)
      await new Promise(resolve => setTimeout(resolve, espera))
    }
  }
  throw ultimoError
}

export async function callGeminiText(
  prompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const key = getApiKey()
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${key}`

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: options?.maxTokens ?? 800,
      temperature: options?.temperature ?? 0,
    },
  })

  const raw = await conRetry(async () => {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }
      return (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }
    } finally {
      clearTimeout(tid)
    }
  }, 2)

  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  return text
}

export async function callGeminiVision(
  prompt: string,
  imagenes: { base64: string; mimetype: string }[]
): Promise<string> {
  const key = getApiKey()
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${key}`

  const parts: Record<string, unknown>[] = [{ text: prompt }]
  for (const img of imagenes.slice(0, 2)) {
    parts.push({
      inline_data: {
        mime_type: img.mimetype || 'image/jpeg',
        data: img.base64,
      },
    })
  }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 120, temperature: 0 },
  })

  const raw = await conRetry(async () => {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }
      return (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }
    } finally {
      clearTimeout(tid)
    }
  }, 2)

  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  return text
}
