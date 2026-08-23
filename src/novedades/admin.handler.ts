// src/novedades/admin.handler.ts
// Atiende los mensajes que un ADMINISTRADOR envía al WhatsApp del bot.
// Dos modos (BUG-026):
//   1) Pide novedades ("hola", "novedades", "qué hay") → digest guardado, sin LLM.
//   2) Pregunta por un chat concreto (últimos 4 dígitos o nombre, ej.
//      "¿qué pasó con el 7890?" / "¿y Lizet?") → localiza el chat, lee sus
//      últimos 60 mensajes y la IA responde la pregunta del admin.
// La demora anti-ban ("escribiendo..." + espera aleatoria) la aplica bot.ts.

import { construirMensajeNovedades, consultarChatParaAdmin, obtenerNovedadesDelDia } from './novedades.service'
import { extraerUltimos4 } from './novedad.detector'

const AYUDA = [
  '🌸 Te puedo ayudar así:',
  '• Escribe "novedades" → resumen de pendientes de hoy y ayer.',
  '• O pregunta por un chat: "¿qué pasó con el 7890?" o "¿y Lizet?".',
].join('\n')

const RE_NOVEDADES = /novedad|pendientes?\b|resumen|que hay|qué hay|como van|cómo van|estado de|reporte/i

export interface AdminHandlerDeps {
  // Envía un texto de vuelta al chat del administrador (lo provee bot.ts con el sock)
  responderAdmin: (jid: string, texto: string) => Promise<void>
}

export function crearAdminHandler(deps: AdminHandlerDeps) {
  return async function procesarMensajeAdmin(remoteJid: string, body: string): Promise<void> {
    const texto = body.trim()
    try {
      const ult4 = extraerUltimos4(texto)

      // ¿Pregunta de detalle? (menciona dígitos, o es una frase larga que
      // probablemente pregunta por alguien/nombre)
      const quiereDetalle = !!ult4 || (!RE_NOVEDADES.test(texto) && texto.split(/\s+/).length >= 3)
      if (quiereDetalle) {
        const detalle = await consultarChatParaAdmin(texto)
        if (detalle) {
          await deps.responderAdmin(remoteJid, detalle)
          return
        }
        await deps.responderAdmin(remoteJid, `🌸 No pude identificar ese chat.\n\n${AYUDA}`)
        return
      }

      // Digest de novedades (sin LLM)
      const digest = await obtenerNovedadesDelDia()
      await deps.responderAdmin(remoteJid, construirMensajeNovedades(digest))
    } catch (err) {
      console.error('[novedades] Error respondiendo al admin:', err)
      await deps
        .responderAdmin(remoteJid, '🌸 No pude consultar las novedades ahorita. Intenta de nuevo en unos minutos.')
        .catch(() => {})
    }
  }
}

export { AYUDA }
