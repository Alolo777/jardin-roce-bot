<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Knowledge

## Sistema de envíos
- Dos sistemas coexisten: `zonas_envio` (keywords, legacy) y `municipios_envio` (datos exactos con CP, preferido)
- `buscarPrecioEnvio()` en bot.ts busca primero en municipios_envio, luego fallback a zonas_envio
- Admin page en `/admin/municipios` permite agregar manual, importar CSV o exportar CSV (columnas: municipio, codigo_postal, zona, precio_envio, opcional colonia)

## Venta cerrada
- AI genera token `[VENTA_CERRADA: nombre | producto | $precio | direccion]` al final del mensaje
- Si AI no lo genera, bot.ts tiene fallback: detecta "ya pague", "listo", "comprobante" y notifica igual
- Si el usuario escribe "venta cerrada" explícitamente, también se dispara la notificación
- Las ventas se registran automáticamente en `reporte_ventas` para dashboard y estadísticas

## Cancelaciones y quejas
- bot.ts detecta palabras clave de cancelación y queja automáticamente
- Envía alerta por Telegram con `enviarAlertaCancelacion()` y `enviarAlertaQueja()`
- El contexto AI se ajusta para manejar estos casos con empatía sin prometer compensaciones
- Tabla `reclamaciones` en Supabase para seguimiento

## Eventos especiales
- bot.ts detecta palabras clave: boda, XV años, funeral, aniversario, graduación, etc.
- Inyecta contexto especializado al prompt según el tipo de evento
- AI responde con sugerencias acordes al evento

## Validación post-AI de precios
- `validarPreciosEnRespuesta()` extrae montos mencionados por la AI y los coteja con el inventario real
- Si la AI menciona un precio que no existe en inventario, se registra una advertencia en logs
- Ayuda a detectar alucinaciones de precios

## Nuevas tablas Supabase
- `historial_prompt` — historial de cambios al system prompt
- `reclamaciones` — quejas, cancelaciones y devoluciones
- `reporte_ventas` — registro de cada venta cerrada para reportes

## Dashboard de estado
- `/admin` muestra panel con: conexión WhatsApp, estado de Flora, ventas hoy, actividad reciente
- Status via Express en puerto 10000 (`GET /status`) y Next.js API (`GET /api/bot/status`)

## System Prompt
- Almacenado en Supabase `configuracion_bot.clave = 'system_prompt'`
- Caché de 60 segundos en `lib/ai.ts`
- Incluye reglas contra off-topic, asunción de género, y roles externos
- Incluye flujo post-venta, quejas, cancelaciones y eventos especiales
- Versión actualizada disponible en `_prompt_actualizado.txt`

## Manual de operación
- Archivo `_MANUAL_OPERACION.md` — guía "Si pasa X, haz Y" para el cliente
- Cubre: reconexión, cambios de prompt, subir arreglos, pausa, reportes

## Componentes completados
- `componets/admin/ArregloCard.tsx` — tarjeta de arreglo reutilizable
- `componets/admin/PromptEditor.tsx` — editor de prompt con indicador de cambios
- `componets/admin/SubirArregloForm.tsx` — formulario de subida de arreglos
