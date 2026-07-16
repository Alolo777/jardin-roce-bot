# TODO — Flora Project

## Estado General del Proyecto

| Componente | Progreso | Estado |
|---|---|---|---|---|
| Arquitectura modular | 80% | 🟢 |
| Conversation Engine | 100% | ✅ |
| Decision Engine | 100% | ✅ |
| Case Engine | 100% | ✅ |
| Order Engine | 100% | ✅ |
| WhatsApp Services | 60% | 🟡 |
| Prompt Builder | 100% | ✅ |
| Event Engine | 75% | 🟡 |
| Telegram Engine | 60% | 🟡 |
| Parsers | 100% | ✅ |
| Modelos/Tipos | 100% | ✅ |

**Progreso global estimado: ~79%**
**bot.ts actual: ~2500 líneas (pendiente de extracción progresiva)**

## Errores de la Versión Anterior

| Error | Estado |
|---|---|
| #1 — Parser de nombre consume texto adicional | ✅ Resuelto |
| #2 — Sucursal por defecto incorrecta | ✅ Resuelto |
| #3 — LLM confirmaba horarios | 🔴 Pendiente |
| #4 — Pedidos dependían de token VENTA_CERRADA | ✅ Resuelto |
| #5 — Conversación y pedido misma entidad | ⏳ Pendiente (P2.1 iniciado) |
| #6 — Telegram dependía del LLM | ⏳ Pendiente (eventos creados, migración parcial) |
| #7 — Reglas de negocio en el prompt | 🔴 Pendiente |

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
- [ ] CASE_CREATED emitido desde caso.service.ts
- [ ] CASE_ARCHIVED emitido desde caso.service.ts
- [ ] ORDER_UPDATED emitido desde pedido.service.ts
- [ ] ORDER_READY emitido desde pedido.service.ts
- [ ] ORDER_DELIVERED emitido desde pedido.service.ts

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

- [ ] Migrar llamadas restantes a Telegram desde bot.ts a eventos
- [ ] Extraer lógica legacy de pedidos de bot.ts hacia el Order Engine
- [ ] Reducir bot.ts progresivamente (< 500 líneas objetivo)

## Completado

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
- [ ] Extraer Maps de estado global a `src/whatsapp/bot-state.ts`
- [ ] Mover parsers/ a `src/parser/`
- [ ] Mover lib/ a `src/lib/`
- [ ] Mover events/ a `src/events/`
- [ ] Migrar imports de bot.ts hacia src/index.ts

## Próximo: Pruebas en producción
Tras el commit/push, probar flujo completo en producción. Luego continuar extracción de bot.ts.

## Bloqueados

- Ninguno
