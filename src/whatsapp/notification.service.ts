import { supabaseAdmin } from '../../lib/supabase'
import { jidANumero } from './message-utils'
import { limpiarTelefono } from '../../parser'

let CACHE_EMPLEADOS: { numeros: string[]; ts: number } | null = null

export async function obtenerEmpleadosANotificar(): Promise<string[]> {
  const ahora = Date.now()
  if (CACHE_EMPLEADOS && ahora - CACHE_EMPLEADOS.ts < 120_000) return CACHE_EMPLEADOS.numeros
  try {
    const { data, error } = await supabaseAdmin
      .from('configuracion_bot')
      .select('valor')
      .eq('clave', 'empleados_notificar')
      .maybeSingle()
    if (error) throw error
    const numeros = (data?.valor ?? '')
      .split(',')
      .map((n: string) => n.trim().replace(/\s/g, ''))
      .filter(Boolean)
    CACHE_EMPLEADOS = { numeros, ts: ahora }
    return numeros
  } catch {
    return []
  }
}

export async function notificarEmpleadosWhatsApp(sock: any, mensaje: string): Promise<void> {
  const numeros = await obtenerEmpleadosANotificar()
  if (numeros.length === 0) {
    console.warn('[notif] No hay empleados configurados para notificar vía WhatsApp')
    return
  }
  if (!sock?.user) {
    console.warn('[notif] sock.user no disponible — no se puede notificar')
    return
  }
  console.log(`[notif] Notificando a ${numeros.length} empleado(s)...`)
  for (const num of numeros) {
    let jid = ''
    try {
      const telefono = limpiarTelefono(num)
      jid = (num.includes('@') ? num : `${telefono}@s.whatsapp.net`).replace(/@c\.us$/, '@s.whatsapp.net')
      if (telefono && sock.onWhatsApp) {
        const resultado = await sock.onWhatsApp(telefono).catch(() => undefined)
        const contacto = resultado?.find((r: { exists: boolean; jid: string }) => r.exists && r.jid)
        if (contacto?.jid) jid = contacto.jid.replace(/@c\.us$/, '@s.whatsapp.net')
        if (resultado && !contacto) {
          console.warn(`[notif] Empleado ${telefono} no aparece como usuario válido`)
          continue
        }
      }
      const empleadoUser = jidANumero(jid).replace(/^\+/, '')
      const botUser = jidANumero(sock.user.id || '').replace(/^\+/, '')
      if (empleadoUser && botUser && empleadoUser === botUser) {
        console.warn(`[notif] El empleado ${jid} es el mismo número conectado al bot`)
      }
      await sock.sendMessage(jid, { text: mensaje })
    } catch (err) {
      console.warn(`[notif] Error notificando a empleado ${num} (JID: ${jid}):`, err)
    }
  }
}

export async function enviarFotoEmpleadosWhatsApp(sock: any, base64: string, caption: string, mimetype = 'image/jpeg'): Promise<void> {
  const numeros = await obtenerEmpleadosANotificar()
  if (numeros.length === 0) return
  if (!sock?.user) return
  for (const num of numeros) {
    let jid = ''
    try {
      const telefono = limpiarTelefono(num)
      jid = (num.includes('@') ? num : `${telefono}@s.whatsapp.net`).replace(/@c\.us$/, '@s.whatsapp.net')
      if (telefono && sock.onWhatsApp) {
        const resultado = await sock.onWhatsApp(telefono).catch(() => undefined)
        const contacto = resultado?.find((r: { exists: boolean; jid: string }) => r.exists && r.jid)
        if (contacto?.jid) jid = contacto.jid.replace(/@c\.us$/, '@s.whatsapp.net')
        if (resultado && !contacto) continue
      }
      const buf = Buffer.from(base64, 'base64')
      await sock.sendMessage(jid, { image: buf, caption, mimetype })
    } catch (err) {
      console.warn(`[notif] Error enviando foto a empleado ${num} (JID: ${jid}):`, err)
    }
  }
}
