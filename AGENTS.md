# 🌸 AGENTS.md

======================================

PROTOCOLO DE INICIO OBLIGATORIO

======================================

Este documento es la autoridad máxima del proyecto.

Antes de escribir una sola línea de código deberás leer completamente este archivo.

Nunca asumir.

Nunca improvisar.

Nunca comenzar por el código.

Primero comprender.

Después diseñar.

Después implementar.

Si existe contradicción entre el código y este documento:

gana este documento.

Después de terminar la lectura deberás construir internamente un modelo mental del proyecto.

Si una sección no está clara deberás revisar el código correspondiente antes de modificar cualquier archivo.

Nunca omitir secciones.

Nunca responder únicamente con fragmentos del documento.

Este archivo debe considerarse la especificación oficial del sistema.

# Jardin RoCe - Flora AI
### Arquitectura Oficial del Proyecto
Versión: 2.0
Estado: En Refactorización Mayor
Autor de Arquitectura: OpenAI + David Alonso Cante Herrera

---

# PROPÓSITO DE ESTE DOCUMENTO

Este documento NO es un README.

Este documento contiene TODAS las reglas de arquitectura que cualquier IA o desarrollador debe seguir antes de modificar el proyecto.

La prioridad absoluta es mantener un sistema robusto, mantenible y escalable.

Si alguna implementación contradice este documento, este documento tiene prioridad.

La IA debe leer este archivo completo antes de escribir una sola línea de código.

Nunca asumir.

Nunca improvisar.

Nunca romper compatibilidad.

Siempre entender primero el proyecto completo.

---

# VISIÓN GENERAL DEL PROYECTO

Flora es la asistente virtual oficial de Jardín RoCe.

Su propósito NO es únicamente responder mensajes de WhatsApp.

Su verdadero propósito es administrar completamente el ciclo de atención de un cliente desde el primer mensaje hasta la postventa.

Actualmente el sistema integra:

- WhatsApp
- OpenAI
- Telegram
- Supabase
- Catálogo
- Cotizaciones
- Pedidos
- Historial
- Imágenes
- Audios
- Panel administrativo

La arquitectura debe evolucionar para convertirse en un sistema CRM conversacional especializado para florerías.

La IA NO debe pensar que desarrolla un chatbot.

Debe pensar que desarrolla un sistema de gestión comercial cuyo canal principal es WhatsApp.

---

# FILOSOFÍA DEL PROYECTO

El cliente nunca debe sentir que habla con un robot.

Pero internamente el sistema debe ser extremadamente estricto.

Toda decisión importante debe ser tomada por el backend.

La IA únicamente debe generar lenguaje natural.

El backend debe controlar:

- pedidos
- estados
- pagos
- horarios
- sucursales
- inventario
- notificaciones
- reglas de negocio

La IA jamás debe decidir información crítica.

---

# OBJETIVOS DE LA REFACTORIZACIÓN

Esta actualización NO busca únicamente corregir bugs.

Busca cambiar completamente la arquitectura.

Los objetivos son:

✔ Eliminar pérdidas de pedidos.

✔ Separar conversación y pedido.

✔ Implementar estados reales.

✔ Evitar respuestas inventadas.

✔ Mejorar Telegram.

✔ Facilitar mantenimiento.

✔ Hacer que el proyecto pueda crecer durante años.

✔ Reducir la cantidad de lógica dentro de bot.ts.

✔ Convertir Telegram en un panel operativo.

✔ Crear un sistema de casos.

✔ Evitar dependencias innecesarias del LLM.

✔ Hacer que toda decisión importante pase por el backend.

---

# ERRORES DETECTADOS EN LA VERSIÓN ANTERIOR

La siguiente lista contiene errores reales encontrados durante producción.

Todos deben quedar solucionados.

---

## ERROR #1

Parser incorrecto del nombre.

Ejemplo real:

Cliente:

"A nombre de Lizet Cervantes Vargas, cree que podría..."

Resultado:

Nombre almacenado:

"Lizet Cervantes Vargas, cree que podría..."

Resultado esperado:

"Lizet Cervantes Vargas"

Nunca volver a utilizar regex que consuman frases completas.

El parser deberá detenerse en:

- coma
- punto
- salto de línea
- palabras reservadas
- conectores

---

## ERROR #2

Sucursal por defecto.

Cuando el cliente escribía:

"La que está por la Av. Morelos"

El sistema generaba:

"Apizaco (sucursal)"

Esto nunca debe ocurrir.

Si no existe suficiente información:

El valor debe permanecer vacío.

Nunca inventar sucursal.

---

## ERROR #3

El LLM confirmaba horarios.

Ejemplo real.

Cliente:

¿Puede estar listo a las 9:30?

Horario de apertura:

10:00

El modelo respondió:

"Sí podemos."

Esto jamás debe volver a suceder.

Los horarios únicamente pueden ser validados por el backend.

---

## ERROR #4

Pedidos cerrados únicamente mediante token.

La arquitectura anterior dependía del token

[VENTA_CERRADA]

Si el token no llegaba:

El pedido nunca era registrado.

Nueva regla:

Los pedidos deben existir independientemente del token.

---

## ERROR #5

Conversación y pedido eran considerados la misma entidad.

Esto produjo errores donde un cliente retomaba una conversación semanas después y el sistema seguía utilizando información antigua.

Esto queda prohibido.

---

## ERROR #6

Telegram dependía completamente del LLM.

Nueva regla:

Telegram debe depender de eventos del sistema.

Nunca de respuestas del modelo.

---

## ERROR #7

El prompt contenía demasiadas reglas de negocio.

Las reglas de negocio deben vivir en TypeScript.

No dentro del prompt.

---

# CASO REAL "LIZET"

Este caso será utilizado como caso de prueba durante toda la refactorización.

Resumen:

Cliente solicita catálogo.

Cotiza.

Pregunta precios.

Solicita ramo personalizado.

Da presupuesto.

Pregunta tamaño.

Acepta.

Da nombre.

Da fecha.

El sistema confirma.

El pedido nunca llega al equipo.

La cliente acude a sucursal.

El pedido no existe.

Este caso demuestra que la arquitectura anterior era incorrecta.

Toda la refactorización debe impedir que este caso vuelva a ocurrir.

---

# NUEVA ARQUITECTURA

La arquitectura deja de ser:

WhatsApp

↓

OpenAI

↓

Pedido

↓

Telegram

Y pasa a ser:

WhatsApp

↓

Motor de Conversación

↓

Motor de Casos

↓

Motor de Pedidos

↓

Validaciones

↓

Base de Datos

↓

Eventos

↓

Telegram

↓

OpenAI

↓

Respuesta al Cliente

OpenAI deja de tomar decisiones.

OpenAI únicamente redacta respuestas.

---

# PRINCIPIOS DE DISEÑO

Todo cambio futuro debe respetar los siguientes principios.

---

## Principio 1

Nunca duplicar lógica.

---

## Principio 2

Nunca almacenar el mismo dato en dos lugares.

---

## Principio 3

Las decisiones críticas pertenecen al backend.

---

## Principio 4

El LLM nunca debe inventar información.

---

## Principio 5

Toda modificación debe ser compatible con el historial existente.

---

## Principio 6

Cada módulo debe tener una única responsabilidad.

---

## Principio 7

Las reglas de negocio nunca deben vivir dentro del prompt.

---

## Principio 8

Todo pedido debe poder reconstruirse desde la base de datos.

---

## Principio 9

Todo evento importante debe generar una notificación.

---

## Principio 10

Todo cambio importante debe quedar documentado.

---

# CONVENCIONES DE CÓDIGO

Todo el proyecto deberá seguir estas reglas.

• TypeScript estricto.

• Interfaces antes que clases cuando sea posible.

• Funciones pequeñas.

• Una responsabilidad por archivo.

• Evitar archivos gigantes.

• No utilizar variables globales innecesarias.

• No escribir lógica dentro de rutas HTTP.

• Utilizar servicios.

• Utilizar tipos.

• Utilizar enums.

• Nunca utilizar strings mágicos.

• Evitar regex complejos.

• Documentar funciones críticas.

• Mantener compatibilidad con Supabase.

• Mantener compatibilidad con WhatsApp.

• Mantener compatibilidad con Telegram.

---

# FLUJO COMPLETO DE WHATSAPP

Todo mensaje recibido deberá seguir exactamente este flujo.

Mensaje recibido

↓

Guardar mensaje

↓

Guardar multimedia

↓

Actualizar historial

↓

Actualizar actividad del cliente

↓

Buscar caso activo

↓

Si no existe

↓

Crear nuevo caso

↓

Analizar intención

↓

Actualizar estado del caso

↓

Actualizar estado del pedido

↓

Ejecutar validaciones

↓

Construir contexto

↓

Enviar al LLM

↓

Validar respuesta

↓

Enviar respuesta

↓

Guardar respuesta

↓

Registrar eventos

↓

Enviar notificaciones necesarias

↓

Finalizar proceso

Nunca alterar este orden sin justificarlo.

---

# FLUJO DEL LLM

El modelo NO decide.

El modelo únicamente transforma datos estructurados en lenguaje natural.

Entradas del modelo:

• Historial

• Contexto

• Pedido

• Caso

• Reglas del sistema

• Información validada

Salida:

Texto únicamente.

Nunca modificar estados.

Nunca registrar pedidos.

Nunca confirmar horarios.

Nunca confirmar disponibilidad.

Nunca confirmar pagos.

Nunca registrar entregas.

Nunca modificar Telegram.

Todo eso pertenece al backend.

---

# FLUJO DE TELEGRAM

Telegram deja de ser un sistema de mensajes.

Ahora será un panel operativo.

Todos los cambios importantes deberán generar eventos.

Ejemplos:

Nuevo cliente

Nueva cotización

Pedido iniciado

Precio confirmado

Esperando anticipo

Anticipo recibido

Pedido apartado

Pedido en producción

Pedido listo

Pedido entregado

Pedido cancelado

Cada evento debe contener:

ID del caso

ID del pedido

Cliente

Sucursal

Prioridad

Estado

Hora

Fecha

Responsable (si existe)

Telegram nunca dependerá del texto generado por OpenAI.

Telegram dependerá exclusivamente de eventos emitidos por el backend.

Fin Parte 1.
# ===================================================================
# PARTE 2
# Arquitectura del Sistema
# ===================================================================

# FILOSOFÍA GENERAL

La conversación NO es un pedido.

Un pedido NO es una venta.

Una venta NO termina cuando el cliente paga.

Todo pertenece a un CASO.

Toda la arquitectura gira alrededor del concepto CASO.

Un caso representa todo el ciclo de atención de un cliente.

Un caso puede contener:

- dudas
- cotizaciones
- pedidos
- cambios
- cancelaciones
- postventa

Nunca asumir que toda conversación terminará en una venta.

Nunca asumir que una conversación solamente tendrá un pedido.

Nunca asumir que un cliente únicamente comprará una vez.

====================================================================

# FLUJO GENERAL DEL SISTEMA

Cliente

↓

WhatsApp

↓

Motor de Conversación

↓

Motor de Casos

↓

Motor de Pedidos

↓

Motor de Validaciones

↓

Eventos

↓

Telegram

↓

OpenAI

↓

Respuesta

====================================================================

# MOTOR DE PEDIDOS

Un pedido únicamente existe cuando el cliente demuestra intención real de comprar.

Ejemplos:

"Lo quiero."

"Me lo apartas."

"Lo necesito."

"¿Dónde pago?"

"¿Te transfiero?"

"Lo recogeré."

Antes de eso NO existe un pedido.

Existe únicamente una cotización.

====================================================================

# FLUJO COMPLETO DE PEDIDOS

Cliente escribe

↓

Motor de intención

↓

¿Quiere comprar?

NO

↓

Continuar cotizando

SI

↓

Crear Pedido

↓

Asignar ID

↓

Registrar Fecha

↓

Estado = NUEVO

↓

Solicitar datos faltantes

↓

Esperar información

↓

Validar

↓

Esperar pago

↓

Producción

↓

Listo

↓

Entrega

↓

Postventa

↓

Archivado

Nunca saltar estados.

====================================================================

# FLUJO DE COTIZACIONES

Cliente pregunta precio

↓

Crear Cotización

↓

Registrar fecha

↓

Guardar productos consultados

↓

Guardar presupuesto

↓

Esperar respuesta

↓

Si el cliente desaparece

↓

Archivar automáticamente

↓

Si vuelve meses después

↓

NO reutilizar la cotización anterior.

Crear una nueva.

====================================================================

# CUÁNDO CREAR UN PEDIDO

NO crear pedido cuando:

• Pregunta precios

• Pide catálogo

• Pide ubicación

• Pregunta horarios

• Solicita fotos

• Dice "gracias"

• Dice "lo pensaré"

SI crear pedido cuando:

• Aparta

• Confirma compra

• Da nombre

• Da fecha

• Da sucursal

• Pide cuenta bancaria

• Quiere pagar

====================================================================

# CUÁNDO ARCHIVAR UN PEDIDO

Archivar cuando:

Pedido entregado.

Pedido cancelado.

Cliente solicita cancelar.

Más de 30 días sin actividad.

Nunca eliminar pedidos.

Siempre archivarlos.

====================================================================

# MÁQUINA DE ESTADOS

Todos los pedidos deben recorrer una máquina de estados.

Nunca modificar estados manualmente.

Siempre utilizar funciones del sistema.

Estados oficiales:

NUEVO

↓

COTIZANDO

↓

PRECIO_CONFIRMADO

↓

ESPERANDO_DATOS

↓

ESPERANDO_PAGO

↓

APARTADO

↓

EN_PRODUCCION

↓

LISTO

↓

ENTREGADO

↓

ARCHIVADO

Estados alternativos:

CANCELADO

QUEJA

POSTVENTA

Nunca permitir:

NUEVO

↓

ENTREGADO

Eso significa que existe un error.

====================================================================

# TRANSICIONES VÁLIDAS

NUEVO

↓

COTIZANDO

↓

PRECIO_CONFIRMADO

↓

ESPERANDO_DATOS

↓

ESPERANDO_PAGO

↓

APARTADO

↓

EN_PRODUCCION

↓

LISTO

↓

ENTREGADO

↓

ARCHIVADO

Cada transición debe generar un evento.

====================================================================

# GESTIÓN DE CONVERSACIONES

Una conversación puede durar años.

Nunca borrar conversaciones.

Nunca reiniciar historial.

Cada conversación contiene múltiples casos.

Ejemplo

Conversación

↓

Cotización

↓

No compra

↓

Cotización

↓

Compra

↓

Postventa

↓

Compra San Valentín

↓

Compra Día de las Madres

Todo pertenece a la misma conversación.

====================================================================

# GESTIÓN DE CASOS

Todo comienza con un caso.

Tipos oficiales:

COTIZACION

PEDIDO

DUDA

QUEJA

POSTVENTA

INFORMACION

Cada caso tendrá:

ID

Cliente

Prioridad

Estado

Fecha

Última actividad

Pedidos relacionados

Cotizaciones relacionadas

Responsable

====================================================================

# DETECCIÓN DE NUEVO CASO

Si el cliente vuelve después de varios días.

El sistema analizará:

¿Sigue hablando del mismo tema?

SI

↓

Continuar caso.

NO

↓

Crear nuevo caso.

Nunca mezclar pedidos antiguos.

====================================================================

# DETECCIÓN DE CAMBIO DE TEMA

Ejemplo.

Cliente

Quiero un ramo.

↓

Cotiza.

↓

No compra.

↓

Tres semanas después.

"Ahora quiero una corona funeraria."

El sistema debe detectar automáticamente:

Caso nuevo.

No reutilizar:

nombre

precio

flores

sucursal

fecha

hora

forma de pago

====================================================================

# ORGANIZACIÓN DEL PROYECTO

src/

api/

config/

controllers/

database/

lib/

pedidos/

casos/

conversation/

telegram/

openai/

whatsapp/

parser/

validators/

events/

scheduler/

notifications/

services/

repositories/

middlewares/

utils/

types/

models/

prompts/

tests/

Nunca crear carpetas duplicadas.

====================================================================

# RESPONSABILIDAD DE CADA MÓDULO

controllers/

Recibir solicitudes.

Nunca lógica.

------------------------------------------------

services/

Toda la lógica.

------------------------------------------------

repositories/

Base de datos.

------------------------------------------------

validators/

Validaciones.

------------------------------------------------

parser/

Extraer información.

------------------------------------------------

events/

Emitir eventos.

------------------------------------------------

telegram/

Enviar notificaciones.

------------------------------------------------

openai/

Construir prompts.

Nunca lógica de negocio.

------------------------------------------------

conversation/

Historial.

------------------------------------------------

pedidos/

Todo sobre pedidos.

------------------------------------------------

casos/

Todo sobre casos.

------------------------------------------------

notifications/

WhatsApp.

Telegram.

Correo.

====================================================================

# DIVISIÓN DEL BOT.TS

Actualmente bot.ts contiene demasiadas responsabilidades.

Debe convertirse únicamente en un orquestador.

bot.ts solamente deberá:

Recibir mensaje.

↓

Guardar mensaje.

↓

Actualizar conversación.

↓

Solicitar análisis.

↓

Llamar servicios.

↓

Enviar respuesta.

Toda la lógica deberá salir de bot.ts.

====================================================================

# MÓDULOS QUE SALDRÁN DE BOT.TS

pedido.service.ts

Toda la lógica de pedidos.

------------------------------------------------

caso.service.ts

Gestión de casos.

------------------------------------------------

conversation.service.ts

Historial.

------------------------------------------------

telegram.service.ts

Telegram.

------------------------------------------------

openai.service.ts

OpenAI.

------------------------------------------------

prompt.service.ts

Construcción del prompt.

------------------------------------------------

parser.service.ts

Extraer:

Nombre

Fecha

Hora

Sucursal

Pago

Dirección

------------------------------------------------

validator.service.ts

Validaciones.

------------------------------------------------

scheduler.service.ts

Recordatorios.

------------------------------------------------

event.service.ts

Eventos internos.

------------------------------------------------

notification.service.ts

Notificaciones.

====================================================================

# ORQUESTACIÓN FINAL

bot.ts

↓

conversation.service

↓

caso.service

↓

pedido.service

↓

validator.service

↓

event.service

↓

telegram.service

↓

prompt.service

↓

openai.service

↓

notification.service

====================================================================

# REGLAS ABSOLUTAS

Nunca registrar pedidos desde OpenAI.

Nunca registrar pagos desde OpenAI.

Nunca cambiar estados desde OpenAI.

Nunca enviar Telegram desde OpenAI.

Nunca consultar Supabase desde OpenAI.

OpenAI únicamente escribe.

El backend decide.

====================================================================

# PREPARACIÓN PARA EL FUTURO

Toda la arquitectura deberá permitir agregar posteriormente:

CRM completo.

Dashboard.

Estadísticas.

Embudo de ventas.

Recordatorios automáticos.

Clientes frecuentes.

Seguimiento automático.

Encuestas.

Postventa.

Múltiples sucursales.

Inventario inteligente.

Campañas automáticas.

WhatsApp Business API avanzada.

Panel para empleados.

Sistema de repartidores.

Roles y permisos.

Sin volver a modificar la arquitectura principal.

Fin Parte 2.
# ===================================================================
# PARTE 3
# Motor Inteligente de Decisiones (Decision Engine)
# ===================================================================

# FILOSOFÍA

OpenAI NO es el cerebro del sistema.

OpenAI únicamente convierte información estructurada en lenguaje natural.

El verdadero cerebro del proyecto será el Decision Engine.

Toda decisión importante deberá ser tomada antes de llamar al modelo.

El modelo nunca deberá decidir:

• crear pedidos

• cancelar pedidos

• registrar pagos

• cambiar estados

• crear casos

• notificar Telegram

• validar horarios

• validar sucursales

• validar inventario

• confirmar disponibilidad

Todo eso pertenece al backend.

====================================================================

# ARQUITECTURA GENERAL

WhatsApp

↓

Conversation Engine

↓

Decision Engine

↓

Case Engine

↓

Order Engine

↓

Validation Engine

↓

Notification Engine

↓

Prompt Builder

↓

OpenAI

↓

Respuesta

====================================================================

# ¿QUÉ ES EL DECISION ENGINE?

Es el módulo más importante del sistema.

Su responsabilidad es entender exactamente qué está ocurriendo antes de generar una respuesta.

Nunca genera texto.

Nunca responde clientes.

Nunca llama Telegram directamente.

Nunca modifica el prompt.

Únicamente toma decisiones.

====================================================================

# RESPONSABILIDADES

El Decision Engine deberá responder internamente las siguientes preguntas.

¿Existe conversación?

¿Existe un caso activo?

¿Existe un pedido activo?

¿Existe una cotización?

¿El cliente cambió de tema?

¿Está respondiendo a una imagen?

¿Está respondiendo a un precio?

¿Está respondiendo a un pedido viejo?

¿Está iniciando un pedido nuevo?

¿Debe intervenir un humano?

¿Debe notificarse Telegram?

¿Debe archivarse un caso?

¿Debe actualizarse un pedido?

¿Debe esperarse más información?

====================================================================

# ORDEN OBLIGATORIO DE DECISIONES

Cada mensaje deberá recorrer exactamente este orden.

1.

Guardar mensaje.

↓

2.

Actualizar historial.

↓

3.

Actualizar última actividad.

↓

4.

Buscar conversación.

↓

5.

Buscar caso activo.

↓

6.

Buscar pedido activo.

↓

7.

Detectar intención.

↓

8.

Detectar cambio de tema.

↓

9.

Actualizar estado.

↓

10.

Validar reglas.

↓

11.

Emitir eventos.

↓

12.

Construir contexto.

↓

13.

Generar prompt.

↓

14.

Enviar a OpenAI.

↓

15.

Validar respuesta.

↓

16.

Enviar WhatsApp.

====================================================================

# MOTOR DE INTENCIONES

Todas las intenciones deberán clasificarse.

Ejemplos.

SALUDO

DESPEDIDA

CATALOGO

FOTOS

PRECIO

COTIZACION

PERSONALIZADO

PEDIDO

PAGO

COMPROBANTE

TRANSFERENCIA

UBICACION

HORARIOS

ENVIO

RECOGER

CAMBIO

CANCELACION

QUEJA

HUMANO

POSTVENTA

OTRO

Nunca utilizar únicamente texto libre.

Siempre utilizar enums.

====================================================================

# MOTOR DE CONTEXTO

Antes de responder deberá construir un contexto.

Ejemplo.

Cliente

↓

Caso

↓

Pedido

↓

Último producto

↓

Último precio

↓

Última imagen

↓

Último pago

↓

Sucursal

↓

Estado

↓

Información faltante

Ese contexto será el que viajará al Prompt Builder.

====================================================================

# MOTOR DE CAMBIO DE TEMA

Uno de los errores más importantes del sistema anterior fue reutilizar información antigua.

Ahora deberá existir un detector.

Ejemplo.

Cliente

"Gracias."

Dos semanas después.

"Ahora quiero una corona."

Resultado.

Nuevo caso.

Nuevo pedido.

Nueva cotización.

Nunca reutilizar:

precio

flores

nombre

sucursal

fecha

hora

método de pago

====================================================================

# DETECTOR DE PEDIDO NUEVO

Ejemplo.

Cliente

"Ahora necesito otro."

Resultado.

Nuevo pedido.

Aunque la conversación sea la misma.

====================================================================

# DETECTOR DE COTIZACIÓN

Si el cliente únicamente pregunta:

¿Cuánto cuesta?

¿En cuánto sale?

¿Qué precio tiene?

No crear pedido.

Crear únicamente cotización.

====================================================================

# DETECTOR DE PEDIDO REAL

Cuando detecte frases como:

Lo quiero.

Aparta.

Me interesa.

Lo necesito.

¿Cómo pago?

Pásame la cuenta.

Recogeré.

Enviar.

Transferencia.

Entonces crear pedido.

====================================================================

# DETECTOR DE HUMANO

El sistema deberá solicitar ayuda humana cuando ocurra alguno de estos eventos.

Queja.

Molestia.

Reembolso.

Cambio complicado.

Flores fuera de catálogo.

Problema con pagos.

Problema de entrega.

Cliente insiste.

Cliente enojado.

Cliente amenaza cancelar.

Cliente solicita gerente.

Nunca dejar al LLM resolver esos casos solo.

====================================================================

# DETECTOR DE URGENCIA

Prioridad Baja

Pregunta horarios.

Pregunta ubicación.

Pregunta catálogo.

------------------------------------------------

Prioridad Media

Cotización.

Fotos.

Personalizado.

------------------------------------------------

Prioridad Alta

Pago.

Transferencia.

Comprobante.

Entrega hoy.

Pedido listo.

Cliente esperando.

------------------------------------------------

Prioridad Crítica

Cliente en sucursal.

Cliente molesto.

Error del sistema.

Pedido perdido.

Entrega retrasada.

Caso Lizet.

Telegram deberá recibir prioridad crítica inmediatamente.

====================================================================

# MOTOR DE VALIDACIONES

Antes de responder.

Verificar.

¿Existe precio?

¿Existe fecha?

¿Existe hora?

¿Existe sucursal?

¿Existe dirección?

¿Existe nombre?

¿Existe método de pago?

¿Existe inventario?

Si falta algo.

Nunca inventarlo.

====================================================================

# PROMPT BUILDER

El prompt dejará de contener reglas.

El prompt únicamente recibirá información.

Ejemplo.

Cliente

Estado

Pedido

Caso

Sucursal

Fecha

Productos

Contexto

Reglas del sistema

El Prompt Builder deberá construir el prompt automáticamente.

Nunca escribir prompts enormes manualmente.

====================================================================

# RESPONSE VALIDATOR

Después de OpenAI.

Antes de WhatsApp.

Validar.

No inventó horarios.

No inventó sucursales.

No inventó precios.

No inventó pagos.

No inventó inventario.

No confirmó entregas.

No confirmó producción.

Si detecta algo.

Regenerar respuesta.

====================================================================

# MOTOR DE EVENTOS

Toda acción importante deberá producir un evento.

Ejemplos.

CASE_CREATED

CASE_ARCHIVED

ORDER_CREATED

ORDER_UPDATED

PAYMENT_PENDING

PAYMENT_RECEIVED

ORDER_READY

ORDER_DELIVERED

HUMAN_REQUIRED

CUSTOMER_ANGRY

PHOTO_REQUESTED

PRICE_CONFIRMED

Telegram dependerá únicamente de eventos.

Nunca del texto generado.

====================================================================

# REGLAS ABSOLUTAS

Nunca permitir que OpenAI modifique datos.

Nunca permitir que OpenAI escriba en Supabase.

Nunca permitir que OpenAI cambie estados.

Nunca permitir que OpenAI notifique Telegram.

Nunca permitir que OpenAI confirme horarios.

Nunca permitir que OpenAI confirme inventario.

El backend manda.

OpenAI comunica.

====================================================================

# OBJETIVO FINAL

Cuando el sistema termine esta refactorización.

Flora dejará de ser un chatbot.

Se convertirá en una empleada digital especializada en ventas florales.

Podrá trabajar durante años.

Podrá crecer.

Podrá aprender nuevas funciones.

Podrá integrarse con nuevos canales.

Sin volver a cambiar la arquitectura principal.

Fin Parte 3.
# ===================================================================
# PARTE 4.1
# Plan Maestro de Implementación
# Estrategia de Migración
# Reglas de Trabajo para IA
# ===================================================================

# OBJETIVO PRINCIPAL

La actualización de Flora NO consiste en agregar funciones nuevas.

Consiste en reemplazar progresivamente la arquitectura actual por una arquitectura basada en motores especializados sin interrumpir el funcionamiento del negocio.

Durante toda la migración el sistema deberá seguir funcionando en producción.

Nunca deberá existir una fase donde WhatsApp deje de responder.

Nunca deberá existir una fase donde Telegram deje de funcionar.

Nunca deberá existir una fase donde Supabase deje de registrar información.

La compatibilidad con producción tiene prioridad sobre cualquier mejora.

====================================================================

# REGLA MÁS IMPORTANTE DEL PROYECTO

Nunca realizar una refactorización masiva.

Toda modificación deberá ser incremental.

Cada Pull Request deberá ser pequeño.

Cada cambio deberá poder revertirse fácilmente.

Cada modificación deberá ser comprobable.

====================================================================

# FILOSOFÍA DE IMPLEMENTACIÓN

NO hacer esto

Cambiar 20 archivos.

↓

Compilar.

↓

Esperar que funcione.

SI hacer esto

Modificar un módulo.

↓

Probar.

↓

Registrar cambios.

↓

Hacer commit.

↓

Continuar.

====================================================================

# ESTRATEGIA DE MIGRACIÓN

La migración será evolutiva.

Nunca destructiva.

El sistema antiguo seguirá funcionando mientras los nuevos módulos son implementados.

La eliminación de código únicamente podrá hacerse cuando:

• exista una implementación nueva.

• haya sido probada.

• no existan dependencias.

====================================================================

# PRINCIPIOS DE MIGRACIÓN

Siempre agregar.

Nunca reemplazar inmediatamente.

Siempre marcar código antiguo.

Nunca eliminar sin verificar.

Siempre crear funciones adaptadoras.

Siempre mantener compatibilidad.

====================================================================

# FLUJO DE IMPLEMENTACIÓN

Analizar módulo.

↓

Entender dependencias.

↓

Diseñar solución.

↓

Implementar.

↓

Compilar.

↓

Probar.

↓

Registrar.

↓

Commit.

↓

Continuar.

Nunca alterar este flujo.

====================================================================

# FASE 1

ESTABILIZACIÓN

Objetivo:

Eliminar bugs críticos.

Problemas prioritarios:

✔ Parser de nombre.

✔ Parser de sucursal.

✔ Confirmaciones falsas.

✔ Pedidos perdidos.

✔ Telegram.

No crear funciones nuevas todavía.

====================================================================

# FASE 2

MODELO DE DATOS

Crear:

PedidoActual

Caso

Estados

Enums

Tipos

Interfaces

No modificar comportamiento.

Únicamente crear estructura.

====================================================================

# FASE 3

CONVERSATION ENGINE

Crear motor de conversación.

Debe encargarse de:

Historial.

Actividad.

Último mensaje.

Tiempo de inactividad.

Cambio de tema.

====================================================================

# FASE 4

CASE ENGINE

Crear casos.

Tipos.

Estados.

Prioridades.

Archivado.

No conectar todavía con Telegram.

====================================================================

# FASE 5

ORDER ENGINE

Crear:

Pedido.

Estados.

Validaciones.

Producción.

Entrega.

Pagos.

====================================================================

# FASE 6

DECISION ENGINE

Mover todas las decisiones desde bot.ts.

El Decision Engine será el cerebro.

OpenAI únicamente redactará respuestas.

====================================================================

# FASE 7

PROMPT BUILDER

Eliminar prompts gigantes.

Crear prompts dinámicos.

Contexto.

Caso.

Pedido.

Estado.

Información validada.

====================================================================

# FASE 8

EVENT ENGINE

Todo deberá generar eventos.

Ejemplos.

CASE_CREATED

ORDER_CREATED

PAYMENT_PENDING

ORDER_READY

DELIVERY_COMPLETED

====================================================================

# FASE 9

TELEGRAM ENGINE

Telegram dejará de depender del texto generado.

Dependerá únicamente de eventos.

====================================================================

# FASE 10

OPTIMIZACIÓN

Eliminar código obsoleto.

Reducir tamaño de bot.ts.

Optimizar consultas.

Optimizar OpenAI.

Optimizar Supabase.

Optimizar memoria.

====================================================================

# REGLAS PARA CUALQUIER IA

Antes de escribir código.

La IA deberá responder internamente.

¿Qué problema estoy resolviendo?

¿Qué archivos dependen?

¿Qué podría romper?

¿Cómo lo probaré?

¿Existe una solución más simple?

¿Estoy duplicando lógica?

¿Existe ya una función similar?

Si alguna respuesta es desconocida.

Primero investigar.

Después modificar.

====================================================================

# REGLAS PARA CREAR ARCHIVOS

Nunca crear archivos innecesarios.

Antes de crear uno nuevo verificar:

¿Ya existe un módulo parecido?

¿Puede reutilizarse?

¿La responsabilidad es diferente?

¿Realmente mejora la arquitectura?

====================================================================

# REGLAS PARA MODIFICAR ARCHIVOS

Toda modificación deberá cumplir:

Compila.

No rompe tests.

No rompe producción.

No rompe Telegram.

No rompe Supabase.

No rompe WhatsApp.

====================================================================

# REGLAS PARA BOT.TS

bot.ts dejará de crecer.

Cada nueva función deberá implementarse fuera.

bot.ts únicamente orquesta.

Nunca agregar lógica compleja dentro de bot.ts.

Si una función supera aproximadamente 80 líneas.

Debe moverse a otro módulo.

====================================================================

# POLÍTICA DE DEPENDENCIAS

Antes de instalar una librería nueva.

Preguntar:

¿Puede hacerse con Node nativo?

¿Ya existe una librería instalada?

¿Vale la pena agregar otra dependencia?

Menos dependencias significa:

Más estabilidad.

Más velocidad.

Más seguridad.

====================================================================

# POLÍTICA DE REFACTORIZACIÓN

Cuando una función sea difícil de entender.

No modificar directamente.

Primero documentarla.

Después dividirla.

Después probar.

Después eliminar la antigua.

Nunca mezclar refactorización con nuevas funciones.

====================================================================

# POLÍTICA DE RETROCOMPATIBILIDAD

Todo dato almacenado anteriormente deberá seguir funcionando.

Ejemplo.

Pedidos antiguos.

Conversaciones antiguas.

Mensajes antiguos.

Tokens antiguos.

No perder historial.

====================================================================

# POLÍTICA DE BASE DE DATOS

Nunca eliminar columnas.

Primero:

Crear nuevas.

Migrar datos.

Actualizar código.

Verificar.

Eliminar únicamente cuando no existan referencias.

====================================================================

# POLÍTICA DE TELEGRAM

Telegram nunca será una copia de WhatsApp.

Telegram será un panel operativo.

Debe recibir únicamente información útil.

No enviar conversaciones completas.

No enviar mensajes irrelevantes.

====================================================================

# POLÍTICA DEL LLM

El LLM nunca decidirá.

El backend siempre decidirá.

El Prompt Builder únicamente enviará información validada.

====================================================================

# POLÍTICA DE PARSER

Nunca usar expresiones regulares gigantes.

Cada dato deberá tener un parser especializado.

Ejemplo.

nombre.parser.ts

fecha.parser.ts

hora.parser.ts

direccion.parser.ts

sucursal.parser.ts

precio.parser.ts

telefono.parser.ts

Esto facilita pruebas.

Facilita mantenimiento.

Reduce errores.

====================================================================

# POLÍTICA DE VALIDACIONES

Cada dato importante deberá validarse.

Nombre.

Fecha.

Hora.

Sucursal.

Dirección.

Pago.

Precio.

Inventario.

No confiar únicamente en OpenAI.

====================================================================

# CRITERIOS PARA FINALIZAR UNA FASE

Una fase únicamente termina cuando:

Compila.

No rompe producción.

Las pruebas pasan.

La documentación fue actualizada.

Existe commit.

Existe changelog.

Existe rollback posible.

====================================================================

# ROLLBACK

Cada fase deberá poder revertirse.

Nunca depender de cambios irreversibles.

Siempre mantener un punto seguro.

====================================================================

# OBJETIVO FINAL DE ESTA IMPLEMENTACIÓN

Cuando todas las fases concluyan.

Flora deberá comportarse como una empleada digital experta.

No solamente responderá mensajes.

Administrará completamente el flujo comercial.

Podrá crecer durante muchos años.

Podrá integrarse con nuevas APIs.

Podrá cambiar de modelo LLM.

Podrá incorporar nuevas sucursales.

Podrá soportar múltiples empleados.

Sin necesidad de rediseñar nuevamente la arquitectura.

Fin Parte 4.1

# ===================================================================
# PARTE 4.2A
# PROTOCOLO DE DESARROLLO PARA IA
# Gobierno del Proyecto
# Gestión de Documentación
# Flujo de Trabajo
# ===================================================================

# FILOSOFÍA

Este proyecto no se desarrolla escribiendo código.

Se desarrolla tomando decisiones correctas.

El código es únicamente la consecuencia de una buena arquitectura.

Toda IA deberá comportarse como un Software Architect antes de actuar como programador.

Nunca escribir código primero.

Siempre entender el problema primero.

====================================================================

# OBJETIVO DEL PROTOCOLO

Este protocolo existe para que cualquier IA pueda continuar el proyecto meses o incluso años después sin perder el contexto.

El proyecto nunca deberá depender de la memoria de una conversación.

Toda decisión importante deberá quedar registrada dentro del repositorio.

El repositorio debe convertirse en la fuente oficial de conocimiento.

====================================================================

# MENTALIDAD OBLIGATORIA DE LA IA

La IA deberá pensar de la siguiente manera:

1.

Primero entender.

Después modificar.

Nunca al revés.

------------------------------------------------

2.

Si no conoce un módulo.

Debe leerlo.

Nunca asumir.

------------------------------------------------

3.

Antes de escribir código.

Debe entender cómo funciona actualmente.

------------------------------------------------

4.

Nunca eliminar una función sin comprobar quién la utiliza.

------------------------------------------------

5.

Nunca crear archivos duplicados.

------------------------------------------------

6.

Nunca romper compatibilidad.

------------------------------------------------

7.

Toda decisión deberá poder justificarse técnicamente.

====================================================================

# FLUJO OBLIGATORIO DE TRABAJO

Cada vez que una IA vaya a modificar el proyecto deberá seguir exactamente este proceso.

Analizar.

↓

Leer.

↓

Entender.

↓

Planear.

↓

Modificar.

↓

Compilar.

↓

Probar.

↓

Documentar.

↓

Registrar.

↓

Commit.

↓

Continuar.

Nunca modificar código sin haber entendido primero el módulo.

====================================================================

# REGLA DE LOS CINCO ANÁLISIS

Antes de escribir una sola línea de código la IA deberá responder internamente.

1.

¿Qué problema existe?

------------------------------------------------

2.

¿Por qué ocurre?

------------------------------------------------

3.

¿Qué archivos participan?

------------------------------------------------

4.

¿Cuál es la solución más simple?

------------------------------------------------

5.

¿Qué podría romperse?

Si alguna respuesta no está clara.

No modificar.

Primero investigar.

====================================================================

# REGLA DE RESPONSABILIDAD ÚNICA

Antes de agregar código.

Preguntar.

¿Esta función pertenece realmente a este archivo?

Si la respuesta es NO.

Moverla al módulo correcto.

====================================================================

# REGLA DEL MENOR CAMBIO POSIBLE

Siempre implementar la modificación más pequeña posible.

Nunca reescribir módulos completos si un cambio localizado resuelve el problema.

Las grandes refactorizaciones deberán dividirse en pequeños Pull Requests.

====================================================================

# DOCUMENTACIÓN OBLIGATORIA

La raíz del proyecto deberá contener los siguientes archivos.

AGENTS.md

Documento maestro.

Nunca eliminar.

------------------------------------------------

README.md

Cómo instalar.

Cómo ejecutar.

Variables.

Requisitos.

------------------------------------------------

CHANGELOG.md

Registro cronológico de cambios.

Nunca borrar historial.

------------------------------------------------

DECISIONS.md

Registro de decisiones técnicas importantes.

¿Por qué se tomó una decisión?

¿Qué alternativas existían?

¿Qué ventajas tiene?

¿Qué desventajas tiene?

Nunca modificar decisiones antiguas.

Agregar nuevas.

------------------------------------------------

KNOWN_BUGS.md

Lista oficial de errores conocidos.

Cada bug deberá incluir:

ID

Descripción

Fecha

Prioridad

Estado

Responsable

Versión donde apareció

Versión donde fue corregido

Nunca eliminar bugs.

Marcar como resueltos.

------------------------------------------------

TODO.md

Lista de trabajo.

Debe contener:

Pendientes.

En progreso.

Terminados.

Bloqueados.

Ideas futuras.

Prioridades.

Cada tarea deberá tener porcentaje.

------------------------------------------------

TEST_PLAN.md

Plan oficial de pruebas.

Cada módulo deberá indicar exactamente cómo validarse.

====================================================================

# CHANGELOG

Toda modificación deberá registrarse.

Formato.

Fecha

Versión

Autor

Archivos modificados

Descripción

Impacto

Rollback

Ejemplo.

## 2026-07-20

Versión

2.1.0

Archivos

pedido.service.ts

parser.service.ts

Cambios

Se corrigió parser del nombre.

Se agregó Decision Engine.

Impacto

Compatible.

Rollback

Sí.

====================================================================

# DECISIONS.md

Este archivo será el cerebro histórico del proyecto.

Ejemplo.

DEC-001

OpenAI deja de tomar decisiones.

Motivo.

Evitar respuestas inventadas.

Alternativas.

Dejar lógica en prompt.

Resultado.

Toda la lógica pasa al backend.

Estado.

Aceptada.

Nunca eliminar decisiones.

====================================================================

# TODO.md

La IA deberá actualizar automáticamente el porcentaje del proyecto.

Ejemplo.

Arquitectura

100%

Conversation Engine

80%

Decision Engine

60%

Telegram

40%

Prompt Builder

15%

Dashboard

0%

Nunca dejar porcentajes incorrectos.

====================================================================

# KNOWN_BUGS.md

Ejemplo.

BUG-001

Parser del nombre consume texto adicional.

Prioridad

Alta.

Estado

Resuelto.

Versión

2.0.3

------------------------------------------------

BUG-002

Sucursal por defecto incorrecta.

Prioridad

Alta.

Estado

Resuelto.

====================================================================

# TEST_PLAN.md

Cada módulo deberá incluir.

Objetivo.

Dependencias.

Casos de prueba.

Resultado esperado.

Resultado obtenido.

Nunca considerar terminado un módulo sin pruebas.

====================================================================

# CONVENCIÓN DE COMMITS

Todos los commits deberán seguir Conventional Commits.

Ejemplos.

feat:

Nueva funcionalidad.

------------------------------------------------

fix:

Corrección.

------------------------------------------------

refactor:

Refactorización.

------------------------------------------------

docs:

Documentación.

------------------------------------------------

test:

Pruebas.

------------------------------------------------

perf:

Optimización.

------------------------------------------------

chore:

Mantenimiento.

Nunca utilizar commits como.

"cambios"

"update"

"final"

"nuevo"

====================================================================

# CONVENCIÓN DE RAMAS

main

Producción.

Nunca trabajar directamente.

------------------------------------------------

develop

Integración.

------------------------------------------------

feature/

Nuevas funciones.

------------------------------------------------

fix/

Correcciones.

------------------------------------------------

hotfix/

Errores críticos.

====================================================================

# POLÍTICA DE PULL REQUEST

Todo Pull Request deberá incluir.

Objetivo.

Archivos modificados.

Problema resuelto.

Riesgos.

Pruebas realizadas.

Compatibilidad.

Rollback.

Nunca aceptar Pull Requests sin descripción.

====================================================================

# DOCUMENTACIÓN AUTOMÁTICA

Cada vez que una IA termine una tarea importante deberá actualizar automáticamente.

CHANGELOG.md

DECISIONS.md

TODO.md

KNOWN_BUGS.md

Nunca olvidar actualizar documentación.

La documentación forma parte del código.

====================================================================

# AUDITORÍA CONTINUA

Cada cierto número de cambios la IA deberá revisar.

Funciones duplicadas.

Código muerto.

Dependencias sin uso.

Imports innecesarios.

Archivos obsoletos.

Funciones gigantes.

Duplicación de lógica.

Complejidad excesiva.

Generar un reporte antes de eliminar cualquier elemento.

====================================================================

# REGLA DEL HISTORIAL

Nunca borrar información histórica.

Archivar.

Documentar.

Versionar.

Todo cambio importante deberá poder reconstruirse meses después.

====================================================================

# REGLA DE ORO

La IA nunca deberá pensar:

"¿Cómo hago que funcione?"

La IA deberá pensar:

"¿Cómo hago que siga funcionando dentro de tres años?"

Fin Parte 4.2A
# ===================================================================
# PARTE 4.2B
# AUTOCONTROL DEL PROYECTO
# Definition of Done
# Calidad de Software
# Auditoría Continua
# Roadmap Técnico
# ===================================================================

# FILOSOFÍA

El objetivo de Flora no es únicamente funcionar.

El objetivo es seguir funcionando correctamente dentro de cinco años.

Cada línea de código deberá escribirse pensando en:

• mantenimiento

• escalabilidad

• legibilidad

• estabilidad

• pruebas

• documentación

• crecimiento futuro

Nunca desarrollar pensando únicamente en resolver el problema actual.

====================================================================

# AUTOCONTROL DE LA IA

Antes de modificar cualquier archivo la IA deberá realizar internamente la siguiente auditoría.

¿Entendí completamente el problema?

¿Leí todos los archivos relacionados?

¿Existe una solución más simple?

¿Estoy duplicando código?

¿Existe ya una función parecida?

¿Estoy rompiendo una responsabilidad?

¿Estoy agregando deuda técnica?

¿El cambio será fácil de mantener?

¿Otro desarrollador entenderá este código dentro de un año?

¿Este cambio afecta producción?

Si alguna respuesta genera dudas.

Detener la implementación.

Investigar primero.

====================================================================

# CHECKLIST OBLIGATORIO PREVIO

Antes de modificar código.

La IA deberá revisar.

☐ Dependencias

☐ Interfaces

☐ Modelos

☐ Base de datos

☐ Telegram

☐ WhatsApp

☐ Prompt Builder

☐ Decision Engine

☐ Eventos

☐ Parser

☐ Validadores

☐ Conversation Engine

☐ Order Engine

☐ Case Engine

Ningún módulo deberá modificarse sin revisar primero sus dependencias.

====================================================================

# CHECKLIST DURANTE EL DESARROLLO

Mientras escribe código.

La IA deberá preguntarse constantemente.

¿Estoy escribiendo código repetido?

¿Puedo reutilizar un servicio?

¿Esta función es demasiado grande?

¿Este nombre describe correctamente su responsabilidad?

¿El archivo está creciendo demasiado?

¿Estoy mezclando lógica con infraestructura?

¿Estoy mezclando reglas de negocio con OpenAI?

====================================================================

# CHECKLIST POSTERIOR

Después de terminar.

La IA deberá validar.

Compila.

No existen errores TypeScript.

No existen imports muertos.

No existen variables sin utilizar.

No existen funciones duplicadas.

No existen console.log olvidados.

No existen TODO temporales.

No existen comentarios innecesarios.

====================================================================

# DEFINITION OF DONE

Una tarea NO puede considerarse terminada únicamente porque compile.

Una tarea estará terminada únicamente si cumple TODOS los puntos siguientes.

☐ Código implementado

☐ Compila correctamente

☐ Sin errores de TypeScript

☐ Sin warnings importantes

☐ Casos de prueba ejecutados

☐ Casos límite probados

☐ Compatible con producción

☐ CHANGELOG actualizado

☐ DECISIONS actualizado

☐ TODO actualizado

☐ KNOWN_BUGS actualizado

☐ Documentación revisada

☐ Código revisado

☐ No existe deuda técnica evidente

Si falta un punto.

La tarea NO está terminada.

====================================================================

# CRITERIOS DE CALIDAD

Todo módulo deberá cumplir.

Alta cohesión.

Bajo acoplamiento.

Responsabilidad única.

Código legible.

Nombres descriptivos.

Sin duplicación.

Sin lógica oculta.

Sin efectos secundarios inesperados.

====================================================================

# REGLAS DE NOMENCLATURA

Archivos.

conversation.service.ts

order.repository.ts

telegram.event.ts

prompt.builder.ts

Nunca utilizar nombres genéricos.

utils2.ts

helpers_new.ts

functions_final.ts

botNuevo.ts

botFinal.ts

bot2.ts

====================================================================

# AUDITORÍA SEMANAL

Cada cierto tiempo la IA deberá revisar automáticamente.

Archivos demasiado grandes.

Funciones mayores a 150 líneas.

Clases demasiado extensas.

Servicios duplicados.

Eventos sin utilizar.

Interfaces sin uso.

Dependencias obsoletas.

Consultas repetidas.

Prompts duplicados.

Modelos inconsistentes.

====================================================================

# MÉTRICAS DEL PROYECTO

La IA deberá medir constantemente.

Cantidad de archivos.

Cantidad de servicios.

Cantidad de eventos.

Cantidad de modelos.

Cobertura de pruebas.

Cantidad de bugs abiertos.

Cantidad de bugs corregidos.

Tiempo promedio de respuesta.

Tiempo promedio de OpenAI.

Tiempo promedio de Telegram.

Tiempo promedio de Supabase.

====================================================================

# MÉTRICAS DE CÓDIGO

Complejidad ciclomática.

Funciones demasiado grandes.

Archivos demasiado grandes.

Duplicación.

Acoplamiento.

Cobertura.

Tiempo de compilación.

Tiempo de respuesta.

====================================================================

# SISTEMA DE PRIORIDADES

P0

Producción caída.

Pedidos perdidos.

Pagos perdidos.

Telegram roto.

WhatsApp caído.

====================================================

P1

Pedidos incorrectos.

Parser incorrecto.

Errores de estado.

Datos inconsistentes.

====================================================

P2

Errores visuales.

Duplicación.

Optimización.

====================================================

P3

Refactorización.

Mejoras.

Limpieza.

====================================================================

# PROTOCOLO PARA BUGS

Cuando aparezca un bug.

1.

Reproducir.

↓

2.

Documentar.

↓

3.

Analizar causa raíz.

↓

4.

Diseñar solución.

↓

5.

Implementar.

↓

6.

Crear prueba.

↓

7.

Actualizar KNOWN_BUGS.

↓

8.

Actualizar CHANGELOG.

Nunca corregir bugs directamente sin conocer la causa.

====================================================================

# PROTOCOLO PARA NUEVAS FUNCIONES

Cada nueva función deberá responder.

¿Qué problema resuelve?

¿Por qué no existe ya?

¿Qué módulos afecta?

¿Qué eventos genera?

¿Qué pruebas necesita?

¿Cómo se documentará?

====================================================================

# PROTOCOLO DE SEGURIDAD

Nunca registrar.

Tokens.

Passwords.

API Keys.

Secretos.

Datos bancarios completos.

Información sensible.

Toda información sensible deberá almacenarse mediante variables de entorno.

====================================================================

# OBSERVABILIDAD

Toda acción importante deberá generar logs estructurados.

Ejemplos.

CASE_CREATED

ORDER_CREATED

ORDER_UPDATED

PAYMENT_PENDING

PAYMENT_CONFIRMED

PHOTO_RECEIVED

PHOTO_SENT

HUMAN_REQUIRED

CUSTOMER_WAITING

ORDER_READY

DELIVERY_COMPLETED

Nunca depender únicamente de console.log.

====================================================================

# ROADMAP TÉCNICO (FLORA 3.0)

FASE A

Arquitectura modular completa.

Decision Engine.

Conversation Engine.

Case Engine.

Order Engine.

------------------------------------------------

FASE B

Dashboard administrativo.

Seguimiento en tiempo real.

Métricas comerciales.

Estado de pedidos.

Panel de operadores.

------------------------------------------------

FASE C

CRM Inteligente.

Clientes frecuentes.

Historial completo.

Recordatorios automáticos.

Etiquetas.

Segmentación.

------------------------------------------------

FASE D

Inventario Inteligente.

Disponibilidad en tiempo real.

Alertas de stock.

Flores de temporada.

Costo automático.

------------------------------------------------

FASE E

IA Comercial.

Recomendaciones automáticas.

Ventas cruzadas.

Predicción de compras.

Clientes VIP.

Seguimiento postventa.

------------------------------------------------

FASE F

Multiempresa.

Varias florerías.

Varias sucursales.

Varios operadores.

Configuraciones independientes.

------------------------------------------------

FASE G

Canales adicionales.

Instagram.

Facebook Messenger.

Telegram.

Web Chat.

Aplicación móvil.

Todos compartiendo el mismo Conversation Engine.

====================================================================

# VISIÓN FINAL

Cuando este proyecto concluya.

Flora dejará de ser un bot de WhatsApp.

Será una plataforma conversacional completa especializada en florerías.

El canal (WhatsApp, Instagram, Web o Telegram) será únicamente una entrada.

Toda la inteligencia residirá en el núcleo del sistema.

El objetivo final es construir un software capaz de atender miles de conversaciones simultáneamente, conservar el contexto de cada cliente, asistir al equipo humano y reducir al mínimo los errores operativos, sin perder el trato cálido y cercano que caracteriza a Jardín RoCe.

====================================================================

# PRINCIPIO FUNDAMENTAL DEL PROYECTO

Cada decisión tomada deberá responder una sola pregunta.

"¿Este cambio hace que Flora sea más confiable para los clientes y más útil para el equipo de Jardín RoCe?"

Si la respuesta es NO.

Ese cambio no debe implementarse.

Fin Parte 4.2B