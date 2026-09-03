import assert from 'node:assert/strict'
import { crearAdminHandler, type AdminHandlerDeps } from '../src/novedades/admin.handler.ts'

// ─── Helper: crear admin handler con mocks ───────────────────────

function crearHandlerMocks(overrides: Partial<AdminHandlerDeps> = {}) {
  const respuestas: { jid: string; texto: string }[] = []
  let pausado = false

  const deps: AdminHandlerDeps = {
    responderAdmin: async (jid: string, texto: string) => {
      respuestas.push({ jid, texto })
    },
    setBotPausado: async (valor: boolean) => {
      pausado = valor
    },
    ...overrides,
  }

  const handler = crearAdminHandler(deps)
  return {
    handler,
    respuestas,
    getPausado: () => pausado,
    setPausado: (v: boolean) => { pausado = v },
  }
}

// ─── Test: comando "duerme" ──────────────────────────────────────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()

  await handler('admin@jid', 'duerme')

  assert.equal(respuestas.length, 1, 'duerme responde exactamente 1 vez')
  assert.match(respuestas[0].texto, /Flora dormida/, 'Respuesta confirma dormida')
  assert.equal(getPausado(), true, 'Bot queda pausado')
  assert.equal(respuestas[0].jid, 'admin@jid', 'Responde al admin correcto')
}

// ─── Test: comando "Duerme" (case insensitive) ──────────────────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()

  await handler('admin@jid', 'Duerme')

  assert.equal(respuestas.length, 1, 'Duerme mayuscula responde 1 vez')
  assert.match(respuestas[0].texto, /Flora dormida/, 'Case insensitive funciona')
  assert.equal(getPausado(), true, 'Bot queda pausado')
}

// ─── Test: comando "habla" ───────────────────────────────────────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()
  // Primero pausar
  await handler('admin@jid', 'duerme')
  respuestas.length = 0

  // Luego activar
  await handler('admin@jid', 'habla')

  assert.equal(respuestas.length, 1, 'habla responde 1 vez')
  assert.match(respuestas[0].texto, /Flora activa/, 'Respuesta confirma activa')
  assert.equal(getPausado(), false, 'Bot queda activo')
}

// ─── Test: comando "Habla" (case insensitive) ───────────────────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()

  await handler('admin@jid', 'Habla')

  assert.equal(respuestas.length, 1, 'Habla mayuscula responde 1 vez')
  assert.match(respuestas[0].texto, /Flora activa/, 'Case insensitive funciona')
  assert.equal(getPausado(), false, 'Bot queda activo')
}

// ─── Test: comando "habla" con texto extra ───────────────────────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()

  await handler('admin@jid', 'por favor habla')

  assert.equal(respuestas.length, 1, 'habla embebido en frase responde')
  assert.match(respuestas[0].texto, /Flora activa/, 'Detecta habla en frase')
  assert.equal(getPausado(), false, 'Bot queda activo')
}

// ─── Test: comando "duerme" con texto extra ──────────────────────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()

  await handler('admin@jid', 'ahora duerme')

  assert.equal(respuestas.length, 1, 'duerme embebido en frase responde')
  assert.match(respuestas[0].texto, /Flora dormida/, 'Detecta duerme en frase')
  assert.equal(getPausado(), true, 'Bot queda pausado')
}

// ─── Test: texto que NO es comando no se procesa como pausa ─────

{
  const { handler, respuestas, getPausado } = crearHandlerMocks()

  await handler('admin@jid', 'hola')

  // "hola" no contiene "duerme" ni "habla", asi que pausa no cambia
  assert.equal(getPausado(), false, 'Texto normal no activa pausa')
}

console.log('admin-commands.test.mts: ok — comandos habla/duerme correctos')
