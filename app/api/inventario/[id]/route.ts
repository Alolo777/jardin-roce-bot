import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// PATCH /api/inventario/[id] — Actualizar estado u otros campos
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // <-- Cambio: Ahora es una Promesa
) {
  try {
    const body = await request.json()
    const { id } = await params // <-- Cambio: Agregamos await

    // Solo permitir actualizar campos seguros
    const camposPermitidos = ['estado', 'precio', 'descripcion', 'nombre']
    const actualizacion: Record<string, unknown> = {}

    for (const campo of camposPermitidos) {
      if (campo in body) {
        actualizacion[campo] = body[campo]
      }
    }

    if (Object.keys(actualizacion).length === 0) {
      return NextResponse.json(
        { error: 'No hay campos válidos para actualizar' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('arreglos_diarios')
      .update(actualizacion)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ arreglo: data })
  } catch (error) {
    console.error('[API /inventario/[id] PATCH]', error)
    return NextResponse.json(
      { error: 'Error al actualizar arreglo' },
      { status: 500 }
    )
  }
}

// DELETE /api/inventario/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> } // <-- Cambio: Ahora es una Promesa
) {
  try {
    const { id } = await params // <-- Cambio: Agregamos await

    // Obtener el registro primero para borrar la foto de Storage
    const { data: arreglo } = await supabaseAdmin
      .from('arreglos_diarios')
      .select('foto_url')
      .eq('id', id)
      .single()

    if (arreglo?.foto_url) {
      // Extraer el nombre del archivo de la URL
      const url = new URL(arreglo.foto_url)
      const pathParts = url.pathname.split('/')
      const nombreArchivo = pathParts[pathParts.length - 1]

      // Borrar de Storage (no fatal si falla)
      await supabaseAdmin.storage
        .from('arreglos-fotos')
        .remove([nombreArchivo])
        .catch(console.error)
    }

    const { error } = await supabaseAdmin
      .from('arreglos_diarios')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[API /inventario/[id] DELETE]', error)
    return NextResponse.json(
      { error: 'Error al eliminar arreglo' },
      { status: 500 }
    )
  }
}