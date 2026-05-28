import Anthropic from '@anthropic-ai/sdk';

// 1. Inicializamos Claude
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generarRespuestaVendedor(mensajeCliente: string, catalogo: any[]) {
  try {
    // 2. Le mandamos TODO el catálogo porque Claude sí tiene la capacidad
    const catalogoTexto = catalogo.map(p => 
      `- ${p.Nombre}: $${p['Precio Actual']} (Cat: ${p.Categoria})`
    ).join('\n');

    // 3. Las instrucciones (Claude usa el System Prompt por separado)
    const systemPrompt = `
      Eres el vendedor de 'Jardin RoCe', una florería premium. 
      Eres amable, persuasivo y usas emojis 🌻. Tu objetivo es ayudar a elegir y cerrar la venta.
      
      INVENTARIO DISPONIBLE HOY:
      ${catalogoTexto}
      
      REGLAS ESTRICTAS:
      1. SOLO ofrece productos de esta lista.
      2. Amor/Aniversario -> recomienda categoría 'rosas' o 'bodas'.
      3. Cumpleaños/Amistad -> recomienda 'mixtos' o 'temporada'.
      4. Sé muy conciso. Recomienda 1 o máximo 2 opciones con su precio exacto. NO des listas.
      5. Si el cliente elige, pregunta a qué dirección se enviará y si quiere tarjeta 💌.
    `;

    // 4. Hacemos la petición a Claude
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022", // Súper rápido para chats
      max_tokens: 300, // Respuesta corta y directa
      temperature: 0.7,
      system: systemPrompt, // Claude recibe el system prompt aquí
      messages: [
        { role: "user", content: mensajeCliente }
      ]
    });

    // @ts-ignore - Accedemos al texto de la respuesta
    return msg.content[0].text;

  } catch (error) {
    console.error("❌ Error en el Cerebro Claude:", error);
    return "¡Hola! Una disculpa, justo ahora estoy en el invernadero acomodando unas flores 🌸. ¿Podrías escribirme de nuevo en un minuto?";
  }
}