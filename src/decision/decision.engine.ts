import { Intencion, TipoCaso, Prioridad } from '../models/types'

export interface Decision {
  intencion: Intencion
  tipoCaso: TipoCaso
  prioridad: Prioridad
  requiereHumano: boolean
  requierePedido: boolean
  esCambioTema: boolean
  contextoAdicional: string
  esFrustracion: boolean
  razonHumano: string | null
  esConfirmacionCorta: boolean
  esEmpezarCero: boolean
  solicitaFotos: boolean
  seleccionoFoto: boolean
  requiereComprobante: boolean
  pideComprobante: boolean
  esWebPedido: boolean
  eventoDetectado: string | null
  tieneInteresCompra: boolean
  intencionCatalogo: 'catalogo' | 'cotizador' | 'normal'
}

interface DatosAnalisis {
  texto: string
  horasInactivo: number
}

function tienePalabra(texto: string, patron: RegExp): boolean {
  return patron.test(texto)
}

function normalizar(texto: string): string {
  return texto.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

// ══════════════════════════════════════════════════════════════════
// DETECTORES EXPANDIDOS — FASE 6
// ══════════════════════════════════════════════════════════════════

const KW_FRUSTRACION = [
  'que show', 'qué show', 'no me ayudas', 'no sirves', 'pesimo', 'pésimo',
  'mal servicio', 'molesta', 'molesto', 'enojada', 'enojado', 'horrible',
  'no entiendes', 'quiero hablar con una persona', 'quiero hablar con alguien',
  'con un humano', 'inutil', 'inútil', 'no funciona', 'tardas mucho',
  'cuando me van a contestar', 'tardaste mucho', 'porque tardaste',
]

export function detectarFrustracion(texto: string): boolean {
  const n = normalizar(texto)
  return KW_FRUSTRACION.some(k => n.includes(k))
}

const GOOGLE_MAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s]*/i

export function detectarAtencionHumana(texto: string): string | null {
  const n = normalizar(texto)
  if (GOOGLE_MAPS_REGEX.test(texto) && /\b(direccion|ubicacion|colonia|calle)\b/i.test(n)) return null
  const reglas: Array<[RegExp, string]> = [
    [/\b(recoger|recojo|pasar por|paso por|recogi|recog[ií]|voy por|vengo por)\b.*\b(ramo|pedido|arreglo|flores?)\b|\b(ramo|pedido|arreglo|flores?)\b.*\b(recoger|recojo|pasar por|paso por|recogi|recog[ií]|voy por|vengo por)\b/i, 'Cliente quiere recoger un pedido'],
    [/\b(sucursal|local|ubicacion|ubicación|direccion|dirección|atah)\b/i, 'Cliente pide información de sucursal/local'],
    [/\b(foto|imagen)\b.*\b(local|sucursal|fachada|entrada|tienda)\b|\b(local|sucursal|fachada|entrada|tienda)\b.*\b(foto|imagen)\b/i, 'Cliente pide foto del local'],
    [/\b(instagram|facebook|dm|inbox|mensaje por insta)\b/i, 'Cliente menciona conversación en redes sociales'],
    [/\b(hable|hablar|comunicarme)\b.*\b(persona|humano|encargad[ao]|asesor)\b/i, 'Cliente solicita atención humana'],
  ]
  return reglas.find(([regex]) => regex.test(n))?.[1] ?? null
}

export function esSolicitudFotosDisponibles(texto: string): boolean {
  return /\b(fotos?|ver.*arregl|muestra|enseña|manda.*foto|averlos|verlos|qu[eé].*(?:ramos?|ramitos?|arreglos?|flores?).*tiene(?:n)?|qu[eé]\s+tiene(?:n)?\s+disponible|hay.*foto|puedo.*ver|quisiera.*ver|ramitos?.*disponibles?|ramos?.*disponibles?|arreglos?.*disponibles?|disponibles?\s+hoy)\b/i.test(texto)
}

export function clienteEligeFotoDisponible(texto: string): boolean {
  return /\b(me\s+gust[oó]|me\s+interesa|quiero|quisiera|ap[aá]rtame|apartame|apartarlo|este|esta|ese|esa|el\s+de\s+la\s+foto|la\s+de\s+la\s+foto|qu[eé]\s+precio|cu[aá]nto|cuanto)\b/i.test(texto)
}

export function detectarConfirmacionCorta(texto: string): boolean {
  return /^(ok|okay|okey|oki|okis|vale|va|dale|s[ií]|si|perfecto|de acuerdo|esta bien|está bien)$/i.test(texto.trim())
}

export function detectarEmpezarCero(texto: string): boolean {
  return /empecemos\s+desde\s+cero|desde\s+cero|borr[oó]n\s+y\s+cuenta\s+nueva|nuevo\s+pedido|otro\s+pedido|otro\s+ramo|es\s+aparte|aparte\s+ese|ya\s+hab[ií]a\s+finalizado|ya\s+se\s+finaliz[oó]|ese\s+ya\s+qued[oó]/i.test(texto)
}

export function esTextoComprobante(texto: string): boolean {
  return /\b(comprobante|ya\s*pag[uú]e|pagado|pago\s*hecho|ya\s*qued[oó]|ya\s*transfer[ií]|transfer[ií]|transferencia|dep[oó]sito|recibo|ticket|bbva|devi\s+america|devi\s+am[eé]rica|4152)\b/i.test(texto)
}

export function respuestaPideComprobante(texto: string): boolean {
  return /(?:bbva|4152|devi\s+am[eé]rica|m[aá]ndame\s+(?:tu\s+)?comprobante|comprobante\s+cuando\s+est[eé]\s+listo|pon\s+tu\s+nombre\s+en\s+concepto)/i.test(texto)
}

export function detectarWebPedido(texto: string): boolean {
  return /^NUEVO PEDIDO[\s\S]*Florería RoCé[\s\S]*TOTAL A COBRAR[\s\S]*MXN[\s\S]*Flores del arreglo/i.test(texto)
}

export function detectarEvento(texto: string): string | null {
  const KW_EVENTOS = [
    'boda', 'casamiento', 'me caso', 'me voy a casar',
    'xv años', 'quinceañera', 'quince años', 'xv',
    'funeral', 'velorio', 'falleció', 'fallecio', 'muerte', 'luto',
    'aniversario', 'graduación', 'graduacion', 'baby shower',
    'san valentín', 'san valentin', '14 de febrero', '10 de mayo',
    'día de las madres', 'dia de las madres',
  ]
  const matched = KW_EVENTOS.find(k => normalizar(texto).includes(k))
  return matched || null
}

export function detectarInteresCompra(texto: string): boolean {
  const KW_INTERES_COMPRA = [
    'necesito', 'necesito un', 'busco', 'busco un', 'quiero un', 'quisiera',
    'me gustaría', 'me gustaria', 'anda tener', 'se ocupa',
    'qué flores', 'que flores', 'flores tiene', 'tienes disponibles',
    'flores disponibles', 'qué ramos', 'que ramos', 'qué arreglos',
    'me puede', 'pueden hacer', 'hacen arreglos', 'armar un',
    'ramo para', 'arreglo para', 'flor para',
    'cotización de', 'cotizacion de',
  ]
  return KW_INTERES_COMPRA.some(k => normalizar(texto).includes(k))
}

function detectarIntencionCatalogo(texto: string, decision: Decision): 'catalogo' | 'cotizador' | 'normal' {
  if (decision.intencion === Intencion.CATALOGO || decision.intencion === Intencion.FOTOS) return 'catalogo'
  if (decision.intencion === Intencion.COTIZACION || decision.intencion === Intencion.PERSONALIZADO) return 'cotizador'
  return 'normal'
}

export function analizarIntencion(datos: DatosAnalisis): Decision {
  const intencion = detectarIntencion(datos.texto)
  const tipoCaso = mapearTipoCaso(intencion)
  const prioridad = clasificarPrioridad(intencion, datos.texto)
  const requiereHumano = detectarHumano(intencion, datos.texto)
  const esCambioTema = detectarCambioTema(datos.texto, datos.horasInactivo)
  const requierePedido = intencion === Intencion.PEDIDO || intencion === Intencion.PAGO
  const razonHumano = detectarAtencionHumana(datos.texto) || (requiereHumano ? 'Cliente requiere atención humana' : null)

  const esFrustracion = detectarFrustracion(datos.texto)
  const esConfirmacionCorta = detectarConfirmacionCorta(datos.texto)
  const esEmpezarCero = detectarEmpezarCero(datos.texto)
  const esWebPedido = detectarWebPedido(datos.texto)
  const solicitaFotos = esSolicitudFotosDisponibles(datos.texto)
  const eventoDetectado = detectarEvento(datos.texto)
  const tieneInteresCompra = detectarInteresCompra(datos.texto)

  const partes: string[] = []
  if (esCambioTema) partes.push('Posible cambio de tema')
  if (razonHumano) partes.push(razonHumano)
  if (requierePedido) partes.push('Requiere creación/modificación de pedido')
  if (esFrustracion) partes.push('Cliente frustrado')
  if (eventoDetectado) partes.push(`Evento: ${eventoDetectado}`)
  if (tieneInteresCompra) partes.push('Muestra interés de compra')
  if (prioridad === Prioridad.CRITICA || prioridad === Prioridad.ALTA) partes.push(`Prioridad ${prioridad}`)

  const decision: Decision = {
    intencion,
    tipoCaso,
    prioridad,
    requiereHumano,
    requierePedido,
    esCambioTema,
    contextoAdicional: partes.length > 0 ? partes.join(' | ') : '',
    esFrustracion,
    razonHumano,
    esConfirmacionCorta,
    esEmpezarCero,
    solicitaFotos,
    seleccionoFoto: false,
    requiereComprobante: false,
    pideComprobante: respuestaPideComprobante(datos.texto),
    esWebPedido,
    eventoDetectado,
    tieneInteresCompra,
    intencionCatalogo: 'normal',
  }

  decision.intencionCatalogo = detectarIntencionCatalogo(datos.texto, decision)
  decision.seleccionoFoto = clienteEligeFotoDisponible(datos.texto)

  return decision
}