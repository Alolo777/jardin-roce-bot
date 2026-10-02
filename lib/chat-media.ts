// lib/chat-media.ts — Constantes compartidas de medios del inbox WhatsApp
//
// Tipos soportados en el timeline (ver y enviar):
//   imagen   → fotos (jpg/png/webp)
//   audio    → notas de voz (ogg opus / webm)
//   documento → archivos (pdf/doc/xls/txt...)
// El video y stickers quedan fuera de v1 (comportamiento actual del bot).

export const MEDIA_BUCKET = 'whatsapp-media'

export type TipoMediaChat = 'imagen' | 'audio' | 'documento'
export type TipoOutbox = 'texto' | TipoMediaChat

export const MAX_BYTES_MEDIA: Record<TipoMediaChat, number> = {
  imagen: 5 * 1024 * 1024,
  audio: 8 * 1024 * 1024,
  documento: 10 * 1024 * 1024,
}

// Límite duro en el bot al descargar (recepción o envío), por memoria de la VM.
export const MAX_BYTES_BOT = 12 * 1024 * 1024

const EXT_POR_MIME: Array<[RegExp, string]> = [
  [/^image\/jpeg$/, 'jpg'],
  [/^image\/png$/, 'png'],
  [/^image\/webp$/, 'webp'],
  [/^image\/gif$/, 'gif'],
  [/^audio\/ogg/, 'ogg'],
  [/^audio\/webm/, 'webm'],
  [/^audio\/mpeg$/, 'mp3'],
  [/^audio\/mp4/, 'm4a'],
  [/^application\/pdf$/, 'pdf'],
  [/^text\/plain$/, 'txt'],
  [/^application\/msword$/, 'doc'],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, 'docx'],
  [/^application\/vnd\.ms-excel$/, 'xls'],
  [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/, 'xlsx'],
]

export function extensionPara(mimetype: string, fallback = 'bin'): string {
  const mime = String(mimetype ?? '').split(';')[0].trim().toLowerCase()
  for (const [re, ext] of EXT_POR_MIME) {
    if (re.test(mime)) return ext
  }
  return fallback
}

export function tipoDesdeMime(mimetype: string): TipoMediaChat | null {
  const mime = String(mimetype ?? '').split(';')[0].trim().toLowerCase()
  if (mime.startsWith('image/')) return 'imagen'
  if (mime.startsWith('audio/')) return 'audio'
  return 'documento'
}

export function esTipoOutbox(v: unknown): v is TipoOutbox {
  return v === 'texto' || v === 'imagen' || v === 'audio' || v === 'documento'
}

// Texto legible para el timeline (y para el contexto que lee Flora).
export function marcadorMedia(
  tipo: TipoMediaChat,
  nombre?: string | null,
  duracionSeg?: number | null
): string {
  if (tipo === 'imagen') return '[Foto]'
  if (tipo === 'audio') {
    if (duracionSeg && Number.isFinite(duracionSeg) && duracionSeg > 0) {
      const m = Math.floor(duracionSeg / 60)
      const s = Math.round(duracionSeg % 60)
      return `[Nota de voz · ${m}:${String(s).padStart(2, '0')}]`
    }
    return '[Nota de voz]'
  }
  const base = String(nombre ?? '').trim().slice(0, 60)
  return base ? `[Archivo: ${base}]` : '[Archivo]'
}

export function etiquetaPreview(tipo: TipoMediaChat, caption?: string | null): string {
  const icono = tipo === 'imagen' ? '📷 Foto' : tipo === 'audio' ? '🎤 Nota de voz' : '📄 Archivo'
  const cap = String(caption ?? '').trim().slice(0, 60)
  return cap ? `${icono} · ${cap}` : icono
}

// Ruta saneada dentro del bucket: inbox/<digitos>/<uuid>.<ext>
export function rutaMedia(digitos: string, uuid: string, ext: string): string {
  const d = String(digitos ?? '').replace(/\D/g, '').slice(-15) || 'sin-numero'
  const id = String(uuid ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'archivo'
  const e = String(ext ?? 'bin').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'bin'
  return `inbox/${d}/${id}.${e}`
}

export function esRutaMediaValida(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return false
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false
  return /^[A-Za-z0-9/_.-]+$/.test(path)
}
