import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/inventario — Listar arreglos (filtrable por estado)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const soloDisponibles = searchParams.get('disponibles') === 'true'

    let query = supabaseAdmin
      .from('arreglos_diarios')
      .select('*')
      .order('creado_en', { ascending: false })

    if (soloDisponibles) {
      query = query.eq('estado', 'disponible')
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ arreglos: data })
  } catch (error) {
    console.error('[API /inventario GET]', error)
    return NextResponse.json(
      { error: 'Error al obtener inventario' },
      { status: 500 }
    )
  }
}

// POST /api/inventario — Crear nuevo arreglo
// Body: multipart/form-data con campos: nombre, descripcion, precio, foto (File)
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const nombre = formData.get('nombre') as string
    const descripcion = formData.get('descripcion') as string
    const precio = parseFloat(formData.get('precio') as string)
    const foto = formData.get('foto') as File

    if (!nombre || !precio || !foto) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios: nombre, precio, foto' },
        { status: 400 }
      )
    }

    // 1. Subir foto a Supabase Storage
    const extension = foto.name.split('.').pop() || 'jpg'
    const nombreArchivo = `arreglo_${Date.now()}.${extension}`
    const arrayBuffer = await foto.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabaseAdmin.storage
      .from('arreglos-fotos')
      .upload(nombreArchivo, buffer, {
        contentType: foto.type,
        upsert: false,
      })

    if (uploadError) throw uploadError

    // 2. Obtener URL pública
    const { data: urlData } = supabaseAdmin.storage
      .from('arreglos-fotos')
      .getPublicUrl(nombreArchivo)

    // 3. Insertar registro en BD
    const { data, error: insertError } = await supabaseAdmin
      .from('arreglos_diarios')
      .insert({
        nombre,
        descripcion: descripcion || null,
        precio,
        foto_url: urlData.publicUrl,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ arreglo: data }, { status: 201 })
  } catch (error) {
    console.error('[API /inventario POST]', error)
    return NextResponse.json(
      { error: 'Error al crear arreglo' },
      { status: 500 }
    )
  }
}