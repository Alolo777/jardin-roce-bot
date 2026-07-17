# Análisis de Unificación: PEDIDO_EN_CURSO → Order Engine
## Fases 1-6: Investigación completa antes de implementar

---

# FASE 1: Archivos y Referencias (Completado)

## Archivos que participan en el flujo de pedidos

### CORE — Estado de pedido dual

| Archivo | Rol | Líneas relevantes |
|---|---|---|
| `bot.ts` | Contiene PEDIDO_EN_CURSO (Map legacy), ARREGLO_ELEGIDO, VENTA_ACTUAL, VENTAS_CERRADAS + todas las funciones de negocio que leen/escriben estos Maps | 479-1939 (~1460 líneas) |
| `src/pedidos/pedido.service.ts` | Order Engine con máquina de estados (PEDIDOS Map), transiciones validadas, eventos | 196 líneas |
| `src/pedidos/pedido.repository.ts` | Persistencia del Order Engine a bot_cache + sync a pedidos_bot | 139 líneas |
| `src/pedidos/index.ts` | Barrel export | 1 línea |
| `src/models/types.ts` | Interfaces PedidoActual (Order Engine), ArregloInfo, EnvioInfo, PedidoExtra, EstadoPedido (enum) | 131 líneas |

### Interfaz legacy en bot.ts

```typescript
// Línea 482
type EstadoFlujoPedido = 'sin_pedido' | 'cotizando' | 'esperando_precio_equipo'
  | 'precio_confirmado' | 'esperando_fecha_hora' | 'esperando_entrega'
  | 'esperando_nombre' | 'esperando_pago' | 'apartado_sucursal'
  | 'pagado_transferencia' | 'cerrado' | 'cancelado'

// Línea 489-511
interface PedidoEnCurso {
  arreglo?: ArregloConFoto
  productoPersonalizado?: string
  precioPersonalizado?: number
  envio?: { zona: string; precio: number }
  nombre?: string
  direccion?: string
  sucursal?: string
  metodoPago?: 'transferencia' | 'efectivo_recoger' | 'tarjeta_recoger'
  nota?: string
  estadoFlujo?: EstadoFlujoPedido
  fechaEntrega?: string
  horaEntrega?: string
  fotoReferenciaBase64?: string
  fotoReferenciaMimetype?: string
  fotoReferenciaCaption?: string
  fotoReferenciaRecibidaEn?: string
  detallesEspeciales?: string
  extras?: PedidoExtra[]
  precioConfirmadoPor?: 'equipo' | 'ia' | 'cliente' | 'manual'
  esperandoPrecioEnvio?: boolean
  cerradoEn?: string
}

// Línea 513
const PEDIDO_EN_CURSO = new Map<string, PedidoEnCurso>()
```

### Interfaz del Order Engine

```typescript
// src/models/types.ts línea 78-105
interface PedidoActual {
  id?: string
  estado?: EstadoPedido         // NUEVO | COTIZANDO | PRECIO_CONFIRMADO | ...
  estadoFlujo?: string           // (mismo string que EstadoFlujoPedido)
  telefono?: string
  nombre?: string
  arreglo?: ArregloInfo
  productoPersonalizado?: string
  precioPersonalizado?: number
  extras?: PedidoExtra[]
  envio?: EnvioInfo
  direccion?: string
  sucursal?: string
  fechaEntrega?: string
  horaEntrega?: string
  metodoPago?: string
  nota?: string
  detallesEspeciales?: string
  fotoReferenciaBase64?: string
  // ... (más campos)
}
```

### Eventos involucrados

| Evento | Dónde se emite (bot.ts) | Dónde se emite (pedido.service.ts) |
|---|---|---|
| ORDER_CREATED | L944 (media comprobante), L1198 (web), L1563 (interés), L1905 (ventaCerradaHandler) | L55 (crearPedido) |
| ORDER_UPDATED | — | L82 (transitar), L129 (archivarPedido) |
| ORDER_READY | — | L96 (transitar → LISTO) |
| ORDER_DELIVERED | — | L104 (transitar → ENTREGADO) |
| PAYMENT_RECEIVED | L1891 (ventaCerradaHandler) | — |
| PAYMENT_CONFIRMED | L1898 (ventaCerradaHandler) | — |
| PAYMENT_PENDING | L1930 (pedidoApartadoHandler) | — |
| PRICE_CONFIRMED | — | L89 (transitar → PRECIO_CONFIRMADO) |
| DELIVERY_COMPLETED | — | L108 (transitar → ENTREGADO) |

### Telegram Subscriber (25 eventos suscritos)

El subscriber recibe eventos de AMBAS fuentes (bot.ts y pedido.service.ts). No distingue origen.

### Prompt Builder

`construirContextoPrompt()` recibe `PedidoActual | null` desde bot.ts (vía `obtenerPedido(clienteId)` = Order Engine). Esto significa que el **Prompt Builder YA LEE del Order Engine**, no del legacy.

---

# FASE 2: Mapa de Impacto

## 2.1 Archivos que LEEN PEDIDO_EN_CURSO (legacy Map)

Todas las lecturas ocurren en `bot.ts`. Cada `PEDIDO_EN_CURSO.get(clienteId)` es un acceso directo al Map legacy.

| Función en bot.ts | Línea | Qué lee | Propósito |
|---|---|---|---|
| `pedidoActual()` | 515-518 | Todo el pedido | Función base que devuelve referencia mutable |
| `totalExtrasPedido()` | 559 | extras | Cálculo total extras |
| `extrasPedidoTexto()` | 564 | extras | Formateo para Telegram |
| `totalPedidoNumerico()` | 585 | arreglo, precioPersonalizado, extras, envio | Cálculo total numérico |
| `resumirPedidoOperativo()` | 604 | Todo | Resumen para persistir |
| `persistirPedido()` | 629 | Todo | Persistencia a pedidos_bot |
| `ventaDesdeEstado()` | 728 | arreglo, precioPersonalizado, extras, envio, nombre, sucursal | Construir VentaCerrada |
| `precioPedidoActual()` | 757 | arreglo, precioPersonalizado | Obtener precio |
| `tienePrecioConfirmado()` | 761 | (usa precioPedidoActual) | Validar precio |
| `tieneNombreValido()` | 766 | nombre | Validar nombre |
| `ventaListaParaCerrar()` | 770 | (usa helper fns) | Validar condiciones cierre |
| `ventaListaParaPagoTransferencia()` | 774 | direccion, sucursal, envio | Validar condiciones pago |
| `apartadoSucursalListo()` | 779 | sucursal | Validar apartado sucursal |
| `aplicarDatosPedidoDesdeTexto()` | 788 | Todo (vía pedidoActual) | Extraer datos del texto |
| `contextoEsperaComprobante()` | 816 | metodoPago, estadoFlujo | Detectar espera comprobante |
| `tieneArregloVerificado()` | 828 | arreglo, productoPersonalizado | Validar arreglo |
| `precioArregloTexto()` | 833 | arreglo, precioPersonalizado | Formatear precio |
| `faltaFechaHoraParaCerrar()` | 844 | fechaEntrega, horaEntrega | Validar fecha/hora |
| `pedirFechaHoraSiFalta()` | 849 | (usa helper) | Preguntar fecha/hora |
| `procesarMediaAcumulado()` | 881 | estadoFlujo, metodoPago, arreglo | Contexto para visión IA |
| `procesarMensaje()` (bloque extracción) | 1512, 1525, 1646-1683, 1693, 1718, 1782, 1819 | arreglo, nombre, sucursal, precio | Extracción de datos + contexto IA |
| `ventaCerradaHandler()` | 1882-1918 | Todo | Cerrar venta |
| `pedidoApartadoHandler()` | 1924-1938 | Todo | Apartar pedido |
| `procesarMensaje()` (contextoExtra) | 1344, 1794 | estadoFlujo | Inyectar estado al prompt |
| `getDiagnosticoChat()` | 2490-2505 | Todo | Endpoint de diagnóstico |

**Total: ~28 puntos de lectura directa. ~12 funciones que usan pedidoActual() como atajo.**

## 2.2 Archivos que ESCRIBEN PEDIDO_EN_CURSO

Todas en `bot.ts`:

| Ubicación | Línea | Campo modificado | Cuándo |
|---|---|---|---|
| `pedidoActual()` | 517 | Crea/sobrescribe todo | Siempre que se llama (set implícito) |
| `agregarExtrasPedido()` | 555 | .extras | Cuando se detectan extras |
| `aplicarDatosPedidoDesdeTexto()` | 790-812 | .nombre, .sucursal, .metodoPago, .estadoFlujo | En cada mensaje |
| `procesarMediaAcumulado()` | 936-937, 963-969 | .metodoPago, .estadoFlujo, .productoPersonalizado, .fotoReferencia*, .detallesEspeciales | Al procesar media |
| `procesarMensaje()` (inline) | 1258-1259, 1264, 1384-1387, 1449-1450, 1646-1683, 1674, 1680-1683, 1778-1783, 1841-1842 | .fechaEntrega, .horaEntrega, .estadoFlujo, .productoPersonalizado, .detallesEspeciales, .direccion, .esperandoPrecioEnvio, .nota, .nombre, .metodoPago, .sucursal, .precioPersonalizado, .precioConfirmadoPor | En flujo principal |
| `ventaCerradaHandler()` | 1883-1885 | .metodoPago, .estadoFlujo, .cerradoEn | Al cerrar venta |
| `pedidoApartadoHandler()` | 1925-1926 | .estadoFlujo, .cerradoEn | Al apartar |
| `resetearPedidoActivo()` | 711-714 | DELETE del Map | Cambio de tema, nuevo pedido |
| `resetearPedidoCliente()` | 703-709 | DELETE del Map + VENTAS_CERRADAS | Cierre de venta |
| `sincronizarPedidoConCaso()` | 722 | DELETE + crearPedido (Order Engine) | Cambio de tema |

**Total: ~20 puntos de escritura directa.**

## 2.3 Archivos que CREAN pedidos (en ambos sistemas)

| Sistema | Función | Línea | Cuándo |
|---|---|---|---|
| **LEGACY** | `pedidoActual()` | 517 | Crea implícitamente si no existe (set de objeto vacío) |
| **LEGACY** | reset functions | 703, 711 | Eliminan (no crean) |
| **Order Engine** | `crearPedido()` | pedido.service.ts:44 | Crea en el Map PEDIDOS con estado NUEVO |
| **Order Engine** | `sincronizarPedidoConCaso()` | 723 | Llama a crearPedido del Order Engine |
| **Order Engine** | `cargarPedidosDesdeBD()` | pedido.service.ts:34 | Restaura desde bot_cache al iniciar |

## 2.4 Archivos que MODIFICAN estado de pedido

| Sistema | Función | Transiciones |
|---|---|---|
| **LEGACY** | Asignación directa a `pedido.estadoFlujo` | Sin validación. Cualquier string. |
| **Order Engine** | `transitar()` | Valida contra TRANSICIONES_VALIDAS. Rechaza saltos inválidos. |

## 2.5 Archivos que CONSULTAN pedidos (lectura externa)

| Archivo | Función | Fuente de datos |
|---|---|---|
| `src/api/server.ts` | `/diag/:chatId` | **AMBOS**: PEDIDO_EN_CURSO + obtenerPedido (Order Engine) |
| `app/api/bot/status/route.ts` | GET | **SOLO Supabase** (pedidos_bot) — lectura indirecta |
| `app/api/pedidos/[id]/route.ts` | PATCH | **SOLO Supabase** (pedidos_bot) — modificación directa en DB |
| `src/openai/prompt.builder.ts` | `construirContextoPrompt()` | **Order Engine** (recibe PedidoActual de obtenerPedido) |
| `src/casos/caso.service.ts` | `obtenerCasoActivo()` | No interactúa con pedidos |

## 2.6 Archivos que NOTIFICAN pedidos

| Archivo | Fuente de datos para la notificación |
|---|---|
| `lib/telegram.ts` | Recibe datos del evento, NO lee Maps directamente |
| `src/events/telegram.subscriber.ts` | Lee del payload del evento |
| `bot.ts` (notificarEmpleadosWhatsApp) | Lee de PEDIDO_EN_CURSO |

## 2.7 Datos compartidos entre legacy y Order Engine

Hay **3 datos que se sincronizan manualmente** desde legacy → Order Engine:

1. **nombre**: `aplicarDatosPedidoDesdeTexto()` línea 810: `op.nombre = pedido.nombre` (solo nombre)
2. **creación**: `sincronizarPedidoConCaso()` línea 723: llama a `crearPedido()` (solo si no existe o hay cambio de tema)
3. **lectura**: `ventaDesdeEstado()` línea 749: `obtenerPedido(clienteId)?.nombre` como fallback

**NO se sincronizan**: arreglo, precioPersonalizado, envio, direccion, sucursal, metodoPago, fechaEntrega, horaEntrega, extras, estadoFlujo, fotoReferencia*, detallesEspeciales, nota, precioConfirmadoPor, cerradoEn

---

# FASE 3: Flujo ACTUAL (Real)

```
WhatsApp (Baileys WebSocket)
│
▼
bot.ts: manejarMensajeEntrante()
│
├─ Silenciados, rate limit, pause check
│
▼
bot.ts: procesarMensaje()  ← 663 líneas de try/catch monolítico
│
├── 1. Guardar en historial_chat (Supabase)
├── 2. Resetear pedido si "empecemos desde cero"
│
├── 3. CASE ENGINE: asegurar caso activo (src/casos/caso.service.ts)
│   └── crearCaso() / obtenerCasoActivo() / detectarCambioTema()
│
├── 4. sincronizarPedidoConCaso() 
│   ├── Si cambioTema → resetearPedidoActivo()  [ELIMINA de PEDIDO_EN_CURSO]
│   └── Si no existe en Order Engine → crearPedido() [CREA en PEDIDOS Map]
│
├── 5. DECISION ENGINE: analizarIntencion()
│
├── 6. Extraer fecha/hora → ESCRIBIR en PEDIDO_EN_CURSO (campo estadoFlujo)
│
├── 7. construirContextoPrompt() ← Lee de Order Engine (obtenerPedido)
│
├── 8. CLASIFICACION IA (clasificarConversacion)
│
├── 9. Detección de fotos disponibles, catálogo, cotizador
│   └── resetea PEDIDO_EN_CURSO + escribe en PEDIDO_EN_CURSO
│
├── 10. Envío, cancelación, quejas, eventos
│   └── ESCRIBE en PEDIDO_EN_CURSO (direccion, estadoFlujo)
│
├── 11. aplicarDatosPedidoDesdeTexto()
│   └── ESCRIBE en PEDIDO_EN_CURSO (nombre, sucursal, metodoPago, extras)
│   └── SINCRONIZA nombre → Order Engine (solo nombre)
│
├── 12. procesarMediaAcumulado()
│   └── ESCRIBE en PEDIDO_EN_CURSO (fotoReferencia*, productoPersonalizado, estadoFlujo)
│   └── persistirPedido() [ESCRIBE LEGACY a pedidos_bot]
│   └── eventBus.emit() (ORDER_CREATED, PHOTO_RECEIVED, etc.)
│
├── 13. Validaciones de cierre (6+ condiciones)
│   └── LEE de PEDIDO_EN_CURSO (ventaDesdeEstado, tienePrecioConfirmado, etc.)
│   └── ventaCerradaHandler() o pedidoApartadoHandler()
│       ├── ESCRIBE en PEDIDO_EN_CURSO (estadoFlujo = pagado/apartado, cerradoEn)
│       ├── persistirPedido() → pedidos_bot (LEGACY)
│       ├── registrarVenta() → reporte_ventas
│       ├── eventBus.emit() → Telegram
│       └── resetearPedidoCliente() → ELIMINA de PEDIDO_EN_CURSO
│
├── 14. LLM (getAIResponse)
│   └── Posible escritura en PEDIDO_EN_CURSO (precioPersonalizado del LLM)
│
├── 15. Revisor (revisarRespuestaFlora)
│
├── 16. responderMensaje()
│
└── 17. finally: fotos pendientes
```

### Datos críticos del flujo real:

1. **PEDIDO_EN_CURSO es la fuente de verdad para TODAS las decisiones**: cierre, apartado, validaciones, persistencia, Telegram, empleados WhatsApp
2. **Order Engine (obtenerPedido) solo se usa para**: prompt builder (contexto para LLM), sincronización de nombre, diagnóstico
3. **persistirPedido() escribe a pedidos_bot desde PEDIDO_EN_CURSO**, no desde el Order Engine
4. **sincronizarPedidosBot()** (pedido.repository.ts) escribe a pedidos_bot desde el Order Engine → **DOS fuentes escriben a la misma tabla**
5. **Las transiciones de estado en el Order Engine NUNCA se llaman** desde el flujo real de bot.ts. `transitar()`, `transitarDesdeFlujo()` existen pero el código legacy nunca las invoca.
6. **VENTAS_CERRADAS** (Set) bloquea permanentemente la creación de un segundo pedido para el mismo cliente

---

# FASE 4: Flujo NUEVO Propuesto

## Principios del cambio

1. **PEDIDO_EN_CURSO desaparece** como fuente de verdad. Solo existe el Order Engine.
2. **PedidoActual (del Order Engine) contiene TODOS los campos** que hoy existen en PedidoEnCurso.
3. **Las funciones de negocio mutan PedidoActual directamente** (misma mecánica que hoy, pero sobre el Map del Order Engine).
4. **sincronizarPedidosBot() y persistirPedido() se unifican** en una sola función que persiste desde el Order Engine.
5. **transitar() se llama en cada cambio de estado** para validar la transición y emitir eventos.
6. **VENTAS_CERRADAS se elimina** o se reemplaza por detección de intención.

## Flujo NUEVO

```
WhatsApp (Baileys WebSocket)
│
▼
bot.ts: manejarMensajeEntrante() (orquestador, no lógica)
│
▼
src/whatsapp/message-handler.ts (nuevo)
│
├── 1. Guardar en historial_chat
│
├── 2. CASE ENGINE (sin cambios)
│
├── 3. ORDER ENGINE: asegurar pedido
│   └── obtenerPedido() ?? crearPedido()
│   └── (NO más PEDIDO_EN_CURSO)
│
├── 4. DECISION ENGINE (sin cambios)
│
├── 5. Extraer datos → ESCRIBIR en PedidoActual (Order Engine)
│   └── nombre, sucursal, direccion, fecha, hora, metodoPago, extras
│   └── transitar() automático si hay cambio de estado relevante
│
├── 6. Construir contexto (Prompt Builder) — sin cambios
│
├── 7. Validaciones de cierre
│   └── LEE de PedidoActual (Order Engine)
│   └── transitar() → eventBus.emit()
│   └── persistir() automático en cada mutación
│
├── 8. LLM + Revisor (sin cambios)
│
└── 9. responderMensaje()
```

## Qué desaparece

| Elemento | Eliminar |
|---|---|
| `PEDIDO_EN_CURSO` Map | `const PEDIDO_EN_CURSO = new Map()` (línea 513) |
| `PedidoEnCurso` interface | `interface PedidoEnCurso` (línea 489-511) |
| `ARREGLO_ELEGIDO` Map | Migrar campo a `PedidoActual.arreglo` |
| `VENTA_ACTUAL` Map | Migrar campo a `PedidoActual` (o eliminar si no se usa) |
| `VENTAS_CERRADAS` Set | Reemplazar por detección de intención |
| `pedidoActual()` function | Reemplazar por `obtenerPedido()` del Order Engine |
| `resetearPedidoActivo()` | Reemplazar por `archivarPedido()` + `crearPedido()` |
| `resetearPedidoCliente()` | Reemplazar por `archivarPedido()` + `cancelarPedido()` |
| `persistirPedido()` | Reemplazar por `persistir()` del Order Engine (que ya existe) |
| `EstadoFlujoPedido` type | Reemplazar por `EstadoPedido` enum |
| `estadoFlujoDesdeEstado()` | Reemplazar por `derivarEstado()` en repository |
| `sincronizarPedidoConCaso()` | Simplificar (solo Order Engine) |
| Duplicación inline de cálculos | Usar helpers del Order Engine |

## Qué permanece

| Elemento | Razón |
|---|---|
| `obtenerPedido()` (Order Engine) | Ya existe, se expande su uso |
| `crearPedido()` (Order Engine) | Ya existe, se convierte en la única forma de crear |
| `transitar()` (Order Engine) | Ya existe, ahora será llamado |
| `transitarDesdeFlujo()` (Order Engine) | Para mapear estados legacy durante migración |
| `persistir()` (Order Engine) | Ya existe, se convierte en la única persistencia |
| `eventBus.emit()` en el Order Engine | Ya emite eventos de transición |
| `lib/telegram.ts` | Sin cambios |
| `src/events/telegram.subscriber.ts` | Sin cambios |
| `src/openai/prompt.builder.ts` | Sin cambios (ya recibe PedidoActual) |
| `src/pedidos/pedido.repository.ts` | Se expande para incluir todos los campos |
| Funciones helper existentes | `tienePrecioConfirmado()`, `ventaListaParaCerrar()`, etc. — se migran al Order Engine o se mantienen como helpers que leen de PedidoActual |

## Qué cambia

| Cambio | Detalle |
|---|---|
| `PedidoActual` interface | Se expande para incluir todos los campos de `PedidoEnCurso` que falten (ej: `fotoReferenciaBase64`, `detallesEspeciales`, `precioConfirmadoPor`, `esperandoPrecioEnvio`, `cerradoEn`) |
| `obtenerPedido()` | Se convierte en el único acceso a pedido activo (reemplaza `pedidoActual()`) |
| Pedido se crea explícitamente | Ya no hay creación implícita vía `pedidoActual()` |
| Cada mutación de datos llama a `transitar()` | Se sincroniza el estado del Order Engine con el flujo real |
| `persistir()` se llama tras cada cambio | Ya se llama en el Order Engine, se asegura cobertura total |

## Qué se migra (datos)

Los siguientes campos existen en `PedidoEnCurso` y deben migrarse a `PedidoActual` (algunos ya existen):

| Campo legacy | En PedidoActual | Estado |
|---|---|---|
| `arreglo` | `arreglo` | ✅ Ya existe |
| `productoPersonalizado` | `productoPersonalizado` | ✅ Ya existe |
| `precioPersonalizado` | `precioPersonalizado` | ✅ Ya existe |
| `envio` | `envio` | ✅ Ya existe |
| `nombre` | `nombre` | ✅ Ya existe |
| `direccion` | `direccion` | ✅ Ya existe |
| `sucursal` | `sucursal` | ✅ Ya existe |
| `metodoPago` | `metodoPago` | ✅ Ya existe (más permisivo en PedidoActual) |
| `nota` | `nota` | ✅ Ya existe |
| `estadoFlujo` | `estadoFlujo` | ✅ Ya existe |
| `fechaEntrega` | `fechaEntrega` | ✅ Ya existe |
| `horaEntrega` | `horaEntrega` | ✅ Ya existe |
| `fotoReferenciaBase64` | `fotoReferenciaBase64` | ✅ Ya existe |
| `fotoReferenciaMimetype` | `fotoReferenciaMimetype` | ✅ Ya existe |
| `fotoReferenciaCaption` | `fotoReferenciaCaption` | ✅ Ya existe |
| `fotoReferenciaRecibidaEn` | `fotoReferenciaRecibidaEn` | ✅ Ya existe |
| `detallesEspeciales` | `detallesEspeciales` | ✅ Ya existe |
| `extras` | `extras` | ✅ Ya existe |
| `precioConfirmadoPor` | `precioConfirmadoPor` | ✅ Ya existe |
| `esperandoPrecioEnvio` | `esperandoPrecioEnvio` | ✅ Ya existe |
| `cerradoEn` | `cerradoEn` | ✅ Ya existe |
| `id` | `id` | ✅ Ya existe (generado en crearPedido) |
| `telefono` | `telefono` | ✅ Ya existe |
| `creadoEn` | `creadoEn` | ✅ Ya existe |
| `actualizadoEn` | `actualizadoEn` | ✅ Ya existe |

**Todos los campos ya existen en PedidoActual.** No se necesita expansión de interfaz. La migración es de USO, no de estructura.

---

# FASE 5: Detección de Riesgos

## R1 — Pedidos duplicados (P0)
**Riesgo:** Si durante la migración un pedido existe en PEDIDO_EN_CURSO pero NO en el Order Engine (o viceversa), al cambiar la fuente de verdad algunas lecturas pueden encontrar el pedido vacío y crear uno nuevo, resultando en dos pedidos para el mismo cliente.
**Mitigación:** PASO 1 antes de migrar lecturas: agregar función `syncLegacyToEngine(clienteId)` que copia PEDIDO_EN_CURSO → Order Engine si el Order Engine no tiene el pedido.

## R2 — Estados inválidos (P1)
**Riesgo:** El legacy asigna `estadoFlujo` como string libre. Al migrar al Order Engine, `transitar()` valida contra TRANSICIONES_VALIDAS. Si el flujo legacy intenta una transición no permitida (ej: NUEVO → APARTADO), `transitar()` la rechazará y el pedido se quedará en el estado anterior.
**Mitigación:** PASO 2: `transitarDesdeFlujo()` ya existe y mapea estados legacy. Usarla como puente. En lugar de rechazar, forzar la transición con `transitarDesdeFlujo()` que tiene fallback directo.

## R3 — Condiciones de carrera (P0)
**Riesgo:** `procesarMensaje` es secuencial por cliente (cola), pero `fromMe` (mensajes del equipo) se procesan en paralelo. Si el equipo responde mientras se procesa un mensaje del cliente, ambos pueden leer/escribir el mismo pedido simultáneamente.
**Mitigación:** PASO 0 (pre-migración): Verificar que `fromMe` también use la cola por cliente, o agregar un mutex simple por `clienteId`. Estado actual: `fromMe` no pasa por `encolarPorCliente`.

## R4 — Pérdida de contexto (P1)
**Riesgo:** Al cambiar de `pedidoActual()` (creación implícita) a `obtenerPedido()` (puede retornar null), si el código no maneja null correctamente, puede fallar con TypeError.
**Mitigación:** Revisar cada punto de migración. Los helpers actuales (`tienePrecioConfirmado`, `ventaListaParaCerrar`, etc.) ya tienen fallbacks seguros.

## R5 — Órdenes huérfanas (P1)
**Riesgo:** `resetearPedidoActivo()` elimina el pedido del legacy. Si no se replica al Order Engine (archivar/cancelar), el pedido del Order Engine queda "huérfano" — existe en PEDIDOS pero ya no tiene correspondencia en el flujo real.
**Mitigación:** `resetearPedidoActivo()` y `resetearPedidoCliente()` deben también archivar/cancelar en el Order Engine.

## R6 — Eventos duplicados en Telegram (P1)
**Riesgo:** Actualmente `ventaCerradaHandler()` emite eventos DIRECTAMENTE (PAYMENT_RECEIVED, PAYMENT_CONFIRMED, ORDER_CREATED). Si además se llama a `transitar()` que también emite ORDER_UPDATED, el equipo recibe notificaciones duplicadas.
**Mitigación:** Centralizar emisiones. `ventaCerradaHandler()` y `pedidoApartadoHandler()` deberían delegar en `transitar()` en lugar de emitir manualmente.

## R7 — Regresión en creación de pedidos (P0)
**Riesgo:** `pedidoActual()` crea implícitamente un pedido vacío si no existe (línea 517). `obtenerPedido()` retorna null si no existe. Cualquier código que dependa de la creación implícita fallará si no se agrega `crearPedido()` explícito.
**Mitigación:** Reemplazar cada `pedidoActual()` con `obtenerPedido() ?? crearPedido()` durante la migración.

## R8 — VENTAS_CERRADAS rompe flujo de recompra (P0)
**Riesgo:** `VENTAS_CERRADAS` es un Set que nunca se limpia (solo en `resetearPedidoCliente`). Un cliente que ya compró no puede iniciar un nuevo pedido porque `detectarIntencion()` en línea 1005 retorna 'normal' y bloquea catálogo/cotizador.
**Mitigación:** Eliminar el bloqueo de VENTAS_CERRADAS en `detectarIntencion()`. Reemplazar con detección contextual de intención de nueva compra (el Decision Engine ya tiene `Intencion.PEDIDO`).

---

# FASE 6: Plan de Migración

## Estrategia general

**Evolutiva, no destructiva.** Cada paso:
1. Compila individualmente
2. No rompe funcionalidad existente
3. Se puede revertir
4. Actualiza PROJECT_TRACKER.md

Los pasos están ordenados de menor a mayor riesgo.

---

### PASO 0: Agregar mutex por cliente en procesarMensaje (Pre-migración)
**Riesgo:** P1
**Archivos:** `bot.ts`
**Cambio:** Verificar que `fromMe` (línea ~2120) también use `encolarPorCliente`.
**Justificación:** Prevenir condiciones de carrera durante la migración.
**Compila:** ✅
**Prueba:** Enviar mensaje de agente mientras se procesa mensaje de cliente.
**Rollback:** Revertir cambio en `fromMe`.

---

### PASO 1: Expandir crearPedido() con datos iniciales (Bajo riesgo)
**Riesgo:** P2
**Archivos:** `src/pedidos/pedido.service.ts`
**Cambio:** `crearPedido()` ahora acepta un parámetro opcional `datosIniciales?: Partial<PedidoActual>` para establecer nombre, telefono, etc. desde el inicio.
```typescript
export function crearPedido(clienteId: string, telefono: string, datosIniciales?: Partial<PedidoActual>): PedidoActual
```
**Justificación:** Preparar para reemplazar `pedidoActual()`. Cuando se cree un pedido explícitamente, llevará datos iniciales.
**Compila:** ✅
**Prueba:** Llamar con y sin datos iniciales.
**Rollback:** Revertir cambio de firma.

---

### PASO 2: Agregar función syncLegacyToEngine() (Bajo riesgo)
**Riesgo:** P0 (mitigación de R1)
**Archivos:** `bot.ts`
**Cambio:** Nueva función que copia datos de PEDIDO_EN_CURSO al Order Engine si el Order Engine no tiene pedido.
```typescript
function syncLegacyToEngine(clienteId: string): void {
  const legacy = PEDIDO_EN_CURSO.get(clienteId)
  const engine = obtenerPedido(clienteId)
  if (!engine && legacy) {
    const nuevo = crearPedido(clienteId, '')
    Object.assign(nuevo, legacy)
    nuevo.telefono = ''  // será llenado después
  }
}
```
**Justificación:** Punto de sincronización único para prevenir pedidos duplicados.
**Compila:** ✅
**Prueba:** Verificar que datos legacy se copian al engine.
**Rollback:** Revertir función y sus llamadas.

---

### PASO 3: Hacer que resetearPedidoActivo() también archive en Order Engine (Medio riesgo)
**Riesgo:** P1 (mitigación de R5)
**Archivos:** `bot.ts`
**Cambio:** 
```typescript
function resetearPedidoActivo(clienteId: string): void {
  const engine = obtenerPedido(clienteId)
  if (engine) archivarPedido(clienteId, 'Reset por cambio de contexto')
  PEDIDO_EN_CURSO.delete(clienteId)
  ARREGLO_ELEGIDO.delete(clienteId)
  VENTA_ACTUAL.delete(clienteId)
}
```
**Justificación:** Evitar órdenes huérfanas en el Order Engine.
**Compila:** ✅
**Prueba:** Resetear pedido, verificar que el engine también lo archiva.
**Rollback:** Revertir función.

---

### PASO 4: Hacer que resetearPedidoCliente() también cancele en Order Engine (Medio riesgo)
**Riesgo:** P1
**Archivos:** `bot.ts`
**Cambio:**
```typescript
function resetearPedidoCliente(clienteId: string): void {
  const engine = obtenerPedido(clienteId)
  if (engine) cancelarPedido(clienteId, 'Venta cerrada')
  PEDIDO_EN_CURSO.delete(clienteId)
  ARREGLO_ELEGIDO.delete(clienteId)
  VENTAS_CERRADAS.delete(clienteId)
  VENTA_ACTUAL.delete(clienteId)
  FOTOS_DISPONIBLES_RECIENTES.delete(clienteId)
}
```
**Justificación:** Consistencia entre ambos sistemas.
**Compila:** ✅
**Prueba:** Cerrar venta, verificar que el engine también cancela/archiva.
**Rollback:** Revertir función.

---

### PASO 5: Reemplazar pedidoActual() por obtenerPedido() con fallback (Medio riesgo)
**Riesgo:** P0 (mitigación de R7)
**Archivos:** `bot.ts`
**Cambio:** Buscar y reemplazar progresivamente cada `pedidoActual(clienteId)`.
**Estrategia:** No reemplazar todo de golpe. Por función:
5a: Funciones de solo lectura (totalExtrasPedido, extrasPedidoTexto, tenerArregloVerificado, etc.)
5b: Funciones de escritura (aplicarDatosPedidoDesdeTexto, etc.)
5c: Flujo principal (procesarMensaje)
**Justificación:** Migración progresiva. Cada sub-paso compila y funciona.
**Patrón de reemplazo:**
```typescript
// ANTES:
const pedido = pedidoActual(clienteId)

// DESPUÉS:
let pedido = obtenerPedido(clienteId)
if (!pedido) {
  pedido = crearPedido(clienteId, telefono)
}
```
**Compila:** ✅
**Prueba:** Flujo completo de creación y modificación de pedido.
**Rollback:** Revertir reemplazos por función.

---

### PASO 6: Hacer que persistirPedido() lea del Order Engine (Medio riesgo)
**Riesgo:** P0 (duplicación de persistencia)
**Archivos:** `bot.ts`, `src/pedidos/pedido.repository.ts`
**Cambio:** `persistirPedido()` ya no lee de PEDIDO_EN_CURSO. Lee de `obtenerPedido(clienteId)`.
**Justificación:** Unificar fuente de verdad para persistencia.
**Compila:** ✅
**Prueba:** Verificar que pedidos_bot recibe los mismos datos.
**Rollback:** Revertir a lectura de PEDIDO_EN_CURSO.

---

### PASO 7: Llamar a transitar() en cada cambio de estado (Alto riesgo)
**Riesgo:** P0 (mitigación de R2)
**Archivos:** `bot.ts`, `src/pedidos/pedido.service.ts`
**Cambio:** Cada asignación a `pedido.estadoFlujo` ahora también llama a `transitarDesdeFlujo()`.
**Justificación:** El Order Engine refleja el estado real del pedido.
**Patrón:**
```typescript
// ANTES:
pedido.estadoFlujo = 'precio_confirmado'

// DESPUÉS:
pedido.estadoFlujo = 'precio_confirmado'
transitarDesdeFlujo(clienteId, 'precio_confirmado')
```
**Riesgo:** Si `transitar()` rechaza la transición, el estado del Order Engine y el legacy divergen.
**Mitigación:** `transitarDesdeFlujo()` ya tiene fallback que asigna aunque `transitar()` falle (líneas 181-184 de pedido.service.ts).
**Compila:** ✅
**Prueba:** Recorrer estados NUEVO → COTIZANDO → PRECIO_CONFIRMADO → ...
**Rollback:** Revertir llamadas a transitarDesdeFlujo.

---

### PASO 8: Eliminar VENTAS_CERRADAS como bloque permanente (Alto riesgo)
**Riesgo:** P0 (mitigación de R8)
**Archivos:** `bot.ts`
**Cambio:** Eliminar el chequeo `VENTAS_CERRADAS.has(clienteId)` en `detectarIntencion()` (línea 1005). Reemplazar con detección contextual.
**Justificación:** Permitir recompras.
**Riesgo:** Sin VENTAS_CERRADAS, el flujo de post-venta puede intentar cerrar otra venta automáticamente.
**Mitigación:** Agregar verificación de caso activo/pedido activo antes de cerrar. Si el pedido ya fue cerrado (ARCHIVADO/CANCELADO), no intentar cerrar de nuevo.
**Compila:** ✅
**Prueba:** Cliente que ya compró puede iniciar nuevo pedido.
**Rollback:** Restaurar chequeo de VENTAS_CERRADAS.

---

### PASO 9: Unificar eventos — eliminar emisiones duplicadas (Medio riesgo)
**Riesgo:** P1 (mitigación de R6)
**Archivos:** `bot.ts`, `src/pedidos/pedido.service.ts`
**Cambio:** `ventaCerradaHandler()` y `pedidoApartadoHandler()` dejan de emitir eventos manualmente. La emisión se hace vía `transitar()`.
**Justificación:** Una sola fuente de eventos.
**Compila:** ✅
**Prueba:** Telegram recibe la misma notificación (verificar contenido).
**Rollback:** Revertir a emisiones manuales.

---

### PASO 10: Eliminar PEDIDO_EN_CURSO, ARREGLO_ELEGIDO, VENTA_ACTUAL (Alto riesgo)
**Riesgo:** P0
**Archivos:** `bot.ts`
**Cambio:** Eliminar declaraciones de Maps legacy y todas las referencias restantes.
**Justificación:** Finaliza la migración. Una sola fuente de verdad.
**Requiere:** PASOS 0-9 completados y verificados en producción.
**Compila:** ✅ (después de eliminar todas las referencias)
**Prueba:** Flujo completo en producción.
**Rollback:** Restaurar Maps y referencias.

---

## Resumen de pasos

| Paso | Riesgo | Depende de | Tiempo estimado |
|---|---|---|---|
| 0: Mutex fromMe | P1 | — | 30 min |
| 1: Expandir crearPedido | P2 | — | 15 min |
| 2: syncLegacyToEngine | P0 | Paso 1 | 20 min |
| 3: resetear → archivar | P1 | Paso 2 | 20 min |
| 4: resetearCliente → cancelar | P1 | Paso 2 | 20 min |
| 5: pedidoActual → obtenerPedido | P0 | Pasos 1-4 | 2-3 horas (progresivo) |
| 6: persistirPedido desde engine | P0 | Paso 5 | 30 min |
| 7: Llamar transitar() | P0 | Paso 5 | 1 hora |
| 8: Eliminar VENTAS_CERRADAS | P0 | Paso 7 | 30 min |
| 9: Unificar eventos | P1 | Paso 7 | 30 min |
| 10: Eliminar Maps legacy | P0 | Pasos 0-9 | 30 min |

**Tiempo total estimado: ~6-8 horas efectivas de implementación.**
**Recomendación:** NO hacer todos los pasos en una sola sesión. Hacer PASOS 0-4 en la primera iteración, verificar en producción, luego 5-7, verificar, luego 8-10.

---

## Preguntas que necesitan respuesta antes de implementar

1. **VENTAS_CERRADAS**: ¿Se elimina completamente o se reemplaza por un dedup temporario (ej: 24h)?
2. **fromMe**: Los mensajes del equipo deben pasar por la cola por cliente. ¿Hay algún motivo por el que NO deban hacerlo?
3. **Orden de pasos**: ¿Apruebas comenzar con PASO 0 (mutex) + PASO 1 (expandir crearPedido) + PASO 2 (syncLegacyToEngine)?
