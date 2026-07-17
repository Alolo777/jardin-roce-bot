import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  const { supabaseAdmin } = await import('../lib/supabase')

  const DEPOSITO_POLICY =
    `\n- Anticipo mínimo del 50% del total para apartar el pedido. El resto se paga al recoger o antes de la entrega.\n` +
    `- Si el cliente quiere depositar en efectivo en sucursal, puede hacerlo días antes de la entrega. Coordina con el equipo para recibir el pago anticipado.`

  console.log('[update-prompt] Leyendo prompt actual...')
  const { data, error } = await supabaseAdmin
    .from('configuracion_bot')
    .select('valor')
    .eq('clave', 'system_prompt')
    .single()

  if (error) {
    console.error('[update-prompt] Error leyendo prompt:', error.message)
    process.exit(1)
  }

  const actual = data.valor as string

  if (actual.includes('Anticipo mínimo del 50%')) {
    console.log('[update-prompt] La política de anticipo ya existe. No se requiere cambio.')
    return
  }

  const nuevo = actual.replace(
    /- Efectivo o tarjeta solo si recogen en sucursal\./,
    `- Efectivo o tarjeta solo si recogen en sucursal.${DEPOSITO_POLICY}`
  )

  if (nuevo === actual) {
    console.error('[update-prompt] No se encontró la línea de referencia en el prompt.')
    process.exit(1)
  }

  const { error: updateError } = await supabaseAdmin
    .from('configuracion_bot')
    .update({ valor: nuevo, actualizado_en: new Date().toISOString() })
    .eq('clave', 'system_prompt')

  if (updateError) {
    console.error('[update-prompt] Error actualizando prompt:', updateError.message)
    process.exit(1)
  }

  console.log('[update-prompt] ✅ System prompt actualizado con política de anticipo 50%.')
}

main().catch(console.error)
