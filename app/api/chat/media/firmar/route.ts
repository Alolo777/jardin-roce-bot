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
import { telefonoADigitos } from '@/lib/chat-dashboard'

// Genera una URL firmada para que el navegador suba el archivo DIRECTO a
// Storage sin pasar por Vercel (límite 4.5MB por request). El bot lo recoge
// con service_role. Límites: imagen 5MB, audio 8MB, documento 10MB.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const telefono = String(body.telefono ?? '')
    const mimetype = String(body.mimetype || 'application/octet-stream').split(';')[0].trim()
    const size = Number(body.size) || 0
    const nombreOriginal = String(body.nombre || 'archivo').slice(0, 120)

    const tipo: TipoMediaChat = tipoDesdeMime(mimetype) ?? 'documento'
    const tipoFinal: TipoMediaChat =
      tipo === 'imagen' && !mimetype.startsWith('image/') ? 'documento' : tipo

    if (size <= 0) {
      return NextResponse.json({ error: 'Archivo vacío' }, { status: 400 })
    }
    if (size > MAX_BYTES_MEDIA[tipoFinal]) {
      const mb = Math.round(MAX_BYTES_MEDIA[tipoFinal] / (1024 * 1024))
      return NextResponse.json(
        { error: `El archivo excede ${mb}MB` },
        { status: 400 }
      )
    }

    const ext = extensionPara(mimetype, nombreOriginal.split('.').pop() || 'bin')
    const path = rutaMedia(telefonoADigitos(telefono), randomUUID(), ext)

    const { data, error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(path)
    if (error) {
      if (/bucket.*not found|not found.*bucket/i.test(error.message)) {
        return NextResponse.json(
          { error: 'Falta crear el almacenamiento: corre la migración SQL en Supabase (sección 5, bucket whatsapp-media).' },
          { status: 500 }
        )
      }
      throw error
    }

    return NextResponse.json({
      ok: true,
      path,
      signedUrl: data.signedUrl,
      mimetype,
      nombre: nombreOriginal,
      size,
      tipo: tipoFinal,
    })
  } catch (err) {
    console.error('[API /chat/media/firmar POST]', err)
    return NextResponse.json(
      { error: 'No se pudo preparar la subida' },
      { status: 500 }
    )
  }
}
