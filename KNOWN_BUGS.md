# KNOWN_BUGS.md — Errores Conocidos

> Documento oficial de errores conocidos (exigido por AGENTS.md Parte 4.2A).
> Nunca eliminar bugs. Marcar como resueltos.

## BUG-001: Alertas de Telegram llegan sin datos (producto/total/cliente vacíos)
- **Prioridad:** Alta
- **Estado:** Abierto
- **Reportado:** 2026-07-17
- **Síntomas:** Las alertas VENTA CERRADA / PEDIDO APARTADO llegan con `Producto:`, `Total:`, `Cliente:` vacíos.
- **Causa raíz (sospecha):** Los eventos `ORDER_CREATED`/`ORDER_UPDATED` emitidos desde `message-handler.ts` y `bot.ts` no incluyen `producto`, `total` ni `cliente` en el payload.
- **Versión donde apareció:** 3.0.0
- **Versión donde se corrigió:** —

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
- **Estado:** Abierto
- **Reportado:** 2026-07-17
- **Síntomas:** El cliente pidió ver fotos de ramos armados. La alerta a Telegram llegó sin decir qué ramo vio ni con número legible (LID enmascarado a `xxx5844`).
- **Causa raíz:** `PHOTO_REQUESTED` se emite con `cliente: ''` y sin el contexto del ramo visto; la alerta `enviarAlertaEmpleadoFotos` no incluye número real mapeado ni producto.
- **Nota:** El canal WhatsApp-a-empleados SÍ funciona (`[notif] Notificando a 4 empleado(s)`). Se requiere mejorar la alerta Telegram (ambos canales, decisión de usuario 2026-07-17).
- **Versión donde apareció:** 3.0.0
- **Versión donde se corrigió:** —
