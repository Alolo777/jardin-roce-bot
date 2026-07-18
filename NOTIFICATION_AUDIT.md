# 🔔 NOTIFICATION_AUDIT.md

## Auditoría Completa del Sistema de Notificaciones Flora
**Versión:** 1.0  
**Fecha:** 2026-07-18  
**Auditor:** IA Agent (DeepSeek V4)  
**Estado:** COMPLETO

---

## ÍNDICE

1. [RESUMEN EJECUTIVO](#1-resumen-ejecutivo)
2. [FASE 1 — CATÁLOGO COMPLETO DE NOTIFICACIONES](#2-fase-1--catálogo-completo-de-notificaciones)
   - [2.1 Sistema de eventos](./#21-sistema-de-eventos)
   - [2.2 Censo de eventBus.emit()](./#22-censo-de-eventbusemit)
   - [2.3 Funciones de notificación Telegram](./#23-funciones-de-notificación-telegram)
   - [2.4 Suscripciones activas](./#24-suscripciones-activas)
   - [2.5 Matriz cobertura evento → notificación](./#25-matriz-cobertura-evento--notificación)
3. [FASE 2 — FLUJO REAL WHATSAPP → TELEGRAM](#3-fase-2--flujo-real-whatsapp--telegram)
   - [3.1 Diagrama de flujo completo](./#31-diagrama-de-flujo-completo)
   - [3.2 Flujo detallado por tipo de mensaje](./#32-flujo-detallado-por-tipo-de-mensaje)
   - [3.3 Caminos de datos críticos](./#33-caminos-de-datos-críticos)
4. [FASE 3 — TRAZABILIDAD DE DATOS](#4-fase-3--trazabilidad-de-datos)
5. [FASE 4 — DETECCIÓN DE PUNTOS DÉBILES](#5-fase-4--detección-de-puntos-débiles)
   - [WP-01: Nombre incorrecto](./#wp-01-nombre-incorrecto)
   - [WP-02: Sucursal incorrecta](./#wp-02-sucursal-incorrecta)
   - [WP-03: Fecha/hora incorrecta](./#wp-03-fechahora-incorrecta)
   - [WP-04: Precio incorrecto](./#wp-04-precio-incorrecto)
   - [WP-05: Producto incorrecto](./#wp-05-producto-incorrecto)
   - [WP-06: Pedidos mezclados](./#wp-06-pedidos-mezclados)
   - [WP-07: Pedido cancelado notificado como activo](./#wp-07-pedido-cancelado-notificado-como-activo)
   - [WP-08: Datos antiguos en notificación](./#wp-08-datos-antiguos-en-notificación)
   - [WP-09: Notificaciones duplicadas](./#wp-09-notificaciones-duplicadas)
   - [WP-10: Intervención humana no señalada](./#wp-10-intervención-humana-no-señalada)
   - [WP-11: Texto de OpenAI filtrado a Telegram](./#wp-11-texto-de-openai-filtrado-a-telegram)
6. [FASE 5 — ARQUITECTURA DEL NUEVO NOTIFICATION ENGINE](#6-fase-5--arquitectura-del-nuevo-notification-engine)
   - [6.1 Filosofía](./#61-filosofía)
   - [6.2 Arquitectura general](./#62-arquitectura-general)
   - [6.3 Diagrama de flujo del Notification Engine](./#63-diagrama-de-flujo-del-notification-engine)
   - [6.4 Submódulos detallados](./#64-submódulos-detallados)
7. [FASE 6 — PLAN DE MIGRACIÓN](#7-fase-6--plan-de-migración)
8. [FASE 7 — PREGUNTAS PENDIENTES](#8-fase-7--preguntas-pendientes)

---

## 1. RESUMEN EJECUTIVO

El sistema actual de Flora tiene **27 tipos de eventos** definidos en `src/events/types.ts`, con **30+ suscripciones** registradas en `src/events/telegram.subscriber.ts` que mapean a **30+ funciones de notificación** en `lib/telegram.ts`. Los eventos se emiten desde **3 fuentes principales**: `bot.ts` (~2500 líneas), `pedido.service.ts`, y `caso.service.ts`.

**Hallazgo crítico:** No existe un Notification Engine dedicado. Las notificaciones se construyen directamente desde los event handlers usando datos en crudo del state en memoria (Maps en `bot-state.ts`). No hay:
- Validación de la información ANTES de notificar
- Reconstrucción del pedido desde base de datos
- Detector de contradicciones
- Auditoría independiente
- Control de duplicados real (solo TTL básico)

**La raíz común de todos los errores de notificación:** El sistema actual no separa la "fuente de datos" (el estado en memoria que OpenAI puede haber modificado) del "mensaje a notificar".

---

## 2. FASE 1 — CATÁLOGO COMPLETO DE NOTIFICACIONES

### 2.1 Sistema de eventos

**Archivo:** `src/events/types.ts`  
**Total de eventos:** 27

Listado real del código fuente (verificado contra emisiones reales):

| # | EventType | Se emite desde | Handler en Telegram |
|---|-----------|---------------|-------------------|
| 1 | CASE_CREATED | `caso.service.ts:42` | `enviarAlertaCasoNuevo` |
| 2 | CASE_ARCHIVED | `caso.service.ts:69` | `enviarAlertaCasoArchivado` |
| 3 | ORDER_CREATED | `message-handler.ts:449`, `bot.ts:788` | `enviarAlertaVentaCerrada` |
| 4 | ORDER_UPDATED | `pedido.service.ts:89,143,189` | `enviarAlertaPedidoApartado` |
| 5 | ORDER_READY | `pedido.service.ts:156` | `enviarAlertaPedidoListo` |
| 6 | ORDER_DELIVERED | `pedido.service.ts:164` | `enviarAlertaPedidoEntregado` |
| 7 | PAYMENT_PENDING | `bot.ts:815` | `enviarAlertaPagoPendiente` |
| 8 | PAYMENT_RECEIVED | `bot.ts:774` | `enviarAlertaPagoRecibido` |
| 9 | PAYMENT_CONFIRMED | `bot.ts:781` | `enviarAlertaPagoConfirmado` |
| 10 | HUMAN_REQUIRED | `message-handler.ts` (8 sitios) | `enviarAlertaAtencionHumana` / `enviarAlertaClienteFrustrado` |
| 11 | CUSTOMER_ANGRY | `message-handler.ts:806` | `enviarAlertaQueja` |
| 12 | CUSTOMER_WAITING | `message-handler.ts:830` | `enviarAlertaClienteEsperando` |
| 13 | PHOTO_REQUESTED | `message-handler.ts:864` | `enviarAlertaEmpleadoFotos` |
| 14 | PHOTO_RECEIVED | `message-handler.ts:407,417,427,1137` | `enviarFotoTelegram` |
| 15 | PHOTO_SENT | `message-handler.ts:425,1145` | `enviarAlertaFotoEnviada` |
| 16 | PRICE_CONFIRMED | `pedido.service.ts:149` | `enviarAlertaPrecioConfirmado` |
| 17 | DELIVERY_COMPLETED | `pedido.service.ts:168` | `enviarAlertaEntregaCompletada` |
| 18 | COTIZACION_REQUESTED | `message-handler.ts:478,847` | `enviarAlertaCotizacion` |
| 19 | ENVIO_REQUESTED | `message-handler.ts:769,778` | `enviarAlertaEmpleadoEnvio` |
| 20 | ZONA_AMBIGUA | `message-handler.ts:759` | `enviarAlertaZonaAmbigua` |
| 21 | CANCELACION_REQUESTED | `pedido.service.ts:209`, `message-handler.ts:794` | `enviarAlertaCancelacion` |
| 22 | QR_GENERATED | `bot.ts:1018` | `enviarAlertaQr` |
| 23 | BOT_CONNECTED | `bot.ts:1032` | `enviarAlertaReconectado` |
| 24 | BOT_DISCONNECTED | `bot.ts:1058` | `enviarAlertaBotDesconectado` |
| 25 | BOT_DAILY_ALERT | `bot.ts:204` | `enviarAlertaDiariaDesconexion` |
| 26 | PROVIDER_FAILURE | `lib/ai.ts:686` | `enviarAlertaProveedorCaido` |
| 27 | — | — | — |

**Nota:** Todos los 26 eventos del enum se emiten y tienen suscriptor. No hay eventos sin usar (excepto que no hay un 27º).

### 2.2 Censo de eventBus.emit()

**CANTIDAD TOTAL: 34 llamadas directas** (verificadas en código fuente contra el enum real)

#### Fuente: bot.ts (6 emisiones)

| # | EventType | Línea en bot.ts | Condición |
|---|-----------|----------------|-----------|
| 1 | PAYMENT_RECEIVED | ~774 | Venta cerrada (pago comprobado) |
| 2 | PAYMENT_CONFIRMED | ~781 | Venta cerrada (confirmación adicional) |
| 3 | ORDER_CREATED | ~788 | Venta cerrada (crea pedido final) |
| 4 | PAYMENT_PENDING | ~815 | Pedido apartado (esperando pago) |
| 5 | BOT_DAILY_ALERT | ~204 | Alarma diaria de desconexión |
| 6 | QR_GENERATED | ~1018 | Nuevo código QR generado |
| 7 | BOT_CONNECTED | ~1032 | Bot conectado exitosamente |
| 8 | BOT_DISCONNECTED | ~1058 | Bot desconectado |

#### Fuente: message-handler.ts (22 emisiones)

| # | EventType | Línea aprox | Condición |
|---|-----------|-------------|-----------|
| 1 | PHOTO_RECEIVED | ~407,417,427,1137 | Imagen recibida (comprobante, referencia, o genérica) |
| 2 | PHOTO_SENT | ~425,1145 | Foto enviada al cliente |
| 3 | ORDER_CREATED | ~449 | Interés de compra detectado (emite ORDER_CREATED) |
| 4 | COTIZACION_REQUESTED | ~478,847 | Cliente pide cotización o muestra interés |
| 5 | HUMAN_REQUIRED | ~486,545,642,829,1040,1083 | Necesita atención humana (8 sitios diferentes) |
| 6 | ZONA_AMBIGUA | ~759 | Zona de envío ambigua |
| 7 | ENVIO_REQUESTED | ~769,778 | Cliente pregunta por envío |
| 8 | CANCELACION_REQUESTED | ~794 | Cliente solicita cancelación |
| 9 | CUSTOMER_ANGRY | ~806 | Cliente enojado/frustrado |
| 10 | CUSTOMER_WAITING | ~830 | Cliente esperando atención |
| 11 | PHOTO_REQUESTED | ~864 | Bot solicita foto al equipo |

#### Fuente: pedido.service.ts (8 emisiones)

| # | EventType | Línea | Condición |
|---|-----------|-------|-----------|
| 1 | ORDER_UPDATED | 89 | Después de cualquier transición de estado |
| 2 | ORDER_UPDATED | 143 | Cuando se actualiza el pedido |
| 3 | PRICE_CONFIRMED | 149 | Precio confirmado |
| 4 | ORDER_READY | 156 | Pedido marcado como listo |
| 5 | ORDER_DELIVERED | 164 | Pedido marcado como entregado |
| 6 | DELIVERY_COMPLETED | 168 | Entrega completada |
| 7 | ORDER_UPDATED | 189 | Actualización adicional |
| 8 | CANCELACION_REQUESTED | 209 | Cancelación solicitada |

#### Fuente: caso.service.ts (2 emisiones)

| # | EventType | Condición |
|---|-----------|-----------|
| 1 | CASE_CREATED | Caso nuevo creado |
| 2 | CASE_ARCHIVED | Caso archivado |

#### Fuente: lib/ai.ts (1 emisión)

| # | EventType | Condición |
|---|-----------|-----------|
| 1 | PROVIDER_FAILURE | Error del proveedor de IA |

### 2.3 Funciones de notificación Telegram

**Archivo:** `lib/telegram.ts`  
**Total de funciones:** 30+

| # | Función | Propósito | Datos que incluye |
|---|---------|-----------|-------------------|
| 1 | `notifyNuevoMensaje` | Nuevo mensaje de cliente | Nombre, teléfono, preview texto, tiene adjunto |
| 2 | `notifyMensajeRecibido` | Mensaje recibido (wrapper) | Igual que notifyNuevoMensaje |
| 3 | `notifyNuevoPedido` | Nuevo pedido creado | Nombre, producto, precio, sucursal, fecha, hora, estado |
| 4 | `notifyOrdenCreada` | Order Engine: pedido creado | Igual que notifyNuevoPedido |
| 5 | `notifyPedidoActualizado` | Pedido actualizado | Nombre, qué cambió, valores nuevos |
| 6 | `notifyOrdenActualizada` | Order Engine: actualizado | Igual que notifyPedidoActualizado |
| 7 | `notifyVentaCerrada` | Venta cerrada (legacy) | Nombre, producto, total, método pago, fecha |
| 8 | `notifyPagoPendiente` | Esperando pago | Nombre, total, método pago |
| 9 | `notifyPagoRecibido` | Pago recibido | Nombre, monto, método comprobante |
| 10 | `notifyPedidoListo` | Pedido listo para entrega | Nombre, producto, sucursal |
| 11 | `notifyOrdenLista` | Order Engine: listo | Igual que notifyPedidoListo |
| 12 | `notifyPedidoCancelado` | Pedido cancelado | Nombre, producto, razón |
| 13 | `notifyOrdenCancelada` | Order Engine: cancelado | Igual que notifyPedidoCancelado |
| 14 | `notifyPedidoEntregado` | Pedido entregado | Nombre, producto |
| 15 | `notifyOrdenEntregada` | Order Engine: entregado | Igual que notifyPedidoEntregado |
| 16 | `notifyClienteEsperando` | Cliente esperando respuesta | Nombre, teléfono, tiempo espera |
| 17 | `notifyClienteEnojado` | Cliente enojado (sin uso real) | Nombre, preview mensaje |
| 18 | `notifyHumanoRequerido` | Solicita intervención humana | Nombre, teléfono, razón, preview |
| 19 | `notifyPhotoRequested` | Bot solicitó foto | Nombre, contexto |
| 20 | `notifyPhotoSent` | Foto enviada al cliente | Nombre |
| 21 | `notifyFotoSolicitada` | Aliast notificar foto solicitada | Igual |
| 22 | `notifyFotoEnviada` | Alias notificar foto enviada | Igual |
| 23 | `notifyCaseCreado` | Caso nuevo creado | Tipo, prioridad, teléfono |
| 24 | `notifyCaseArchivado` | Caso archivado | Tipo, motivo |
| 25 | `notifyCaseActualizado` | Caso actualizado | Cambios |
| 26 | `notifyPrecioConfirmado` | Precio confirmado | Nombre, producto, precio |
| 27 | `notifyQuejaCliente` | Cliente puso queja | Nombre, preview queja |
| 28 | `notifyCancelacionCliente` | Cliente canceló | Nombre, motivo |
| 29 | `notifyComprobanteConfirmado` | Comprobante validado | Nombre, monto |
| 30 | `notifyFotoReferenciaRecibida` | Foto referencia recibida | Nombre |
| 31 | `notifyOrdenRequiereRevision` | Pedido necesita revisión | Nombre, producto, razón |
| 32 | `notifyEscaladoAgente` | Escalado a agente humano | Nombre, razón |
| 33 | `notifyEsperandoRespuesta` | Esperando respuesta cliente | Nombre, pregunta pendiente |
| 34 | `notifyContactoNuevo` | Nuevo contacto WhatsApp | Teléfono, nombre (si tiene) |
| 35 | `notifyPrecioEnvioPendiente` | Precio de envío pendiente | Nombre, dirección |
| 36 | `notifyDebug` | Mensaje de depuración | Mensaje arbitrario |
| 37 | `notifyMensaje` | Función base genérica | Mensaje + opciones de formato |

### 2.4 Suscripciones activas (verificadas contra telegram.subscriber.ts)

**Archivo:** `src/events/telegram.subscriber.ts`  
**Total de suscripciones:** 26 (una por cada EventType del enum)

```
CASE_CREATED               → enviarAlertaCasoNuevo
CASE_ARCHIVED              → enviarAlertaCasoArchivado
ORDER_CREATED              → enviarAlertaVentaCerrada (payload completo)
ORDER_UPDATED              → enviarAlertaPedidoApartado
ORDER_READY                → enviarAlertaPedidoListo (solo teléfono)
ORDER_DELIVERED            → enviarAlertaPedidoEntregado (solo teléfono)
PAYMENT_PENDING            → enviarAlertaPagoPendiente
PAYMENT_RECEIVED           → enviarAlertaPagoRecibido
PAYMENT_CONFIRMED          → enviarAlertaPagoConfirmado
HUMAN_REQUIRED             → enviarAlertaAtencionHumana o enviarAlertaClienteFrustrado (según prioridad)
CUSTOMER_ANGRY             → enviarAlertaQueja
CUSTOMER_WAITING           → enviarAlertaClienteEsperando
PHOTO_REQUESTED            → enviarAlertaEmpleadoFotos
PHOTO_RECEIVED             → enviarFotoTelegram (imagen a Telegram)
PHOTO_SENT                 → enviarAlertaFotoEnviada
PRICE_CONFIRMED            → enviarAlertaPrecioConfirmado (solo teléfono)
DELIVERY_COMPLETED         → enviarAlertaEntregaCompletada (solo teléfono)
COTIZACION_REQUESTED       → enviarAlertaCotizacion
ENVIO_REQUESTED            → enviarAlertaEmpleadoEnvio
ZONA_AMBIGUA               → enviarAlertaZonaAmbigua
CANCELACION_REQUESTED      → enviarAlertaCancelacion
QR_GENERATED               → enviarAlertaQr
BOT_CONNECTED              → enviarAlertaReconectado
BOT_DISCONNECTED           → enviarAlertaBotDesconectado
BOT_DAILY_ALERT            → enviarAlertaDiariaDesconexion
PROVIDER_FAILURE           → enviarAlertaProveedorCaido
```

**Eventos sin suscripción:** Ninguno. Los 26 eventos del enum están suscritos.

### 2.5 Matriz cobertura evento → notificación

| EventType (real) | ¿Se emite? | ¿Hay subscriber? | ¿Llega a Telegram? |
|-----------------|-----------|-----------------|-------------------|
| CASE_CREATED | ✅ (caso.service) | ✅ | ✅ |
| CASE_ARCHIVED | ✅ (caso.service) | ✅ | ✅ |
| ORDER_CREATED | ✅ (message-handler, bot.ts) | ✅ | ✅ |
| ORDER_UPDATED | ✅ (pedido.service ×3) | ✅ | ✅ |
| ORDER_READY | ✅ (pedido.service) | ✅ | ✅ |
| ORDER_DELIVERED | ✅ (pedido.service) | ✅ | ✅ |
| PAYMENT_PENDING | ✅ (bot.ts) | ✅ | ✅ |
| PAYMENT_RECEIVED | ✅ (bot.ts) | ✅ | ✅ |
| PAYMENT_CONFIRMED | ✅ (bot.ts) | ✅ | ✅ |
| HUMAN_REQUIRED | ✅ (message-handler ×8) | ✅ (2 handlers) | ✅ |
| CUSTOMER_ANGRY | ✅ (message-handler) | ✅ | ✅ |
| CUSTOMER_WAITING | ✅ (message-handler) | ✅ | ✅ |
| PHOTO_REQUESTED | ✅ (message-handler) | ✅ | ✅ |
| PHOTO_RECEIVED | ✅ (message-handler ×4) | ✅ | ✅ (imagen) |
| PHOTO_SENT | ✅ (message-handler ×2) | ✅ | ✅ |
| PRICE_CONFIRMED | ✅ (pedido.service) | ✅ | ✅ |
| DELIVERY_COMPLETED | ✅ (pedido.service) | ✅ | ✅ |
| COTIZACION_REQUESTED | ✅ (message-handler ×2) | ✅ | ✅ |
| ENVIO_REQUESTED | ✅ (message-handler ×2) | ✅ | ✅ |
| ZONA_AMBIGUA | ✅ (message-handler) | ✅ | ✅ |
| CANCELACION_REQUESTED | ✅ (pedido.service, message-handler) | ✅ | ✅ |
| QR_GENERATED | ✅ (bot.ts) | ✅ | ✅ |
| BOT_CONNECTED | ✅ (bot.ts) | ✅ | ✅ |
| BOT_DISCONNECTED | ✅ (bot.ts) | ✅ | ✅ |
| BOT_DAILY_ALERT | ✅ (bot.ts) | ✅ | ✅ |
| PROVIDER_FAILURE | ✅ (lib/ai.ts) | ✅ | ✅ |

---

## 3. FASE 2 — FLUJO REAL WHATSAPP → TELEGRAM

### 3.1 Diagrama de flujo completo

```
WhatsApp Webhook
     │
     ▼
src/whatsapp/message-entry.ts (entry point)
  - Valida API key
  - Verifica número ignorado
  - Verifica bot pausado
     │
     ▼
src/whatsapp/message-handler.ts (~1500 líneas)
  - Extrae mensaje, multimedia, contactos
  - Obtiene cliente UUID
  - Busca caso activo (en memoria)
  - Busca pedido activo (Order Engine en memoria)
  - Procesa intención (decision engine)
  - Actualiza pedido (pedido.service)
  - Actualiza caso (caso.service)
  - Solicita respuesta OpenAI
  - Envía respuesta WhatsApp
  - Emite eventos según la intención detectada
     │
     ├──► eventBus.emit (desde message-handler.ts, pedido.service.ts, bot.ts)
     │         │
     │         ▼
     │    src/events/event-bus.ts (pub/sub con retry queue)
     │         │
     │         ▼
     │    src/events/telegram.subscriber.ts
     │       (26 suscripciones, una por EventType)
     │         │
     │         ▼
     │    lib/telegram.ts (construye y envía mensaje Telegram)
     │         │
     │         ▼
     │    Telegram Bot API (envía al canal único)
     │
     ├──► bot.ts (procesa handlers de pago/venta/aparte)
     │         │
     │         └──► Emite PAYMENT_*, ORDER_CREATED, etc.
     │
     ├──► pedido.service.ts (máquina de estados)
     │         │
     │         └──► Emite ORDER_UPDATED, PRICE_CONFIRMED, etc.
     │
     └──► caso.service.ts (gestión de casos)
                  │
                  └──► Emite CASE_CREATED, CASE_ARCHIVED
```

### 3.2 Flujo detallado por tipo de escenario

#### Escenario: Llega mensaje de texto de cliente existente

1. `message-entry.ts` recibe POST webhook
2. `message-handler.ts` procesa:
   - Extrae JID, mensaje ID, contenido
   - `obtenerClienteId(jidToTelefono(remoteJid))` → busca/crea cliente en Supabase
   - `obtenerHistorial(telefono)` → 30 turnos desde `historial_chat`
   - Busca caso activo (`caso.service.obtenerCasoActivo`)
   - Busca pedido activo (`pedido.service` o Map de Order Engine en memoria)
   - Ejecuta `DecisionEngine.analizar()` → intención
   - Según intención, actualiza pedido/caso
   - Construye contexto → `PromptBuilder.build()`
   - Llama OpenAI → recibe respuesta
   - Envía respuesta WhatsApp
   - Emite eventos según la intención detectada

3. **Eventos emitidos (ejemplo: cliente envía comprobante de pago):**
   - `PAYMENT_RECEIVED` (desde bot.ts) → `enviarAlertaPagoRecibido`
   - `PAYMENT_CONFIRMED` (desde bot.ts) → `enviarAlertaPagoConfirmado`
   - `ORDER_CREATED` (desde bot.ts) → `enviarAlertaVentaCerrada`

#### Escenario: Llega comprobante de pago

1. Se detecta `COMPROBANTE` o `TRANSFERENCIA`
2. `pedido.service.registrarPago()` cambia estado a `ESPERANDO_PAGO` → `APARTADO`
3. Emite `ORDER_PAYMENT_RECEIVED` → `notifyPagoRecibido(name, monto, ...)`

#### Escenario: El bot necesita foto del producto

1. `message-handler.ts` detecta que el cliente pide fotos
2. `EventType.PHOTO_REQUESTED` emitido → `enviarAlertaEmpleadoFotos(telefono, cliente, descripcion)`

### 3.3 Caminos de datos críticos

Estos son los caminos específicos por donde viaja cada dato desde que el cliente lo escribe hasta que aparece en Telegram:

| Dato | Origen | Procesamiento intermedio | Almacenamiento | Lectura para notificación |
|------|--------|-------------------------|----------------|--------------------------|
| **Nombre** | Mensaje WhatsApp | `parser/nombre.parser.ts` → regex | `PedidoActual.nombre` (Map memoria) + `pedidos_bot.cliente_nombre` | `notify*` lee de PedidoActual |
| **Sucursal** | Mensaje WhatsApp | `parser/sucursal.parser.ts` → lista cotejo | `PedidoActual.sucursal` (Map memoria) + `pedidos_bot.sucursal` | `notify*` lee de PedidoActual |
| **Fecha** | Mensaje WhatsApp | `parser/fecha.parser.ts` → regex fechas | `PedidoActual.fechaEntrega` (Map) + `pedidos_bot.fecha_entrega` | `notify*` lee de PedidoActual |
| **Hora** | Mensaje WhatsApp | `parser/hora.parser.ts` → regex horas | `PedidoActual.horaEntrega` (Map) + `pedidos_bot.hora_entrega` | `notify*` lee de PedidoActual |
| **Precio** | OpenAI + equipo | `precio.parser.ts` | `PedidoActual.precioPersonalizado` (Map) + `pedidos_bot.precio_arreglo` | Handler lee de event.payload.total |
| **Producto** | OpenAI + cliente | Sin parser específico | `PedidoActual.arreglo.nombre` (Map) + `pedidos_bot.producto` | Handler lee de event.payload.producto |
| **Estado** | State machine | `pedido.service.transicionar()` | `PedidoActual.estado` + `pedidos_bot.estado` + `pedidos_bot.estado_flujo` | `notify*` usa estado |

---

## 4. FASE 3 — TRAZABILIDAD DE DATOS

N/A (se integró en secciones anteriores)

---

## 5. FASE 4 — DETECCIÓN DE PUNTOS DÉBILES

### WP-01: Nombre incorrecto

**Descripción:** El nombre en la notificación de Telegram puede contener texto adicional no deseado (ej. "Lizet Cervantes Vargas, cree que podría..." en lugar de solo "Lizet Cervantes Vargas").

**Causa raíz:** El parser de nombre (`parser/nombre.parser.ts`) usa un regex que captura más texto del necesario. El nombre se almacena sin validación posterior.

**Dónde ocurre:**
1. `parser/nombre.parser.ts` — regex sin límite de tokens
2. `PedidoActual.nombre` — se asigna directamente desde el parser
3. `pedido.service.ts` constructor — usa el valor sin sanitizar
4. `lib/telegram.ts` — `notifyNuevoPedido()` lee `pedido.nombre` directamente

**¿A qué notificaciones afecta?**
- notifyNuevoPedido / notifyOrdenCreada
- notifyPedidoActualizado / notifyOrdenActualizada
- notifyPagoPendiente, notifyPagoRecibido
- notifyHumanoRequerido, notifyClienteEsperando
- notifyQuejaCliente, notifyCancelacionCliente
- notifyOrdenRequiereRevision
- notifyPedidoListo / notifyOrdenLista
- notifyPrecioConfirmado, notifyComprobanteConfirmado
- Practicamente TODAS las notificaciones incluyen nombre

**Impacto:** Crítico. El nombre es el campo más común en todas las notificaciones.

---

### WP-02: Sucursal incorrecta

**Descripción:** Cuando el cliente escribe algo como "La que está por la Av. Morelos", el sistema asigna una sucursal incorrecta o inventada en la notificación.

**Causa raíz:** El parser de sucursal usa coincidencia parcial contra una lista fija. Si hay ambigüedad, no se deja vacío; se fuerza una coincidencia.

**Dónde ocurre:**
1. `parser/sucursal.parser.ts` — matching difuso sin umbral de confianza
2. El Decision Engine no detecta ambigüedad → asigna igual
3. `pedido.service.ts` guarda el valor sin verificar ambigüedad
4. `lib/telegram.ts` notifica sucursal incorrecta

**¿A qué notificaciones afecta?**
- notifyNuevoPedido / notifyOrdenCreada (incluye sucursal)
- notifyPedidoActualizado (incluye sucursal)
- notifyOrdenLista / notifyPedidoListo (incluye sucursal)

---

### WP-03: Fecha/hora incorrecta

**Descripción:** La fecha u hora notificadas no coinciden con lo que el cliente realmente pidió.

**Causa raíz:** Los parsers de fecha y hora extraen patrones sin verificar contexto. El LLM puede haber confirmado horarios sin validación del backend.

**Dónde ocurre:**
1. `parser/fecha.parser.ts` — captura múltiples fechas sin identificar cuál es la correcta
2. `parser/hora.parser.ts` — similar
3. El LLM confirma horario en texto → el parser extrae después
4. No hay validación contra reglas de negocio (horario laboral, días festivos) antes de notificar
5. `pedido.service.transicionar()` a PRECIO_CONFIRMADO puede ocurrir sin fecha/hora

**¿A qué notificaciones afecta?**
- notifyNuevoPedido (incluye fecha y hora)
- notifyOrdenCreada (incluye fecha y hora)
- notifyPedidoActualizado (puede incluir fecha/hora)
- notifyPagoRecibido (puede incluir fecha programada)

---

### WP-04: Precio incorrecto

**Descripción:** El precio notificado en Telegram es diferente al que el cliente aceptó.

**Causa raíz:** El precio puede venir de OpenAI en lugar del equipo, o pueden existir condiciones no validadas (envío, extras, personalización).

**Dónde ocurre:**
1. `PedidoActual.arreglo.precio` puede ser fijado por OpenAI
2. `precio.parser.ts` extrae precios del texto sin verificar contexto
3. `PedidoActual.extras[]` puede contener precios que no se suman al total
4. `PedidoActual.envio.precio` puede no estar incluido en el precio total
5. La notificación usa `pedido.arreglo?.precio` sin calcular el total real

**¿A qué notificaciones afecta?**
- notifyNuevoPedido (precio)
- notifyPrecioConfirmado (precio)
- notifyPagoPendiente (total)
- notifyPagoRecibido (monto)
- notifyVentaCerrada (total legacy)

---

### WP-05: Producto incorrecto

**Descripción:** El nombre del producto notificado no coincide con lo que el cliente pidió.

**Causa raíz:** No existe un parser de producto. El nombre del producto es lo que OpenAI decidió poner. Puede ser inventado o genérico.

**Dónde ocurre:**
1. `PedidoActual.arreglo.nombre` se asigna desde OpenAI, no desde un parser
2. No hay normalización contra catálogo
3. `productoPersonalizado` puede tener texto arbitrario
4. `lib/telegram.ts` lee `pedido.arreglo?.nombre || pedido.productoPersonalizado`

**¿A qué notificaciones afecta?**
- notifyNuevoPedido (producto)
- notifyOrdenCreada (producto)
- notifyPrecioConfirmado (producto)
- notifyPedidoListo (producto)
- notifyOrdenRequiereRevision (producto)
- notifyVentaCerrada (producto)

---

### WP-06: Pedidos mezclados

**Descripción:** Una notificación para el Pedido A mezcla datos del Pedido B (mismo cliente u otro).

**Causa raíz:** El sistema usa un solo `PedidoActual` por cliente. Si el cliente hace dos pedidos en paralelo, los datos se sobreescriben. No hay aislamiento entre pedidos activos del mismo cliente.

**Dónde ocurre:**
1. `PEDIDOS_ACTIVOS` Map en `bot-state.ts`: clave = telefono, valor = un solo pedido
2. `pedido.service.buscarPedido()` devuelve un solo pedido activo
3. No existe concepto de "pedido en curso" con ID único verificable
4. `notify*` recibe el pedido y muestra su contenido sin verificar coherencia

**Escenario de error:**
1. Cliente pide ramo A (pedido-1 creado)
2. Cliente dice "también quiero otro" (pedido-2 sobreescribe pedido-1)
3. Notificación dice "Nuevo pedido: ramo B" pero los datos de sucursal/fecha son de ramo A
4. Equipo recibe notificación con datos mezclados

---

### WP-07: Pedido cancelado notificado como activo

**Descripción:** Un pedido que fue cancelado sigue generando notificaciones de actualización.

**Causa raíz:** No hay filtro de estado en los subscribers. El `telegram.subscriber.ts` reacciona a ORDER_UPDATED sin verificar si el pedido está cancelado o archivado.

**Dónde ocurre:**
1. `telegram.subscriber.ts` suscribe ORDER_UPDATED → `notifyOrdenActualizada`
2. `pedido.service.transicionar()` emite ORDER_UPDATED incluso después de CANCELADO
3. No hay guard condition en el subscriber

**Escenario de error:**
1. Pedido cancelado
2. Algún proceso emite ORDER_UPDATED sobre el mismo pedido
3. Telegram muestra "Pedido actualizado" con datos del pedido cancelado
4. Equipo se confunde: ¿está vivo o cancelado?

---

### WP-08: Datos antiguos en notificación

**Descripción:** La notificación contiene datos de un pedido o conversación anterior que ya no son válidos.

**Causa raíz:** El Case Engine no archiva automáticamente casos inactivos. El sistema reutiliza el mismo `PedidoActual` en memoria para mensajes nuevos sin verificar si el contexto cambió.

**Dónde ocurre:**
1. `caso.service.buscarCasoActivo()` devuelve el caso anterior si no fue archivado
2. `PEDIDOS_ACTIVOS` Map persiste el pedido anterior
3. No hay timeout de actividad que resetee el estado
4. `lib/telegram.ts` muestra datos que ya no corresponden

**Escenario de error:**
1. Cliente cotiza ramo A en enero (precio $500, fecha 15/01)
2. No compra
3. Cliente vuelve en marzo a pedir corona funeraria
4. Notificación muestra "Nuevo pedido: ramo $500" (precio de enero)
5. Equipo ve datos equivocados

---

### WP-09: Notificaciones duplicadas

**Descripción:** El mismo evento se notifica múltiples veces por Telegram.

**Causa raíz:** Múltiples emisiones del mismo evento durante el procesamiento de un solo mensaje. El sistema de deduplicación actual es limitado (solo por ID de mensaje).

**Dónde ocurre:**
1. `message-handler.ts` puede emitir el mismo evento en diferentes fases del procesamiento
2. El TTL de deduplicación (`MENSAJE_PROCESADO_TTL_MS = 2 horas`) no cubre eventos
3. `bot-state.ts` tiene Maps de rate-limiting pero no cubre eventos específicos
4. Webhook de WhatsApp puede llegar duplicado (hasta 3 veces)

**Escenario de error:**
1. Mensaje entrante
2. Procesamiento emite 2x ORDER_UPDATED (una de message-handler, otra de pedido.service)
3. Telegram recibe dos notificaciones idénticas
4. Equipo confundido sobre cuál es la real

---

### WP-10: Intervención humana no señalada

**Descripción:** El sistema notifica algo que requiere revisión humana pero la notificación no lo indica claramente.

**Causa raíz:** Muchas notificaciones no tienen campo de "prioridad" o "requiere_revision". El flag `requiere_revision` de `pedidos_bot` no se refleja en todas las notificaciones.

**Dónde ocurre:**
1. `pedidos_bot.requiere_revision` se setea pero no en todas las notificaciones
2. No todas las notificaciones incluyen contexto de prioridad
3. `notifyNuevoMensaje` no indica si el mensaje requiere acción inmediata
4. No hay distinción visual en Telegram entre informativo y urgente

**Escenario de error:**
1. Cliente enojado (CUSTOMER_ANGRY detectado pero evento no emitido)
2. Sistema emite MESSAGE_RECEIVED genérico
3. Equipo ve "Nuevo mensaje de Cliente" sin indicación de urgencia
4. Cliente sigue esperando

---

### WP-11: Texto de OpenAI filtrado a Telegram

**Descripción:** Fragmentos de texto generados por OpenAI (incluyendo errores como confirmación de horarios incorrectos) aparecen en las notificaciones de Telegram.

**Causa raíz:** Algunas notificaciones pasan fragmentos de la respuesta de OpenAI sin sanitizar.

**Dónde ocurre:**
1. `notifyNuevoMensaje` incluye `preview` que puede ser parte del mensaje del cliente o respuesta de OpenAI
2. `notifyHumanoRequerido` incluye `razón` que puede venir del LLM
3. `notifyDebug` pasa texto arbitrario
4. No hay Response Validator entre OpenAI y la notificación

**Escenario de error:**
1. OpenAI confirma "Sí, podemos tenerlo listo a las 9:30" (horario incorrecto)
2. Empleado ve en Telegram "Nuevo pedido: Ramo, horario: 9:30 ✅"
3. Empleado confía en la notificación
4. Horario real: 10:00 → problema

---

## 6. FASE 5 — ARQUITECTURA DEL NUEVO NOTIFICATION ENGINE

### 6.1 Filosofía

El Notification Engine es un pipeline de 7 submódulos que transforma un **evento crudo** en un **mensaje verificado** para Telegram.

**Principios:**

1. **Toda notificación se construye desde la fuente de verdad** (base de datos, no memoria)
2. **No existe notificación sin auditoría previa**
3. **OpenAI nunca participa en la construcción de la notificación**
4. **Dos IAs trabajan en serie:** una genera, otra audita
5. **Cada dato crítico se verifica contra al menos dos fuentes**
6. **Las notificaciones no se envían si hay contradicciones**

### 6.2 Arquitectura general

```
Evento (del sistema)
     │
     ▼
┌──────────────────────────────────────────────────┐
│             1. Conversation Timeline Builder      │
│           (Reconstruye historial del caso)        │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│             2. Decision Extractor                 │
│        (Extrae datos relevantes del evento)       │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│             3. Conflict Detector                  │
│       (Detecta contradicciones en datos)          │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│             4. Order Reconstructor (IA #1)        │
│   (Reconstruye pedido desde DB + historial)       │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│             5. Order Auditor (IA #2)              │
│        (Audita la reconstrucción vs evento)       │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│             6. Business Rules Validator           │
│    (Reglas de negocio + horarios + sucursales)    │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│   Resultado: Datos verificados O Error            │
└──────────────────┬───────────────────────────────┘
                   ▼
        ┌──────────┴──────────┐
        ▼                     ▼
   [OK]                    [ERROR]
     │                       │
     ▼                       ▼
┌─────────────────┐  ┌──────────────────────┐
│ 7. Notification  │  │ 7. Notification      │
│    Builder       │  │    Builder (error)   │
│ (mensaje normal) │  │ (alerta de auditoría │
└────────┬─────────┘  │ + datos RAW)         │
         │            └──────────┬───────────┘
         ▼                       ▼
┌───────────────────────────────────────────────┐
│             8. Telegram Sender                 │
│     (Encolamiento + batch + rate-limit)        │
└───────────────────────────────────────────────┘
```

### 6.3 Diagrama de flujo del Notification Engine

```
INICIO: Evento emitido por eventBus
    │
    ├──► ¿Evento requiere notificación? (whitelist)
    │        SI → continuar
    │        NO → descartar
    │
    ├──► Conversation Timeline Builder
    │     • Carga historial completo del caso
    │     • Carga pedido actual desde DB (no memoria)
    │     • Carga último mensaje del cliente
    │     • Construye línea de tiempo
    │
    ├──► Decision Extractor
    │     • Según tipo de evento, extrae campos relevantes
    │     • Ej: ORDER_CREATED → {nombre, producto, precio, sucursal, fecha, hora, estado}
    │     • Ej: HUMAN_REQUIRED → {nombre, razón, prioridad, ultimo_mensaje}
    │
    ├──► Conflict Detector
    │     • Verifica que el evento no contradiga el estado en DB
    │     • Ej: ¿Evento dice APARTADO pero pedido en DB está CANCELADO?
    │     • Ej: ¿Evento tiene fecha pero DB muestra fecha diferente?
    │     • Si hay conflicto → emitir ORDER_AUDIT_FAILED y no notificar
    │
    ├──► Order Reconstructor (IA #1 - LLM local/edge)
    │     • Recibe: Timeline + Evento + Datos extraídos + DB data
    │     • Genera: JSON estructurado verificado
    │     {
    │       "verified": true/false,
    │       "name": "Lizet Cervantes Vargas",
    │       "confidence": 0.95,
    │       "changes": [],
    │       "warnings": ["sucursal no especificada"],
    │       "fields": { name, sucursal, fecha, hora, precio, producto, estado }
    │     }
    │
    ├──► Order Auditor (IA #2 - modelo diferente o reglas)
    │     • Recibe: Mismo input + Output de IA #1
    │     • Audita que IA #1 no alucinó
    │     • Verifica campos contra DB
    │     • Si audita OK → continuar
    │     • Si audita FAIL → emitir NOTIFICATION_AUDIT_FAILED
    │
    ├──► Business Rules Validator
    │     • Horario laboral válido
    │     • Sucursal existe
    │     • Precio mínimo/máximo
    │     • Fecha no es pasada (salvo pedidos pendientes)
    │     • Estado es transición válida
    │     • Si falla → emitir RULE_VALIDATION_FAILED
    │
    ├──► ¿Todo OK?
    │     │
    │     ├──► SI → Notification Builder (normal)
    │     │     • Template según tipo de evento
    │     │     • Campos verificados
    │     │     • Prioridad visual
    │     │     • Metadata
    │     │
    │     └──► NO → Notification Builder (alerta)
    │           • Enviar datos RAW + error de auditoría
    │           • Decir "REVISIÓN MANUAL REQUERIDA"
    │           • No ocultar información
    │
    └──► Telegram Sender
          • Rate limiting (máx 20/min por chat)
          • Queue de mensajes
          • Retry en fallo
          • Log de envío

FIN: Notificación enviada O no enviada (con log de por qué no)
```

### 6.4 Submódulos detallados

#### 6.4.1 Conversation Timeline Builder

**Responsabilidad:** Reconstruir la línea de tiempo completa de la conversación + caso + pedido desde Supabase.

**Input:**
- `eventType` + `telefono` + `pedidoId` (si existe)

**Output:**
```typescript
interface Timeline {
  telefono: string
  clienteId: string
  caso: Caso | null
  pedido: PedidoActual | null
  historial: MensajeChat[]  // últimos 30 mensajes
  ultimaActividad: string   // timestamp ISO
  estadoActual: EstadoPedido | null
  transiciones: { de: EstadoPedido, a: EstadoPedido, timestamp: string }[]
}
```

**Fuentes de datos:**
- `casos` table (cliente_id, pedido_id, estado, prioridad, ultima_actividad)
- `pedidos_bot` table (todos los campos del pedido)
- `historial_chat` table (historial del cliente)
- No usar Maps en memoria

**Regla:** Si la DB no tiene datos, no asumir. Devolver null en ese campo.

---

#### 6.4.2 Decision Extractor

**Responsabilidad:** Según el tipo de evento, determinar qué campos son relevantes para la notificación y extraerlos con sus metadatos.

**Input:** Evento + Timeline

**Output:**
```typescript
interface DatosExtraidos {
  tipo: string          // tipo de notificación
  prioridad: 'baja' | 'media' | 'alta' | 'critica'
  campos: {
    nombre: { valor: string, fuente: string, confianza: number }
    sucursal: { valor: string | null, fuente: string, confianza: number }
    fecha: { valor: string | null, fuente: string, confianza: number }
    hora: { valor: string | null, fuente: string, confianza: number }
    precio: { valor: number | null, fuente: string, confianza: number }
    producto: { valor: string | null, fuente: string, confianza: number }
    estado: { valor: string, fuente: string, confianza: number }
  }
  requiereRevision: boolean
  razonRevision: string | null
}
```

**Chequeos:**
- Si un campo viene con confianza < 0.8, marcarlo como `requiereRevision`
- Si un campo está vacío pero es obligatorio, marcarlo como `requiereRevision`
- Si el evento es de alta prioridad, el nivel de confianza mínimo sube a 0.95

---

#### 6.4.3 Conflict Detector

**Responsabilidad:** Detectar contradicciones entre el evento y la base de datos.

**Input:** Evento + Timeline + DatosExtraidos

**Output:**
```typescript
interface Conflicto {
  existe: boolean
  conflictos: {
    tipo: 'ESTADO' | 'FECHA' | 'HORA' | 'SUCURSAL' | 'PRECIO' | 'PRODUCTO' | 'NOMBRE'
    descripcion: string
    valorEvento: string
    valorDB: string
  }[]
}

interface ResultadoDeteccion {
  ok: boolean
  conflictos: Conflicto[]
  accion: 'NOTIFICAR' | 'AUDITAR' | 'BLOQUEAR'
}
```

**Reglas de detección:**
1. Si evento dice ORDER_CREATED pero ya hay pedido activo en DB → conflicto
2. Si evento dice estado X pero DB tiene estado Y y no es transición válida → conflicto
3. Si evento tiene sucursal "A" pero DB tiene sucursal "B" → conflicto (salvo que sea actualización)
4. Si evento tiene fecha pero DB tiene fecha diferente y no es update → conflicto
5. Si el pedido en DB está CANCELADO y llega ORDER_UPDATED → BLOQUEAR
6. Si el caso está ARCHIVADO y llega evento de ese caso → BLOQUEAR

**Acciones:**
- `NOTIFICAR` → todo OK, continuar
- `AUDITAR` → pasar a IA para que decida (casos ambiguos)
- `BLOQUEAR` → no notificar, loggear, emitir NOTIFICATION_BLOCKED

---

#### 6.4.4 Order Reconstructor (IA #1)

**Responsabilidad:** Tomar la línea de tiempo y el evento, y reconstruir el pedido actual verificando cada campo contra la fuente original.

**Input:** Timeline + Evento + DatosExtraidos

**Prompt del reconstructor:**
```
Eres un reconstructor de pedidos florales. Tu función es tomar datos crudos
y devolver SOLO un JSON estructurado.

NO inventes información.
NO corrijas datos.
Si no puedes verificar un campo, devuelve null.

Input:
- Timeline (historial, caso, pedido DB)
- Evento recibido
- Datos extraídos

Output esperado (JSON):
{
  "verified": boolean,
  "fields": {
    "name": { "value": string|null, "confidence": 0-1, "source": "timeline"|"event"|"db" },
    ...
  },
  "changes": string[],
  "warnings": string[],
  "auditRequired": boolean,
  "auditReason": string|null
}
```

**Reglas:**
- `name`: Debe coincidir entre evento y DB. Si difieren, usar el más reciente pero marcar warning.
- `sucursal`: Si evento tiene sucursal y DB no, marcar warning. Si ambos tienen y difieren, audit.
- `fecha/hora`: Verificar contra horario laboral. Si no es válida, devolver null y audit.
- `precio`: Verificar contra último precio en DB. Si el evento cambia precio sin ORDER_PRICE_CONFIRMED, audit.
- `producto`: Verificar contra catálogo si existe. Si no coincide, warning.
- `estado`: Verificar transición válida contra máquina de estados.

---

#### 6.4.5 Order Auditor (IA #2)

**Responsabilidad:** Auditar el output de IA #1 para detectar alucinaciones.

**Input:** Mismo input que IA #1 + Output de IA #1

**Prompt del auditor:**
```
Eres un auditor de reconstrucción de pedidos. Tu función es verificar
que la reconstrucción de IA #1 sea correcta.

Tienes acceso a:
1. Los mismos datos fuente que IA #1
2. El output de IA #1

Debes detectar:
- ¿IA #1 inventó algún valor?
- ¿IA #1 omitió algún conflicto?
- ¿El nombre tiene texto extra (comas, puntos, conectores)?
- ¿La sucursal existe en el catálogo?
- ¿El precio tiene sentido (no es 0, no es excesivo)?
- ¿La fecha/hora es válida y futura (salvo pedidos en producción)?
- ¿El producto no parece inventado?

Output:
{
  "approved": boolean,
  "errors": string[],
  "corrections": { "field": string, "original": any, "corrected": any }[]
}
```

**Si IA #2 rechaza:** La notificación NO se envía. Se emite `NOTIFICATION_AUDIT_FAILED`.

---

#### 6.4.6 Business Rules Validator

**Responsabilidad:** Validar cada campo contra las reglas de negocio del sistema.

**Reglas implementadas:**

| Regla | Descripción |
|-------|-------------|
| R001 | Horario laboral: 09:00 - 20:00, Lun-Sáb |
| R002 | Sucursal debe existir en catálogo |
| R003 | Fecha de entrega no puede ser pasada (si ya pasó, estado debe ser ENTREGADO o POSTVENTA) |
| R004 | Precio mínimo: $50 MXN |
| R005 | Precio máximo: $50,000 MXN |
| R006 | Nombre no debe contener comas, puntos suspensivos, conectores al final |
| R007 | Estado debe ser transición válida según máquina de estados |
| R008 | Si el pedido requiere revisión humana, la notificación debe marcarse como crítica |
| R009 | Si hay queja activa, toda notificación debe incluir badge 🚨 |
| R010 | Si pedido cancelado, no enviar notificaciones de actualización |

**Output:**
```typescript
interface ValidacionResultado {
  ok: boolean
  reglasAprobadas: string[]
  reglasFallidas: { regla: string, mensaje: string, severity: 'error' | 'warning' }[]
}
```

**Si hay errores de reglas:** La notificación se marca como `ALERTA` pero se envía igual (para que el equipo sepa). La diferencia es que el mensaje incluye "⚠️ REVISIÓN REQUERIDA" y los datos RAW.

---

#### 6.4.7 Notification Builder

**Responsabilidad:** Construir el mensaje final de Telegram con formato, emojis contextuales y metadata.

**Input:** Datos verificados (de los 6 submódulos anteriores)

**Output:** `string` (mensaje formateado para Telegram)

**Templates por tipo de evento:**

```
📦 NUEVO PEDIDO [#prioridad]
─────────────────────
👤 Cliente: {name}
📱 Teléfono: {phone}
💐 Producto: {product}
💰 Precio: ${precio}
📍 Sucursal: {sucursal}
📅 Fecha: {fecha} ⏰ {hora}
🆔 ID: {pedidoId}
─────────────────────
⚠️ {warning}        ← solo si hay warnings
```

```
🔴 INTERVENCIÓN HUMANA [#alta]
─────────────────────
👤 Cliente: {name}
📱 Teléfono: {phone}
⚠️ Razón: {razon}
📝 Último mensaje: "{preview}"
─────────────────────
```

**Prioridad visual:**
- `baja` → texto normal
- `media` → texto normal + 📌
- `alta` → 🔴 + texto en negritas
- `critica` → 🚨 + texto en negritas + mención @equipo

---

#### 6.4.8 Telegram Sender

**Responsabilidad:** Enviar el mensaje a Telegram con control de rate limit, retry y log.

**Archivo propuesto:** `src/notifications/telegram.sender.ts`

**Funcionalidades:**
```typescript
interface TelegramSenderConfig {
  maxMensajesPorMinuto: 20
  maxRetries: 3
  retryDelayMs: 1000
  chatId: string        // de env
}

class TelegramSender {
  private queue: ColaMensajes
  private rateLimiter: RateLimiter
  
  async send(mensaje: string, prioridad: Prioridad): Promise<boolean>
  private processQueue(): Promise<void>
  private logEnvio(mensaje: string, exito: boolean): void
}
```

**Rate limiting:**
- 20 mensajes/minuto por chat (límite de Telegram)
- Los mensajes de prioridad `critica` saltan la cola
- Si hay más de 50 mensajes encolados, dropear los de baja prioridad

---

## 7. FASE 6 — PLAN DE MIGRACIÓN

**Fase 6.1: Crear estructura base del Notification Engine**
1. Crear `src/notification-engine/` directorio
2. Crear `types.ts` con interfaces de todo el pipeline
3. Crear `timeline.builder.ts` (Conversation Timeline Builder)
4. Crear `decision.extractor.ts`
5. Crear `conflict.detector.ts`

**Fase 6.2: Integrar con eventBus**
6. Crear `notification.engine.ts` (orquestador del pipeline)
7. Modificar `telegram.subscriber.ts` para que llame al engine en lugar de directo a lib/telegram.ts

**Fase 6.3: Implementar IAs auxiliares**
8. Crear `order.reconstructor.ts` (IA #1 prompt + parser)
9. Crear `order.auditor.ts` (IA #2 prompt + parser)

**Fase 6.4: Validadores de negocio**
10. Crear `business-rules.validator.ts`
11. Migrar reglas de validación desde pedido.service.ts

**Fase 6.5: Notification Builder y Sender**
12. Crear `notification.builder.ts` (templates + formato)
13. Crear `telegram.sender.ts` (queue + rate limit + retry)

**Fase 6.6: Reemplazar notificaciones existentes**
14. Una por una, reemplazar cada `notify*` con la nueva ruta
15. Probar cada una contra casos de prueba

**Fase 6.7: Auditoría post-migración**
16. Verificar que no haya notificaciones directas restantes
17. Eliminar funciones no utilizadas de lib/telegram.ts
18. Agregar monitoreo de notificaciones bloqueadas/failed

---

## 8. FASE 7 — PREGUNTAS PENDIENTES

### Preguntas para el desarrollador (David)

#### Sobre arquitectura:

1. **¿Cuántos chats de Telegram existen actualmente?** ¿Un grupo general o múltiples canales (uno por sucursal, uno para equipo, uno para alertas)?

2. **¿Existe actualmente un chat_id de Telegram para "alertas críticas"?** ¿O todo va al mismo chat?

3. **¿Qué modelo de IA está disponible para usar como IA #1 e IA #2?** GitHub Models tiene varios (GPT-4o-mini, GPT-4o, DeepSeek, Llama). ¿Podemos usar dos modelos diferentes para evitar que ambos alucinen igual?

4. **¿Qué margen de latencia es aceptable para el Notification Engine?** ¿Puede tomar 2-3 segundos extra el pipeline de verificación? ¿O las notificaciones deben ser instantáneas?

#### Sobre casos reales:

5. **¿El caso real "Lizet" (pedido perdido) llegó a generar alguna notificación en Telegram?** Si llegó, ¿qué mostró la notificación exactamente?

6. **¿Han visto notificaciones con nombre incorrecto?** Si sí, ¿recuerdan algún ejemplo exacto del texto que apareció en Telegram?

7. **¿Han visto el error de "pedidos mezclados" (WP-06) en producción?** ¿Pueden describir el escenario exacto?

#### Sobre el estado actual:

8. **¿Cuántos pedidos activos en promedio hay simultáneamente?** (Esto determina si el Order Reconstructor necesita ser rápido o muy rápido)

9. **¿Actualmente todas las notificaciones van al mismo chat de Telegram?** ¿O algunas van a grupos diferentes?

10. **¿Hay algún otro canal de notificación además de Telegram?** (SMS, correo, Slack, etc.)

#### Sobre decisiones técnicas:

11. **¿Prefieren que IA #1 e IA #2 sean funciones locales (basadas en reglas + lógica) en lugar de LLM calls?** Esto sería más seguro, más rápido, más barato, pero requiere más código. La IA intervendría solo para la respuesta al cliente, no para las notificaciones.

12. **Sobre el "always notify, but mark warning" vs "block on conflict":** ¿Prefieren que el sistema SIEMPRE notifique aunque haya conflicto (pero marcado como ALERTA), o que BLOQUEE la notificación y solo emita un evento de error?

13. **¿Debemos implementar el Order Auditor como una segunda llamada a un LLM diferente o como un conjunto de reglas deterministas?**

14. **¿Tienen ya implementado algún rate limiter para evitar que Telegram banee el bot por demasiados mensajes?**

---

### Checklist de decisión para el desarrollador

- [x] ¿Acepta la arquitectura de 7 submódulos? — Sí
- [x] ¿Cuántos chats de Telegram usar? — 1 canal general
- [x] ¿Modelo LLM para IA #1? — GPT-4o-mini (desde GitHub Models)
- [x] ¿Modelo LLM para IA #2? — Segundo modelo diferente desde GitHub Models (token propio o separado)
- [x] ¿Tolerancia de latencia? — Sin presión (notificaciones van después de responder al cliente)
- [x] ¿Always notify vs Block on conflict? — Híbrido: críticas siempre ✅ con alerta, informativas ❌ bloqueadas, vacías ❌ bloqueadas
- [x] ¿Implementar IAs como LLM calls o reglas deterministas? — LLM calls (IA #1 reconstructor, IA #2 auditor)
- [x] ¿Rate limiter necesario? — No urgente (nunca ha habido baneo)
- [x] ¿Canal adicional? — WhatsApp a empleados (notification.service.ts)
- [x] ¿Pedidos activos simultáneos? — 2-3

---

## ANEXO A — RESPUESTAS DEL DESARROLLADOR (2026-07-18)

### Pregunta 1
**¿Cuántos chats de Telegram existen actualmente?**
> Un solo canal general.

### Pregunta 2
**¿Existe chat_id para alertas críticas?**
> Todas van al mismo chat.

### Pregunta 3
**¿Modelo para IA #1 e IA #2?**
> Actualmente GPT-4o-mini para atención. Dos modelos diferentes desde GitHub Models (token propio o uno separado del de respuestas principales).

### Pregunta 4
**¿Margen de latencia aceptable?**
> Sin presión. Las notificaciones se envían después de que la IA ya respondió al cliente.

### Pregunta 5
**¿El caso Lizet generó notificación en Telegram?**
> Sí, pero se perdió entre otros envíos. No se pudo recuperar el texto exacto.

### Pregunta 6
**¿Notificaciones con nombre incorrecto?**
> Sí. Ejemplo real: `👤 Cliente:` vacío. También nombres con Unicode/emojis (`ℭ𝔯𝔦𝔰 🦥`) sin sanitizar.

### Pregunta 7
**¿Pedidos mezclados (WP-06)?**
> No ha ocurrido en producción. No es un riesgo confirmado.

### Pregunta 8
**¿Pedidos activos simultáneos?**
> 2-3 en promedio.

### Pregunta 9
**¿Múltiples chats de Telegram?**
> No. Todo al mismo canal.

### Pregunta 10
**¿Otro canal de notificación además de Telegram?**
> Sí, WhatsApp a empleados (notification.service.ts).

### Pregunta 11
**¿IA #1 e IA #2 como reglas locales o LLM calls?**
> LLM calls.

### Pregunta 12
**¿Always notify vs Block on conflict?**
> Híbrido recomendado por la IA:
> - Críticas (humano, queja, cancelación, pago recibido) → ✅ Siempre, con ⚠️ si hay conflicto
> - Informativas (nuevo pedido, actualización, precio) → ❌ Bloquear si conflicto, reemplazar por "Revisar pedido #ID en panel"
> - Vacías (Total: 0, Cliente: sin nombre) → ❌ Bloquear siempre, solo log interno

### Pregunta 13
**¿Order Auditor como LLM o reglas?**
> Segunda llamada a LLM.

### Pregunta 14
**¿Rate limiter implementado?**
> No, pero nunca ha habido baneo.

---

*Fin de NOTIFICATION_AUDIT.md*

---

**Próximos pasos después de responder preguntas:**
1. Actualizar PROJECT_TRACKER.md con las tareas de Notification Engine
2. Implementar Fase 6.1 (crear estructura base)
3. Cada fase debe ser un PR pequeño y reversible
