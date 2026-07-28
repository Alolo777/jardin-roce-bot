const KW_CANCELACION = [
  'cancelar', 'cancela', 'cancelación', 'cancelacion', 'ya no quiero',
  'quiero cancelar', 'mejor ya no', 'ya no lo quiero', 'cancel',
  'quiero revertir', 'reversar',
]

const KW_QUEJA = [
  'queja', 'reclamo', 'producto dañado', 'llegó mal', 'llegó roto',
  'flores marchitas', 'flores feas', 'no es lo que pedí', 'pedido incorrecto',
  'devolución', 'devolucion', 'reembolso', 'me cobraron mal',
  'no llegó', 'no llego', 'pedido incompleto',
]

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function detectarCancelacion(texto: string): boolean {
  return KW_CANCELACION.some(k => normalizar(texto).includes(k))
}

export function detectarQueja(texto: string): boolean {
  return KW_QUEJA.some(k => normalizar(texto).includes(k))
}

export { detectarEvento, detectarInteresCompra } from './decision.engine'