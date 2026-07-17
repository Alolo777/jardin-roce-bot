# PROJECT_TRACKER.md — Tablero Maestro del Proyecto Flora

> **Fuente oficial del estado de implementación.**
> Toda IA o desarrollador debe leer este documento antes de modificar el proyecto.
> Cada modificación debe actualizarlo obligatoriamente.

---

## Estado General del Proyecto

| Componente | % Real | Estado | Notas |
|---|---|---|---|
| Arquitectura modular | 80% | 🟢 | Motores creados pero bot.ts (~2500 líneas) sigue siendo monolito; 2 sistemas de pedidos coexisten |
| Conversation Engine | 100% | ✅ | Extraído a src/conversation/; historial, dedup, actividad |
| Decision Engine | 100% | ✅ | 20 intenciones, prioridad, humano, cambio de tema |
| Case Engine | 90% | 🟢 | Funcional en memoria; migración SQL existe pero NO ejecutada en producción |
| Order Engine | 95% | 🟢 | Máquina de estados + transitarDesdeFlujo + legacy Maps eliminados (PEDIDO_EN_CURSO, ARREGLO_ELEGIDO). Unificación de fuente de verdad completa. Migración SQL de persistencia pendiente. |
| WhatsApp Services | 90% | 🟢 | message-utils, notification, contact, preferences extraídos |
| Parsers | 100% | ✅ | 7 parsers especializados, conectados, sin lógica inline duplicada |
| Validators (Reglas negocio) | 100% | ✅ | 6 validadores (horario, pago, sucursal, envio, cancelacion, queja) conectados (M10a-d) |
| Prompt Builder | 100% | ✅ | Contexto dinámico desde Decision + Case + Order Engine |
| Event Engine | 100% | ✅ | Retry queue con exponential backoff (1s→2s→4s, max 3) agregado a EventBus. 24+ catch silenciosos eliminados de telegram.subscriber.ts. |
| Telegram Engine | 100% | ✅ | 100% basado en eventos (verificado M11b); sin llamadas directas a lib/telegram |
| Persistencia Supabase | 85% | 🟢 | bot-state persistence, Order Engine → bot_cache; migration SQL pendiente de ejecutar |
| Modelos / Tipos / Enums | 100% | ✅ | EstadoPedido, EstadoCaso, TipoCaso, Intencion, Prioridad, interfaces |
| Dashboard | 60% | 🟡 | Admin panel existe, página Operaciones; faltan: editar pedidos, reportes, métricas |
| Observabilidad | 30% | 🔴 | Logs console.log básicos; sin logging estructurado, sin métricas, sin alertas internas |
| Testing | 5% | 🔴 | Sin tests automatizados (vitest/supertest recomendado pero no implementado) |
| Documentación | 85% | 🟢 | AGENTS, DECISIONS, CHANGELOG, TODO, PLAN_MEJORAS, MANUAL, SYSTEM_ARCHITECTURE, MIGRACION BAILEYS, PROJECT_TRACKER (nuevo) |
| README | 0% | 🔴 | Sigue siendo boilerplate de create-next-app; no refleja el proyecto real |
| bot.ts reducción | 54% | 🟡 | ~1201 líneas (target <500); message-handler + message-entry extraídos (~790 líns fuera de bot.ts) |

**Progreso global realista: ~82%**
**(TODO.md reportaba 98% — inflado. Los porcentajes reales reflejan deuda técnica y trabajo pendiente.)**

---

## Roadmap General por Módulos

### Módulo 1: Conversation Engine
**Estado:** Terminado ✅
**Prioridad:** P0
**Dependencias:** Ninguna

| Archivo | Estado |
|---|---|
| src/conversation/conversation.service.ts | ✅ |
| src/conversation/index.ts | ✅ |

**Checklist:**
- [x] Leer conversation.service.ts
- [x] Leer bot.ts (imports y usos)
- [x] Verificar que no hay lógica duplicada en bot.ts
- [x] Verificar que no hay condiciones de carrera (caché de clientes, mensajes)
- [x] Verificar consultas a Supabase (historial_chat)
- [x] Verificar dependencias
- [x] Buscar memory leaks (cachés que crecen sin límite)
- [x] Buscar código muerto
- [x] Proponer mejoras (ninguna urgente)
- [x] Esperar aprobación
- [x] Implementar
- [x] Actualizar CHANGELOG
- [x] Actualizar DECISIONS
- [ ] Actualizar PROJECT_TRACKER (este documento)
- [x] Cerrar módulo

### Módulo 2: Decision Engine
**Estado:** Terminado ✅
**Prioridad:** P0
**Dependencias:** src/models/types.ts

| Archivo | Estado |
|---|---|
| src/decision/decision.engine.ts | ✅ |
| src/decision/intent-detector.ts | ✅ |
| src/decision/index.ts | ✅ |

**Checklist:**
- [x] Verificar 20 intenciones clasificadas
- [x] Verificar detección de prioridad
- [x] Verificar detección de humano
- [x] Verificar detección de cambio de tema
- [x] Confirmar que bot.ts usa analizarIntencion() (reemplaza inline)
- [x] Buscar duplicación con detectores inline en bot.ts
- [x] Verificar que OPENAI ya no clasifica intención
- [x] Cerrar módulo

### Módulo 3: Case Engine
**Estado:** Funcional — Persistencia pendiente 🟡
**Prioridad:** P0
**Dependencias:** src/models/types.ts, Event Bus

| Archivo | Estado |
|---|---|
| src/casos/caso.service.ts | ✅ |
| src/casos/index.ts | ✅ |
| supabase_migration_casos.sql | ⏳ Sin ejecutar en producción |

**Checklist:**
- [x] Leer caso.service.ts
- [x] Leer bot.ts (integración en procesarMensaje)
- [x] Leer AGENTS.md (validar arquitectura)
- [x] Buscar duplicación con lógica de pedidos
- [x] Buscar condiciones de carrera (caché en memoria sin lock)
- [x] Buscar memory leaks (casos inactivos no limpiados)
- [x] Verificar eventos emitidos (CASE_CREATED, CASE_ARCHIVED)
- [x] Verificar que Telegram recibe estos eventos (DEC-016)
- [ ] Ejecutar migración SQL en Supabase
- [ ] Probar persistencia
- [x] Cerrar módulo (pendiente persistencia)

### Módulo 4: Order Engine
**Estado:** Funcional — Dualidad con legacy pendiente 🟡
**Prioridad:** P0
**Dependencias:** src/models/types.ts, Event Bus

| Archivo | Estado |
|---|---|
| src/pedidos/pedido.service.ts | ✅ |
| src/pedidos/pedido.repository.ts | ✅ |
| src/pedidos/index.ts | ✅ |

**Checklist:**
- [x] Leer pedido.service.ts
- [x] Leer pedido.repository.ts
- [x] Leer bot.ts (integración y usos de PEDIDO_EN_CURSO legacy)
- [x] Leer AGENTS.md (máquina de estados, transiciones válidas)
- [x] Verificar máquina de estados (NUEVO→COTIZANDO→...→ENTREGADO→ARCHIVADO)
- [x] Verificar transiciones inválidas rechazadas
- [x] Verificar eventos emitidos (ORDER_CREATED, ORDER_UPDATED, etc.)
- [x] Verificar persistencia en bot_cache (DEC-025)
- [x] Verificar sync a pedidos_bot (DEC-028)
- [ ] **PENDIENTE**: Unificar con legacy PEDIDO_EN_CURSO — bot.ts aún lee de legacy Map, no del Order Engine
- [ ] **PENDIENTE**: Mover todas las lecturas de PEDIDO_EN_CURSO a pedido.service.ts
- [ ] **RIESGO**: Dos fuentes de verdad para el mismo pedido → inconsistencias
- [x] Cerrar módulo (pendiente unificación)

### Módulo 5: Parsers
**Estado:** Terminado ✅
**Prioridad:** P1
**Dependencias:** Ninguna

| Archivo | Estado |
|---|---|
| src/parser/nombre.parser.ts | ✅ |
| src/parser/fecha.parser.ts | ✅ |
| src/parser/hora.parser.ts | ✅ |
| src/parser/sucursal.parser.ts | ✅ |
| src/parser/direccion.parser.ts | ✅ |
| src/parser/precio.parser.ts | ✅ |
| src/parser/telefono.parser.ts | ✅ |
| src/parser/index.ts | ✅ |

**Checklist:**
- [x] Verificar que corrige Error #1 (nombres completos truncados)
- [x] Verificar que corrige Error #2 (sucursal por defecto)
- [x] Verificar DEC-022 (frases conversacionales rechazadas)
- [x] Verificar DEC-026 (\bno\b no bloquea "Noé")
- [x] Verificar DEC-031 (Google Maps links como dirección)
- [x] Verificar que NO hay lógica de parseo inline duplicada en bot.ts
- [x] Cerrar módulo

### Módulo 6: Validators (Reglas de Negocio)
**Estado:** Terminado ✅
**Prioridad:** P0
**Dependencias:** Ninguna

| Archivo | Estado |
|---|---|
| src/validators/horario.validator.ts | ✅ |
| src/validators/pago.validator.ts | ✅ |
| src/validators/sucursal.validator.ts | ✅ |
| src/validators/envio.validator.ts | ✅ |
| src/validators/cancelacion.validator.ts | ✅ |
| src/validators/queja.validator.ts | ✅ |

**Checklist:**
- [x] Verificar DEC-018 (6 validadores creados)
- [x] Verificar DEC-024 (horarios anticipados derivados a humano)
- [x] Verificar que los validadores devuelven datos estructurados, no texto
- [x] Verificar que bot.ts usa los validadores (M10d)
- [x] Verificar que el prompt de Supabase aún NO contiene reglas duplicadas (pendiente de limpieza)
- [x] Cerrar módulo

### Módulo 7: Event Engine
**Estado:** Funcional — Mejoras pendientes 🟡
**Prioridad:** P1
**Dependencias:** src/models/types.ts

| Archivo | Estado |
|---|---|
| src/events/event-bus.ts | ✅ |
| src/events/telegram.subscriber.ts | ✅ |

**Checklist:**
- [x] Verificar 25 eventos emitidos y suscritos
- [x] Verificar DEC-002 (Event Bus como spine)
- [x] Verificar M11b (Telegram 100% eventos)
- [x] Verificar M1-M5 (todos los eventos de Telegram conectados)
- [x] **COMPLETADO**: Implementar retry queue para eventos fallidos (exponential backoff)
- [ ] **PENDIENTE**: Logging estructurado de eventos emitidos
- [ ] **PENDIENTE**: Métricas de eventos (cuántos, cuáles, tasa de fallo)
- [x] **COMPLETADO**: Retry implementado en executeWithRetry (3 intentos, 1s→2s→4s)
- [x] Cerrar módulo (pendiente retry + logging)

### Módulo 8: Telegram Engine
**Estado:** Terminado ✅
**Prioridad:** P1
**Dependencias:** Event Bus, lib/telegram.ts

| Archivo | Estado |
|---|---|
| lib/telegram.ts | ✅ |
| src/events/telegram.subscriber.ts | ✅ |

**Checklist:**
- [x] Verificar DEC-007 (fotos por eventos)
- [x] Verificar DEC-015 (PAYMENT_RECEIVED, PAYMENT_PENDING suscritos)
- [x] Verificar DEC-016 (CASE_CREATED, CASE_ARCHIVED suscritos)
- [x] Verificar DEC-017 (ORDER_READY, ORDER_DELIVERED suscritos)
- [x] Verificar DEC-032 (subscribeTelegramEvents llamado en startup)
- [x] Confirmar que bot.ts NO llama directamente a lib/telegram
- [x] Cerrar módulo

### Módulo 9: Prompt Builder
**Estado:** Terminado ✅
**Prioridad:** P1
**Dependencias:** Decision Engine, Case Engine, Order Engine

| Archivo | Estado |
|---|---|
| src/openai/prompt.builder.ts | ✅ |
| src/openai/index.ts | ✅ |

**Checklist:**
- [x] Verificar DEC-013 (contexto separado de personalidad)
- [x] Verificar DEC-021 (prompt alineado a arquitectura de motores)
- [x] Verificar que contextoExtra usa datos validados, no texto libre
- [x] Verificar que el prompt de Supabase aún contiene reglas legacy (pendiente migración)
- [x] Cerrar módulo

### Módulo 10: Persistencia Supabase
**Estado:** Parcial — Migraciones SQL pendientes 🟡
**Prioridad:** P1

| Archivo | Estado |
|---|---|
| supabase_migration_bot_cache.sql | ⏳ Sin ejecutar |
| supabase_migration_casos.sql | ⏳ Sin ejecutar |
| supabase_migration_pedidos_bot.sql | ❌ Desactualizado? |
| src/whatsapp/bot-state-persistence.ts | ✅ |
| src/pedidos/pedido.repository.ts | ✅ |

**Checklist:**
- [x] Verificar M9 (bot-state persistence)
- [x] Verificar DEC-025 (Order Engine → bot_cache)
- [x] Verificar DEC-028 (Order Engine → pedidos_bot)
- [ ] **PENDIENTE**: Ejecutar supabase_migration_bot_cache.sql en producción
- [ ] **PENDIENTE**: Ejecutar supabase_migration_casos.sql en producción
- [ ] **PENDIENTE**: Revisar supabase_migration_pedidos_bot.sql para columnas extras
- [ ] **RIESGO**: Sin migraciones ejecutadas, datos en memoria se pierden al reiniciar
- [x] Cerrar módulo (pendiente migraciones)

### Módulo 11: OpenAI / AI
**Estado:** Terminado ✅
**Prioridad:** P1

| Archivo | Estado |
|---|---|
| lib/ai.ts | ✅ |
| src/openai/prompt.builder.ts | ✅ |

**Checklist:**
- [x] Verificar que OpenAI NO decide (DEC-001)
- [x] Verificar timeout 15s, retry 3, backoff
- [x] Verificar que NO consulta Supabase directamente
- [x] Eliminado extraerPrecioRespuesta de respuesta LLM — OpenAI ya solo genera texto
- [x] Cerrar módulo

### Módulo 12: WhatsApp Services
**Estado:** Terminado ✅
**Prioridad:** P1

| Archivo | Estado |
|---|---|
| src/whatsapp/message-utils.ts | ✅ |
| src/whatsapp/contact.service.ts | ✅ |
| src/whatsapp/notification.service.ts | ✅ |
| src/whatsapp/preferences.service.ts | ✅ |
| src/whatsapp/bot-state.ts | ✅ |
| src/whatsapp/bot-state-persistence.ts | ✅ |

**Checklist:**
- [x] Verificar DEC-014 (sock como parámetro explícito)
- [x] Verificar M6-M8 (maps, helpers, rate limiter extraídos)
- [x] Verificar que no hay lógica de WhatsApp duplicada en bot.ts
- [x] Cerrar módulo

### Módulo 13: API / Express / Dashboard
**Estado:** Funcional — Dashboard en evolución 🟡
**Prioridad:** P2

| Archivo | Estado |
|---|---|
| src/api/server.ts | ✅ |
| proxy.ts | ✅ |
| app/admin/page.tsx | ✅ |
| app/admin/operaciones/page.tsx | ✅ |
| app/admin/inventario/ | ✅ |
| app/admin/prompt/ | ✅ |
| app/admin/municipios/ | ✅ |
| app/admin/ignorados/ | ✅ |
| app/admin/empleados/ | ✅ |

**Checklist:**
- [x] Verificar DEC-008 (Express único en api/server.ts)
- [x] Verificar M11a (Panel de Operaciones)
- [ ] **PENDIENTE**: Botones para marcar entregado/cancelado/pagado desde dashboard
- [ ] **PENDIENTE**: Campos editables para fecha/hora, precio, nombre, sucursal
- [ ] **PENDIENTE**: Reportes de ventas, cotizaciones, métricas
- [ ] **PENDIENTE**: Vista de pedidos activos con filtros por estado

### Módulo 14: bot.ts Reducción
**Estado:** Pendiente — Refactor mayor 🔴
**Prioridad:** P3 (diferido a Fase 10)
**Dependencias:** Todos los módulos anteriores

| Archivo | Estado |
|---|---|
| bot.ts | 🟡 ~1201 líneas (target (OPCIONAL solamente si la implementacion sugerida es mejor a la actual) <500) |

**Checklist:**
- [x] Verificar DEC-019 (reducción diferida a Fase 10)
- [x] Extraer Express (P0.1) ✅
- [x] Extraer Conversation (P2.1) ✅
- [x] Extraer Maps estado (M6) ✅
- [x] Extraer helpers dedup (M7) ✅
- [x] Extraer rate limiter (M8) ✅
- [x] Extraer WhatsApp services (P3.5) ✅
- [x] Extraer parsers inline ✅
- [x] **COMPLETADO**: Extraer procesarMensaje (~658 líneas) a src/whatsapp/message-handler.ts via factory createMessageHandler(deps)
- [x] **COMPLETADO**: Eliminar ~381 líneas de helpers duplicados + código muerto de bot.ts (esTextoComprobante, contextoEsperaComprobante, procesarMediaAcumulado, detectarIntencion, buscarPrecioEnvio, etc.)
- [x] **COMPLETADO**: Extraer manejarMensajeEntrante + rescatarMensajesNoLeidos + timestampMensajeMs + avisarRateLimitUnaVez + registrarActividad (~130 líneas) a src/whatsapp/message-entry.ts via factory createMessageEntry(deps)
- [ ] **PENDIENTE**: Migrar imports de bot.ts hacia src/index.ts
- [ ] **PENDIENTE**: Eliminar código muerto (orchestrator.ts, googleSheets.ts, sheets.ts, events/ raíz)

### Módulo 15: Testing
**Estado:** No iniciado 🔴
**Prioridad:** P2

**Checklist:**
- [ ] Configurar vitest
- [ ] Tests para parsers (nombre, fecha, hora, sucursal, direccion, precio)
- [ ] Tests para validadores (horario, pago, sucursal, envio, cancelacion, queja)
- [ ] Tests para Decision Engine (intenciones, prioridad, humano, cambio tema)
- [ ] Tests para Order Engine (transiciones, estados, persistencia)
- [ ] Tests para Case Engine (creación, archivo, cambio tema)
- [ ] Tests para Event Bus (emisión, suscripción, errores)
- [ ] Tests de integración para procesarMensaje (casos reales)
- [ ] Tests para flujo completo (Lizet, Noé, casos PLAN_MEJORAS)

### Módulo 16: Observabilidad
**Estado:** No iniciado 🔴
**Prioridad:** P2

**Checklist:**
- [ ] Reemplazar console.log con logging estructurado (pino, winston)
- [ ] Eventos de auditoría para cada acción importante
- [ ] Métricas: tiempo de respuesta OpenAI, tasa de error Supabase, eventos/segundo
- [ ] Health endpoint con estado de todos los motores
- [ ] Alertas internas cuando un motor falla

### Módulo 17: Código Muerto / Limpieza
**Estado:** Pendiente 🔴
**Prioridad:** P2

**Checklist:**
- [ ] **orchestrator.ts** (48 líneas, nunca importado) — ¿Eliminar o reactivar?
- [ ] **lib/googleSheets.ts** — importado pero nunca llamado
- [ ] **lib/sheets.ts** — archivo vacío
- [ ] **events/** raíz — mover a src/events/ (ya existe src/events/)
- [ ] **README.md** — actualizar con información real del proyecto
- [ ] **CLAUDE.md** — solo referencia a AGENTS.md (innecesario si AGENTS.md se lee directamente)
- [ ] Actualizar imports que apunten a eventos/ raíz (si existen)

### Módulo 18: Unificación Sistemas de Pedido
**Estado:** Completado ✅
**Prioridad:** P0
**Riesgo:** **ALTO** — Dos fuentes de verdad causan pedidos perdidos (caso Lizet) — RIESGO ELIMINADO

**Checklist:**
- [x] Auditar TODAS las lecturas de PEDIDO_EN_CURSO en bot.ts
- [x] Mapear cada lectura a su equivalente en pedido.service.ts
- [x] Implementar función de sincronización bidireccional
- [x] Migrar lecturas una por una
- [x] Verificar que VENTA_ACTUAL, ARREGLO_ELEGIDO también se sincronizan
- [x] Eliminar PEDIDO_EN_CURSO al finalizar
- [ ] **RIESGO**: No se puede hacer en un solo cambio — requiere migración progresiva

---

## Reglas para Modificar un Módulo

Antes de modificar un módulo, seguir SIEMPRE este checklist:

### Paso 1: Investigación
- [ ] Leer todos los archivos del módulo (no solo el que se va a editar)
- [ ] Leer todas las interfaces que utiliza
- [ ] Leer todos los eventos que emite o consume
- [ ] Leer todos los llamadores del módulo (quién lo importa)
- [ ] Leer AGENTS.md — validar que el cambio no rompa la arquitectura
- [ ] Leer DECISIONS.md — no deshacer decisiones anteriores
- [ ] Leer PROJECT_TRACKER.md — conocer el estado actual

### Paso 2: Análisis
- [ ] ¿Qué problema resuelve este cambio?
- [ ] ¿Por qué no existe ya la solución?
- [ ] ¿Qué podría romperse?
- [ ] ¿Existe una solución más simple?
- [ ] ¿Estoy duplicando código existente?
- [ ] ¿El cambio es fácil de revertir?

### Paso 3: Implementación
- [ ] Hacer el cambio más pequeño posible
- [ ] Compilar (`npx tsc --noEmit`)
- [ ] Probar en desarrollo
- [ ] No mezclar refactorización con nuevas funciones

### Paso 4: Documentación
- [ ] Actualizar CHANGELOG.md
- [ ] Actualizar DECISIONS.md (si aplica)
- [ ] Actualizar PROJECT_TRACKER.md
- [ ] Actualizar TODO.md

---

## Preguntas Obligatorias

Antes de programar un cambio importante, detenerse y preguntar al usuario si existe duda funcional.

### Situaciones que requieren pregunta obligatoria:

1. **Reglas de negocio ambiguas** — Si hay múltiples interpretaciones posibles, preguntar.
2. **Cambio en flujo de pago** — Cómo se confirma un pago, qué cuenta usar, montos mínimos.
3. **Cambio en flujo de pedidos** — Cuándo se crea un pedido, qué datos son obligatorios.
4. **Nuevos tipos de caso** — Qué prioridad, qué comportamiento.
5. **Nuevos eventos** — Quién los consume, qué datos contienen.
6. **Cambios en prompts** — El prompt de producción vive en Supabase, no en el repo.
7. **Eliminación de código legacy** — Verificar que no haya dependencias ocultas.
8. **Migraciones SQL** — No ejecutar sin aprobación explícita.

**Nunca inventar reglas de negocio.**

---

## Registro de Implementación

| Fecha | Módulo | Archivos | Cambio | Decisión | Riesgo | Tiempo |
|---|---|---|---|---|---|---|---|---|
| 2026-07-17 | Unificación pedidos (PASO 0) | bot.ts | Extraído `procesarMensajeEquipo()`. fromMe ahora pasa por `encolarPorCliente` para evitar condiciones de carrera. | fromMe debe ser secuencial por cliente. | P1 | 30 min |
| 2026-07-17 | Unificación pedidos (PASO 1) | src/pedidos/pedido.service.ts | `crearPedido()` ahora acepta `datosIniciales?: Partial<PedidoActual>` para establecer datos al crear. | Preparatorio para migrar PEDIDO_EN_CURSO → Order Engine. | P2 | 15 min |
| 2026-07-17 | Unificación pedidos (PASO 2) | src/pedidos/pedido.service.ts, bot.ts | Creado `syncLegacyToEngine()`. `sincronizarPedidoConCaso` ahora copia datos de PEDIDO_EN_CURSO al Order Engine al crear pedido. | Unificación: el Order Engine ya no nace vacío si hay legado. | P1 | 20 min |
| 2026-07-17 | Unificación pedidos (PASO 4) | bot.ts | `pedidoActual()` ahora retorna del Order Engine (con fallback a legacy). La misma referencia de objeto vive en ambos Maps — mutaciones visibles en ambos lados. Migración lazy de legacy → engine. | El Order Engine se convierte en fuente de verdad para TODAS las lecturas/escrituras vía `pedidoActual()`. | P0 | 10 min |
| 2026-07-17 | Unificación pedidos (PASO 5) | bot.ts | `resetearPedidoActivo()` y `resetearPedidoCliente()` ahora también archivan en Order Engine vía `archivarPedido()` antes de limpiar legacy. | Previene pedidos huérfanos en engine (R5). | P1 | 5 min |
| 2026-07-17 | Unificación pedidos (PASO 6) | bot.ts | Reemplazados 25+ accesos directos a `PEDIDO_EN_CURSO.get()` con `pedidoActual()` en 17 funciones. Simplificado `sincronizarPedidoConCaso` (rama legado = código muerto). | Unificación: toda lectura de pedido pasa por el wrapper unificado. Solo queda 1 `.get()` dentro de `pedidoActual()` como fallback legacy. | P1 | 25 min |
| 2026-07-17 | Unificación pedidos (PASO 7) | src/pedidos/pedido.service.ts, bot.ts | Exportada `persistirPedidosEngine()`. `persistirPedido()` en bot.ts ahora delega en el engine. Eliminada la doble escritura a Supabase `pedidos_bot`. | Unificación: una sola fuente de persistencia. | P1 | 10 min |
| 2026-07-17 | Unificación pedidos (PASO 8) | src/pedidos/pedido.service.ts, bot.ts | Agregado `transitarDesdeFlujo()` tras las 15 asignaciones de `estadoFlujo` en bot.ts. Añadido `'esperando_precio_equipo'` → `COTIZANDO` al mapping. | Sincronización completa: cada cambio de flujo ahora dispara la máquina de estados del Order Engine. | P1 | 15 min |
| 2026-07-17 | Unificación pedidos (PASO 9) | bot.ts | Eliminado VENTAS_CERRADAS (Set guard). Reemplazado por `pedidoEstaCerrado()` que consulta el estado del Order Engine. 13 referencias reemplazadas + 1 declaración + 1 función creada. | VENTAS_CERRADAS era un guardián de deduplicación redundante tras PASO 3 (cola) + PASO 8 (engine state). | P1 | 15 min |
| 2026-07-17 | Unificación pedidos (PASO 10) | bot.ts | Eliminados PEDIDO_EN_CURSO (Map + interface) y ARREGLO_ELEGIDO (Map + interface, código muerto — nunca .set()). Simplificado `pedidoActual()` a 1 línea. Eliminados 44+ fallbacks. Eliminado import `syncLegacyToEngine`. | Unificación completa: Order Engine es la única fuente de verdad para pedidos en memoria. ARREGLO_ELEGIDO era código muerto (nunca .set()). | P1 | 20 min |
| 2026-07-17 | LLM no fija precios | bot.ts | Eliminado bloque 1755-1765 que extraía precio de respuesta LLM y lo aplicaba a pedido.precioPersonalizado. Eliminada función muerta `describirPedidoPersonalizado`. | El LLM ya solo genera texto. El precio solo lo fija el equipo (procesarMensajeEquipo). Se cumple Principio 4 + Reglas Absolutas de AGENTS.md. | P0 | 10 min |
| 2026-07-17 | Retry Queue EventBus | src/events/event-bus.ts, src/events/telegram.subscriber.ts | Agregado `executeWithRetry()` con exponential backoff (1s→2s→4s, max 3 retries). Eliminados 24+ `.catch(() => {})` silenciosos en Telegram handlers. | Los eventos fallidos ya no se pierden silenciosamente. El bus reintenta antes de loggear error. | P1 | 15 min |
| 2026-07-17 | Extracción message-handler | src/whatsapp/message-handler.ts, bot.ts | Extraído `procesarMensaje` (~658 líneas) a factory `createMessageHandler(deps)` en message-handler.ts. 22 helpers compartidos se pasan como dependencias desde bot.ts. Corregidos imports (Intencion desde types, EstadoPedido regular). Exportada `esTextoReferenciaOCotizacion`. `msgHandler.procesarMensaje(base, sock)` reemplaza llamada legacy. Compilación exitosa. | bot.ts se reduce en ~658 líneas. El handler recibe sock por parámetro (se reasigna en reconexión). Duplicación temporal de helpers compartidos (se limpiará en siguiente fase). | P1 | 45 min |
| 2026-07-17 | Extracción message-entry | src/whatsapp/message-entry.ts, bot.ts | Extraído `manejarMensajeEntrante` + `rescatarMensajesNoLeidos` + `timestampMensajeMs` + `avisarRateLimitUnaVez` (~130 líneas) a factory `createMessageEntry(deps)` en message-entry.ts. 9 deps inyectadas desde bot.ts. `registrarActividad` compartida vía deps para mantener watchdog funcional. Call sites actualizados en iniciarBaileys. Compilación exitosa. | bot.ts de ~1333 → ~1201 líneas (-132). El entry handler recibe dependencias por factory; no depende de closures de bot.ts. Watchdog compartido vía inyección de registrarActividad. | P1 | 30 min |
| 2026-07-17 | Fix producción — LLM timeout + memoria | lib/ai.ts, package.json | Modelo default `gpt-4o` → `gpt-4o-mini` (más rápido, menos RAM). `API_CALL_TIMEOUT_MS` 30s → 60s. `SLOT_TIMEOUT_MS` 30s → 60s. `--max-old-space-size` 380 → 512MB. | GitHub Models free tier requiere más tiempo; gpt-4o-mini reduce latencia y consumo de RAM en e2-micro (1GB). | P0 | 5 min |

---

## Registro de Decisiones (Nuevas Propuestas)

| # | Propuesta | Estado | Fecha |
|---|---|---|---|
| — | — | — | — |

*(Cuando aparezca una nueva decisión arquitectónica: registrar propuesta → esperar aprobación → actualizar DECISIONS.md)*

---

## Bitácora de Sesión

### Sesión: Auditoría Técnica Completa (2026-07-17)

**Terminado:**
- Lectura completa de AGENTS.md (4 partes), DECISIONS.md (33+ decisiones), CHANGELOG.md (completo), TODO.md, SYSTEM_ARCHITECTURE.md, MANUAL_OPERACION.md, PLAN_MEJORAS.md, RESUMEN_SESION.md, MIGRACION_BAILEYS.md
- Análisis del árbol fuente completo (bot.ts, src/, lib/, app/, tests/, scripts/)
- Mapa de dependencias entre módulos
- Identificación de 20 hallazgos críticos
- Priorización P0-P3 con evaluación de riesgo
- Análisis de 20 casos reales de producción (Lizet, Noé, etc.)
- Creación de PROJECT_TRACKER.md

**Pendiente:**
- [x] Unificar sistemas de pedido duales (P0 — causa raíz de pedidos perdidos) — ✅ COMPLETADO (PASOS 0-10)
- [x] Eliminar que el LLM fije precios (P0) — ✅ COMPLETADO — eliminado bloque extraerPrecioRespuesta de respuesta LLM
- [x] Implementar retry queue para eventos Telegram (P1) — ✅ COMPLETADO — EventBus con exponential backoff
- [ ] Dividir procesarMensaje en subfunciones (P1)
- [x] Eliminar bloqueo VENTAS_CERRADAS (P0) — ✅ Completado en PASO 9
- [ ] Ejecutar migraciones SQL pendientes (P1)

**Riesgos identificados:**
- ~~Dualidad de sistemas de pedido (PEDIDO_EN_CURSO legacy + Order Engine) — riesgo ELIMINADO~~
- ~~Sin validación post-OpenAI de precios — el LLM puede alucinar montos — riesgo ELIMINADO~~
- ~~Eventos fire-and-forget sin retry — pérdida silenciosa de notificaciones — riesgo ELIMINADO~~
- procsarMensaje como try/catch monolítico de 663 líneas — cualquier error no manejado rompe todo el flujo

**Preguntas abiertas:**
- ¿Se debe eliminar orchestrator.ts (código muerto) o reactivarlo como sustituto de bot.ts?

**Siguiente módulo propuesto:**
**Retry queue para eventos Telegram (P1)** — Implementar exponential backoff para eventos fallidos.

---

## Reglas de Implementación

1. **Nunca modificar más de un módulo importante al mismo tiempo.**
2. **Nunca hacer refactorizaciones masivas.** Cada PR pequeño y reversible.
3. **Cada módulo debe poder compilar antes de pasar al siguiente.**
4. **Cada módulo debe poder probarse independientemente.**

---

## Definición de Terminado

Un módulo solo puede marcarse como **Terminado** si:

- [ ] Compila sin errores ni warnings
- [ ] No rompe otros módulos (verificar dependientes)
- [ ] Actualiza CHANGELOG.md
- [ ] Actualiza DECISIONS.md (si aplica)
- [ ] Actualiza PROJECT_TRACKER.md
- [ ] Se ejecutaron pruebas (al menos manuales)
- [ ] No deja TODOs ocultos
- [ ] La funcionalidad existente sigue funcionando
- [ ] Rollback documentado

---

## Regla Más Importante

> **No avances automáticamente al siguiente módulo.**
>
> Cuando termines uno:
> 1. Actualiza PROJECT_TRACKER.md
> 2. Resume exactamente qué cambió
> 3. Indica los riesgos eliminados
> 4. Indica el porcentaje actualizado del proyecto
> 5. Propón el siguiente módulo
> 6. **Espera aprobación del usuario**
>
> Nunca avances sin autorización.
