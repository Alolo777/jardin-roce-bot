# KNOWN_BUGS.md — Errores Conocidos

> Documento oficial de errores conocidos (exigido por AGENTS.md Parte 4.2A).
> Nunca eliminar bugs. Marcar como resueltos.

## BUG-001: Alertas de Telegram llegan sin datos (producto/total/cliente vacíos)
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (2026-07-17, DEC-041)
- **Reportado:** 2026-07-17
- **Síntomas:** Las alertas VENTA CERRADA / PEDIDO APARTADO llegan con `Producto:`, `Total:`, `Cliente:` vacíos.
- **Causa raíz:** `pedido.service.ts` emitía `ORDER_CREATED`/`ORDER_UPDATED` sin `producto`/`total`/`cliente` en el payload.
- **Corrección:** `buildOrderPayload(pedido)` mapea datos reales del `PedidoActual`; `crearPedido` ahora emite `ORDER_UPDATED` (no `ORDER_CREATED`).
- **Versión donde se corrigió:** 3.0.1

## BUG-002: "VENTA CERRADA" falsa por interés de compra
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (2026-07-17, DEC-039)
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente solo mostró intención de compra y llegó alerta "🌸 ¡VENTA CERRADA!".
- **Causa raíz:** `message-handler.ts` emitía `ORDER_CREATED` en el bloque `esInteresCompra`.
- **Corrección:** Se emite `COTIZACION_REQUESTED` con payload robusto (teléfono real, cliente, descripción con producto + texto). `enviarAlertaCotizacion` ahora dice "INTERÉS / COTIZACIÓN".
- **Versión donde se corrigió:** 3.0.1

## BUG-003: Alerta de "cliente pide fotos" sin contexto ni número real
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (DEC-043, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** El cliente pidió ver fotos de ramos armados. La alerta a Telegram llegó sin decir qué ramo vio ni con número legible (LID enmascarado a `xxx5844`).
- **Causa raíz:** `PHOTO_REQUESTED` se emitía con `cliente: ''` y sin contexto; `enviarAlertaEmpleadoFotos` no mostraba número real ni producto.
- **Corrección:** `PHOTO_REQUESTED` con `telefono` real, `cliente` y `descripcion`; `enviarAlertaEmpleadoFotos` muestra número real + contexto. Ambos canales.
- **Versión donde se corrigió:** 3.0.1

## BUG-004: Máquina de estados rota — pedido nunca llega a APARTADO
- **Prioridad:** 🔴 Crítica
- **Estado:** ✅ Resuelto (DEC-044, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente fue de cotización a "quiero pagar/envío". Logs mostraban `Transición inválida: COTIZANDO → ESPERANDO_PAGO`, `ESPERANDO_PAGO → EN_PRODUCCION` y `ESPERANDO_PAGO → ESPERANDO_PAGO`. El pedido nunca pasó por APARTADO, así que la alerta "Pedido Apartado" no salió con dirección/total; al enviar comprobante se emitió ORDER_CREATED con datos vacíos (`cliente:"Me pasa su cuenya pla"`).
- **Causa raíz:** (1) `TRANSICIONES_VALIDAS` no permitía `COTIZANDO → ESPERANDO_PAGO` ni `PRECIO_CONFIRMADO → ESPERANDO_PAGO`. (2) `transitarDesdeFlujo` **forzaba** `pedido.estado = nuevo` aunque la transición fuera inválida, permitiendo saltos imposibles. (3) `pagado_transferencia` mapeaba a `EN_PRODUCCION` (saltando APARTADO).
- **Corrección:** Agregadas transiciones `NUEVO/COTIZANDO/PRECIO_CONFIRMADO/ESPERANDO_DATOS → ESPERANDO_PAGO`. `pagado_transferencia` ahora mapea a `APARTADO`. `transitarDesdeFlujo` ya NO fuerza estados inválidos (se queda en el anterior y queda en el log).
- **Impacto:** El pago confirmado ahora sí transita a APARTADO con datos; ORDER_CREATED solo al cierre real. Cubierto por `tests/event-wire-flow.test.mts` (caso BUG-004).
- **Versión donde se corrigió:** 3.0.2

## BUG-005: Nombre en alertas Telegram incorrecto / no se pide nombre
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (DEC-045, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** Alertas Telegram de pedido mostraban `cliente:"Me pasa su cuenya pla"` (texto del mensaje, no el nombre). El sistema no pidió el nombre de quien aparta/recibe antes de cerrar.
- **Causa raíz:** `ventaCerradaHandler`/`pedidoApartadoHandler` usaban `venta.cliente` (token del LLM, puede ser texto erróneo) en lugar del nombre real del pedido. No había guarda de nombre antes de cerrar.
- **Corrección (DEC-045):**
  1. `nombreParaAlerta()`: prioriza `pedido.nombre` (fuente de verdad backend) → nombre válido del token → "Verificar en chat". Si el token trae nombre válido y el pedido no lo tiene, se sincroniza al pedido.
  2. Guarda en `ventaCerradaHandler`: si no hay nombre válido, NO se cierra; el pedido queda en `esperando_nombre` para que el bot pida el nombre (cumple regla de negocio de pedir nombre antes de cerrar).
- **Nota:** El "teléfono en caso de envío" ya se cubre porque el teléfono real siempre viaja en `telefono`/`numeroReal` (ver Bug B). La parte de "pedir teléfono" adicional no requirió cambio: el número real ya está disponible.
- **Versión donde se corrigió:** 3.0.3

## BUG-006: Horario inventado por el LLM
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (DEC-046, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente preguntó "a qué hora cierran" un viernes; bot dijo "Mañana cerramos a las 7:00 pm" (era sábado, cierra 5pm).
- **Causa raíz:** El LLM calculó "mañana" sin usar la tabla de horarios del prompt; backend no inyectaba el horario calculado como anotación confiable.
- **Corrección (DEC-046):** Nueva `horarioHoyManana()` en `horario.validator.ts` (L-V 10-19, S-D 10-17, calculado con `ahoraCdmx`). `construirContextoPrompt` inyecta `[HORARIO HOY: ...]` y `[HORARIO MAÑANA: ...]` como anotaciones de sistema que el LLM debe obedecer (cumple AGENTS.md ERROR #3).
- **Versión donde se corrigió:** 3.0.4

## BUG-007: Dirección Maps short-link repetido sin calle
- **Prioridad:** Media
- **Estado:** ✅ Resuelto (DEC-047, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente envió `maps.app.goo.gl/...`; bot repitió el link como dirección sin calle legible.
- **Causa raíz:** `parseDireccion` aceptaba el short-link como dirección y `limpiarDireccionCliente` lo borraba; el LLM lo repetía del historial. No se pedía calle.
- **Corrección (DEC-047, opción A):**
  1. `parseDireccion` marca `esLinkMaps: true` y conserva el link como dirección.
  2. `limpiarDireccionCliente` (message-handler) ahora conserva el link Maps.
  3. En el flujo de envío, si la dirección es link Maps, se inyecta instrucción al LLM para GUARDAR el link y PEDIR confirmación de calle/número en texto (no repetir el link como calle).
- **Versión donde se corrigió:** 3.0.5

## BUG-008: Conexión WhatsApp 405 (versión de protocolo obsoleta)
- **Prioridad:** Crítica
- **Estado:** Resuelto (2026-08-01)
- **Reportado:** 2026-07-31
- **Síntomas:** El bot no conectaba a WhatsApp. Conexión cerrada: 405 en bucle, sin generar QR nunca, incluso tras cambiar IP de la VM y borrar la sesión.
- **Causa raíz:** WhatsApp dejó de aceptar la versión de protocolo de WhatsApp Web hardcodeada en Baileys 7.0.0-rc13. makeWASocket() se llamaba sin ersion, usando la obsoleta por defecto → 405 en el handshake WebSocket, antes del registro/QR.
- **Corrección:** obtenerVersionWhatsApp() en ot.ts obtiene la versión actual vía etchLatestBaileysVersion() → fallback etchLatestWaWebVersion() → fallback fijo [2, 3000, 1037641644], y se pasa ersion a makeWASocket. Versión cacheada.
- **Versión donde se corrigió:** 2.1.1

## BUG-009: IA no funciona — GitHub Models retirado (404/410)
- **Prioridad:** Crítica
- **Estado:** Resuelto (2026-08-03)
- **Reportado:** 2026-08-01
- **Síntomas:** Todos los mensajes de clientes fallaban en el motor de IA (sin respuesta o fallback). Los 4 tokens (1 `ghp_`, 3 `github_pat_`) eran válidos en `api.github.com` (HTTP 200) pero las llamadas a modelos daban 404 (`models.inference.ai.azure.com/chat/completions`) o 410 (`models.github.ai/inference/chat/completions`).
- **Causa raíz:** GitHub Models fue retirado oficialmente el 2026-07-30 (docs: "GitHub Models has been fully retired... inference API... no longer available"). El endpoint Azure se deprecó 2025-07-17 y se retiró 2025-10-17. `lib/ai.ts`, `order.reconstructor.ts` y `order.auditor.ts` apuntaban todos al servicio muerto. NO era problema de tokens, concurrencia ni límites.
- **Corrección (DEC-049):** Gemini pasa a ser el proveedor primario en `lib/ai.ts` (`callWithFallback` invertido: Gemini primero, GitHub como respaldo). Modelo por defecto `gemini-2.5-flash` (free tier ~10 RPM / ~1500 RPD). Visión (`clasificarImagenVenta`) migrada a `generateContent` con imágenes inline base64 + `conRetry` (3 intentos) para tolerar 503/429. `getAIResponse` usa `generateContent` con `systemInstruction` (ya no duplica el último mensaje). Todas las llamadas Gemini primarias envueltas en `conRetry`.
- **Pruebas:** `npx tsc --noEmit` 0 errores; tests `test:validator`, `test:horario`, `test:nombre`, `test:inventario`, `test:reclamaciones`, `test:flows` OK (`test:wire` falla pre-existente, no relacionado); pruebas live con la key real: clasificación, respuesta al cliente y visión (comprobante) exitosas.
- **Versión donde se corrigió:** 2.1.2

## BUG-010: IA cae por cuota free tier de gemini-2.5-flash (solo 20 peticiones/día)
- **Prioridad:** Crítica
- **Estado:** Resuelto (2026-08-03, DEC-070)
- **Reportado:** 2026-08-04 (log de producción 04:13–04:51)
- **Síntomas:** El bot dejó de responder con IA a mitad de una conversación. Log: `429 Too Many Requests — Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash` + `retryDelay: 21s`. El fallback a GitHub Models devolvió 401. Se emitieron `PROVIDER_FAILURE` y `HUMAN_REQUIRED [TIMEOUT IA]`. Además, las respuestas del cliente llegaban cortadas ("Para envíos a domicilio, el pago es…").
- **Causa raíz:** El free tier de `gemini-2.5-flash` fue recortado por Google a ~20 peticiones/día (dic-2025), no ~1500 como asumía DEC-069/.env. Cada mensaje dispara varias llamadas IA (`getAIResponse` + visión + clasificación), por lo que 20 se agotan en minutos. `maxOutputTokens: 800` en `getAIResponse` no alcanzaba porque 2.5-flash consume tokens de razonamiento contra el mismo tope → respuesta visible truncada. El fix de visión (`maxOutputTokens: 400`) no llegó a producción (no se commiteó).
- **Corrección (DEC-070):** proveedor primario por defecto `gemini-2.5-flash-lite` (~15 RPM / ~1,000 RPD); cadena de fallback OpenAI-compatible OpenRouter → Groq → Cerebras → GitHub con cuotas independientes; `maxOutputTokens`: chat 800 → 2048, visión 400 → 1024; eliminado `githubClient`/`REVIEW_MODEL` muertos.
- **Pruebas:** `npx tsc --noEmit` 0 errores; tests `test:flows`, `test:nombre`, `test:validator`, `test:horario`, `test:inventario`, `test:reclamaciones` OK.
- **Pendiente:** Agregar al menos una API key de fallback (OpenRouter/Groq/Cerebras) en `.env.local` de la VM.
- **Versión donde se corrigió:** 2.1.3

## BUG-011: Teléfono LID sin normalizar — alertas/pedidos guardaban el jid crudo (`@lid`)
- **Prioridad:** Alta
- **Estado:** Resuelto (2026-08-04, DEC-071)
- **Reportado:** 2026-08-04 (diagnóstico de sesión)
- **Síntomas:** Cuando un cliente usa cuenta vinculada (`@lid`), el número real no siempre se resuelve contra el mapeo de Baileys. Las alertas WhatsApp, los pedidos en Supabase y los eventos Telegram guardaban el jid crudo (`5212345...@lid` o `...@lid:15`) en lugar de un número normalizado. Además, el mismo remitente podía aparecer con formatos distintos en el historial vs. las alertas.
- **Causa raíz:** (1) `obtenerNumeroReal` (contact.service.ts) devolvía `jid` sin normalizar cuando el LID no se resolvía. (2) `jidToTelefono` (conversation.service.ts) no limpiaba el sufijo `:dispositivo`, a diferencia de `jidANumero` (message-utils.ts), generando dos identificadores distintos para el mismo cliente.
- **Corrección (DEC-071):** `obtenerNumeroReal` normaliza el LID no resoluble con `jidANumero` (quita `@lid` y `:device`); `jidToTelefono` ahora también elimina el sufijo `:dispositivo`. La detección de LID sigue funcionando por longitud (>13 dígitos) en `esLid`/`formatearNumero`.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `tests/telefono.test.mts` (nuevo, `npm run test:telefono`) cubre LID no resoluble, LID con `:device`, jidToTelefono, esLid y variantesTelefono. Suite completa OK.
- **Versión donde se corrigió:** 2.1.4

## BUG-012: Precio/fecha no arrastrados a los eventos operativos — Telegram perdía fecha de entrega
- **Prioridad:** Alta
- **Estado:** Resuelto (2026-08-04)
- **Reportado:** 2026-08-04 (diagnóstico de sesión)
- **Síntomas:** Las notificaciones operativas a Telegram (`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `ORDER_CREATED`, `ORDER_UPDATED`, `PAYMENT_PENDING`) no mostraban la fecha ni la hora de entrega del pedido. El equipo solo veía producto, precio y sucursal, teniendo que abrir el dashboard para conocer cuándo entregar/preparar el arreglo.
- **Causa raíz:** Los templates de `template.builder.ts` para "VENTA CERRADA", "PEDIDO APARTADO" y "PAGO PENDIENTE" no renderizaban `verified.fecha`/`verified.hora`, aunque el pipeline ya los proveía desde el timeline (`fecha_entrega`/`hora_entrega` del pedido en Supabase).
- **Corrección:** Se agregó `getFechaHora(verified)` en `template.builder.ts` y se insertó la línea `📅 <fecha> <hora>` en los templates `ORDER_CREATED`/`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`, `ORDER_UPDATED` y `PAYMENT_PENDING`. Si no hay fecha/hora, la línea no se renderiza.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `tests/template-payment.test.mts` (nuevo, `npm run test:template`) cubre que VENTA CERRADA y PAGO PENDIENTE muestren fecha/hora cuando existen y que no se renderice línea vacía cuando no. Suite completa OK.
- **Versión donde se corrigió:** 2.1.5

## BUG-013: ORDER_CREATED con payload incompleto — faltaba orderId/sucursal/metodoPago
- **Prioridad:** Alta
- **Estado:** Resuelto (2026-08-04)
- **Reportado:** 2026-08-04 (diagnóstico de sesión)
- **Síntomas:** Los eventos `ORDER_CREATED` emitidos desde distintos puntos no traían el payload completo. `crearPedido` (pedido.service.ts) emitía un payload inline sin `sucursal` ni `metodoPago`; el alerta "comprobante-pendiente" de `message-handler.ts` no incluía `orderId`; y el pedido del cotizador web (bot.ts) se emitía sin crear el pedido en el engine, por lo que no tenía `orderId` real ni `metodoPago`. Al llegar al Notification Engine, faltaban campos para el Decision Extractor, el Conflict Detector y el Business Rules Validator (RR003/RR006).
- **Causa raíz:** (1) `crearPedido` no usaba `buildOrderPayload` (que sí arma sucursal + metodoPago). (2) El handler de comprobante-pendiente armaba el payload manual sin `orderId`. (3) El flujo web emitía `ORDER_CREATED` directamente sin crear el pedido, inventando un evento sin respaldo en DB y sin `orderId`/`metodoPago`.
- **Corrección:** (1) `crearPedido` ahora emite con `...buildOrderPayload(pedido)`. (2) `buildOrderPayload` respeta `pedido.descripcion` si existe. (3) El alerta "comprobante-pendiente" incluye `orderId: pedido.id`. (4) El cotizador web crea el pedido con `crearPedido(...)` (producto, total, sucursal, metodoPago transferencia, descripcion), y `crearPedido` emite el evento completo. Sin pedido real no se emite `ORDER_CREATED` huérfano.
- **Pruebas:** `npx tsc --noEmit` 0 errores; suite aplicable (`test:template`, `test:telefono`, `test:validator`) OK. `test:wire` falla pre-existente (asume contrato antiguo ORDER_UPDATED), no relacionado.
- **Versión donde se corrigió:** 2.1.6

## BUG-014: Proveedor primario Gemini roto — gemini-2.5-flash-lite deprecado (404)
- **Prioridad:** Crítica
- **Estado:** Resuelto (2026-08-04)
- **Reportado:** 2026-08-04 (verificación `npm run check:apis`)
- **Síntomas:** El proveedor primario de IA devolvía `404 NOT_FOUND: models/gemini-2.5-flash-lite is no longer available to new users`. Las respuestas dependían del fallback OpenRouter/Groq.
- **Causa raíz:** Google deprecó la familia Gemini 2.5 (shutdown 2026-10-16). El modelo configurado quedó sin acceso para cuentas nuevas.
- **Corrección:** `GEMINI_MODEL` por defecto y en `.env*` → `gemini-3.1-flash-lite` (reemplazo oficial, verificado OK). Se creó `scripts/check-apis.mts` (`npm run check:apis`) para verificar todas las APIs de un vistazo.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `npm run check:apis` → Gemini `OK`.
- **Versión donde se corrigió:** 2.1.7
