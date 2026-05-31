/*import { NextRequest, NextResponse } from 'next/server';
import { getCatalogoFlores } from '../../../lib/googleSheets';
import { generarRespuestaVendedor } from '../../../lib/ai';
// Endpoint para validar el Webhook (Meta/Instagram lo pide mediante GET)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  // "jardinroce2024" es el token de verificación que configuraremos en Meta
  if (mode === 'subscribe' && token === 'jardinroce2024') {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Token de verificación inválido' }, { status: 403 });
}

// Endpoint que recibirá los mensajes reales de los clientes (POST)
export async function POST(request: NextRequest) {
  try {
    // 1. Extraemos lo que nos dice el cliente
    const body = await request.json();
    const mensajeCliente = body.mensaje || "Hola, quiero información";
    
    console.log('👤 Cliente dice:', mensajeCliente);
    console.log('📊 Leyendo el inventario de Google Sheets...');
    
    // 2. Traemos el inventario
    const catalogo = await getCatalogoFlores();
    
    console.log('🧠 Consultando a la IA (GitHub Models)...');
    
    // 3. La IA analiza el catálogo y el mensaje, y nos da una respuesta
    const respuestaIA = await generarRespuestaVendedor(mensajeCliente, catalogo);
    
    console.log('🤖 Agente RoCe responde:', respuestaIA);

    // 4. Devolvemos la respuesta
    return NextResponse.json({ 
      respuesta: respuestaIA 
    }, { status: 200 });

  } catch (error) {
    console.error('Error en el webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}*/