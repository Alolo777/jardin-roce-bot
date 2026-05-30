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

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)