// lib/comprimir-imagen.ts — Compresión de fotos del inbox
//
// Reduce fotos a máx 1280px por lado en JPEG calidad 72 (≈80-90% menos peso).
// Se usa al RECIBIR (bot/VM) y al SUBIR (dashboard/Vercel), así ambas
// direcciones quedan optimizadas. GIF se deja intacto (animación).
// Ante cualquier error devuelve null y el llamador guarda el original.

import sharp from 'sharp'

const MAX_LADO = 1280
const CALIDAD_JPEG = 72

export interface ImagenComprimida {
  buffer: Buffer
  mimetype: string
}

export async function comprimirImagen(
  entrada: Uint8Array,
  mimetype: string
): Promise<ImagenComprimida | null> {
  const mime = String(mimetype ?? '').split(';')[0].trim().toLowerCase()
  if (!mime.startsWith('image/') || mime === 'image/gif') return null
  try {
    const salida = await sharp(entrada)
      .rotate()
      .resize(MAX_LADO, MAX_LADO, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
      .toBuffer()
    // Si por algo quedó más pesada, conservar la original.
    if (salida.length >= entrada.length) return null
    return { buffer: salida, mimetype: 'image/jpeg' }
  } catch {
    return null
  }
}
