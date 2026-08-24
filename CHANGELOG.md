# CHANGELOG

## 2026-08-23 (6)

### Feat — Digest con estado de TODOS los chats + día de la semana contextual + resumen más corto (DEC-086)

**Objetivo:** El admin ahora ve qué se habló en TODAS las conversaciones analizadas (incluso finalizadas), el mensaje es más corto, y la IA interpreta correctamente los días relativos ("mañana" dicho un sábado = domingo del mensaje).

**Implementación:**
- **`lib/ai.ts`**: nuevo contrato `AnalisisChatItem { telefono, estado (siempre), novedad? }`; prompt con regla DIA DE LA SEMANA (marcas 📅 por día calendario) y estados de máx 90 caracteres incluyendo ventas cerradas.
- **`src/novedades/novedades.service.ts`**: helper compartido `mensajesALineas()` que inserta marcadores `[📅 sábado 22/08]` al cambiar de día; digest guarda `estadosChats[]` (máx 40); `construirMensajeNovedades` v2 — sección novedades (máx 8) + sección "💬 Todos los chats" (máx 12), sin pie decorativo.
- **Dashboard**: `GET /api/novedades` devuelve `estadosChats` enmascarado; `/admin/administradores` muestra la sección "Estado de todos los chats".

**Archivos modificados:** `lib/ai.ts`, `src/novedades/types.ts`, `src/novedades/novedades.service.ts`, `app/api/novedades/route.ts`, `app/admin/administradores/page.tsx`, `DECISIONS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; suite completa OK (`test:novedades`, `test:validator`, `test:horario`, `test:flows`).

**Impacto:** Compatible. `estadosChats` es campo nuevo opcional; digests viejos siguen leyéndose.

**Rollback:** Sí.

---

## 2026-08-23 (5)

### Fix — Fallback del system prompt alineado + logs visibles + tono de Flora en la revisora (BUG-027)

**Problema (auditoría de flujos de IA):** Si fallaba la lectura de `configuracion_bot.system_prompt` sin caché, el bot usaba silenciosamente `FALLBACK_SYSTEM_PROMPT` — un prompt VIEJO hardcodeado (~10 KB) con datos desactualizados (Norte 18:00, anticipo 50%, anotaciones inexistentes) → Flora contestaba "distinta a la del Cerebro" sin rastro. Además, la revisora podía reescribir respuestas sin respetar la personalidad.

**Aclaración de la auditoría:** NO hay cruce cliente↔admin. El system_prompt del Cerebro SOLO alimenta `getAIResponse` (flujo de clientes). Novedades (`resumirNovedadesChats`) y seguimiento de admins (`responderConsultaAdmin`) usan prompts internos propios; el chat del admin no se guarda en historial.

**Solución:**
1. Eliminado `FALLBACK_SYSTEM_PROMPT`; fallback ahora = `SYSTEM_PROMPT_CORREGIDO` (espejo actualizado del repo).
2. Ambos caminos de fallback escriben en tabla `logs` → visibles en `/admin/logs`.
3. `revisarRespuestaFlora`: nueva regla "TONO AL CORREGIR" (voz de Flora, máx 3 líneas, 1-2 emojis, una pregunta).

**Archivos modificados:** `lib/ai.ts`, `KNOWN_BUGS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; suite completa OK; grep confirma 0 referencias al prompt eliminado.

**Impacto:** Compatible. El comportamiento normal no cambia; solo el camino de emergencia queda alineado y observable.

**Rollback:** Sí.

---

## 2026-08-23 (4)

### Feat — Fotos de contexto en el seguimiento del admin (DEC-085)

**Objetivo:** Al preguntar por un chat ("¿qué pasó con el 7890?"), la IA ahora VE hasta 2 imágenes recientes del chat y describe qué son: dirección/ubicación, comprobante de pago, foto de referencia de arreglo para cotizar u otra, con el dato clave visible (calle, banco/monto, tipo de flores).

**Implementación:**
- **Nueva tabla `media_chat`** (`supabase_migration_media_chat.sql`): guarda las últimas imágenes/documentos que envía el cliente, **podadas automáticamente a 2 por teléfono**. Requiere ejecutar la migración en Supabase.
- **`src/novedades/media-chat.repository.ts`**: `guardarMediaChat()` (insert + poda) y `obtenerImagenesPorTelefono()` (por variantes 52/521).
- **`src/whatsapp/message-handler.ts`**: `procesarMediaAcumulado` persiste cada imagen recibida (fire-and-forget, no bloquea la venta).
- **`lib/ai.ts`**: `responderConsultaAdmin(pregunta, chats, imagenes[])` — adjunta hasta 2 imágenes al modelo de visión (Gemini inlineData; OpenAI-compat image_url solo en proveedores con visión), pide clasificar cada una y extraer el dato clave.
- **`src/novedades/novedades.service.ts`**: `consultarChatParaAdmin` recupera las imágenes del chat y añade marcador `[*N IMAGEN(ES) ADJUNTA(S)*]` a la transcripción.

**Archivos nuevos:** `supabase_migration_media_chat.sql`, `src/novedades/media-chat.repository.ts`
**Archivos modificados:** `lib/ai.ts`, `src/novedades/novedades.service.ts`, `src/novedades/index.ts`, `src/whatsapp/message-handler.ts`, `DECISIONS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; suite completa OK (`test:novedades`, `test:validator`, `test:horario`, `test:flows`).

**Impacto:** Compatible. **Requiere ejecutar `supabase_migration_media_chat.sql` en producción.** Las imágenes se capturan desde el momento del despliegue (las anteriores no existen).

**Rollback:** Sí — revertir commit; la tabla queda sin uso (inofensiva).

---

## 2026-08-23 (3)

### Feat — Máscara de números, exclusión de admins y preguntas de seguimiento por WhatsApp (BUG-026)

**Objetivo:** El digest ahora muestra solo los últimos 4 dígitos del celular; el propio admin ya no aparece en las novedades; y se puede preguntar más sobre un chat específico ("¿qué pasó con el 7890?" / "¿y Lizet?") y la IA responde leyendo ese chat.

**Implementación:**
- **`src/novedades/novedad.detector.ts`**: `mascararTelefono()` (•••• XXXX) y `extraerUltimos4()`.
- **`src/novedades/novedades.service.ts`**: digest con máscara; exclusión de admins tras fusionar novedades; nueva `consultarChatParaAdmin(pregunta)` — localiza el chat por últimos 4 dígitos (real resuelto o guardado) o por nombre (`pedidos_bot`), lee últimos 60 mensajes, y responde con `responderConsultaAdmin()` (1 llamada IA pequeña solo al preguntar).
- **`lib/ai.ts`**: `responderConsultaAdmin()` — respuesta breve basada solo en la transcripción, sin inventar datos.
- **`src/novedades/admin.handler.ts`**: enrutado de intención — "novedades" → digest sin LLM; pregunta de detalle → consulta con IA; fallo → mensaje de ayuda.
- **`bot.ts`**: demora anti-ban aleatoria 8–15 s con presencia "escribiendo...".
- **Dashboard**: `GET /api/novedades` devuelve teléfonos enmascarados; hint de uso en `/admin/administradores`.

**Archivos modificados:** `src/novedades/*`, `lib/ai.ts`, `bot.ts`, `app/api/novedades/route.ts`, `app/admin/administradores/page.tsx`, `tests/novedades.test.mts`, `KNOWN_BUGS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:novedades` ampliado (máscara, últimos 4, digest sin número completo); suite completa OK.

**Impacto:** Compatible. Los follow-ups gastan 1 llamada IA pequeña por pregunta del admin (uso ocasional).

**Rollback:** Sí.

---

## 2026-08-23 (2)

### Fix — Números reales (LID), solo chats de hoy/ayer, cotizaciones completas y respuesta anti-ban (BUG-025)

**Problema:** (1) El digest mostraba números que no eran el WhatsApp real: `clientes.telefono` guarda los dígitos del LID para clientes con cuenta vinculada. (2) Aparecían chats antiguos sin actividad en la ventana. (3) Faltaban cotizaciones pendientes. (4) La respuesta al admin salía instantánea (patrón bot, riesgo de baneo).

**Solución:**
- **`src/whatsapp/contact.service.ts`**: `resolverLidInverso()` consulta el mapeo LID→PN de Baileys; las transcripciones sustituyen el teléfono LID por el real cuando hay mapeo.
- **`src/novedades/novedad.detector.ts`**: `filtrarNovedadesDeChatsActivos()` — las reglas backend solo cuentan si el chat tuvo mensajes dentro de la ventana analizada.
- **`lib/ai.ts`**: prompt reporta TODA cotización sin confirmar aunque el chat siga o cierre; hasta 2 novedades/chat por temas distintos; transcripción 1,600 chars/chat.
- **`bot.ts`**: la respuesta al admin muestra "escribiendo..." ('composing') ~10 s antes de enviarse.

**Archivos modificados:** `src/whatsapp/contact.service.ts`, `src/novedades/novedad.detector.ts`, `src/novedades/novedades.service.ts`, `lib/ai.ts`, `bot.ts`, `tests/novedades.test.mts`, `KNOWN_BUGS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:novedades` ampliado (filtro de chats activos); suite completa OK.

**Impacto:** Compatible. Nota: los LIDs sin mapeo en Baileys seguirán mostrando sus dígitos internos (no existe fuente del número real); con el uso normal del bot el mapeo se va poblando.

**Rollback:** Sí.

---

## 2026-08-23

### Fix — Scheduler diario muerto por Invalid Date + botón de regeneración manual de novedades (BUG-024)

**Problema:** Tras 2 días en producción, el motor de novedades nunca había generado el digest ni enviado nada a las 6 am. Causa raíz: el bloque de jobs diarios de `bot.ts` parseaba `toLocaleString('es-MX')` con `new Date()`, y ese formato ("23/8/2026, 12:28 p.m.") produce **Invalid Date** en Node → `getHours()` = NaN → ninguna condición se cumplía jamás. Estaban muertos TODOS los jobs diarios: alerta 8 am, resumen 9 am a Telegram, check Telegram 10 am, generación 3 am y envío 6 am. Además, aunque el digest hubiera existido, la conversación "recoge su pedido hoy a las 11" no habría aparecido: el prompt descartaba ventas cerradas.

**Solución:**
- **`src/whatsapp/message-utils.ts`**: nueva `fechaYHoraCdmx()` con `Intl.DateTimeFormat.formatToParts()` (`hourCycle: 'h23'`) — cero parseo de strings.
- **`bot.ts`**: scheduler usa el helper; cada job ahora deja log en consola Y en la tabla `logs` (visible en /admin/logs). Nuevo comando remoto `regenerar_novedades` en `revisarComandoRemoto` (polling cada 5 s, mismo canal que reconnect/recover). Nuevos métodos `regenerarNovedades()`/`obtenerNovedadesMensaje()` en el ctx del server.
- **`src/api/server.ts`**: endpoints `GET /api/novedades` (digest actual) y `POST /api/novedades/regenerar` (regenera con ventana de 48 h).
- **Dashboard**: rutas `/api/novedades` (GET) y `/api/novedades/regenerar` (POST vía `bot_command`); la página `/admin/administradores` muestra el digest actual y un botón **"🔄 Actualizar ahora"** que envía el comando y espera el resultado (polling de `generadaEn`, máx 90 s).
- **Motor de novedades**: 60 mensajes por chat (antes 50); ventana `reciente` (últimas 48 h) para regeneración manual; nuevas categorías `entrega_programada` y `esperando_respuesta_equipo`; prompt IA ya NO descarta ventas cerradas con datos operativos (reporta horas de recogida/entrega confirmadas); encabezado del mensaje adapta según ventana.
- **`lib/ai.ts`**: prompt actualizado con las categorías nuevas.

**Archivos modificados:** `src/whatsapp/message-utils.ts`, `bot.ts`, `src/api/server.ts`, `lib/ai.ts`, `src/novedades/types.ts`, `src/novedades/novedades.service.ts`, `app/api/novedades/route.ts` (nuevo), `app/api/novedades/regenerar/route.ts` (nuevo), `app/admin/administradores/page.tsx`, `tests/novedades.test.mts`, `KNOWN_BUGS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; verificación viva `fechaYHoraCdmx()` → `{"fecha":"2026-08-23","hora":12}`; `test:novedades` ampliado; suite completa OK.

**Impacto:** Compatible y correctivo — además de novedades, REVIVE los jobs diarios preexistentes (resumen 9 am, heartbeat Telegram) que llevaban tiempo sin ejecutarse.

**Rollback:** Sí.

---

## 2026-08-22

### Fix — Admins atendidos por Flora y digest proactivo que nunca llegaba (BUG-023)

**Problema:** (1) Al escribir un admin al bot, Flora contestaba con el flujo de ventas: `esAdminBot` comparaba por sufijo de dígitos y NO detectaba la variante mexicana (`52XXXXXXXXXX` registrado vs `521XXXXXXXXXX` real — el dígito extra va en medio). (2) El resumen de las 6 am nunca llegó: el envío armaba el JID sin resolverlo con `onWhatsApp` y no enviaba nada si no había novedades. (3) El digest ni siquiera existía: la generación podía quedar colgada si el proveedor IA no respondía (sin timeout).

**Solución:**
- **`src/novedades/novedad.detector.ts`**: nueva `coincideAdminPorVariantes()` — compara conjuntos de variantes vía `variantesTelefono()` (misma lógica que el filtro de ignorados).
- **`src/novedades/novedades.repository.ts`**: `esAdminBot` usa ese matching.
- **`src/whatsapp/notification.service.ts`**: emisor genérico `enviarTextoANumeros()` (resuelve JID real con `onWhatsApp`, dedup por destino, aviso si es el propio bot); `notificarEmpleadosWhatsApp` lo reutiliza sin cambio de comportamiento.
- **`src/novedades/novedades.service.ts`**: envío proactivo vía `enviarTextoANumeros` y SIEMPRE confirma (aunque sea "No hay novedades"); timeout 150 s por lote IA (`Promise.race`) para que el digest siempre se guarde.

**Archivos modificados:** `src/novedades/novedad.detector.ts`, `src/novedades/novedades.repository.ts`, `src/novedades/novedades.service.ts`, `src/whatsapp/notification.service.ts`, `tests/novedades.test.mts`, `KNOWN_BUGS.md`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:novedades` con casos 12↔13 dígitos MX; verificación en vivo contra la lista real de producción (ambos formatos del número → ADMIN); suite completa OK.

**Impacto:** Compatible. Los empleados siguen recibiendo exactamente las mismas notificaciones (mismo emisor refactorizado).

**Rollback:** Sí.

---

## 2026-08-21

### Motor de Novedades: digest diario 3 am + panel de administradores del bot (DEC-084)

**Objetivo:** Dar al equipo visibilidad de lo pendiente en cada chat (cotizaciones sin precio, pedidos atascos, cambios de fecha, modificaciones de arreglo, dudas sin responder) y permitir que administradores designados le pregunten al bot por WhatsApp "¿qué novedades hay?" recibiendo un resumen breve — sin gastar cuota de IA al consultar.

**Implementación:**
- **Nuevo módulo `src/novedades/`**:
  - `types.ts`: `TipoNovedad` (cotizacion_pendiente, pedido_sin_tratar, cambio_fecha, modificacion_arreglo, pago_pendiente, duda_sin_responder, queja, otro), `Novedad`, `NovedadesDiarias`.
  - `novedades.repository.ts`: digest persistido en `configuracion_bot` clave `novedades_diarias`; lista de admins en clave `admins_bot` (`obtenerAdminsBot`, `esAdminBot` con comparación por dígitos tolerante a +52/@c.us/LID).
  - `novedad.detector.ts`: reglas backend sin LLM — pedidos atascos por `estadoFlujo` (esperando_precio_equipo → cotización, esperando_pago → pago pendiente, etc.), casos QUEJA/prioridad alta; `normalizarNovedadIA` valida la salida del LLM; `fusionarNovedades` deduplica priorizando reglas.
  - `novedades.service.ts`: `generarNovedadesDiarias()` (3 am) = reglas + UNA pasada IA sobre transcripciones compactas (últimos 50 mensajes por chat activo del día anterior CDMX, lotes de 30 chats); idempotente por fecha analizada (protege cuota ante reinicios). `construirMensajeNovedades()` plantilla ordenada por prioridad. `enviarNovedadesProactivo()` (6 am) solo si hay novedades.
  - `admin.handler.ts`: responde SIEMPRE desde el digest guardado — cero llamadas LLM al consultar.
- **`lib/ai.ts`**: nueva `resumirNovedadesChats()` — JSON estricto con categorías cerradas del backend, temperature 0, `callWithFallback` + `conRetry`.
- **`src/whatsapp/message-entry.ts`**: intercepto de admins antes del flujo de cliente (sin rate-limit ni pausa; es uso interno). Los admins ya no son atendidos por Flora como si fueran clientes.
- **`bot.ts`**: schedulers integrados al bloque diario (3 am generar con recuperación `hora >= 3`; 6 am enviar solo con bot listo).
- **Dashboard**: nueva sección `/admin/administradores` + API `/api/admins` (GET/PUT sobre `admins_bot`), link "Admins" en el nav.

**Archivos nuevos:** `src/novedades/*` (5 archivos), `app/api/admins/route.ts`, `app/admin/administradores/page.tsx`, `tests/novedades.test.mts`
**Archivos modificados:** `lib/ai.ts`, `src/whatsapp/message-entry.ts`, `bot.ts`, `app/admin/layout.tsx`, `package.json` (script `test:novedades`)

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:novedades` nuevo (detector de reglas, normalización IA, fusión/dedup, plantilla del mensaje, ventana de 24 h del día anterior); suite completa OK.

**Impacto:** Compatible. No modifica tablas existentes (usa `configuracion_bot`). Para activarlo: agregar números en `/admin/administradores`. Las alertas críticas instantáneas (Telegram/WhatsApp empleados) se mantienen igual.

**Rollback:** Sí — revertir el commit; el intercepto de admins y los schedulers desaparecen con él.

---

## 2026-08-19

### Hora inyectada al LLM unificada en formato 12 horas (CDMX) + dato de entrega en 1 hora (BUG-017, DEC-083)

**Problema:** El `[HORA ACTUAL]` del contexto se generaba con `toLocaleTimeString` sin `timeZone`, usando la zona local del servidor (UTC en GCP) en lugar de CDMX, contradiciendo el `[CONTEXTO]` que sí usaba `America/Mexico_City`. El LLM recibía dos horas distintas y se confundía al contestar "¿ya están abiertos?". Además el contexto iba en formato 24 horas (empleados y clientes hablan en 12 horas: "5 de la tarde", "3 pm") y no existía un dato confiable del backend para saber si se puede entregar en 1 hora dentro del horario laboral.

**Solución (código + prompt):**
- **`src/whatsapp/message-utils.ts`**: `ahoraCdmx()` ahora devuelve `hora12`, `ampm` y `etiqueta12` (formato 12h, CDMX); nuevo `formatoHora12(hora, minuto)` para horarios de apertura/cierre; `getContextoHorario()` inyecta la hora en 12h y calcula si "Entrega/finalización en 1 hora" es **POSIBLE** o **NO** (hora actual + 60 min contra el cierre del día, L-V / S-D); `formatearFechaHoraMensaje()` ahora devuelve marcas de historial en 12h ("19/08/2026 2:07 pm").
- **`src/validators/horario.validator.ts`**: `validarHorario()` y `horarioHoyManana()` usan formato 12h.
- **`src/openai/prompt.builder.ts`**: sección `## Horarios (formato 12 horas)` en las reglas validadas; `[NOTA DE TIEMPO]` indica explícitamente formato 12h ("2:30 pm") y que se interpreten "5 de la tarde"/"3 pm" según el momento de cada mensaje.
- **`src/orchestrator.ts` y `src/whatsapp/message-handler.ts`**: `horaActual` pasa de `toLocaleTimeString` (sin timezone, 24h) a `ahoraCdmx().etiqueta12`.
- **`bot.ts`**: la notificación de fotos pendientes fuera de horario usa `ahoraCdmx().etiqueta12` (antes `toLocaleTimeString` sin timezone); eliminada variable muerta.
- **Prompt system**: `_prompt_actualizado.txt` (el que vive en Supabase) y su espejo `src/prompts/system-prompt.corregido.ts` ahora instruyen a Flora a usar SIEMPRE formato de 12 horas, a traducir "5 de la tarde"/"3 pm", a confirmar la entrega en 1 hora solo cuando `[CONTEXTO]` diga POSIBLE (y dar la hora estimada que indique), a NO confirmarla/inventar hora si el backend dice NO posible, y a atender fuera de horario como asistente virtual sin frenar la venta.

**Archivos modificados:** `src/whatsapp/message-utils.ts`, `src/validators/horario.validator.ts`, `src/openai/prompt.builder.ts`, `src/orchestrator.ts`, `src/whatsapp/message-handler.ts`, `bot.ts`, `_prompt_actualizado.txt`, `src/prompts/system-prompt.corregido.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario` OK, `test:validator` OK; verificación manual: `ahoraCdmx().etiqueta12` = "2:07 pm", `formatoHora12(19,45)` = "7:45 pm", `getContextoHorario()` con CDMX 2:07 pm → "Entrega/finalización en 1 hora: POSIBLE — estaría listo alrededor de las 3:07 pm".

**Impacto:** Compatible. El formato 24h se conserva en `ahoraCdmx().etiqueta` para quien lo necesite. Se requiere resincronizar el prompt en Supabase (ya ejecutado: `node _sincronizar_prompt.mjs`, 16,888 caracteres).

**Rollback:** Sí — revertir el commit y, si se desea, restaurar el prompt anterior desde Supabase (`historial_prompt`).

---

### Clasificador de imágenes usa el origen del historial (equipo verificado vs. IA) (BUG-018)

**Problema:** `clasificarImagenVenta` (visión) armaba el historial reciente con `${m.role}: ${m.content}`, sin distinguir quién escribió cada mensaje. El clasificador no sabía si el pago/expectativa de comprobante venía del equipo humano (verificado) o solo de la IA, pudiendo malclasificar fotos ambiguas.

**Solución:** `lib/ai.ts` — `clasificarImagenVenta` ahora usa `etiquetaOrigen(m)` ("cliente", "equipo (humano, VERIFICADO)", "sistema", "flora (IA)") igual que `clasificarConversacion` (DEC-082), y el prompt de visión prioriza como `comprobante` cuando el historial indique que el equipo humano pidió el pago/comprobante, aunque la imagen sea ambigua.

**Archivos modificados:** `lib/ai.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario`, `test:validator`, `test:precio`, `test:flows` OK.

**Impacto:** Compatible. Mejora la precisión de clasificación comprobante/referencia en fotos ambiguas; no cambia el contrato (`ClasificacionImagenVenta` intacto).

**Rollback:** Sí.

---

### Las fotos/documentos del equipo sin texto se registran como intervención verificada (BUG-019)

**Problema:** Cuando un miembro del equipo respondía al cliente solo con una foto o documento (sin caption/texto), `message-entry.ts` no encolaba el mensaje (`if (body)`) y `procesarMensajeEquipo` no persistía nada. El historial quedaba sin esa intervención verificada: la IA no sabía que el equipo ya envió una imagen al cliente y podía volver a pedir lo mismo o no tomar en cuenta la respuesta.

**Solución:**
- **`src/whatsapp/message-entry.ts`**: los mensajes `fromMe` tipo `image`/`document` se encolan a `procesarMensajeEquipo` incluso sin texto (`if (body || esMediaEquipo)`).
- **`bot.ts`** `procesarMensajeEquipo`: si no hay texto pero es imagen/documento, registra la intervención humana y guarda en `historial_chat` `[Agente: envió una foto]` / `[Agente: envió un documento]` con `origen='equipo'`. No modifica el estado del pedido (no se toca precio/fecha/pago). Refactor: variables `body.trim()` → `texto`.

**Archivos modificados:** `src/whatsapp/message-entry.ts`, `bot.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario`, `test:validator`, `test:precio`, `test:flows`, `test:nombre`, `test:telefono`, `test:template`, `test:inventario`, `test:reclamaciones` OK.

**Impacto:** Compatible. Nueva información en historial (mensaje assistant del equipo); `obtenerUltimosMensajesEquipo` y el bloque `[RESPUESTAS VERIFICADAS DEL EQUIPO]` ya lo consumen vía `origen='equipo'`. El texto "envió una foto" no dispara precio ni cierre de venta (`extraerPrecioRespuesta` devuelve null).

**Rollback:** Sí.

---

### Origen inferido para mensajes legacy del historial — los `[Agente: ...]` antiguos ya no se ven como Flora (BUG-020)

**Problema:** El historial guardado antes de DEC-082 (columna `origen`) no tiene valor en `origen`. En `lib/ai.ts`, `etiquetaOrigen()` y `formatearHistorialConFechas()` lo trataban como texto directo: los `[Agente: ...]` legacy se etiquetaban `flora (IA)` (o sin anotación), por lo que el LLM y la revisora podían ignorar/contradecir respuestas verificadas del equipo que sí existen en la DB.

**Solución:** `lib/ai.ts` — nueva `origenEfectivo(m)` que, cuando falta `origen`, infiere por contenido: `[Agente: ...]` → `equipo`, `[Flora omitió respuesta ...` / `[ANOTACIÓN DEL SISTEMA ...` → `sistema`, resto → `flora`. Se usa en `etiquetaOrigen()` y `formatearHistorialConFechas()` (que ahora anota también mensajes legacy). Los mensajes de usuario (`role='user'`) siguen como `cliente`. Coherente con la inferencia ya existente en `message-handler.ts:514` y `obtenerUltimosMensajesEquipo`.

**Archivos modificados:** `lib/ai.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; suite completa OK.

**Impacto:** Compatible. Mejora el etiquetado retrocompatible del historial antiguo; sin cambios de esquema ni de contrato.

**Rollback:** Sí.

---

### La respuesta al cliente podía incluir anotaciones internas del historial que el LLM imitaba (BUG-021)

**Problema:** En producción se detectó una respuesta al cliente como `[19/08/2026 8:26 am] [RESPUESTA DE FLORA] ¡Claro! Ya le pedí a una compañera...`. El prefijo `[dd/mm/yyyy h:mm am] [ANOTACIÓN]` es la marca que `formatearHistorialConFechas()` (lib/ai.ts, DEC-082) antepone a cada mensaje del historial enviado al modelo; el LLM (Gemini) imitó ese formato interno y lo incluyó en su respuesta. La fecha/hora interna además podía salir distorsionada. `limpiarRespuestaIA` / `sanitizarRespuestaIA` limpiaban links markdown y bloques `[CLIENTE|CONTEXTO|...]` pero NO esta marca de fecha/anotaciones.

**Solución:**
- **`src/validators/response.validator.ts`** `sanitizarRespuestaIA`: nuevas constantes `MARCA_FECHA_ANOTACION_RE` (quita `[dd/mm/yyyy h:mm am]`) y `ANOTACION_INTERNA_RE` (quita `[RESPUESTA DE FLORA]`, `[EQUIPO HUMANO, VERIFICADO]`, `[ANOTACIÓN DEL SISTEMA]`) en cualquier parte de la respuesta, + colapso de espacios dobles. Este es el punto final por el que pasan tanto la respuesta de `getAIResponse` (line 1014) como la corregida por la revisora (line 1037) en `message-handler.ts`.
- **Prompt system** (prevención): regla reforzada en `_prompt_actualizado.txt` (regla 4) y `src/prompts/system-prompt.corregido.ts` (regla 5): no mostrar ni repetir al inicio `[RESPUESTA DE FLORA]`, `[EQUIPO HUMANO, VERIFICADO]`, `[ANOTACIÓN DEL SISTEMA]` ni prefijos de fecha/hora. Prompt resincronizado en Supabase con `node _sincronizar_prompt.mjs` (17,097 caracteres).

**Archivos modificados:** `src/validators/response.validator.ts`, `_prompt_actualizado.txt`, `src/prompts/system-prompt.corregido.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; verificación manual del sanitizador con el caso real (prefijo eliminado, contenido intacto: `¡Claro! Ya le pedí a una compañera...`); `test:validator`, `test:horario`, `test:precio`, `test:flows` OK.

**Impacto:** Compatible. Garantiza que ninguna anotación interna llegue al cliente, aunque el proveedor IA vuelva a imitarlas. Requiere desplegar el código; el prompt ya está sincronizado.

**Rollback:** Sí — revertir el commit y, si se desea, restaurar el prompt anterior desde Supabase (`historial_prompt`).

---

### Response validator interpretaba las horas en 12h como si fueran AM (BUG-022)

**Problema:** Tras migrar el contexto a formato 12 horas (BUG-017), `validarRespuestaIA` podía reaccionar mal: `HORA_REGEX` capturaba el meridiano en un grupo NO capturado y `extraerHoras()` devolvía solo `HH:MM`, descartando `am`/`pm`. Así, "3:00 pm" se trataba como 3:00 AM → minutos antes de apertura → si además aparecía una frase de confirmación ("sí podemos", "lo tenemos a las..."), el validador rechazaba la respuesta correcta de Flora (falso positivo). Igualmente "7:00 am" debía rechazarse y no se garantizaba correctamente.

**Solución:** `src/validators/response.validator.ts` — `HORA_REGEX` ahora captura el meridiano (grupo 3) y `extraerHoras()` normaliza a reloj de 24h: `pm` y hora < 12 → +12; `am` y hora 12 → 0; sin sufijo se conserva tal cual ("hrs"/"horas" siguen siendo 24h). Devuelve siempre `HH:MM` de 5 caracteres.

**Archivos modificados:** `src/validators/response.validator.ts`, `tests/response-validator.test.mts`

**Pruebas:** `npx tsc --noEmit` 0 errores; nuevos casos 12h en `test:validator`: "3:00 pm" se acepta, "7:00 am" se rechaza, "10:00 am" (apertura) se acepta; suite completa OK.

**Impacto:** Compatible. Corrige el juicio de horario del validador para el nuevo formato 12h sin cambiar su contrato.

**Rollback:** Sí.

---

## 2026-08-14

### Historial con origen estructurado: la IA distingue respuestas verificadas del equipo (DEC-082)

**Problema:** El historial (`historial_chat`) solo guardaba `rol` ('user'/'assistant') y el mensaje del equipo se marcaba solo con el prefijo de texto `[Agente: ...]`. La detección `[EL EQUIPO HUMANO RESPONDIÓ]` solo se disparaba si el ÚLTIMO mensaje assistant era del equipo, y `ULTIMA_INTERVENCION_HUMANA` (memoria, TTL 10 min) se perdía al reiniciar. Resultado: tras 10 min o un reinicio, el LLM podía ignorar/contradecir precios y respuestas del equipo y volver a preguntar lo ya confirmado.

**Solución (código):**
- **Esquema** (`supabase_migration_completa.sql`): nueva columna `origen` en `historial_chat` ('cliente' | 'flora' | 'equipo' | 'sistema') con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (retrocompatible) e índice parcial para mensajes del equipo.
- **Persistencia** (`src/conversation/conversation.service.ts`): `agregarAlHistorial()` ahora recibe `origen` (por defecto `cliente`/`flora` según rol); `obtenerHistorial()` devuelve el origen; nueva función `obtenerUltimosMensajesEquipo(telefono, horas, limite)` consulta respuestas del equipo en Supabase (sobrevive reinicios, sin TTL de 10 min) incluyendo datos antiguos con prefijo `[Agente:` vía `.or()`.
- **Marcado de orígenes** (`bot.ts`, `src/whatsapp/message-handler.ts`): mensajes del equipo → `equipo`; respuestas de Flora → `flora`; entradas internas ("Flora omitió respuesta") → `sistema`; mensajes del cliente → `cliente`.
- **Contexto al LLM** (`message-handler.ts`): nuevo bloque `[RESPUESTAS VERIFICADAS DEL EQUIPO]` con los últimos mensajes del equipo desde la DB (fecha, precio extraído con `extraerPrecioRespuesta`) que se inyecta cuando el último mensaje NO es del equipo. Se refuerza la detección `equipoRespondio` con `origen === 'equipo'` además del prefijo. El bloque en memoria `[INTERVENCION HUMANA RECIENTE]` queda como fallback solo si la DB no encontró nada.
- **Etiquetado para el LLM/revisora** (`lib/ai.ts`): `MensajeChat` incluye `origen`; `formatearHistorialConFechas()` anota `[EQUIPO HUMANO, VERIFICADO]`, `[RESPUESTA DE FLORA]` o `[ANOTACIÓN DEL SISTEMA]` en el historial enviado al modelo; `clasificarConversacion()` y `revisarRespuestaFlora()` etiquetan `cliente | equipo (humano, VERIFICADO) | sistema | flora (IA)` en lugar del ambiguo `flora/equipo`.
- **Tipos** (`src/models/types.ts`): nuevo enum `OrigenMensaje`.

**Archivos modificados:** `supabase_migration_completa.sql`, `src/models/types.ts`, `lib/ai.ts`, `src/conversation/conversation.service.ts`, `src/conversation/index.ts`, `bot.ts`, `src/whatsapp/message-handler.ts`, `DECISIONS.md`, `TODO.md`

**Pruebas:** `npx tsc --noEmit` 0 errores.

**Impacto:** Compatible. Los datos históricos sin `origen` siguen funcionando (se detectan por el prefijo `[Agente:`). Los precios confirmados por el equipo ahora se respetan incluso después de reinicios y aunque Flora haya respondido después. Requiere aplicar la migración `ALTER TABLE` en la base.

**Rollback:** Sí — revertir el commit y eliminar la columna `origen` si se desea.

---

## 2026-08-10

### Fotos fuera de horario: cola persistida en Supabase + flush a la hora exacta de apertura

**Problema:** La cola `FOTOS_PENDIENTES_APERTURA` vivía solo en memoria: si el bot se reiniciaba de noche, el equipo perdía la notificación de fotos recibidas fuera de horario. Además, el flush dependía de un ciclo de 5 minutos, así que las fotos podían llegar al equipo varios minutos después de la apertura.

**Solución (código):**
- **Persistencia en Supabase** (`src/whatsapp/bot-state-persistence.ts`): `FOTOS_PENDIENTES_APERTURA` se agregó a `MAPAS_A_PERSISTIR`, por lo que `cargarEstado()` restaura la cola al arrancar y `guardarEstado()` la conserva cada 5 min. Nueva función `limpiarClavesVacias()` borra del `bot_cache` las claves cuyos mapas ya están vacíos, evitando que un reinicio reenvíe fotos ya entregadas al equipo (sin duplicados).
- **Persistencia inmediata al encolar** (`src/whatsapp/bot-state.ts`): nuevo hook `setOnFotosPendientesCambiaron()` que `bot.ts` registra para llamar `guardarEstado()` + `limpiarClavesVacias()` apenas se encola o se limpia la cola (ventana de pérdida ~0 ms).
- **Flush a la hora exacta de apertura** (`bot.ts`): se reemplaza el `setInterval` de 5 min por `programarFlushApertura()`, un `setTimeout` que calcula los ms exactos hasta la próxima apertura (usa `obtenerHorarios().apertura`, hoy si aún no abre, mañana si ya cerró) y se reprograma tras cada disparo. Se conserva el ciclo de 5 min como red de seguridad (no duplica: la cola se limpia en el primer flush).

**Archivos modificados:** `src/whatsapp/bot-state.ts`, `src/whatsapp/bot-state-persistence.ts`, `bot.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:horario`, `test:precio`, `test:validator`, `test:flows` OK.

**Impacto:** Compatible. Las fotos fuera de horario sobreviven reinicios del bot y llegan al equipo justo a la apertura. Si se despliega en la VM: `git pull` + `sudo systemctl restart floreria-bot`.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-10

### Flora se presenta como asistente virtual y atiende fuera de horario (fotos quedan para el equipo)

**Problema:** El system prompt pedía a Flora presentarse como "empleada de Jardín RoCe" y las anotaciones `[CONTEXTO: Fuera de Horario]` existían en el prompt pero NUNCA llegaban al LLM (el código inyectaba solo `validarHorario().mensajeBackend`). Además, las fotos que llegaban fuera de horario se reenviaban al equipo al instante, molestándolos de noche, y el cliente quedaba sin atención.

**Solución (código + prompt):**
- **Prompt** (`src/prompts/system-prompt.corregido.ts`): presentación actualizada a "asistente virtual" de la florería; anotación `[CONTEXTO: Fuera de Horario]` reescrita (asistente sigue trabajando, recoge foto + presupuesto + fecha, hora exacta de apertura, catálogo Drive, cuenta BBVA, mismo tono, NUNCA "mañana te muestro"); nueva sección `## Fuera de horario (la asistente virtual sigue trabajando)`.
- **`getContextoHorario()`** (`src/whatsapp/message-utils.ts:136`): enriquecido con anotaciones completas de horario (abierto/cerrado) y ahora SÍ se inyecta en el prompt (`message-handler.ts:472` reemplaza a `validarHorario().mensajeBackend`).
- **Cola de fotos fuera de horario** (`src/whatsapp/bot-state.ts`): `FOTOS_PENDIENTES_APERTURA` + `encolarFotoPendienteApertura()` / `obtenerFotosPendientesApertura()` / `limpiarFotosPendientesApertura()`.
- **Diferir reenvíos al equipo** (`src/whatsapp/message-handler.ts`): en `procesarMediaAcumulado` y en el `finally` de medios pendientes, si `!estaEnHorario()` las fotos (comprobante/referencia/otra/cotización) se encolan en lugar de emitir eventos y notificar al equipo al instante.
- **Respuestas al cliente** (`message-handler.ts:801`): fuera de horario, Flora confirma que guardó la foto y que el equipo la revisa a primera hora (mismo tono dulce).
- **Flush de fotos a primera hora** (`bot.ts`): nuevo `setInterval` cada 5 min que, cuando vuelve a estar en horario, reenvía al equipo las fotos encoladas (foto + mensaje de resumen) y emite `PHOTO_RECEIVED`/`PHOTO_SENT`/notificaciones correspondientes.

**Archivos modificados:** `src/prompts/system-prompt.corregido.ts`, `src/whatsapp/message-utils.ts`, `src/whatsapp/bot-state.ts`, `src/whatsapp/message-handler.ts`, `bot.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `npm run test:horario`, `test:precio`, `test:validator`, `test:flows` todos OK.

**Impacto:** Compatible. Fuera de horario los empleados dejan de recibir alertas/fotos al instante; reciben todo junto a la apertura. Si se despliega en la VM: `git pull` + `sudo systemctl restart floreria-bot`.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-10

### Bot reconoce precios reales dados por el equipo en el chat (BUG-015)

**Problema:** Aunque un empleado respondiera en el chat del cliente con el precio real ("Son 450", "Queda en 450", "Te sale en 450"...), el bot seguía diciendo "esperando confirmación del equipo". El precio del empleado nunca se aplicaba al pedido.

**Solución (código):**
- **Parser de precio ampliado** (`src/parser/precio.parser.ts`): reconoce frases comunes sin `$` (`son`, `sale`, `cuesta`, `quedó en`, `se queda en`, `costaría`, `aprox`, etc.) y un número suelto ("450", "$450", "450 pesos"). Antes solo funcionaba con `$` o pocas palabras clave; cuando el empleado escribía el precio sin `$`, `procesarMensajeEquipo` (bot.ts:799) nunca lo aplicaba al pedido.
- **Contexto `[PEDIDO]`** (`src/openai/prompt.builder.ts`): ahora incluye `Precio confirmado por: equipo (ya validado — NO vuelvas a pedir confirmación de este mismo precio)` cuando el precio ya está confirmado, para que el LLM nunca vuelva a decir "confirmo con el equipo".
- **Contexto `[INTERVENCION HUMANA RECIENTE]`** (`src/whatsapp/message-handler.ts`): incluye el precio extraído de la respuesta del equipo cuando existe, instruyendo a Flora a usarlo como confirmado.
- **Guard de selección de foto** (`src/whatsapp/message-handler.ts:547`): si el pedido actual ya tiene un precio confirmado por el equipo (`precioConfirmadoPor === 'equipo'` o `'manual'`), un "lo quiero / cuánto es" del cliente NO resetea/archiva el pedido preciado (antes lo borraba y volvía a `esperando_precio_equipo`).

**Archivos modificados:** `src/parser/precio.parser.ts`, `src/openai/prompt.builder.ts`, `src/whatsapp/message-handler.ts`, `tests/precio.test.mts` (nuevo), `package.json` (script `test:precio`)

**Pruebas:** `npx tsc --noEmit` 0 errores; `npm run test:precio` OK (15 frases reales del equipo parseadas, 7 textos sin precio rechazados).

**Impacto:** Compatible. No cambia contratos ni estados. Si se despliega en la VM: `git pull` + `sudo systemctl restart floreria-bot`.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-09

### Dashboard protegido: login obligatorio + fix de redirección y botón de salir

**Problema:** El panel administrativo estaba abierto: cualquiera con la URL podía entrar a `/admin/prompt` y modificar el system prompt sin autenticarse.

**Solución (código):**
- **Verificado que la protección ya existe y funciona en producción**: `proxy.ts` (middleware de Next.js 16) redirige `/admin/*` a `/admin/login` (307) y bloquea `/api/*` con 401 sin sesión de Supabase Auth. Probado en `jardin-roce-bot.vercel.app`.
- **Fix login**: `app/admin/login/page.tsx` redirigía a `/admin/inventario`, página que no existe (404 tras iniciar sesión). Ahora redirige a `/admin`.
- **Botón "Salir"**: `app/admin/layout.tsx` agrega `BotonSalir` en el nav que llama `supabase.auth.signOut()` y vuelve a `/admin/login`.

**Archivos modificados:** `app/admin/login/page.tsx`, `app/admin/layout.tsx`

**Pruebas:** `npx tsc --noEmit` 0 errores; curl en producción: `/admin/prompt` → 307 a login, `PUT /api/prompt` → 401, `GET /api/bot/status` → 401.

**Impacto:** El panel queda protegido de acceso no autorizado. El bot Express (VM) no se ve afectado (usa sus propias rutas).

**Rollback:** Sí — revertir el commit.

---

## 2026-08-04

### System prompt actualizado: sin cotizador web, mejor fuera-de-horario, no insistente + IA revisora activa (v2.2.0)

**Problema:** El prompt enviaba a los clientes al cotizador web (`floreria-app-mauve.vercel.app`) que no se usa, Flora era insistente haciendo varias preguntas y no detectaba cuándo no debía responder, y la IA revisora (`revisarRespuestaFlora`) estaba definida pero NO conectada al flujo activo.

**Solución (código + prompt):**
- **Cotizador web eliminado** en los 4 puntos donde vivía: `system-prompt.corregido.ts`, `prompt.builder.ts` (reglas validadas), `lib/ai.ts` (fallback) y `message-handler.ts` (intención 'cotizador' ahora pide foto de referencia). Se conserva el catálogo Drive.
- **Fuera de horario mejorado** (`horario.validator.ts` + `message-utils.ts` + prompt): cuando ya cerraron, Flora ofrece recibir la foto de referencia, presupuesto y fecha para que el equipo lo cotice a primera hora. Ya no obliga a enviar link.
- **No insistente** (prompt): máxima 1 pregunta por mensaje, no repetir preguntas ya hechas, no perseguir al cliente tras un agradecimiento, no confirmar precios no verificados.
- **IA revisora activada**: `message-handler.ts` llama `revisarRespuestaFlora` tras generar cada respuesta; si desaprueba, usa la corrección o emite `HUMAN_REQUIRED`/omite. Su prompt detecta precios inventados y respuestas innecesarias.
- Prompt subido a producción vía `scripts/subir-prompt-corregido.ts` (verificado en Supabase: sin `floreria-app-mauve`, con nuevas reglas).

**Archivos modificados:** `src/prompts/system-prompt.corregido.ts`, `src/openai/prompt.builder.ts`, `lib/ai.ts`, `src/whatsapp/message-utils.ts`, `src/whatsapp/message-handler.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `test:template`, `test:validator` OK; verificación directa del prompt en Supabase.

**Impacto:** El bot ya no menciona el cotizador web. Fuera de horario recoge referencias. Respuestas menos insistentes y precios no verificados son corregidos por la IA revisora (costo: +1 llamada de IA por mensaje).

**Rollback:** Sí — revertir el commit y subir el prompt anterior a Supabase.

---

## 2026-08-04

### El historial que ve el LLM ahora incluye fecha y hora de cada mensaje (v2.1.9)

**Problema:** El historial enviado a `getAIResponse` se construía con `obtenerHistorial`, que seleccionaba únicamente `rol, contenido` y descartaba el timestamp (`creado_en`). El LLM leía frases relativas ("mañana", "a las 9") sin saber cuándo fueron escritas. Caso real: un cliente pidió entrega "mañana a las 9", y el día de la entrega escribió "mejor a las 6"; el bot respondió confirmando "entregar mañana" porque no sabía que ese mensaje era del día anterior.

**Solución (código):**
- `src/conversation/conversation.service.ts`: `obtenerHistorial` ahora selecciona `creado_en` y lo expone como `creadoEn?: string` en `MensajeChat` (campo opcional, compatible con todos los llamadores existentes).
- `lib/ai.ts`: `MensajeChat` gana el campo opcional `creadoEn`; `getAIResponse` formatea cada mensaje con prefijo `[dd/mm/aaaa hh:mm]` (hora CDMX) antes de enviarlo al LLM (Gemini y proveedores OpenAI-compatibles).
- `src/whatsapp/message-utils.ts`: nuevo helper `formatearFechaHoraMensaje(creadoEn)` en zona `America/Mexico_City`.
- `src/openai/prompt.builder.ts`: `construirContextoPrompt` inyecta `[NOTA DE TIEMPO]` explicando que el prefijo del historial indica cuándo se escribió cada mensaje y que el cambio más reciente de fecha/hora gana.

**Archivos modificados:** `src/conversation/conversation.service.ts`, `lib/ai.ts`, `src/whatsapp/message-utils.ts`, `src/openai/prompt.builder.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `npm run test:template`, `test:telefono`, `test:validator` OK.

**Impacto:** Compatible (campo opcional). El LLM ahora puede distinguir fechas relativas por mensaje y respeta el cambio de fecha/hora más reciente del cliente.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-04

### Silencio del bot ante cualquier respuesta del equipo durante la agrupación (v2.1.8)

**Problema:** La condición que callaba al bot cuando un empleado contestaba al cliente durante la ventana de agrupación (`AGRUPAR_MENSAJES_MS = 50s`) era demasiado restrictiva: exigía que la respuesta del empleado **contuviera un precio** (`intervencion.precio`) **y** que el mensaje del cliente fuera de cotización/referencia (`esTextoReferenciaOCotizacion`). Si el empleado respondía sin precio (ej. "Te paso las fotos en un momento"), Flora respondía igual y duplicaba al empleado.

**Solución (código):**
- `bot.ts`: la condición en `encolarMensajeAgrupado` pasa a ser únicamente `humanoRespondioDuranteEspera` (intervención humana dentro de la ventana de 50s + 1.5s). Cualquier respuesta del equipo calla a Flora para esa tanda; el bot vuelve a responder cuando el cliente escribe un mensaje nuevo después de la ventana.
- Se elimina el import de `esTextoReferenciaOCotizacion` (ya no se usa en `bot.ts`).

**Archivos modificados:** `bot.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; `npm run test:template`, `test:telefono`, `test:validator` OK.

**Impacto:** Compatible. Reduce respuestas duplicadas cuando el equipo toma la conversación.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-04

### BUG-014: Proveedor primario Gemini roto — gemini-2.5-flash-lite deprecado (v2.1.7)

**Problema:** Al verificar todas las APIs con el nuevo `npm run check:apis`, Gemini devolvía `404 NOT_FOUND: This model models/gemini-2.5-flash-lite is no longer available to new users`. El proveedor primario del bot (que recibe la mayor carga de respuestas) estaba caído sin que se notara porque el fallback a OpenRouter/Groq cubría las peticiones.

**Causa raíz:** Google deprecó la familia Gemini 2.5 (shutdown 2026-10-16). `gemini-2.5-flash-lite` ya no está disponible para cuentas nuevas. El reemplazo vigente es `gemini-3.1-flash-lite` (verificado OK).

**Solución (código):**
- `scripts/check-apis.mts` (nuevo): verifica cada API configurada con llamadas mínimas reales — Gemini, OpenRouter, Groq, Cerebras, IA1/IA2 (GitHub Models), Telegram y Supabase. Nuevo script `npm run check:apis`.
- `lib/ai.ts`: default de `GEMINI_MODEL` → `gemini-3.1-flash-lite`.
- `.env.local` y `.env.example`: `GEMINI_MODEL=gemini-3.1-flash-lite`.

**Resultado de la verificación (2026-08-04):** ✅ Gemini, OpenRouter, Groq, Telegram, Supabase. ❌ Cerebras (402 = requiere créditos/billing, ya conocido). ❌ IA1/IA2 (404 = GitHub Models retirado; módulos legacy sin uso activo).

**Archivos modificados:** `scripts/check-apis.mts`, `package.json`, `lib/ai.ts`, `.env.local`, `.env.example`

**Pruebas:** `npx tsc --noEmit` 0 errores; `npm run check:apis` → Gemini ahora responde `OK`.

**Impacto:** Compatible. Restaura el proveedor primario. Requiere actualizar `.env.local` en la VM.

**Rollback:** Sí — revertir el commit (volver a gemini-2.5-flash-lite no funcionará, quedará el bot en fallback).

---

## 2026-08-04

### BUG-013: ORDER_CREATED con payload incompleto (v2.1.6)

**Problema:** Los eventos `ORDER_CREATED` llegaban sin el payload completo según el punto de emisión: `crearPedido` sin `sucursal`/`metodoPago`, el alerta "comprobante-pendiente" sin `orderId`, y el cotizador web sin `orderId` real ni `metodoPago` (emitía un evento huérfano sin respaldo en DB). Esto privaba al Notification Engine de campos para el Decision Extractor, el Conflict Detector y el Business Rules Validator.

**Solución (código):**
- `src/pedidos/pedido.service.ts`: `crearPedido` emite `ORDER_CREATED` con `...buildOrderPayload(pedido)` (orderId, telefono, cliente, producto, total, sucursal, metodoPago); `buildOrderPayload` usa `pedido.descripcion` si existe.
- `src/whatsapp/message-handler.ts`: el alerta "comprobante-pendiente" ahora incluye `orderId: pedido.id`.
- `bot.ts`: el cotizador web crea el pedido real con `crearPedido(...)` (producto, totalWeb, sucursal, metodoPago transferencia, descripcion) en lugar de emitir `ORDER_CREATED` inline huérfano.
- `src/models/types.ts`: `PedidoActual.descripcion?: string` (campo opcional, compatible).

**Archivos modificados:** `src/pedidos/pedido.service.ts`, `src/whatsapp/message-handler.ts`, `bot.ts`, `src/models/types.ts`

**Pruebas:** `npx tsc --noEmit` 0 errores; suite aplicable (`test:template`, `test:telefono`, `test:validator`) OK. `test:wire` falla pre-existente (asume contrato antiguo ORDER_UPDATED), no relacionado.

**Impacto:** Compatible. `PedidoActual.descripcion` es opcional; sin cambios de esquema de DB. Elimina `ORDER_CREATED` huérfano del flujo web.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-04

### BUG-012: Precio/fecha no arrastrados a los eventos operativos (v2.1.5)

**Problema:** Las notificaciones operativas de Telegram (`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `ORDER_CREATED`, `ORDER_UPDATED`, `PAYMENT_PENDING`) mostraban producto, precio y sucursal pero nunca la **fecha/hora de entrega** del pedido. El equipo debía abrir el dashboard para saber cuándo preparar/entregar el arreglo, con riesgo de demoras en pedidos confirmados.

**Causa raíz:** Los templates de `template.builder.ts` no renderizaban `verified.fecha`/`verified.hora`, aunque el pipeline (`notification.engine.ts`) ya los proveía desde el timeline (`fecha_entrega`/`hora_entrega` del pedido en Supabase).

**Solución (código):**
- `src/notification-engine/template.builder.ts`: nuevo helper `getFechaHora(verified)`; línea `📅 <fecha> <hora>` agregada a los templates `ORDER_CREATED`/`PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` (VENTA CERRADA), `ORDER_UPDATED` (PEDIDO APARTADO) y `PAYMENT_PENDING` (PAGO PENDIENTE). Si no hay fecha/hora, la línea no se renderiza.
- `tests/template-payment.test.mts` (nuevo): verifica que VENTA CERRADA y PAGO PENDIENTE muestren fecha/hora cuando existen (con escape MarkdownV2 de `-`) y que no aparezca línea vacía cuando faltan.

**Archivos modificados:** `src/notification-engine/template.builder.ts`, `package.json`, `tests/template-payment.test.mts`

**Pruebas:** `npm run test:template` OK; suite existente (`test:telefono`, `test:horario`, `test:nombre`) OK; `npx tsc --noEmit` 0 errores.

**Impacto:** Compatible. Sin cambios de esquema ni de contrato de eventos (la fecha/hora ya viajaba en `verified`).

**Rollback:** Sí — revertir el commit.

---

## 2026-08-03

### Módulo 1: IA multi-proveedor — cuota free tier de gemini-2.5-flash era solo 20/día

**Problema:** El bot volvió a caer el 2026-08-04 (04:13–04:51). Gemini respondió `429 Quota exceeded — generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash`. El free tier de `gemini-2.5-flash` fue recortado por Google a ~20 peticiones/día (dic-2025), no ~1500 como asumía el `.env.example`. El fallback a GitHub Models devolvió 401 (tokens retirados). Adicionalmente, `maxOutputTokens: 800` truncaba respuestas largas del cliente ("El pago es…").

**Verificación (2026-08-03):** `gemini-2.0-flash` está descontinuado (1-jun-2026). Opciones gratuitas vigentes: `gemini-2.5-flash-lite` (~15 RPM / ~1,000 RPD), OpenRouter (20 RPM / 50 RPD, 1,000 con $10), Groq (30 RPM / 1,000 RPD), Cerebras (~1M tokens/día). Las cuotas de Gemini son por modelo + proyecto; repartir tareas entre proveedores distintos multiplica la capacidad diaria.

**Solución (código):**
- `lib/ai.ts`: proveedor primario por defecto `gemini-2.5-flash` → `gemini-2.5-flash-lite` (configurable con `GEMINI_MODEL`).
- Nueva cadena de proveedores OpenAI-compatibles como fallback en orden: **OpenRouter → Groq → Cerebras → GitHub Models** (retirado, último respaldo). Cada uno con su propia cuota diaria independiente. Solo se usan los proveedores con API key configurada.
- `callWithFallback` reescrito para recorrer la cadena en lugar de un único fallback a GitHub.
- `clasificarImagenVenta` (visión): usa la cadena de proveedores; solo OpenRouter participa (soporta visión); `maxOutputTokens` 400 → 1024 (evita JSON truncado).
- `getAIResponse`: `maxOutputTokens` 800 → 2048 (corrige respuestas cortadas); usa cadena de proveedores.
- `clasificarConversacion` / `revisarRespuestaFlora`: usan cadena de proveedores (sin lógica específica de GitHub).
- Eliminado código muerto: `githubClient`, `REVIEW_MODEL`, fetch manual de GitHub vision.

**Archivos modificados:** `lib/ai.ts`, `.env.example`

**Impacto:** Compatible. `tsc --noEmit` 0 errores. Tests locales OK (flows, nombre, validator, horario, inventario, reclamaciones). Requiere agregar al menos una API key de fallback en `.env.local` (OpenRouter/Groq/Cerebras) en la VM + `sudo systemctl restart floreria-bot`.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-04

### BUG-011: Normalización de teléfono LID (v2.1.4)

**Problema:** Los contactos con `@lid` (cuenta vinculada) no siempre resuelven su número real contra el mapeo de Baileys. Al no resolverse, `obtenerNumeroReal` devolvía el jid crudo (`5212345...@lid` o `...@lid:15`), que se guardaba en pedidos Supabase, alertas WhatsApp y eventos Telegram. Además, `jidToTelefono` no limpiaba el sufijo `:dispositivo` (sí lo hacía `jidANumero`), generando dos identificadores distintos para el mismo cliente.

**Solución (código):**
- `src/whatsapp/contact.service.ts`: `obtenerNumeroReal` normaliza el LID no resoluble con `jidANumero` (quita `@lid` y `:dispositivo`) en lugar de devolver el jid crudo.
- `src/conversation/conversation.service.ts`: `jidToTelefono` también elimina el sufijo `:dispositivo`, quedando alineado con `jidANumero`.
- `tests/telefono.test.mts` (nuevo): cubre LID no resoluble, LID con `:device`, `jidToTelefono`, `esLid` y `variantesTelefono`.

**Archivos modificados:** `src/whatsapp/contact.service.ts`, `src/conversation/conversation.service.ts`, `package.json`, `tests/telefono.test.mts`

**Pruebas:** `npm run test:telefono` OK; resto de suite (`test:flows`, `test:nombre`, `test:validator`, `test:horario`, `test:inventario`, `test:reclamaciones`) OK; `npx tsc --noEmit` 0 errores.

**Impacto:** Compatible. Sin cambios de esquema ni de contrato de eventos.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-03

### Migración IA a Gemini — GitHub Models retirado (v2.1.2)

**Problema:** Toda la IA del bot estaba caída. GitHub Models fue retirado el 2026-07-30; los endpoints daban 404/410. Los tokens seguían válidos en `api.github.com` pero ninguna llamada a modelo funcionaba.

**Solución (código):**
- `lib/ai.ts`: `callWithFallback` invertido — **Gemini es primario**, GitHub queda solo como respaldo. Antes solo caía a Gemini en errores 401, por lo que 404/410 dejaban el sistema sin IA.
- Modelo por defecto: `GEMINI_MODEL = gemini-2.5-flash` (antes `gemini-1.5-flash`, que ya no existe).
- Visión (`clasificarImagenVenta`): migrada de `models.inference.ai.azure.com` a `generateContent` con imágenes inline base64; `maxOutputTokens` subido a 400 (120 truncaba el JSON con Gemini 2.5); parseo usa `extraerJsonObjeto`.
- `getAIResponse`: el branch Gemini usa `generateContent` + `systemInstruction` (antes `startChat` duplicaba el último mensaje).
- Todas las llamadas primarias a Gemini envueltas en `conRetry` (3 intentos) para tolerar 503/429 temporales.

**Archivos modificados:** `lib/ai.ts`, `.env.example`

**Impacto:** Compatible. `tsc --noEmit` 0 errores. Pruebas live con key real: clasificación, respuesta y visión OK. Requiere `git pull` en la VM + `sudo systemctl restart floreria-bot`.

**Rollback:** Sí — revertir el commit.

---

## 2026-08-01

### Hotfix: conexión WhatsApp 405 (versión de protocolo obsoleta)

**Problema:** El bot no conectaba a WhatsApp. Conexión cerrada con 405 (Method Not Allowed) en bucle, sin llegar a generar QR, incluso tras cambiar IP de la VM y borrar la sesión.

**Causa raíz:** WhatsApp dejó de aceptar la versión de protocolo de WhatsApp Web hardcodeada en Baileys 7.0.0-rc13. `makeWASocket()` se llamaba sin `version`, por lo que Baileys usaba su valor por defecto (obsoleto) y WhatsApp respondía 405 durante el handshake del WebSocket, antes del flujo de registro/QR.

**Solución (código):** `bot.ts` ahora obtiene la versión actual vía `fetchLatestBaileysVersion()` con fallback a `fetchLatestWaWebVersion()` y un valor de respaldo fijo `[2, 3000, 1037641644]`, y se la pasa a `makeWASocket({ version })`. La versión se cachea (`WA_VERSION_CACHE`) para evitar fetches repetidos.

**Archivos modificados:**
- `bot.ts` — import de `fetchLatestWaWebVersion`, función `obtenerVersionWhatsApp()`, `version` en `makeWASocket`

**Impacto:** Compatible. Compilación 0 errores. Requiere reinicio del servicio en la VM (`sudo systemctl restart floreria-bot`).

**Rollback:** SÍ — revertir el commit.

---

## 2026-07-31

### Módulo 0.1 — Reconexión WhatsApp: detección de bloqueo por IP (código)

**Problema:** WhatsApp bloqueó la IP de la VM de GCP por exceso de reconexiones (404/405). El bot reconectaba cada 60s con backoff corto, manteniendo el bloqueo activo.

**Solución (código):** `bot.ts` ahora distingue el bloqueo por IP (HTTP 403/404/405) en `connection === 'close'`. Si se detecta, se emite `BOT_DISCONNECTED`, se marca estado `error` ("IP posiblemente bloqueada — reintento en 30 min") y se programa reconexión con cooldown largo de 30 min (`BLOQUEO_IP_COOLDOWN_MS`) en lugar del backoff corto de 60s, evitando re-bloqueo. Ya existían y se verificaron: cooldown 30 min para BOT_DISCONNECTED, backoff 5s→60s, crash detector que limpia sesión tras 3 crashes en 10 min.

**Archivos modificados:**
- `bot.ts` — constante `BLOQUEO_IP_COOLDOWN_MS` + rama `esBloqueoIp` en el handler de cierre

**Pendiente (operación GCP, manual):** cambiar la IP externa de la VM `jardin-roce-bot` en GCP Console (parar → Editar red → crear IP temporal nueva → iniciar) para salir de la lista negra de WhatsApp.

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir la rama `esBloqueoIp`.

---

### Módulos 1.1–1.4 del Plan Maestro de Soluciones

**1.1 Múltiples pedidos por cliente (P0):** `PEDIDOS` pasa de `Map<string, PedidoActual>` a `Map<string, PedidoActual[]>`. `obtenerPedidosActivos()` exportado; persistencia con arrays y retro-compatibilidad con pedido único.

**1.2 Persistencia síncrona con retry (P0):** `guardarPedidos()` ahora lanza error; `sincronizarPedidosBot()` acumula errores y lanza. `persistirConRetry()` (3 intentos, backoff 1s→2s), `persistirPedidosEngine()` async, wrapper sync `persistir()`. `bot.ts` hace `await persistirPedidosEngine()`.

**1.3 Ventana de agrupación de 60s→50s (P0):** `AGRUPAR_MENSAJES_MS = 50_000`. Respaldo ante crash = rescate nativo existente (`rescatarMensajesNoLeidos()` en `messaging-history.set`); la tabla `mensajes_pendientes` no existe (PGRST205), no se creó (Principio 2: no duplicar datos).

**1.4 Parser de sucursal robusto (P1):** `parseSucursal()` ahora usa confianza gradual `'alta' | 'media' | 'ninguna'`, normalización de acentos (NFD), límites de palabra (`\b`) y variantes: "la de", "la que está por", "Av. Morelos", "por el norte/sur", "sucursal [nombre]", "tlaxcala". Confianza 'media' almacena la sucursal y activa `sucursal_por_confirmar` para que el bot pida confirmación antes de cerrar. Fallo seguro: deja vacío. `validarSucursal()` y `obtenerTextoConfirmacionSucursal()` manejan 'media'; el flag viaja al prompt builder.

**Archivos modificados:**
- `src/parser/sucursal.parser.ts`
- `src/validators/sucursal.validator.ts`
- `src/whatsapp/message-handler.ts` (2 usos del parser)
- `src/models/types.ts` (campo `sucursal_por_confirmar`)
- `src/openai/prompt.builder.ts` (marca "(POR CONFIRMAR)")
- `src/pedidos/pedido.service.ts`, `src/pedidos/pedido.repository.ts`, `bot.ts`, `src/parser/nombre.parser.ts`, `src/validators/response.validator.ts` (cambios de sesiones previas sin commitear)

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos modificados; eliminar el flag `sucursal_por_confirmar` y la confianza 'media'.

**Verificado:** `npx tsc --noEmit` → 0 errores. Criterio de éxito 1.4: `"La que está por la Av. Morelos"` → `{ sucursal: 'Centro', confianza: 'media' }`.

---

### Módulo 2.1 — Resumen diario automático en Telegram a las 9am

**Problema:** El dueño no tiene visibilidad del estado del negocio: no sabe cuántos clientes se atendieron hoy, cuántos pedidos están activos, cuántos esperan pago, cuántos requieren atención humana ni cuánto se vendió hoy.

**Solución:** Nuevo evento `BOT_DAILY_SUMMARY`. Cada día a las 9am (hora CDMX) el bot compila y envía a Telegram un resumen con: clientes atendidos hoy (historial_chat), pedidos activos y esperando pago (`contarPedidosPorEstado()`), casos activos y casos que requieren atención humana (`contarCasosActivos()`/`contarCasosRequierenAtencionHumana()`), y ventas hoy (reporte_ventas). La alerta de desconexión de las 8am se conserva (ahora `!BOT_READY && hora === 8`).

**Archivos modificados:**
- `bot.ts` — `enviarResumenDiario()` + schedule a las 9am; alerta 8am condicionada a `!BOT_READY`
- `src/pedidos/pedido.service.ts` — nueva función `contarPedidosPorEstado()`
- `src/casos/caso.service.ts` — nuevas funciones `contarCasosActivos()` y `contarCasosRequierenAtencionHumana()`
- `src/events/types.ts` — nuevo evento `BOT_DAILY_SUMMARY`
- `src/events/telegram.subscriber.ts` — suscripción de `BOT_DAILY_SUMMARY`
- `src/notification-engine/notification.engine.ts` — `BOT_DAILY_SUMMARY` en `SYSTEM_EVENTS_SKIP_AI`
- `src/notification-engine/template.builder.ts` — template para `BOT_DAILY_SUMMARY`

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos modificados; eliminar el evento `BOT_DAILY_SUMMARY`.

**Verificado:** `npx tsc --noEmit` → 0 errores. Criterio de éxito: cada día a las 9am el dueño recibe un resumen en Telegram.

---

### Módulo 0.2 — Verificación de conexión Telegram

**Problema:** No había verificación periódica de que Telegram estuviera realmente enviando mensajes. Si el token era inválido o el chat ID cambiaba, el bot no lo detectaba hasta fallar en un envío.

**Solución:** Verificación diaria de Telegram a las 10am CDMX (`verificarTelegramDiario()`). Si la conexión es correcta, se registra `[Telegram] ✅ Conectado`. Si falla, se notifica a los empleados por WhatsApp con el detalle del error para corregir `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.

**Archivos modificados:**
- `bot.ts` — función `verificarTelegramDiario()` + schedule a las 10am

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir `verificarTelegramDiario()` y su schedule.

---

### Módulo 2.2 — Panel de resumen rápido "¿Qué pasó mientras no vi?"

**Problema:** El dueño solo podía ver el estado de un chat a la vez. No había forma de obtener todos los chats que necesitan atención en un momento dado.

**Solución:** Nuevo endpoint `GET /api/resumen` que devuelve `requierenAtencion` (casos QUEJA o prioridad alta/crítica), `esperandoPago` (pedidos en estado `ESPERANDO_PAGO`), `pedidosHoy` y `ventasHoy`.

**Archivos modificados:**
- `src/api/server.ts` — interfaz `ResumenOperativo`, campo `obtenerResumenOperativo` en `BotContext`, endpoint `GET /api/resumen`
- `src/pedidos/pedido.service.ts` — nueva función `listarPedidosActivosGlobales()`
- `src/casos/caso.service.ts` — nueva función `listarCasosRequierenAtencion()` (y `contarCasosRequierenAtencionHumana()` ahora la reutiliza, sin duplicar lógica)
- `bot.ts` — `obtenerResumenOperativo()` + `haceTexto()`

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos modificados y eliminar el endpoint `/api/resumen`.

**Verificado:** `npx tsc --noEmit` → 0 errores. Criterio de éxito: `curl http://localhost:10000/api/resumen` devuelve el resumen completo.

---

### Módulo 2.3 — Simplificar notificaciones de Telegram (anti-spam)

**Problema:** Un solo pedido podía generar 6+ notificaciones en cadena (`ORDER_CREATED` → `ORDER_UPDATED` → `PRICE_CONFIRMED` → `PAYMENT_PENDING` → `PAYMENT_RECEIVED` → `ORDER_READY`), saturando al dueño y ocultando lo importante.

**Solución:** Nuevo `src/events/notification-aggregator.ts` con clasificación de prioridad:
- 🔴 **Críticos** (llegan inmediato): HUMAN_REQUIRED, CUSTOMER_ANGRY, CUSTOMER_WAITING, PAYMENT_CONFIRMED, CANCELACION_REQUESTED, PROVIDER_FAILURE, BOT_* 
- 🟡 **Importantes** (agrupados 2 min por pedido/cliente): ORDER_CREATED, ORDER_READY, ORDER_DELIVERED, PAYMENT_RECEIVED, PAYMENT_PENDING, DELIVERY_COMPLETED, COTIZACION_REQUESTED, ENVIO_REQUESTED, PHOTO_REQUESTED, CASE_CREATED, ZONA_AMBIGUA
- 🔵 **Informativos** (solo resumen diario): ORDER_UPDATED, PRICE_CONFIRMED, PHOTO_SENT, CASE_ARCHIVED

`telegram.subscriber.ts` ahora enruta todos los eventos a `routeNotification()` (excepto PHOTO_RECEIVED que mantiene `withPipelinePhoto`). El buffer de 2 minutos se resetea con cada evento del mismo pedido; al expirar, se ejecuta el pipeline con el último evento de ese pedido.

**Archivos modificados:**
- `src/events/notification-aggregator.ts` (nuevo)
- `src/events/telegram.subscriber.ts`

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos; restaurar `withPipeline` directo en `telegram.subscriber.ts`.

**Verificado:** `npx tsc --noEmit` → 0 errores. Criterio de éxito: el dueño recibe 1 notificación por pedido cada 2 min (no 6+).

---

### Módulo 2.4 — Comando "¿Qué pasó?" por Telegram

**Problema:** El dueño no podía preguntarle al bot "oye, ¿qué está pasando con todos los chats?". Solo existía el endpoint HTTP `GET /api/resumen` (módulo 2.2), que requería abrir el navegador. No había forma de consultar el estado global desde Telegram.

**Solución:** Nuevo `iniciarTelegramListener()` en `lib/telegram.ts` — polling `getUpdates` con long-poll de 25s que solo procesa mensajes de texto de los chat IDs autorizados (`TELEGRAM_CHAT_ID`), marcando cada `update_id` como procesado vía `offset` (sin reprocesos). En `bot.ts`, `manejarComandoTelegram()` reconoce `/resumen`, `resumen`, `qué pasó`, `que paso`, `qué pasa`, `estado`, `/estado` y responde con `generarResumenEjecutivo()`, que reutiliza `contarPedidosPorEstado()`, `contarCasosRequierenAtencionHumana()` y `obtenerVentasHoy()` (sin duplicar lógica con 2.2).

**Archivos modificados:**
- `lib/telegram.ts` — nuevo `iniciarTelegramListener()` (polling getUpdates + filtro de chat autorizado)
- `bot.ts` — `generarResumenEjecutivo()`, `manejarComandoTelegram()`, arranque del listener

**Impacto:** Compatible. Compilación 0 errores. El polling usa `.unref()`, no bloquea el shutdown graceful.

**Rollback:** Revertir los archivos; eliminar la llamada `iniciarTelegramListener()`.

**Verificado:** `npx tsc --noEmit` → 0 errores. Criterio de éxito: el dueño escribe "qué pasó" en Telegram y recibe el resumen (prueba end-to-end pendiente de red local).

---

### Módulo 3.1 — Precios dinámicos desde Supabase (P1)

**Problema:** Los precios de flores ($25 la rosa, $40 la hortensia, etc.) y los horarios (10:00-19:00 / 10:00-17:00) estaban hardcodeados en `buildValidatedRulesSection()`, `horario.validator.ts`, `message-utils.ts` y `response.validator.ts`. Cambiar un precio o un horario requería modificar código y redeployar.

**Solución:** Nuevo `src/config/configuracion.service.ts` con `refrescarConfiguracion()` que lee las tablas `configuracion_precios` y `configuracion_horarios` de Supabase con caché TTL de 5 min y fallback a `PRECIOS_DEFAULT`/`HORARIOS_DEFAULT`. `prompt.builder.ts`, `horario.validator.ts`, `message-utils.ts` (`estaEnHorario`) y `response.validator.ts` leen ahora de `obtenerPrecios()`/`obtenerHorarios()`/`obtenerTextoPrecios()`/`obtenerPreciosReferencia()`. bot.ts refresca al arrancar y cada 5 min.

**Archivos modificados:**
- `src/config/configuracion.service.ts` (nuevo)
- `src/openai/prompt.builder.ts`
- `src/validators/horario.validator.ts`
- `src/whatsapp/message-utils.ts`
- `src/validators/response.validator.ts`
- `bot.ts`

**Pendiente (Supabase, manual):** crear las tablas `configuracion_precios` y `configuracion_horarios` e insertar los valores vigentes; mientras no existan, se usan los valores por defecto.

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos; eliminar el service de configuración.

---

### Módulo 3.2 — Máquina de estados: validar transiciones desde flujo (P1)

**Problema:** `transitarDesdeFlujo()` forzaba transiciones sin verificar el resultado de `transitar()` y retornaba siempre `true`, ocultando errores de integridad (p. ej., un pedido pagado podía "regresar" a cotizando sin notificar).

**Solución:** `transitarDesdeFlujo()` ahora retorna el resultado real de `transitar()`, es idempotente (estado destino = actual → `true` sin evento) y emite `PROVIDER_FAILURE` con dedup de 30 min cuando la transición es inválida. En `message-handler.ts` se agregó `transitarDesdeFlujoSeguro()` que bloquea transiciones desde estados pagados/terminales (APARTADO, EN_PRODUCCION, LISTO, ENTREGADO, ARCHIVADO, CANCELADO, QUEJA, POSTVENTA); todas las llamadas del handler usan ahora el helper.

**Archivos modificados:**
- `src/pedidos/pedido.service.ts`
- `src/whatsapp/message-handler.ts`

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos; restaurar el `transitarDesdeFlujo` original.

---

### Módulo 3.3 — Rate limiting y dedup de notificaciones (P1)

**Problema:** Algunos eventos se emitían sin pasar por `debeEnviarAlertaDedup()` ni cooldown, arriesgando notificaciones repetidas (PHOTO_SENT por cada foto, HUMAN_REQUIRED de imagen sin contexto por cada imagen, ZONA_AMBIGUA por cada zona ambigua).

**Solución:** Se auditaron todas las emisiones de `message-handler.ts`. `debeNotificarReclamacion()` ahora usa 30 min para quejas (CUSTOMER_ANGRY) y 20 min para cancelaciones. Se agregó dedup donde faltaba: `PHOTO_SENT` (30 min, referencia y pendiente), `HUMAN_REQUIRED` de imagen sin contexto (20 min) y `ZONA_AMBIGUA` (30 min).

**Archivos modificados:**
- `src/whatsapp/bot-state.ts`
- `src/whatsapp/message-handler.ts`

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los archivos; restaurar los cooldowns previos.

---

### Módulo 4.1 — Parser de nombre: casos frontera (P1)

**Problema:** El parser aceptaba nombres contaminados: números, emojis, URLs, palabras de relleno ("gracias", "listo", "después") y frases completas tras la coma (caso Lizet, AGENTS.md ERROR #1). El fallback de `message-handler.ts:832` y las funciones `tieneNombreValido`/`nombreParaAlerta` de bot.ts podían almacenar nombres que el parser debía rechazar.

**Solución:** `nombre.parser.ts` endurecido con STOP_WORDS ampliados, `MAX_WORDS = 5`, `MIN_LENGTH = 2` y nueva `esNombrePlausible()` que rechaza números, emojis, URLs, caracteres especiales y frases no válidas ("por favor", "está bien", "de acuerdo", "muy bien"). `cortarEnStop()` ahora trunca también en palabras de URL. Se conectó `esNombrePlausible` en bot.ts y en el fallback de `message-handler.ts`. Nuevo test `tests/nombre.test.mts`.

**Archivos modificados:**
- `src/parser/nombre.parser.ts`
- `src/parser/index.ts`
- `src/whatsapp/message-handler.ts`
- `bot.ts`
- `package.json` (script `test:nombre`)
- `tests/nombre.test.mts` (nuevo)

**Verificado:** `npx tsc --noEmit` → 0 errores. `npm run test:nombre` → ok. `npm run test:flows` → ok.

**Impacto:** Compatible.

**Rollback:** Revertir los archivos del parser y bot.ts.

---

### Módulo 4.2 — Response Validator expandido (P1)

**Problema:** El response validator solo cubría algunos casos de alucinación. Podían pasar desapercibidos: precios inventados no presentes en el contexto, confirmaciones de horario fuera del rango, promesas de stock sin respaldo, confirmaciones de entrega/fecha sin registro, y sucursales inexistentes.

**Solución:** `response.validator.ts` expandido con 5 validaciones: (1) `validarPreciosRespuesta()` — precios deben estar en el set autorizado (contexto ∪ precios referenciales ∪ `precioMinimo`) o ser suma derivada; precios ≤ `PRECIO_INVENTADO_MIN = 100` se ignoran; (2) horas mencionadas se validan contra `obtenerHorarios()` dinámicos (`apertura`/`cierreSemana`/`cierreFinSemana`, día según `ahoraCdmx()`) solo si hay frase de confirmación; (3) `FRASES_CONFIRMACION_INVENTARIO` rechaza prometer stock; (4) `FRASES_CONFIRMACION_ENTREGA` + `validarEntregaFecha()` (la fecha debe existir literalmente en contexto); (5) `validarSucursalRespuesta()` rechaza "sucursal [Nombre]" no listado en `SUCURSALES_INFO`. Las frases de confirmación toleran coma tras "sí" ("Sí, tenemos..."). Se corrigió bug latente de `extraerPrecios()` con regex global compartido (`lastIndex`); ahora crea instancia por llamada. Se eliminó import sin uso `validarHorario`.

**Archivos modificados:**
- `src/validators/response.validator.ts`
- `tests/response-validator.test.mts` (nuevo)
- `package.json` (scripts `test:*` con `--env-file=.env.test`; nuevo `test:validator`)
- `.env.test` (se añadió `SUPABASE_SERVICE_ROLE_KEY=testkey`; se removió BOM que rompía `node --env-file`)

**Verificado:** `npx tsc --noEmit` → 0 errores. `npm run test:validator` → ok. `npm run test:nombre` → ok. `npm run test:horario` → ok (este test fallaba desde el módulo 3.1 por falta de env). `npm run test:flows` → ok. `test:wire` sigue fallando (aserto `ORDER_UPDATED` pre-existente, ajeno al módulo).

**Impacto:** Compatible.

**Rollback:** Revertir `response.validator.ts`; restaurar scripts previos de package.json.

---

### Módulo 5.1 — Sistema de inventario básico (P2)

**Problema:** El bot podía prometer arreglos que no existen. No había verificación de inventario en ningún lado.

**Solución:** Nuevo `src/config/inventario.service.ts` (patrón idéntico a `configuracion.service`): `refrescarInventario()` lee la tabla `inventario` de Supabase con caché TTL 5 min; `obtenerInventarioDisponible()` devuelve solo productos con `disponible=true` y `existencias>0`; `verificarDisponibilidad(producto)` y `obtenerTextoDisponibilidad()` (lista formateada para el prompt, null si no hay datos). `prompt.builder.ts` inyecta `[PRODUCTOS DISPONIBLES]` en `buildValidatedRulesSection()` solo cuando hay datos, indicando al LLM que confirme stock únicamente para productos de esa lista. `bot.ts` refresca inventario al arranque y cada 5 min. `response.validator.ts` ya no rechaza *todas* las confirmaciones de stock: `esProductoMencionado()` (normalización con `normalizarTexto` + singularización de plurales) permite confirmar solo si la respuesta menciona un producto real del inventario disponible; sin inventario cargado conserva el comportamiento del módulo 4.2 (rechaza).

**Archivos modificados:**
- `src/config/inventario.service.ts` (nuevo)
- `src/openai/prompt.builder.ts`
- `src/validators/response.validator.ts`
- `bot.ts`
- `package.json` (script `test:inventario`)
- `tests/inventario.test.mts` (nuevo)

**Verificado:** `npx tsc --noEmit` → 0 errores. `npm run test:inventario`, `test:validator`, `test:nombre`, `test:horario`, `test:flows` → ok.

**Impacto:** Compatible.

**Rollback:** Revertir los archivos; eliminar `inventario.service.ts` y su llamada en bot.ts.

**Pendiente (Supabase, manual):** crear la tabla `inventario` e insertar productos; mientras no exista, el bot se comporta como antes.

---

### Módulo 5.2 — Seguimiento de reclamaciones (P2)

**Problema:** Las reclamaciones, cancelaciones y quejas se registraban en Supabase (tabla `reclamaciones`) pero nunca se les daba seguimiento. Quedaban en estado "pendiente" para siempre y el dueño no tenía forma de verlas ni cerrarlas.

**Solución:** Nuevo `src/reclamaciones/reclamacion.service.ts`: `listarReclamaciones(estado?)` consulta las últimas 50 por `creado_en` desc; `marcarReclamacionResuelta(id)` actualiza estado a `resuelto`; `formatearReclamaciones()` produce el formato Telegram (id corto, tipo mapeado a emoji, teléfono, descripción, arreglo de referencia y fecha). `bot.ts` `manejarComandoTelegram()` (que ya procesaba `/resumen`, `/reclamaciones` parcial, etc.) ahora soporta:
- `/reclamaciones` — lista reclamaciones pendientes en Telegram.
- `/marcar_resuelto <id>` — cierra una reclamación por uuid corto (primeros 7 caracteres, suficiente por cardinalidad).

**Archivos modificados:**
- `src/reclamaciones/reclamacion.service.ts` (nuevo)
- `bot.ts` (comandos `/reclamaciones` y `/marcar_resuelto`)
- `package.json` (script `test:reclamaciones`)
- `tests/reclamaciones.test.mts` (nuevo)

**Verificado:** `npx tsc --noEmit` → 0 errores. `npm run test:reclamaciones` → ok. Regresión: `test:inventario`, `test:validator`, `test:nombre`, `test:horario`, `test:flows` → ok.

**Impacto:** Compatible.

**Rollback:** Revertir los archivos; eliminar `reclamacion.service.ts` y sus comandos en bot.ts.

---

### Prompt system — alineación con la arquitectura actual (configuracion_bot)

**Problema:** El `system_prompt` en `configuracion_bot` (15,189 caracteres, subido 2026-07-17) estaba desalineado con el sistema actual: nombraba anotaciones que el código ya no emite (`[PEDIDO EN CURSO VERIFICADO POR SISTEMA]`, `[CLIENTE RESPONDIO A LA FOTO DE...]`, `[CLIENTE MENCIONO UNA ZONA...]`, `[CLASIFICACION_JSON]`, `[Fecha actual]`), no mencionaba las anotaciones reales (`[REGLAS VALIDADAS POR EL BACKEND]`, `[PRODUCTOS DISPONIBLES]`, `[DECISION]`, `[CASO]`, `[PEDIDO]`, `[ATENCION HUMANA REQUERIDA]`, `[CLIENTE QUIERE CANCELAR UN PEDIDO]`, `[CLIENTE TIENE UNA QUEJA O RECLAMO]`), hardcodeaba horarios y precios de flores que ahora vienen de la configuración dinámica (módulo 3.1), no incluía la regla de inventario del módulo 5.1, no incluía el anticipo mínimo del 50% y trataba `[VENTA_CERRADA:...]` como mecanismo principal de cierre cuando debe ser respaldo opcional (ERROR #4 de AGENTS.md).

**Solución:** Nuevo `src/prompts/system-prompt.corregido.ts` con `SYSTEM_PROMPT_CORREGIDO` (11,860 caracteres): delega horarios, pagos, sucursales y precios a la sección `[REGLAS VALIDADAS POR EL BACKEND]` que el backend inyecta siempre; documenta todas las anotaciones reales; añade la regla `[PRODUCTOS DISPONIBLES]` (módulo 5.1); convierte `[VENTA_CERRADA:...]` en token de respaldo opcional; conserva tono, flujo de pedido, fotos, envíos, quejas y eventos especiales. `scripts/subir-prompt-corregido.ts` sube el nuevo prompt a `configuracion_bot`.

**Archivos modificados:**
- `src/prompts/system-prompt.corregido.ts` (nuevo)
- `scripts/subir-prompt-corregido.ts` (nuevo)
- Supabase `configuracion_bot.system_prompt` — actualizado 2026-07-31

**Verificado:** `npx tsc --noEmit` → 0 errores. Confirmado en Supabase: el prompt nuevo contiene `[REGLAS VALIDADAS POR EL BACKEND]`, `[PRODUCTOS DISPONIBLES]`, `[DECISION]` y ya no contiene `[CLASIFICACION_JSON]` ni `[PEDIDO EN CURSO VERIFICADO POR SISTEMA]`.

**Impacto:** Compatible (prompt se carga con caché TTL de 60s en `lib/ai.ts`).

**Rollback:** Re-subir el prompt anterior (disponible en `scripts/update-system-prompt.ts` git history) o pegar la versión anterior desde la página del cerebro de Flora.

---

### Módulo 5.3 — Dashboard administrativo web (P3)

**Problema:** El servidor HTTP del bot (`startServer()`) solo exponía `/status`, `/qr`, `/diag/:chatId`, `/api/pedidos/sync` y `/api/resumen`. El dueño no podía consultar ni modificar pedidos activos desde el navegador.

**Solución:** Se amplió la API REST del bot para el panel operativo:
- `GET /api/pedidos` — lista todos los pedidos activos (DTO `PedidoResumenDTO`, nunca expone `fotoReferenciaBase64`, solo `tieneFotoReferencia`).
- `GET /api/pedidos/:id` — detalle de un pedido, resuelto por `id` de pedido o por `clienteId` (404 si no existe).
- `POST /api/pedidos/:id/precio` — el equipo fija el precio: setea `precioPersonalizado`, `precioConfirmadoPor=EQUIPO`, `estadoFlujo=precio_confirmado` y transita a `PRECIO_CONFIRMADO` si el estado es NUEVO/COTIZANDO (400 si precio inválido).
- `POST /api/pedidos/:id/estado` — cambio manual de estado validado por la máquina de estados (`cambiarEstado`, sin saltos; 400 si el estado no es oficial o la transición es inválida).
- Ambos POST persisten con `persistirPedidosEngine()` y emiten eventos de transición (Telegram se entera automáticamente).

**Archivos modificados:**
- `src/models/types.ts` — nuevo `PedidoResumenDTO`
- `src/pedidos/pedido.service.ts` — nuevos `obtenerPedidoPorId(id)` y `serializarPedidoParaDashboard(clienteId, pedido)`
- `src/api/server.ts` — `BotContext` ampliado + 4 endpoints nuevos
- `bot.ts` — `actualizarPrecioDesdeDashboard()` y `cambiarEstadoDesdeDashboard()` cableadas en el `BotContext`

**Verificado:** `npx tsc --noEmit` → 0 errores. Regresión: `test:reclamaciones`, `test:inventario`, `test:validator`, `test:nombre`, `test:horario`, `test:flows` → ok. Smoke test HTTP con `BotContext` simulado: 200/404/400 correctos.

**Impacto:** Compatible.

**Rollback:** Revertir los 4 archivos; quitar los métodos nuevos del `BotContext`.

---

## 2026-07-29

### Fase 10 — 4 correcciones críticas: fotos, response validator, código duplicado, parser

**Problemas resueltos:**

**P0-1 (Fotos de referencia perdidas al reiniciar):** `sanitizarParaCache` eliminaba `fotoReferenciaBase64`, `fotoReferenciaMimetype`, `fotoReferenciaCaption` y `fotoReferenciaRecibidaEn` al persistir en `bot_cache`. Tras reinicio, todas las fotos de referencia desaparecían.

**P0-3 (Response Validator inexistente):** AGENTS.md Parte 3 especifica un Response Validator que verifica que el LLM no invente horarios, precios, sucursales, pagos. No existía en el código.

**P1-11 (Código de envío duplicado):** `buscarPrecioEnvio`, `obtenerZonasEnvio`, `obtenerMunicipiosEnvio`, `formatearZonasParaPrompt`, `contieneFrase`, `detectarLinkMaps` estaban duplicados en `message-handler.ts` con implementaciones casi idénticas a `envio.validator.ts`.

**P0-4 (Parser de nombre rechazaba nombres válidos):** `NO_ES_NOMBRE_REGEX` y `STOP_WORDS` incluían "tiene", "tienen", "listo", "entrega", "recoger", "direccion", "pago", "ramo", "centro", "norte", "sur", "arreglo" — palabras que pueden ser parte de nombres reales.

**Archivos modificados:**
- `src/pedidos/pedido.repository.ts` — `cargarPedidos()` ahora restaura fotos desde `pedidos_bot` tras cargar desde `bot_cache`
- `src/validators/response.validator.ts` — **NUEVO**: Valida que el LLM no confirme horarios fuera de rango, inventario, entregas o pagos sin respaldo del backend
- `src/whatsapp/message-handler.ts` — Removidas funciones duplicadas de envío; ahora importa `buscarEnvio`, `detectarLinkMaps`, `formatearZonasParaPrompt` desde `envio.validator.ts`; integrado `validarRespuestaIA` tras respuesta del LLM
- `src/parser/nombre.parser.ts` — STOP_WORDS y NO_ES_NOMBRE_REGEX reducidos: removidas palabras que pueden ser nombres ("tiene", "listo", "entrega", "ramo", etc.)

**Archivos creados:**
- `src/validators/response.validator.ts` — 162 líneas con `validarRespuestaIA()`, `sanitizarRespuestaIA()`, `extraerPreciosRespuesta()`

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir los 4 archivos modificados + eliminar response.validator.ts.

---

### FASE 10: Optimización — auditoría de duplicación (message-handler.ts + bot.ts)

**Problema:** Se auditaron bot.ts, message-handler.ts, message-entry.ts y conversation.service.ts para encontrar código duplicado. Se detectaron 3 bloques de código muerto y 2 bloques de desglose de precio triplicados.

**Archivos modificados:**
- `src/whatsapp/message-handler.ts` — removidas 2 funciones muertas (`faltoFechaHoraParaCerrar`, `apartadoSucursalListo`); extraído `formatearTotalConDesglose()` para eliminar duplicación del cálculo de precio total
- `bot.ts` — eliminada constante `MAX_LONGITUD_MENSAJE` (no usada, solo message-handler.ts la usaba)

**Auditoría completa:** Ver `tasks/ses_055b7ce6effeqjZh5D3pn0ITp3` para lista completa de hallazgos.

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir cambios en message-handler.ts y bot.ts.

---

### FASE 10: Optimización — eliminación de código muerto en lib/telegram.ts

**Problema:** lib/telegram.ts (828 líneas) contenía 30 funciones `enviarAlerta*` legacy que ya no tenían ningún caller después de FASE 9. Mantenerlas generaba deuda técnica, confusión y falsas expectativas.

**Solución:** Eliminadas todas las funciones y tipos deprecated. El archivo ahora solo contiene 4 exportaciones activas:
- `enviarMensajeTelegram` — usado por el pipeline de notificaciones
- `enviarFotoTelegram` — usado para eventos PHOTO_RECEIVED
- `verificarConexionTelegram` — usado en el arranque de bot.ts
- Helpers internos: `esc`, `ultimos4`, `esLid`, `formatearNumero`, `horaActual`, `enviar`

**Archivo modificado:**
- `lib/telegram.ts` — 828 → 159 líneas (-669)

**Impacto:** Compatible. Compilación 0 errores.

**Rollback:** Revertir lib/telegram.ts.

---

### FASE 9: Telegram 100% event-driven — eliminada dependencia de fallbacks legacy

**Problema:** Aunque el pipeline ya generaba mensajes para todos los eventos, `withPipeline` seguía aceptando un callback `sendNotification` que nunca se ejecutaba (porque el template builder siempre produce mensaje). 24 handlers legacy en `telegram.subscriber.ts` pasaban funciones `enviarAlerta*` muertas.

**Solución:**
- `withPipeline(event)` simplificado — ya no recibe callback. Siempre envía el mensaje del pipeline.
- Nueva `withPipelinePhoto(event, sendPhoto)` para el único evento multimedia (PHOTO_RECEIVED).
- 24 handlers legacy eliminados del subscriber (eran dead code).
- Subscriber reducido de 290 → 42 líneas.

**Archivos modificados:**
- `src/notification-engine/notification.engine.ts` — `withPipeline` simplificado, agregado `withPipelinePhoto`
- `src/notification-engine/index.ts` — exporta `withPipelinePhoto`
- `src/events/telegram.subscriber.ts` — 26 handlers simplificados a `return withPipeline(event)`

**Impacto:** Telegram depende exclusivamente del pipeline de eventos. Cero dependencia de OpenAI. 24 funciones legacy en `lib/telegram.ts` ahora son dead code confirmado (solo `enviarFotoTelegram` y `enviarMensajeTelegram` permanecen activas).

**Rollback:** Revertir los 3 archivos.

---

## 2026-07-18

### Módulo 20 — Fase 6.1: Notification Engine (Estructura Base)

**Problema:** El sistema actual notifica a Telegram con datos vacíos (`Total: 0`, `Cliente: `), incorrectos (nombre con texto extra), o duplicados. No hay verificación entre lo que dice el evento y lo que realmente existe en la base de datos.

**Solución:** Se creó la estructura base del Notification Engine — un pipeline de verificación de 3 submódulos que se interpone entre el EventBus y la notificación a Telegram.

**Archivos creados:**
- `src/notification-engine/types.ts` — 10 interfaces (TimelineData, DatosExtraidos, Conflicto, ResultadoDeteccion, etc.)
- `src/notification-engine/timeline.builder.ts` — Reconstruye estado real desde Supabase (`casos`, `pedidos_bot`, `historial_chat`, `clientes`)
- `src/notification-engine/decision.extractor.ts` — Extrae campos relevantes del evento con nivel de confianza, detecta nombres inválidos (vacíos, con separadores, genéricos), prioriza según tipo de evento
- `src/notification-engine/conflict.detector.ts` — Detecta contradicciones (estado cancelado vs evento activo, transiciones inválidas, nombre/sucursal/precio/producto discrepantes), decide acción: NOTIFICAR/ALERTA/BLOQUEAR
- `src/notification-engine/index.ts` — Barrel export

**Principales detecciones implementadas:**
- Nombres con comas/puntos: truncados con advertencia
- Nombres vacíos o genéricos: confianza 0
- Pedidos cancelados/archivados: BLOQUEAR
- Transiciones inválidas: BLOQUEAR (error)
- Precio 0 o "Por definir": confianza mínima
- Campos vacíos en eventos informativos (ORDER_UPDATED, CASE_CREATED): BLOQUEAR
- Eventos críticos (HUMAN_REQUIRED, PAYMENT_RECEIVED): SIEMPRE notificar con ALERTA si hay conflicto

**Impacto:** Cero. Archivos nuevos, no modifican el flujo existente. Compilación exitosa.

---

### Módulo 20 — Fase 6.2: Notification Engine integrado con EventBus

**Cambio:** Todos los 26 handlers de `telegram.subscriber.ts` ahora pasan por el pipeline de verificación antes de notificar a Telegram.

**Archivos creados:**
- `src/notification-engine/notification.engine.ts` — Orquestador del pipeline (buildTimeline → extractDecision → detectConflicts → decide acción)

**Archivos modificados:**
- `src/events/telegram.subscriber.ts` — Cada handler envuelto con `withPipeline(event, async () => { ... })`
- `src/notification-engine/index.ts` — Exporta `processNotificationPipeline` y `withPipeline`

**Comportamiento:**
- Si el pipeline devuelve `BLOQUEAR` → el handler NO se ejecuta, se loggea el bloqueo
- Si devuelve `NOTIFICAR` o `ALERTA` → el handler se ejecuta normalmente
- Si la timeline (Supabase) falla → fail open: se notifica sin verificación
- Si el evento no tiene teléfono → fail open: se notifica igual

**Impacto:** Bajo. Todos los handlers existentes funcionan igual cuando el pipeline permite la notificación. Los handlers bloqueados no llegan a Telegram (se loggean internamente).

**Siguiente paso:** Fase 6.3 — Implementar IAs auxiliares (Order Reconstructor y Order Auditor).

---

### Módulo 20 — Fase 6.3: IAs Auxiliares (Order Reconstructor + Order Auditor)

**Cambio:** Se integraron dos IAs en el pipeline de notificaciones. IA #1 (GPT-4o-mini) reconstruye el pedido verificando cada campo contra DB + evento. IA #2 (GPT-4o) audita la reconstrucción y rechaza si detecta alucinaciones.

**Archivos creados:**
- `src/notification-engine/order.reconstructor.ts` — IA #1: Prompt estructurado para reconstruir pedido. Fallback a datos crudos si falla la llamada. 15s timeout.
- `src/notification-engine/order.auditor.ts` — IA #2: Prompt con 6 reglas de detección (nombre, sucursal, fecha, precio, producto, estado). Fallback a aprobación si falla.

**Archivos modificados:**
- `src/notification-engine/notification.engine.ts` — Pipeline completo: tras detectConflicts, si no es BLOQUEAR, pasa por IA #1 → IA #2. Si IA #2 rechaza, accion cambia a ALERTA.
- `src/notification-engine/index.ts` — Exporta ReconstructorResult, AuditorResult

**Env vars requeridas:**
- `IA1_TOKEN`, `IA1_MODEL` (default: gpt-4o-mini), `IA1_BASE_URL`
- `IA2_TOKEN`, `IA2_MODEL` (default: gpt-4o), `IA2_BASE_URL`

**Comportamiento del pipeline completo:**
1. Timeline (DB) → extractDecision → detectConflicts
2. Si BLOQUEAR → no notifica
3. Si NOTIFICAR/ALERTA → IA #1 reconstructor → IA #2 auditor
4. Si IA #1 falla → fallback a datos crudos
5. Si IA #2 falla → fail open (se notifica igual)
6. Si IA #2 rechaza → notifica con ALERTA y advertencias

**Impacto:** Bajo. Pipeline completo pero con fail-safes. Si las IAs fallan, el sistema sigue funcionando.

**Siguiente paso:** Fase 6.4 — Business Rules Validator (reglas de horario, sucursal, precio, nombre).

---

### Módulo 21 — Fase 6.4: Business Rules Validator

**Cambio:** Se implementó un validador de reglas de negocio basado en el system prompt oficial de Flora. Extrajo 9 reglas del prompt y las implementó como funciones individuales en un validador puro (sin IAs).

**Archivo creado:**
- `src/notification-engine/business-rules.validator.ts` — 9 reglas de negocio:
  - **R001**: Horario laboral L-V 10-19, S-D 10-17. Si la notificación contiene hora, verifica que esté dentro del horario.
  - **R002**: Sucursal solo "Centro" o "Norte". Detecta inventos como "Apizaco (sucursal)".
  - **R003**: Precio mínimo $60 MXN. Si es menor, warning.
  - **R004**: Precio máximo $50,000 MXN. Si excede, warning (posible error de invento).
  - **R005**: Nombre sin comas ni conectores ("cree", "quisiera", "podría", etc.). Si detecta, error.
  - **R006**: Fecha y hora obligatorias si estado es apartado/pagado/entregado/en_produccion/listo.
  - **R007**: Envío a domicilio solo acepta transferencia (no efectivo contra entrega).
  - **R008**: Si requiere revisión y falta producto/precio, posible invento del LLM.
  - **R009**: Si recoge en sucursal, debe tener método de pago definido.

**Archivos modificados:**
- `src/notification-engine/types.ts` — Se removió la interfaz BusinessRuleWarning (ahora vive en su propio módulo)
- `src/notification-engine/notification.engine.ts` — Se agregó validateBusinessRules después de IA #2. Si violaciones error → ALERTA. Todas las violaciones se agregan como advertencias. PipelineResult.ruleViolations agregado.
- `src/notification-engine/index.ts` — Exporta validateBusinessRules y BusinessRuleWarning

**Reglas extraídas de:** System prompt de Flora (system prompt completo del chatbot, analizado manualmente).

**Impacto:** Bajo. El validador es puramente funcional, sin IAs, sin llamadas externas. Solo agrega advertencias y puede escalar a ALERTA.

**Siguiente paso:** Fase 6.5 — Template Builder (plantillas de notificación).

---

### Módulo 22 — Fase 6.5: Template Builder

**Cambio:** Se creó un sistema de plantillas para generar mensajes de Telegram a partir de datos verificados por el pipeline. Cada evento tiene su propia plantilla, todas usan el mismo formato (emojis, negritas, estructura). El mensaje se incluye en PipelineResult.message.

**Archivo creado:**
- `src/notification-engine/template.builder.ts` — builder completo con:
  - `buildTelegramMessage(eventType, payload, verified, pipelineResult)` → string
  - Helper functions: `esc`, `horaActual`, `formatearNumero`, `ultimos4` (mismas que lib/telegram.ts)
  - `buildWarningBanner(pipelineResult)` → agrega advertencias y conflictos si ALERTA
  - `getTemplate(eventType, payload, verified)` → 21 templates específicos por evento
  - `getFooter(eventType)` → footer personalizado por evento

**Plantillas implementadas (21):**
| Evento | Header | Footer |
|--------|--------|--------|
| ORDER_CREATED | 🌸 ¡VENTA CERRADA! | Pago recibido — preparar pedido |
| ORDER_UPDATED | 📦 PEDIDO APARTADO | Pendiente de pago |
| HUMAN_REQUIRED | ⚠️ ATENCIÓN HUMANA | Revisar WhatsApp |
| CUSTOMER_ANGRY | ⚠️ QUEJA DEL CLIENTE | Atención prioritaria |
| PAYMENT_PENDING | ⏳ PAGO PENDIENTE | Esperando confirmación |
| PHOTO_REQUESTED | 📸 CLIENTE PIDE FOTOS | Enviar fotos disponibles |
| ENVIO_REQUESTED | 🚚 COTIZACIÓN ENVÍO | Cotizar envío exacto |
| CANCELACION_REQUESTED | 🚫 SOLICITUD CANCELACIÓN | Revisar pedido |
| CASE_CREATED | 📋 NUEVO CASO | Dar seguimiento |
| COTIZACION_REQUESTED | 🌷 INTERÉS / COTIZACIÓN | Seguimiento al cliente |
| ORDER_READY | ✅ PEDIDO LISTO | Listo para entrega |
| ORDER_DELIVERED | 🚚 PEDIDO ENTREGADO | Entregado al cliente |
| Y más: PRICE_CONFIRMED, CUSTOMER_WAITING, ZONA_AMBIGUA, PHOTO_RECEIVED, PHOTO_SENT, PAYMENT_CONFIRMED, DELIVERY_COMPLETED, CASE_ARCHIVED + default genérico |

**Archivos modificados:**
- `src/notification-engine/notification.engine.ts` — PipelineResult ahora incluye `message: string | null`. Se construye al final del pipeline usando buildTelegramMessage y datos verificados.
- `src/notification-engine/index.ts` — Exporta buildTelegramMessage

**Impacto:** Bajo. El pipeline ahora produce el mensaje formateado, pero los handlers actuales siguen usando su propia lógica. La migración se hará en fases posteriores.

**Siguiente paso:** Fase 6.6 — Event Logger (log estructurado del pipeline en Supabase).

---

### Módulo 23 — Fase 6.6: Pipeline Event Logger

**Cambio:** Se integró un logger estructurado que registra cada ejecución del pipeline de notificaciones en Supabase, usando la infraestructura existente (`logger.service.ts` + tabla `logs`).

**Archivo creado:**
- `src/notification-engine/pipeline-logger.ts` — 4 funciones:
  - `logPipelineStart(event, timeline)` — log al inicio del pipeline
  - `logPipelineComplete(event, result)` — log al finalizar (info si NOTIFICAR, warn si ALERTA/BLOQUEAR)
  - `logPipelineError(event, error)` — log si el pipeline lanza excepción
  - `logPipelineStep(event, step, data?)` — log de paso intermedio (para debugging)

**Archivos modificados:**
- `src/notification-engine/notification.engine.ts` — 3 puntos de log insertados: inicio (tras timeline), bloqueo (antes de return), final (antes de return). Wrapped en try-catch con logPipelineError.
- `src/notification-engine/index.ts` — Exporta las 4 funciones del pipeline-logger

**Estructura del log en Supabase:**
```sql
-- module = 'pipeline'
-- metadata contiene: eventType, telefono, accion, conflictos, advertencias, ruleViolations
SELECT * FROM logs WHERE module = 'pipeline' ORDER BY created_at DESC;
```

**Impacto:** Bajo. Logger asíncrono (buffer 1.5s), no bloquea el pipeline. Metadata limitada a 500 chars por campo. No hay cambios en comportamiento de notificaciones.

**Siguiente paso:** Fase 6.7 — Migración de handlers a pipeline (reemplazar cada enviarAlerta* por la nueva ruta).

---

### Módulo 24 — Fase 6.7: Migración Automática de Handlers

**Cambio:** `withPipeline` ahora envía el mensaje del pipeline directamente a Telegram si existe, saltando el callback del handler. 25 de 26 handlers migrados automáticamente sin modificar su código.

**Archivos modificados:**
- `lib/telegram.ts` — Nueva exportación `enviarMensajeTelegram(texto)` (wrapper público de la función privada `enviar()`)
- `src/notification-engine/notification.engine.ts` — `withPipeline` modificado:
  1. Ejecuta pipeline normalmente
  2. Si BLOQUEAR → no envía nada
  3. Si `result.message` existe Y no es evento multimedia → envía mensaje del pipeline, salta callback
  4. Si `result.message` es null O es evento multimedia → llama callback (comportamiento anterior)

**Eventos con auto-send (25/26):**
- ORDER_CREATED, ORDER_UPDATED, ORDER_READY, ORDER_DELIVERED
- HUMAN_REQUIRED, CUSTOMER_ANGRY, CUSTOMER_WAITING
- PAYMENT_RECEIVED, PAYMENT_PENDING, PAYMENT_CONFIRMED, PRICE_CONFIRMED
- PHOTO_REQUESTED, PHOTO_SENT
- ENVIO_REQUESTED, CANCELACION_REQUESTED
- CASE_CREATED, CASE_ARCHIVED
- COTIZACION_REQUESTED, ZONA_AMBIGUA, DELIVERY_COMPLETED
- + default genérico para cualquier otro evento con datos

**Excepción (usa callback):**
- PHOTO_RECEIVED — necesita enviar la foto a Telegram (no solo texto)

**Impacto:** Medio-alto. Cambia el flujo de notificaciones: ahora los mensajes se construyen con datos verificados del pipeline en lugar de datos crudos del payload. Los handlers antiguos (`enviarAlerta*` en `lib/telegram.ts`) ya no se llaman para eventos comerciales.

**Siguiente paso:** Notification Engine completado al 100%. Próximo módulo a definir.

---

### Módulo 25 — Fase 6.8: Auditoría Post-Migración

**Cambio:** Auditoría completa de `lib/telegram.ts`. 24 funciones marcadas como `@deprecated`, 2 eliminadas, 6 activas.

**Funciones eliminadas (0 referencias externas):**
| Función | Razón |
|---------|-------|
| `enviarArchivoTelegram` | Nunca fue llamada desde ningún archivo |
| `enviarAlertaTelegram` | Legacy export, sin importadores externos |

**Funciones deprecadas (24):**
- `enviarAlertaVentaCerrada`, `enviarAlertaArregloApartado`, `enviarAlertaPedidoWeb`
- `enviarAlertaCotizacion`, `enviarAlertaClienteFrustrado`, `enviarAlertaPedidoApartado`
- `enviarAlertaZonaAmbigua`, `enviarAlertaAtencionHumana`, `enviarAlertaCancelacion`
- `enviarAlertaQueja`, `enviarAlertaVentaDelDia`, `enviarAlertaClienteInteresado`
- `enviarAlertaEmpleadoFotos`, `enviarAlertaEmpleadoEnvio`, `enviarAlertaPedidoListo`
- `enviarAlertaPedidoEntregado`, `enviarAlertaPagoConfirmado`, `enviarAlertaPrecioConfirmado`
- `enviarAlertaEntregaCompletada`, `enviarAlertaClienteEsperando`, `enviarAlertaFotoEnviada`
- `enviarAlertaCasoNuevo`, `enviarAlertaCasoArchivado`, `enviarAlertaPagoRecibido`
- `enviarAlertaPagoPendiente`

**Funciones activas (6):**
| Función | Uso |
|---------|-----|
| `enviarAlertaQr` | Eventos QR_GENERATED (sistema) |
| `enviarAlertaReconectado` | Eventos BOT_CONNECTED (sistema) |
| `enviarAlertaDiariaDesconexion` | Eventos BOT_DAILY_ALERT (sistema) |
| `enviarAlertaBotDesconectado` | Eventos BOT_DISCONNECTED (sistema) |
| `enviarAlertaProveedorCaido` | Eventos PROVIDER_FAILURE (sistema) |
| `enviarFotoTelegram` | Eventos PHOTO_RECEIVED (medios) |
| `enviarMensajeTelegram` | Export público para pipeline (nueva) |

**Impacto:** Bajo. Solo se eliminaron funciones sin referencias. Las deprecadas mantienen firmas intactas.

**Notification Engine completado al 100%.**

---

## 2026-07-17

### Resumen de sesión — Módulo 19 (Bugs de producción)

Se corrigieron 4 bugs críticos/alto/medio reportados en prueba real de producción:
- BUG-004 (crítico): máquina de estados rota → pedido no llegaba a APARTADO (DEC-044, commit `91689a7`).
- BUG-005 (alto): nombre incorrecto en alertas / no se pedía nombre (DEC-045, commit `13e227e`).
- BUG-006 (alto): horario inventado por LLM → horario dinámico del backend (DEC-046, commit `7fc1c75`).
- BUG-007 (medio): dirección Maps repetida sin calle → guardar link + pedir calle (DEC-047, commit `848e15f`).

Tests agregados: `tests/event-wire-flow.test.mts` (`npm run test:wire`, BUG-004), `tests/horario.test.mts` (`npm run test:horario`, BUG-006).

Próximo paso sugerido: prueba en producción del flujo completo y luego Módulo 17 (código muerto) o 18 (unificación de pedidos).

---

## 2026-07-17

### Fix — Bug 007 (Medio): Dirección Maps short-link — guardar link y pedir calle (DEC-047)

**Problema:** Cliente envió `maps.app.goo.gl/...`; el bot lo repetía como dirección sin calle legible.

**Archivos modificados:**
- `src/parser/direccion.parser.ts` (`parseDireccion` marca `esLinkMaps`, conserva link)
- `src/whatsapp/message-handler.ts` (`limpiarDireccionCliente` conserva link; flujo de envío pide calle)

**Cambios:**
1. `parseDireccion` devuelve `esLinkMaps: true` y conserva el link como dirección (confianza alta).
2. `limpiarDireccionCliente` (message-handler) ya no borra el link Maps.
3. En el flujo de envío, si la dirección es link Maps, se inyecta instrucción al LLM para GUARDAR el link y PEDIR confirmación de calle/número en texto (no repetir el link como calle).

**Impacto:** Se conserva la ubicación de referencia y se obtiene calle legible. Compatible con `buscarEnvio` (ya devuelve null para link solo).

**Rollback:** Revertir `src/parser/direccion.parser.ts` y `src/whatsapp/message-handler.ts` a commit `7fc1c75`.

---

## 2026-07-17

### Fix — Bug 006 (Alto): Horario inventado por el LLM — horario dinámico inyectado por backend (DEC-046)

**Problema:** El bot dijo "mañana cerramos a las 7:00 pm" siendo sábado (cierra 5pm). El LLM no aplicó la tabla de horarios.

**Archivos modificados:**
- `src/validators/horario.validator.ts` (nueva `horarioHoyManana`)
- `src/openai/prompt.builder.ts` (inyecta `[HORARIO HOY]` / `[HORARIO MAÑANA]`)
- `tests/horario.test.mts` (nuevo)

**Cambios:**
1. `horarioHoyManana()`: L-V 10:00-19:00, S-D 10:00-17:00, calculado con `ahoraCdmx`.
2. `construirContextoPrompt` inyecta ambas anotaciones como información confiable del sistema que el LLM debe obedecer (AGENTS.md ERROR #3).
3. Se benefician message-handler y orchestrator (ambos usan el builder).

**Impacto:** El bot responderá el horario real de hoy/mañana; no inventará. Test automático incluido.

**Rollback:** Revertir `src/validators/horario.validator.ts` y `src/openai/prompt.builder.ts` a commit `13e227e`.

---

## 2026-07-17

### Fix — Bug 005 (Alto): Nombre en alertas Telegram incorrecto / pedir nombre antes de cerrar (DEC-045)

**Problema:** Alertas Telegram de pedido mostraban `cliente:"Me pasa su cuenya pla"` (texto del mensaje). El sistema cerraba sin nombre válido.

**Archivos modificados:**
- `bot.ts` (`nombreParaAlerta`, `ventaCerradaHandler`, `pedidoApartadoHandler`)

**Cambios:**
1. `nombreParaAlerta()`: prioriza `pedido.nombre` (fuente de verdad backend) → nombre válido del token VENTA_CERRADA → `Verificar en chat`. Sincroniza nombre del token al pedido si falta.
2. `ventaCerradaHandler`: si no hay nombre válido, NO emite ORDER_CREATED/PAYMENT_*; deja el pedido en `esperando_nombre` para que el bot pida el nombre (cumple regla de negocio).
3. `pedidoApartadoHandler` usa `nombreParaAlerta` para la alerta PAYMENT_PENDING.

**Impacto:** Alertas con nombre real; se cumple regla de pedir nombre antes de cerrar. Sin romper cierres donde sí hay nombre.

**Rollback:** Revertir `bot.ts` a commit `91689a7`.

---

## 2026-07-17

### Fix — Bug 004 (Crítico): Máquina de estados rota — pedido nunca llegaba a APARTADO (DEC-044)

**Problema:** El cliente fue de cotización a "quiero pagar/envío". Transiciones `COTIZANDO → ESPERANDO_PAGO` y `ESPERANDO_PAGO → EN_PRODUCCION` eran inválidas. `transitarDesdeFlujo` forzaba el estado aunque fuera inválido, permitiendo saltos imposibles. El pedido nunca pasó por APARTADO, así que la alerta "Pedido Apartado" no salió con dirección/total; al enviar comprobante se emitió `ORDER_CREATED` con datos vacíos.

**Archivos modificados:**
- `src/pedidos/pedido.service.ts` (TRANSICIONES_VALIDAS, mapping pagado_transferencia→APARTADO, quitar forceo en transitarDesdeFlujo)
- `tests/event-wire-flow.test.mts` (caso BUG-004)

**Cambios:**
1. Transiciones válidas agregadas: `NUEVO/COTIZANDO/PRECIO_CONFIRMADO/ESPERANDO_DATOS → ESPERANDO_PAGO`.
2. `pagado_transferencia` ahora mapea a `APARTADO` (antes `EN_PRODUCCION`).
3. `transitarDesdeFlujo` ya NO fuerza estados inválidos; si `transitar()` las rechaza, el estado se queda en el anterior y queda en el log.
4. Pago confirmado = APARTADO con datos; `ORDER_CREATED` solo al cierre real.

**Impacto:** Cumple AGENTS.md (nunca saltar estados). Alertas de apartado saldrán con datos reales. Cubierto por test automático.

**Rollback:** Revertir `src/pedidos/pedido.service.ts` a commit `21d47d4`.

---

## 2026-07-17

### Fix — Bug B: Alerta "cliente pide fotos" con número real y contexto (ambos canales)

**Problema:** Cuando el cliente pedía ver fotos de arreglos, la alerta a Telegram (`PHOTO_REQUESTED` → `enviarAlertaEmpleadoFotos`) llegaba sin número legible ni contexto útil (se emitía con `cliente: ''`). El equipo no sabía a quién escribir ni qué buscaba el cliente. El canal WhatsApp-a-empleados ya funcionaba.

**Archivos modificados:**
- `src/whatsapp/message-handler.ts` (emisor PHOTO_REQUESTED)
- `lib/telegram.ts` (`enviarAlertaEmpleadoFotos`)
- `src/events/telegram.subscriber.ts` (pasa descripción como contexto)

**Cambios:**
1. `PHOTO_REQUESTED` ahora se emite con `telefono` real (resuelto), `cliente` (`msg.pushName`) y `descripcion` con nombre + número + "pide ver fotos de arreglos disponibles".
2. `enviarAlertaEmpleadoFotos` acepta `contexto` opcional y lo muestra en la alerta de Telegram con el número real vía `formatearNumero`.
3. El subscriber pasa `event.payload.descripcion` como contexto.
4. Se mantiene el canal WhatsApp-a-empleados (sin cambios).

**Impacto:** El equipo recibe en Telegram una alerta accionable de "pide fotos" con número real y contexto. Cumple decisión de usuario: ambos canales. No se asume el ramo (el cliente aún no elige cuando pide fotos).

**Rollback:** Revertir los 3 archivos a la versión del commit `ad1be9c`.

---

## 2026-07-17

### Fix — Bug A: Alertas Telegram vacías + crearPedido ya no emite VENTA CERRADA falsa

**Problema:** Las alertas de Telegram (VENTA CERRADA / PEDIDO APARTADO) llegaban con `Producto:`, `Total:`, `Cliente:` vacíos. Además `crearPedido` emitía `ORDER_CREATED` (cableado a "🌸 ¡VENTA CERRADA!") solo con `descripcion: 'Pedido creado'`, generando la alerta engañosa que el usuario reportó.

**Archivos modificados:**
- `src/pedidos/pedido.service.ts`

**Cambios:**
1. Nueva función `buildOrderPayload(pedido)` que mapea datos reales del `PedidoActual`: `cliente` (nombre), `producto` (productoPersonalizado o arreglo.nombre), `total` (precioPersonalizado o arreglo.precio), `sucursal` (sucursal/direccion/envio.zona), `metodoPago`.
2. `crearPedido` ahora emite `ORDER_UPDATED` (cableado a "📦 PEDIDO APARTADO") con payload completo en vez de `ORDER_CREATED` (cableado a "VENTA CERRADA"). Crear un pedido no es una venta.
3. `transitar` y `archivarPedido` enriquecen su `ORDER_UPDATED` con `buildOrderPayload`, eliminando los campos vacíos.

**Impacto:** El equipo recibe alertas con datos reales y accionables. Se elimina la "VENTA CERRADA" falsa al crear pedido (BUG-002 de KNOWN_BUGS ya resuelto en Bug C; este cierra la vía restante). La venta real sigue notificándose vía `ORDER_CREATED` desde `ventaCerradaHandler` (bot.ts) con datos completos.

**Rollback:** Revertir `src/pedidos/pedido.service.ts` a la versión del commit `c0f48a0`.

---

## 2026-07-17

### Fix — Bug C: "VENTA CERRADA" falsa por interés de compra + datos reales en alertas

**Problema:** Cuando `esInteresCompra` era true, `message-handler.ts` emitía `EventType.ORDER_CREATED` con solo `telefono` y `descripcion`. Eso disparaba `enviarAlertaVentaCerrada` mostrando "🌸 ¡VENTA CERRADA!" aunque el cliente solo mostró intención de compra (no pagó ni cerró). Además, las alertas llegaban sin datos reales del chat (producto/total vacíos, número enmascarado).

**Archivos modificados:**
- `src/whatsapp/message-handler.ts` (líneas ~820-828)
- `lib/telegram.ts` (`enviarAlertaCotizacion`)

**Cambios:**
1. El bloque `esInteresCompra` ya NO emite `ORDER_CREATED`. Ahora emite `COTIZACION_REQUESTED` con payload robusto: `telefono` (número real resuelto vía `numeroRealPromise`), `cliente` (`msg.pushName`), y `descripcion` que incluye nombre + número + producto/arreglo actual (`productoPersonalizado`/`arreglo` o estado) + texto del interés.
2. `enviarAlertaCotizacion` renombrada a mensaje genérico "INTERÉS / COTIZACIÓN" que muestra el teléfono real (vía `formatearNumero`) y el detalle completo, en vez de "COTIZACIÓN CON FOTO/REFERENCIA" que no aplica a interés de texto.

**Impacto:** El equipo ya no ve falsas "VENTA CERRADA". Las alertas de interés llevan datos reales y accionables. La venta real sigue emitiéndose desde `pedido.service.ts` / `bot.ts` solo cuando hay token `[VENTA_CERRADA]` válido (DEC-001 / Error #4 respetados).

**Rollback:** Revertir los 2 archivos a la versión anterior del commit `993a9df`.

---

## 2026-07-17

### Feature — Fase 2 Observabilidad: métricas (latencia IA, errores Supabase, eventos) + health endpoint

**Problema:** No había visibilidad de la latencia de la IA, la tasa de error de Supabase ni el estado de salud de los motores en producción.

**Archivos modificados/creados:**
- `lib/metrics.service.ts` (nuevo) — store en memoria: `recordAiLatency`, `recordAiError`, `recordSupabaseError`, `recordEvent`, `getSnapshot()`.
- `lib/supabase.ts` — `supabaseAdmin` envuelto en Proxy que cuenta errores de Supabase en toda query sin cambiar call sites ni tragar errores.
- `lib/ai.ts` — `getAIResponse` registra latencia y errores de IA.
- `lib/logger.service.ts` — `subscribeLogEvents` ahora también registra cada evento en métricas.
- `bot.ts` — persiste snapshot de métricas a Supabase (`configuracion_bot` clave `bot_metrics`) cada 30s + en `beforeExit`.
- `src/api/server.ts` — ruta `GET /metrics` (VM) devuelve snapshot local.
- `app/api/health/route.ts` (nuevo) — lee `bot_metrics` de Supabase (funciona en Vercel y VM).
- `app/admin/health/page.tsx` (nuevo) — dashboard con latencia, tasa de error IA, errores Supabase, eventos/min, gráfica de latencia y eventos por tipo.
- `app/admin/layout.tsx` y `app/admin/page.tsx` — link "Salud".

**Cambios:**
1. Latencia de IA medida en `getAIResponse` (promedio + p95 + muestras recientes).
2. Errores de Supabase contados por un Proxy transparente sobre `supabaseAdmin` (non-swallowing `.catch`).
3. Cada evento del EventBus incrementa contador + ventana de 60s para tasa/min.
4. Health endpoint con evaluación `saludable`/`degradado`.

**Impacto:** Diagnóstico proactivo de rendimiento. Sin nuevas dependencias. El Proxy de Supabase es transparente: no altera resultados ni errores.

**Rollback:** Revertir los 9 archivos del módulo. No requiere migración SQL (reusa tabla `configuracion_bot`).

---

## 2026-07-17

### Feature — Sistema de Observabilidad (logging estructurado + dashboard de logs)

**Problema:** Los errores de producción solo aparecían en `console.log` dispersos. Cuando el proveedor IA cayó (ver entrada previa del mismo día), no había forma centralizada de ver *dónde* y *cuándo* falló el bot.

**Archivos modificados/creados:**
- `lib/logger.service.ts` (nuevo) — logger estructurado (niveles debug/info/warn/error), buffer circular en memoria (500) + escritura batch a Supabase, `subscribeLogEvents()` que auto-loguea todos los eventos del `eventBus`.
- `supabase_migration_logs.sql` (nuevo) — tabla `logs` (id, level, module, message, metadata jsonb, created_at) + índices + RLS.
- `app/api/logs/route.ts` (nuevo) — `GET` con filtros (level, module, search, since, limit, offset) + fallback a buffer si Supabase falla.
- `app/admin/logs/page.tsx` (nuevo) — dashboard visual: tabla, filtros, auto-refresh 5s, expandir metadata.
- `bot.ts` — importa `subscribeLogEvents`, lo llama en arranque, log de inicio, y reemplaza handlers `uncaughtException`/`unhandledRejection` por `logger.error` (+ `flushLogsNow` en `beforeExit`).
- `src/whatsapp/message-handler.ts` — catch de `procesarMensaje` usa `logger.error` en vez de `console.error`.
- `app/admin/layout.tsx` — link "Logs" en nav.
- `app/admin/page.tsx` — card "Logs del Sistema" en FEATURES.

**Cambios:**
1. Logger propio sin dependencia externa (evita pino/winston — coherente con política de mínimas dependencias de AGENTS.md).
2. Todos los eventos del EventBus se auto-registran como `info` en el módulo `event`.
3. `uncaughtException`/`unhandledRejection` ahora se registran con stack en el módulo `bot`.
4. Dashboard `/admin/logs` lee de `/api/logs` en tiempo real para diagnosticar fallos rápido.

**Impacto:** Mayor capacidad de diagnóstico en producción. La escritura a Supabase es fire-and-forget con buffer de respaldo; un fallo de Supabase no rompe el flujo del bot.

**Rollback:** Revertir los 9 archivos/commits del módulo; no requiere cambios en lógica de ventas/pagos/casos.

**Pendiente:** Ejecutar `supabase_migration_logs.sql` manualmente en el SQL Editor de Supabase (por política de migraciones SQL el sistema no lo ejecuta automáticamente).

---

## 2026-07-17

### Fix — Eliminar Gemini fallback, getAIResponse ya no lanza error, concurrencia mejorada

**Problema:** Cuando ambos proveedores de IA fallaban (Azure OpenAI timeout + Gemini quota 429), `getAIResponse` lanzaba throw y `procesarMensaje` atrapaba el error enviando "mareo digital". Esto ocurría porque Gemini free tier (cuota 150/día) se agotaba y el semáforo de concurrencia (2 slots, 60s timeout) causaba contención de cola.

**Archivos modificados:**
- `lib/ai.ts`
- `lib/telegram.ts`
- `src/events/types.ts`
- `src/events/telegram.subscriber.ts`
- `lib/gemini-ai.ts` (eliminado)
- `package.json` (@google/generative-ai eliminado)

**Cambios:**

1. **Eliminado Gemini como fallback**: Removida importación `callGeminiText/callGeminiVision` de `lib/gemini-ai.ts`. Eliminada función `callWithFallback`. Las 4 llamadas que intentaban Gemini como respaldo ahora van directo a GitHub Models con `conRetry`.
2. **Aumentada concurrencia**: `MAX_CONCURRENT 2→3`, `SLOT_TIMEOUT_MS 60s→30s` — menos contención en cola.
3. **getAIResponse ya no lanza**: El catch final emite `PROVIDER_FAILURE` a Telegram y devuelve texto de respaldo en vez de throw.
4. **Nuevo evento PROVIDER_FAILURE**: Agregado a `EventType` enum, suscrito en Telegram con función `enviarAlertaProveedorCaido`.
5. **Gemini eliminado**: `lib/gemini-ai.ts` borrado, `@google/generative-ai` desinstalado.

**Impacto:** El bot nunca deja de responder por fallo de proveedor IA. GitHub Models es el único proveedor. Telegram notifica al equipo cuando el proveedor está caído.

**Rollback:** Revertir cambios en lib/ai.ts, lib/telegram.ts, src/events/types.ts, src/events/telegram.subscriber.ts; restaurar lib/gemini-ai.ts + @google/generative-ai.

---

## 2026-07-17

### Feature — Extracción de manejarMensajeEntrante a message-entry.ts

**Archivos modificados:**
- `src/whatsapp/message-entry.ts` (nuevo)
- `bot.ts`

**Cambios:**
- Extraído `manejarMensajeEntrante` (~80 líneas) + `rescatarMensajesNoLeidos` (~40) + `timestampMensajeMs` (~5) + `avisarRateLimitUnaVez` (~5) + `registrarActividad` de bot.ts a `src/whatsapp/message-entry.ts` como factory `createMessageEntry(deps)`
- `bot.ts` ahora pasa 9 dependencias: `responderMensaje`, `marcarFotosDisponibles`, `encolarPorCliente`, `encolarMensajeAgrupado`, `procesarMensajeEquipo`, `verificarSiBotPausado`, `mediaToBase64`, `TIPOS_MEDIA_NO_SOPORTADOS`, `registrarActividad`
- `registrarActividad` se inyecta como dep compartida para mantener el watchdog de bot.ts actualizado
- `messageEntry.procesarMensajeEntrante(msg)` reemplaza llamadas a `manejarMensajeEntrante(msg)` en `messages.upsert`
- `messageEntry.rescatarMensajesNoLeidos(chats, messages)` reemplaza llamada en `messaging-history.set`
- Exportaciones añadidas en bot.ts: `responderMensaje`, `marcarFotosDisponibles`, `encolarPorCliente`, `encolarMensajeAgrupado`, `procesarMensajeEquipo`, `verificarSiBotPausado`, `mediaToBase64`, `TIPOS_MEDIA_NO_SOPORTADOS`, `registrarActividad`, `ultimaActividad`, `COLA_POR_CLIENTE`, `MENSAJES_POR_AGRUPAR`, `AGRUPAR_MENSAJES_MS`

**Impacto:** bot.ts de ~1333 → ~1201 líneas (-132). message-entry.ts añade ~150 líneas de código modularizado. Compilación 100% exitosa.

**Rollback:** Revertir cambios en bot.ts + eliminar message-entry.ts.

---

## 2026-07-17

### Fix — Eliminación de código muerto duplicado en bot.ts

**Archivos modificados:**
- `bot.ts`
- `PROJECT_TRACKER.md`

**Cambios:**
- Eliminadas ~381 líneas de funciones duplicadas entre bot.ts y message-handler.ts que eran código muerto (solo llamadas desde el antiguo `procesarMensaje` ya extraído)
- Funciones eliminadas: `esTextoComprobante`, `contextoEsperaComprobante`, `respuestaPideComprobante`, `detectarExtrasPedido`, `agregarExtrasPedido`, `limpiarDireccionCliente`, `sincronizarPedidoConCaso`, `extraerNombrePedido`, `aplicarDatosPedidoDesdeTexto`, `pedirFechaHoraSiFalta`, `procesarMediaAcumulado`, `registrarReclamacion`, `registrarZonaAmbigua`, `obtenerZonasEnvio`, `obtenerMunicipiosEnvio`, `buscarPrecioEnvio`, `contieneFrase`, `detectarLinkMaps`, `formatearZonasParaPrompt`, `limpiarRespuestaIA`, `calcularDelayEscritura`, `detectarIntencion`, `esSolicitudFotosDisponibles`, `clienteEligeFotoDisponible`, interfaces/constantes asociadas
- `esMensajeFotosDisponiblesEquipo` preservada (sigue viva en `procesarMensajeEquipo`)

**Impacto:** bot.ts de ~1540 → 1159 líneas. Sin duplicación de helpers entre bot.ts y message-handler.ts.

**Rollback:** Revertir cambios en bot.ts.

---

## 2026-07-17

### Feature — Extracción de procesarMensaje a message-handler.ts

**Archivos modificados:**
- `src/whatsapp/message-handler.ts` (nuevo)
- `bot.ts`

**Cambios:**
- Extraído `procesarMensaje` (~658 líneas) de `bot.ts` a `src/whatsapp/message-handler.ts` como factory `createMessageHandler(deps)`
- `bot.ts` ahora pasa 22 helpers compartidos como dependencias (MsgHandlerDeps): pedidoActual, responderMensaje, ventaCerradaHandler, pedidoApartadoHandler, ventaDesdeEstado, persistirPedido, ventaListaParaCerrar, ventaListaParaPagoTransferencia, pedidoEstaCerrado, tieneArregloVerificado, tienePrecioConfirmado, tieneNombreValido, resetearPedidoActivo, marcarFotosDisponibles, hayFotosDisponiblesRecientes, totalExtrasPedido, extrasPedidoTexto, totalDashboardPedido, precioArregloTexto, MEDIA_POR_CLIENTE, apartadoSucursalListo
- Corregido import de `Intencion`: ahora desde `models/types` en vez de `decision.engine.ts`
- Corregido import de `EstadoPedido`: de `import type` a `import` regular (usado como valor)
- Exportada `esTextoReferenciaOCotizacion` desde `message-handler.ts` para uso en `bot.ts`
- `msgHandler.procesarMensaje(base, sock)` reemplaza llamada legacy `procesarMensaje(base)`
- Corregidos errores de compilación: `extraerTelefono` desde conversation.service.ts, `sock` como parámetro en `procesarMediaAcumulado`, `apartadoSucursalListo` añadido a MsgHandlerDeps

**Impacto:** `bot.ts` se reduce en ~658 líneas. El handler recibe `sock` por parámetro (se reasigna en reconexión). Compilación 100% exitosa.

**Rollback:** Revertir cambios en bot.ts + eliminar message-handler.ts.

---

## 2026-07-17

Versión: 2.1.2

### Fix — Retry Queue para EventBus (Telegram)

**Archivos modificados:**
- `src/events/event-bus.ts`
- `src/events/telegram.subscriber.ts`

**Cambios:**
- Agregado `executeWithRetry()` en EventBus con exponential backoff: 1s → 2s → 4s, max 3 retries
- Eliminados 24+ `.catch(() => {})` silenciosos en telegram.subscriber.ts — errores ahora llegan al bus para reintentar
- Agregado método `setRetryConfig()` para ajustar configuración en runtime
- Logs de warning en cada reintento, error después de agotar retries

**Impacto:** Los eventos fallidos (rate-limit de Telegram, error de red) ya no se pierden silenciosamente. El bus reintenta y solo loggea error si se agotan los 3 intentos.

**Rollback:** Restaurar event-bus.ts original + restaurar `.catch(() => {})` en telegram.subscriber.ts.

---

## 2026-07-17

### Fix — LLM ya no fija precios

**Archivos modificados:**
- `bot.ts`

**Cambios:**
- Eliminado bloque 1755-1765 que extraía `extraerPrecioRespuesta(mensajeFinal)` de la respuesta del LLM y lo aplicaba como `pedido.precioPersonalizado`
- Eliminada función `describirPedidoPersonalizado` (código muerto tras eliminar el bloque)
- El precio solo lo fija el equipo vía `procesarMensajeEquipo`; el LLM solo lee precios del contexto

**Impacto:** Compatible. Se cumple Principio 4 (LLM nunca inventar información) y Regla Absoluta (OpenAI solo escribe texto, backend decide). Riesgo de precios inventados por LLM eliminado.

**Rollback:** Restaurar bloque 1755-1765 + función describirPedidoPersonalizado.

---

## 2026-07-17

Versión: 2.1.0-paso10

### PASO 10 — Eliminar PEDIDO_EN_CURSO y ARREGLO_ELEGIDO (legacy Maps)

**Archivos modificados:**
- `bot.ts`

**Cambios:**
- Eliminado `PEDIDO_EN_CURSO` Map (7 refs) + `PedidoEnCurso` interface (~25 líneas)
- Simplificado `pedidoActual()` de 16 líneas a 1 línea: `obtenerPedido() ?? crearPedido()`
- Eliminado `ARREGLO_ELEGIDO` Map (17 refs, código muerto — nunca `.set()`) + `ArregloConFoto` interface
- Eliminados 15 fallbacks `?? ARREGLO_ELEGIDO.get(...)` → `pedido.arreglo`
- Eliminado `!ARREGLO_ELEGIDO.has(...)` → `!pedido.arreglo`
- Eliminado `syncLegacyToEngine` del import (ya no se usa en bot.ts)
- Eliminados PEDIDO_EN_CURSO.delete() y ARREGLO_ELEGIDO.delete() de reset functions

**Impacto:** Compatible. El Order Engine es la única fuente de verdad para pedidos en memoria. RIESGO ELIMINADO: ya no hay dos fuentes de verdad (causa raíz del caso Lizet).

**Rollback:** Restaurar `PEDIDO_EN_CURSO` y `ARREGLO_ELEGIDO` Maps + interfaces + `syncLegacyToEngine` + revertir `pedidoActual()`.

---

## 2026-07-17

Versión: 2.1.0-paso9

### PASO 9 — Eliminar VENTAS_CERRADAS

**Archivos modificados:**
- `bot.ts`

**Cambios:**
- Creada función `pedidoEstaCerrado(clienteId)` que consulta el estado del Order Engine
- Eliminada declaración `const VENTAS_CERRADAS = new Set<string>()`
- Reemplazadas 10 guardias `!VENTAS_CERRADAS.has(clienteId)` → `!pedidoEstaCerrado(clienteId)`
- Eliminados guardia y `add()` dentro de `ventaCerradaHandler`
- Eliminado `VENTAS_CERRADAS.delete(clienteId)` en `resetearPedidoCliente`
- Actualizado diagnóstico `GET /api/bot/diag/:chatId`
- Agregado `EstadoPedido` a imports desde `./src/models/types`

**Impacto:** Compatible. VENTAS_CERRADAS era redundante tras PASO 3 (cola por cliente) + PASO 8 (engine state via transitarDesdeFlujo).

**Rollback:** Revertir las 16 ediciones + restaurar declaración del Set.

---

## 2026-07-17

Versión: 2.1.0-paso8

### PASO 8 — transitarDesdeFlujo conectado a todos los puntos de estadoFlujo

**Archivos modificados:**
- `bot.ts`
- `src/pedidos/pedido.service.ts`

**Cambios:**
- Agregada llamada `transitarDesdeFlujo(clienteId, '...')` después de cada una de las 15 asignaciones de `estadoFlujo` en bot.ts
- Añadido `'esperando_precio_equipo'` → `EstadoPedido.COTIZANDO` al mapping de `transitarDesdeFlujo`

**Impacto:** Compatible — cada cambio de flujo ahora sincroniza automáticamente la máquina de estados del Order Engine.

**Rollback:** Revertir las 16 ediciones (15 en bot.ts + 1 en pedido.service.ts)

---

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

## 2026-07-28

### Fase 5 — Order Engine

**Objetivo:** Fortalecer la máquina de estados de pedidos, agregar historial de transiciones, validación de datos completos, y vinculación caso↔pedido.

**Archivos modificados:**

| Archivo | Cambio |
|---------|--------|
| `src/models/types.ts` | `PedidoActual`: agrega `casoId`, `transiciones`, refina tipos `metodoPago` y `precioConfirmadoPor` |
| `src/pedidos/pedido.service.ts` | Agrega `cambiarEstado()`, `obtenerHistorialTransiciones()`, `pedidoTieneDatosCompletos()`, `resetearPedido()`, `sincronizarConCaso()`. Refactoriza `transitar()` para usar `registrarTransicion()` y `emitirEventoTransicion()` |
| `src/pedidos/pedido.repository.ts` | Agrega `caso_id` a sincronización con `pedidos_bot` |
| `src/pedidos/index.ts` | Exporta nuevas funciones |
| `src/whatsapp/message-handler.ts` | `sincronizarPedidoConCaso` ahora vincula pedido ↔ caso. Pasa `casoId` al crear pedido |
| `src/orchestrator.ts` | Vincula pedido con caso activo al crearlo |

**Nuevas funciones:**

- `cambiarEstado(pedido, nuevoEstado, motivo?, usuario?)` — Transición con trazabilidad
- `obtenerHistorialTransiciones(pedido)` — Consultar historial
- `pedidoTieneDatosCompletos(pedido)` — Validar datos obligatorios
- `resetearPedido(clienteId)` — Limpiar sesión de pedido
- `sincronizarConCaso(pedido, casoId)` — Vincular pedido a caso

**Transiciones validadas:**

```
NUEVO → COTIZANDO → PRECIO_CONFIRMADO → ESPERANDO_DATOS → ESPERANDO_PAGO → APARTADO → EN_PRODUCCION → LISTO → ENTREGADO → ARCHIVADO
                                                                                                                    ↘ POSTVENTA → ARCHIVADO
Cualquier estado → CANCELADO, ARCHIVADO
```

**Regla:** Cada transición queda registrada en `pedido.transiciones[]` y emite evento `ORDER_UPDATED` + eventos específicos (PRICE_CONFIRMED, ORDER_READY, ORDER_DELIVERED, DELIVERY_COMPLETED, CANCELACION_REQUESTED).

**Impacto:** Compatible con pedidos existentes en caché (campos opcionales).
**Rollback:** Sí.

## 2026-07-28

### Fase 6 — Decision Engine

**Objetivo:** Centralizar en el Decision Engine toda la lógica de detección que antes estaba duplicada en `message-handler.ts` y `intent-detector.ts`.

**Archivos modificados:**

| Archivo | Cambio |
|---------|--------|
| `src/decision/decision.engine.ts` | Expande `Decision` con 10 nuevos campos. Agrega 12 detectores: `detectarFrustracion`, `detectarAtencionHumana`, `esSolicitudFotosDisponibles`, `clienteEligeFotoDisponible`, `detectarConfirmacionCorta`, `detectarEmpezarCero`, `esTextoComprobante`, `respuestaPideComprobante`, `detectarWebPedido`, `detectarEvento`, `detectarInteresCompra`, `detectarIntencionCatalogo` |
| `src/decision/intent-detector.ts` | Simplificado: re-exporta `detectarEvento` y `detectarInteresCompra` desde `decision.engine.ts`. Mantiene `detectarCancelacion` y `detectarQueja` para retrocompatibilidad |
| `src/decision/index.ts` | Exporta todas las nuevas funciones detectoras |
| `src/whatsapp/message-handler.ts` | Elimina 8 funciones locales duplicadas (170+ líneas). Ahora importa detectores desde el Decision Engine. `detectarIntencion` simplificado usa `decision.intencionCatalogo` |

**Decision Interface expandida:**

| Campo nuevo | Propósito |
|---|---|
| `esFrustracion` | Cliente frustrado |
| `razonHumano` | Razón específica de atención humana |
| `esConfirmacionCorta` | "ok", "va", "dale", "sí" |
| `esEmpezarCero` | "empecemos desde cero", "nuevo pedido" |
| `solicitaFotos` | Pide fotos disponibles |
| `seleccionoFoto` | Eligió una foto disponible |
| `requiereComprobante` | Sistema espera comprobante |
| `pideComprobante` | Respuesta del LLM pide comprobante |
| `esWebPedido` | Pedido desde cotizador web |
| `eventoDetectado` | "boda", "funeral", "aniversario", etc. |
| `tieneInteresCompra` | "necesito", "busco", "quiero un" |
| `intencionCatalogo` | 'catalogo' \| 'cotizador' \| 'normal' |

**Líneas eliminadas de message-handler.ts:** ~170 (8 funciones completas + reducción de `detectarIntencion`).

**Impacto:** Compatible. Todas las funciones antiguas siguen exportadas desde `intent-detector.ts` sin cambiar su firma.
**Rollback:** Sí.

## 2026-07-28

### Fase 7 — Prompt Builder

**Objetivo:** Modularizar el Prompt Builder en secciones separadas, inyectar reglas de negocio validadas desde TypeScript (no desde el prompt), y preparar el camino para reducir el system prompt almacenado en Supabase.

**Archivos modificados:**

| Archivo | Cambio |
|---------|--------|
| `src/openai/prompt.builder.ts` | Rediseño completo: 4 secciones modulares (`buildPersonalitySection`, `buildValidatedRulesSection`, `construirContextoPrompt`, `construirPromptCompleto`). Agrega `buildMinimalSystemPrompt` como reemplazo opcional del FALLBACK_SYSTEM_PROMPT |
| `src/openai/index.ts` | Exporta las 3 nuevas funciones |
| `src/whatsapp/message-handler.ts` | Inyecta `buildValidatedRulesSection()` justo antes de llamar al LLM |
| `src/orchestrator.ts` | Inyecta `buildValidatedRulesSection()` en `contextoPrompt` |

**Nuevas funciones:**

| Función | Propósito |
|---|---|
| `buildPersonalitySection()` | Solo tono y estilo de Flora. Sin reglas de negocio |
| `buildValidatedRulesSection()` | Horarios, pagos, sucursales, precios de flores — todos desde validadores TypeScript |
| `buildMinimalSystemPrompt()` | Prompt completo mínimo (personalidad + referencia a reglas validadas) |

**Comparativa: Antes vs Ahora**

| Aspecto | ❌ Antes | ✅ Ahora |
|---|---|---|
| **Estructura del prompt** | Monolítico ~280 líneas en `lib/ai.ts` + `contextoExtra` pegado como string | 4 secciones modulares separadas por responsabilidad |
| **Reglas de negocio** | Hardcodeadas en FALLBACK_SYSTEM_PROMPT (horarios, pagos, sucursales, precios de flores, URLs) | Inyectadas dinámicamente desde `horario.validator.ts`, `pago.validator.ts`, etc. |
| **Horarios** | Texto fijo: "Lun-Vie 10:00-19:00, Sáb-Dom 10:00-17:00" | Calculado por backend: `[REGLAS VALIDADAS POR EL BACKEND]` con día actual y mañana |
| **Cuenta bancaria** | Texto fijo en el prompt | `obtenerTextoCuenta()` desde `pago.validator.ts` |
| **Extensibilidad** | Agregar una regla = editar el prompt en Supabase + fallback | Agregar una regla = editar `buildValidatedRulesSection()` o el validador correspondiente |
| **System prompt en Supabase** | Puede editarse manualmente, difícil de mantener sincronizado | Puede reducirse progresivamente. `buildMinimalSystemPrompt()` como reemplazo opcional |

**Impacto:** Compatible. El system prompt existente en Supabase sigue funcionando. `construirPromptCompleto` mantiene firma idéntica. Las nuevas funciones son aditivas.
**Rollback:** Sí.

## 2026-07-28

### Fase 8 — Event Engine

**Objetivo:** Cerrar la brecha entre eventos emitidos y suscritos. Garantizar que toda acción importante del sistema genere un evento y que ningún evento suscrito quede sin emisión.

**Problema detectado:** De 27 `EventType` definidos, `PAYMENT_RECEIVED` estaba suscrito en `telegram.subscriber.ts` pero NUNCA era emitido desde ningún lugar del código.

**Archivos modificados:**

| Archivo | Cambio |
|---------|--------|
| `src/pedidos/pedido.service.ts` | `crearPedido()` ahora emite `ORDER_CREATED`. `emitirEventoTransicion()` ahora emite `PAYMENT_PENDING` al entrar a `ESPERANDO_PAGO` y `PAYMENT_RECEIVED` al entrar a `APARTADO` |
| `src/whatsapp/message-handler.ts` | Agrega `CUSTOMER_WAITING` donde faltaba: al pedir fotos, al solicitar cotización, al mostrar interés de compra |

**Eventos antes/después:**

| EventType | Antes | Ahora |
|---|---|---|
| `ORDER_CREATED` | Solo desde bot.ts (web) y message-handler.ts (comprobante incompleto) | ✅ También desde `pedido.service.ts` cada vez que `crearPedido()` es llamado |
| `PAYMENT_PENDING` | Solo desde bot.ts (código legacy) | ✅ Desde `emitirEventoTransicion()` al entrar a `ESPERANDO_PAGO` |
| `PAYMENT_RECEIVED` | ❌ **NUNCA emitido** (suscrito en Telegram pero sin efecto) | ✅ Desde `emitirEventoTransicion()` al entrar a `APARTADO` |
| `CUSTOMER_WAITING` | Solo al frustrarse | ✅ También al pedir fotos, al solicitar cotización, al mostrar interés de compra |

**EventType audit completo:**

```
EventType                     │ Emitido │ Suscrito │ Estado
──────────────────────────────┼─────────┼──────────┼───────
CASE_CREATED                  │ ✅      │ ✅       │ ok
CASE_ARCHIVED                 │ ✅      │ ✅       │ ok
ORDER_CREATED                 │ ✅+NUEVO│ ✅       │ ok (nuevo desde engine)
ORDER_UPDATED                 │ ✅      │ ✅       │ ok
ORDER_READY                   │ ✅      │ ✅       │ ok
ORDER_DELIVERED               │ ✅      │ ✅       │ ok
PAYMENT_PENDING               │ ✅+NUEVO│ ✅       │ ok (nuevo desde engine)
PAYMENT_RECEIVED              │ ✅NUEVO │ ✅       │ ✅ CORREGIDO
PAYMENT_CONFIRMED             │ ✅      │ ✅       │ ok
HUMAN_REQUIRED                │ ✅      │ ✅       │ ok
CUSTOMER_ANGRY                │ ✅      │ ✅       │ ok
CUSTOMER_WAITING              │ ✅+     │ ✅       │ ✅ ampliado
PHOTO_REQUESTED               │ ✅      │ ✅       │ ok
PHOTO_RECEIVED                │ ✅      │ ✅       │ ok
PHOTO_SENT                    │ ✅      │ ✅       │ ok
PRICE_CONFIRMED               │ ✅      │ ✅       │ ok
DELIVERY_COMPLETED            │ ✅      │ ✅       │ ok
COTIZACION_REQUESTED          │ ✅      │ ✅       │ ok
ENVIO_REQUESTED               │ ✅      │ ✅       │ ok
ZONA_AMBIGUA                  │ ✅      │ ✅       │ ok
CANCELACION_REQUESTED         │ ✅      │ ✅       │ ok
QR_GENERATED / BOT_* / PROVIDER │ ✅    │ ✅       │ ok
```

**Impacto:** Compatible. No se rompen suscripciones existentes. Las nuevas emisiones usan payloads que ya estaban definidos en los suscriptores.
**Rollback:** Sí.
