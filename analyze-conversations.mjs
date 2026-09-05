import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  'https://wfeqmdzmozthfwsqjhwo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmZXFtZHptb3p0aGZ3c3FqaHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTI2NTksImV4cCI6MjA5NTU2ODY1OX0.4QnYmhIOpbvBlYbWyT_Fhwf0sdeJLVfVDd_gNbrv3xU'
)

// Query last 4 days of historial_chat
const ahora = new Date()
const inicio = new Date(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 4))

supa
  .from('historial_chat')
  .select('*')
  .gte('creado_en', inicio.toISOString())
  .order('creado_en', { ascending: false })
  .limit(100)
  .then(({ data, error }) => {
    if (error) console.error('Error:', error.message)
    else {
      console.log('Últimos', data.length, 'mensajes de los últimos 4 días')
      data.forEach(m => {
        const fecha = new Date(m.creado_en).toLocaleString('es-MX')
        console.log(`[${fecha}] ${m.rol} (${m.origen}): ${m.contenido?.substring(0, 150)}`)
      })
      
      // Analyze tone patterns
      console.log('\n--- ANÁLISIS DE TONO ---')
      
      // Count different message types
      const roles = data.map(m => m.rol)
      const origenes = data.map(m => m.origen)
      
      const clientMsgs = data.filter(m => m.rol === 'user').length
      const floraMsgs = data.filter(m => m.rol === 'flora').length
      const equipoMsgs = data.filter(m => m.rol === 'equipo').length
      
      console.log(`Mensajes de cliente: ${clientMsgs}`)
      console.log(`Mensajes de Flora: ${floraMsgs}`)
      console.log(`Mensajes del equipo: ${equipoMsgs}`)
      
      // Look at user message patterns
      const userMessages = data.filter(m => m.rol === 'user')
      const sampleUser = userMessages.map(m => m.contenido).filter(Boolean).join('\n---\n').slice(0, 2000)
      console.log('\nEjemplos de mensajes de cliente:')
      console.log(userMessages.slice(0, 5).map((c, i) => `${i+1}. ${c?.substring(0, 100)}`).join('\n'))
      
      // Look for common keywords/patterns
      const allText = userMessages.map(m => m.contenido?.toLowerCase() || '').join(' ')
      const commonPatterns = [
        'precio', 'cotizar', 'ramo', 'tamaño', 'entrega', 'sucursal',
        'pagar', 'transferencia', 'comprobante', 'nombre', 'fecha',
        'horario', 'catálogo', 'foto', 'whatsapp'
      ]
      console.log('\nPatrones comunes en mensajes:')
      commonPatterns.forEach(p => {
        const count = (allText.match(new RegExp(p, 'g')) || []).length
        if (count > 0) console.log(`  - "${p}": ${count} veces`)
      })
    }
  })
  .catch(e => console.error('Error fatal:', e.message))