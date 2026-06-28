# Resumen de Sesion - Ajustes Flujo de Pedidos

Fecha: 2026-06-28

## Objetivo

Hacer mas robusto el flujo de Flora para evitar errores cuando un cliente deja una cotizacion inconclusa, inicia una compra nueva con fotos disponibles, manda comprobantes por transferencia o aparta para recoger en sucursal.

## Cambios Realizados

### 1. Comprobantes despues de cuenta BBVA

Problema:
- Cuando Flora ya habia enviado la cuenta BBVA y el cliente mandaba foto del comprobante, el bot podia clasificar la imagen como foto de referencia.

Cambio:
- Se amplio `contextoEsperaComprobante()` para detectar frases como `mandame tu comprobante`, `pon tu nombre en concepto`, `BBVA`, `4152`, `Devi America` y `cuando este listo`.
- Se agrego `respuestaPideComprobante()` para marcar el pedido como `esperando_pago` cuando Flora manda instrucciones de transferencia.
- Se amplio el historial reciente usado para clasificar imagenes de 3 a 8 mensajes.

Resultado esperado:
- Si el cliente envia una imagen despues de que Flora pidio comprobante, se registra como comprobante y se manda alerta de pago, no como cotizacion.

Commit relacionado:
- `0e84659 fix: detecta comprobantes tras cuenta BBVA`

### 2. Fotos disponibles y precios viejos

Problema:
- Si el cliente tenia una cotizacion vieja de $400/$600 y despues pedia `ramitos disponibles hoy`, el bot podia reutilizar el precio anterior cuando el cliente decia `este` o `que precio tiene` sobre fotos nuevas enviadas por el equipo.

Cambio:
- Se agrego memoria temporal `FOTOS_DISPONIBLES_RECIENTES`.
- Cuando el cliente pide fotos o ramos disponibles, se limpia el pedido activo anterior con `resetearPedidoActivo()`.
- Cuando el equipo manda imagenes o dice algo como `esos tenemos disponibles`, el bot marca que hay fotos disponibles recientes.
- Si el cliente elige una foto reciente, el bot crea un pedido nuevo como `Ramo elegido de fotos disponibles`, sin precio confirmado.
- Si pregunta precio, el bot no reutiliza precios anteriores y pide confirmacion al equipo.

Resultado esperado:
- El bot ya no debe decir que un ramo nuevo vale $600 solo porque ese precio existia en una cotizacion anterior.

Commit relacionado:
- `b71366e fix: evita precios viejos en fotos disponibles`

### 3. Precio de envio separado del precio del ramo

Problema:
- Cuando el cliente mandaba direccion y luego el empleado respondia `Le saldria en 80`, el bot podia confundir ese precio como precio del ramo.

Cambio:
- Se agrego `esperandoPrecioEnvio` al pedido en curso.
- Cuando el cliente comparte direccion o link de Maps, el pedido queda marcado como esperando precio de envio.
- Si el empleado responde con un precio mientras esa marca esta activa, el bot lo guarda como envio.

Resultado esperado:
- Los precios de envio se guardan como envio y no reemplazan el precio del arreglo.

Commit relacionado:
- `b71366e fix: evita precios viejos en fotos disponibles`

### 4. Dashboard sin sumar envio al monto de venta

Problema:
- Las ventas con envio se registraban en el dashboard con el total completo, por ejemplo ramo $250 + envio $45 = $295.
- Se queria que el dashboard registrara solo el precio del ramo.

Cambio:
- Se agrego `totalDashboardPedido()`.
- `ventaCerradaHandler()` ahora registra en `reporte_ventas` solo el precio del arreglo cuando existe en el estado del pedido.
- La alerta operativa de Telegram conserva el desglose con envio.

Resultado esperado:
- Dashboard: muestra venta del ramo por $250.
- Telegram: sigue mostrando ramo $250, envio $45 y total operativo $295.

### 5. Apartados en sucursal con pago al recoger

Problema:
- Cuando el cliente decia que pasaria a sucursal y pagaria al recoger, Flora respondia que el ramo quedaba apartado, pero no se registraba en dashboard ni enviaba alerta operativa completa.

Cambio:
- `pedidoApartadoHandler()` ahora tambien registra en `reporte_ventas` como apartado.
- Se registra con metodo `Efectivo al recoger` o `Tarjeta al recoger` segun el estado del pedido.
- El flujo automatico de apartado en sucursal ahora responde al cliente con confirmacion y manda alerta.
- La ruta de confirmacion corta marca `ventaCerrada = true` para evitar que el flujo continue hacia la IA despues de registrar.

Resultado esperado:
- Un pedido de sucursal con pago al recoger aparece en dashboard como apartado y manda alerta al equipo.

### 6. Fecha/hora aproximada para sucursal

Problema:
- Frases como `manana temprano` no eran suficientes para cerrar/apartar, porque el detector no reconocia `temprano` como hora.

Cambio:
- `extraerFechaHoraPedido()` ahora reconoce `temprano` y `al abrir` como hora aproximada.

Resultado esperado:
- `manana temprano` o `manana al abrir` permite cerrar/apartar cuando ya hay nombre, precio y sucursal.

## Verificacion Hecha

Se verifico `bot.ts` con TypeScript aislado:

```bash
npx tsc --noEmit --pretty false --skipLibCheck --esModuleInterop --moduleResolution bundler --module esnext --target es2022 bot.ts
```

Resultado:
- Sin errores.

## Notas Pendientes

- `npm run test:flows` ya venia fallando porque `_prompt_actualizado.txt` no contiene la frase esperada `No adivines`.
- `npm run build:local` ya venia fallando por un `implicit any` en `lib/googleSheets.ts`.
- El archivo `_PLAN_MEJORAS_FLUJO_PEDIDOS.md` sigue sin seguimiento y no fue incluido en estos commits porque ya existia como archivo pendiente separado.
