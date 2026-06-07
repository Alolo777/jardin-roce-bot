<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Knowledge

## Sistema de envíos
- Dos sistemas coexisten: `zonas_envio` (keywords, legacy) y `municipios_envio` (datos exactos con CP, preferido)
- `buscarPrecioEnvio()` en bot.ts busca primero en municipios_envio, luego fallback a zonas_envio
- Admin page en `/admin/municipios` permite agregar manual o importar CSV (columnas: municipio, codigo_postal, zona, precio_envio, opcional colonia)

## Venta cerrada
- AI genera token `[VENTA_CERRADA: nombre | producto | $precio | direccion]` al final del mensaje
- Si AI no lo genera, bot.ts tiene fallback: detecta "ya pague", "listo", "comprobante" y notifica igual
- Si el usuario escribe "venta cerrada" explícitamente, también se dispara la notificación
- System prompt actualizado para ser más agresivo cerrando ventas
