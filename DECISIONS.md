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
