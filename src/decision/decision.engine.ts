import { Intencion, TipoCaso, Prioridad } from '../../models/types'

export interface Decision {
  intencion: Intencion
  tipoCaso: TipoCaso
  prioridad: Prioridad
  requiereHumano: boolean
  requierePedido: boolean
  esCambioTema: boolean
  contextoAdicional: string
}

interface DatosAnalisis {
  texto: string
  horasInactivo: number
}

function tienePalabra(texto: string, patron: RegExp): boolean {
  return patron.test(texto)
}

function detectarIntencion(texto: string): Intencion {
  const t = texto.toLowerCase().trim()

  if (/^(hola|buenas|buen[asd]|hey|oye|buenos\s+d[ií]as|buenas\stardes|buenas\snoches|qu[eé]\s+tal|c[oó]mo\s+est[áa]s|hello|hi)\b/i.test(t)) {
    return Intencion.SALUDO
  }
  if (/^(gracias|thank|bye|adi[oó]s|nos\s+vemos|hasta\sluego|chao|ciao|que\stengas|saludos|cuidate|cuídese)\b/i.test(t)) {
    return Intencion.DESPEDIDA
  }
  if (/\b(cat[aá]logo|cat[áa]logo|ver\s+productos|qu[eé]\s+tienen|qu[eé]\s+venden|mu[eé]strame|enseñame|enseñame|averlos|verlos|ver\s+arreglos|fotos\s+de\s+arreglos)\b/i.test(t)) {
    return Intencion.CATALOGO
  }
  if (/\b(foto|fotico|imagen|ver\s+fotos|mand[ae]r\s+fotos|env[ií]a\s+fotos|mu[eé]stra|manda\s+imagen)\b/i.test(t)) {
    return Intencion.FOTOS
  }
  if (/\b(cu[aá]nto\s+(cuesta|sale|vale|est[aá])|precio|saldr[ií]a|costar[ií]a|qu[eé]\s+precio|en\s+cu[aá]nto|qu[eé]\s+tan|precios|valor)\b/i.test(t)) {
    return Intencion.PRECIO
  }
  if (/\b(cotiza|cotizar|cotizaci[oó]n|personalizado|armar\s+un\s+ramo|quiero\s+un\s+ramo|quisiera\s+un|me\s+gustar[ií]a|hacer\s+un|como\s+(este|esa|esa\s+foto|la\s+foto|la\s+imagen)|referencia|parecido)\b/i.test(t)) {
    return Intencion.COTIZACION
  }
  if (/\b(lo\s+quiero|apart[ao]|reserva|me\s+interesa|necesito|lo\s+necesito|d[áa]mel[oó]|ese\s+me\s+gusta|ese\s+quiero|lo\s+encargo)\b/i.test(t)) {
    return Intencion.PEDIDO
  }
  if (/\b(pag[au]|transfer|comprobante|dep[oó]sito|bbva|4152|devi\s+america|recibo|ticket|ya\s+pag[ué]|ya\s+qued[oó]|ya\s+transfer[ií]|pagado)\b/i.test(t)) {
    return Intencion.PAGO
  }
  if (/\b(comprobante|ya\s+env[ií]e|ah[ií]\s+va|ah[ií]\s+est[aá]|ah[ií]\s+te\s+va|ah[ií]\s+te\s+env[ií]o)\b/i.test(t)) {
    return Intencion.COMPROBANTE
  }
  if (/\b(transfer|transferencia|cuen[td]a|banco|clabe|tarjeta)\b/i.test(t)) {
    return Intencion.TRANSFERENCIA
  }
  if (/\b(direcci[oó]n|ubicaci[oó]n|d[oó]nde\s+(est[áa]n|quedan|est[aá])|c[oó]mo\s+llegar|mapa|maps|google\s+maps)\b/i.test(t)) {
    return Intencion.UBICACION
  }
  if (/\b(horario|horarios|abren|cierran|a\s+qu[eé]\s+hora|cu[aá]ndo\s+abren|cu[aá]ndo\s+cierran|est[aá]n\s+abiertos|atienden)\b/i.test(t)) {
    return Intencion.HORARIOS
  }
  if (/\b(env[ií]o|env[ií]ar|domicilio|mandar|llevar|reparto|flete|a\s+casa)\b/i.test(t)) {
    return Intencion.ENVIO
  }
  if (/\b(recoger|recojo|paso|pasare|pasar[ée]|sucursal|voy|all[aá]|ah[ií])\b/i.test(t)) {
    return Intencion.RECOGER
  }
  if (/\b(cambi[oa]r|cambio|intercambiar|modificar|cambi[oó])\b/i.test(t)) {
    return Intencion.CAMBIO
  }
  if (/\b(cancel[ae]r|cancelaci[oó]n|anular|anulaci[oó]n|suspender|dejar\s+sin|ya\s+no\s+(quiero|lo\s+quiero|ocupo))\b/i.test(t)) {
    return Intencion.CANCELACION
  }
  if (/\b(queja|molest[ao]|reclamo|devoluci[oó]n|reembolso|mal|mala|p[eé]simo|p[eé]sima|p[ié]simo|p[ié]sima|incumplido|enojad[ao]|furios[ao]|fracaso|problema)\b/i.test(t)) {
    return Intencion.QUEJA
  }
  if (/\b(gerente|supervisor|humano|persona|agente|operador|ati[eé]ndame|quiero\s+hablar|p[aá]same\s+con|comun[ií]came|encargad[ao]|dueñ[ao])\b/i.test(t)) {
    return Intencion.HUMANO
  }
  if (/\b(gracias|qued[oó]|hermos[oa]|bell[oa]|precios[oa]|divin[oa]|espectacular|qu[eé]\s+bonito|encant[oó]|am[ée]|fascin[oó])\b/i.test(t)) {
    return Intencion.POSTVENTA
  }

  return Intencion.OTRO
}

function clasificarPrioridad(intencion: Intencion, texto: string): Prioridad {
  if (intencion === Intencion.QUEJA || intencion === Intencion.HUMANO) {
    if (tienePalabra(texto, /\b(enojad[ao]|furios[ao]|demanda|abogado|devoluci[oó]n|inmediato|urgente|ahorita|ya\s+mismo|reclamo|problema\s+grave)\b/i)) {
      return Prioridad.CRITICA
    }
    return Prioridad.ALTA
  }
  if (intencion === Intencion.CANCELACION) return Prioridad.ALTA
  if (intencion === Intencion.PAGO || intencion === Intencion.COMPROBANTE || intencion === Intencion.TRANSFERENCIA) {
    return Prioridad.ALTA
  }
  if (intencion === Intencion.PEDIDO || intencion === Intencion.COTIZACION) {
    return Prioridad.MEDIA
  }
  if (intencion === Intencion.ENVIO || intencion === Intencion.RECOGER || intencion === Intencion.PRECIO) {
    return Prioridad.MEDIA
  }
  return Prioridad.BAJA
}

function detectarHumano(intencion: Intencion, texto: string): boolean {
  if (intencion === Intencion.QUEJA) return true
  if (intencion === Intencion.HUMANO) return true
  if (intencion === Intencion.CANCELACION) return true
  if (tienePalabra(texto, /\b(reembolso|devoluci[oó]n|abogado|demanda|gerente|supervisor|dueñ[ao]|queja\s+formal)\b/i)) return true
  return false
}

function detectarCambioTema(texto: string, horasInactivo: number): boolean {
  if (horasInactivo >= 24) return true
  if (tienePalabra(texto, /\b(ahora\s+(quiero|necesito|ocupo)|otro\s+(pedido|ramo|arreglo|cosa|tema)|nuevo\s+(pedido|caso)|es\s+aparte|es\s+otro\s+pedido|empezamos\s+de\s+nuevo|desde\s+cero)\b/i)) return true
  return false
}

export function analizarIntencion(datos: DatosAnalisis): Decision {
  const intencion = detectarIntencion(datos.texto)
  const tipoCaso = mapearTipoCaso(intencion)
  const prioridad = clasificarPrioridad(intencion, datos.texto)
  const requiereHumano = detectarHumano(intencion, datos.texto)
  const esCambioTema = detectarCambioTema(datos.texto, datos.horasInactivo)
  const requierePedido = intencion === Intencion.PEDIDO || intencion === Intencion.PAGO

  const partes: string[] = []
  if (esCambioTema) partes.push('Posible cambio de tema')
  if (requiereHumano) partes.push('Requiere intervención humana')
  if (requierePedido) partes.push('Requiere creación/modificación de pedido')
  if (prioridad === Prioridad.CRITICA || prioridad === Prioridad.ALTA) partes.push(`Prioridad ${prioridad}`)

  return {
    intencion,
    tipoCaso,
    prioridad,
    requiereHumano,
    requierePedido,
    esCambioTema,
    contextoAdicional: partes.length > 0 ? partes.join(' | ') : '',
  }
}

function mapearTipoCaso(intencion: Intencion): TipoCaso {
  switch (intencion) {
    case Intencion.COTIZACION:
    case Intencion.PRECIO:
    case Intencion.CATALOGO:
    case Intencion.FOTOS:
    case Intencion.PERSONALIZADO:
      return TipoCaso.COTIZACION
    case Intencion.PEDIDO:
    case Intencion.PAGO:
    case Intencion.COMPROBANTE:
    case Intencion.TRANSFERENCIA:
    case Intencion.ENVIO:
    case Intencion.RECOGER:
    case Intencion.CAMBIO:
      return TipoCaso.PEDIDO
    case Intencion.QUEJA:
    case Intencion.CANCELACION:
      return TipoCaso.QUEJA
    case Intencion.POSTVENTA:
      return TipoCaso.POSTVENTA
    case Intencion.UBICACION:
    case Intencion.HORARIOS:
      return TipoCaso.INFORMACION
    case Intencion.HUMANO:
      return TipoCaso.DUDA
    default:
      return TipoCaso.DUDA
  }
}
