import { createClient } from '@supabase/supabase-js'

// ⚠️ Este cliente usa la service_role key.
// NUNCA lo importes en componentes del lado del cliente.
// Solo usar en: API Routes, Server Components, bot.ts

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL')
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY')
}

const TIMEOUT_MS = 30_000

async function fetchConTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  const combinedSignal = init?.signal
  if (combinedSignal) {
    combinedSignal.addEventListener('abort', () => controller.abort())
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export const supabaseAdminRaw = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchConTimeout },
  }
)

// Proxy que cuenta errores de Supabase sin alterar el comportamiento de la API.
// Cualquier promesa resultante de una query registra el error en metrics (non-swallowing).
import { metrics } from './metrics.service'

function wrapWithMetrics<T>(target: T): T {
  const handler: ProxyHandler<object> = {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(obj, args)
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            const promise = result as Promise<unknown>
            promise.catch((err) => {
              metrics.recordSupabaseError(err instanceof Error ? err.message : String(err), 'supabase')
            })
            return promise
          }
          return result
        }
      }
      if (value && typeof value === 'object') {
        return new Proxy(value as object, handler)
      }
      return value
    },
  }
  return new Proxy(target as object, handler) as T
}

export const supabaseAdmin = wrapWithMetrics(supabaseAdminRaw)