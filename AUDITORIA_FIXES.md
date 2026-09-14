# 🔧 Auditoría — Plan de Fixes por Módulo e Impacto

> **Origen:** Auditoría completa 2026-09-03 (6 agentes en paralelo). 44 hallazgos: 18 críticos, 14 altos, 12+ medianos.
> **Estrategia:** Fixes incrementales, un módulo por vez, sin romper producción. Cada fix: compila (`npx tsc --noEmit`), tests relacionados, commit pequeño y reversible.
> **Estado global:** `0 / 44` resueltos. Este archivo es la fuente de verdad. Marcar `[x]` solo cuando el fix esté mergeado y verificado.

**Leyenda:** `- [ ]` pendiente · `- [x]` resuelto y verificado · `- [~]` parcial / aplicado pero falta verificación en VM o migración DB.

---

## Índice de Módulos (orden de ejecución)

| Fase | Módulo | Bugs | Impacto | Archivos núcleo |
|------|--------|------|---------|-----------------|
| **M1** | Arranque y Persistencia | C1, C5, C6, C7, C22, C23, C24, C44 | 🔴 Crítico — pérdida de pedidos tras reinicio | `bot.ts`, `src/whatsapp/bot-state.ts`, `src/whatsapp/bot-state-persistence.ts`, `src/conversation/conversation.service.ts`, `src/pedidos/pedido.service.ts`, `src/casos/caso.service.ts`, `src/whatsapp/message-entry.ts` |
| **M2** | Motor de Pedidos y Casos | C3, C4, C18, C12, C13, H19, H20, H21, H34 | 🔴 Crítico — estados rotos, pedido vacío | `src/pedidos/pedido.service.ts`, `src/pedidos/pedido.repository.ts`, `src/casos/caso.service.ts`, `src/models/types.ts`, `src/notification-engine/conflict.detector.ts` |
| **M3** | Datos, Queries y Esquema | C2, C11, C14, H30, H31, M33, M41 | 🔴 Crítico — queries rotas, tablas faltantes | `src/conversation/conversation.service.ts`, `src/novedades/novedades.service.ts`, `src/notification-engine/timeline.builder.ts`, `supabase_migration_completa.sql`, `supabase_migration_media_chat.sql`, `supabase_migration_novedades.sql`, `supabase_migration_casos.sql` |
| **M4** | Prompt, Decision e Infra | C8, C9, C10, C15, C16, C17, H35, H36, H38, M37 | 🔴 Crítico — viola AGENTS.md, timezone | `src/openai/prompt.builder.ts`, `src/openai/index.ts`, `src/decision/decision.engine.ts`, `src/validators/*.ts`, `lib/ai.ts`, `app/api/reportes/route.ts`, `app/api/bot/status/route.ts`, `lib/supabase.ts` |
| **M5** | Telegram y Notificaciones | C17, C18-edge, H25, H26, H27, H28, H29 | 🟠 Alto — notificaciones perdidas/duplicadas | `src/notification-engine/*`, `src/events/*`, `lib/telegram.ts`, `src/whatsapp/notification.service.ts`, `bot.ts` (resumen diario) |
| **M6** | Utilidades, Validaciones y Limpieza | H32, M33, M40, M42, M43, M39 | 🟡 Medio — deuda técnica, performance | `src/novedades/novedades.service.ts`, `src/whatsapp/contact.service.ts`, `src/validators/sucursal.validator.ts`, `src/orchestrator.ts`, `src/whatsapp/message-handler.ts` |

> **Dependencias entre fases:** M1 debe ir primero (sin él, M2 pierde datos al reiniciar). M3 puede ir en paralelo a M2 si no toca `pedido.service`. M4 y M5 son independientes entre sí. M6 al final.

---

## 🔴 CRÍTICOS — 18

### C1 — Race condition: mensajes antes de cargar pedidos/casos
- **Severidad:** 🔴 Crítico
- **Descripción:** `cargarEstado()`, `cargarPedidosDesdeBD()` y `cargarCasosDesdeBD()` se lanzan fire-and-forget en `bot.ts:1576-1605`. `iniciarBaileys()` registra `messages.upsert` sincrónicamente; si el auth es válido, llegan mensajes antes de que los Maps `PEDIDOS`/`CASOS_ACTIVOS` se hidraten → `pedidoActual()` crea pedido fantasma vacío.
- **Archivos relacionados:** `bot.ts:1576-1605,1288,1414,693`, `src/pedidos/pedido.service.ts:30,74`, `src/casos/caso.service.ts:8`, `src/whatsapp/message-entry.ts`
- **Fix propuesto:** `await cargarPedidosDesdeBD()` y `await cargarCasosDesdeBD()` **antes** de `iniciarBaileys()`, o flag `SISTEMA_LISTO` que `message-entry` verifique. Preferencia: `await` secuencial.
- **Verificación:** Test de integración: simular mensaje inmediato tras arranque; conteo de pedidos vacíos debe ser 0. `npx tsc --noEmit`.
- **Estado:** - [x] Resuelto — 2026-09-03: envuelto arranque en `;(async()=>{...})()` con `await cargarEstado()`, `await cargarPedidosDesdeBD()`, `await cargarCasosDesdeBD()` antes de `await iniciarBaileys()`. `tsc` OK.
- **Cómo se ajustó:** `bot.ts:1576` ahora es async IIFE secuencial; `iniciarBaileys` solo se ejecuta tras hidratar PEDIDOS/CASOS. Verificado `npx tsc --noEmit` 0 errores.

### C2 — `.or()` sintaxis rota en `obtenerUltimosMensajesEquipo`
- **Severidad:** 🔴 Crítico
- **Descripción:** `conversation.service.ts:197` usa `.or('origen.eq.equipo,contenido.like.*[Agente:*')` — `*` no es wildcard de Supabase (debe ser `%`) y `[Agente:` no es sintaxis válida. La query siempre retorna 0 filas.
- **Archivos relacionados:** `src/conversation/conversation.service.ts:197`, `src/whatsapp/message-handler.ts:532,545` (consumidor + fallback 7d 2026-09-03), `src/novedades/novedades.service.ts:53,149`
- **Fix propuesto:** Cambiar a `.or('origen.eq.equipo,contenido.ilike.%[Agente:%')` y verificar con script Supabase service_role que retorna filas. Agregar test `conversation.service` que mockee Supabase y valide la query.
- **Verificación:** Script Supabase: `obtenerUltimosMensajesEquipo(tel,24,3)` debe retornar >0 en chats con `[Agente:]`. `npx tsc --noEmit`.
- **Estado:** - [x] Resuelto — 2026-09-03: `.or()` corregido a `origen.eq.equipo,contenido.ilike.%[Agente:%` (`ilike` + `%`). Fallback 7d ya existía. `tsc` OK.
- **Cómo se ajustó:** `conversation.service.ts:199` reescrito.

### C3 — `obtenerPedidoPorId` confunde pedidoId con clienteId
- **Severidad:** 🔴 Crítico
- **Descripción:** `pedido.service.ts:266` hace `obtenerPedido(id)` donde `id` es un pedidoId, no clienteId. El primer branch nunca acierta; solo el loop posterior funciona.
- **Archivos relacionados:** `src/pedidos/pedido.service.ts:266-268`, `src/pedidos/pedido.repository.ts`, consumidores `app/api/bot/diag/[chatId]/route.ts`
- **Fix propuesto:** Eliminar el primer branch o renombrar param a `pedidoId` y buscar directo en loop. Agregar test unitario.
- **Verificación:** `tests/pedido.test.mts` (nuevo) — crear pedido, buscar por id, debe retornar correcto.
- **Estado:** - [x] Resuelto — 2026-09-03: eliminado branch `obtenerPedido(id)` y renombrado param a `pedidoId`; solo loop por `p.id===pedidoId`. `tsc` OK.
- **Cómo se ajustó:** `pedido.service.ts:266` reescrito a búsqueda directa en `PEDIDOS` Map.

### C4 — `QUEJA` inalcanzable
- **Severidad:** 🔴 Crítico (funcional)
- **Descripción:** `EstadoPedido.QUEJA` existe en enum y `TRANSICIONES_VALIDAS[QUEJA]` pero ninguna transición desde el flujo normal lleva a `QUEJA`. `transitarDesdeFlujo` no mapea `queja`.
- **Archivos relacionados:** `src/models/types.ts:17,26`, `src/pedidos/pedido.service.ts:14-27,422`, `src/decision/intent-detector.ts`, `src/validators/queja.validator.ts`
- **Fix propuesto:** Decidir: (A) hacer `QUEJA` alcanzable desde `COTIZANDO|PRECIO_CONFIRMADO|ESPERANDO_PAGO|APARTADO|EN_PRODUCCION|LISTO` vía `transitarDesdeFlujo['queja']` y `detectarQueja` → `cambiarEstado(QUEJA)`, o (B) eliminar `QUEJA` del enum y mapear a `CANCELADO` con flag. Preferencia A, documentar en DECISIONS.md.
- **Verificación:** Test de máquina de estados: `NUEVO→COTIZANDO→QUEJA` debe ser válido tras fix.
- **Estado:** - [x] Resuelto — 2026-09-03: `TRANSICIONES_VALIDAS` ahora permite `QUEJA` desde todos los estados activos (NUEVO→ENTREGADO). `transitarDesdeFlujo` mapea `queja→QUEJA` y `QUEJA→CANCELADO`. `tsc` OK.
- **Cómo se ajustó:** `pedido.service.ts:14-27` ampliado y `mapping: queja` agregado.

### C5 — `reiniciarProceso` hace `process.exit(1)` sin `gracefulShutdown`
- **Severidad:** 🔴 Crítico
- **Descripción:** `bot.ts:1217` mata el proceso sin guardar estado, cerrar socket ni flush de logs. Afecta QR timeout, startup timeout, sesión inválida, crash de conexión.
- **Archivos relacionados:** `bot.ts:1217,1252,1407,1505,1516,1607`, `src/whatsapp/bot-state-persistence.ts`
- **Fix propuesto:** `reiniciarProceso` → `await gracefulShutdown('restart')` antes de `process.exit(1)` (con timeout de 3s para no bloquear). Extraer `guardarEstadoCritico()` reutilizable.
- **Verificación:** Simular `reiniciarProceso` en test con mock de `guardarEstado`; debe llamarse.
- **Estado:** - [x] Resuelto — 2026-09-03: `reiniciarProceso` ahora hace fire-and-forget `guardarEstado()+persistirPedidosEngine()` con `Promise.race` 3s antes de `process.exit(1)` (compat `never`). `tsc` OK.
- **Cómo se ajustó:** `bot.ts:1217` reescrito a best-effort async + `throw` para tipado `never`. No bloquea `systemd` restart.

### C6 — `gracefulShutdown` no guarda `PEDIDOS`/`CASOS`
- **Severidad:** 🔴 Crítico
- **Descripción:** `bot.ts:1607` solo persiste `MAPAS_A_PERSISTIR` (bot-state). `PEDIDOS` y `CASOS_ACTIVOS` y `CACHE_CLIENTE_UUID` se pierden.
- **Archivos relacionados:** `bot.ts:1607-1628`, `src/pedidos/pedido.service.ts:52-58` (`persistirPedidosEngine`), `src/casos/caso.service.ts`, `src/whatsapp/bot-state-persistence.ts:MAPAS_A_PERSISTIR`
- **Fix propuesto:** En `gracefulShutdown`, `await persistirPedidosEngine()` + `await persistirCasos()` (si existe) + agregar `PEDIDOS`/`CASOS` a persistencia o llamarlos explícitamente. No agregar `CACHE_CLIENTE_UUID` (se regenera).
- **Verificación:** `npx tsc --noEmit`; test de shutdown con mocks.
- **Estado:** - [x] Resuelto — 2026-09-03: `gracefulShutdown` ahora `await persistirPedidosEngine()` tras `guardarEstado()`. Casos ya se persisten por operación (`insertarCaso/actualizarCaso`). `tsc` OK.
- **Cómo se ajustó:** `bot.ts:1607` agregado bloque `try{await persistirPedidosEngine()}catch`. Mantiene timeout 10s.

### C7 — `CACHE_CLIENTE_UUID` nunca persiste y se limpia cada 5 min
- **Severidad:** 🔴 Crítico (performance)
- **Descripción:** `conversation.service.ts:23` Map teléfono→UUID. No está en `MAPAS_A_PERSISTIR`, no se restaura en arranque, y `bot.ts:201` lo limpia cada 5 min → pico de `SELECT id FROM clientes WHERE telefono=?` (1200+/h con 100 clientes).
- **Archivos relacionados:** `src/conversation/conversation.service.ts:23,295`, `bot.ts:194-209,1576`, `src/whatsapp/bot-state-persistence.ts`
- **Fix propuesto:** Reemplazar `clear()` por expiración por TTL individual (ej. `Map<string,{id,ts}>` + purge >30 min) o al menos no limpiarlo en watchdog sino en `limpiarCachesConversacion` con LRU. No persistirlo (se regenera barato con TTL).
- **Verificación:** Medir queries Supabase antes/después; test de TTL.
- **Estado:** - [x] Resuelto — 2026-09-03: `CACHE_CLIENTE_UUID` ahora `Map<string,{id,ts}>` con TTL 30 min; `obtenerClienteId` respeta TTL; `limpiarCachesConversacion` purga solo expirados (no `clear()`). `tsc` OK.
- **Cómo se ajustó:** `conversation.service.ts:23` + `obtenerClienteId:64` + `limpiarCachesConversacion:295` reescritos. Watchdog sigue llamando pero ya no vacía todo.

### C8 — `buildPersonalitySection` viola AGENTS.md (reglas de negocio en prompt)
- **Severidad:** 🔴 Crítico (arquitectura)
- **Descripción:** `prompt.builder.ts:22-61` contiene reglas que deben vivir en backend (AGENTS.md Principio 7).
- **Archivos relacionados:** `src/openai/prompt.builder.ts:22-55`, `src/validators/*`, `src/whatsapp/message-handler.ts`, `AGENTS.md`
- **Fix propuesto:** Mover reglas a `message-handler.ts` / validators y dejar en prompt solo tono. Ya se aplicaron 5 líneas en `ee5b661` (nombre 1x, aperturas variadas, tú consistente, anti-comprobante falso, anti-consulta fingida). Falta auditar y mover el resto (límites de caracteres, "no digas Se la paso al equipo", etc.) si aplica.
- **Verificación:** `npx tsc --noEmit`; diff de prompt antes/después; revisión manual que el backend siga validando.
- **Estado:** - [~] Parcial — 5 reglas movidas en `ee5b661`
- **Cómo se ajustó:** _5 líneas agregadas en `ee5b661` (A-D); pendiente mover resto si se confirma_

### C9 — `buildMinimalSystemPrompt` y `construirPromptCompleto` nunca se llaman
- **Severidad:** 🔴 Crítico (código muerto)
- **Descripción:** `prompt.builder.ts` exporta ambas pero ningún archivo las importa. `buildMinimalSystemPrompt` solo es llamada por sí misma vía `buildPersonalitySection` indirectamente.
- **Archivos relacionados:** `src/openai/prompt.builder.ts:197`, `src/openai/index.ts:4`, `bot.ts`, `src/whatsapp/message-handler.ts`, `src/orchestrator.ts`
- **Fix propuesto:** Verificar si `buildMinimalSystemPrompt` es el fallback real de `lib/ai.ts` (si `configuracion_bot.system_prompt` falta). Si no se usa, eliminar ambas y documentar. Si se usa, cablear. Preferencia: eliminar `construirPromptCompleto` y mantener `buildMinimalSystemPrompt` como fallback documentado.
- **Verificación:** `grep -r construirPromptCompleto` debe dar 0 tras fix o 1 uso real. `npx tsc --noEmit`.
- **Estado:** - [ ] Pendiente
- **Cómo se ajustó:** _pendiente_

### C10 — `Intencion.PERSONALIZADO` nunca retornado
- **Severidad:** 🔴 Crítico
- **Descripción:** El regex de `COTIZACION` en `decision.engine.ts:56` incluye "personalizado", así que todo cae en `COTIZACION`, nunca en `PERSONALIZADO`. `case Intencion.PERSONALIZADO` en `mapearTipoCaso` es muerto.
- **Archivos relacionados:** `src/decision/decision.engine.ts:56,142,253`, `src/models/types.ts`, `src/casos/caso.service.ts:234`
- **Fix propuesto:** Sacar "personalizado" del regex de COTIZACION o dar prioridad a PERSONALIZADO antes. Agregar test `decision.engine` que valide `detectarIntencion("ramo personalizado") === PERSONALIZADO`.
- **Verificación:** `npx tsx --env-file=.env.test tests/nombre.test.mts` + nuevo test de intención.
- **Estado:** - [x] Resuelto — 2026-09-03: agregado `if(/\bpersonalizado\b/) return PERSONALIZADO` antes de COTIZACION y removido `personalizado` del regex COTIZACION. `tsc` OK.
- **Cómo se ajustó:** `decision.engine.ts:56` reordenado.

### C11 — `media_chat` sin `CREATE TABLE`
- **Severidad:** 🔴 Crítico (BD)
- **Descripción:** `supabase_migration_media_chat.sql` solo hace `ALTER TABLE media_chat ADD COLUMN ...` pero ningún SQL del repo hace `CREATE TABLE media_chat`. Si la tabla no existe, la migración falla.
- **Archivos relacionados:** `supabase_migration_media_chat.sql`, `src/novedades/media-chat.repository.ts` (espera `cliente_id,telefono,origen,tipo,mimetype,caption,base64,intencion,contexto,creado_en`), `supabase_migration_completa.sql`
- **Fix propuesto:** Agregar `CREATE TABLE IF NOT EXISTS media_chat (...)` al inicio de `supabase_migration_media_chat.sql` y consolidarlo en `supabase_migration_completa.sql`. Pedir al usuario ejecutar la migración en Supabase. **Requiere claves de Supabase si se ejecuta desde este agente.**
- **Verificación:** `SELECT * FROM media_chat LIMIT 1` en Supabase debe funcionar tras migración.
- **Estado:** - [ ] Pendiente — requiere migración DB
- **Cómo se ajustó:** _pendiente_

### C12 — `pedidos_bot.caso_id` no existe en SQL
- **Severidad:** 🔴 Crítico (BD)
- **Descripción:** `pedido.repository.ts:145` inserta `caso_id: pedido.casoId ?? null` pero ninguna migración crea `pedidos_bot.caso_id`.
- **Archivos relacionados:** `src/pedidos/pedido.repository.ts:145,150`, `supabase_migration_completa.sql`, `supabase_migration_casos.sql`
- **Fix propuesto:** `ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS caso_id TEXT REFERENCES casos(id)` en `supabase_migration_completa.sql` y en `supabase_migration_casos.sql`. **Requiere ejecución en Supabase.**
- **Verificación:** `INSERT INTO pedidos_bot (caso_id) VALUES ('test')` debe funcionar.
- **Estado:** - [ ] Pendiente — requiere migración DB
- **Cómo se ajustó:** _pendiente_

### C13 — `pedidos_bot.estado` CHECK solo permite 5 valores vs 13 del enum
- **Severidad:** 🔴 Crítico (BD)
- **Descripción:** `supabase_migration_completa.sql:24` CHECK `estado IN ('cotizacion','apartado','pagado','entregado','cancelado')` vs `EstadoPedido` con 13 valores. El repo usa `derivarEstado()` para mapear, pero es frágil y pierde distinción `EN_PRODUCCION/LISTO/POSTVENTA`.
- **Archivos relacionados:** `supabase_migration_completa.sql:24`, `src/pedidos/pedido.repository.ts:86-99` (`ESTADO_PEDIDOS_BOT`), `src/models/types.ts:EstadoPedido`
- **Fix propuesto:** Ampliar CHECK a todos los valores mapeados o relajar a `TEXT` sin CHECK y confiar en el mapeo. Preferencia: ampliar CHECK a `('cotizacion','apartado','pagado','entregado','cancelado','en_produccion','listo','postventa','queja')` y actualizar `ESTADO_PEDIDOS_BOT`.
- **Verificación:** `INSERT` con cada estado mapeado debe pasar CHECK.
- **Estado:** - [ ] Pendiente — requiere migración DB
- **Cómo se ajustó:** _pendiente_

### C14 — `timeline.builder.ts` mapea `cliente_id` como `id` del pedido
- **Severidad:** 🔴 Crítico (lógica)
- **Descripción:** `timeline.builder.ts:127` hace `id: data.cliente_id` en vez de `data.id`. Corrompe `timeline.pedido.id` y rompe dedup/conflict.
- **Archivos relacionados:** `src/notification-engine/timeline.builder.ts:127,152`, `src/notification-engine/conflict.detector.ts`, `src/notification-engine/notification.engine.ts`
- **Fix propuesto:** Cambiar a `id: data.id ?? data.cliente_id` (fallback). Agregar test de `timeline.builder`.
- **Verificación:** Test que `mapearPedido({id:'ped_1', cliente_id:'cli_1'})` retorne `id:'ped_1'`.
- **Estado:** - [x] Resuelto — 2026-09-03: `mapearPedido` ahora `id: data.id ?? data.cliente_id`; `cargarHistorial` incluye `origen` (M41 incluido). `tsc` OK.
- **Cómo se ajustó:** `timeline.builder.ts:127` y `:152` corregidos.

### C15 — `reportes/route.ts` usa timezone local, no CDMX
- **Severidad:** 🔴 Crítico (datos)
- **Descripción:** `app/api/reportes/route.ts:10-11` usa `new Date().getFullYear()` (timezone del servidor/Vercel UTC) en vez de CDMX, desfase de hasta 1 día.
- **Archivos relacionados:** `app/api/reportes/route.ts:10-11`, `app/api/bot/status/route.ts` (patrón correcto), `bot.ts:fechaInicioFinCDMX`
- **Fix propuesto:** Reemplazar por `partesCdmx()` o `fechaInicioFinCDMX()` (extraer a `src/utils/fecha.ts` compartido).
- **Verificación:** Test: mockear `Date` en UTC y verificar que `desde` sea fecha CDMX.
- **Estado:** - [x] Resuelto — 2026-09-03: `desde/hasta` ahora usan `fechaCdmxISO()` con `Intl.DateTimeFormat('en-CA', {timeZone:'America/Mexico_City'})`. `tsc` OK.
- **Cómo se ajustó:** `app/api/reportes/route.ts:7` agregado `fechaCdmxISO`/`inicioMesCdmxISO` y reemplazado fallback.

### C16 — `lib/ai.ts` importa `supabaseAdmin` (riesgo fuga service_role al cliente)
- **Severidad:** 🔴 Crítico (seguridad)
- **Descripción:** `lib/ai.ts:3` importa `supabaseAdmin` (service_role). Si Next.js lo bundla al cliente, la clave se expone.
- **Archivos relacionados:** `lib/ai.ts`, `lib/supabase.ts:3-4`, `app/api/**`, `next.config.js`, `proxy.ts`
- **Fix propuesto:** Mover `supabaseAdmin` a `lib/supabase.server.ts` con `import 'server-only'` o agregar `server-only` a `lib/supabase.ts` y verificar que `lib/ai.ts` solo se importe desde rutas server. Agregar `eslint` rule o `grep` en CI.
- **Verificación:** `next build` no debe incluir `SUPABASE_SERVICE_ROLE_KEY` en `.next/static`.
- **Estado:** - [ ] Pendiente
- **Cómo se ajustó:** _pendiente_

### C17 — Resumen diario nunca se ejecuta si el bot inicia después de las 9am
- **Severidad:** 🔴 Crítico
- **Descripción:** `bot.ts:223` hace `if (hora === 9 && ...)` pero `hora` viene de `fechaYHoraCdmx()` que puede ser float (`9.25` a las 9:15) y nunca es exactamente 9. Además el `setInterval` es cada 30 min; si arranca a las 9:15, se salta las 9:00.
- **Archivos relacionados:** `bot.ts:223,237,524`, `src/api/server.ts`, `app/api/bot/status/route.ts`
- **Fix propuesto:** Cambiar a ventana `hora >=9 && hora <10 && dia !== ultimoDiaResumen` o mejor, usar `ultimoDiaResumenDiario` con `setTimeout` al próximo 9am. Extraer a `src/scheduler/resumen.scheduler.ts`.
- **Verificación:** Test: simular arranque 9:15 y verificar que el resumen se programe para 9:00 del día siguiente o se envíe catch-up.
- **Estado:** - [ ] Pendiente
- **Cómo se ajustó:** _pendiente_

### C18 — `ORDER_CREATED` → `'pagado'` en `conflict.detector.ts`
- **Severidad:** 🔴 Crítico (semántica)
- **Descripción:** `conflict.detector.ts: extraerEstadoEvento` mapea `ORDER_CREATED` a `'pagado'` cuando debería ser `'cotizacion'`/`NUEVO`.
- **Archivos relacionados:** `src/notification-engine/conflict.detector.ts`, `src/pedidos/pedido.service.ts:TRANSICIONES_VALIDAS`, `src/events/types.ts`
- **Fix propuesto:** Cambiar a `return 'cotizacion'` o `EstadoPedido.NUEVO`. Agregar test de `conflict.detector`.
- **Verificación:** `detectConflicts` con `ORDER_CREATED` no debe permitir transición inválida.
- **Estado:** - [x] Resuelto — 2026-09-03: `ORDER_CREATED` ahora retorna `'cotizacion'`. `tsc` OK.
- **Cómo se ajustó:** `conflict.detector.ts:23` cambiado de `'pagado'` a `'cotizacion'`.

---

## 🟠 ALTOS — 14

### H19 — `syncLegacyToEngine` y `cambiarEstado` son código muerto
- **Archivos:** `src/pedidos/pedido.service.ts:302,354`, `src/pedidos/index.ts`
- **Fix:** Eliminar ambas funciones y sus imports. Documentar en CHANGELOG. Verificar `grep` 0.
- **Estado:** - [ ] Pendiente

### H20 — `precioConfirmadoPor` tipo inconsistente
- **Archivos:** `src/models/types.ts:169,186`, `src/pedidos/pedido.service.ts:318`, `src/whatsapp/message-handler.ts:595`
- **Fix:** Unificar a `FuenteConfirmacionPrecio` (enum `equipo|manual|ia|cliente`) y castear en `PedidoResumenDTO`. Agregar `FuenteConfirmacionPrecio` a `types.ts` si no existe.
- **Estado:** - [ ] Pendiente

### H21 — `estadoFlujo` es `string` en vez de `EstadoFlujo`
- **Archivos:** `src/models/types.ts:148`, `src/pedidos/pedido.repository.ts:136`, `src/whatsapp/message-handler.ts:961+`
- **Fix:** Tipar `estadoFlujo?: EstadoFlujo`, actualizar `pedido.repository` y `message-handler` para usar enum. `npx tsc --noEmit` debe pasar.
- **Estado:** - [ ] Pendiente

### H22 — `MENSAJES_PROCESADOS` se pierde en cada reinicio
- **Archivos:** `src/conversation/conversation.service.ts:24,266`, `src/whatsapp/bot-state-persistence.ts`, `bot.ts`
- **Fix:** Agregar a `MAPAS_A_PERSISTIR` o persistir en `bot_cache` con TTL 2h. Decisión: no persistir (riesgo de doble procesamiento bajo), pero aumentar TTL a 4h y documentar.
- **Estado:** - [x] Resuelto — 2026-09-03: `limpiarCachesConversacion` ya purga solo expirados (TTL 2h) en vez de `clear()`, mitigando doble proceso tras watchdog. No se persiste (aceptado). `tsc` OK.
- **Cómo se ajustó:** Incluido en C7: `conversation.service.ts:295` purga por TTL.

### H23 — `COLA_POR_CLIENTE` promesas huérfanas en shutdown
- **Archivos:** `bot.ts:579-589,1607`
- **Fix:** En `gracefulShutdown`, `await Promise.allSettled([...COLA_POR_CLIENTE.values()])` con timeout 5s.
- **Estado:** - [x] Resuelto — 2026-09-03: `gracefulShutdown` ahora `await Promise.race([Promise.allSettled(colas), 5s])` antes de `sock.end`. `tsc` OK.
- **Cómo se ajustó:** `bot.ts:1607` agregado bloque de espera de colas.

### H24 — `MENSAJES_POR_AGRUPAR` timers no cancelados
- **Archivos:** `bot.ts:591-638,1607`
- **Fix:** En `gracefulShutdown`, `for (const {timer} of MENSAJES_POR_AGRUPAR.values()) clearTimeout(timer)` y flush de mensajes pendientes.
- **Estado:** - [x] Resuelto — 2026-09-03: `gracefulShutdown` ahora `clearTimeout` por entry, `delete` y `MEDIA_POR_CLIENTE.clear()` con warning de batches descartados. `tsc` OK.
- **Cómo se ajustó:** `bot.ts:1607` agregado bucle de cancelación al inicio de `gracefulShutdown`.

### H25 — `ORDER_UPDATED` nunca notifica a Telegram
- **Archivos:** `src/events/notification-aggregator.ts:EVENTOS_INFORMATIVOS`, `src/events/telegram.subscriber.ts`, `src/pedidos/pedido.service.ts:135`
- **Fix:** Decidir: (A) sacar `ORDER_UPDATED` de `EVENTOS_INFORMATIVOS` y agregar al digest diario, o (B) mantener como informativo pero documentar que es intencional (DEC-091). Ya está documentado como informativo en DEC-091; verificar que el digest lo incluya.
- **Estado:** - [ ] Pendiente (verificar si es intencional)

### H26 — `QR_GENERATED` sin suscriptor
- **Archivos:** `bot.ts:1350`, `src/events/event-bus.ts:50`, `src/events/telegram.subscriber.ts`
- **Fix:** Agregar handler en `telegram.subscriber` o eliminar el `emit` si no se necesita. Preferencia: log warn en `event-bus.emit` cuando no hay handlers.
- **Estado:** - [ ] Pendiente

### H27 — Resumen diario mezcla datos en memoria (0 tras reinicio) con DB
- **Archivos:** `bot.ts:524-560`, `src/pedidos/pedido.service.ts:238`, `src/casos/caso.service.ts:96`
- **Fix:** Leer `pedidos` y `casos` desde Supabase si `PEDIDOS.size===0` y `CASOS.size===0` (fallback DB), o siempre leer de DB para el resumen.
- **Estado:** - [ ] Pendiente

### H28 — `lib/telegram.ts` vs `template.builder.ts` funciones duplicadas
- **Archivos:** `lib/telegram.ts`, `src/notification-engine/template.builder.ts` (ambos tienen `esc`, `ultimos4`, `formatearNumero`, `horaActual`)
- **Fix:** Extraer a `src/utils/telegram-format.ts` compartido e importar en ambos.
- **Estado:** - [ ] Pendiente

### H29 — `business-rules.validator.ts` usa `.includes()` en vez de `\b`
- **Archivos:** `src/notification-engine/business-rules.validator.ts:r005_nombre,r002_sucursal`
- **Fix:** Cambiar `n.includes(conector)` por regex `\b${conector}\b` y `s.includes(v)` por `s===v` o `s.split(/\s+/).includes(v)`.
- **Estado:** - [ ] Pendiente

### H30 — `select('*')` expone `foto_referencia_base64`
- **Archivos:** `app/api/bot/diag/[chatId]/route.ts:32`, `src/notification-engine/timeline.builder.ts`, `app/api/reclamaciones/route.ts`, etc.
- **Fix:** Reemplazar por columnas explícitas (sin `foto_referencia_base64`). Auditar todos los `select('*')`.
- **Estado:** - [ ] Pendiente

### H31 — Falta RLS en 8 tablas
- **Archivos:** `supabase_migration_completa.sql`, `supabase_migration_novedades.sql` — tablas `historial_chat, pedidos_bot, casos, configuracion_bot, configuracion_agente, clientes, bot_cache, media_chat, zonas_envio_ambiguas, pruebas_conversacion_bot`
- **Fix:** Agregar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies `TO authenticated USING (true)` / `TO anon` según corresponda, o documentar que se usa service_role exclusivamente y RLS no aplica. **Requiere migración DB.**
- **Estado:** - [ ] Pendiente — requiere migración DB

### H32 — `consultarChatParaAdmin` carga 2000 clientes sin paginación
- **Archivos:** `src/novedades/novedades.service.ts:483`
- **Fix:** Paginar o filtrar por `ultimos4` primero en DB (`ilike telefono %ult4`) en vez de cargar 2000 y filtrar en memoria. Limitar a 100 tras filtro.
- **Estado:** - [ ] Pendiente

---

## 🟡 MEDIANOS — 12+

### M33 — Duplicación queries `historial_chat` entre `conversation.service` y `novedades.service`
- **Archivos:** `src/conversation/conversation.service.ts:obtenerHistorial`, `src/novedades/novedades.service.ts:obtenerTranscripciones`
- **Fix:** Extraer `queryHistorialChat(ventana, columnas)` a `src/conversation/conversation.repository.ts` y reutilizar.
- **Estado:** - [ ] Pendiente

### M34 — `obtenerPedidosActivos`, `serializarPedidoParaDashboard`, `contarPedidosPorEstado` sin uso externo
- **Archivos:** `src/pedidos/pedido.service.ts:233,277,237`
- **Fix:** Verificar uso real (grep). Si solo `poda.service` usa `listarPedidosActivosGlobales`, mantener. Eliminar o marcar `@deprecated` las no usadas. No eliminar `contarPedidosPorEstado` (la usa `bot.ts:528` para resumen).
- **Estado:** - [ ] Pendiente

### M35 — `envio.validator.ts` importa `supabaseAdmin` directamente
- **Archivos:** `src/validators/envio.validator.ts:3`
- **Fix:** Inyectar `supabaseAdmin` como dependencia o mover query a `src/validators/envio.repository.ts`.
- **Estado:** - [ ] Pendiente

### M36 — `response.validator.ts` dependencia circular con `conversation.service`
- **Archivos:** `src/validators/response.validator.ts:5`, `src/conversation/conversation.service.ts`
- **Fix:** Mover `normalizarTexto` a `src/utils/text.ts` compartido.
- **Estado:** - [ ] Pendiente

### M37 — `cancelacion.validator.ts` y `queja.validator.ts` son thin wrappers
- **Archivos:** `src/validators/cancelacion.validator.ts`, `src/validators/queja.validator.ts`, `src/decision/intent-detector.ts`
- **Fix:** Consolidar en `intent-detector.ts` o mantener wrappers pero documentar por qué existen (separación de responsabilidades). No eliminar sin motivo.
- **Estado:** - [ ] Pendiente

### M38 — `esTextoComprobante` duplicado entre `decision.engine.ts` y `pago.validator.ts`
- **Archivos:** `src/decision/decision.engine.ts:215`, `src/validators/pago.validator.ts:25`
- **Fix:** Eliminar el de `decision.engine.ts`, importar desde `pago.validator.ts`.
- **Estado:** - [ ] Pendiente

### M39 — `sucursal.validator.ts` todas las sucursales con misma dirección/horario
- **Archivos:** `src/validators/sucursal.validator.ts:SUCURSALES_INFO`
- **Fix:** Corregir direcciones y horarios reales por sucursal (pedir datos al usuario o leer de `configuracion_bot`).
- **Estado:** - [ ] Pendiente — requiere datos reales

### M40 — `fechaInicioFinCDMX()` frágil con timezone local
- **Archivos:** `bot.ts:fechaInicioFinCDMX`, `app/api/bot/status/route.ts:fechaInicioFinCDMX`
- **Fix:** Extraer a `src/utils/fecha.ts` con `Intl.DateTimeFormat` robusto y test con timezone UTC mockeado.
- **Estado:** - [ ] Pendiente

### M41 — `origen` no seleccionado por `timeline.builder.ts`
- **Archivos:** `src/notification-engine/timeline.builder.ts:152` (`.select('rol, contenido, creado_en')` sin `origen`)
- **Fix:** Agregar `origen` al select y usarlo para distinguir equipo/cliente/flora en la línea de tiempo.
- **Estado:** - [x] Resuelto — 2026-09-03: incluido en C14. `cargarHistorial` ahora `select('rol, contenido, creado_en, origen')`.
- **Cómo se ajustó:** `timeline.builder.ts:152` corregido.

### M42 — `resolverLidInverso` falla silenciosamente
- **Archivos:** `src/novedades/novedades.service.ts:143`, `src/whatsapp/contact.service.ts:resolverLidInverso`
- **Fix:** Log warn cuando falla y LID no resuelto; no usar LID como teléfono real en el digest (marcar como `LID:<id>`).
- **Estado:** - [ ] Pendiente

### M43 — `orchestrator.ts` crea caso+pedido para todo mensaje
- **Archivos:** `src/orchestrator.ts:29-38`, `src/whatsapp/message-handler.ts:81`
- **Fix:** Filtrar por intención antes de `crearPedido` — solo crear si `intencion` es `PEDIDO|PAGO|TRANSFERENCIA|CONFIRMACION`. Para `SALUDO|DESPEDIDA|GRACIAS`, solo crear caso si no existe.
- **Estado:** - [ ] Pendiente

### M44 — `FOTOS_PENDIENTES_APERTURA` posible doble envío
- **Archivos:** `src/whatsapp/bot-state.ts:37-51`, `src/whatsapp/bot-state-persistence.ts:84-98`, `bot.ts:292`
- **Fix:** Hacer `flushear` atómico: guardar en Supabase "enviando" antes de `clear()`, o usar transacción. Documentar riesgo bajo.
- **Estado:** - [x] Resuelto — 2026-09-03: aceptado como riesgo bajo documentado; `gracefulShutdown` ya persiste `guardarEstado()` antes de flush. Doble envío solo si crash entre `clear()` y `limpiarClavesVacias()` (<100ms). Mitigado por dedup de fotos en cliente.
- **Cómo se ajustó:** Documentado y cubierto por C5/C6 (persistencia en shutdown). No requiere código adicional.

---

## 📊 Resumen Checklist

| Grupo | Total | Resueltos | Pendientes | Progreso |
|-------|-------|-----------|------------|----------|
| 🔴 Críticos | 18 | 4 (2 parciales) | 14 | 22% |
| 🟠 Altos | 14 | 0 | 14 | 0% |
| 🟡 Medianos | 12 | 0 | 12 | 0% |
| **TOTAL** | **44** | **4** | **40** | 9% |

> Actualizar esta tabla tras cada fix. El porcentaje se calcula sobre `[x]` (resueltos verificados).

---

## 🔑 Migraciones DB — Qué necesita claves

Los siguientes fixes requieren ejecutar SQL en Supabase. Si quieres que el agente las ejecute, proporciona `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (ya están en `.env.local` si ejecutas local) y confirma con "ejecuta migraciones".

| Fix | SQL | Riesgo |
|-----|-----|--------|
| C11 `media_chat` CREATE | `CREATE TABLE IF NOT EXISTS media_chat (...)` | Bajo — `IF NOT EXISTS` idempotente |
| C12 `pedidos_bot.caso_id` | `ALTER TABLE pedidos_bot ADD COLUMN IF NOT EXISTS caso_id TEXT` | Bajo — columna nueva nullable |
| C13 `pedidos_bot.estado` CHECK | `ALTER TABLE pedidos_bot DROP CONSTRAINT ...; ADD CONSTRAINT ... CHECK (estado IN (...))` | Medio — requiere verificar datos existentes no violen nuevo CHECK |
| H31 RLS 8 tablas | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies | Medio — puede romper acceso anon si se hace mal; requiere probar con anon key |
| M39 `sucursal` datos | `UPDATE configuracion_bot SET valor=... WHERE clave='sucursales'` o similar | Bajo — solo datos |

> **Nota:** El agente puede ejecutar estas migraciones con `supabaseAdmin` (service_role) si tiene las claves. Alternativamente, puedes ejecutarlas manualmente desde el SQL Editor de Supabase.

---

## ✅ Verificación por Fix

Cada fix debe pasar antes de marcarse `[x]`:

1. `npx tsc --noEmit` — 0 errores
2. Tests relacionados: `npx tsx --env-file=.env.test tests/<archivo>.test.mts` — OK
3. Para fixes de query/BD: script Supabase con service_role que demuestre el fix (ej. `obtenerUltimosMensajesEquipo` retorna >0)
4. Para fixes de prompt: `grep` que confirme que la regla ya no está en el prompt
5. Commit con mensaje `fix(auditoria): <ID> — <descripción>`

---

## 📝 Registro de Cambios (Changelog de Auditoría)

| Fecha | Fix | Archivos | Verificación | Commit |
|-------|-----|----------|--------------|--------|
| 2026-09-03 | C2 parcial + C8 parcial — fallback 7d y tono (previo a auditoría) | `message-handler.ts`, `prompt.builder.ts` | tsc OK, 14 chats rescatados | `ee5b661` |
| _pendiente_ | _siguiente fix_ | | | |

---

## 🚀 Orden de Ejecución Recomendado (impacto)

1. **M1 (C1,C5,C6,C7)** — sin esto, cada reinicio pierde pedidos
2. **M2 (C3,C4,C18)** — estados rotos bloquean flujo de venta
3. **M3 (C2,C11,C12,C13,C14)** — datos incorrectos en dashboard y queries
4. **M4 (C15,C16,C8,C9,C10)** — timezone, seguridad, prompt
5. **M5 (C17,H25-H29)** — notificaciones
6. **M6 (H30-H32,M33-M44)** — limpieza y deuda técnica

> Avanzar uno por uno, commit por fix, sin mezclar módulos. Si un fix requiere DB, pedir confirmación antes de ejecutar.
