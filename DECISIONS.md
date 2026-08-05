# DECISIONS.md — Decisiones Técnicas del Proyecto

## DEC-001: OpenAI deja de tomar decisiones

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** El LLM confirmaba horarios, inventaba sucursales y perdía pedidos (Errores #2, #3, #4).

**Alternativas consideradas:**
1. Mantener lógica de negocio en el prompt
2. Usar un modelo más grande para mejorar precisión
3. Pasar toda decisión crítica al backend

**Resultado:** Toda decisión importante pertenece al backend. OpenAI únicamente redacta respuestas basadas en información validada.

**Ventajas:** Pedidos no se pierden por falta de token. Horarios validados contra el backend. Sin respuestas inventadas.

**Desventajas:** Mayor complejidad en el backend. Más módulos que mantener.

---

## DEC-002: Event Bus como spine de comunicación

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** Telegram y otros canales dependían directamente del texto generado por OpenAI.

**Alternativas consideradas:**
1. Llamadas directas a Telegram desde bot.ts
2. Webhooks
3. Event Bus interno

**Resultado:** Se implementó un Event Bus (`events/event-bus.ts`) con tipado fuerte. Todos los módulos se comunican a través de eventos.

**Ventajas:** Bajo acoplamiento. Fácil agregar nuevos suscriptores (Telegram, dashboard, empleados). Cada evento queda registrado.

**Desventajas:** Curva de aprendizaje. Depuración más compleja.

---

## DEC-003: Parsers especializados en lugar de regex gigantes

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** Un solo regex para nombre consumía frases completas (Error #1 del caso Lizet).

**Alternativas consideradas:**
1. Un solo parser con regex complejo
2. Delegar todo el parseo al LLM
3. Parser por cada tipo de dato

**Resultado:** Cada dato tiene su propio parser: `nombre.parser.ts`, `fecha.parser.ts`, `hora.parser.ts`, `sucursal.parser.ts`, `direccion.parser.ts`, `precio.parser.ts`, `telefono.parser.ts`.

**Ventajas:** Fácil de probar y mantener. Cada parser incluye nivel de confianza. Se pueden mejorar independientemente.

**Desventajas:** Más archivos. Mayor código total.

---

## DEC-004: Conversación y Pedido son entidades separadas

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** Clientes retomaban conversaciones semanas después y el sistema reutilizaba información antigua (Error #5).

**Alternativas consideradas:**
1. Un solo estado compartido
2. Separar en dos entidades con ciclo de vida independiente

**Resultado:** La conversación es el canal. El pedido es una entidad con su propio ciclo de vida. Un caso conecta ambos.

**Ventajas:** Clientes pueden tener múltiples pedidos en la misma conversación. Información de pedidos anteriores no contamina el nuevo.

**Desventajas:** Más consultas a base de datos. Mayor lógica de linking.

---

## DEC-005: Evolución incremental, no reescritura masiva

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** El sistema debe seguir funcionando en producción durante toda la refactorización.

**Alternativas consideradas:**
1. Reescribir todo en una rama paralela
2. Congelar producción hasta terminar

**Resultado:** Cada cambio es pequeño, comprobable y reversible. Nunca se detiene WhatsApp, Telegram ni Supabase.

**Ventajas:** Producción siempre funcionando. Cada PR se puede revisar y hacer rollback individualmente.

**Desventajas:** El proceso es más lento. El código convive con código legacy temporalmente.

---

## DEC-007: Telegram recibe fotos vía eventos, no llamadas directas

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** bot.ts llamaba directamente a `enviarFotoTelegram`/`enviarArchivoTelegram` en 4 lugares, violando la regla de que Telegram depende exclusivamente de eventos.

**Alternativas consideradas:**
1. Dejar las llamadas directas (status quo)
2. Envolver cada llamada en un evento genérico

**Resultado:** Se emite `EventType.PHOTO_RECEIVED` con tipo (comprobante/referencia/otra/pendiente), base64, mimetype y caption. El subscriber de Telegram maneja el envío.

**Ventajas:** Cero acoplamiento entre bot.ts y Telegram. Fácil agregar otros canales (ej: enviar la foto también a un dashboard).

**Desventajas:** La foto viaja dos veces por memoria (emit + enviar). Payload del evento más pesado.

---

## DEC-012: Decision Engine como cerebro del sistema

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** AGENTS.md establece que OpenAI NO debe ser el cerebro del sistema. Toda decisión crítica debe tomarse antes de llamar al modelo. Anteriormente, la clasificación de intención se delegaba al LLM (`clasificarConversacion` en ai.ts) y había lógica de decisión mezclada en bot.ts.

**Alternativas consideradas:**
1. Seguir usando el LLM para clasificar intención
2. Usar un modelo más pequeño para clasificación
3. Reglas determinísticas en TypeScript

**Resultado:** Se implementó `src/decision/decision.engine.ts` con clasificación determinística de 20 intenciones, detección de prioridad, detección de necesidad humana y detección de cambio de tema. OpenAI ahora solo redacta respuestas.

**Ventajas:** Cero dependencia del LLM para decisiones críticas. Respuesta instantánea (sin esperar llamada API para clasificar). Consistente y predecible.

**Desventajas:** Las reglas de texto requieren mantenimiento si el lenguaje de los clientes cambia significativamente.

---

## DEC-013: Prompt Builder separa contexto de personalidad

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** El prompt en Supabase contenía reglas de negocio (precios, horarios, sucursales, flujo de venta) mezcladas con instrucciones de personalidad. AGENTS.md exige que las reglas de negocio vivan en TypeScript.

**Alternativas consideradas:**
1. Mantener todo en el prompt de Supabase
2. Migrar todas las reglas a TypeScript de golpe
3. Prompt Builder híbrido: personalidad en Supabase, contexto dinámico desde TypeScript

**Resultado:** `prompt.builder.ts` construye contexto estructurado desde el backend (Decision + Case + Order Engine). El prompt base de Supabase se simplificará progresivamente.

**Ventajas:** Contexto validado antes de llegar al LLM. Las reglas de negocio migran gradualmente a TypeScript.

**Desventajas:** El prompt de Supabase aún contiene reglas de negocio legacy (migración pendiente).

---

## DEC-011: Order Engine con máquina de estados formal

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** AGENTS.md exige que todos los pedidos recorran una máquina de estados con transiciones validadas. El sistema legacy usaba `EstadoFlujoPedido` (string literal) sin validación de transiciones, permitiendo saltos inválidos como NUEVO → ENTREGADO.

**Alternativas consideradas:**
1. Reemplazar el sistema legacy por completo
2. Crear el Order Engine nuevo y hacerlo coexistir con el legacy
3. Mantener solo el sistema legacy

**Resultado:** Se implementó `src/pedidos/pedido.service.ts` con transiciones validadas. Coexiste con `PEDIDO_EN_CURSO` legacy. Cada mensaje entrante ahora crea un pedido en la máquina de estados. Incluye `transitarDesdeFlujo()` para mapear estados legacy al nuevo sistema.

**Ventajas:** Las transiciones inválidas son rechazadas. Cada cambio de estado emite evento. Preparado para migrar la lógica legacy progresivamente.

**Desventajas:** Dos sistemas de pedidos coexistiendo temporalmente (duplicación de estado en memoria).

---

## DEC-010: Case Engine como gestor central del ciclo de atención

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** AGENTS.md especifica que todo el ciclo de atención debe girar alrededor del concepto CASO. Anteriormente no existía un módulo que gestionara casos, por lo que conversaciones sin pedido o postventa no tenían representación en el sistema.

**Alternativas consideradas:**
1. Mantener casos implícitamente (solo pedidos en memoria)
2. Crear tabla casos en Supabase desde el inicio
3. Case Engine en memoria + migración SQL preparada para futuro

**Resultado:** Se implementó `src/casos/caso.service.ts` con caché en memoria (mismo patrón que PEDIDO_EN_CURSO). Cada mensaje entrante asegura un caso activo. Se incluyó migración SQL para persistencia futura.

**Ventajas:** Cada cliente tiene un caso activo. Se detectan cambios de tema automáticamente. Los casos generan eventos (CASE_CREATED, CASE_ARCHIVED) para Telegram y otros canales.

**Desventajas:** La persistencia a Supabase queda pendiente hasta que se implemente la migración en producción.

---

## DEC-009: Parsers conectados a bot.ts — fin del parseo inline duplicado

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** bot.ts contenía ~26 usos de lógica de parseo inline que duplicaban a los parsers especializados en `parser/`. Esto violaba el Principio 1 ("Nunca duplicar lógica") y mantenía vivos los Errores #1 y #2.

**Alternativas consideradas:**
1. Mantener ambas versiones (duplicación permanente)
2. Eliminar los parsers y quedarse con el inline
3. Eliminar el inline y usar solo los parsers

**Resultado:** Se eliminaron ~60 líneas de código duplicado en bot.ts. Toda la lógica de parseo ahora vive exclusivamente en `parser/*.parser.ts`. bot.ts importa y delega en los parsers.

**Ventajas:** Una sola fuente de verdad para cada tipo de parseo. Los parsers se pueden probar y mejorar independientemente. Corrige Error #1 (nombres con frases completas) y Error #2 (sucursal "Apizaco" por defecto).

**Desventajas:** Ninguna.

---

## DEC-019: Cierre de M11b y diferimiento de reducción de bot.ts

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** Se verificó que Telegram ya depende 100% del Event Engine (`telegram.subscriber.ts` suscribe 25 eventos; `bot.ts` no tiene llamadas directas a `lib/telegram`). El sub-objetivo restante de M11b era reducir `bot.ts` a < 500 líneas (extrayendo lógica legacy de pedidos).

**Alternativas consideradas:**
1. Extraer todo `bot.ts` a módulos en una sola fase
2. Extraer bloques acotados progresivamente
3. Cerrar M11b como verificación y diferir la reducción a Fase 10

**Resultado:** Se eligió la opción 3. La reducción masiva de `bot.ts` (2442 → <500 líneas) es refactor destructiva de alto riesgo en producción y contradice la Fase 4.1 ("Nunca realizar una refactorización masiva").

**Ventajas:** No se pone en riesgo el canal WhatsApp en producción. Se respeta el protocolo de migración incremental.

**Desventajas:** `bot.ts` sigue siendo grande hasta Fase 10.

**Pendiente:** Reducción progresiva de `bot.ts` en Fase 10 (Optimización), módulo por módulo y reversible.

---

## DEC-020: Reset de pedido al cambiar de tema (Error #5)

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** El Error #5 de AGENTS.md ocurría porque el pedido en memoria (`obtenerPedido`) se reutilizaba aunque el caso cambiara de tema, mezclando datos antiguos (nombre, precio, arreglo, sucursal, fecha, hora, forma de pago) de conversaciones previas.

**Alternativas consideradas:**
1. Resetear siempre el pedido al inicio de cada mensaje
2. Vincular el pedido al caso (mismo ciclo de vida)
3. Resetear el pedido solo cuando `detectarCambioTema` indique cambio de tema (elegida)

**Resultado:** Se creó `sincronizarPedidoConCaso(clienteId, telefono, cambioTema)` en `bot.ts`. Al cambiar de tema se resetean `PEDIDO_EN_CURSO`, `ARREGLO_ELEGIDO` y `VENTA_ACTUAL` y se crea un pedido limpio.

**Ventajas:** Cumple AGENTS.md Parte 2 (DETECCIÓN DE CAMBIO DE TEMA: nunca reutilizar datos antiguos). Bajo riesgo, reversible, sin tocar caso.service ni pedido.service.

**Desventajas:** El pedido en memoria sigue siendo un Map separado del caso (no unificado); la persistencia Supabase del pedido es responsabilidad del Order Engine ya existente.

**Pendiente:** Unificar ciclo de vida de pedido y caso en Fase 10 si se requiere.

---

## DEC-021: Prompt alineado a la arquitectura de motores

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** El system prompt anterior duplicaba reglas de negocio y dependía del token `[VENTA_CERRADA]` como fuente de verdad del pedido, contradiciendo el Error #4 (pedidos independientes del token) y el Error #7 (reglas en TS, no en prompt).

**Alternativas consideradas:**
1. Mantener el prompt anterior y solo parchar el token
2. Mover TODAS las reglas de negocio al prompt (rechazada: Error #7)
3. Reescribir el prompt para que obedezca las anotaciones del backend y trate el token como respaldo (elegida)

**Resultado:** Nuevo prompt que (a) obedece primero las anotaciones inyectadas por `contextoExtra`; (b) documenta las anotaciones reales del backend; (c) declara que el precio de envío lo confirma una compañera del equipo (no el bot); (d) trata `[VENTA_CERRADA:...]` como respaldo opcional.

**Ventajas:** Coherente con AGENTS.md Parte 3 (OpenAI solo redacta). Reduce riesgo de respuestas inventadas. El usuario mantiene cuenta BBVA y precios de flores en el prompt por preferencia.

**Desventajas:** El prompt sigue teniendo algunas reglas de negocio (cuenta, precios) por decisión explícita del usuario; el backend ya las valida, así que es redundancia tolerada.

**Nota:** El prompt de producción vive en Supabase (`configuracion_bot.system_prompt`) y se edita desde el Dashboard "Cerebro". El fallback en `lib/ai.ts` (`FALLBACK_SYSTEM_PROMPT`) se actualizó para coincidir.




## DEC-008: Servidor Express único en api/server.ts

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** bot.ts contenía un bloque Express inline que duplicaba a `api/server.ts`, creando un conflicto de puertos latente y dos fuentes de verdad para las mismas rutas.

**Alternativas consideradas:**
1. Mantener ambos servidores (riesgo de inconsistencias)
2. Mover todo de vuelta a bot.ts
3. Eliminar el bloque inline y dejar solo `api/server.ts`

**Resultado:** Se eliminaron ~93 líneas de Express inline de bot.ts. El servidor web se ejecuta exclusivamente desde `api/server.ts` con inyección de dependencias vía `BotContext`.

**Ventajas:** Sin conflicto de puertos. Una sola fuente de verdad para rutas HTTP. Código más limpio en bot.ts.

**Desventajas:** Ninguna.

---

## DEC-006: Estructura plana sin src/ hasta nuevo aviso

**Fecha:** 2026-07-16
**Estado:** En revisión

**Motivo:** El proyecto inició sin carpeta `src/`. AGENTS.md especifica una estructura con `src/` pero migrar todo de golpe rompería compatibilidad.

**Alternativas consideradas:**
1. Mover todo a src/ inmediatamente
2. Mantener estructura actual y solo crear nuevos módulos en src/

**Resultado:** Los módulos nuevos van en `src/` (como `src/conversation/`). Los archivos legacy permanecen en la raíz hasta la Fase 10.

**Ventajas:** Sin breaking changes. Migración progresiva.

**Desventajas:** Dos convenciones de estructura coexistiendo temporalmente.

---

## DEC-014: Módulos WhatsApp en src/ con parámetro sock explícito

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** bot.ts contenía ~300 líneas de funciones de utilidad de WhatsApp (extracción de mensajes, resolución de contactos, notificaciones a empleados, preferencias) que no necesitaban acceso al estado global de bot.ts. Mantenerlas en bot.ts inflaba el archivo y dificultaba las pruebas.

**Alternativas consideradas:**
1. Dejar todo en bot.ts (status quo)
2. Un solo archivo whatsapp.service.ts
3. Múltiples archivos con una sola responsabilidad cada uno

**Resultado:** Se crearon 4 archivos en `src/whatsapp/`:
- `message-utils.ts` — Extracción de contenido, tipos, descarga de media, horario CDMX
- `contact.service.ts` — Resolución de JID/LID a número telefónico
- `notification.service.ts` — Notificaciones a empleados vía WhatsApp
- `preferences.service.ts` — Carga de números ignorados

Las funciones `notificarEmpleadosWhatsApp` y `enviarFotoEmpleadosWhatsApp` ahora reciben `sock` como primer parámetro explícito en lugar de usar la variable global de bot.ts.

**Ventajas:** Funciones testeables sin depender del estado global de bot.ts. Reducción de ~300 líneas en bot.ts. Cada archivo con una sola responsabilidad.

**Desventajas:** Los llamadores de `notificarEmpleadosWhatsApp` y `enviarFotoEmpleadosWhatsApp` deben pasar explícitamente `sock`.

---

## DEC-015: PAYMENT_RECEIVED y PAYMENT_PENDING suscritos a Telegram

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** Ambos eventos se emitían desde bot.ts pero ningún suscriptor los reenviaba a Telegram. Los pagos recibidos y pendientes no se notificaban al equipo por este canal.

**Alternativas consideradas:**
1. Reutilizar `enviarAlertaVentaCerrada` para ambos casos
2. Crear funciones dedicadas con formato específico

**Resultado:** Se crearon dos funciones dedicadas en `lib/telegram.ts` (`enviarAlertaPagoRecibido` y `enviarAlertaPagoPendiente`) con formato propio. Ambas suscritas en `events/telegram.subscriber.ts`.

**Ventajas:** Mensajes claros y diferenciados para pago recibido vs pendiente. Siguen el patrón existente de alerts.

**Desventajas:** Ninguna.

---

## DEC-016: CASE_CREATED y CASE_ARCHIVED suscritos a Telegram

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** `caso.service.ts` ya emitía CASE_CREATED y CASE_ARCHIVED desde su creación, pero ningún suscriptor los reenviaba a Telegram. El equipo no recibía notificaciones de nuevos casos o casos archivados.

**Alternativas consideradas:**
1. Reutilizar `enviarAlertaTelegram` genérico
2. Crear funciones dedicadas con formato específico

**Resultado:** Se crearon `enviarAlertaCasoNuevo` (📋) y `enviarAlertaCasoArchivado` (🗂️) en `lib/telegram.ts`. Suscritas en `events/telegram.subscriber.ts`.

**Ventajas:** El equipo ve en Telegram cada nuevo caso con tipo y prioridad, y cada archivo con motivo.

**Desventajas:** Ninguna.

---

## DEC-017: ORDER_READY emitido y ORDER_DELIVERED suscrito a Telegram

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** ORDER_READY nunca se emitía desde el Order Engine (faltaba en la transición a LISTO). ORDER_DELIVERED ya se emitía pero no tenía suscriptor en Telegram.

**Alternativas consideradas:**
1. Emitir ORDER_READY solo desde el subscriber (no, el emitter debe estar en el engine)
2. Reutilizar `enviarAlertaPedidoApartado` para ambos

**Resultado:** Se agregó `eventBus.emit(EventType.ORDER_READY, ...)` en `transitar()` cuando el estado pasa a LISTO. Se crearon `enviarAlertaPedidoListo` (✅) y `enviarAlertaPedidoEntregado` (🚚) en `lib/telegram.ts`. Ambas suscritas en el subscriber.

**Ventajas:** El equipo recibe notificación cuando un pedido está listo y cuando se entrega.

**Desventajas:** Ninguna.

## DEC-022: NO_ES_NOMBRE ampliado para rechazar frases conversacionales

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** En producción, `pareceNombreCliente("Okey está bien")` devolvía TRUE porque "está", "bien" y "okey" no estaban bloqueados. Esto contaminó el nombre del cliente en toda la cadena de venta.

**Alternativas consideradas:**
1. Validar nombre solo después de que el LLM confirme (más complejo, más puntos de falla)
2. Bloquear frases conversacionales en el regex (elegida)

**Resultado:** Se agregaron 15 palabras conversacionales a `NO_ES_NOMBRE` en `nombre.parser.ts`.

**Ventajas:** Solución de una línea. Impacto cero en nombres reales. Previene falsos positivos.

**Desventajas:** Lista manual — puede requerirse mantener si aparecen nuevas frases.

---

## DEC-018: Validadores de reglas de negocio en TypeScript (M10a/b/c)

**Fecha:** 2026-07-16
**Estado:** Aceptada

**Motivo:** El `contextoExtra` de `bot.ts` (líneas ~1250-1715) inyecta ~23 bloques de reglas de negocio como texto al LLM, violando AGENTS.md Error #7 y DEC-013. El LLM no debe decidir horarios, precios, sucursales, pagos ni compensaciones.

**Alternativas consideradas:**
1. Dejar las reglas en el prompt de Supabase (no, viola arquitectura)
2. Validación solo por el revisor LLM (no, doble dependencia del modelo)

**Resultado:** Se crearon validadores en `src/validators/` que devuelven datos estructurados y texto de instrucción para el backend:
- `horario.validator.ts` (M10a): `validarHorario()` con constantes de apertura/cierre.
- `pago.validator.ts` (M10a): `CUENTA_BBVA`, `determinarInstruccionPago()`, detectores de comprobante/cuenta.
- `sucursal.validator.ts` (M10b): `validarSucursal()`, `clienteQuiereRecoger()`.
- `envio.validator.ts` (M10b): `buscarEnvio()`, `pareceConsultaEnvio()`, caché de municipios/zonas.
- `cancelacion.validator.ts` (M10c): `evaluarCancelacion()` → instrucción de empatía sin reembolsos.
- `queja.validator.ts` (M10c): `evaluarQueja()` → instrucción de empatía sin compensaciones.

**Ventajas:** Reglas en un solo lugar, testeables, sin depender del LLM. Corrige parcialmente Error #3 (horarios) y #7 (reglas en prompt).

**Desventajas:** El prompt de Supabase (`configuracion_bot.system_prompt`) aún puede contener reglas legacy redundantes; se recomienda limpiarlo manualmente vía `/admin/prompt` para evitar duplicidad con los validadores.

**Estado:** Completado (M10a-d). Los 6 validadores están conectados a `bot.ts`.

---

## DEC-023: ventaDesdeEstado + ventaCerradaHandler corregidos para datos correctos a Telegram

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Tras corregir DEC-022 (parser de nombre), el nombre "Okey está bien" seguía propagándose porque `ventaDesdeEstado` usaba `pedido?.nombre` sin fallback al Order Engine y `pedido?.productoPersonalizado` se contaminaba con captions de fotos. Además, `ventaCerradaHandler()` solo emitía `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` sin detalles completos.

**Alternativas consideradas:**
1. Agregar limpieza de captions antes de asignar a productoPersonalizado (más cambios, más riesgo)
2. Eliminar productoPersonalizado de la cadena de fallback y confiar solo en `elegido?.nombre` (elegida)
3. Sincronizar nombre en cada asignación individual de PEDIDO_EN_CURSO (3 líneas de sync)
4. Sync único al final del bloque de extracción (elegida — 1 punto de sync cubre 3 asignaciones)

**Resultado:**
- `ventaDesdeEstado()`: `producto` ya no usa `pedido?.productoPersonalizado`; `cliente` agrega fallback a `obtenerPedido(clienteId)?.nombre`
- `ventaCerradaHandler()`: emite `ORDER_CREATED` con `precioArreglo`, `precioExtras`, `precioEnvio`, `fechaHora`, `tieneFotoReferencia`
- Sincronización automática de `pedido.nombre` → Order Engine en 2 puntos estratégicos

**Ventajas:** Telegram recibe datos completos sin propagar texto contaminado. 3 bugs corregidos con 5 ediciones.

**Desventajas:** Ninguna.

---

## DEC-024: Horarios anticipados derivados a equipo humano (Error #3)

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** El LLM confirmaba horarios incorrectamente (ej. "Sí podemos" a las 9:30 cuando la apertura es 10:00). La decisión de horarios no debe estar en manos del LLM.

**Alternativas consideradas:**
1. Bloquear la respuesta del LLM y responder con mensaje fijo (no permite flexibilidad)
2. Dejar que el LLM maneje con instrucciones más fuertes en el prompt (ya se intentó, falló)
3. Detectar backend + notificar equipo + instruir LLM para respuesta provisional (elegida)

**Resultado:**
- `horario.validator.ts`: `esHorarioAnticipado()` parsea hora con am/pm y compara con `HORARIO_APERTURA` (10:00)
- `bot.ts`: Cuando se detecta hora < 10:00, emite `HUMAN_REQUIRED` a Telegram (dedup 30min) y agrega instrucción en `contextoExtra` para que el LLM responda "Consulto con el equipo..."

**Ventajas:** El equipo decide si puede atender el horario anticipado. El LLM ya no confirma ni rechaza horarios.

**Desventajas:** Depende de que el equipo vea la notificación de Telegram y responda.

---

## DEC-025: Order Engine persiste en bot_cache para sobrevivir reinicios

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** El Order Engine (`pedido.service.ts`) almacenaba todos los pedidos activos solo en un `Map<string, PedidoActual>` en memoria RAM. Al reiniciar el bot (deploy, crash, mantenimiento), todos los pedidos activos se perdían. El dashboard mostraba 0 pedidos activos hasta que los clientes volvían a escribir.

**Alternativas consideradas:**
1. Persistir en `pedidos_bot` (requiere mapeo de columnas, ya hay escritura legacy desde `bot.ts`, riesgo de duplicación/datos inconsistentes)
2. Persistir en `bot_cache` como JSONB (elegida — reutiliza infraestructura existente, mismo schema que `bot-state-persistence.ts`)
3. Persistir en archivo JSON local (no escala, riesgo de corrupción en VM)

**Resultado:**
- `src/pedidos/pedido.repository.ts`: `guardarPedidos()` serializa el Map (sin `fotoReferenciaBase64`) a JSONB en `bot_cache` clave `pedidos_engine`; `cargarPedidos()` lo restaura
- `pedido.service.ts`: `persistir()` fire-and-forget llamada tras cada mutación (`crearPedido`, `transitar`, `archivarPedido`, `cancelarPedido`)
- `bot.ts`: `cargarPedidosDesdeBD()` llamado en startup

**Ventajas:** Pedidos activos sobreviven reinicios. Sin cambios de schema en Supabase. Aprovecha infraestructura de `bot_cache` ya existente.

**Desventajas:** Persistencia asíncrona (fire-and-forget) — en caso de crash justo después de una mutación, el cambio puede perderse (ventana de ~100ms). Aceptable para el caso de uso actual.

---

## DEC-026: `no` separado de `\b` word boundaries para evitar falso positivo con "Noé"

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** `\bno\b` en `NO_ES_NOMBRE` coincidía con "No" dentro de "Noé" porque JS `\b` trata `é` como `\W` (no está en `[a-zA-Z0-9_]`). Cualquier palabra ASCII seguida de una letra acentuada produce un falso `\b`.

**Alternativas consideradas:**
1. Agregar bandera `u` al regex (no cambia el comportamiento de `\b` para caracteres no-ASCII)
2. Usar Unicode property escapes con `\p{L}` (requiere `u` flag, no resuelve `\b`)
3. Separar `no` en un regex propio que use separadores explícitos en vez de `\b` (elegida)

**Resultado:**
- `no` eliminado de `STOP_PATTERN` y `NO_ES_NOMBRE_REGEX`
- Nuevo `NO_INDEPENDIENTE = /(?:^|[\s,.;:!?¡¿])no(?:$|[\s,.;:!?¡¿])/i` que solo coincide cuando `no` está rodeado de inicio/fin de string o separadores ortográficos (espacio, coma, punto, etc.), no cuando le sigue una letra acentuada como `é`
- `esNoNombre()` reemplaza `NO_ES_NOMBRE.test()`

**Ventajas:** Soluciona el bug. Cero impacto en otros casos porque los separadores explícitos cubren exactamente los mismos contextos que `\b` para `no`.

**Desventajas:** La lógica queda en 3 reglas (STOP_PATTERN, NO_ES_NOMBRE_REGEX, NO_INDEPENDIENTE) en vez de una sola. Es más mantenible que un regex monolítico.

---

## DEC-027: Comprobante cierra venta directamente

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Conversación 2411237222: cliente envió comprobante pero `procesarMediaAcumulado` retornaba temprano sin cerrar venta ni notificar Telegram, causando pedido perdido.

**Alternativas:**
1. Mover comprobante a flag y continuar flujo (riesgo de doble respuesta)
2. Enviar solo agradecimiento y delegar a humano (pierde automatización)
3. Cerrar venta directamente desde el handler si está lista (elegida)

**Resultado:** Cuando se recibe comprobante y `ventaListaParaCerrar()` es true, el handler llama `ventaCerradaHandler` (emite eventos, registra en Supabase, notifica Telegram). Si faltan datos, solo agradece.

---

## DEC-028: Sincronizar Order Engine a pedidos_bot

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** El dashboard leía de `pedidos_bot` pero las mutaciones del Order Engine (`crearPedido`, `transitar`, `archivarPedido`) solo escribían a `bot_cache`. El dashboard mostraba datos obsoletos.

**Alternativas:**
1. Que el dashboard lea de `bot_cache` (rompe compatibilidad)
2. Migrar dashboard a leer del Order Engine (cambio mayor)
3. Escribir ambas tablas desde `persistir()` (elegida)

**Resultado:** `sincronizarPedidosBot()` transforma `PedidoActual` de cada pedido activo al schema de `pedidos_bot` y upserta en cada mutación. Mapeo `EstadoPedido → cotizacion/apartado/pagado/entregado/cancelado`.

---

## DEC-029: Detección de entrega anticipada sin arreglo verificado

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Cliente pidió 9am pero `esHorarioAnticipado` no se ejecutaba porque `tieneArregloVerificado(clienteId)` era falso (arreglo aún sin confirmar). El sistema no detectaba la entrega antes de apertura.

**Alternativas:**
1. Mover validación horaria a un paso posterior (retrasa alerta)
2. Eliminar el guard de `tieneArregloVerificado` (elegida)

**Resultado:** `esHorarioAnticipado` se evalúa cuando el cliente pide una hora, independientemente del estado de verificación del arreglo.

---

## DEC-030: Notificación de selección de foto sin keyword precio

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Cliente dijo "Me gustó mucho este" seleccionando foto disponible. `seleccionaFotoDisponible` era true pero no se notificaba al equipo porque faltaba keyword `precio|cuánto`.

**Alternativas:**
1. Agregar patrones de gusto/like al regex (más keywords que mantener)
2. Eliminar el requisito de keyword de precio si `seleccionaFotoDisponible` es true (elegida)

**Resultado:** Siempre que `seleccionaFotoDisponible && !tienePrecioConfirmado`, se notifica al equipo. No depende del texto exacto del cliente.

---

## DEC-031: Google Maps links detectados como dirección válida

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Clientes enviaban links `https://maps.app.goo.gl/...` y el bot respondía "Proporciona la dirección completa" porque `parseDireccion()` no reconocía URLs de Maps como dirección. El formato `maps.app.goo.gl` no estaba cubierto por el regex.

**Alternativas:**
1. Delegar al LLM la interpretación del link (no, el LLM no puede acceder a URLs)
2. Extraer coordenadas del link y geocodificar inversamente (demasiado complejo)
3. Reconocer el link como dirección válida y notificar al equipo (elegida)

**Resultado:**
- `direccion.parser.ts`: `GOOGLE_MAPS_REGEX` detecta `maps.app.goo.gl`, `goo.gl/maps`, `google.*/maps` con confianza 'alta'
- `envio.validator.ts`: `buscarEnvio()` limpia el link antes de buscar municipios; retorna null cuando solo hay link sin texto adicional
- `bot.ts`: inline `GOOGLE_MAPS_REGEX` actualizado para consistencia

**Ventajas:** El link es tratado como dirección válida, el equipo es notificado. El LLM recibe instrucción de que el cliente ya proporcionó ubicación.

**Desventajas:** El equipo debe abrir manualmente el link para ver la ubicación.

---

## DEC-032: subscribeTelegramEvents agregado al arranque del bot

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** `subscribeTelegramEvents()` se importaba en `bot.ts:26` pero nunca se invocaba. El Event Engine emitía 25 tipos de eventos pero ningún suscriptor los reenviaba a Telegram porque el subscriber nunca se registraba en el `eventBus`.

**Alternativas:**
1. Mover la suscripción a un módulo separado con auto-inicialización (más cambios, más riesgo)
2. Llamar la función directamente en el arranque de bot.ts (elegida — mínimo cambio)

**Resultado:** Agregada llamada `subscribeTelegramEvents()` en la secuencia de arranque, después de `cargarEstado()`.

**Ventajas:** Se activan todas las notificaciones a Telegram sin modificar la lógica existente. Cambio de una línea, 0 riesgo.

**Desventajas:** Ninguna.

---

## DEC-033: Comprobante notifica a empleados WhatsApp

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Cuando un cliente enviaba un comprobante de pago, `procesarMediaAcumulado()` solo emitía un evento `PHOTO_RECEIVED` (que no llegaba a Telegram por DEC-032). El equipo no recibía el comprobante para verificarlo, repitiendo el caso "Lizet" donde un pago se pierde porque nadie lo revisa.

**Alternativas:**
1. Depender solo de Telegram (pero Bug #2 mostraba que el equipo no veía las notificaciones)
2. Enviar la foto del comprobante y una alerta de texto por WhatsApp a empleados (elegida — mismo patrón que referencia)

**Resultado:** En `procesarMediaAcumulado()`, el bloque `esComprobante` ahora llama a `enviarFotoEmpleadosWhatsApp()` (envía la foto) y `notificarEmpleadosWhatsApp()` (alerta de texto), exactamente como se hace para `esReferencia`.

**Ventajas:** El equipo recibe el comprobante inmediatamente por WhatsApp para verificar el pago. Patrón consistente con el manejo de fotos de referencia.

**Desventajas:** Ninguna.

---

## DEC-034: Gemini eliminado como fallback, solo GitHub Models

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Gemini free tier (cuota 150 requests/86400s) se agotaba diariamente, causando HTTP 429 que hacía que `getAIResponse` lanzara throw y el cliente recibiera "mareo digital". Las pruebas mostraron GitHub Models funcional (~2s de latencia).

**Alternativas consideradas:**
1. Migrar a Gemini plan pago (costo adicional, misma latencia)
2. Mantener ambos proveedores con mejor manejo de cuota (más complejo)
3. Eliminar Gemini y dejar solo GitHub Models (elegida)

**Resultado:** Se removió `callWithFallback` y todos los imports a Gemini. Las 4 funciones (`clasificarImagenVenta`, `clasificarConversacion`, `revisarRespuestaFlora`, `getAIResponse`) llaman directamente a GitHub Models con `conRetry`. Se eliminaron `lib/gemini-ai.ts` y `@google/generative-ai`.

**Ventajas:** Un solo proveedor, menos latencia, sin fallback frágil, sin dependencia externa de Google.

**Desventajas:** Sin redundancia — si GitHub Models cae, no hay fallback (mitigado por `PROVIDER_FAILURE` event que notifica al equipo).

---

## DEC-035: getAIResponse devuelve fallback en vez de throw

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Cuando ambos proveedores fallaban, `getAIResponse` lanzaba error, `procesarMensaje` lo atrapaba y respondía con "mareo digital". El cliente perdía el contexto de su mensaje.

**Alternativas consideradas:**
1. Seguir lanzando error y dejar que el catch maneje (status quo, cliente recibe mensaje genérico)
2. No responder cuando falla (peor experiencia)
3. Devolver texto de respaldo pidiendo al cliente que repita + emitir evento al equipo (elegida)

**Resultado:** `getAIResponse` atrapa el error, emite `PROVIDER_FAILURE` al event bus (→ Telegram notifica al equipo), y retorna `{ mensaje: '🌷 Perdón, un pequeño mareo digital...', ventaCerrada: null }`.

**Ventajas:** El cliente recibe una respuesta coherente. El equipo sabe que la IA está caída. El cliente puede reintentar.

**Desventajas:** El mensaje pide al cliente que repita — puede ser confuso si no lee con atención.

---

## DEC-036: Concurrencia aumentada y timeout reducido

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Los logs de producción mostraban Timeout 60000ms esperando slot de concurrencia. Con 2 slots y 60s de timeout, cuando ambos estaban ocupados (ej: clasificación de imágenes + respuesta a otro cliente), los mensajes nuevos se quedaban en cola hasta 60s.

**Alternativas consideradas:**
1. Mantener 2 slots (no resuelve contención)
2. Aumentar a 3 slots + reducir timeout a 30s (elegida)
3. Eliminar el semáforo por completo (riesgo de rate-limit de Azure)

**Resultado:** MAX_CONCURRENT 2→3, SLOT_TIMEOUT_MS 60s→30s.

**Ventajas:** 50% más capacidad concurrente. Los clientes esperan la mitad del tiempo antes de que su request "force" el slot.

**Desventajas:** Mayor probabilidad de alcanzar rate-limit de Azure si hay muchos mensajes simultáneos (mitigado por conRetry con backoff).

---

## DEC-037: Logger estructurado propio (sin pino/winston)

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Los errores de producción solo aparecían en `console.log` dispersos. No había forma centralizada de ver *dónde* y *cuándo* falló el bot (se evidenció cuando la IA se cayó el mismo día).

**Alternativas consideradas:**
1. Usar pino o winston (maduros, pero agregan dependencia externa)
2. Logger propio ligero con buffer + Supabase (elegida)

**Resultado:** `lib/logger.service.ts` implementa `logger.{debug,info,warn,error}` con niveles, buffer circular en memoria (500 entradas, siempre disponible para el API como respaldo) y escritura batch asíncrona a Supabase (`from('logs').insert`). `subscribeLogEvents()` suscribe `eventBus.subscribeAll` para auto-registrar cada evento como `info`. `bot.ts` reemplaza los handlers `uncaughtException`/`unhandledRejection` por `logger.error` con stack.

**Ventajas:** Cero dependencias nuevas (coherente con política de mínimas dependencias de AGENTS.md). Observabilidad inmediata vía `/admin/logs`. Fallo de Supabase no rompe el bot (fire-and-forget + buffer).

**Desventajas:** No hay métricas ni health endpoint todavía (Módulo 16 fase 2). El buffer es por-proceso (en serverless el API no ve el buffer del bot; se mitiga leyendo de Supabase). La tabla `logs` requiere ejecución manual del SQL (`supabase_migration_logs.sql`).

---

## DEC-038: Proxy transparente de Supabase para contar errores + snapshot de métricas a Supabase

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Para la Fase 2 de Observabilidad se requiere la tasa de error de Supabase y la latencia de la IA sin tocar los ~200 call sites existentes de `supabaseAdmin`.

**Alternativas consideradas:**
1. Envolver cada `.from()` en un helper `db()` y migrar todos los call sites (invasivo, riesgo alto)
2. Proxy recursivo sobre `supabaseAdmin` que adjunta un `.catch` non-swallowing a toda promesa (elegida)

**Resultado:** `lib/supabase.ts` exporta `supabaseAdmin` como Proxy de `supabaseAdminRaw`. Cualquier propiedad que devuelva una función la invoca y, si el resultado es thenable, registra el error en `metrics.recordSupabaseError` sin tragarlo (devuelve la promesa original). El bot persiste `metrics.getSnapshot()` a `configuracion_bot` (clave `bot_metrics`) cada 30s y en `beforeExit`; `app/api/health` lo lee.

**Ventajas:** Cero cambios en call sites de Supabase. Errores contados de forma centralizada. El dashboard en Vercel lee el snapshot desde Supabase (mismo patrón que `bot_status`).

**Desventajas:** El Proxy recursivo puede envolver objetos anidados innecesariamente en llamadas calientes (costo despreciable). Las métricas viven en memoria del proceso del bot; en Vercel solo se ven tras el flush a Supabase (hasta 30s de retraso). No hay persistencia histórica de métricas (solo último snapshot).

---

## DEC-039: Intereses de compra no deben emitir ORDER_CREATED (evita "VENTA CERRADA" falsa)

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** `message-handler.ts` emitía `EventType.ORDER_CREATED` cuando `esInteresCompra` era true, lo que disparaba `enviarAlertaVentaCerrada` ("🌸 ¡VENTA CERRADA!") aunque el cliente solo mostró intención. Viola DEC-001 (el backend no confirma ventas) y el Error #4 de AGENTS.md.

**Alternativas consideradas:**
1. Crear un nuevo evento `INTERES_COMPRA` (más superficie, nueva alerta)
2. Reusar `COTIZACION_REQUESTED` (ya existe, ya tiene alerta) con payload robusto (elegida)

**Resultado:** El bloque `esInteresCompra` emite `COTIZACION_REQUESTED` con `telefono` (número real resuelto), `cliente` (pushName) y `descripcion` que incluye producto/arreglo actual + texto del interés. `enviarAlertaCotizacion` ahora muestra "INTERÉS / COTIZACIÓN" con teléfono real y detalle.

**Ventajas:** Sin falsas ventas cerradas. Alertas con datos reales y accionables. Reuso de evento existente (menos superficie).

**Desventajas:** `COTIZACION_REQUESTED` ahora cubre tanto cotizaciones con foto como intereses de texto; la alerta es genérica. Aceptable.

---

## DEC-040: Creación de KNOWN_BUGS.md

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** AGENTS.md (Parte 4.2A) exige `KNOWN_BUGS.md` como documento oficial de errores conocidos. El repo no lo tenía. Se crea para registrar los bugs del reporte de producción (alertas vacías, VENTA CERRADA falsa, alerta de fotos sin contexto).

**Resultado:** `KNOWN_BUGS.md` creado con BUG-001 (alertas Telegram vacías), BUG-002 (VENTA CERRADA falsa por interés), BUG-003 (alerta de fotos sin contexto/número real). BUG-002 resuelto en este commit.

---

## DEC-041: crearPedido emite ORDER_UPDATED (no ORDER_CREATED) + payload con datos reales

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Bug A. `pedido.service.ts` emitía `ORDER_CREATED` con solo `orderId`/`telefono`/`descripcion`. Como `ORDER_CREATED` está cableado a "🌸 ¡VENTA CERRADA!" en Telegram (telegram.subscriber.ts:38), crear un pedido mostraba una venta cerrada falsa y vacía. Viola DEC-001.

**Alternativas consideradas:**
1. Crear evento `PEDIDO_INICIADO` nuevo (más limpio pero más superficie: types + subscriber)
2. `crearPedido` emite `ORDER_UPDATED` (cableado a "PEDIDO APARTADO") con datos reales (elegida)

**Resultado:** `buildOrderPayload(pedido)` mapea nombre→cliente, productoPersonalizado/arreglo.nombre→producto, precioPersonalizado/arreglo.precio→total, sucursal/direccion/envio.zona→sucursal. `crearPedido`, `transitar` y `archivarPedido` usan ese payload en `ORDER_UPDATED`.

**Ventajas:** Cero alertas vacías. Cero "VENTA CERRADA" falsa al crear pedido. La venta real sigue vía `ventaCerradaHandler` → `ORDER_CREATED` con datos completos.

**Desventajas:** Ninguna relevante.

---

## DEC-042: KNOWN_BUGS.md creado (cumplimiento AGENTS.md)

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** AGENTS.md Parte 4.2A exige `KNOWN_BUGS.md`. El repo no lo tenía.

**Resultado:** Creado con BUG-001 (vacías), BUG-002 (VENTA CERRADA falsa), BUG-003 (fotos sin contexto). BUG-002 resuelto en DEC-039; BUG-001 resuelto en DEC-041.

**Ventajas:** Cumple protocolo; trazabilidad de bugs.

**Desventajas:** Ninguna.

---

## DEC-043: Alerta PHOTO_REQUESTED con número real y contexto (ambos canales)

**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Bug B. La alerta de Telegram cuando el cliente pide fotos llegaba sin número legible ni contexto (`cliente: ''`). El equipo no sabía a quién escribir.

**Alternativas consideradas:**
1. Solo WhatsApp empleados (quitar Telegram) — rechazado por el usuario
2. Ambos canales, enriqueciendo la alerta Telegram con número real + contexto (elegida)

**Resultado:** `PHOTO_REQUESTED` se emite con `telefono` real, `cliente` (pushName) y `descripcion`. `enviarAlertaEmpleadoFotos` muestra número real (`formatearNumero`) y contexto. Se mantiene WhatsApp-a-empleados.

**Ventajas:** Alerta de Telegram accionable. Ambos canales activos según decisión de usuario. Sin asumir ramo (el cliente aún no elige al pedir fotos).

**Desventajas:** Ninguna relevante.

---

## DEC-044: Corrección de máquina de estados (BUG-004)
**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** El pedido nunca llegaba a APARTADO. Logs mostraban transiciones inválidas y el `transitarDesdeFlujo` forzaba estados imposibles, permitiendo saltos como `COTIZANDO → ESPERANDO_PAGO` y `ESPERANDO_PAGO → EN_PRODUCCION`. Resultado: alertas de cierre con datos vacíos.

**Alternativas consideradas:**
1. Mantener forceo de estado y solo ampliar transiciones — rechazada (el forceo enmascara bugs y permite saltos no deseados como EN_PRODUCCION directo).
2. Quitar forceo + ampliar transiciones + pago → APARTADO (elegida).

**Resultado:**
- Transiciones válidas agregadas: `NUEVO/COTIZANDO/PRECIO_CONFIRMADO/ESPERANDO_DATOS → ESPERANDO_PAGO`.
- `pagado_transferencia` mapea a `APARTADO` (antes `EN_PRODUCCION`).
- `transitarDesdeFlujo` ya no fuerza estados inválidos; si `transitar()` rechaza, el estado se queda en el anterior y queda en el log.
- `EN_PRODUCCION` solo cuando el equipo confirma el apartado.

**Ventajas:** Máquina de estados fiel al AGENTS.md (nunca saltar estados). Pago = APARTADO con datos; ORDER_CREATED solo al cierre real.

**Desventajas:** Flujos que dependían del forceo silencioso ahora se detendrán en el estado anterior (visible en logs, más fácil de diagnosticar).

---

## DEC-045: Nombre en alertas y pedir nombre antes de cerrar (BUG-005)
**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** Las alertas Telegram de pedido mostraban el texto del mensaje del cliente ("Me pasa su cuenya pla") en lugar del nombre. El sistema cerraba ventas sin nombre válido.

**Decisión de negocio (usuario 2026-07-17):** El sistema DEBE pedir nombre de quien aparta/recibe (y teléfono si es envío) antes de cerrar.

**Alternativas consideradas:**
1. Solo corregir el texto mostrado (usar pushName) — insuficiente, no cumple "pedir nombre".
2. Priorizar `pedido.nombre` (fuente de verdad) + guarda de no-cierre si falta nombre (elegida).

**Resultado:**
- `nombreParaAlerta(clienteId, tokenCliente)`: `pedido.nombre` → token válido → "Verificar en chat". Sincroniza nombre del token al pedido si hace falta.
- `ventaCerradaHandler`: si no hay nombre válido, NO emite ORDER_CREATED/PAYMENT_*; deja el pedido en `esperando_nombre` para que el bot pida el nombre.
- `pedidoApartadoHandler` usa `nombreParaAlerta` para la alerta.

**Ventajas:** Alertas con nombre real; se cumple la regla de negocio de pedir nombre antes de cerrar; el número real ya viaja siempre (Bug B).

**Desventajas:** Si el LLM no logra obtener el nombre, la venta queda en espera (el bot debe pedirlo). Aceptable según regla de negocio.

---

## DEC-046: Inyección de horario dinámico por backend (BUG-006)
**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** El bot inventó "mañana cerramos a las 7:00 pm" siendo sábado (cierra 5pm). El LLM no aplicó la tabla del prompt.

**Decisión de negocio (usuario 2026-07-17):** El backend debe inyectar dinámicamente el horario de hoy/mañana calculado en código (no por el LLM) — cumple AGENTS.md ERROR #3 (horarios solo validados por backend).

**Alternativas consideradas:**
1. Solo reforzar el prompt con la tabla — insuficiente (el LLM ya la tenía y falló).
2. Inyectar anotaciones `[HORARIO HOY]` / `[HORARIO MAÑANA]` calculadas en backend (elegida).

**Resultado:**
- `horarioHoyManana()` en `horario.validator.ts`: L-V 10:00-19:00, S-D 10:00-17:00, usando `ahoraCdmx`.
- `construirContextoPrompt` inyecta `[HORARIO HOY: ...]` y `[HORARIO MAÑANA: ...]` como anotaciones de sistema confiables.
- Cubierto por `tests/horario.test.mts` (`npm run test:horario`).

**Ventajas:** El LLM obedece horarios reales del backend; coherente con AGENTS.md ERROR #3.

**Desventajas:** Ninguna relevante.

---

## DEC-047: Dirección desde link de Maps — guardar link y pedir calle (BUG-007)
**Fecha:** 2026-07-17
**Estado:** Aceptada

**Motivo:** El cliente envió `maps.app.goo.gl/...`; el bot lo repetía como dirección sin calle legible. Un short-link de Maps no trae la calle en el texto.

**Decisión de negocio (usuario 2026-07-17):** Opción A — guardar el link Y pedir que el cliente confirme la calle en texto.

**Alternativas consideradas:**
1. Borrar el link y pedir dirección completa — rechazada (pierde la ubicación de referencia).
2. Guardar el link y pedir calle en texto (elegida).

**Resultado:**
- `parseDireccion` devuelve `esLinkMaps: true` y conserva el link.
- `limpiarDireccionCliente` (message-handler) conserva el link Maps.
- En el flujo de envío, si la dirección es link Maps, se inyecta instrucción al LLM: GUARDAR link + PEDIR calle/número en texto; no repetir el link como calle.

**Ventajas:** Se conserva la ubicación de referencia y se obtiene la calle legible para el equipo/alertas.

**Desventajas:** El cliente debe escribir la calle; si no lo hace, la dirección queda como link (aceptable).

---

## DEC-048: Notification Engine — Pipeline de verificación de 3 capas

**Fecha:** 2026-07-18
**Estado:** Aceptada (basada en respuestas del desarrollador del 2026-07-18)

**Motivo:** El sistema actual notifica a Telegram con datos vacíos, incorrectos o duplicados. No hay verificación entre el evento emitido y la base de datos. Los 11 weak points identificados comparten la misma causa raíz: no existe separación entre la "fuente de datos" (estado en memoria) y el "mensaje a notificar".

**Decisión de negocio (desarrollador):**
- Un solo canal de Telegram para todas las notificaciones
- Las notificaciones se envían después de responder al cliente (sin presión de latencia)
- IA #1 e IA #2 como LLM calls con modelos diferentes desde GitHub Models
- Híbrido: críticas siempre ✅ con alerta, informativas ❌ bloquear si conflicto, vacías ❌ bloquear
- WhatsApp a empleados como canal secundario

**Alternativas consideradas:**
1. Seguir notificando directamente desde eventBus → Telegram (status quo — datos vacíos/incorrectos)
2. Agregar validación solo en el builder de mensajes (insuficiente, no detecta contradicciones)
3. Pipeline de 3 capas: Timeline Builder → Decision Extractor → Conflict Detector (elegida)

**Resultado:**
- `src/notification-engine/types.ts`: 10 interfaces para datos del pipeline
- `src/notification-engine/timeline.builder.ts`: Reconstruye estado desde Supabase (casos, pedidos_bot, historial_chat)
- `src/notification-engine/decision.extractor.ts`: Extrae campos relevantes con nivel de confianza, detecta nombres inválidos
- `src/notification-engine/conflict.detector.ts`: Detecta contradicciones y decide acción (NOTIFICAR/ALERTA/BLOQUEAR)
- Fase 6.1 completa, compilación exitosa

**Ventajas:**
- Las notificaciones se construyen desde la base de datos, no desde memoria volátil
- Los conflictos se detectan antes de notificar
- Los datos vacíos o inválidos no llegan a Telegram
- El equipo puede confiar en las notificaciones que sí llegan

**Desventajas:**
- Latencia adicional (aceptable — notificaciones van después de la respuesta)
- Dependencia de Supabase para construir la línea de tiempo
- Más código que mantener

### Fase 6.8 — Auditoría Post-Migración

**Decisión:** No eliminar funciones deprecadas que aún son importadas en `telegram.subscriber.ts` (sirven como fallback). Solo eliminar funciones sin ninguna referencia externa.

**Eliminadas:** `enviarArchivoTelegram`, `enviarAlertaTelegram` — 0 referencias en todo el código.

**Deprecadas:** 24 funciones con `/** @deprecated */` JSDoc. Las firmas se mantienen intactas para no romper compilación.

**Activas:** 5 funciones de sistema + `enviarFotoTelegram` + `enviarMensajeTelegram`.

**Impacto:** Bajo. Notification Engine completado al 100%.

### Fase 6.7 — Migración Automática de Handlers

**Decisión:** No migrar handlers uno por uno. Modificar `withPipeline` para que envíe el mensaje del pipeline si existe. Esto migra todos los handlers comerciales automáticamente.

**Excepción:** `PHOTO_RECEIVED` requiere enviar la foto (no solo texto), por lo que se excluye del auto-send y sigue usando el callback.

**Archivo:** `src/notification-engine/notification.engine.ts` (`withPipeline` + `EVENTOS_MEDIA`)
**Archivo:** `lib/telegram.ts` (nuevo export `enviarMensajeTelegram`)

**Impacto:** Medio-alto. Cambia el origen de los mensajes de Telegram: de datos crudos del payload a datos verificados por el pipeline.

### Fase 6.6 — Pipeline Event Logger

**Motivo:** Cada ejecución del pipeline debe quedar registrada para auditoría, debugging y trazabilidad. Se reutiliza la infraestructura existente en lugar de crear una nueva tabla.

**Decisión:** Usar `logger.service.ts` + tabla `logs` existente con `module = 'pipeline'`. No crear tabla nueva. Metadata estructurada en JSONB. 4 funciones de log que cubren inicio, fin, error y paso intermedio.

**Archivo:** `src/notification-engine/pipeline-logger.ts`

**Impacto:** Bajo. Logger asíncrono no bloquea el pipeline.

### Fase 6.5 — Template Builder

**Motivo:** Separar la generación del mensaje de la lógica de envío. Cada template usa datos verificados del pipeline (DatosVerificados) para producir mensajes consistentes, evitando inconsistencias entre handlers.

**Decisión:** Un solo builder con templates por evento, no archivos separados. Helper functions inline (no dependencia de lib/telegram.ts) para mantener independencia del módulo.

**Templates:** 21 tipos de evento cubiertos + default genérico.

**Archivo:** `src/notification-engine/template.builder.ts`

**Impacto:** Bajo. Mensaje generado automáticamente en PipelineResult.message. Handlers existentes no se modifican.

### Fase 6.4 — Business Rules Validator

**Motivo:** El system prompt de Flora contenía reglas de negocio que debían migrarse a TypeScript (Principio 7 del AGENTS.md). Se extrajeron 9 reglas y se implementaron en un validador puro sin IAs.

**Reglas implementadas:**
| Regla | Validación | Severidad |
|-------|-----------|-----------|
| R001 | Horario dentro de L-V 10-19 / S-D 10-17 | error |
| R002 | Sucursal "Centro" o "Norte" | error |
| R003 | Precio ≥ $60 MXN | warning |
| R004 | Precio ≤ $50,000 MXN | warning |
| R005 | Nombre sin comas ni conectores | error |
| R006 | Fecha+hora obligatorias si estado es apartado/pagado | error |
| R007 | Envío a domicilio solo transferencia | error |
| R008 | Requiere revisión y falta producto/precio | warning |
| R009 | Recoge en sucursal pero sin método de pago | warning |

**Archivo:** `src/notification-engine/business-rules.validator.ts`

**Impacto:** Bajo. Función pura, sin dependencias externas.

### Fase 6.3 — Integración de IAs Auxiliares

**Archivos creados:**
- `order.reconstructor.ts` (IA #1): GPT-4o-mini con token separado (`IA1_TOKEN`). Reconstruye pedido verificando cada campo. Fallback a datos crudos si falla.
- `order.auditor.ts` (IA #2): GPT-4o con token separado (`IA2_TOKEN`). Audita la reconstrucción con 6 reglas de detección. Fail open si falla.

**Pipeline final:**
```
Timeline (DB) → extractDecision → detectConflicts
  ↓ (si no BLOQUEAR)
IA #1 (Order Reconstructor) → verifica campos contra DB + evento
  ↓
IA #2 (Order Auditor) → audita reconstrucción, rechaza si alucina
  ↓
NOTIFICAR / ALERTA / BLOQUEAR
```

**Fail-safes:**
- IA #1 sin token → fallback a datos crudos del evento/timeline
- IA #2 falla → fail open, notificación pasa sin auditoría
- IA #2 rechaza → notificación cambia a ALERTA con advertencias

---

## DEC-049: Fotos de referencia restauradas desde pedidos_bot en cargarPedidos

**Fecha:** 2026-07-29
**Estado:** Aceptada

**Motivo:** P0-1. `sanitizarParaCache` eliminaba `fotoReferenciaBase64`, `fotoReferenciaMimetype`, `fotoReferenciaCaption` y `fotoReferenciaRecibidaEn` al persistir en `bot_cache`. Tras reinicio del bot, todas las fotos de referencia desaparecían porque `cargarPedidos()` solo leía de `bot_cache`.

**Alternativas consideradas:**
1. Dejar de sanitizar fotos en bot_cache (aumenta tamaño de JSONB)
2. Almacenar fotos en Supabase Storage (cambio mayor de schema)
3. Restaurar fotos desde `pedidos_bot` tras cargar desde `bot_cache` (elegida)

**Resultado:** `cargarPedidos()` ahora hace una segunda consulta a `pedidos_bot` después de cargar desde `bot_cache`, restaurando `foto_referencia_base64`, `foto_referencia_mimetype`, `foto_referencia_caption` y `foto_referencia_recibida_en` para cada pedido activo que tenga foto.

**Ventajas:** Sin cambios de schema. Sin aumentar tamaño de bot_cache. Aprovecha que `sincronizarPedidosBot()` ya persistía fotos en `pedidos_bot`.

**Desventajas:** Consulta adicional a Supabase en el arranque. Aceptable (solo ocurre una vez al iniciar).

---

## DEC-050: Response Validator como barrera contra alucinaciones del LLM

**Fecha:** 2026-07-29
**Estado:** Aceptada

**Motivo:** P0-3. AGENTS.md Parte 3 especifica un Response Validator que verifica que el LLM no invente horarios, precios, sucursales, pagos, inventario ni entregas. No existía en el código — el sistema confiaba únicamente en el prompt para que el LLM no alucinara.

**Alternativas consideradas:**
1. Confiar solo en el prompt (status quo — ya falló en producción con horarios)
2. Usar una segunda llamada LLM para validar (costo y latencia duplicados)
3. Validación determinística por regex + reglas de negocio (elegida)

**Resultado:** `src/validators/response.validator.ts` implementa:
- `validarRespuestaIA(respuesta, contexto)`: detecta confirmación de horarios fuera de rango, confirmación de inventario, confirmación de entrega/producción, confirmación de pago sin respaldo del backend. Retorna `{ valido, razon }`.
- `sanitizarRespuestaIA(respuesta)`: limpia markdown links, URLs de Supabase Storage, anotaciones internas entre corchetes.
- `extraerPreciosRespuesta(texto)`: detecta precios de flores individuales en la respuesta que no coincidan con los precios de referencia.

Integrado en `message-handler.ts`: tras `getAIResponse` y antes de enviar al cliente, se ejecuta `validarRespuestaIA`. Si rechaza, se emite `HUMAN_REQUIRED` con prioridad alta para atención del equipo.

**Ventajas:** Última línea de defensa contra alucinaciones del LLM. Cero dependencia de APIs externas. Reglas alineadas con los validadores de negocio existentes.

**Desventajas:** Las reglas son determinísticas — pueden tener falsos positivos si el LLM usa frases no cubiertas por los patterns. Aceptable: el equipo recibe la notificación y puede responder.

---

## DEC-051: Eliminación de código de envío duplicado en message-handler.ts

**Fecha:** 2026-07-29
**Estado:** Aceptada

**Motivo:** P1-11. `buscarPrecioEnvio`, `obtenerZonasEnvio`, `obtenerMunicipiosEnvio`, `formatearZonasParaPrompt`, `contieneFrase` y `detectarLinkMaps` estaban duplicados en `message-handler.ts` con implementaciones casi idénticas a `envio.validator.ts`. Esto violaba el Principio 1 (Nunca duplicar lógica) de AGENTS.md.

**Alternativas consideradas:**
1. Dejar ambas versiones (riesgo de divergencia futura)
2. Eliminar las de envio.validator.ts (no, ese es el módulo oficial)
3. Eliminar las de message-handler.ts e importar desde envio.validator.ts (elegida)

**Resultado:** Se eliminaron ~95 líneas de código duplicado de `message-handler.ts`. `buscarPrecioEnvio` reemplazado por `buscarEnvio` (importado). Las funciones de ayuda se importan desde `envio.validator.ts`.

**Ventajas:** Una sola fuente de verdad para lógica de envío. Código más mantenible.

**Desventajas:** Ninguna.

---

## DEC-052: Corrección de nombre.parser.ts — palabras que pueden ser nombres reales

**Fecha:** 2026-07-29
**Estado:** Aceptada

**Motivo:** P0-4. `NO_ES_NOMBRE_REGEX` y `STOP_WORDS` incluían "tiene", "tienen", "listo", "entrega", "recoger", "direccion", "pago", "ramo", "centro", "norte", "sur", "arreglo" — palabras que pueden ser parte de nombres reales (ej: "Tiene Martínez", "Listo Pérez", "Ramo Sánchez").

**Alternativas consideradas:**
1. Dejar la lista actual (riesgo de rechazar nombres reales en producción)
2. Eliminar todas las palabras que podrían ser nombres (elegida)
3. Usar un modelo de NLP para distinguir nombres de frases (sobreingeniería)

**Resultado:** Se removieron de STOP_WORDS: "recoger", "entrega", "entregan", "envio", "envío", "direccion", "dirección", "pago", "mañana", "hoy", días de la semana, "ramo", "sucursal", "centro", "norte", "sur", "listo", "arreglo". De NO_ES_NOMBRE_REGEX: "ramo", "sucursal", "centro", "norte", "sur", "recoger", "entrega", "entregan", "direccion", "dirección", "pago", "tiene", "tienen", "listo".

**Ventajas:** Nombres reales con estas palabras ya no son rechazados. El parser sigue siendo estricto con puntuación y conectores gramaticales.

**Desventajas:** Mayor riesgo de que frases conversacionales que incluyan estas palabras ("listo", "tiene precio") sean interpretadas como nombres. Mitigado por el contexto: `cortarEnStop()` se detiene en STOP_WORDS, y los nombres se extraen solo cuando hay indicación explícita ("a nombre de", "nombre:").

---

## DEC-053: Confianza gradual en el parser de sucursal (confianza 'media')

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 1.4. El parser de sucursal solo aceptaba confianza 'alta' (línea 160 y 836 de message-handler.ts). Frases reales como "La que está por la Av. Morelos" o "La del centro" dejaban la sucursal vacía y el pedido perdía la sucursal.

**Alternativas consideradas:**
1. Dejar confianza binaria (alta/ninguna) y ampliar keywords (riesgo de falsos positivos: "centro" podría pegar en "concentrado")
2. Aceptar 'media' y almacenar la sucursal con un flag `sucursal_por_confirmar` para que el bot pida confirmación antes de cerrar (elegida)
3. Pasar toda referencia ambigua a un humano (sobrecarga operativa)

**Resultado:** `parseSucursal()` devuelve `'alta' | 'media' | 'ninguna'`. Normaliza acentos (NFD) y usa límites de palabra (`\b`) para evitar subcadenas falsas. Variantes soportadas: "la de [dirección]", "la que está por", "Av. Morelos" → Centro media, "por el norte/sur", "sucursal [nombre]", "tlaxcala". Con 'media' se almacena la sucursal y se activa `sucursal_por_confirmar` en `PedidoActual`; el prompt builder marca "(POR CONFIRMAR)" para que el LLM pida confirmación. Fallo seguro: si no se determina, queda vacío (Error #2 nunca se reintroduce).

**Ventajas:** El criterio de éxito se cumple ("La que está por la Av. Morelos" → Centro media). Sin sucursales inventadas. Compatible con historial existente.

**Desventajas:** El flag `sucursal_por_confirmar` depende de que el LLM respete la marca en el prompt; la confirmación real la valida el backend al cerrar.

---

## DEC-054: Cooldown largo para bloqueo de IP por WhatsApp (404/405)

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 0.1. WhatsApp bloqueó la IP de la VM de GCP por exceso de reconexiones (HTTP 404/405). El handler de `connection === 'close'` no distinguía el bloqueo y reconectaba con backoff corto (máx. 60s), manteniendo la IP en lista negra.

**Alternativas consideradas:**
1. Dejar el backoff corto genérico (mantiene el bloqueo)
2. Detectar 403/404/405 y esperar cooldown largo de 30 min antes de reintentar (elegida)
3. Cambiar de IP automáticamente vía API de GCP (requiere credenciales en la VM, riesgo de seguridad)

**Resultado:** En `bot.ts`, si `reason` es 403/404/405 se marca estado `error`, se emite `BOT_DISCONNECTED` y se programa `programarReinicioBaileys` con `BLOQUEO_IP_COOLDOWN_MS = 30 min`. La operación de cambio de IP en GCP queda manual (consola), ya que requiere interacción del dueño.

**Ventajas:** No se bombardea a WhatsApp con reconexiones durante un bloqueo. El dashboard muestra estado claro.

**Desventajas:** Si la IP sigue bloqueada tras el cooldown, el bot tarda 30 min en volver a intentar; es la política deseada para salir de la lista negra.

---

## DEC-055: Resumen diario vía evento del sistema (BOT_DAILY_SUMMARY)

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 2.1. El dueño no tenía visibilidad del estado del negocio (ventas, pedidos activos, pagos pendientes, casos con atención humana). Además, el AGENTS.md exige que Telegram dependa exclusivamente de eventos del sistema, nunca de texto generado por OpenAI.

**Alternativas consideradas:**
1. Enviar el resumen llamando directamente a `enviarMensajeTelegram()` desde `bot.ts` sin evento (rompe la regla de que Telegram depende de eventos)
2. Hacer que el LLM redacte el resumen con datos de Supabase (viola DEC-001: el LLM no consulta Supabase ni decide)
3. Crear el evento `BOT_DAILY_SUMMARY` y recorrer el pipeline de notificaciones (elegida)

**Resultado:** Nuevo evento `BOT_DAILY_SUMMARY` en `SYSTEM_EVENTS_SKIP_AI`. A las 9am CDMX, `enviarResumenDiario()` compila métricas desde el backend (`reporte_ventas`, `historial_chat`, `contarPedidosPorEstado()`, `contarCasosActivos()`, `contarCasosRequierenAtencionHumana()`) y emite el evento con el texto ya armado en `descripcion`. El template builder lo renderiza tal cual. La alerta de desconexión de las 8am se conserva (ahora `!BOT_READY && hora === 8`).

**Ventajas:** El resumen llega por el mismo pipeline de notificaciones (validación, logs, retry de Telegram). El LLM no participa. Los contadores viven en los servicios (`pedido.service.ts`, `caso.service.ts`) sin duplicar lógica.

**Desventajas:** El texto del resumen se arma en `bot.ts` (un solo lugar); si el negocio crece, la función podría trasladarse a un servicio dedicado sin cambiar el contrato del evento.

---

## DEC-056: Heartbeat diario de Telegram con alerta por WhatsApp

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 0.2. No había verificación periódica de que Telegram funcionara; un token inválido o chat ID cambiado solo se detectaba al fallar un envío.

**Alternativas consideradas:**
1. Verificar solo al arranque (existente) — no detecta fallos posteriores
2. Enviar mensaje de prueba diario a Telegram (spam innecesario al dueño)
3. Verificar la conexión diariamente a las 10am y, si falla, alertar a empleados por WhatsApp (elegida)

**Resultado:** `verificarTelegramDiario()` en `bot.ts` llama a `verificarConexionTelegram()` una vez al día (10am CDMX). Éxito → log `[Telegram] ✅ Conectado`. Falla → `notificarEmpleadosWhatsApp()` con el detalle del error.

**Ventajas:** Detección temprana de problemas de configuración. No genera spam. Reutiliza `verificarConexionTelegram()` y el servicio de notificación WhatsApp existentes.

**Desventajas:** La alerta por WhatsApp depende de que el bot esté conectado a WhatsApp; si ambos canales fallan, no hay aviso (caso límite aceptable).

---

## DEC-057: Endpoint HTTP /api/resumen para resumen operativo

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 2.2. El dueño solo veía un chat a la vez; no existía forma de listar todos los chats que requieren atención.

**Alternativas consideradas:**
1. Enviar el resumen solo por Telegram (requiere horario, no es "a demanda")
2. Crear endpoint HTTP `GET /api/resumen` que itere sobre los pedidos y casos en memoria (elegida)
3. Consultar Supabase por cada chat (lento, no refleja el estado en memoria del bot)

**Resultado:** `listarPedidosActivosGlobales()` en `pedido.service.ts` itera el Map `PEDIDOS`; `listarCasosRequierenAtencion()` en `caso.service.ts` filtra casos QUEJA o prioridad alta/crítica. `obtenerResumenOperativo()` en `bot.ts` los combina con `obtenerVentasHoy()` y se expone vía `GET /api/resumen` en el puerto `BOT_PORT` (10000).

**Ventajas:** Respuesta a demanda, sin horario. Refleja el estado real en memoria del bot. Reutiliza funciones existentes.

**Desventajas:** El endpoint expone datos del negocio; queda protegido por la red/VM (mismo acceso que `/status` y `/diag/:chatId`).

---

## DEC-058: Agregador de notificaciones Telegram (anti-spam)

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 2.3. Un solo pedido generaba 6+ notificaciones de Telegram en cadena, saturando al dueño y ocultando lo importante (AGENTS.md: Telegram es panel operativo, no spam).

**Alternativas consideradas:**
1. Enviar cada evento individual (estado anterior — 6+ notificaciones por pedido)
2. Eliminar eventos del subscriber sin buffer (se pierden transiciones relevantes como pago recibido o pedido listo)
3. Buffer de 2 min por pedido con clasificación de prioridad (elegida)

**Resultado:** `notification-aggregator.ts` clasifica eventos en críticos (inmediato), importantes (agrupados 2 min por `orderId`/`telefono`) e informativos (solo resumen diario). `telegram.subscriber.ts` enruta todo vía `routeNotification()`; PHOTO_RECEIVED mantiene `withPipelinePhoto`.

**Ventajas:** El dueño recibe 1 notificación por pedido cada 2 min. Los críticos (queja, atención humana, cancelación, pago confirmado) llegan inmediato. Los informativos (cambios de estado intermedios) se omiten del flujo y quedan en el resumen diario (2.1).

**Desventajas:** El buffer retrasa hasta 2 min las notificaciones importantes; si el proceso muere antes de expirar el buffer, esos eventos no se notifican (el resumen diario y el endpoint `/api/resumen` son el respaldo).

---

## DEC-059: Comando "¿Qué pasó?" por Telegram vía long-polling

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 2.4. El dueño no podía consultar el estado global del negocio desde Telegram; el único acceso era el endpoint HTTP `GET /api/resumen` (2.2), que requería abrir el navegador.

**Alternativas consideradas:**
1. Webhook de Telegram (requiere URL pública HTTPS + ajuste de firewall de la VM; no existía)
2. Long-polling `getUpdates` con filtro por chat autorizado (elegida — solo lectura, no requiere infraestructura nueva)
3. Botón inline de Telegram (requiere webhook o polling igualmente, además de keyboard markup)

**Resultado:** `iniciarTelegramListener()` en `lib/telegram.ts` hace polling `getUpdates` con long-poll 25s, ignora mensajes de chats no autorizados y procesa cada `update_id` una sola vez vía `offset`. `bot.ts` reconoce `/resumen`, `resumen`, `qué pasó`, `que paso`, `qué pasa`, `estado`, `/estado` y responde con `generarResumenEjecutivo()`, que reutiliza los mismos conteos del módulo 2.2 (Principio 1: no duplicar lógica).

**Ventajas:** Consulta bajo demanda sin infraestructura extra; mismo resumen que el panel HTTP; filtro por `TELEGRAM_CHAT_ID` evita que cualquiera consulte el estado; `getUpdates` solo lee, no abre puertos.

**Desventajas:** Long-polling agrega 1 petición extra cada ~26s al limit de la API de Telegram; si hay más de un proceso del bot corriendo, el mismo update puede consumirse por ambos (por eso el listener se inicia una sola vez en el arranque de bot.ts).

---

## DEC-060: Precios y horarios dinámicos desde Supabase

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 3.1. Los precios de flores y los horarios estaban hardcodeados en varios archivos (`prompt.builder.ts`, `horario.validator.ts`, `message-utils.ts`, `response.validator.ts`). Cambiar un precio requería redeploy (AGENTS.md Principio 7: reglas de negocio nunca en el prompt; sus valores deben ser editables).

**Alternativas consideradas:**
1. Hardcode actual (cada cambio = redeploy)
2. Tablas de configuración en Supabase con caché en memoria de 5 min (elegida)
3. Endpoint de administración para escribir la tabla (futuro, sin bloqueo)

**Resultado:** `configuracion.service.ts` centraliza precios y horarios con fallback a valores por defecto. Todos los validadores y el prompt builder leen de ahí. bot.ts refresca al arranque y cada 5 min.

**Ventajas:** Cambiar un precio u horario en Supabase surte efecto en ≤5 min sin redeploy; una sola fuente de verdad (Principio 1 y 2).

**Desventajas:** Depende de disponibilidad de Supabase al arranque; si falla, se usan los valores por defecto (por diseño, fallo seguro).

---

## DEC-061: transitarDesdeFlujo valida contra la máquina de estados

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 3.2. `transitarDesdeFlujo()` ignoraba el resultado de `transitar()` y retornaba siempre `true`, ocultando transiciones inválidas (pedido pagado regresando a cotizando).

**Alternativas consideradas:**
1. Devolver el resultado de `transitar()` (elegida)
2. Eliminar `transitarDesdeFlujo()` y usar `transitar()` directo (migración mayor, rompe compatibilidad con llamadas existentes)
3. Lanzar excepción en transición inválida (rompe el flujo de WhatsApp)

**Resultado:** `transitarDesdeFlujo()` retorna el booleano real, es idempotente y emite `PROVIDER_FAILURE` con dedup de 30 min al fallar. `transitarDesdeFlujoSeguro()` en message-handler bloquea estados pagados/terminales antes de intentar la transición.

**Ventajas:** Las transiciones inválidas se detectan, loguean y notifican a Telegram sin romper el chat con el cliente.

**Desventajas:** Un `PROVIDER_FAILURE` por transición inválida llega a Telegram (crítico); con dedup de 30 min no satura.

---

## DEC-062: Cooldown específico por tipo de evento de notificación

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 3.3. Algunas emisiones no pasaban por `debeEnviarAlertaDedup()` ni por cooldown, arriesgando notificaciones repetidas (PHOTO_SENT, HUMAN_REQUIRED de imagen, ZONA_AMBIGUA).

**Alternativas consideradas:**
1. Dejar como estaba (spam potencial)
2. Un solo cooldown global (podría suprimir eventos urgentes)
3. Cooldown por tipo con la key correcta (elegida)

**Resultado:** Queja (CUSTOMER_ANGRY) 30 min, cancelación 20 min, PHOTO_SENT 30 min, imagen sin contexto 20 min, ZONA_AMBIGUA 30 min. Los cooldowns existentes (HUMAN_REQUIRED 20, COTIZACION 30, ENVIO 30, PHOTO_REQUESTED 60) se verificaron correctos.

**Ventajas:** Cada tipo de evento tiene su propio período; los urgentes nunca se suprimen por cooldowns de otros tipos.

**Desventajas:** Un evento suprimido por dedup no se emite (respaldo: resumen diario y `/api/resumen`).

---

## DEC-063: Validador central de nombres plausibles (esNombrePlausible)

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 4.1. El parser de nombre aceptaba contaminación (números, emojis, URLs, relleno) y el fallback de message-handler.ts podía guardar nombres que el parser rechazaba. AGENTS.md ERROR #1 (caso Lizet) exigía no volver a almacenar frases completas.

**Alternativas consideradas:**
1. Regex monolíticos gigantes (rechazados: AGENTS.md prohíbe regex complejos)
2. Una sola función `esNombrePlausible()` reutilizada en parser, bot.ts y message-handler (elegida)
3. Solo arreglar el parser, sin tocar los fallbacks (rechazada: dejaba la vía de escape en message-handler:832)

**Resultado:** `esNombrePlausible()` centraliza: STOP_WORDS (con palabras de relleno), `MAX_WORDS = 5`, `MIN_LENGTH = 2`, rechazo de números/emojis/URLs/caracteres especiales y frases no válidas. Se usa en `parseNombre`, `pareceNombreCliente`, `tieneNombreValido`, `nombreParaAlerta` y el fallback de extracción de nombre.

**Ventajas:** Una única fuente de verdad para "esto parece un nombre"; los fallbacks ya no reintroducen contaminación; cubre el caso Lizet y evita nombres con URLs/números/emojis.

**Desventajas:** Nombres poco convencionales (apodos con números, nombres extranjeros con guiones) se rechazan; es el trade-off esperado para evitar datos corruptos.

---

## DEC-064: Response Validator con set autorizado de precios y validaciones por confirmación explícita

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 4.2. El response validator solo cubría algunos casos de alucinación. AGENTS.md Parte 3 exige que el LLM nunca confirme horarios, stock, entregas, pagos, precios o sucursales sin respaldo del backend.

**Alternativas consideradas:**
1. Regex monolíticos que rechazaran cualquier número/hora/sucursal no literal en contexto (rechazada: demasiados falsos positivos, el LLM legitima sumas de precios y menciona horas neutrales)
2. Set autorizado de precios (contexto ∪ precios referenciales ∪ `precioMinimo`) con suma derivada permitida + validaciones de confirmación que solo se disparan con frase explícita (elegida)
3. Confiar en `validarHorario()` para horas (rechazada: depende de horarios estáticos; el módulo 3.1 ya trae `obtenerHorarios()` dinámicos con cierre de fin de semana)

**Resultado:** `validarPreciosRespuesta()` acepta precios ≤ 100 (notas/referencias), precios del set autorizado o sumas derivadas (a+b±1). Las horas se validan contra `obtenerHorarios()` y solo se rechazan si hay frase de confirmación ("sí podemos", "está a tiempo"). Stock, entrega, pago y sucursal se rechazan con frases explícitas; `validarEntregaFecha()` y `validarSucursalRespuesta()` exigen respaldo literal en contexto/`SUCURSALES_INFO`. Frases con "sí," toleran coma (caso real "Sí, tenemos...").

**Ventajas:** Bajo índice de falsos positivos (solo rechaza confirmaciones explícitas sin respaldo); precios referenciales y horarios dinámicos; se corrigió además el bug latente de `lastIndex` en `extraerPrecios()` con regex global compartido.

**Desventajas:** Una alucinación que no use frase explícita de confirmación podría no detectarse; se compensa con el `HUMAN_REQUIRED` cuando el LLM inventa contexto no validado.

---

## DEC-065: Inventario dinámico desde Supabase con validación de confirmaciones de stock

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 5.1. El bot podía prometer arreglos inexistentes. No existía verificación de inventario. AGENTS.md (Parte 3) exige que el backend valide inventario y que el LLM nunca confirme disponibilidad sin respaldo.

**Alternativas consideradas:**
1. Inventario estático en TypeScript (rechazada: viola "reglas de negocio editables sin redeploy" y el patrón ya creado en el módulo 3.1 con `configuracion.service`)
2. Nuevo `inventario.service.ts` con caché TTL 5 min + tabla Supabase (elegida — misma arquitectura que precios/horarios)
3. Que el response validator siguiera rechazando TODAS las confirmaciones de stock (rechazada: con inventario real, "sí tenemos rosas" cuando hay rosas es correcto; rechazarlo generaría falsos HUMAN_REQUIRED)

**Resultado:** `inventario.service.ts` expone `obtenerInventarioDisponible()`, `verificarDisponibilidad()` y `obtenerTextoDisponibilidad()`. El prompt recibe `[PRODUCTOS DISPONIBLES]` solo cuando hay datos. El response validator usa `esProductoMencionado()` (normaliza con `normalizarTexto` y singulariza plurales: "ramos de rosas"→"ramo", "rosas"→"rosa") para permitir confirmar stock únicamente cuando la respuesta menciona un producto real disponible; sin datos conserva el rechazo del módulo 4.2.

**Ventajas:** El bot solo confirma lo que el backend verifica; sin tabla creada no rompe nada (se comporta como antes); misma convención de caché que el módulo 3.1; prepara la base para inventario inteligente (Fase D de AGENTS.md).

**Desventajas:** La detección por tokens puede tener falsos positivos con nombres de una sola palabra muy genérica; se mitigó exigiendo tokens ≥4 caracteres y excluyendo stopwords. La tabla debe mantenerse manualmente.

---

## DEC-066: Seguimiento de reclamaciones vía comandos de Telegram

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 5.2. Las reclamaciones se registraban en Supabase (`registrarReclamacion()`) pero nadie podía verlas ni cerrarlas: quedaban en "pendiente" para siempre.

**Alternativas consideradas:**
1. Panel web administrativo completo (rechazada: es el módulo 5.3, más grande; el dueño ya opera por Telegram)
2. Comandos de Telegram `/reclamaciones` y `/marcar_resuelto <id>` (elegida — el dueño ya usa Telegram como panel operativo según AGENTS.md)
3. Correo automático por cada reclamación (rechazada: spam; mejor consulta bajo demanda)

**Resultado:** `src/reclamaciones/reclamacion.service.ts` con `listarReclamaciones(estado?)`, `marcarReclamacionResuelta(id)` y `formatearReclamaciones()` (formato Telegram con id corto para marcar resuelto). `bot.ts` `manejarComandoTelegram()` soporta `/reclamaciones` y `/marcar_resuelto <id>`.

**Ventajas:** El dueño ve y cierra reclamaciones desde su celular sin tocar la web; Telegram sigue siendo panel operativo y no una copia de WhatsApp (Principio AGENTS.md); prepara el camino para el dashboard del módulo 5.3.

**Desventajas:** La identificación por uuid corto (7 caracteres) es suficiente por cardinalidad actual pero podría colisionar con muchas reclamaciones; se documenta para revisar si escala.

---

## DEC-067: Prompt system alineado con la arquitectura de motores

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Revisión solicitada por el dueño del prompt subido en Supabase. El `system_prompt` (15,189 caracteres, 2026-07-17) estaba desalineado con la arquitectura actual: nombraba anotaciones que el código ya no emite (`[PEDIDO EN CURSO VERIFICADO POR SISTEMA]`, `[CLIENTE RESPONDIO A LA FOTO DE...]`, `[CLIENTE MENCIONO UNA ZONA...]`, `[CLASIFICACION_JSON]`, `[Fecha actual]`), hardcodeaba horarios/precios que ahora son dinámicos (módulo 3.1), no mencionaba `[REGLAS VALIDADAS POR EL BACKEND]` ni `[PRODUCTOS DISPONIBLES]` (módulo 5.1), no incluía el anticipo 50% y trataba `[VENTA_CERRADA:...]` como mecanismo principal de cierre (contradice ERROR #4 de AGENTS.md).

**Alternativas consideradas:**
1. Mantener el prompt de Supabase tal cual (rechazada: el LLM obedecía anotaciones que no existen y podía contradecir precios/horarios dinámicos)
2. Escribir el prompt corregido solo en la página del cerebro de Flora (rechazada: sin versión en el repo no hay trazabilidad ni rollback)
3. Nuevo `src/prompts/system-prompt.corregido.ts` como fuente oficial en el repo + `scripts/subir-prompt-corregido.ts` para publicarlo en `configuracion_bot` (elegida)

**Resultado:** El prompt corregido (11,860 caracteres) delega horarios, pagos, sucursales y precios a la sección `[REGLAS VALIDADAS POR EL BACKEND]` que el backend inyecta siempre (Principio 7 de AGENTS.md: reglas de negocio fuera del prompt); documenta las anotaciones reales; añade la regla de stock del módulo 5.1; convierte `[VENTA_CERRADA:...]` en respaldo opcional (el backend ya registra el pedido). Se subió a Supabase el 2026-07-31 y se verificó su contenido.

**Ventajas:** El LLM nunca contradice la configuración dinámica; una sola fuente de verdad del prompt en el repo; rollback simple re-subiendo la versión anterior; el prompt es ~3,300 caracteres más corto.

**Desventajas:** Si alguien edita el prompt directamente en la página del cerebro de Flora, el repo queda desincronizado (el prompt de Supabase manda sobre el fallback). Se mitiga documentando el flujo: editar en el repo → subir con el script.

---

## DEC-068: Dashboard administrativo web vía REST en api/server.ts

**Fecha:** 2026-07-31
**Estado:** Aceptada

**Motivo:** Módulo 5.3. El servidor Express del bot (`startServer()`) existía pero el dueño no podía consultar ni modificar pedidos activos desde el navegador; solo había `/status`, `/qr`, `/diag/:chatId`, `/api/pedidos/sync` y `/api/resumen`.

**Alternativas consideradas:**
1. Construir el dashboard entero en Next.js leyendo `pedidos_bot` (rechazada: duplicaría la máquina de estados y el Order Engine en el frontend)
2. Exponer el estado en memoria directamente (rechazada: filtraba `fotoReferenciaBase64` y datos internos)
3. Endpoints REST finos en `api/server.ts` que delegan en `pedido.service.ts` vía `BotContext` (elegida)

**Resultado:** `BotContext` ampliado con `listarPedidosActivos`, `obtenerDetallePedido`, `actualizarPrecioPedido` y `cambiarEstadoPedido`. Nuevos endpoints `GET /api/pedidos`, `GET /api/pedidos/:id`, `POST /api/pedidos/:id/precio`, `POST /api/pedidos/:id/estado`. Nuevo `PedidoResumenDTO` que nunca expone la foto base64. `obtenerPedidoPorId(id)` resuelve por `id` de pedido o `clienteId`. El cambio de precio fija `precioConfirmadoPor=EQUIPO` y transita a `PRECIO_CONFIRMADO`; el cambio de estado valida la máquina de estados con `cambiarEstado` (sin saltos, regla de AGENTS.md). Ambos persisten con `persistirPedidosEngine()` y emiten eventos → Telegram se entera sin tocar el texto del LLM (Principio 9 de AGENTS.md).

**Ventajas:** El backend sigue siendo el único que decide (OpenAI nunca modifica precios/estados); la UI de `app/admin/operaciones` ya escribe a `pedidos_bot` y puede consumir estos endpoints o continuar con el flujo PATCH + `/api/pedidos/sync`; sin duplicación de lógica; los POST siguen la máquina de estados.

**Desventajas:** Los cambios manuales de estado/​precio desde el dashboard no piden confirmación adicional; el `BotContext` crece (mitigado: cada método delega en servicios y no contiene lógica).

---

## DEC-069: Migración del proveedor de IA a Gemini (GitHub Models retirado)

**Fecha:** 2026-08-03
**Estado:** Aceptada

**Motivo:** Toda la IA del bot dejó de funcionar. GitHub Models fue retirado oficialmente el 2026-07-30 (docs: "GitHub Models has been fully retired... inference API... no longer available"). Los endpoints daban 404 (`models.inference.ai.azure.com/chat/completions`) o 410 (`models.github.ai/inference/chat/completions`). Los 4 tokens seguían válidos en `api.github.com` (login `cantedavid00-afk`) pero ninguna llamada a modelo funcionaba. `lib/ai.ts` intentaba GitHub primero y solo caía a Gemini en errores 401, por lo que 404/410 dejaban el sistema sin IA.

**Alternativas consideradas:**
1. Reactivar GitHub Models (rechazada: el servicio está retirado, no es un problema de tokens/concurrencia/límites)
2. Cambiar `IA1_BASE_URL`/`IA2_BASE_URL` a otro proveedor compatible con OpenAI SDK (rechazada: agrega dependencias y cuentas nuevas; Gemini ya tiene key válida)
3. **Gemini primario, GitHub como respaldo (elegida):** invertir `callWithFallback`, migrar visión y chat a `generateContent` con imágenes inline, dejar GitHub únicamente como fallback por si algún proveedor vuelve

**Resultado:** `callWithFallback` invertido (Gemini primero, GitHub respaldo). Modelo por defecto `gemini-2.5-flash` (free tier ~10 RPM / ~1,500 RPD / 250K TPM — suficiente para ~5 clientes concurrentes cada 10 min). Visión migrada con `maxOutputTokens: 400` (120 truncaba el JSON de Gemini 2.5) y parseo con `extraerJsonObjeto`. `getAIResponse` usa `generateContent` + `systemInstruction` (elimina la duplicación del último mensaje de `startChat`). Todas las llamadas primarias de Gemini envueltas en `conRetry` (3 intentos, backoff) para tolerar 503/429. `.env.example` actualizado: Gemini como principal, GitHub y IA1/IA2 comentados como retirados.

**Ventajas:** Sin dependencias nuevas (usa `@google/generative-ai` ya instalado); key de Gemini validada (HTTP 200 en `listModels` y `generateContent`); tráfico del negocio muy por debajo de los límites free tier; fallback conservado por compatibilidad futura.

**Desventajas:** Free tier de Google puede usar los prompts para entrenamiento (términos de Gemini); el semáforo `MAX_CONCURRENT=3` limita la concurrencia (mitigado: suficiente para el volumen actual); `order.reconstructor.ts` y `order.auditor.ts` siguen apuntando a GitHub Models pero son código muerto (no se importan).

---

## DEC-070: IA multi-proveedor con cuotas independientes (fallback en cadena)

**Fecha:** 2026-08-03
**Estado:** Aceptada

**Motivo:** La suposición de DEC-069 era incorrecta: el free tier de `gemini-2.5-flash` **no es** ~10 RPM / ~1,500 RPD. Google lo recortó a ~20 peticiones/día (dic-2025). El 2026-08-04 el bot agotó la cuota en ~40 minutos (`429 generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash`) y el fallback a GitHub Models devolvió 401. Además `maxOutputTokens: 800` truncaba respuestas largas del cliente.

**Alternativas consideradas:**
1. Mantener solo Gemini 2.5-flash (rechazada: 20 RPD no cubre una sola conversación real de ~15 mensajes con 3 llamadas IA c/u)
2. Migrar a `gemini-2.0-flash` (rechazada: descontinuado el 1-jun-2026)
3. **Multi-proveedor en cadena (elegida):** Gemini primario con `gemini-2.5-flash-lite` (~15 RPM / ~1,000 RPD) + fallback a proveedores OpenAI-compatibles (OpenRouter → Groq → Cerebras → GitHub), cada uno con cuota diaria propia
4. Activar billing de Google (rechazada por ahora: el usuario prefiere free tier con varios proveedores)

**Resultado:** `lib/ai.ts` define la cadena `OPENAI_COMPAT_PROVIDERS` (solo los proveedores con API key configurada). `callWithFallback` recorre la cadena en orden si Gemini falla. `GEMINI_MODEL` por defecto `gemini-2.5-flash-lite`. `maxOutputTokens`: chat 800 → 2048, visión 400 → 1024. Eliminado `githubClient`, `REVIEW_MODEL` y el fetch manual de visión de GitHub. `.env.example` documenta `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY` como opcionales.

**Ventajas:** Cuota diaria total = suma de cuotas de cada proveedor configurado; tolera 429/5xx de cualquiera de ellos; OpenRouter agrega visión (Gemini Flash free); cero costo y sin tarjeta.

**Desventajas:** Requiere crear cuentas en los proveedores de fallback y configurar las keys en `.env.local`; modelos de fallback (Llama 3.3 70B) pueden tener tono menos afinado que Gemini para venta floral.

---

## DEC-071: Normalizar teléfono LID — nunca guardar el jid crudo (@lid) (BUG-011)

**Fecha:** 2026-08-04
**Estado:** Aceptada

**Motivo:** Los contactos que usan cuenta vinculada (`@lid`) no siempre resuelven su número real contra el mapeo de Baileys. `obtenerNumeroReal` devolvía el jid crudo (`5212345...@lid` o `...@lid:15`) en ese caso, y ese valor se persistía en pedidos Supabase, alertas WhatsApp y eventos Telegram. Además `jidToTelefono` no limpiaba el sufijo `:dispositivo` (a diferencia de `jidANumero`), por lo que el mismo cliente aparecía con dos identificadores distintos entre el historial y las alertas.

**Alternativas consideradas:**
1. Resolver siempre el LID contra el mapeo (rechazada: el mapeo no siempre existe en `BAILEYS_KEYS`, el propio `@lid` es un identificador de privacidad de WhatsApp)
2. Devolver el jid crudo tal cual (rechazada: es lo que producía el bug)
3. **Normalizar con `jidANumero` (elegida):** quitar `@lid` y `:dispositivo`, dejando solo el identificador numérico. La detección de LID en `esLid`/`formatearNumero` sigue funcionando por longitud (>13 dígitos)

**Resultado:** `obtenerNumeroReal` (contact.service.ts) normaliza el LID no resoluble con `jidANumero` en lugar de devolver el jid crudo. `jidToTelefono` (conversation.service.ts) ahora también elimina el sufijo `:dispositivo`, quedando alineado con `jidANumero`. Nuevo test `tests/telefono.test.mts` (`npm run test:telefono`).

**Ventajas:** Identificador único y consistente para cada cliente en historial, alertas, pedidos y eventos; sin dependencia del mapeo LID de Baileys; sin cambios de esquema.

**Desventajas:** Un LID sin resolver ya no expone la marca `@lid` explícita en el dato crudo (mitigado: `esLid` lo detecta por longitud y el formato de alerta lo muestra como "Cuenta vinculada").

---

## DEC-072: Mostrar fecha/hora de entrega en las notificaciones operativas de Telegram (BUG-012)

**Fecha:** 2026-08-04
**Estado:** Aceptada

**Motivo:** Los templates operativos de Telegram (VENTA CERRADA, PEDIDO APARTADO, PAGO PENDIENTE) omitían la fecha/hora de entrega del pedido, aunque `verified.fecha`/`verified.hora` ya llegaban desde el timeline (`fecha_entrega`/`hora_entrega` en Supabase). El equipo debía consultar el dashboard para saber cuándo preparar/entregar, con riesgo de demoras en pedidos confirmados.

**Alternativas consideradas:**
1. Agregar fecha/hora al payload de cada evento (`PAYMENT_RECEIVED`, `ORDER_CREATED`, etc.) (rechazada: duplica datos que ya viven en Supabase y contradice el Principio 2 del AGENTS.md — un mismo dato en dos lugares)
2. **Leer fecha/hora desde el timeline en el template (elegida):** el pipeline ya las resuelve en `verified`; el template solo debe renderizarlas cuando existan

**Resultado:** En `template.builder.ts` se agregó `getFechaHora(verified)` y la línea `📅 <fecha> <hora>` en los templates `ORDER_CREATED`/`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`, `ORDER_UPDATED` y `PAYMENT_PENDING`. Sin fecha/hora la línea se omite. Nuevo test `tests/template-payment.test.mts` (`npm run test:template`).

**Ventajas:** El equipo ve la fecha de entrega sin abrir el dashboard; sin cambios de contrato de eventos ni de esquema; la fecha sigue teniendo una única fuente de verdad (Supabase).

**Desventajas:** Si el pedido aún no tiene fecha/hora registradas, la línea no aparece (correcto: no inventar datos). Los caracteres de fecha requieren escape MarkdownV2 (`-` → `\-`), ya manejado por `esc`.

---

## DEC-073: ORDER_CREATED siempre con payload completo — un único punto de emisión (BUG-013)

**Fecha:** 2026-08-04
**Estado:** Aceptada

**Motivo:** Cada emisor de `ORDER_CREATED` armaba su payload manualmente y omitía campos: `crearPedido` sin `sucursal`/`metodoPago`, el alerta "comprobante-pendiente" sin `orderId`, y el cotizador web emitía un evento huérfano sin `orderId` ni respaldo en DB. El Notification Engine (Decision Extractor, Conflict Detector, Business Rules Validator, RR003/RR006) dependía de esos campos para verificar contra la DB.

**Alternativas consideradas:**
1. Seguir armando payloads inline en cada emisor (rechazada: es lo que producía el bug; duplica lógica)
2. **Unificar detrás de `buildOrderPayload` y crear el pedido real antes de emitir (elegida):** `crearPedido` emite con `...buildOrderPayload(pedido)`; el alerta incluye `orderId: pedido.id`; el flujo web crea el pedido en el engine con `crearPedido(...)` y deja que ese único punto emita el evento completo. Sin pedido real no se emite `ORDER_CREATED` huérfano.

**Resultado:** `pedido.service.ts` (crearPedido usa buildOrderPayload, buildOrderPayload respeta `pedido.descripcion`), `message-handler.ts` (orderId en comprobante-pendiente), `bot.ts` (cotizador web usa crearPedido), `src/models/types.ts` (`PedidoActual.descripcion?: string` opcional).

**Ventajas:** Un solo punto que arma el payload correcto; cada evento tiene `orderId` con respaldo en DB; el pipeline recibe sucursal/metodoPago para verificar (RR003/RR006); se elimina `ORDER_CREATED` huérfano del flujo web.

**Desventajas:** `PedidoActual` gana un campo opcional `descripcion` (compatible; sin cambios de esquema de DB). El flujo web ahora crea el pedido en el engine, lo que agrega persistencia temprana (deseado: el pedido existe desde el inicio).

---

## DEC-074: Migrar a gemini-3.1-flash-lite + script `npm run check:apis` (BUG-014)

**Fecha:** 2026-08-04
**Estado:** Aceptada

**Motivo:** Al verificar todas las APIs, el proveedor primario `gemini-2.5-flash-lite` devolvía 404 (familia Gemini 2.5 deprecada por Google, shutdown 2026-10-16). El bot dependía en silencio del fallback OpenRouter/Groq.

**Alternativas consideradas:**
1. Dejar el fallback como única vía (rechazada: pierde el proveedor gratuito principal y su cuota)
2. **Migrar al reemplazo oficial `gemini-3.1-flash-lite` (elegida):** verificado con llamada real (HTTP 200). Es el modelo GA vigente, multimodald y gratuito.
3. Crear un script `scripts/check-apis.mts` accesible como `npm run check:apis` para detectar caídas de proveedores sin esperar a que falle un caso real (adoptado — observabilidad, regla del AGENTS.md "todo cambio importante genera log/verificación").

**Resultado:** `lib/ai.ts` default → `gemini-3.1-flash-lite`; `.env.local`/`.env.example` actualizados; nuevo script de verificación que prueba Gemini, OpenRouter, Groq, Cerebras, IA1/IA2 y Telegram/Supabase.

**Ventajas:** Proveedor primario restaurado; verificación reproducibles de todas las APIs en un comando; CI-friendly (salida 0/1).

**Desventajas:** Si Google vuelve a cambiar la familia de modelos, hay que revisar `GEMINI_MODEL` de nuevo (mitigado: ahora hay un comando de verificación que lo detecta).

---

## DEC-075: Silencio del bot ante cualquier respuesta del equipo durante la agrupación (v2.1.8)

**Fecha:** 2026-08-04
**Estado:** Aceptada

**Motivo:** La condición original (`bot.ts`) callaba a Flora únicamente cuando el empleado cotizaba un precio durante la ventana de agrupación de 50s (`intervencion.precio && esTextoReferenciaOCotizacion`). Si el empleado respondía sin precio (ej. "Te paso las fotos en un momento"), el bot respondía igual y duplicaba al equipo.

**Alternativas consideradas:**
1. Mantener la condición restringida (rechazada: deja el caso "empleado responde sin precio" sin protección).
2. **Cualquier respuesta del empleado dentro de la ventana calla al bot (elegida):** la presencia de una intervención humana reciente es señal suficiente de que el equipo tomó la conversación. El bot reanuda automáticamente cuando el cliente escribe un mensaje nuevo fuera de la ventana (`haceMs > AGRUPAR_MENSAJES_MS + 1.5s`).
3. Exigir solo texto de referencia/cotización sin precio (rechazada: sigue sin cubrir respuestas tipo "te paso fotos" / "claro").

**Resultado:** `bot.ts` — condición reducida a `humanoRespondioDuranteEspera`; se elimina el import de `esTextoReferenciaOCotizacion`.

**Ventajas:** Regla predecible ("si el equipo responde, el bot cierra la boca"); reduce duplicados; compatible con la ventana de 50s existente.

**Desventajas:** Si un empleado envía un mensaje irrelevante durante la ventana (ej. por error), esa tanda del bot queda en silencio; mitigado porque el TTL de la intervención es de 10 min y la ventana de silencio es de ~51.5s.

---



