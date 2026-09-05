import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTI2NTksImV4cCI6MjA5NTU2ODY1OX0.4QnYmhIOpbvBlYbWyT_Fhwf0sdeJLVfVDd_gNbrv3xU'
)

// Get the current system prompt
;(async () => {
  const { data: promptData, error: promptError } = await supa
    .from('configuracion_bot')
    .select('valor')
    .eq('clave', 'system_prompt')
    .maybeSingle()
  console.log('=== SISTEMA ACTUAL ===')
  console.log(promptData?.valor || 'No encontrado')
  console.log('\n---')
  
  // Check all config
  const { data: allConfig, error: allError } = await supa
    .from('configuracion_bot')
    .select('clave, valor')
  console.log('=== TODAS LAS CONFIGURACIONES ===')
  allConfig?.forEach(c => {
    const val = c.valor?.substring ? c.valor.substring(0, 200) : c.valor
    console.log(`\${c.clave}: \${val}`)
  })
})()