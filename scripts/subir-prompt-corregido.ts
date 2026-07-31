import dotenv from 'dotenv'
import { SYSTEM_PROMPT_CORREGIDO } from '../src/prompts/system-prompt.corregido'
dotenv.config({ path: '.env.local' })

async function main() {
  const { supabaseAdmin } = await import('../lib/supabase')

  console.log('[subir-prompt] Longitud del prompt corregido:', SYSTEM_PROMPT_CORREGIDO.length)

  const { data: actual, error: readError } = await supabaseAdmin
    .from('configuracion_bot')
    .select('actualizado_en')
    .eq('clave', 'system_prompt')
    .single()

  if (readError) {
    console.error('[subir-prompt] Error leyendo prompt actual:', readError.message)
    process.exit(1)
  }

  console.log('[subir-prompt] Prompt actual subido el:', actual?.actualizado_en)

  const { error } = await supabaseAdmin
    .from('configuracion_bot')
    .update({ valor: SYSTEM_PROMPT_CORREGIDO, actualizado_en: new Date().toISOString() })
    .eq('clave', 'system_prompt')

  if (error) {
    console.error('[subir-prompt] Error actualizando prompt:', error.message)
    process.exit(1)
  }

  console.log('[subir-prompt] ✅ System prompt corregido subido a Supabase (configuracion_bot).')
}

main().catch(console.error)
