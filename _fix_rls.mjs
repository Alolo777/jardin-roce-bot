import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Check current RLS policies
  const { data: policies, error: polErr } = await supabase.rpc('exec_sql', {
    sql: "SELECT schemaname, tablename, policyname, permissive, cmd FROM pg_policies WHERE tablename = 'configuracion_agente'"
  })
  if (polErr) console.log('Query policies error:', polErr.message)
  else console.log('Current policies:', JSON.stringify(policies, null, 2))

  // Try using a simpler approach - direct SQL via the Supabase management API
  // First check if exec_sql exists
  const { data: funcs } = await supabase.rpc('exec_sql', { sql: "SELECT 1" })
  if (funcs === undefined) {
    console.log('exec_sql RPC not available, trying direct policy creation via service_role...')
    // Use the Supabase REST API with service_role to bypass RLS
  }

  // Let's just try enabling RLS and adding a policy
  // Using a raw REST call to the Supabase management API
  const res = await fetch('https://api.supabase.com/v1/projects/wfeqmdzmozthfwsqjhwo/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      query: `
        create policy if not exists "Todos pueden leer config"
          on configuracion_agente for select using (true);
      `
    })
  })
  console.log('Management API status:', res.status)
  if (!res.ok) {
    const err = await res.text()
    console.log('Management API error:', err)
  } else {
    console.log('Policy creada exitosamente via Management API')
  }
}

main().catch(console.error)
