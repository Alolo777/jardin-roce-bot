import { parseDireccion } from '../parser/direccion.parser'
import { normalizarTexto } from '../conversation/conversation.service'
import { supabaseAdmin } from '../../lib/supabase'

interface ZonaEnvioData {
  zona: string
  precio: number
  palabras_clave: string
}

interface MunicipioEnvio {
  municipio: string
  codigo_postal: string
  colonia: string | null
  zona: string
  precio_envio: number
}

type ResultadoEnvio =
  | { zona: string; precio: number; fuente: string; ambiguo?: false }
  | { ambiguo: true; candidatos: { zona: string; precio: number; fuente: string }[] }
  | null

let cacheMunicipios: MunicipioEnvio[] | null = null
let cacheZonas: ZonaEnvioData[] | null = null
let cacheMunicipiosTs = 0
let cacheZonasTs = 0
const CACHE_TTL = 120_000

async function obtenerMunicipiosEnvio(): Promise<MunicipioEnvio[]> {
  if (cacheMunicipios && Date.now() - cacheMunicipiosTs < CACHE_TTL) return cacheMunicipios
  const { data } = await supabaseAdmin.from('municipios_envio').select('*').order('municipio', { ascending: true })
  cacheMunicipios = data ?? []
  cacheMunicipiosTs = Date.now()
  return cacheMunicipios
}

async function obtenerZonasEnvio(): Promise<ZonaEnvioData[]> {
  if (cacheZonas && Date.now() - cacheZonasTs < CACHE_TTL) return cacheZonas
  const { data } = await supabaseAdmin.from('zonas_envio').select('id, zona, precio, palabras_clave').order('precio', { ascending: true })
  cacheZonas = data ?? []
  cacheZonasTs = Date.now()
  return cacheZonas
}

export async function limpiarCacheEnvio(): Promise<void> {
  cacheMunicipios = null
  cacheZonas = null
  cacheMunicipiosTs = 0
  cacheZonasTs = 0
}

function contieneFrase(texto: string, frase: string): boolean {
  return new RegExp(`\\b${frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(texto)
}

const GOOGLE_MAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)[^\s]*/i
const COORDS_REGEX = /@(-?\d+\.\d+),(-?\d+\.\d+)/

export function detectarLinkMaps(texto: string): boolean {
  return GOOGLE_MAPS_REGEX.test(texto) || COORDS_REGEX.test(texto)
}

const REGEX_MENCIONA_ENVIO = /\b(env[ií]o|env[ií]ar|domicilio|entrega|mandar|llevar|reparto)\b/i

export function clienteMencionaEnvio(texto: string): boolean {
  return REGEX_MENCIONA_ENVIO.test(texto)
}

export function clienteDaDireccion(texto: string): boolean {
  const parsed = parseDireccion(texto)
  return parsed.confianza !== 'ninguna'
}

export function pareceConsultaEnvio(texto: string): boolean {
  return clienteMencionaEnvio(texto) || clienteDaDireccion(texto) || detectarLinkMaps(texto)
}

export async function buscarEnvio(texto: string): Promise<ResultadoEnvio> {
  const textoSinMaps = texto.replace(GOOGLE_MAPS_REGEX, '').replace(/\s+/g, ' ').trim()
  const n = normalizarTexto(textoSinMaps || texto)
  const tieneDatoDireccion = parseDireccion(texto).confianza !== 'ninguna'
  const esLinkMaps = detectarLinkMaps(texto)

  if (esLinkMaps && !textoSinMaps) {
    return null
  }

  const municipios = await obtenerMunicipiosEnvio()
  if (municipios.length > 0) {
    const candidatos = municipios
      .map(m => {
        const nomMunicipio = normalizarTexto(m.municipio)
        const nomColonia = normalizarTexto(m.colonia ?? '')
        const cp = m.codigo_postal.trim()
        let score = 0
        if (cp && n.includes(cp)) score += 200
        if (contieneFrase(n, nomMunicipio) || n.includes(nomMunicipio)) score += 120 + nomMunicipio.length
        if (nomColonia && (contieneFrase(n, nomColonia) || n.includes(nomColonia))) {
          score += nomColonia.length <= 7 ? 35 : 70 + nomColonia.length
        }
        return { municipio: m, score }
      })
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)

    const mejor = candidatos[0]
    const segundo = candidatos[1]
    if (mejor) {
      const match = mejor.municipio
      const esMatchFuerte = mejor.score >= 180 || tieneDatoDireccion
      const ambiguo = !!segundo && Math.abs(mejor.score - segundo.score) < 10
      if (!esMatchFuerte || ambiguo) {
        return {
          ambiguo: true,
          candidatos: candidatos.slice(0, 5).map(c => ({ zona: c.municipio.zona, precio: c.municipio.precio_envio, fuente: 'municipios' })),
        }
      }
      return { zona: match.zona, precio: match.precio_envio, fuente: 'municipios' }
    }
  }

  const zonas = await obtenerZonasEnvio()
  if (zonas.length > 0) {
    const zonaMatch = zonas.find(z =>
      z.palabras_clave.split(',').some(p => {
        const palabra = normalizarTexto(p.trim())
        return palabra && contieneFrase(n, palabra)
      })
    )
    if (zonaMatch && tieneDatoDireccion) return { zona: zonaMatch.zona, precio: zonaMatch.precio, fuente: 'zonas' }
  }

  return null
}

export function limpiarDireccionCliente(texto: string): string {
  return texto
    .replace(GOOGLE_MAPS_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export function formatearZonasParaPrompt(zonas: ZonaEnvioData[]): string {
  if (!zonas.length) return ''
  return zonas.map(z => `- ${z.zona}: $${z.precio.toFixed(2)} MXN (${z.palabras_clave})`).join('\n')
}
