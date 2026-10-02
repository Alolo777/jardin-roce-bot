import { NextResponse, NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  telefonoADigitos,
  resolverTelefonoCanonical,
  MAX_TEXTO_OUTBOX,
  TOMA_HUMANA_DESCRIPCION,
} from '@/lib/chat-dashboard'
import { esTipoOutbox, esRutaMediaValida } from '@/lib/chat-media'

// Envía un mensaje del equipo al cliente vía outbox (lo recoge el bot en la VM).
// Soporta texto e imagen/audio/documento ({ tipo, media_path } + caption).
// Además pausa a Flora SOLO en este chat (toma humana), para que no responda
// encima del mensaje manual. Reanudar desde la UI o /api/chat/pausar.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const telefonoParam = String(body.telefono ?? '').trim()
    const texto = String(body.texto ?? '').trim()
    const tipo = body.tipo ?? 'texto'
    const mediaPath = body.media_path != null ? String(body.media_path) : null
    const mediaMimetype = body.media_mimetype != null ? String(body.media_mimetype).slice(0, 120) : null
    const mediaNombre = body.media_nombre != null ? String(body.media_nombre).slice(0, 120) : null
    const digitos = telefonoADigitos(telefonoParam)

    if (digitos.length < 10) {
      return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })
    }
    if (!esTipoOutbox(tipo)) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    }
    if (tipo === 'texto' && !texto) {
      return NextResponse.json({ error: 'El mensaje está vacío' }, { status: 400 })
    }
    if (texto.length > MAX_TEXTO_OUTBOX) {
      return NextResponse.json(
        { error: `Máximo ${MAX_TEXTO_OUTBOX} caracteres` },
        { status: 400 }
      )
    }
    if (tipo !== 'texto' && (!mediaPath || !esRutaMediaValida(mediaPath))) {
      return NextResponse.json({ error: 'Adjunto inválido' }, { status: 400 })
    }

    const canonico = await resolverTelefonoCanonical(telefonoParam)

    // 1. Pausa por chat (idempotente; no pisa silenciados permanentes)
    await supabaseAdmin
      .from('numeros_ignorados')
      .upsert(
        { numero: digitos, descripcion: TOMA_HUMANA_DESCRIPCION },
        { onConflict: 'numero', ignoreDuplicates: true }
      )

    // 2. Encolar en el outbox
    const { data, error } = await supabaseAdmin
      .from('mensajes_outbox_equipo')
      .insert({
        telefono: canonico,
        texto,
        tipo,
        media_path: mediaPath,
        media_mimetype: mediaMimetype,
        media_nombre: mediaNombre,
        creado_por: 'admin',
      })
      .select('id')
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, id: data.id, pausado: true })
  } catch (err) {
    console.error('[API /chat/enviar POST]', err)
    return NextResponse.json(
      { error: 'No se pudo encolar el mensaje' },
      { status: 500 }
    )
  }
}
