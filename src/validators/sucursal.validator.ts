import { parseSucursal } from '../parser/sucursal.parser'

export interface SucursalInfo {
  sucursal: string | null
  confianza: 'alta' | 'media' | 'ninguna'
  direccion: string
  horario: string
}

// N12: cada sucursal/zona ahora es distinguible. Maps verificados desde
// prompt.builder.ts (buildValidatedRulesSection). Las direcciones de Sur y
// Tlaxcala están pendientes de confirmación con el negocio — usan el
// placeholder de la matriz hasta que se configuren las reales.
export const SUCURSALES_INFO: Record<string, SucursalInfo> = {
  'Norte': { sucursal: 'Norte', confianza: 'alta', direccion: 'Sucursal Norte, Apizaco — https://maps.app.goo.gl/DeQdJJ3wp1zfhRU98', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Centro': { sucursal: 'Centro', confianza: 'alta', direccion: 'Av. Hidalgo 12, Apizaco Centro — https://maps.app.goo.gl/GN9yPJZZjQEyHFWXA', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Sur': { sucursal: 'Sur', confianza: 'alta', direccion: 'Zona Sur, Apizaco (confirmar dirección exacta con el equipo)', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Apizaco': { sucursal: 'Apizaco', confianza: 'alta', direccion: 'Av. Hidalgo 12, Apizaco Centro — https://maps.app.goo.gl/GN9yPJZZjQEyHFWXA', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Tlaxcala': { sucursal: 'Tlaxcala', confianza: 'alta', direccion: 'Sucursal Tlaxcala (confirmar dirección exacta con el equipo)', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
}

export function validarSucursal(texto: string): SucursalInfo {
  const parsed = parseSucursal(texto)
  if ((parsed.confianza === 'alta' || parsed.confianza === 'media') && parsed.sucursal) {
    return SUCURSALES_INFO[parsed.sucursal] ?? {
      sucursal: parsed.sucursal, confianza: parsed.confianza,
      direccion: 'Av. Hidalgo 12, Apizaco Centro',
      horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00',
    }
  }
  return { sucursal: null, confianza: parsed.confianza, direccion: '', horario: '' }
}

export function obtenerTextoConfirmacionSucursal(info: SucursalInfo): string {
  if (!info.sucursal) return ''
  if (info.confianza === 'media') {
    return `El cliente mencionó la sucursal ${info.sucursal}. Confirma con él antes de cerrar.`
  }
  return `Confirma dirección: ${info.direccion}. Horario: ${info.horario}.`
}

const REGEX_RECOGER = /\b(recoger|recojo|paso|pasare|pasar[eé]|sucursal|local|tienda|voy|ir|llego|llegar|norte|centro|sur|apizaco)\b/i

export function clienteQuiereRecoger(texto: string): boolean {
  return REGEX_RECOGER.test(texto)
}
