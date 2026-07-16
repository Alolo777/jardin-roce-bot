import { jidANumero } from './message-utils'

let CACHE_NUMEROS = new Map<string, string>()
let BAILEYS_KEYS: any = null

export function setBaileysKeys(keys: any): void {
  BAILEYS_KEYS = keys
}

export function limpiarCacheNumeros(): void {
  if (CACHE_NUMEROS.size > 500) CACHE_NUMEROS.clear()
}

export async function obtenerNumeroReal(msg: any): Promise<string> {
  const jid = msg.key?.remoteJid || ''
  if (CACHE_NUMEROS.has(jid)) return CACHE_NUMEROS.get(jid)!
  if (CACHE_NUMEROS.size > 500) CACHE_NUMEROS.clear()

  const candidatos = [
    msg.key?.remoteJid,
    msg.key?.participant,
    msg.key?.remoteJidAlt,
    msg.key?.participantAlt,
    msg.key?.senderPn,
    msg.senderPn,
    msg.participant,
  ].filter(Boolean) as string[]

  const pnJid = candidatos.find(c => c.endsWith('@s.whatsapp.net') || c.endsWith('@c.us'))
  if (pnJid) {
    const numero = jidANumero(pnJid)
    CACHE_NUMEROS.set(jid, numero)
    return numero
  }

  if (jid.endsWith('@lid')) {
    try {
      const lidUser = jid.replace(/@lid$/, '').replace(/:\d+$/, '')
      const stored = await BAILEYS_KEYS?.get?.('lid-mapping', [`${lidUser}_reverse`])
      const pnUser = stored?.[`${lidUser}_reverse`]
      if (pnUser) {
        const numero = jidANumero(`${pnUser}@s.whatsapp.net`)
        CACHE_NUMEROS.set(jid, numero)
        return numero
      }
    } catch (err) {
      console.warn(`[contact] No se pudo resolver LID (${jid}):`, err)
    }
    return jid
  }

  const numero = jidANumero(jid)
  CACHE_NUMEROS.set(jid, numero)
  return numero
}
