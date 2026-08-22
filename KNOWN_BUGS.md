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

## BUG-015: El bot seguía pidiendo "confirmación del equipo" aunque el equipo ya diera el precio en el chat
- **Prioridad:** Alta
- **Estado:** Resuelto (2026-08-10, DEC-079)
- **Reportado:** 2026-08-10
- **Síntomas:** Cuando un empleado respondía en el chat del cliente con el precio real del ramo, el bot seguía respondiendo "déjame confirmar con el equipo el precio real". El precio nunca se aplicaba al pedido (quedaba en `esperando_precio_equipo`) aunque el `[Agente: ...]` estuviera en el historial.
- **Causa raíz:** `parsePrecio` solo reconocía precios con `$` o pocas palabras clave; frases comunes del equipo sin `$` ("Son 450", "Cuesta 450", "Te sale en 450") devolvían `null`, por lo que `procesarMensajeEquipo` (bot.ts:799-800) nunca ejecutaba el bloque que fija `precioConfirmadoPor='equipo'` y transita a `precio_confirmado`. Además, el contexto `[PEDIDO]` no informaba al LLM que el precio ya estaba validado, y `seleccionaFotoDisponible` podía archivar un pedido ya preciado.
- **Corrección (DEC-079):** parser ampliado con verbos de precio comunes y número suelto como único contenido; contexto `[PEDIDO]` con `Precio confirmado por: <fuente>` + instrucción de no volver a pedir confirmación; contexto `[INTERVENCION HUMANA RECIENTE]` con el precio extraído; guard en `seleccionaFotoDisponible` para no resetear un pedido ya preciado.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `tests/precio.test.mts` (nuevo, `npm run test:precio`) cubre 15 frases reales del equipo y 7 textos sin precio.
- **Versión donde se corrigió:** 2.2.1

## BUG-016: Fuera de horario las fotos se reenviaban al equipo al instante y el cliente quedaba sin atención clara
- **Prioridad:** Media
- **Estado:** Resuelto (2026-08-10, DEC-080)
- **Reportado:** 2026-08-10
- **Síntomas:** Con el negocio cerrado, las fotos/media que llegaban por WhatsApp se reenviaban de inmediato al equipo (alertas de noche). Además, la presentación de Flora como "empleada" y las anotaciones `[CONTEXTO: Fuera de Horario]` del prompt nunca llegaban al LLM, por lo que fuera de horario el cliente recibía respuestas genéricas o sin dirección.
- **Causa raíz:** (1) `procesarMediaAcumulado` y el `finally` de medios pendientes emitían `PHOTO_RECEIVED` + `notificarEmpleadosWhatsApp` sin verificar el horario. (2) `message-handler.ts:472` inyectaba solo `validarHorario().mensajeBackend` en lugar de `getContextoHorario()` (que existía pero nunca se usaba). (3) `getContextoHorario()` solo contenía el texto de cierre, sin instrucciones para el modo asistente virtual fuera de horario.
- **Corrección (DEC-080):** (1) Nueva cola `FOTOS_PENDIENTES_APERTURA` (bot-state.ts) + `encolarFotoPendienteApertura`/`obtenerFotosPendientesApertura`/`limpiarFotosPendientesApertura`. (2) Fuera de horario (`!estaEnHorario()`) las fotos/comprobantes/referencias/cotizaciones se encolan en lugar de emitir/notificar. (3) `getContextoHorario()` enriquecido y ahora sí inyectado. (4) Prompt: Flora se presenta como asistente virtual + nueva sección "Fuera de horario" + anotación reescrita. (5) Flush en bot.ts (cada 5 min) que al volver a estar en horario reenvía las fotos encoladas al equipo con resumen.
- **Complemento (DEC-081, 2026-08-10):** (6) Cola persistida en `bot_cache` (`MAPAS_A_PERSISTIR`) — sobrevive reinicios; hook `setOnFotosPendientesCambiaron` persiste al instante al encolar. (7) `limpiarClavesVacias()` borra claves vacías para no reenviar fotos ya entregadas (sin duplicados tras reinicio). (8) Flush exacto a la hora de apertura (`programarFlushApertura()` en bot.ts) + ciclo de 5 min como red de seguridad.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario`, `test:precio`, `test:validator`, `test:flows` OK.
- **Versión donde se corrigió:** 2.2.3

## BUG-014: Proveedor primario Gemini roto — gemini-2.5-flash-lite deprecado (404)
- **Prioridad:** Crítica
- **Estado:** Resuelto (2026-08-04)
- **Reportado:** 2026-08-04 (verificación `npm run check:apis`)
- **Síntomas:** El proveedor primario de IA devolvía `404 NOT_FOUND: models/gemini-2.5-flash-lite is no longer available to new users`. Las respuestas dependían del fallback OpenRouter/Groq.
- **Causa raíz:** Google deprecó la familia Gemini 2.5 (shutdown 2026-10-16). El modelo configurado quedó sin acceso para cuentas nuevas.
- **Corrección:** `GEMINI_MODEL` por defecto y en `.env*` → `gemini-3.1-flash-lite` (reemplazo oficial, verificado OK). Se creó `scripts/check-apis.mts` (`npm run check:apis`) para verificar todas las APIs de un vistazo.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `npm run check:apis` → Gemini `OK`.
- **Versión donde se corrigió:** 2.1.7

## BUG-017: Hora inyectada al LLM en 24h y zona del servidor (UTC en GCP) — se confundía con el horario de CDMX
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (2026-08-19, DEC-083)
- **Reportado:** 2026-08-19 (revisión de código)
- **Síntomas:** El `[HORA ACTUAL]` del contexto se generaba con `new Date().toLocaleTimeString('es-MX', {...})` SIN `timeZone` en `src/orchestrator.ts:45` y `src/whatsapp/message-handler.ts:479`, por lo que usaba la zona local del servidor (UTC en GCP). El `[CONTEXTO]` usaba `America/Mexico_City`, así que el LLM recibía dos horas distintas y se confundía al responder "¿ya están abiertos?". Todo el contexto iba en formato 24 horas mientras el equipo habla en 12 horas ("5 de la tarde", "3 pm"), y no existía un dato del backend sobre si se puede entregar en 1 hora dentro del horario laboral.
- **Causa raíz:** (1) `toLocaleTimeString` sin `timeZone` depende de la zona del servidor. (2) Formato 24h inconsistente con el lenguaje del equipo. (3) La promesa de "entrega en 1 hora" no estaba validada por backend (el LLM podía confirmarla fuera de horario).
- **Corrección (DEC-083):**
  1. `ahoraCdmx()` (`message-utils.ts`) ahora devuelve `etiqueta12`/`hora12`/`ampm` en 12h; nuevo `formatoHora12(hora, minuto)` para apertura/cierre.
  2. `getContextoHorario()` inyecta la hora en 12h y calcula "Entrega/finalización en 1 hora: POSIBLE (≈ <hora 12h>)" o "NO posible" (actual + 60 min contra el cierre del día).
  3. `orchestrator.ts` y `message-handler.ts` inyectan `ahoraCdmx().etiqueta12` (desaparece el `toLocaleTimeString` sin timezone).
  4. `horario.validator.ts` y `prompt.builder.ts` en formato 12h.
  5. Prompt system (Supabase + `system-prompt.corregido.ts`): Flora usa SIEMPRE 12h, traduce "5 de la tarde"/"3 pm", confirma entrega en 1h solo si el contexto dice POSIBLE.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario` y `test:validator` OK; verificación manual CDMX 14:07 → `etiqueta12:"2:07 pm"`, `formatoHora12(19,45)` = "7:45 pm", contexto ABIERTOS con entrega ≈ "3:07 pm". Prompt resincronizado: `node _sincronizar_prompt.mjs` (16,888 caracteres).
- **Versión donde se corrigió:** 2.2.5

## BUG-018: Clasificador de imágenes (visión) ignoraba quién escribió el historial — fotos ambiguas mal clasificadas
- **Prioridad:** Media
- **Estado:** ✅ Resuelto (2026-08-19)
- **Reportado:** 2026-08-19 (revisión de código)
- **Síntomas:** `clasificarImagenVenta` armaba el historial reciente con `${m.role}: ${m.content}` (solo `user`/`assistant`), por lo que el clasificador no distinguía si el pago/expectativa de comprobante venía del equipo humano verificado o solo de la IA. Ante una foto ambigua, podía clasificarse mal (ej. el equipo pidió el comprobante y la foto se marcó como "referencia").
- **Causa raíz:** Inconsistencia con DEC-082: `clasificarConversacion` ya usaba `etiquetaOrigen(m)` pero `clasificarImagenVenta` no.
- **Corrección:** `lib/ai.ts` — `clasificarImagenVenta` usa `etiquetaOrigen(m)` ("cliente", "equipo (humano, VERIFICADO)", "sistema", "flora (IA)") y el prompt prioriza `comprobante` si el historial indica que el equipo humano pidió el pago/comprobante aunque la imagen sea ambigua.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario`, `test:validator`, `test:precio`, `test:flows` OK.
- **Versión donde se corrigió:** 2.2.5

## BUG-019: Fotos/documentos del equipo sin texto no se registraban como intervención verificada
- **Prioridad:** Media
- **Estado:** ✅ Resuelto (2026-08-19)
- **Reportado:** 2026-08-19 (revisión de código)
- **Síntomas:** Cuando el equipo respondía al cliente solo con una foto o documento (sin caption), el mensaje nunca se guardaba en `historial_chat`: `message-entry.ts` solo encolaba `if (body)`. La IA no sabía que el equipo ya había enviado una imagen al cliente y podía volver a preguntar lo mismo o no respetar la respuesta verificada.
- **Causa raíz:** (1) `message-entry.ts:103` requería `body` (texto) para llamar a `procesarMensajeEquipo`. (2) `procesarMensajeEquipo` (bot.ts:894) solo persistía cuando había texto; con `body` vacío la intervención humana quedaba sin registro.
- **Corrección:** (1) `message-entry.ts`: los mensajes `fromMe` de tipo `image`/`document` se encolan siempre (`if (body || esMediaEquipo)`). (2) `procesarMensajeEquipo`: si no hay texto pero es imagen/documento, registra la intervención y guarda `[Agente: envió una foto]` / `[Agente: envió un documento]` con `origen='equipo'`, sin tocar el estado del pedido.
- **Pruebas:** `npx tsc --noEmit` 0 errores; suite completa OK (`test:horario`, `test:validator`, `test:precio`, `test:flows`, `test:nombre`, `test:telefono`, `test:template`, `test:inventario`, `test:reclamaciones`).
- **Versión donde se corrigió:** 2.2.5

## BUG-020: Mensajes legacy del historial (sin `origen`) se etiquetaban como Flora aunque fueran del equipo (`[Agente: ...]`)
- **Prioridad:** Media
- **Estado:** ✅ Resuelto (2026-08-19)
- **Reportado:** 2026-08-19 (revisión de código)
- **Síntomas:** El historial guardado antes de DEC-082 no tiene valor en la columna `origen`. `etiquetaOrigen()` y `formatearHistorialConFechas()` (lib/ai.ts) etiquetaban esos mensajes como `flora (IA)` o sin anotación: los `[Agente: ...]` legacy podían parecer respuestas de la IA, y el LLM/revisora podían contradecir respuestas verificadas del equipo.
- **Causa raíz:** Las funciones asumían `m.origen` siempre presente; no había inferencia retrocompatible por contenido (a diferencia de `message-handler.ts:514` y `obtenerUltimosMensajesEquipo`, que sí caen al prefijo `[Agente:`).
- **Corrección:** Nueva `origenEfectivo(m)` en `lib/ai.ts` que, cuando falta `origen`, infiere por contenido: `[Agente: ...]` → equipo, `[Flora omitió respuesta ...`/`[ANOTACIÓN DEL SISTEMA ...` → sistema, resto → flora. Se usa en `etiquetaOrigen()` y `formatearHistorialConFechas()`.
- **Pruebas:** `npx tsc --noEmit` 0 errores; suite completa OK.
- **Versión donde se corrigió:** 2.2.5

## BUG-021: La respuesta al cliente podía incluir anotaciones internas del historial imitadas por el LLM
- **Prioridad:** 🔴 Crítica
- **Estado:** ✅ Resuelto (2026-08-19)
- **Reportado:** 2026-08-19 (producción)
- **Síntomas:** Flora respondió al cliente literalmente `[19/08/2026 8:26 am] [RESPUESTA DE FLORA] ¡Claro! Ya le pedí a una compañera...`. Se filtró metadata interna (marca de fecha/hora + etiqueta de origen) a la conversación visible del cliente.
- **Causa raíz:** `formatearHistorialConFechas()` (lib/ai.ts, DEC-082) antepone `[dd/mm/yyyy h:mm am] [ANOTACIÓN]` a cada mensaje del historial enviado al modelo. El LLM (Gemini) imitó ese prefijo del historial y lo incluyó al inicio de su propia respuesta. El sanitizador final (`sanitizarRespuestaIA`) limpiaba markdown y bloques `[CLIENTE|CONTEXTO|...]` pero no la marca de fecha ni las etiquetas `[RESPUESTA DE FLORA]`/`[EQUIPO HUMANO, VERIFICADO]`/`[ANOTACIÓN DEL SISTEMA]`.
- **Corrección:**
  1. `src/validators/response.validator.ts` — `sanitizarRespuestaIA` elimina `MARCA_FECHA_ANOTACION_RE` (prefijos `[dd/mm/yyyy h:mm am]`) y `ANOTACION_INTERNA_RE` (`[RESPUESTA DE FLORA]`, `[EQUIPO HUMANO, VERIFICADO]`, `[ANOTACIÓN DEL SISTEMA]`) en cualquier parte de la respuesta + colapso de espacios dobles. Cubre la respuesta de `getAIResponse` y la corregida por la revisora (message-handler.ts:1014 y 1037).
  2. Prompt system (regla reforzada en `_prompt_actualizado.txt` y `system-prompt.corregido.ts`): prohibido mostrar/repetir esas anotaciones o prefijos de fecha. Sincronizado a Supabase (17,097 caracteres).
- **Pruebas:** `npx tsc --noEmit` 0 errores; verificación manual del sanitizador con el caso real → prefijo eliminado y contenido intacto; `test:validator`, `test:horario`, `test:precio`, `test:flows` OK.
- **Versión donde se corrigió:** 2.2.5

## BUG-022: Response validator interpretaba horas en formato 12h como AM (falsos positivos al confirmar horario)
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (2026-08-19)
- **Reportado:** 2026-08-19 (revisión tras migrar a formato 12h, BUG-017)
- **Síntomas:** `validarRespuestaIA` podía rechazar respuestas correctas de Flora: `HORA_REGEX` capturaba el meridiano en grupo NO capturado y `extraerHoras()` devolvía solo `HH:MM`, descartando `am`/`pm`. "3:00 pm" se interpretaba como 3:00 AM (antes de apertura) y, si la respuesta incluía una frase de confirmación ("sí podemos", "lo tenemos a las"), se marcaba como horario fuera de rango (rechazo / HUMAN_REQUIRED innecesario). El dato "7:00 am" (que sí debe rechazarse) tampoco se garantizaba.
- **Causa raíz:** La comparación contra `apertura`/`cierre` usaba la hora cruda sin normalizar el meridiano del formato 12h (funcionaba antes porque el contexto era 24h).
- **Corrección:** `src/validators/response.validator.ts` — `HORA_REGEX` captura el meridiano (grupo 3) y `extraerHoras()` normaliza a reloj 24h: `am`/`pm` convertidos, sin sufijo se conserva ("hrs"/"horas" siguen en 24h). Devuelve `HH:MM` normalizado.
- **Pruebas:** `npx tsc --noEmit` 0 errores; nuevos casos 12h en `test:validator`: "3:00 pm" se acepta, "7:00 am" se rechaza, "10:00 am" (apertura) se acepta; suite completa OK.
- **Versión donde se corrigió:** 2.2.5

## BUG-023: Los administradores eran atendidos por Flora y no recibían el digest de novedades
- **Prioridad:** 🔴 Crítica
- **Estado:** ✅ Resuelto (2026-08-22)
- **Reportado:** 2026-08-22 (producción)
- **Síntomas:** Al escribir un admin al bot, Flora respondía con el flujo de ventas en lugar del digest de novedades. Además el envío proactivo de las 6 am nunca llegó y el digest (`novedades_diarias`) ni siquiera existía.
- **Causa raíz:** (1) `esAdminBot` comparaba por dígitos/sufijo simple, pero el mismo número MX existe como `52XXXXXXXXXX` (12 dígitos) y `521XXXXXXXXXX` (13 dígitos) con el dígito extra EN MEDIO — ningún sufijo coincide → el intercepto nunca disparaba y el admin caía al flujo de cliente. (2) El envío proactivo armaba el JID manualmente (`telefono@s.whatsapp.net`) sin resolverlo con `onWhatsApp`, fallando con variantes MX; además no enviaba nada cuando no había novedades (silencio ambiguo). (3) La generación del digest podía quedar colgada indefinidamente si un proveedor IA no respondía (sin timeout), impidiendo guardar.
- **Corrección:**
  1. Nueva `coincideAdminPorVariantes()` en `novedad.detector.ts`: compara CONJUNTOS DE VARIANTES vía `variantesTelefono()` (misma lógica que el filtro de ignorados). `esAdminBot` la usa.
  2. `notification.service.ts`: nuevo emisor genérico `enviarTextoANumeros(sock, numeros, texto)` con resolución `onWhatsApp`, dedup por JID y aviso si el destino es el propio bot. `notificarEmpleadosWhatsApp` lo reutiliza (comportamiento preservado).
  3. `enviarNovedadesProactivo` usa `enviarTextoANumeros` y SIEMPRE envía confirmación diaria (aunque sea "No hay novedades pendientes").
  4. Timeout de 150 s por lote IA en `generarNovedadesDiarias` (`Promise.race`): el digest siempre se guarda aunque un proveedor se cuelgue.
- **Pruebas:** `npx tsc --noEmit` 0 errores; `test:novedades` ampliado con casos 12↔13 dígitos, @c.us, +/espacios y número ajeno; verificación en vivo contra la lista real de producción (`522411933932` y JID `5212411933932@s.whatsapp.net` → ADMIN); suite completa OK.
- **Versión donde se corrigió:** 2.3.1
