export function limpiarTelefono(numero: string): string {
  return String(numero ?? '').replace(/\D/g, '')
}

export function formatearTelefono(numero: string): string {
  const limpio = limpiarTelefono(numero)
  if (limpio.length === 10) return `+52${limpio}`
  if (limpio.length > 10 && limpio.startsWith('52') && limpio.length <= 13) return `+${limpio}`
  if (limpio.length > 10 && limpio.startsWith('1') && limpio.length <= 13) return `+52${limpio.slice(1)}`
  if (limpio.length > 10 && !limpio.startsWith('52') && !limpio.startsWith('1')) return `+52${limpio}`
  return numero
}

export function ultimosDigitos(numero: string, n = 4): string {
  const limpio = limpiarTelefono(numero)
  return 'xxx' + limpio.slice(-n)
}

export function esLid(numero: string): boolean {
  return numero.includes('@lid') || limpiarTelefono(numero).length > 13
}
