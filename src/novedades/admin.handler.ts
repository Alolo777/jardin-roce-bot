// src/novedades/admin.handler.ts
// Atiende los mensajes que un ADMINISTRADOR envía al WhatsApp del bot.
// Responde SIEMPRE con el digest guardado (sin llamadas a la IA), según
// la decisión DEC-084: digest + señales de DB, cero LLM al consultar.

import { construirMensajeNovedades, obtenerNovedadesDelDia } from './novedades.service'

export interface AdminHandlerDeps {
  // Envía un texto de vuelta al chat del administrador (lo provee bot.ts con el sock)
  responderAdmin: (jid: string, texto: string) => Promise<void>
}

export function crearAdminHandler(deps: AdminHandlerDeps) {
  return async function procesarMensajeAdmin(remoteJid: string, _body: string): Promise<void> {
    try {
      const digest = await obtenerNovedadesDelDia()
      const mensaje = construirMensajeNovedades(digest)
      await deps.responderAdmin(remoteJid, mensaje)
    } catch (err) {
      console.error('[novedades] Error respondiendo al admin:', err)
      await deps
        .responderAdmin(remoteJid, '🌸 No pude consultar las novedades ahorita. Intenta de nuevo en unos minutos.')
        .catch(() => {})
    }
  }
}
