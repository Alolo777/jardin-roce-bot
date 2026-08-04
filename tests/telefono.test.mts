import assert from 'node:assert'
import { jidToTelefono, extraerTelefono, variantesTelefono } from '../src/conversation/conversation.service'
import { obtenerNumeroReal, setBaileysKeys } from '../src/whatsapp/contact.service'
import { jidANumero } from '../src/whatsapp/message-utils'
import { limpiarTelefono, formatearTelefono, esLid } from '../src/parser/telefono.parser'

// BUG-011: teléfono LID sin normalizar.
// Antes: obtenerNumeroReal devolvía el jid crudo (@lid / :dispositivo) cuando no
// se podía resolver, guardando esos valores en alertas, pedidos Supabase y eventos.
// Además jidToTelefono no limpiaba el sufijo :dispositivo (a diferencia de jidANumero).

function msgConJid(remoteJid: string, extra?: Record<string, unknown>) {
  return { key: { remoteJid, participantAlt: undefined }, ...(extra || {}) }
}

async function main() {
  // 1) obtenerNumeroReal: LID no resoluble -> NUNCA devuelve jid crudo.
  setBaileysKeys(null)
  const lidNoResuelto = await obtenerNumeroReal(msgConJid('52123456789012@lid'))
  assert.ok(!lidNoResuelto.includes('@lid'), `LID no resuelto no debe contener '@lid': ${lidNoResuelto}`)
  assert.ok(!/:\d+$/.test(lidNoResuelto), `LID no resuelto no debe llevar sufijo :dispositivo: ${lidNoResuelto}`)
  assert.ok(/^\d+$/.test(lidNoResuelto.replace(/^\+/, '')), `LID no resuelto debe ser solo dígitos (+): ${lidNoResuelto}`)
  console.log('✅ obtenerNumeroReal LID no resoluble ->', lidNoResuelto)

  // 1b) LID con sufijo de dispositivo
  const lidConDevice = await obtenerNumeroReal(msgConJid('52123456789012:15@lid'))
  assert.ok(!lidConDevice.includes('@lid'), `LID+device no debe contener '@lid': ${lidConDevice}`)
  assert.ok(!/\d+:15$/.test(lidConDevice), `LID+device no debe conservar ':15': ${lidConDevice}`)
  console.log('✅ obtenerNumeroReal LID+device ->', lidConDevice)

  // 2) jidToTelefono / extraerTelefono: texto normal con :dispositivo
  assert.equal(jidToTelefono('52123456789012:15@s.whatsapp.net'), '+52123456789012', 'jidToTelefono debe limpiar sufijo :dispositivo')
  assert.equal(jidANumero('52123456789012:15@s.whatsapp.net'), '+52123456789012', 'jidANumero ya limpiaba :dispositivo (consistencia)')
  assert.equal(extraerTelefono(msgConJid('52123456789012@s.whatsapp.net')), '+52123456789012', 'extraerTelefono jid normal')
  console.log('✅ jidToTelefono/extraerTelefono limpian :dispositivo')

  // 3) esLid sigue detectando el número LID normalizado por longitud (>13)
  assert.ok(esLid('52123456789012'), 'esLid: número LID normalizado (>13 dígitos) detectado por longitud')
  assert.ok(esLid('52123456789012@lid'), 'esLid: jid @lid detectado por marca')
  console.log('✅ esLid detecta LID por longitud y por marca')

  // 4) consistencia: mismos dígitos sin importar el formato del jid
  const variantes = variantesTelefono(jidANumero('52123456789012:15@lid'))
  assert.ok(variantes.includes('52123456789012') || variantes.includes('+52123456789012'.replace(/\D/g, '')) || variantes.includes('52123456789012'.replace(/^1?/, '')), 'variantesTelefono del LID incluye el número limpio')
  console.log('✅ variantesTelefono consistentes:', variantes)

  console.log('\ntelefono.test.mts: ok — BUG-011 normalización de teléfono LID correcta')
}

main().catch(err => {
  console.error('FALLO:', err)
  process.exit(1)
})