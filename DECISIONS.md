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

