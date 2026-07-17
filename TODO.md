# TODO — Flora Project

## Estado General del Proyecto

| Componente | Progreso | Estado |
|---|---|---|---|---|
| Arquitectura modular | 80% | 🟢 |
| Conversation Engine | 100% | ✅ |
| Decision Engine | 100% | ✅ |
| Case Engine | 100% | ✅ |
| Order Engine | 100% | ✅ |
| WhatsApp Services | 85% | 🟢 |
| Persistencia Supabase | 100% | ✅ |
| Prompt Builder | 100% | ✅ |
| Event Engine | 98% | 🟢 |
| Telegram Engine | 100% | ✅ |
| Parsers | 100% | ✅ |
| Modelos/Tipos | 100% | ✅ |

**Progreso global estimado: ~98%**
**bot.ts actual: ~2442 líneas (reducción diferida a Fase 10 — Optimización)**
**Nota M11b:** Telegram verificado 100% basado en Event Engine. No hay llamadas directas a `lib/telegram` desde `bot.ts`.

## Errores de la Versión Anterior

| Error | Estado |
|---|---|
| #1 — Parser de nombre consume texto adicional | ✅ Resuelto |
| #1b — Parser acepta frases conversacionales como nombre (Issue producción 17-Jul) | ✅ Resuelto (DEC-022) |
| #1c — `ventaDesdeEstado` usaba `productoPersonalizado` que se contamina con caption de foto | ✅ Resuelto (DEC-023) |
| #1d — `ventaCerradaHandler` no emitía `ORDER_CREATED` con detalles de compra | ✅ Resuelto (DEC-023) |
| #1e — Nombre extraído no se sincronizaba con Order Engine (dashboard veía datos incompletos) | ✅ Resuelto (DEC-023) |
| #3 — LLM confirmaba horarios (9:30 cuando abren 10:00) — ahora deriva a equipo humano | ✅ Resuelto (DEC-024) |
| #4 — Order Engine persiste en bot_cache (sobrevive reinicios) | ✅ Resuelto (DEC-025) |
| #5 — `\bno\b` en NO_ES_NOMBRE bloqueaba "Noé Hernández" | ✅ Resuelto (DEC-026) |
| #2 — Sucursal por defecto incorrecta | ✅ Resuelto |
| #4 — Pedidos dependían de token VENTA_CERRADA | ✅ Resuelto |
| #5 — Conversación y pedido misma entidad | ✅ Resuelto (P2.1: reset de pedido al cambiar de tema) |
| #6 — Telegram dependía del LLM | ✅ Resuelto (verificado M11b: 100% eventos) |
| #7 — Reglas de negocio en el prompt | 🟢 Resuelto (validadores TS creados y conectados en M10a-d) |

## Fases de Migración (Parte 4.1)

### Fase 1 — Estabilización (P0)
- [x] P0.1 — Separar Express server de bot.ts
- [x] P0.2 — Crear sistema de eventos básico
- [x] P0.3 — Migrar Telegram a eventos (parcial)

### Fase 2 — Modelo de Datos (P1) ✅ COMPLETADA
- [x] P1.4 — Crear enums y tipos oficiales
- [x] P1.5 — Crear parsers especializados y conectarlos a bot.ts
- [x] P1.6 — Eliminar dependencia del token VENTA_CERRADA
- [x] P2.1 — Conversation Service

### Fase 3 — Conversation Engine (P2) ✅ COMPLETADA
- [x] P2.1 — Extraer historial y dedup a conversation.service.ts

### Fase 4 — Case Engine ✅ COMPLETADA
- [x] Implementar caso.service.ts
- [x] Gestión de ciclo de vida de casos (crear, obtener, archivar)
- [x] Archivar casos automáticamente (72h inactivo)
- [x] Detección de cambio de tema
- [x] Clasificación de tipo de caso
- [x] Integración en bot.ts (procesarMensaje + watchdog RAM)

### Fase 5 — Order Engine ✅ COMPLETADA
- [x] Implementar pedido.service.ts
- [x] Máquina de estados oficial con validación de transiciones
- [x] Creación, transición, archivo y cancelación de pedidos
- [x] Mapeo de estados legacy a estado oficial
- [x] Integración en bot.ts (procesarMensaje + watchdog RAM)

### Fase 6 — Decision Engine ✅ COMPLETADA
- [x] Implementar decision.engine.ts
- [x] Toda decisión crítica fuera de OpenAI
- [x] Orquestación obligatoria de decisiones (20 intenciones clasificadas)
- [x] Extraer detectores por palabras clave a intent-detector.ts

### Fase 7 — Prompt Builder ✅ COMPLETADA
- [x] Implementar prompt.builder.ts
- [x] Contexto dinámico basado en Decision + Case + Order Engine
- [x] Pendiente: migrar reglas de negocio del prompt de Supabase a TypeScript

### Fase 8 — Event Engine completo
- [x] PAYMENT_RECEIVED → Telegram ✅
- [x] PAYMENT_PENDING → Telegram ✅
- [x] CASE_CREATED → Telegram ✅
- [x] CASE_ARCHIVED → Telegram ✅
- [x] ORDER_READY emitido + Telegram ✅
- [x] ORDER_DELIVERED → Telegram ✅

### Fase 9 — Telegram Engine completo
- [x] Telegram solo depende de eventos (fotos)
- [x] Eliminar llamadas directas a Telegram desde bot.ts (fotos)
- [ ] Eliminar llamadas restantes a funciones de empleados WhatsApp desde bot.ts (no Telegram)

### Fase 10 — Optimización (P3.5 + P3.12 + P3.13)
- [x] Crear módulos WhatsApp: message-utils, notification, contact, preferences
- [ ] Reducir bot.ts a <500 líneas (actual: ~2500) — ⏳ En progreso
- [x] Crear src/orchestrator.ts como preámbulo del nuevo bot.ts
- [x] Crear barrel exports en src/ (P3.13)
- [ ] Migrar imports de bot.ts hacia src/index.ts
- [ ] Eliminar código muerto
- [ ] Optimizar consultas Supabase

## Pendientes Inmediatos

- [x] M10b: sucursal.validator.ts + envio.validator.ts
- [x] M10c: cancelacion.validator.ts + queja.validator.ts
- [x] M10d: Simplificar contextoExtra en bot.ts usando validadores
- [x] M11a: Dashboard Panel de Operaciones (app/admin/operaciones)
- [x] M11b: Verificar Event Engine 100% (Telegram ya depende solo de eventos; verificado)
- [x] Prompt: system prompt alineado a arquitectura (fallback en lib/ai.ts + Dashboard "Cerebro")
- [ ] Extraer lógica legacy de pedidos de bot.ts hacia el Order Engine (diferido a Fase 10)
- [ ] Reducir bot.ts progresivamente (< 500 líneas objetivo) (diferido a Fase 10 — Optimización)

## Terminados

| Tarea | Módulo | % |
|-------|--------|---|
| #1b — Parser acepta frases conversacionales como nombre | nombre.parser.ts | 100% |
| #1c — `ventaDesdeEstado` + `ventaCerradaHandler` corregidos | bot.ts | 100% |
| #1d — Sincronizar nombre entre PEDIDO_EN_CURSO y Order Engine | bot.ts | 100% |
| #3 — Horarios anticipados derivados a equipo humano | horario.validator.ts + bot.ts | 100% |
| #4 — Order Engine persiste en bot_cache (sobrevive reinicios) | pedido.repository.ts + pedido.service.ts + bot.ts | 100% |
| #5 — `\bno\b` en NO_ES_NOMBRE bloqueaba "Noé" | nombre.parser.ts | 100% |

- [x] P0.1 — Express duplicado de bot.ts ✅
- [x] P1.5 — Parsers conectados a bot.ts ✅
- [x] P2.8 — Case Engine ✅
- [x] P2.9 — Order Engine ✅
- [x] P3.4 — Decision Engine ✅
- [x] P3.5 — WhatsApp Services (message-utils, notification, contact, preferences) ✅
- [x] P3.7 — Event Engine ✅
- [x] P3.8 — API ✅
- [x] P3.10 — Barrel exports ✅
- [x] P3.11 — Adaptador (orchestrator.ts) ✅
- [x] P3.13 — Estructura src/ ✅

## Pendiente para P3.12 (bot.ts < 500 líneas)

- [ ] Extraer `manejarMensajeEntrante` (~400 líneas) a `src/whatsapp/message-handler.ts`
- [x] Extraer Maps de estado global a `src/whatsapp/bot-state.ts` (M6)
- [x] Extraer helper functions de dedup a bot-state.ts (M7)
- [x] Extraer rate limiter a bot-state.ts (M8)
- [ ] Mover parsers/ a `src/parser/`
- [ ] Mover lib/ a `src/lib/`
- [ ] Mover events/ a `src/events/`
- [ ] Migrar imports de bot.ts hacia src/index.ts

## Próximo: Pruebas en producción
Tras el commit/push, probar flujo completo en producción. Luego continuar extracción de bot.ts.

## Bloqueados

- [ ] `supabase_migration_bot_cache.sql` — pendiente de ejecutar en Supabase SQL Editor antes del próximo deploy

## Notas para Producción

- M9 requiere ejecutar `supabase_migration_bot_cache.sql` en Supabase SQL Editor antes del próximo reinicio del bot.
