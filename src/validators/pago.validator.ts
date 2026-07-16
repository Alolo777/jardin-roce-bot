export interface CuentaBancaria {
  banco: string
  numero: string
  titular: string
  clabe?: string
}

export const CUENTA_BBVA: CuentaBancaria = {
  banco: 'BBVA',
  numero: '4152314097305273',
  titular: 'Devi América Cerenil',
}

export function obtenerTextoCuenta(): string {
  return `BBVA | ${CUENTA_BBVA.numero} | ${CUENTA_BBVA.titular}`
}

const REGEX_COMPROBANTE = /\b(comprobante|ya\s*pag[uú]e|pagado|pago\s*hecho|ya\s*qued[oó]|ya\s*transfer[ií]|transfer[ií]|transferencia|dep[oó]sito|recibo|ticket|bbva|devi\s+america|devi\s+am[eé]rica|4152)\b/i

const REGEX_CUENTA_COMPARTIDA = /(?:bbva|4152|devi\s+am[eé]rica|m[aá]ndame\s+(?:tu\s+)?comprobante|comprobante\s+cuando\s+est[eé]\s+listo|pon\s+tu\s+nombre\s+en\s+concepto)/i

const REGEX_PAGO_EFECTIVO_TARJETA = /\b(efectivo|tarjeta)\b/i
const REGEX_RECOGER = /\b(recoger|pasar[ií]a|pasaria|paso|sucursal|norte|centro)\b/i

export function esTextoComprobante(texto: string): boolean {
  return REGEX_COMPROBANTE.test(texto)
}

export function esCuentaYaCompartida(texto: string): boolean {
  return REGEX_CUENTA_COMPARTIDA.test(texto)
}

export function esPagoEfectivoAlRecoger(texto: string): boolean {
  return REGEX_PAGO_EFECTIVO_TARJETA.test(texto) && REGEX_RECOGER.test(texto)
}

export interface InstruccionPago {
  tipo: 'transferencia' | 'efectivo_sucursal' | 'pendiente'
  texto: string
  compartirCuenta: boolean
}

export function determinarInstruccionPago(paraDomicilio: boolean, textoCliente: string): InstruccionPago {
  if (paraDomicilio) {
    return {
      tipo: 'transferencia',
      texto: `Realiza tu pago a:\n${obtenerTextoCuenta()}\n\nEnvía tu comprobante por este chat para agilizar.`,
      compartirCuenta: true,
    }
  }

  if (esPagoEfectivoAlRecoger(textoCliente)) {
    return {
      tipo: 'efectivo_sucursal',
      texto: 'Puedes pagar en efectivo o tarjeta al recoger en sucursal.',
      compartirCuenta: false,
    }
  }

  return {
    tipo: 'pendiente',
    texto: obtenerTextoCuenta(),
    compartirCuenta: true,
  }
}

const REGEX_PEDIR_CUENTA = /\b(pasame|p[aá]same|cuenta|bbva|transferir|para\s+pagar|d[oó]nde\s+pago|c[oó]mo\s+pago|numero\s+de\s+cuenta|n[uú]mero\s+de\s+cuenta)\b/i

export function clientePideCuenta(texto: string): boolean {
  return REGEX_PEDIR_CUENTA.test(texto)
}
