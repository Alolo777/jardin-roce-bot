# CHANGELOG

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
