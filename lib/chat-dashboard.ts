// lib/chat-dashboard.ts — Helpers compartidos de la pestaña WhatsApp
//
// Usado por:
//   - src/whatsapp/outbox-poller.ts (bot en la VM)
//   - app/api/chat/*/route.ts (dashboard en Vercel)
//
// No contiene lógica de negocio del bot, solo normalización de teléfonos
// y constantes del canal dashboard → outbox → WhatsApp.

import { supabaseAdmin } from './supabase'
import { variantesTelefono } from '../src/conversation/conversation.service'

// Descripción que identifica en `numeros_ignorados` las pausas creadas
// desde el dashboard (toma humana por chat). El bot ya filtra esos
// números en message-entry.ts sin necesidad de cambios.
export const TOMA_HUMANA_DESCRIPCION = 'Toma humana desde dashboard'

// Límite de texto por mensaje (igual que el tope del bot: 1000 chars).
export const MAX_TEXTO_OUTBOX = 1000

export function telefonoADigitos(telefono: string): string {
  return String(telefono ?? '').replace(/\D/g, '')
}

export function ultimos10(telefono: string): string {
  return telefonoADigitos(telefono).slice(-10)
}

// Resuelve el teléfono canónico guardado en `clientes.telefono`
// (formato +52.../+521...) tolerando variantes MX 52/521.
// Si no existe, devuelve `+<digitos>` para no romper el flujo.
export async function resolverTelefonoCanonical(telefono: string): Promise<string> {
  const digitos = telefonoADigitos(telefono)
  if (!digitos) return telefono
  const candidatos = variantesTelefono(digitos).map((v) => `+${v}`)
  try {
    const { data } = await supabaseAdmin
      .from('clientes')
      .select('telefono')
      .in('telefono', candidatos)
      .limit(1)
    if (data?.[0]?.telefono) return data[0].telefono as string
  } catch {
    // fallback silencioso: usar dígitos con +
  }
  return `+${digitos}`
}
