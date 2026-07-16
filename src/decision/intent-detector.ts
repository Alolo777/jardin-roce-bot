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

const KW_EVENTOS = [
  'boda', 'casamiento', 'me caso', 'me voy a casar',
  'xv años', 'quinceañera', 'quince años', 'xv',
  'funeral', 'velorio', 'falleció', 'fallecio', 'muerte', 'luto',
  'aniversario', 'graduación', 'graduacion', 'baby shower',
  'san valentín', 'san valentin', '14 de febrero', '10 de mayo',
  'día de las madres', 'dia de las madres',
]

const KW_INTERES_COMPRA = [
  'necesito', 'necesito un', 'busco', 'busco un', 'quiero un', 'quisiera',
  'me gustaría', 'me gustaria', 'anda tener', 'se ocupa',
  'qué flores', 'que flores', 'flores tiene', 'tienes disponibles',
  'flores disponibles', 'qué ramos', 'que ramos', 'qué arreglos',
  'me puede', 'pueden hacer', 'hacen arreglos', 'armar un',
  'ramo para', 'arreglo para', 'flor para',
  'cotización de', 'cotizacion de',
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

export function detectarEvento(texto: string): string | null {
  const matched = KW_EVENTOS.find(k => normalizar(texto).includes(k))
  return matched || null
}

export function detectarInteresCompra(texto: string): boolean {
  return KW_INTERES_COMPRA.some(k => normalizar(texto).includes(k))
}
