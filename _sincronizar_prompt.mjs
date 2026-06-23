// Script para sincronizar _prompt_actualizado.txt con Supabase
// Uso: node _sincronizar_prompt.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

const prompt = fs.readFileSync(new URL('./_prompt_actualizado.txt', import.meta.url), 'utf-8')

// Obtener prompt anterior para historial
const { data: actual } = await supabase
  .from('configuracion_bot')
  .select('valor')
  .eq('clave', 'system_prompt')
  .single()

// Actualizar
const { error } = await supabase
  .from('configuracion_bot')
  .update({ valor: prompt.trim() })
  .eq('clave', 'system_prompt')

if (error) {
  console.error('Error actualizando prompt:', error.message)
  process.exit(1)
}

// Guardar historial
await supabase.from('historial_prompt').insert({
  prompt_anterior: actual?.valor ?? '',
  prompt_nuevo: prompt.trim(),
  editado_por: 'script',
})

console.log('Prompt sincronizado exitosamente.')
console.log(`Longitud: ${prompt.length} caracteres`)
