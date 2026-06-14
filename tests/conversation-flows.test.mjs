import assert from 'node:assert/strict'
import fs from 'node:fs'

const prompt = fs.readFileSync(new URL('../_prompt_actualizado.txt', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../supabase_migration_pedidos_bot.sql', import.meta.url), 'utf8')

assert.match(prompt, /En envios a domicilio el pago SIEMPRE es por transferencia/i)
assert.match(prompt, /No adivines/i)
assert.match(prompt, /PEDIDO EN CURSO VERIFICADO POR SISTEMA/i)
assert.match(prompt, /Nunca muestres anotaciones internas/i)

assert.match(migration, /create table if not exists pedidos_bot/i)
assert.match(migration, /estado in \('cotizacion', 'apartado', 'pagado', 'entregado', 'cancelado'\)/i)
assert.match(migration, /create table if not exists zonas_envio_ambiguas/i)

console.log('conversation-flows.test.mjs: ok')
