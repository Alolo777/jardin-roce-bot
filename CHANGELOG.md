# CHANGELOG

## 2026-07-17

Versión: 2.0.7

### Fix — Google Maps links no detectados como dirección
### Fix — Telegram no enviaba notificaciones (subscribeTelegramEvents nunca iniciado)
### Fix — Comprobante no notificaba a empleados WhatsApp

**Problema:** Los clientes enviaban links de Google Maps (`https://maps.app.goo.gl/...`) y el bot no los reconocía como dirección válida porque:
1. `parseDireccion()` no detectaba links de Maps (sin palabras clave tipo "calle")
2. El regex `GOOGLE_MAPS_REGEX` no coincidía con `maps.app.goo.gl` (formato usado actualmente)
3. `buscarEnvio()` incluía la URL en la búsqueda contra municipios, evitando matching

**Cambios:**
- `src/parser/direccion.parser.ts`: Agregado `GOOGLE_MAPS_REGEX` y detección de Maps links como `confianza: 'alta'`
- `src/validators/envio.validator.ts`: Actualizado `GOOGLE_MAPS_REGEX` para incluir `maps.app.goo.gl`; `buscarEnvio()` ahora limpia el link antes de buscar municipios, retorna null si es solo Maps link sin texto
- `bot.ts`: Actualizado inline `GOOGLE_MAPS_REGEX` para consistencia

**Impacto:** Compatible.
**Rollback:** Sí.

---

### Fix — Telegram no enviaba notificaciones

**Problema:** `subscribeTelegramEvents()` se importaba en `bot.ts` pero nunca se llamaba durante el arranque. Sin esta llamada, los suscriptores del `eventBus` nunca se registraban, por lo que ningún evento llegaba a Telegram (ni comprobantes, ni ventas cerradas, ni alertas).

**Causa raíz:** En la secuencia de arranque (`bot.ts:2458-2461`) faltaba la invocación a `subscribeTelegramEvents()`.

**Cambio:**
- `bot.ts`: Agregada llamada `subscribeTelegramEvents()` después de `cargarEstado()` en la secuencia de arranque.

**Impacto:** Ahora los 25 eventos emitidos por el `eventBus` se reenvían a Telegram.
**Rollback:** Revertir línea agregada.

---

### Fix — Comprobante no notificaba a empleados WhatsApp

**Problema:** Cuando un cliente enviaba un comprobante de pago, el equipo no recibía ninguna notificación por WhatsApp. La foto del comprobante solo se emitía como evento `PHOTO_RECEIVED` (que antes no llegaba a Telegram por Bug #2), pero nunca se llamaba a `enviarFotoEmpleadosWhatsApp` ni `notificarEmpleadosWhatsApp`.

**Causa raíz:** En `procesarMediaAcumulado()` (`bot.ts:902-910`), el bloque `esComprobante` solo emitía un evento, a diferencia del bloque `esReferencia` (línea 919) que SÍ enviaba la foto a empleados.

**Cambio:**
- `bot.ts`: Agregadas llamadas a `enviarFotoEmpleadosWhatsApp` (envía la foto del comprobante) y `notificarEmpleadosWhatsApp` (envía alerta de texto) en el bloque `esComprobante` de `procesarMediaAcumulado`.

**Impacto:** El equipo recibe el comprobante y una alerta por WhatsApp cuando un cliente paga.
**Rollback:** Revertir líneas agregadas en `procesarMediaAcumulado`.

---

## 2026-07-17

Versión: 2.0.6

### Fix — 6 issues de producción

**Problema:** Conversación 2411237222 (17-Jul, cliente Noé Gallardo, $180 ramo rosas, sucursal Centro, domingo 9am, transferencia): comprobante recibido pero venta nunca se cerró, equipo no notificado, pedido perdido.

**Archivos modificados:**
- `bot.ts`
- `src/pedidos/pedido.repository.ts`
- `src/pedidos/pedido.service.ts`
- `lib/ai.ts`
- `src/api/server.ts`
- `app/api/bot/diag/[chatId]/route.ts` (NEW)
- `scripts/update-system-prompt.ts` (NEW)

**Cambios:**

1. **Fix 1 — Comprobante no cierra venta (`bot.ts:1602`)**: Cuando `tipoMediaProcesada === 'comprobante'` y la venta es closable (`ventaListaParaCerrar` y no cerrada), llama `ventaCerradaHandler` directamente (emite ORDER_CREATED, PAYMENT_RECEIVED, PAYMENT_CONFIRMED, resetea pedido). Si la venta no está lista, envía el agradecimiento simple previo.

2. **Fix 2 — Photo selection sin notificación (`bot.ts:1618`)**: Elimina el requisito de keyword `precio|cuánto|saldría|costaría` para notificar al equipo cuando el cliente selecciona una foto disponible. Ahora `seleccionaFotoDisponible && !tienePrecioConfirmado` basta para alertar.

3. **Fix 3 — Early delivery no detectado (`bot.ts:1259`)**: Elimina el guard `tieneArregloVerificado(clienteId)` de la condición de `esHorarioAnticipado`. Ahora se detectan entregas antes de las 10:00 incluso sin arreglo verificado, emitiendo `HUMAN_REQUIRED` a Telegram.

4. **Fix 4 — Order Engine no escribe a `pedidos_bot` (`pedido.repository.ts`, `pedido.service.ts`)**: Agrega `sincronizarPedidosBot()` que mapea `EstadoPedido → estado (cotizacion/apartado/pagado/entregado/cancelado)` y upserta cada pedido activo a `pedidos_bot`. Se llama desde `persistir()` (cada vez que se crea, transita, archiva o cancela un pedido). El dashboard ahora refleja cambios del Order Engine.

5. **Fix 5 — System prompt sin política de anticipo (`lib/ai.ts`, `scripts/update-system-prompt.ts`)**: Agrega en la sección Pagos:
   - "Anticipo mínimo del 50% del total para apartar el pedido. El resto se paga al recoger o antes de la entrega."
   - "Si el cliente quiere depositar en efectivo en sucursal, puede hacerlo días antes de la entrega. Coordina con el equipo para recibir el pago anticipado."
   - Script `scripts/update-system-prompt.ts` para sincronizar con Supabase (`tsx scripts/update-system-prompt.ts`).

6. **Fix 6 — Endpoint de diagnóstico (`src/api/server.ts`, `app/api/bot/diag/[chatId]/route.ts`, `bot.ts`)**: Agrega `GET /diag/:chatId` en Express + Next.js route `/api/bot/diag/[chatId]` que expone: `pedidoEnCurso`, `ventaCerrada`, `arregloElegido`, `pedidoEngine`, `tienePrecio`, `tieneNombre`, `fechaHora`, `tieneFotoReferencia`, `estadoFlujo`.

**Impacto:** Compatible.
**Rollback:** Sí.

---

## 2026-07-17

Versión: 2.0.5

### Fix — nombre.parser.ts: rechazar frases conversacionales como nombre de cliente

**Problema (Issue #1 de sesión):** El nombre del cliente se contaminaba con "Okey está bien" porque `pareceNombreCliente()` aceptaba frases conversacionales como nombres válidos. Esto causaba que `ventaCerradaHandler` emitiera eventos a Telegram con `cliente: "Okey está bien"` en lugar del nombre real "José Luis López González".

**Causa raíz (logs producción 17-Jul):**
1. Batch `"Okey está bien\n---\nSe podría para mañana?"` → primera línea = "Okey está bien"
2. `pareceNombreCliente("Okey está bien")` → TRUE porque "está", "bien", "okey" no estaban en `NO_ES_NOMBRE`
3. `pedido.nombre = "Okey está bien"` se fija incorrectamente
4. Llega "José Luis López González" pero `pedido.nombre` ya existe → no se sobrescribe

**Cambio:**
- `src/parser/nombre.parser.ts`: `NO_ES_NOMBRE` ampliado con `está`, `esta`, `bien`, `okey`, `vale`, `dale`, `va`, `entregan`, `podría`, `podria`, `necesito`, `quisiera`, `quiere`, `quiero`, `tiene`, `tienen`, `listo`

**Impacto:** Bug de producción corregido. Nombres como "José Luis López González" se extraerán correctamente porque frases conversacionales ("Okey está bien", "está bien", "okey", "listo") ya no pasan como nombres.

**Rollback:** Revertir `NO_ES_NOMBRE` a versión anterior.

---

### Fix — bot.ts: ventaDesdeEstado + ventaCerradaHandler emiten datos correctos a Telegram

**Problema (Issue #1):** Los eventos `PAYMENT_RECEIVED` y `PAYMENT_CONFIRMED` se emitían a Telegram con `cliente: "Okey está bien"` y `producto: "Me gustó este que precio tiene"` (texto de caption de foto).

**Causa raíz:**
1. `ventaDesdeEstado()` usaba `pedido?.nombre` sin fallback al Order Engine y usaba `pedido?.productoPersonalizado` como producto (se contaminaba con caption de foto)
2. `ventaCerradaHandler()` solo emitía PAYMENT_RECEIVED/PAYMENT_CONFIRMED sin ORDER_CREATED (que tiene más detalles)
3. El nombre extraído no se sincronizaba con el Order Engine

**Cambios en `bot.ts`:**
- `ventaDesdeEstado()`: `producto` ya no usa `pedido?.productoPersonalizado` (solo `elegido?.nombre ?? fallback?.producto`); `cliente` agrega `obtenerPedido(clienteId)?.nombre` como fallback
- `ventaCerradaHandler()`: emite `ORDER_CREATED` con precioArreglo, precioExtras, precioEnvio, fechaHora, tieneFotoReferencia
- Sincronización: el nombre extraído se replica de `PEDIDO_EN_CURSO` al Order Engine (`obtenerPedido(clienteId).nombre`) en `aplicarDatosPedidoDesdeTexto` y en el bloque de extracción inline

**Impacto:** Los eventos de Telegram ahora muestran nombre real del cliente, producto correcto y detalles completos de la compra.

**Rollback:** Revertir ediciones en bot.ts.

---

### Fix — horario.validator.ts + bot.ts: horarios anticipados derivados a equipo humano

**Problema (Error #3 de AGENTS.md):** El LLM confirmaba horarios incorrectamente (ej. "Sí podemos" a las 9:30 cuando la apertura es 10:00). El horario validator solo informaba al LLM sin intervención del backend.

**Causa raíz:** No existía detección ni manejo backend de solicitudes de entrega antes de la hora de apertura. La decisión quedaba en manos del LLM.

**Cambios:**
- `src/validators/horario.validator.ts`: Nueva función `esHorarioAnticipado(hora)` que parsea "9:30", "9:30 am", "3:30 pm" y retorna `true` si la hora es antes de las 10:00 (convierte am/pm a 24h)
- `bot.ts`: Detección post-extracción de hora. Si `esHorarioAnticipado` es `true`:
  1. `pedido.estadoFlujo = 'esperando_fecha_hora'`
  2. Emite `HUMAN_REQUIRED` a Telegram con dedup de 30 min
  3. Agrega instrucción en `contextoExtra` para que el LLM no confirme/rechace el horario y responda "Consulto con el equipo..."

**Impacto:** El equipo recibe notificación cuando un cliente pide entrega antes de las 10:00. El LLM ya no confirma horarios incorrectamente.

**Rollback:** Revertir ediciones en bot.ts y horario.validator.ts.

---

### Fix — Order Engine persiste en bot_cache (sobrevive reinicios)

**Problema:** El Order Engine (`pedido.service.ts`) almacenaba pedidos activos solo en memoria RAM (`Map<string, PedidoActual>`). Al reiniciar el bot, todos los pedidos activos se perdían: el dashboard mostraba 0 pedidos activos hasta que los clientes volvían a escribir.

**Causa raíz:** No existía persistencia para el `PEDIDOS` Map del Order Engine. Solo los Maps de notificaciones/dedup (`bot-state.ts`) se persistían via `bot-state-persistence.ts`.

**Cambios:**
- `src/pedidos/pedido.repository.ts` (NUEVO): `guardarPedidos(mapa)` escribe el Map completo en `bot_cache` clave `pedidos_engine` (como JSONB, omitiendo `fotoReferenciaBase64` para evitar datos grandes); `cargarPedidos()` restaura desde `bot_cache`
- `src/pedidos/pedido.service.ts`: Se agrega `persistir()` fire-and-forget que se llama después de `crearPedido`, `transitar`, `archivarPedido`, `cancelarPedido`. Se exporta `cargarPedidosDesdeBD()` para carga al arranque.
- `bot.ts`: Se importa y llama `cargarPedidosDesdeBD()` en el startup (tras `cargarEstado()`)

**Impacto:** Los pedidos activos sobreviven a reinicios del bot. El dashboard recupera el estado correcto inmediatamente.

**Rollback:** Revertir ediciones en pedido.service.ts, bot.ts; eliminar pedido.repository.ts.

---

### Fix — nombre.parser.ts: `no` en NO_ES_NOMBRE ya no bloquea nombres como "Noé"

**Problema:** `\bno\b` con la bandera `i` coincidía con "No" dentro de "Noé" porque JS `\b` trata `é` como `\W` (no está en `[a-zA-Z0-9_]`). Esto causaba que `pareceNombreCliente("Noé Hernández")` retornara `false` y `parseNombre` truncara el nombre.

**Causa raíz:** JavaScript `\b` no reconoce caracteres acentuados como `\w`. Cualquier palabra de 2+ letras sin acento seguida de una letra acentuada (como "No" + "é") tiene un falso `\b` entre ambas.

**Cambios en `src/parser/nombre.parser.ts`:**
- `no` se eliminó de `STOP_PATTERN` (usado para split) y de `NO_ES_NOMBRE_REGEX` (usado para detección)
- Se creó `NO_INDEPENDIENTE = /(?:^|[\s,.;:!?¡¿])no(?:$|[\s,.;:!?¡¿])/i` que usa separadores explícitos en lugar de `\b`, y por tanto no se activa con "Noé" (donde `é` no es separador)
- `esNoNombre()` reemplaza a `NO_ES_NOMBRE.test()`

**Impacto:** Nombres como "Noé Hernández", "Noé González", "Noemí López" ya no son bloqueados. "no" como palabra independiente sigue siendo correctamente rechazado.

**Rollback:** Revertir a versión anterior de nombre.parser.ts.

---

## 2026-07-16

Versión: 2.0.4

### Fix — events/ → src/events/ (build Vercel) + M10a — Validadores (Julio 2026)

**Fix build (Vercel):**
- Movido `events/` → `src/events/` para resolver error de módulo en Next.js
- Actualizados imports en `bot.ts`, `src/casos/caso.service.ts`, `src/pedidos/pedido.service.ts`, `src/events/telegram.subscriber.ts`

**M10a — Validadores horario y pago:**
- `src/validators/horario.validator.ts` — `validarHorario()`, constantes de horario
- `src/validators/pago.validator.ts` — CUENTA_BBVA, `determinarInstruccionPago()`, detectores de texto de pago
- Ambos exportan datos estructurados (no texto prompt)

**Pendiente:** Conectar validadores a bot.ts para reemplazar contextoExtra inline.

### M10b — Validadores sucursal + envío (Julio 2026)

**Archivos creados:**
- `src/validators/sucursal.validator.ts` — `validarSucursal()`, `obtenerTextoConfirmacionSucursal()`, `clienteQuiereRecoger()`, registro de sucursales
- `src/validators/envio.validator.ts` — `buscarEnvio()`, `detectarLinkMaps()`, `pareceConsultaEnvio()`, caché de municipios/zonas con TTL, `limpiarDireccionCliente()`

**Pendiente:** M10c (cancelación + queja) y M10d (conectar a bot.ts).

### M10c — Validadores cancelación + queja (Julio 2026)

**Archivos creados:**
- `src/validators/cancelacion.validator.ts` — `evaluarCancelacion(texto, clasificacionIA)` devuelve `{ detectada, descartadaPorIA, instruccion }`
- `src/validators/queja.validator.ts` — `evaluarQueja(texto, clasificacionIA)` devuelve `{ detectada, descartadaPorIA, instruccion }`

**Reglas extraídas del prompt (contextoExtra en bot.ts):**
- Cancelación: empatía, notificar equipo, NO reembolsos/descuentos
- Queja: empatía, disculpas, reportar equipo, NO compensaciones/descuentos

**Pendiente:** M10d (conectar los 6 validadores a bot.ts para reemplazar los bloques inline de contextoExtra).

### Prompt — Nuevo system prompt alineado a arquitectura (Julio 2026)

**Cambios:**
- `lib/ai.ts`: `FALLBACK_SYSTEM_PROMPT` reemplaza el fallback mínimo con el prompt completo alineado a la arquitectura de motores.
- El prompt real de producción vive en Supabase (`configuracion_bot` clave `system_prompt`) y se actualiza desde el Dashboard "Cerebro"; este fallback cubre fallo de Supabase.

**Ajustes de arquitectura aplicados al prompt:**
- Obedece primero las anotaciones del backend (`[CASO ACTIVO]`, `[PEDIDO ACTIVO]`, `[CLIENTE PREGUNTA POR ENVÍO]`, etc.).
- Token `[VENTA_CERRADA:...]` ahora es respaldo opcional (Error #4): el backend registra el pedido por su cuenta.
- Refuerza que el precio de envío lo confirma UNA COMPAÑERA DEL EQUIPO, no el bot.
- Documenta las anotaciones que inyecta `contextoExtra` (Error #5, fotos, intervención humana).
- Mantiene cuenta BBVA y precios de flores editables desde el panel (decisión del usuario).

**Impacto:** Compatible. Rollback: revertir fallback.

---

### P2.1 — Error #5: conversación ≠ pedido (Julio 2026)

**Problema (AGENTS.md Error #5):** El pedido en memoria (`obtenerPedido`) se reutilizaba aunque el caso cambiara de tema, mezclando datos antiguos (nombre, precio, arreglo, sucursal, fecha).

**Cambios (solo `bot.ts`):**
- Nueva `sincronizarPedidoConCaso(clienteId, telefono, cambioTema)`: resetea `PEDIDO_EN_CURSO`, `ARREGLO_ELEGIDO`, `VENTA_ACTUAL` y crea pedido limpio cuando hay cambio de tema o no existe pedido.
- En el flujo principal se captura `cambioTema = detectarCambioTema(...)` y se pasa a la función, reemplazando el `if (!obtenerPedido) crearPedido` ciego.

**Impacto:** Compatible. Reversible. No afecta Telegram ni Supabase. Rollback: revertir edición.

---

### M11b — Verificación Event Engine 100% (Julio 2026)

**Resultado de investigación:**
- `src/events/telegram.subscriber.ts` suscribe 25 eventos del `eventBus`.
- `bot.ts` emite eventos para ORDER_CREATED, HUMAN_REQUIRED, CUSTOMER_ANGRY, PHOTO_*, PAYMENT_*, ZONA_AMBIGUA, CANCELACION, COTIZACION, ENVIO, CASE_*, BOT_* y más.
- `bot.ts` NO contiene llamadas directas a `lib/telegram`: Telegram depende exclusivamente de eventos (cumple AGENTS.md Error #6 y Parte 3).
- Las `notificarEmpleadosWhatsApp(sock, ...)` en bot.ts son canal WhatsApp a empleados, NO Telegram; quedan fuera del Event Engine.

**Decisión:** M11b se cierra como verificación. La reducción de `bot.ts` a < 500 líneas se difiere a Fase 10 (Optimización) por ser refactor masiva de alto riesgo en producción.

**Impacto:** Sin cambios de código. Rollback: N/A.

---

### Fix — type-check lib/ai.ts y lib/googleSheets.ts (build Vercel #6) (Julio 2026)

**Errores:**
- `lib/ai.ts:548`: `replace(ventaCerrada.rawToken)` con `rawToken` posiblemente `undefined`.
- `lib/ai.ts:551`: `return { mensaje, ventaCerrada }` no compatible con `AIResponse`.
- `lib/googleSheets.ts:33,48`: parámetros implícitamente `any` (TS7006).

**Cambios:**
- `lib/ai.ts`: `replace` solo si `ventaCerrada?.rawToken` existe.
- `lib/types.ts`: `AIResponse` ahora incluye `ventaCerrada?: VentaCerrada | null`.
- `lib/googleSheets.ts`: tipado explícito de `rows` y parámetros de `map`/`filter`.

**Impacto:** Compatible. No altera flujo de venta. Rollback: revertir tipos.

---

### Fix — VentaCerrada.rawToken opcional (build Vercel #5) (Julio 2026)

**Error:** `./bot.ts:738 Type error: Property 'rawToken' is missing in type ... but required in type 'VentaCerrada'.`

**Causa:** `lib/types.ts` (remoto) marcaba `rawToken` como requerido en `VentaCerrada`. `ventaDesdeEstado` no lo proveía. Según AGENTS.md Error #4, el pedido no debe depender del token.

**Cambios:**
- `lib/types.ts`: `rawToken: string` → `rawToken?: string` (opcional).

**Impacto:** Compatible. Rollback: revertir a requerido.

---

### Fix — models/ → src/models/ (build Vercel #4) (Julio 2026)

**Error:** `./bot.ts:51 Type error: Cannot find module './models/types'`

**Causa:** Next.js/Vercel no resuelve imports relativos a directorios raíz fuera de `src/`.

**Cambios:**
- Movido `models/` → `src/models/`
- `bot.ts` import: `'./models/types'` → `'./src/models/types'`
- Ajustadas rutas relativas en `src/decision`, `src/casos`, `src/openai`, `src/pedidos` (`../../models` → `../models`) y `src/orchestrator.ts` (`../models` → `./models`).

**Impacto:** Compatible. Rollback: revertir movimiento.

---

### Fix — parser/ → src/parser/ (build Vercel #3) (Julio 2026)

**Error:** `./bot.ts:46 Type error: Cannot find module './parser'`

**Causa:** Next.js/Vercel no resuelve imports relativos a directorios raíz fuera de `src/`.

**Cambios:**
- Movido `parser/` → `src/parser/`
- `bot.ts` import: `'./parser'` → `'./src/parser'`
- Ajustadas rutas relativas en `src/validators/*.ts`, `src/whatsapp/bot-state.ts`, `src/whatsapp/notification.service.ts` (`../../parser` → `../parser`).

**Impacto:** Compatible. Rollback: revertir movimiento.

---

### M11a — Dashboard: Panel de Operaciones (Julio 2026)

**Cambios:**
- Nuevo `app/admin/operaciones/page.tsx`: Client Component que consume `/api/bot/status` cada 15s y muestra pedidos activos agrupados por estado de la máquina de estados (NUEVO→LISTO) + tarjetas de resumen + alerta de zonas ambiguas.
- Agregado enlace "Operaciones 📋" a `app/admin/page.tsx` (FEATURES).

**Impacto:** Compatible. Reusa endpoint existente. Rollback: eliminar página y link.

---

### Fix — api/ → src/api/ (build Vercel #2) (Julio 2026)

**Error:** `./bot.ts:29:29 Cannot find module './api/server'`

**Causa:** Next.js/Vercel no resuelve imports relativos a directorios raíz fuera de `src/` al compilar `bot.ts`.

**Cambios:**
- Movido `api/server.ts` → `src/api/server.ts`
- `bot.ts` import actualizado: `'./api/server'` → `'./src/api/server'`

**Impacto:** Compatible. Rollback: revertir movimiento.

---

### M10d — Conectar validadores a bot.ts (Julio 2026)

**Archivo modificado:** `bot.ts`
- Importados `validarHorario`, `obtenerTextoCuenta`, `validarSucursal`, `obtenerTextoConfirmacionSucursal`, `buscarEnvio`, `pareceConsultaEnvio`, `evaluarCancelacion`, `evaluarQueja`
- `getContextoHorario()` reemplazado por `validarHorario().mensajeBackend`
- Bloque CANCELACIÓN usa `evaluarCancelacion()`
- Bloque QUEJA usa `evaluarQueja()`
- Bloque ENVÍO usa `buscarEnvio()` y `pareceConsultaEnvio()`
- Texto BBVA inline reemplazado por `obtenerTextoCuenta()`
- Texto dirección sucursal inline reemplazado por `obtenerTextoConfirmacionSucursal(validarSucursal(...))`
- Eliminado import muerto `getContextoHorario`

**Resultado:** Las reglas de horario, pago, sucursal, envío, cancelación y queja ahora viven en `src/validators/*.ts`. El LLM recibe instrucciones ya decididas por el backend (DEC-018).

**Impacto:** Compatible. Rollback: revertir ediciones de bot.ts.

---

**Pendiente:** M10d (conectar los 6 validadores a bot.ts para reemplazar los bloques inline de contextoExtra).

---

**Pendiente:** M10c (cancelación + queja) y M10d (conectar a bot.ts).

---

### M9 — Persistencia Supabase para bot-state (Julio 2026)

**Archivos creados:**
- `supabase_migration_bot_cache.sql` — tabla `bot_cache` (key PK, value JSONB, updated_at)
- `src/whatsapp/bot-state-persistence.ts` — servicio cargar/guardar/iniciarPersistenciaPeriodica

**Archivos modificados:**
- `bot.ts` — +import, +cargarEstado() + iniciarPersistenciaPeriodica() en startup, +guardarEstado() en gracefulShutdown

**Qué persiste:** ULTIMA_INTERVENCION_HUMANA, ALERTAS_DEDUP, RATE_TIMESTAMPS, FRUSTRACION_NOTIFICADA, ATENCION_HUMANA_NOTIFICADA, INTERES_COMPRA_NOTIFICADO, RECLAMACION_NOTIFICADA, ENVIO_NOTIFICADO, FOTOS_NOTIFICADO, FOTOS_DISPONIBLES_RECIENTES

**Estrategia:** Carga al inicio. Guarda cada 5 min (setInterval). Guarda en SIGINT/SIGTERM.

**Impacto:** Compatible. Necesita ejecutar migration SQL en Supabase.
**Rollback:** Sí.

---

### M8 — Rate limiter a bot-state.ts

**Archivos modificados:**
- `src/whatsapp/bot-state.ts` — +RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, RATE_AVISADOS, estaRateLimited
- `bot.ts` — eliminadas 17 líneas de declaraciones antiguas, actualizado import

**Métrica:** bot.ts: 2455 → 2438 líneas (-17)
**Impacto:** Compatible.
**Rollback:** Sí.

---

## 2026-07-16

Versión: 2.0.3

### PHOTO_RECEIVED — Telegram por eventos

Archivos modificados:
- `bot.ts` — Se eliminaron 4 llamadas directas a Telegram
- `events/telegram.subscriber.ts` — Nueva suscripción a PHOTO_RECEIVED

Cambios:
- Las 4 llamadas directas a `enviarMediaTelegram`/`enviarFotoTelegram` en `procesarMediaAcumulado` y el bloque `finally` se reemplazaron por `eventBus.emit(EventType.PHOTO_RECEIVED, ...)`
- El wrapper `enviarMediaTelegram` se eliminó de bot.ts
- Se removió el import directo de `enviarFotoTelegram`/`enviarArchivoTelegram` de bot.ts
- `events/telegram.subscriber.ts` ahora escucha `PHOTO_RECEIVED` y llama a `enviarFotoTelegram` según el tipo (comprobante, referencia, otra, pendiente)

Impacto: Compatible — las fotos siguen llegando a Telegram, ahora vía eventos.
Rollback: Sí — revertir eventBus.emit a llamadas directas.

---

### P2.1 — Conversation Service

Archivos modificados:
- `bot.ts` — Se removieron ~130 líneas de funciones de conversación
- `src/conversation/conversation.service.ts` — Nuevo archivo

Cambios:
- Se extrajeron todas las funciones de historial y deduplicación de `bot.ts` a `src/conversation/conversation.service.ts`
- Funciones movidas: `variantesTelefono`, `jidToTelefono`, `extraerTelefono`, `obtenerClienteId`, `obtenerHistorial`, `agregarAlHistorial`, `obtenerMensajeId`, `marcarMensajeProcesado`, `yaProcesadoRecientemente`, `normalizarTexto`
- Constantes movidas: `MAX_TURNOS_HISTORIAL`, `MENSAJE_PROCESADO_TTL_MS`
- Maps movidos: `CACHE_CLIENTE_UUID`, `MENSAJES_PROCESADOS`
- `bot.ts` ahora importa estas funciones desde el nuevo módulo
- `limpiarCachesConversacion()` reemplaza la limpieza manual de cachés de conversación en el watchdog de RAM

Impacto: Compatible — solo cambio de imports, lógica idéntica.
Rollback: Sí — revertir imports y restaurar funciones locales en bot.ts.

---

### P0.1 — Separar Express Server (sesión anterior)

Archivos creados:
- `api/server.ts` — Servidor Express extraído de bot.ts
- `proxy.ts` — Proxy para WhatsApp

Cambios:
- El servidor HTTP que antes vivía en bot.ts ahora se maneja desde `api/server.ts`
- `bot.ts` importa `startServer` desde el módulo separado
- Endpoints: `/`, `/pause`, `/resume`, `/reconnect`, `/recover`, `/qr`, `/status`

Impacto: Compatible.
Rollback: Sí.

---

### P0.2 — Sistema de Eventos (sesión anterior)

Archivos creados:
- `events/event-bus.ts` — Bus de eventos tipo pub/sub
- `events/types.ts` — Enums `EventType` y tipos `EventPayload`, `SystemEvent`
- `events/telegram.subscriber.ts` — Suscriptor que reenvía eventos a Telegram

Cambios:
- Se implementó un bus de eventos interno con tipado fuerte
- `EventType` cubre: CASE_CREATED, ORDER_CREATED, ORDER_UPDATED, PAYMENT_PENDING, PAYMENT_RECEIVED, HUMAN_REQUIRED, CUSTOMER_ANGRY, PHOTO_REQUESTED, COTIZACION_REQUESTED, ENVIO_REQUESTED, CANCELACION_REQUESTED, QR_GENERATED, BOT_CONNECTED, BOT_DAILY_ALERT, etc.
- `telegram.subscriber.ts` escucha eventos del bus y envía notificaciones a Telegram
- `bot.ts` ahora emite eventos en lugar de llamar directamente a Telegram en muchos flujos

Impacto: Compatible.
Rollback: Sí.

---

### P1.4 — Enums y Tipos Oficiales (sesión anterior)

Archivos creados:
- `models/types.ts` — Enums e interfaces oficiales del sistema

Cambios:
- `EstadoPedido`: NUEVO, COTIZANDO, PRECIO_CONFIRMADO, ESPERANDO_DATOS, ESPERANDO_PAGO, APARTADO, EN_PRODUCCION, LISTO, ENTREGADO, ARCHIVADO, CANCELADO, QUEJA, POSTVENTA
- `EstadoCaso`: ACTIVO, ARCHIVADO
- `TipoCaso`: COTIZACION, PEDIDO, DUDA, QUEJA, POSTVENTA, INFORMACION
- `Intencion`: 20 valores (SALUDO a OTRO)
- `Prioridad`: BAJA, MEDIA, ALTA, CRITICA
- Interfaces: `PedidoActual`, `Caso`, `Cotizacion`, `ArregloInfo`, `EnvioInfo`, `PedidoExtra`

Impacto: Compatible — solo tipos nuevos, no hay cambios de comportamiento.
Rollback: Sí.

---

### P1.5 — Parsers Especializados (sesión anterior)

Archivos creados:
- `parser/index.ts` — Barrel export
- `parser/nombre.parser.ts` — Extrae nombre del cliente, se detiene en comas/puntos/conectores
- `parser/fecha.parser.ts` — Parsea fechas (hoy, mañana, lunes, 12 de marzo)
- `parser/hora.parser.ts` — Parsea horas (a las 9:30, en la mañana, al mediodía)
- `parser/sucursal.parser.ts` — Detecta sucursal (Norte, Centro, Sur, Apizaco) con confianza
- `parser/direccion.parser.ts` — Parsea direcciones con nivel de confianza
- `parser/precio.parser.ts` — Extrae montos con tres estrategias de regex
- `parser/telefono.parser.ts` — Utilidades: limpiar, formatear, enmascarar, detectar Lid

Cambios:
- Se eliminaron las funciones de parseo inline de bot.ts
- Cada parser tiene su propia responsabilidad y archivo
- Los parsers devuelven nivel de confianza para evitar falsos positivos

Impacto: Compatible.
Rollback: Sí.

---

### P1.6 — Eliminar Dependencia de Token VENTA_CERRADA (sesión anterior)

Cambios:
- Se eliminó toda dependencia del token `[VENTA_CERRADA]` en el prompt y en bot.ts
- El flujo de cierre de venta ahora depende de eventos y estados, no de que el LLM genere un token específico
- Los pedidos persisten independientemente de la respuesta del modelo

Impacto: Compatible — corrige el Error #4 de pedidos perdidos.
Rollback: Sí.

---

## 2026-07-16 (continuación)

### P3.10 — Decision Engine implementado

Archivos creados:
- `src/decision/decision.engine.ts` — Motor de decisiones (cerebro del sistema)
- `src/decision/index.ts` — Barrel export

Archivos modificados:
- `bot.ts` — Reemplazada función `detectarIntencion` inline por `analizarIntencion`

Cambios:
- `analizarIntencion()` — Clasifica 20 intenciones (SALUDO a OTRO) usando reglas de texto
- `clasificarPrioridad()` — Asigna BAJA/MEDIA/ALTA/CRITICA según intención y contenido
- `detectarHumano()` — Detecta cuándo derivar a humano (quejas, cancelaciones, reembolsos)
- `detectarCambioTema()` — Detecta cambios de tema por inactividad o palabras clave
- OpenAI ya no decide la intención — el backend lo hace con reglas determinísticas

Impacto: Compatible. Las decisiones críticas ahora pertenecen al backend.
Rollback: Sí — revertir import y restaurar función inline en bot.ts.

---

### P3.11 — Prompt Builder implementado

Archivos creados:
- `src/openai/prompt.builder.ts` — Construcción dinámica del contexto para el prompt
- `src/openai/index.ts` — Barrel export

Archivos modificados:
- `bot.ts` — `construirContextoPrompt` ahora genera contexto estructurado con datos de Case/Decision/Order Engine

Cambios:
- `construirContextoPrompt()` — Genera contexto estructurado: [CASO ACTIVO], [PEDIDO ACTIVO], [INTENCION DETECTADA], [PRIORIDAD]
- `construirPromptCompleto()` — Ensambla prompt final con system prompt + contexto + historial
- El contexto extra ahora incluye información validada del backend, no solo texto libre

Impacto: Compatible. El prompt existente en Supabase sigue funcionando.
Rollback: Sí.

---

### P3.12 — Orquestador creado (bot.ts < 200 líneas preparación)

Archivos creados:
- `src/orchestrator.ts` — Orquestador que unifica Decision + Case + Order + Prompt engines

Cambios:
- `procesarMensajePre()` — Función de pre-procesamiento que asegura caso activo, pedido activo, analiza intención y construye contexto
- Establece la estructura para que bot.ts eventualmente solo importe y delegue
- bot.ts actual: ~2870 líneas (pendiente de extracción progresiva)

Impacto: Compatible. Nueva función no interfiere con flujo existente.
Rollback: Sí.

---

### P3.13 — Estructura src/ con barrel exports

Archivos creados:
- `src/index.ts` — Barrel export global
- `src/casos/index.ts` — Barrel export
- `src/pedidos/index.ts` — Barrel export
- `src/decision/index.ts` — Barrel export
- `src/openai/index.ts` — Barrel export
- `src/conversation/index.ts` — Barrel export

Cambios:
- Cada módulo en src/ ahora tiene su propio `index.ts` para imports limpios
- `src/index.ts` re-exporta todo para uso externo
- Preparación para migrar imports de bot.ts hacia src/

Impacto: Compatible. Los imports existentes (ej: `from './src/casos/caso.service'`) siguen funcionando.
Rollback: Sí.

---

### P2.9 — Order Engine implementado

Archivos creados:
- `src/pedidos/pedido.service.ts` — Motor de pedidos con máquina de estados formal

Archivos modificados:
- `bot.ts` — Integración del Order Engine (import + creación de pedido en procesarMensaje + watchdog RAM)

Cambios:
- `crearPedido()` — Crea pedido en estado NUEVO, emite ORDER_CREATED
- `transitar(pedido, nuevoEstado)` — Valida transición según máquina de estados de AGENTS.md. Rechaza saltos inválidos (ej: NUEVO → ENTREGADO)
- `obtenerPedido()` — Obtiene pedido activo por clienteId
- `archivarPedido()` / `cancelarPedido()` — Archiva o cancela con emisión de eventos
- `transitarDesdeFlujo()` — Mapea estados legacy (EstadoFlujoPedido) a EstadoPedido oficial
- Máquina de estados: NUEVO → COTIZANDO → PRECIO_CONFIRMADO → ESPERANDO_DATOS → ESPERANDO_PAGO → APARTADO → EN_PRODUCCION → LISTO → ENTREGADO → ARCHIVADO (+ CANCELADO, QUEJA, POSTVENTA)
- Watchdog de RAM limpia pedidos inactivos (>72h)
- Coexiste con el sistema legacy PEDIDO_EN_CURSO — migración progresiva

Impacto: Compatible — nuevo sistema de estados convive con el legacy sin interferir.
Rollback: Sí — revertir imports y lógica de pedido en bot.ts.

---

### P2.8 — Case Engine implementado

Archivos creados:
- `src/casos/caso.service.ts` — Motor de casos (nuevo)
- `supabase_migration_casos.sql` — Migración para tabla `casos`

Archivos modificados:
- `bot.ts` — Integración del Case Engine en `procesarMensaje` y watchdog de RAM

Cambios:
- `crearCaso()` — Crea casos ACTIVOS, emite `CASE_CREATED`. Reusa casos activos del mismo tipo <24h
- `obtenerCasoActivo()` — Busca caso activo en caché en memoria
- `archivarCaso()` — Archiva y emite `CASE_ARCHIVED`
- `detectarCambioTema()` — Detecta cambio de tema por inactividad (>24h) o palabras clave ("otro pedido", "ahora quiero")
- `clasificarTipoCaso()` — Clasifica el texto en TipoCaso (COTIZACION, PEDIDO, QUEJA, etc.)
- Integración en `procesarMensaje`: al recibir mensaje, se asegura un caso activo antes de procesar
- Watchdog de RAM ahora también limpia cachés de casos inactivos (>72h)

Impacto: Compatible — el flujo de mensajes no cambia, solo se enriquece con metadatos de caso.
Rollback: Sí — revertir imports y lógica de caso en bot.ts.

---

### P1.5 — Parsers conectados a bot.ts (P1 completado)

Archivos modificados:
- `bot.ts` — 11 ediciones reemplazando lógica inline por parsers especializados

Cambios:
- **precio.parser.ts**: `extraerPrecioRespuesta` ahora llama a `parsePrecio` (3 sitios de llamada)
- **nombre.parser.ts**: Eliminada función `pareceNombreCliente` inline (ahora importada). `extraerNombrePedido` ahora llama a `parseNombre`
- **fecha.parser.ts + hora.parser.ts**: `extraerFechaHoraPedido` ahora usa `extraerFecha` y `extraerHora`
- **sucursal.parser.ts**: Reemplazada lógica inline de sucursal en 2 lugares con `parseSucursal`. **Corrige Error #2** — ya no se asigna 'Apizaco (sucursal)' por defecto
- **telefono.parser.ts**: Limpieza de teléfono en `notificarEmpleadosWhatsApp` y `enviarFotoEmpleadosWhatsApp` ahora usa `limpiarTelefono`
- **direccion.parser.ts**: Detección de dirección en `procesarMensaje` y `buscarPrecioEnvio` ahora usa `parseDireccion`

Impacto: Compatible — corrige Errores #1 (parser de nombre) y #2 (sucursal por defecto). Elimina ~60 líneas de código duplicado.
Rollback: Sí.

---

### P0.1 — Express duplicado eliminado de bot.ts (completado)

Archivos modificados:
- `bot.ts` — Eliminadas ~93 líneas de código Express duplicado (L2829-2922)
- `bot.ts` — Eliminado `import express from 'express'` sobrante (L2833)

Cambios:
- El bloque inline de Express que duplicaba `api/server.ts` fue eliminado
- El servidor web ahora se ejecuta exclusivamente desde `api/server.ts` con inyección de dependencias vía `BotContext`
- `startServer({...})` y su import permanecen intactos
- `bot.ts` se redujo de 2937 → 2844 líneas

Impacto: Ninguno — `api/server.ts` ya manejaba todas las rutas. Se elimina un conflicto de puertos latente.
Rollback: Sí — restaurar el bloque eliminado.

---

### P3 — Refactorización modular (Julio 2026)

**Nuevos módulos creados en `src/`:**

**P3.5 — WhatsApp Services**
- `src/whatsapp/message-utils.ts` — Extracción de contenido de mensajes Baileys, detección de tipo, descarga de media, horario CDMX, JID→número
- `src/whatsapp/contact.service.ts` — Resolución de LID a número telefónico, caché de números
- `src/whatsapp/notification.service.ts` — Notificaciones a empleados vía WhatsApp (texto y media)
- `src/whatsapp/preferences.service.ts` — Carga de números ignorados desde Supabase

**P3.4 — Decision Engine**
- `src/decision/decision.engine.ts` — Análisis de intención, contexto, cambio de tema
- `src/decision/intent-detector.ts` — Detección por palabras clave: cancelación, queja, eventos, interés de compra

**Refactorización de bot.ts:**
- Extraídos: `getContenidoMensaje`, `getMessageBody`, `getMensajeTexto`, `getMessageType`, `hasQuotedMsg`, `getQuotedText`, `descargarMedia` → `message-utils.ts`
- Extraídos: `ahoraCdmx`, `estaEnHorario`, `getContextoHorario`, `getFechaActual`, `jidANumero` → `message-utils.ts`
- Extraído: `obtenerNumeroReal`, `CACHE_NUMEROS`, `BAILEYS_KEYS` → `contact.service.ts`
- Extraídos: `cargarIgnorados`, `MENSAJES_RESCATADOS` → `preferences.service.ts`
- Extraídos: `obtenerEmpleadosANotificar`, `notificarEmpleadosWhatsApp`, `enviarFotoEmpleadosWhatsApp` → `notification.service.ts`
- Extraídos: `KW_CANCELACION`, `KW_QUEJA`, `KW_EVENTOS`, `KW_INTERES_COMPRA` y detect functions → `intent-detector.ts`
- `notificarEmpleadosWhatsApp` y `enviarFotoEmpleadosWhatsApp` ahora reciben `sock` como parámetro explícito

**P3.10 — Barrel exports**
- `src/index.ts` — Re-exporta todos los submódulos
- `src/conversation/index.ts`, `src/decision/index.ts`, `src/casos/index.ts`, `src/pedidos/index.ts`, `src/openai/index.ts`

**Métrica:**
- bot.ts: 2844 → 2500 líneas (~344 líneas menos)
- Archivos en `src/`: 17 archivos en 7 directorios
- Compilación: limpia (0 errores TypeScript)

---

### M1 — Notificaciones de Pago a Telegram (Julio 2026)

**Archivos modificados:**
- `lib/telegram.ts` — +2 funciones: `enviarAlertaPagoRecibido` y `enviarAlertaPagoPendiente`
- `events/telegram.subscriber.ts` — +2 suscripciones a `PAYMENT_RECEIVED` y `PAYMENT_PENDING`

**Cambios:**
- `PAYMENT_RECEIVED` se emitía desde bot.ts:1914 pero nunca llegaba a Telegram → ahora envía alerta con formato 💰
- `PAYMENT_PENDING` se emitía desde bot.ts:1932 pero nunca llegaba a Telegram → ahora envía alerta con formato ⏳
- Las nuevas funciones siguen el mismo patrón que las alerts existentes (esc, formatearNumero, horaActual)

**Eventos Telegram antes/después:**
| EventType | Antes | Después |
|---|---|---|
| PAYMENT_RECEIVED | Emitido, no suscrito | ✅ Suscrito |
| PAYMENT_PENDING | Emitido, no suscrito | ✅ Suscrito |

**Impacto:** Compatible — solo se agregan notificaciones, no se modifica lógica existente.
**Rollback:** Sí — revertir cambios en ambos archivos.

---

### M7 — Helper functions de dedup movidas a bot-state.ts (Julio 2026)

**Archivos modificados:**
- `src/whatsapp/bot-state.ts` — +6 funciones exportadas
- `bot.ts` — eliminadas ~50 líneas de funciones, actualizado import

**Funciones movidas:**
- `debeNotificarAtencionHumana`, `debeNotificarReclamacion`, `debeEnviarAlertaDedup`, `registrarIntervencionHumana`, `obtenerIntervencionHumanaReciente`, `extraerPrecioRespuesta`

**Métrica:** bot.ts: 2502 → 2453 líneas (-49)
**Impacto:** Compatible.
**Rollback:** Sí.

---

### M6 — Maps de estado global extraídos a src/whatsapp/bot-state.ts (Julio 2026)

**Archivos creados:**
- `src/whatsapp/bot-state.ts` — 10 Maps, 2 constantes, función limpiarCachesEstado()

**Archivos modificados:**
- `bot.ts` — eliminadas ~12 líneas de declaraciones, reemplazado .clear() inline por limpiarCachesEstado()

**Cambios:**
- `FRUSTRACION_NOTIFICADA`, `ATENCION_HUMANA_NOTIFICADA`, `INTERES_COMPRA_NOTIFICADO`, `RECLAMACION_NOTIFICADA`, `ENVIO_NOTIFICADO`, `FOTOS_NOTIFICADO`, `FOTOS_DISPONIBLES_RECIENTES`, `ALERTAS_DEDUP`, `ULTIMA_INTERVENCION_HUMANA`, `RATE_TIMESTAMPS` movidos a bot-state.ts
- Mapas exportados con el mismo nombre → 0 cambios en las 37 referencias de bot.ts
- Watchdog RAM ahora usa `limpiarCachesEstado()`

**Métrica:** bot.ts: 2516 → 2502 líneas (-14)
**Impacto:** Compatible.
**Rollback:** Sí.

---

### M5 — 6 eventos restantes emitidos y suscritos a Telegram (Julio 2026)

**Archivos modificados:**
- `lib/telegram.ts` — +6 funciones: PagoConfirmado, PrecioConfirmado, EntregaCompletada, BotDesconectado, ClienteEsperando, FotoEnviada
- `events/telegram.subscriber.ts` — +6 suscripciones
- `src/pedidos/pedido.service.ts` — +2 emisiones (PRICE_CONFIRMED, DELIVERY_COMPLETED)
- `bot.ts` — +4 emisiones (PAYMENT_CONFIRMED, CUSTOMER_WAITING, PHOTO_SENT x2, BOT_DISCONNECTED)

**Cambios:**
- `PAYMENT_CONFIRMED` se emite desde `bot.ts` junto a PAYMENT_RECEIVED
- `PRICE_CONFIRMED` se emite desde `pedido.service.ts` en transición a PRECIO_CONFIRMADO
- `DELIVERY_COMPLETED` se emite desde `pedido.service.ts` junto a ORDER_DELIVERED
- `BOT_DISCONNECTED` se emite desde `bot.ts` en el handler de conexión cerrada
- `CUSTOMER_WAITING` se emite desde `bot.ts` cuando hay cliente frustrado
- `PHOTO_SENT` se emite desde `bot.ts` tras enviar foto a empleados

**Event Engine: 18/25 → 24/25 eventos emitidos y suscritos.**

**Impacto:** Compatible.
**Rollback:** Sí.

---

### M4 — ZONA_AMBIGUA emitido a Telegram (Julio 2026)

**Archivos modificados:**
- `bot.ts` — +eventBus.emit(EventType.ZONA_AMBIGUA, ...) en bloque de envío ambiguo

**Cambios:**
- El suscriptor `ZONA_AMBIGUA` ya existía en Telegram pero nunca se disparaba
- Ahora cuando se detecta una zona ambigua de envío, además de registrar en Supabase, se emite el evento

**Impacto:** Compatible — la llamada a Supabase se mantiene.
**Rollback:** Sí.

---

### M3 — ORDER_READY emitido + ORDER_DELIVERED suscrito en Telegram (Julio 2026)

**Archivos modificados:**
- `src/pedidos/pedido.service.ts` — +emisión de ORDER_READY en transición a LISTO
- `lib/telegram.ts` — +2 funciones: `enviarAlertaPedidoListo` (✅) y `enviarAlertaPedidoEntregado` (🚚)
- `events/telegram.subscriber.ts` — +2 suscripciones a ORDER_READY y ORDER_DELIVERED

**Cambios:**
- `ORDER_READY` nunca se emitía → ahora se emite en `transitar()` cuando el estado pasa a LISTO
- `ORDER_DELIVERED` ya se emitía desde `transitar()` pero no llegaba a Telegram → ahora suscrito

**Eventos Telegram antes/después:**

| EventType | Antes | Después |
|---|---|---|
| ORDER_READY | No se emitía | ✅ Emitido en transición a LISTO + suscrito |
| ORDER_DELIVERED | Emitido, no suscrito | ✅ Suscrito |

**Impacto:** Compatible.
**Rollback:** Sí.

---

### M2 — Eventos de Caso a Telegram (Julio 2026)

**Archivos modificados:**
- `lib/telegram.ts` — +2 funciones: `enviarAlertaCasoNuevo` y `enviarAlertaCasoArchivado`
- `events/telegram.subscriber.ts` — +2 suscripciones a `CASE_CREATED` y `CASE_ARCHIVED`

**Cambios:**
- `CASE_CREATED` ya se emitía desde `caso.service.ts` pero no llegaba a Telegram → ahora envía 📋 con tipo y prioridad
- `CASE_ARCHIVED` ya se emitía desde `caso.service.ts` pero no llegaba a Telegram → ahora envía 🗂️ con motivo

**Eventos Telegram antes/después:**

| EventType | Antes | Después |
|---|---|---|
| CASE_CREATED | Emitido, no suscrito | ✅ Suscrito |
| CASE_ARCHIVED | Emitido, no suscrito | ✅ Suscrito |

**Impacto:** Compatible.
**Rollback:** Sí.
