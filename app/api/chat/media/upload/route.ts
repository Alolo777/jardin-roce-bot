import { NextResponse, NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  MEDIA_BUCKET,
  MAX_BYTES_MEDIA,
  extensionPara,
  tipoDesdeMime,
  rutaMedia,
  type TipoMediaChat,
} from '@/lib/chat-media'
import { comprimirImagen } from '@/lib/comprimir-imagen'
import { telefonoADigitos } from '@/lib/chat-dashboard'

// Sube un adjunto del equipo (foto, nota de voz, archivo) al bucket privado.
// Devuelve el path para usarlo en /api/chat/enviar { tipo, media_path }.
// Límites: imagen 5MB, audio 8MB, documento 10MB.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    const telefono = String(form?.get('telefono') ?? '')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Archivo vacío o ausente' }, { status: 400 })
    }

    const mimetype = (file.type || 'application/octet-stream').split(';')[0].trim()
    const tipo: TipoMediaChat = tipoDesdeMime(mimetype) ?? 'documento'
    // Solo imágenes y audios como tal; lo demás entra como documento.
    const tipoFinal: TipoMediaChat =
      tipo === 'imagen' && !mimetype.startsWith('image/') ? 'documento' : tipo

    if (file.size > MAX_BYTES_MEDIA[tipoFinal]) {
      const mb = Math.round(MAX_BYTES_MEDIA[tipoFinal] / (1024 * 1024))
      return NextResponse.json(
        { error: `El archivo excede ${mb}MB` },
        { status: 400 }
      )
    }

    const nombreOriginal = String((file as any).name || 'archivo').slice(0, 120)
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer())
    let mimeFinal = mimetype
    let ext = extensionPara(mimetype, nombreOriginal.split('.').pop() || 'bin')

    // Comprimir fotos antes de subir (audios/docs pasan tal cual).
    if (tipoFinal === 'imagen') {
      const comprimida = await comprimirImagen(bytes, mimetype)
      if (comprimida) {
        bytes = comprimida.buffer
        mimeFinal = comprimida.mimetype
        ext = 'jpg'
      }
    }

    const path = rutaMedia(telefonoADigitos(telefono), randomUUID(), ext)

    const { error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .upload(path, bytes, { contentType: mimeFinal, upsert: false })
    if (error) throw error

    return NextResponse.json({
      ok: true,
      path,
      mimetype: mimeFinal,
      nombre: nombreOriginal,
      size: bytes.length,
      tipo: tipoFinal,
    })
  } catch (err) {
    console.error('[API /chat/media/upload POST]', err)
    return NextResponse.json(
      { error: 'No se pudo subir el archivo' },
      { status: 500 }
    )
  }
}
