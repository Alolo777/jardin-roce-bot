import { parseSucursal } from '../../parser/sucursal.parser'

export interface SucursalInfo {
  sucursal: string | null
  confianza: 'alta' | 'baja' | 'ninguna'
  direccion: string
  horario: string
}

export const SUCURSALES_INFO: Record<string, SucursalInfo> = {
  'Norte': { sucursal: 'Norte', confianza: 'alta', direccion: 'Av. Hidalgo 12, Apizaco Centro', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Centro': { sucursal: 'Centro', confianza: 'alta', direccion: 'Av. Hidalgo 12, Apizaco Centro', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Sur': { sucursal: 'Sur', confianza: 'alta', direccion: 'Av. Hidalgo 12, Apizaco Centro', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
  'Apizaco': { sucursal: 'Apizaco', confianza: 'alta', direccion: 'Av. Hidalgo 12, Apizaco Centro', horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00' },
}

export function validarSucursal(texto: string): SucursalInfo {
  const parsed = parseSucursal(texto)
  if (parsed.confianza === 'alta' && parsed.sucursal) {
    return SUCURSALES_INFO[parsed.sucursal] ?? {
      sucursal: parsed.sucursal, confianza: 'alta',
      direccion: 'Av. Hidalgo 12, Apizaco Centro',
      horario: 'Lun-Sáb 10:00-19:00, Dom 10:00-17:00',
    }
  }
  return { sucursal: null, confianza: parsed.confianza, direccion: '', horario: '' }
}

export function obtenerTextoConfirmacionSucursal(info: SucursalInfo): string {
  if (info.confianza !== 'alta') return ''
  return `Confirma dirección: ${info.direccion}. Horario: ${info.horario}.`
}

const REGEX_RECOGER = /\b(recoger|recojo|paso|pasare|pasar[eé]|sucursal|local|tienda|voy|ir|llego|llegar|norte|centro|sur|apizaco)\b/i

export function clienteQuiereRecoger(texto: string): boolean {
  return REGEX_RECOGER.test(texto)
}
