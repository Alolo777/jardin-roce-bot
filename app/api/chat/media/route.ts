import { NextResponse, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { MEDIA_BUCKET, esRutaMediaValida } from '@/lib/chat-media'

export const dynamic = 'force-dynamic'

// Proxy autenticado (proxy.ts exige login) para servir archivos del bucket
// privado `whatsapp-media` en el timeline: ?path=inbox/<digitos>/<id>.<ext>
export async function GET(req: NextRequest) {
  try {
    const path = String(new URL(req.url).searchParams.get('path') ?? '')
    if (!esRutaMediaValida(path)) {
      return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .download(path)
    if (error || !data) {
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }
    const buf = Buffer.from(await data.arrayBuffer())
    const tipo = data.type || 'application/octet-stream'
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        'Content-Type': tipo,
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': 'inline',
      },
    })
  } catch (err) {
    console.error('[API /chat/media GET]', err)
    return NextResponse.json(
      { error: 'No se pudo cargar el archivo' },
      { status: 500 }
    )
  }
}
