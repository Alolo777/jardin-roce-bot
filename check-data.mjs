import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTI2NTksImV4cCI6MjA5NTU2ODY1OX0.4QnYmhIOpbvBlYbWyT_Fhwf0sdeJLVfVDd_gNbrv3xU'
)

// First check what tables have data
;(async () => {
  // Try historial_chat without filter
  const { data: hc, error: hcError } = await supa
    .from('historial_chat')
    .select('*')
    .limit(5)
  console.log('Historial Chat:', hc?.length, 'filas, error:', hcError?.message)
  
  // Try pedidos_bot
  const { data: pb, error: pbError } = await supa
    .from('pedidos_bot')
    .select('*')
    .limit(5)
  console.log('Pedidos Bot:', pb?.length, 'filas, error:', pbError?.message)
  
  // Try reporte_ventas
  const { data: rv, error: rvError } = await supa
    .from('reporte_ventas')
    .select('*')
    .limit(5)
  console.log('Reporte Ventas:', rv?.length, 'filas, error:', rvError?.message)
  
  // Try historial_prompt
  const { data: hp, error: hpError } = await supa
    .from('historial_prompt')
    .select('*')
    .limit(5)
  console.log('Historial Prompt:', hp?.length, 'filas, error:', hpError?.message)
  
  // Try reclamaciones
  const { data: rc, error: rcError } = await supa
    .from('reclamaciones')
    .select('*')
    .limit(5)
  console.log('Reclamaciones:', rc?.length, 'filas, error:', rcError?.message)
  
  // Check configuracion_bot
  const { data: cb, error: cbError } = await supa
    .from('configuracion_bot')
    .select('*')
    .limit(5)
  console.log('Config Bot:', cb?.length, 'filas')
  if (cb) cb.forEach(c => console.log('  ', c.clave, ':', c.valor?.substring ? c.valor?.substring(0, 100) : c.valor))
})()