# KNOWN_BUGS.md — Errores Conocidos

> Documento oficial de errores conocidos (exigido por AGENTS.md Parte 4.2A).
> Nunca eliminar bugs. Marcar como resueltos.

## BUG-001: Alertas de Telegram llegan sin datos (producto/total/cliente vacíos)
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (2026-07-17, DEC-041)
- **Reportado:** 2026-07-17
- **Síntomas:** Las alertas VENTA CERRADA / PEDIDO APARTADO llegan con `Producto:`, `Total:`, `Cliente:` vacíos.
- **Causa raíz:** `pedido.service.ts` emitía `ORDER_CREATED`/`ORDER_UPDATED` sin `producto`/`total`/`cliente` en el payload.
- **Corrección:** `buildOrderPayload(pedido)` mapea datos reales del `PedidoActual`; `crearPedido` ahora emite `ORDER_UPDATED` (no `ORDER_CREATED`).
- **Versión donde se corrigió:** 3.0.1

## BUG-002: "VENTA CERRADA" falsa por interés de compra
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (2026-07-17, DEC-039)
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente solo mostró intención de compra y llegó alerta "🌸 ¡VENTA CERRADA!".
- **Causa raíz:** `message-handler.ts` emitía `ORDER_CREATED` en el bloque `esInteresCompra`.
- **Corrección:** Se emite `COTIZACION_REQUESTED` con payload robusto (teléfono real, cliente, descripción con producto + texto). `enviarAlertaCotizacion` ahora dice "INTERÉS / COTIZACIÓN".
- **Versión donde se corrigió:** 3.0.1

## BUG-003: Alerta de "cliente pide fotos" sin contexto ni número real
- **Prioridad:** Alta
- **Estado:** ✅ Resuelto (DEC-043, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** El cliente pidió ver fotos de ramos armados. La alerta a Telegram llegó sin decir qué ramo vio ni con número legible (LID enmascarado a `xxx5844`).
- **Causa raíz:** `PHOTO_REQUESTED` se emitía con `cliente: ''` y sin contexto; `enviarAlertaEmpleadoFotos` no mostraba número real ni producto.
- **Corrección:** `PHOTO_REQUESTED` con `telefono` real, `cliente` y `descripcion`; `enviarAlertaEmpleadoFotos` muestra número real + contexto. Ambos canales.
- **Versión donde se corrigió:** 3.0.1

## BUG-004: Máquina de estados rota — pedido nunca llega a APARTADO
- **Prioridad:** 🔴 Crítica
- **Estado:** ✅ Resuelto (DEC-044, 2026-07-17)
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente fue de cotización a "quiero pagar/envío". Logs mostraban `Transición inválida: COTIZANDO → ESPERANDO_PAGO`, `ESPERANDO_PAGO → EN_PRODUCCION` y `ESPERANDO_PAGO → ESPERANDO_PAGO`. El pedido nunca pasó por APARTADO, así que la alerta "Pedido Apartado" no salió con dirección/total; al enviar comprobante se emitió ORDER_CREATED con datos vacíos (`cliente:"Me pasa su cuenya pla"`).
- **Causa raíz:** (1) `TRANSICIONES_VALIDAS` no permitía `COTIZANDO → ESPERANDO_PAGO` ni `PRECIO_CONFIRMADO → ESPERANDO_PAGO`. (2) `transitarDesdeFlujo` **forzaba** `pedido.estado = nuevo` aunque la transición fuera inválida, permitiendo saltos imposibles. (3) `pagado_transferencia` mapeaba a `EN_PRODUCCION` (saltando APARTADO).
- **Corrección:** Agregadas transiciones `NUEVO/COTIZANDO/PRECIO_CONFIRMADO/ESPERANDO_DATOS → ESPERANDO_PAGO`. `pagado_transferencia` ahora mapea a `APARTADO`. `transitarDesdeFlujo` ya NO fuerza estados inválidos (se queda en el anterior y queda en el log).
- **Impacto:** El pago confirmado ahora sí transita a APARTADO con datos; ORDER_CREATED solo al cierre real. Cubierto por `tests/event-wire-flow.test.mts` (caso BUG-004).
- **Versión donde se corrigió:** 3.0.2

## BUG-005: Nombre en alertas Telegram incorrecto / no se pide nombre
- **Prioridad:** Alta
- **Estado:** 🔴 Abierto
- **Reportado:** 2026-07-17
- **Síntomas:** Alertas Telegram de pedido mostraban `cliente:"Me pasa su cuenya pla"` (texto del mensaje, no el nombre). El sistema no pidió el nombre de quien aparta/recibe antes de cerrar.
- **Causa raíz:** `buildOrderPayload` usa `pedido.nombre` que nunca se llenó; el `ventaCerradaHandler` tomó texto del mensaje. Falta exigir nombre + teléfono (si envío) antes del cierre.
- **Decisión de negocio (2026-07-17):** El sistema DEBE pedir nombre de quien aparta/recibe y teléfono (en caso de envío) antes de cerrar.
- **Versión donde apareció:** 3.0.0
- **Versión donde se corrigió:** —

## BUG-006: Horario inventado por el LLM
- **Prioridad:** Alta
- **Estado:** 🔴 Abierto
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente preguntó "a qué hora cierran" un viernes; bot dijo "Mañana cerramos a las 7:00 pm" (era sábado, cierra 5pm).
- **Causa raíz:** El LLM calculó "mañana" sin usar la tabla de horarios del prompt; backend no inyecta el horario calculado.
- **Decisión de negocio (2026-07-17):** El backend debe inyectar dinámicamente el horario de hoy/mañana en el contexto (calculado en código, no por el LLM) — cumple AGENTS.md ERROR #3.
- **Versión donde apareció:** 3.0.0
- **Versión donde se corrigió:** —

## BUG-007: Dirección Maps short-link repetido sin calle
- **Prioridad:** Media
- **Estado:** 🔴 Abierto
- **Reportado:** 2026-07-17
- **Síntomas:** Cliente envió `maps.app.goo.gl/...`; bot repitió el link como dirección sin calle legible.
- **Causa raíz:** El parser de dirección acepta el short-link como dirección válida y no pide confirmación de calle en texto.
- **Decisión de negocio (2026-07-17):** Opción A — guardar el link Y pedir que el cliente confirme la calle en texto.
- **Versión donde apareció:** 3.0.0
- **Versión donde se corrigió:** —
