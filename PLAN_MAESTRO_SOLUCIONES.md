# 🌸 PLAN MAESTRO DE SOLUCIONES — FLORA 3.0

> Archivo maestro de implementación. Cada checkbox representa un módulo o funcionalidad completada.
> Antes de marcar un checkbox, leer TODOS los archivos relacionados y verificar que la solución cumple.
> Versión: 1.0 — Fecha: 2026-07-29
> **AVANCE GLOBAL: 21.1%** (4 de 19 módulos completado)

---

## 📋 CÓMO USAR ESTE PLAN

1. Cada sección tiene checkboxes `[ ]` para marcar cuando está **implementado, compilado, probado y documentado**
2. Dentro de cada sección hay archivos a revisar (con líneas específicas) y una solución detallada
3. No marcar un checkbox hasta que la solución cumpla con la **Definition of Done** de AGENTS.md
4. Después de marcar, actualizar CHANGELOG.md y TODO.md

---

# FASE 0 — ESTABILIZACIÓN Y CONEXIÓN

---

## [ ] 0.1 Reconexión WhatsApp (Bloqueo 405)

**Archivos a revisar:**
- `bot.ts:960-1100` — `iniciarBaileys()`, manejo de `connection.update`, `programarReinicioBaileys()`
- `bot.ts:1041-1070` — Manejo de `connection === 'close'` con códigos de error
- `bot.ts:1106-1126` — `verificarVersionBaileys()` (actualmente muestra alerta rc13→rc14)

**Problema:**
WhatsApp bloqueó la IP de GCP por exceso de reconexiones. El bot recibe 404/405 inmediatamente sin llegar a generar QR. La IP está en lista negra temporal de WhatsApp.

**Solución:**

**Paso 1 — Cambiar IP de la VM de GCP (recomendado, inmediato):**
```bash
# Detener instancia
sudo systemctl stop floreria-bot
# En GCP Console: VM instances > jardin-roce-bot > Stop
# Editar > Network interfaces > External IP > Create new IP (Temporal)
# Start instance
sudo systemctl start floreria-bot
# Verificar logs
sudo journalctl -u floreria-bot -f --since "30 seconds ago"
```

**Paso 2 — Si no se puede cambiar IP (esperar bloqueo):**
```bash
sudo systemctl stop floreria-bot
# Esperar 30-60 min
sudo systemctl start floreria-bot
```

**Paso 3 — Prevención de re-bloqueo (ya implementado pero verificar):**
- `bot.ts:1060-1063` — Cooldown de 30 min para BOT_DISCONNECTED (✅ ya existe)
- `bot.ts:935-937` — Exponential backoff 5s→60s para reconexión (✅ ya existe)
- `bot.ts:146-168` — Crash detector: limpia sesión tras 3 crashes en 10 min (✅ ya existe)

**Criterio de éxito:** El bot genera QR, se escanea y muestra `✅ Bot de Jardín RoCe conectado!`

---

## [ ] 0.2 Verificación de conexión Telegram

**Archivos a revisar:**
- `lib/telegram.ts` — Funciones de envío de mensajes a Telegram
- `bot.ts:1218-1221` — `verificarConexionTelegram()` al arranque
- `src/events/telegram.subscriber.ts:1-110` — Suscripciones de eventos a Telegram

**Problema:**
No hay verificación de que Telegram esté realmente enviando mensajes. Si el token es inválido o el chat ID cambió, el bot no lo detecta.

**Solución:**

Agregar un heartbeat diario a Telegram que el dueño pueda ver:
```typescript
// En bot.ts, después de verificarConexionTelegram()
// Si falla, enviar una alerta por WhatsApp a los empleados
```
Además verificar que `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` estén en `.env.local` de la VM.

**Criterio de éxito:** `[Telegram] ✅ Conectado` aparece en los logs.

---

# FASE 1 — P0: PREVENCIÓN DE PÉRDIDA DE VENTAS

---

## [x] 1.1 Múltiples pedidos por cliente (P0 CRÍTICO) — COMPLETADO 2026-07-31

**Archivos a revisar:**
- `src/pedidos/pedido.service.ts:30` — `const PEDIDOS = new Map<string, PedidoActual>()`
- `src/pedidos/pedido.service.ts:164-188` — `crearPedido()` — crea y SOBRESCRIBE
- `src/pedidos/pedido.service.ts:274-287` — `archivarPedido()`
- `src/pedidos/pedido.service.ts:299-311` — `cancelarPedido()`
- `src/pedidos/pedido.service.ts:353-358` — `resetearPedido()`
- `src/pedidos/pedido.service.ts:366-374` — `limpiarCachesPedidos()`
- `src/models/types.ts:137-166` — `PedidoActual` (interfaz)
- `src/pedidos/pedido.repository.ts` — Persistencia
- `src/repositories/*.ts` — Repositorios (si existen)
- `bot.ts:432-434` — `pedidoActual(clienteId)` — función helper
- `bot.ts:502-517` — `resetearPedidoCliente()`, `silenciarPedido()`, `resetearPedidoActivo()`

**Problema:**
`PEDIDOS` es `Map<string, PedidoActual>` donde la key es `clienteId`. Si el mismo cliente envía "Ahora quiero otro ramo", el pedido anterior se sobrescribe y se pierde. Un cliente que compra para San Valentín y una semana después para un funeral pierde el primer pedido.

**Solución Detallada:**

Cambiar la estructura de `Map<clienteId, PedidoActual>` a `Map<clienteId, PedidoActual[]>`:

```typescript
// ANTES (peligroso):
const PEDIDOS = new Map<string, PedidoActual>()
function crearPedido(clienteId: string, telefono: string): PedidoActual {
  const pedido = { ... }
  PEDIDOS.set(clienteId, pedido) // ← SOBRESCRIBE
  return pedido
}

// DESPUÉS (seguro):
const PEDIDOS = new Map<string, PedidoActual[]>()
function crearPedido(clienteId: string, telefono: string): PedidoActual {
  const pedido = { ... }
  const existentes = PEDIDOS.get(clienteId) ?? []
  existentes.push(pedido)
  PEDIDOS.set(clienteId, existentes) // ← ACUMULA
  return pedido
}
```

**Funciones que cambian:**

| Función | Cambio |
|---------|--------|
| `crearPedido()` | Push a array en lugar de set |
| `obtenerPedido(clienteId)` | Devuelve el ÚLTIMO pedido activo (no archivado/no cancelado) |
| `obtenerPedidosActivos(clienteId)` | **NUEVA**: Devuelve todos los pedidos activos del cliente |
| `archivarPedido()` | Marca el pedido específico (no borra del Map) |
| `cancelarPedido()` | Marca el específico como cancelado |
| `resetearPedidoActivo()` | Solo archiva el último activo |
| `pedidoActual()` helper | Sigue devolviendo el último (compatibilidad) |
| `persistir()` | Serializa todo el array |
| `cargarPedidosDesdeBD()` | Restaura arrays completos |

**Archivos adicionales que referencian `PEDIDOS`:**
- Buscar en TODO el código `PEDIDOS.get(`, `PEDIDOS.set(`, `PEDIDOS.delete(` — actualizar todos

**Tests manuales después del cambio:**
```typescript
// Caso 1: Cliente crea 2 pedidos
crearPedido('cliente1@c.us', '521234567890')
crearPedido('cliente1@c.us', '521234567890')
// → debe haber 2 pedidos en el array

// Caso 2: Obtener último activo
const ultimo = obtenerPedido('cliente1@c.us')
// → debe ser el segundo creado

// Caso 3: Archivar uno no afecta al otro
archivarPedido(clienteId, 'primer pedido completado')
const activos = obtenerPedidosActivos(clienteId)
// → debe devolver solo los no-archivados
```

**Criterio de éxito:** Mismo cliente puede tener N pedidos simultáneos sin pérdida de datos.

---

## [x] 1.2 Persistencia síncrona con retry (P0 CRÍTICO) — COMPLETADO 2026-07-31

**Archivos a revisar:**
- `src/pedidos/pedido.service.ts:37-40` — `persistir()` — llama a `guardarPedidos()` sin await
- `src/pedidos/pedido.repository.ts` — `guardarPedidos()`, `cargarPedidos()`, `sincronizarPedidosBot()`
- `bot.ts:498-500` — `persistirPedido()` — función que llama a persistir
- `src/casos/caso.service.ts` — `persistirCasos()`
- `src/casos/caso.repository.ts` — persistencia de casos

**Problema:**
`persistir()` en `pedido.service.ts:37` es fire-and-forget:
```typescript
function persistir(): void {
  guardarPedidos(PEDIDOS).catch(() => {})  // ← NADIE ESPERA, NADIE VERIFICA
  sincronizarPedidosBot(PEDIDOS).catch(() => {})  // ← IGUAL
}
```
Si el bot crashea entre `crearPedido()` y la escritura a Supabase, el pedido se pierde para siempre.

**Solución Detallada:**

```typescript
// pedido.service.ts

async function persistir(): Promise<boolean> {
  const maxRetries = 3
  for (let i = 0; i < maxRetries; i++) {
    try {
      await guardarPedidos(PEDIDOS)
      await sincronizarPedidosBot(PEDIDOS)
      return true
    } catch (err) {
      console.error(`[pedidos] Error persistencia (intento ${i+1}/${maxRetries}):`, err)
      if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  console.error('[pedidos] ❌ Persistencia falló después de 3 intentos')
  return false
}
```

Y donde se llame `persistir()` (son ~10 lugares), cambiar a `await persistir()`. En los lugares donde no se pueda hacer await (ej. dentro de un setTimeout), al menos loguear el error.

**Funciones que llaman a `persistir()` directa o indirectamente:**
1. `crearPedido()` — línea 176
2. `transitar()` — línea 242
3. `archivarPedido()` — línea 285
4. `archivarSilencioso()` — línea 296
5. `cancelarPedido()` — línea 310
6. `transitarDesdeFlujo()` — línea 339 (indirectamente via `transitar()`)
7. `resetearPedido()` — línea 357
8. `sincronizarConCaso()` — línea 363
9. `cambiarEstado()` — línea 266

Cada una debe cambiar de `persistir()` a `await persistir()` y la función contenedora debe volverse `async`.

**Criterio de éxito:** Si Supabase falla temporalmente, el sistema reintenta 3 veces antes de rendirse, y loguea el error.

---

## [x] 1.3 Ventana de agrupación de 60s con respaldo (P0 CRÍTICO) — COMPLETADO 2026-07-31

**Archivos a revisar:**
- `bot.ts:319-377` — `MENSAJES_POR_AGRUPAR`, `encolarMensajeAgrupado()`, timer de 60s
- `bot.ts:323-328` — `encolarPorCliente()`
- `bot.ts:1073-1081` — `messages.upsert` — entrada de mensajes
- `src/whatsapp/message-entry.ts` — `procesarMensajeEntrante()`

**Problema:**
Los mensajes se agrupan en batches de 60 segundos (`AGRUPAR_MENSAJES_MS = 60_000` en línea 321). Si el bot crashea durante esa ventana, los mensajes acumulados se pierden. Un comprobante de pago enviado en esos 60s + crash = **pago perdido**.

**Solución Detallada:**

**Opción A (recomendada — reducir ventana):**
Cambiar `AGRUPAR_MENSAJES_MS` de `60_000` a `15_000` (15 segundos). Suficiente para agrupar mensajes rápidos, pero reduce drásticamente la ventana de pérdida.

```typescript
// bot.ts:321
export const AGRUPAR_MENSAJES_MS = 15_000  // ANTES era 60_000
```

**Opción B (respaldo en Supabase):**
Cada mensaje entrante, antes de agruparse, se guarda en una tabla `mensajes_pendientes` en Supabase. Al reiniciar, se rescatan los no procesados:

```typescript
// En message-entry.ts, antes de encolarMensajeAgrupado()
async function respaldarMensaje(msg: any, clienteId: string): Promise<void> {
  await supabaseAdmin.from('mensajes_pendientes').insert({
    cliente_id: clienteId,
    texto: getMensajeTexto(msg) || '',
    timestamp: new Date().toISOString(),
    procesado: false,
  })
}
```

Y al iniciar el bot (`bot.ts:1230-1232`), agregar un rescate:
```typescript
await rescatarMensajesPendientes() // nuevo
```

**Opción C (ambas — recomendado):** Reducir ventana a 15s + respaldo en Supabase.

**Criterio de éxito:** Mensajes anteriores al crash se reprocesan al reiniciar el bot.

---

## [x] 1.4 Parser de sucursal robusto (P1) — COMPLETADO 2026-07-31

**Archivos a revisar:**
- `src/parser/sucursal.parser.ts` — Función `parseSucursal()`
- `src/whatsapp/message-handler.ts:835-848` — Uso del parser en flujo de sucursal
- `src/validators/sucursal.validator.ts` — `validarSucursal()`, `obtenerTextoConfirmacionSucursal()`
- `bot.ts:146-174` (aprox.) — uso de sucursal en resumirPedidoOperativo

**Problema:**
El parser de sucursal solo acepta confianza 'alta' (línea 160 y 836). Si el cliente dice "La que está por la Av. Morelos" o "La del centro", se pierde la sucursal y queda vacía.

**Solución Detallada:**

El parser de sucursal actual probablemente usa regex frágiles. Revisar `src/parser/sucursal.parser.ts` y mejorarlo para:

1. **Soportar más variantes:** "centro", "norte", "apizaco", "tlaxcala", "la de [dirección]", "la que está por", "sucursal [nombre]"
2. **Usar confianza gradual:** Si confianza es 'media', almacenar la sucursal pero agregar un flag `sucursal_por_confirmar = true` para que el bot pida confirmación
3. **Fallo seguro:** Si no se puede determinar, dejar vacío (como ya hace)

```typescript
// Ejemplo de mejora en sucursal.parser.ts
export function parseSucursal(texto: string): { sucursal: string | null; confianza: 'alta' | 'media' | 'ninguna' } {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  
  // Coincidencias directas
  if (/\b(centro|sucursal\s+centro)\b/.test(t)) return { sucursal: 'Centro', confianza: 'alta' }
  if (/\b(norte|sucursal\s+norte)\b/.test(t)) return { sucursal: 'Norte', confianza: 'alta' }
  if (/\bapizaco\b/.test(t)) return { sucursal: 'Apizaco', confianza: 'alta' }
  if (/\btlaxcala\b/.test(t)) return { sucursal: 'Tlaxcala', confianza: 'alta' }
  
  // Variantes con menor confianza
  if (/\b(por\s+la\s+(av|avenida|calle|morelos))\b/.test(t)) return { sucursal: 'Centro', confianza: 'media' }
  if (/\b(por\s+el\s+(norte|sur))\b/.test(t)) return { sucursal: 'Norte', confianza: 'media' }
  
  return { sucursal: null, confianza: 'ninguna' }
}
```

**Criterio de éxito:** "La que está por la Av. Morelos" → sucursal Centro (confianza media, pide confirmación).

---

# FASE 2 — UX PARA EL DUEÑO

---

## [ ] 2.1 Resumen diario automático en Telegram a las 9am

**Archivos a revisar:**
- `bot.ts:196-207` — Alerta diaria actual (solo verifica si el bot está ready a las 8am)
- `bot.ts:280-298` — `obtenerVentasHoy()` (✅ ya existe)
- `bot.ts:300-316` — `obtenerClientesAtendidosHoy()` (✅ ya existe)
- `src/pedidos/pedido.service.ts:30` — `PEDIDOS` Map para contar activos
- `src/casos/caso.service.ts` — Para contar casos activos
- `src/events/types.ts` — Para agregar nuevo evento si es necesario
- `src/events/telegram.subscriber.ts` — Para subscribir el nuevo evento
- `lib/telegram.ts` — `enviarMensajeTelegram()`

**Problema:**
El dueño no tiene visibilidad del estado del negocio. No sabe:
- Cuántos clientes se atendieron hoy
- Cuántos pedidos están activos
- Cuántos esperan pago
- Cuántos requieren atención humana
- Cuánto se vendió hoy

**Solución Detallada:**

Crear un nuevo evento `BOT_DAILY_SUMMARY` y una función que compile el resumen:

```typescript
// bot.ts — Nueva función
async function enviarResumenDiario(): Promise<void> {
  const ventas = await obtenerVentasHoy()
  const clientes = await obtenerClientesAtendidosHoy()
  
  // Contar pedidos activos desde el Map (requiere exponer función)
  const pedidosActivos = contarPedidosPorEstado()
  const esperandoPago = pedidosActivos.ESPERANDO_PAGO ?? 0
  const activos = pedidosActivos.ACTIVOS ?? 0
  
  const resumen = [
    `🌸 *Resumen Flora — ${new Date().toLocaleDateString('es-MX')}*`,
    ``,
    `✅ Clientes atendidos: *${clientes}*`,
    `📦 Pedidos activos: *${activos}*`,
    `⏳ Esperando pago: *${esperandoPago}*`,
    `💰 Ventas hoy: *$${ventas.total.toFixed(2)} MXN* (${ventas.cantidad} pedidos)`,
    `🔴 Requieren atención: *[contar HUMAN_REQUIRED no resueltos]*`,
  ].join('\n')
  
  await enviarMensajeTelegram(resumen)
}
```

**Programación:**
Reemplazar la alerta de las 8am (línea 203) con el resumen a las 9am:
```typescript
// bot.ts:203 — Cambiar de 8am a 9am
if (hora === 9 && dia !== ultimoDiaAlertaDiaria) {  // ANTES era hora === 8
  ultimoDiaAlertaDiaria = dia
  await enviarResumenDiario()
}
```

**Criterio de éxito:** Cada día a las 9am el dueño recibe un resumen en Telegram.

---

## [ ] 2.2 Panel de resumen rápido "¿Qué pasó mientras no vi?"

**Archivos a revisar:**
- `bot.ts:1257-1274` — `getDiagnosticoChat()` — ya existe para un chat individual
- `src/api/server.ts` — API endpoints existentes
- `src/pedidos/pedido.service.ts` — Para agregar función de listar todos los pedidos activos
- `src/casos/caso.service.ts` — Para listar casos que requieren atención

**Problema:**
El dueño solo puede ver el estado de un chat a la vez. No hay una forma de obtener "dame todos los chats que necesitan mi atención ahora mismo".

**Solución Detallada:**

Agregar un endpoint HTTP GET `/api/resumen` que devuelva:

```json
{
  "requierenAtencion": [
    { "telefono": "521234567890", "cliente": "María", "motivo": "Comprobante sin leer", "ultimoMensaje": "...", "hace": "5 min" },
    { "telefono": "521234567891", "cliente": "Pedro", "motivo": "Queja", "ultimoMensaje": "...", "hace": "2 min" }
  ],
  "esperandoPago": [
    { "telefono": "521234567892", "cliente": "Ana", "producto": "Ramo de rosas", "total": 450, "hace": "30 min" }
  ],
  "pedidosHoy": 5,
  "ventasHoy": 1250
}
```

**En bot.ts ya existe:**
- `getDiagnosticoChat(chatId)` — para un chat
- `obtenerVentasHoy()` — ventas del día
- `obtenerClientesAtendidosHoy()` — clientes

Solo falta agregar un endpoint que itere sobre `PEDIDOS` y filtre por estado.

**Criterio de éxito:** El dueño puede hacer `curl http://localhost:3000/api/resumen` y ver el estado completo.

---

## [ ] 2.3 Simplificar notificaciones de Telegram (anti-spam)

**Archivos a revisar:**
- `src/events/telegram.subscriber.ts:1-110` — Suscripción de 28 eventos
- `src/notification-engine/notification.engine.ts:1-267` — Pipeline de notificaciones
- `src/notification-engine/template.builder.ts` — Construcción del mensaje de Telegram
- `src/notification-engine/conflict.detector.ts` — Detector de conflictos
- `src/notification-engine/business-rules.validator.ts` — Validación de reglas

**Problema:**
Un solo pedido puede generar 6+ notificaciones:
`ORDER_CREATED` → `ORDER_UPDATED` → `PRICE_CONFIRMED` → `PAYMENT_PENDING` → `PAYMENT_RECEIVED` → `ORDER_READY`

El dueño recibe un spam de notificaciones y no distingue lo importante de lo trivial.

**Solución Detallada:**

**Paso 1 — Agrupar eventos por pedido en la última hora:**
En lugar de enviar cada evento individual, acumularlos en un buffer de 2 minutos por pedido y enviar un solo resumen:

```typescript
// Nuevo archivo: src/events/notification-aggregator.ts
const PENDING_NOTIFICATIONS = new Map<string, { events: SystemEvent[]; timer: NodeJS.Timeout }>()
const AGGREGATION_WINDOW_MS = 2 * 60_000  // 2 minutos

export function aggregateAndNotify(event: SystemEvent): void {
  // Solo agregar eventos de pedidos (no system events)
  if (!event.payload.orderId) return
  
  const key = event.payload.orderId
  const existing = PENDING_NOTIFICATIONS.get(key)
  if (existing) clearTimeout(existing.timer)
  
  const events = [...(existing?.events ?? []), event]
  const timer = setTimeout(() => {
    PENDING_NOTIFICATIONS.delete(key)
    sendAggregatedNotification(key, events)
  }, AGGREGATION_WINDOW_MS)
  
  PENDING_NOTIFICATIONS.set(key, { events, timer })
}

function sendAggregatedNotification(orderId: string, events: SystemEvent[]): void {
  // Tomar el último evento de cada tipo
  const lastEvent = events[events.length - 1]
  // Construir mensaje único con el resumen
  const mensaje = buildAggregatedMessage(lastEvent, events.length)
  enviarMensajeTelegram(mensaje)
}
```

**Paso 2 — Clasificar por tipo de notificación:**
- **🔴 Críticas** (llegan inmediatamente): HUMAN_REQUIRED, CUSTOMER_ANGRY, PAYMENT_CONFIRMED, CANCELACION_REQUESTED
- **🟡 Importantes** (agrupar cada 2 min): ORDER_CREATED, PAYMENT_RECEIVED, ORDER_READY
- **🔵 Informativas** (solo en resumen diario): ORDER_UPDATED, PRICE_CONFIRMED, PHOTO_SENT, ENVIO_REQUESTED

**Paso 3 — En el mensaje de Telegram, usar formato claro:**
```
🌸 Pedido actualizado
Cliente: María
Producto: Ramo de rosas
💰 $450 MXN
📍 Sucursal Centro
📌 Esperando pago
```

**Criterio de éxito:** El dueño recibe 1 notificación por pedido cada 2 min (no 6+), con información clara y acción requerida visible.

---

## [ ] 2.4 Comando "¿Qué pasó?" por Telegram

**Archivos a revisar:**
- `lib/telegram.ts` — Manejo de mensajes entrantes de Telegram
- `bot.ts:1257-1274` — `getDiagnosticoChat()` (reutilizar)
- `src/api/server.ts` — Endpoints existentes

**Problema:**
El dueño no puede preguntarle al bot "oye, ¿qué está pasando con todos los chats?".

**Solución Detallada:**

En `lib/telegram.ts`, procesar mensajes entrantes del dueño:
```typescript
// Si el dueño escribe "resumen" o "qué pasó"
if (texto === '/resumen' || texto === 'resumen' || texto === 'qué pasó' || texto === 'que paso') {
  const resumen = await generarResumenEjecutivo()
  await enviarMensajeTelegram(resumen)
}
```

Donde `generarResumenEjecutivo()` itera sobre `PEDIDOS` y compila:
```
🌸 Resumen ejecutivo:
🟢 Cotizando: 3
💰 Esperando pago: 2
🔴 Requieren atención: 1
📦 Apartados: 2
✅ Entregados hoy: 1
```

**Criterio de éxito:** El dueño escribe "qué pasó" en Telegram y recibe el resumen.

---

# FASE 3 — ROBUSTEZ DEL SISTEMA

---

## [ ] 3.1 Precios dinámicos desde Supabase (P1)

**Archivos a revisar:**
- `src/openai/prompt.builder.ts:92-97` — Precios hardcodeados de flores individuales
- `src/openai/prompt.builder.ts:59-98` — `buildValidatedRulesSection()` — toda la sección de reglas
- `lib/supabase.ts` — Conexión a Supabase
- `src/validators/horario.validator.ts` — Horarios hardcodeados

**Problema:**
Los precios de flores ($25 la rosa, $40 la hortensia) y los horarios (10:00-19:00) están hardcodeados en `buildValidatedRulesSection()`. Si sube el precio de las rosas, hay que modificar código y redeployar. Lo mismo con horarios de temporada.

**Solución Detallada:**

Crear una tabla `configuracion_precios` en Supabase:
```sql
CREATE TABLE configuracion_precios (
  id SERIAL PRIMARY KEY,
  clave TEXT UNIQUE NOT NULL,  -- 'rosa', 'hortensia', 'horario_lunes', etc.
  valor TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);
```

Y modificar `buildValidatedRulesSection()` para cargar desde Supabase con caché:

```typescript
// prompt.builder.ts
const CACHE_PRECIOS = { data: null as string | null, timestamp: 0 }
const CACHE_TTL = 5 * 60_000  // 5 min

async function cargarPrecios(): Promise<string> {
  const ahora = Date.now()
  if (CACHE_PRECIOS.data && ahora - CACHE_PRECIOS.timestamp < CACHE_TTL) {
    return CACHE_PRECIOS.data
  }
  
  const { data } = await supabaseAdmin
    .from('configuracion_precios')
    .select('clave, valor')
  
  if (!data) return FALLBACK_PRECIOS
  
  const map = new Map(data.map(r => [r.clave, r.valor]))
  const precios = [
    `- Rosa: $${map.get('rosa') ?? '25'} c/u | Hortensia: $${map.get('hortensia') ?? '40'} c/u | Lishianthus: $${map.get('lishianthus') ?? '35'} c/u`,
    // ...
  ].join('\n')
  
  CACHE_PRECIOS = { data: precios, timestamp: ahora }
  return precios
}
```

Hacer lo mismo con horarios: tabla `configuracion_horarios` en lugar de hardcode.

**Criterio de éxito:** Cambiar el precio de la rosa en Supabase → el bot usa el nuevo precio sin redeploy.

---

## [ ] 3.2 Máquina de estados: validar transiciones desde flujo (P1)

**Archivos a revisar:**
- `src/pedidos/pedido.service.ts:14-28` — `TRANSICIONES_VALIDAS` (✅ ya definidas correctamente)
- `src/pedidos/pedido.service.ts:226-244` — `transitar()` — función que valida contra el map
- `src/pedidos/pedido.service.ts:313-341` — `transitarDesdeFlujo()` — mapea strings a estados y llama a `transitar()`
- `bot.ts:463-472` — `estadoFlujoDesdeEstado()` — convierte estados del sistema legacy a flujo
- `src/whatsapp/message-handler.ts` — Múltiples llamadas a `transitarDesdeFlujo()`

**Problema:**
`transitarDesdeFlujo()` fuerza transiciones mediante un mapping (línea 321-334) y llama a `transitar()`. Pero:
1. `transitarDesdeFlujo()` se llama desde `message-handler.ts` sin verificar primero si el pedido está en un estado que permita la transición
2. `transitar()` sí valida, pero `transitarDesdeFlujo()` ignora el resultado booleano (no verifica si la transición fue exitosa)
3. Un pedido puede estar en `APARTADO` (pagado) y una llamada a `transitarDesdeFlujo('cotizando')` no va a fallar visiblemente — va a loguear un warning pero el flujo continúa como si nada

**Solución Detallada:**

**Paso 1 — Hacer `transitarDesdeFlujo()` retornar void pero LOGUEAR el error:**
```typescript
export function transitarDesdeFlujo(clienteId: string, flujo: string, motivo?: string): boolean {
  const pedido = PEDIDOS.get(clienteId)
  if (!pedido || !pedido.estado) return false
  
  const mapping: Record<string, EstadoPedido> = { ... }
  const nuevo = mapping[flujo]
  if (!nuevo) return false
  
  const resultado = transitar(pedido, nuevo)
  if (!resultado) {
    console.error(`[pedidos] ⚠️ transitarDesdeFlujo: ${pedido.estado} → ${nuevo} (${flujo}) INVALIDA para ${clienteId}`)
    // Emitir evento de error para que Telegram notifique
    eventBus.emit(EventType.PROVIDER_FAILURE, {
      telefono: pedido.telefono ?? '',
      descripcion: `Transición inválida: ${pedido.estado} → ${nuevo} (${flujo})`,
    })
  }
  return resultado
}
```

**Paso 2 — Revisar cada llamada a `transitarDesdeFlujo()` en `message-handler.ts`:**
Buscar todas las ocurrencias de `transitarDesdeFlujo(` en `message-handler.ts` y verificar que el estado actual del pedido permita la transición ANTES de llamarla.

**Paso 3 — Agregar validación previa en los puntos críticos:**
```typescript
// Ejemplo en message-handler.ts antes de transitarDesdeFlujo
const pedido = deps.pedidoActual(clienteId)
if (pedido.estado === EstadoPedido.APARTADO || pedido.estado === EstadoPedido.ARCHIVADO) {
  // No permitir cambiar un estado ya pagado/archivado
  console.warn(`[message-handler] Intento de cambiar estado de pedido ${pedido.estado} para ${clienteId}`)
  return
}
```

**Criterio de éxito:** No existe camino donde un pedido pague y luego se le cambie el estado a cotizando sin pasar por cancelación.

---

## [ ] 3.3 Rate limiting y dedup de notificaciones (P1)

**Archivos a revisar:**
- `src/whatsapp/bot-state.ts` — `ALERTAS_DEDUP`, `debeEnviarAlertaDedup()`, rate limiting
- `bot.ts:1059-1063` — Cooldown BOT_DISCONNECTED 30 min (✅ ya existe)
- `bot.ts:1018` — QR_GENERATED (eliminado de Telegram, ✅ ya se hizo)
- `src/whatsapp/message-handler.ts` — Múltiples llamadas a `debeEnviarAlertaDedup()`

**Problema:**
Ya hay un sistema de dedup (`ALERTAS_DEDUP` y `debeEnviarAlertaDedup()`), pero algunas alertas se emiten sin pasar por ese filtro.

**Solución Detallada:**

Auditar TODAS las emisiones de eventos en `message-handler.ts` y `bot.ts` para verificar que pasan por `debeEnviarAlertaDedup()`:

Buscar en `message-handler.ts`:
- `eventBus.emit(EventType.HUMAN_REQUIRED` → debe tener dedup de 20 min
- `eventBus.emit(EventType.CUSTOMER_ANGRY` → debe tener dedup de 30 min
- `eventBus.emit(EventType.COTIZACION_REQUESTED` → debe tener dedup de 30 min
- `eventBus.emit(EventType.ENVIO_REQUESTED` → debe tener dedup de 30 min
- `eventBus.emit(EventType.PHOTO_REQUESTED` → debe tener dedup de 60 min
- `eventBus.emit(EventType.PHOTO_SENT` → dedup de 30 min

Cada una verificar que usa la key correcta en `debeEnviarAlertaDedup()`.

**Criterio de éxito:** Cada tipo de evento tiene su propio cooldown y no se emite más de una vez en el período definido.

---

# FASE 4 — MEJORAS DE PARSER Y VALIDADORES

---

## [ ] 4.1 Parser de nombre: casos frontera (P1)

**Archivos a revisar:**
- `src/parser/nombre.parser.ts` — `parseNombre()`, `pareceNombreCliente()`
- `src/whatsapp/message-handler.ts:805-820` — Extracción de nombre desde texto
- `bot.ts:557-560` — `tieneNombreValido()`
- `bot.ts:569-583` — `nombreParaAlerta()` — resuelve el nombre para mostrar
- AGENTS.md → ERROR #1 (Caso Lizet)

**Problema:**
AGENTS.md ERROR #1 documenta que el parser tomaba "Lizet Cervantes Vargas, cree que podría..." como nombre completo. Aunque ya se mejoró, pueden haber más casos frontera.

**Solución Detallada:**

Revisar `nombre.parser.ts` y asegurar que:

1. **Detenerse en:** coma, punto, salto de línea, palabras reservadas, conectores
2. **Palabras NO válidas como nombre:** "gracias", "ok", "si", "vale", "listo", "ahí", "luego", "después"
3. **Mínimo de caracteres:** 3 (descartar "Ana" no... bueno "Ana" sí es válido, mínimo 2)
4. **Máximo de palabras:** 5 (un nombre de 6+ palabras probablemente no es nombre)
5. **Rechazar si contiene:** números, caracteres especiales, emojis, URLs

```typescript
// nombre.parser.ts — Reglas de validación estrictas
const STOP_WORDS = new Set(['gracias', 'ok', 'okay', 'si', 'sí', 'vale', 'dale', 'va', 'luego', 'despues', 'después', 'ahí', 'ahi', 'alli', 'allí', 'listo', 'claro', 'bueno', 'adelante', 'porfavor', 'por favor', 'exacto', 'perfecto', 'está bien', 'esta bien'])
const STOP_REGEX = /[,.\n;:!?]+/
const MAX_WORDS = 5
const MIN_LENGTH = 2

export function parseNombre(texto: string): string | null {
  // Tomar solo hasta el primer signo de puntuación
  const hastaPunto = texto.split(STOP_REGEX)[0]?.trim()
  if (!hastaPunto) return null
  
  const palabras = hastaPunto.split(/\s+/)
  if (palabras.length > MAX_WORDS) return null
  if (hastaPunto.length < MIN_LENGTH) return null
  if (/\d/.test(hastaPunto)) return null
  if (STOP_WORDS.has(hastaPunto.toLowerCase())) return null
  
  // Verificar que parece nombre real
  if (!/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]*(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]*){0,4}$/.test(hastaPunto)) {
    // Intentar capitalizar
    const capitalizado = palabras.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
    if (capitalizado.length >= MIN_LENGTH && capitalizado.length <= 80) {
      return capitalizado
    }
    return null
  }
  
  return hastaPunto
}
```

**Criterio de éxito:** "Lizet Cervantes Vargas, cree que podría..." → "Lizet Cervantes Vargas" (no consume el resto).

---

## [ ] 4.2 Response Validator: casos no cubiertos (P1)

**Archivos a revisar:**
- `src/validators/response.validator.ts` — `validarRespuestaIA()`, `sanitizarRespuestaIA()`
- `src/whatsapp/message-handler.ts:934-946` — Uso del validator

**Problema:**
El response validator existe pero solo valida algunos casos. Puede haber alucinaciones que pase desapercibidas.

**Solución Detallada:**

Revisar `response.validator.ts` y agregar validaciones para:
1. **No inventar precios:** Si la respuesta contiene un número que no está en el contexto, rechazar
2. **No confirmar horarios fuera del rango:** Si menciona una hora, verificar contra `validarHorario()`
3. **No prometer stock:** Si dice "tenemos disponible", verificar que no es un invento
4. **No confirmar entregas:** Si dice "se entrega el [fecha]", verificar que el pedido tiene esa fecha registrada
5. **No inventar sucursales:** Si menciona una sucursal, verificar que existe

```typescript
// Agregar en response.validator.ts
export function validarRespuestaIA(respuesta: string, contexto: string): { valido: boolean; razon: string | null } {
  const errores: string[] = []
  
  // Detectar precios no autorizados
  const preciosRespuesta = respuesta.match(/\$\d+/g)
  if (preciosRespuesta) {
    for (const precio of preciosRespuesta) {
      const monto = parseInt(precio.replace('$', ''))
      // Si el precio no está en el contexto, puede ser inventado
      if (!contexto.includes(precio) && monto > 0) {
        // Solo warning si el precio es bajo (ej. $10 para nota)
        if (monto > 100) {
          errores.push(`Precio ${precio} no verificado en contexto`)
        }
      }
    }
  }
  
  // Detectar confirmación de horario sin respaldo
  if (/\b(est[aá]r[aá] listo|lo tendremos|entregamos a las)\b/i.test(respuesta)) {
    const horaMatch = respuesta.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
    if (horaMatch) {
      errores.push('No confirmar horarios sin validación del backend')
    }
  }
  
  return {
    valido: errores.length === 0,
    razon: errores.length > 0 ? errores.join('; ') : null,
  }
}
```

**Criterio de éxito:** Si el LLM intenta decir "Sí, tenemos ese ramo disponible" cuando no hay inventario, el validador lo rechaza.

---

# FASE 5 — MÓDULOS FALTANTES

---

## [ ] 5.1 Sistema de inventario básico (P2)

**Archivos a revisar:**
- `src/models/types.ts:230-240` — `ProductoDetalle` (✅ interfaz ya existe)
- `lib/supabase.ts` — Conexión
- `src/openai/prompt.builder.ts` — Para inyectar disponibilidad
- `src/validators/` — Para validar stock

**Problema:**
El bot puede prometer arreglos que no existen. No hay verificación de inventario en ningún lado.

**Solución Detallada:**

**Paso 1 — Crear tabla `inventario` en Supabase:**
```sql
CREATE TABLE inventario (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  precio NUMERIC(10,2) NOT NULL,
  disponible BOOLEAN DEFAULT TRUE,
  existencias INTEGER DEFAULT 0,
  imagen_url TEXT,
  temporada TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);
```

**Paso 2 — Crear `inventario.service.ts`:**
```typescript
const CACHE_INVENTARIO = { data: null as ProductoDetalle[] | null, timestamp: 0 }

export async function obtenerInventarioDisponible(): Promise<ProductoDetalle[]> {
  // Cargar con caché de 5 min
}

export async function verificarDisponibilidad(producto: string): Promise<boolean> {
  // Buscar en inventario
}
```

**Paso 3 — Integrar en `buildValidatedRulesSection()`:**
```typescript
// Agregar al prompt:
`[PRODUCTOS DISPONIBLES] ${productosDisponibles}`
```

**Criterio de éxito:** Si no hay rosas rojas, el bot no ofrece ramos de rosas rojas.

---

## [ ] 5.2 Seguimiento de reclamaciones (P2)

**Archivos a revisar:**
- `src/whatsapp/message-handler.ts:195-208` — `registrarReclamacion()` (✅ ya existe)
- `src/whatsapp/message-handler.ts:654-675` — Detección de cancelación y queja (✅ ya existe)
- `lib/supabase.ts` — Conexión

**Problema:**
Las reclamaciones se registran en Supabase pero nunca se les da seguimiento. Quedan como "pendiente" para siempre.

**Solución Detallada:**

Crear un comando en Telegram para listar reclamaciones pendientes:
```
/reclamaciones
```

Y un endpoint que permita cambiar estado:
```
/marcar_resuelto <id>
```

**Criterio de éxito:** El dueño puede ver y cerrar reclamaciones desde Telegram.

---

## [ ] 5.3 Dashboard administrativo web (P3)

**Archivos a revisar:**
- `src/api/server.ts` — Servidor HTTP existente
- `bot.ts:1294-1310` — Configuración del server
- `bot.ts:1257-1274` — `getDiagnosticoChat()`

**Problema:**
Existe un servidor HTTP (`startServer()`) pero no está claro qué endpoints tiene ni si el dueño los usa.

**Solución Detallada:**

Agregar endpoints REST básicos:
```
GET  /api/pedidos          → Listar todos los pedidos activos
GET  /api/pedidos/:id      → Detalle de un pedido
POST /api/pedidos/:id/precio → Actualizar precio (cuando el equipo cotiza)
POST /api/pedidos/:id/estado  → Cambiar estado manualmente
GET  /api/resumen          → Resumen ejecutivo (dueño)
```

**Criterio de éxito:** El dueño puede ver y modificar pedidos desde el navegador.

---

# FASE 6 — DOCUMENTACIÓN Y CIERRE

---

## [ ] 6.1 Actualizar CHANGELOG.md

Después de cada módulo completado, agregar entrada con:
- Fecha
- Versión (2.1.0, 2.2.0, etc.)
- Archivos modificados
- Descripción del cambio
- Impacto (compatible/incompatible)
- Rollback (sí/no)

## [ ] 6.2 Actualizar DECISIONS.md

Después de cambios arquitectónicos importantes (ej. cambio a múltiples pedidos), agregar entrada DEC-NNN con:
- Título
- Motivo
- Alternativas consideradas
- Resultado
- Estado (Aceptada)

## [ ] 6.3 Actualizar TODO.md

Actualizar porcentajes de cada fase después de cada módulo.

## [ ] 6.4 Actualizar KNOWN_BUGS.md

Marcar bugs resueltos como "Resuelto" con la versión donde se corrigió.

---

# CHECKLIST GLOBAL

| # | Módulo | Prioridad | Estado | Fecha | Archivos modificados |
|---|--------|-----------|--------|-------|---------------------|
| 0.1 | Reconexión WhatsApp (405) | 🔴 P0 | [ ] | — | `ninguno (operación en GCP)` |
| 0.2 | Verificación Telegram | 🟡 P2 | [ ] | — | `lib/telegram.ts` |
| 1.1 | Múltiples pedidos por cliente | 🔴 P0 | [x] | 2026-07-31 | `pedido.service.ts`, `pedido.repository.ts`, `src/pedidos/index.ts` |
| 1.2 | Persistencia síncrona con retry | 🔴 P0 | [x] | 2026-07-31 | `pedido.service.ts`, `pedido.repository.ts`, `bot.ts` |
| 1.3 | Ventana de agrupación con respaldo | 🔴 P0 | [x] | 2026-07-31 | `bot.ts` (ventana 60s→50s; respaldo nativo existente) |
| 1.4 | Parser de sucursal robusto | 🟠 P1 | [x] | 2026-07-31 | `sucursal.parser.ts`, `sucursal.validator.ts`, `message-handler.ts`, `types.ts`, `prompt.builder.ts` |
| 2.1 | Resumen diario Telegram 9am | 🟠 P1 | [ ] | — | `bot.ts`, `lib/telegram.ts` |
| 2.2 | Panel resumen rápido HTTP | 🟠 P1 | [ ] | — | `bot.ts`, `api/server.ts` |
| 2.3 | Simplificar notificaciones Telegram | 🟠 P1 | [ ] | — | `telegram.subscriber.ts`, `notification.engine.ts` |
| 2.4 | Comando "¿Qué pasó?" por Telegram | 🟡 P2 | [ ] | — | `lib/telegram.ts` |
| 3.1 | Precios dinámicos desde Supabase | 🟠 P1 | [ ] | — | `prompt.builder.ts`, `validators/horario.validator.ts` |
| 3.2 | Máquina de estados: validar transiciones | 🟠 P1 | [ ] | — | `pedido.service.ts`, `message-handler.ts` |
| 3.3 | Rate limiting y dedup completo | 🟠 P1 | [ ] | — | `bot-state.ts`, `message-handler.ts` |
| 4.1 | Parser de nombre: casos frontera | 🟠 P1 | [ ] | — | `nombre.parser.ts`, `message-handler.ts` |
| 4.2 | Response Validator expandido | 🟠 P1 | [ ] | — | `response.validator.ts` |
| 5.1 | Sistema de inventario básico | 🟡 P2 | [ ] | — | `inventario.service.ts` (nuevo), `prompt.builder.ts` |
| 5.2 | Seguimiento de reclamaciones | 🟡 P2 | [ ] | — | `lib/telegram.ts`, `message-handler.ts` |
| 5.3 | Dashboard administrativo web | 🟢 P3 | [ ] | — | `api/server.ts` |
| 6.1-4 | Documentación | 🟢 P3 | [ ] | — | `CHANGELOG.md`, `DECISIONS.md`, `TODO.md`, `KNOWN_BUGS.md` |

---

# PRIORIDAD DE IMPLEMENTACIÓN RECOMENDADA

```
1. [P0] 0.1 Reconexión WhatsApp (405) → El negocio está parado sin esto
2. [P0] ✅ 1.1 Múltiples pedidos por cliente → COMPLETADO 2026-07-31
3. [P0] ✅ 1.2 Persistencia síncrona con retry → COMPLETADO 2026-07-31
4. [P0] ✅ 1.3 Ventana de agrupación 50s → COMPLETADO 2026-07-31
5. [P1] ✅ 1.4 Parser de sucursal robusto → COMPLETADO 2026-07-31
6. [P1] 2.1 Resumen diario Telegram → Dueño tiene visibilidad
7. [P1] 2.3 Simplificar notificaciones Telegram → Dueño no se pierde
8. [P1] 3.2 Máquina de estados: validar transiciones → Integridad de datos
9. [P1] 4.1 Parser de nombre: casos frontera → Menos errores de captura
9. [P1] 4.1 Parser de nombre: casos frontera → Menos errores de captura
10. [P1] 3.1 Precios dinámicos → Sin redeploy para cambiar precios
11. [P2+] Resto de módulos
```

---

*Fin del Plan Maestro de Soluciones — Flora 3.0*
