# DESIGN.md — Especificación funcional y visual inspirada en Chatwoot

> Documento de referencia para recrear la **experiencia de uso**, arquitectura visual y conjunto de funcionalidades de una plataforma de atención omnicanal tipo Chatwoot, adaptándola a una aplicación propia.
>
> **Importante:** este documento describe patrones de interfaz, componentes, flujos y capacidades funcionales. No pretende copiar la marca Chatwoot, su logotipo, textos de marketing, ilustraciones, iconografía propietaria ni activos gráficos. La implementación debe utilizar identidad visual, nombres, textos y recursos propios.

---

## 1. Referencia

**Producto de referencia:** Chatwoot  
**Repositorio:** https://github.com/chatwoot/chatwoot  
**Licencia publicada en el repositorio:** MIT  
**Referencia de versión observada:** la rama `develop` muestra actualmente el paquete `@chatwoot/chatwoot` en versión `4.18.0`.

Chatwoot se presenta como una plataforma de soporte al cliente open source y self-hosted que centraliza conversaciones provenientes de distintos canales en una bandeja compartida. Entre sus capacidades documentadas están conversaciones, contactos, equipos, etiquetas, respuestas guardadas, automatizaciones, segmentación, campañas, centro de ayuda, reportes, integraciones y funciones de IA.

Este documento convierte esas capacidades en una **especificación reutilizable para diseñar e implementar una aplicación propia**.

---

# 2. Objetivo del sistema

Construir una plataforma web de atención al cliente con una experiencia centrada en la conversación.

El sistema debe permitir:

1. Recibir conversaciones desde diferentes canales.
2. Mostrar todas las conversaciones en una bandeja unificada.
3. Permitir que agentes respondan y colaboren en tiempo real.
4. Asociar cada conversación con un contacto.
5. Asignar conversaciones a agentes y equipos.
6. Organizar conversaciones mediante etiquetas, prioridad y estados.
7. Buscar y filtrar conversaciones rápidamente.
8. Guardar filtros como vistas personalizadas.
9. Registrar notas privadas y menciones internas.
10. Automatizar tareas mediante reglas y condiciones.
11. Administrar horarios, SLA y capacidad de agentes.
12. Consultar métricas y reportes.
13. Administrar canales, equipos, agentes e integraciones.
14. Incorporar IA como asistente o agente automatizado cuando corresponda.
15. Mantener una experiencia rápida, limpia y orientada a productividad.

---

# 3. Principios de diseño

## 3.1 Conversation-first

La conversación es el objeto principal del sistema.

El usuario no debe tener que navegar por muchas pantallas para resolver una solicitud.

La acción principal debe ser siempre evidente:

**ver conversación → comprender contexto → responder → asignar/etiquetar → resolver.**

## 3.2 Alta densidad de información sin saturación

La interfaz debe mostrar suficiente información operativa sin convertirse en un panel visualmente caótico.

Usar:

- Tipografía pequeña pero legible.
- Separadores sutiles.
- Espaciado consistente.
- Iconos simples.
- Estados mediante badges.
- Paneles secundarios colapsables.
- Menús contextuales.
- Tooltips para iconos ambiguos.

## 3.3 Tres zonas principales

La pantalla de conversación debe dividirse conceptualmente en:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ HEADER / BUSCADOR / ACCIONES                                               │
├─────────────┬───────────────────────────────┬───────────────────────────────┤
│ NAVEGACIÓN  │ LISTA DE CONVERSACIONES       │ CONVERSACIÓN + CONTACTO       │
│             │                               │                               │
│ Sidebar     │ Filtros / búsqueda            │ Mensajes                      │
│ principal   │                               │ Composer                      │
│             │ Conversación seleccionada     │ Datos del contacto            │
│             │                               │ Acciones                      │
└─────────────┴───────────────────────────────┴───────────────────────────────┘
```

En una implementación responsive estas columnas pueden transformarse en vistas secuenciales.

## 3.4 Acciones rápidas

Las operaciones comunes deben necesitar pocos clics.

Ejemplos:

- Resolver.
- Reabrir.
- Posponer.
- Asignar.
- Cambiar equipo.
- Priorizar.
- Etiquetar.
- Silenciar.
- Buscar.
- Abrir contacto.
- Enviar respuesta.

## 3.5 Consistencia

Todos los módulos deben utilizar el mismo sistema de:

- botones,
- inputs,
- menús,
- tablas,
- modales,
- badges,
- avatares,
- estados,
- mensajes de error,
- estados vacíos,
- loaders,
- tooltips.

---

# 4. Sistema visual

## 4.1 Estética general

Crear una interfaz tipo SaaS profesional:

- Fondo general muy claro o ligeramente gris.
- Paneles blancos.
- Bordes suaves.
- Radio de esquinas moderado.
- Sombras muy discretas.
- Un color principal para acciones.
- Colores semánticos para estados.
- Jerarquía tipográfica clara.
- Mucho uso de iconografía lineal.

Evitar:

- Gradientes decorativos excesivos.
- Sombras fuertes.
- Elementos gigantes.
- Animaciones innecesarias.
- Tarjetas sobrecargadas.

## 4.2 Tokens sugeridos

Los siguientes valores son una **base de implementación**, no una copia de los valores exactos del producto de referencia.

```css
:root {
  --color-primary: #4f46e5;
  --color-primary-hover: #4338ca;

  --color-bg: #f7f8fa;
  --color-surface: #ffffff;
  --color-surface-muted: #f1f3f5;

  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;

  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;

  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-danger: #dc2626;
  --color-info: #2563eb;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --shadow-sm: 0 1px 3px rgba(0,0,0,.06);
  --shadow-md: 0 8px 24px rgba(0,0,0,.10);

  --sidebar-width: 64px;
  --secondary-sidebar-width: 260px;
  --conversation-list-width: 360px;
  --contact-panel-width: 320px;
}
```

## 4.3 Tipografía

Usar una fuente sans-serif moderna y legible.

Escala aproximada:

```text
12 px  → metadatos
13 px  → textos secundarios
14 px  → cuerpo principal
15 px  → mensajes
16 px  → controles importantes
18 px  → encabezados secundarios
20–24 px → títulos de página
```

## 4.4 Iconografía

Los iconos deben ser consistentes y reconocibles.

Categorías mínimas:

- Inbox
- Search
- Contacts
- Reports
- Settings
- Teams
- Notifications
- Filter
- Plus
- More
- Send
- Attachment
- Emoji
- Mic
- Phone
- User
- Tag
- Clock
- Check
- Archive
- Trash
- Star/Priority
- Bot/AI
- Chevron

---

# 5. Arquitectura de navegación

El producto debe tener una navegación primaria persistente.

## Sidebar principal

Elementos sugeridos:

```text
LOGO

💬 Conversaciones
👤 Contactos
📊 Reportes
🤖 IA / Automatizaciones
📚 Centro de ayuda
⚙ Configuración

-----------------

🔔 Notificaciones
👤 Perfil
```

Los elementos pueden utilizar iconos cuando el sidebar esté contraído y texto + iconos cuando esté expandido.

## Navegación secundaria

Al entrar a Conversaciones:

```text
Conversaciones

Mis conversaciones
Sin asignar
Todas
Pospuestas
Menciones
Sin atender

Bandejas
  • Web
  • WhatsApp
  • Email
  • Instagram
  • Telegram

Etiquetas
  • importante
  • ventas
  • soporte
  • urgente

Equipos
  • Soporte
  • Ventas
  • Facturación

Vistas personalizadas
  • VIP
  • Pendientes
  • SLA crítico
```

Las vistas deben calcularse dinámicamente y no representar snapshots estáticos.

---

# 6. Layout principal de conversaciones

Esta es la pantalla más importante del producto.

## Estructura

```text
┌────┬────────────────┬──────────────────────────────────────┬───────────────┐
│    │                │                                      │               │
│ NAV│ CONVERSATIONS  │        ACTIVE CONVERSATION            │ CONTACT       │
│    │                │                                      │               │
│    │ Search         │ Header                               │ Profile       │
│    │ Filters        │                                      │ Details       │
│    │                │ Messages                             │ Attributes    │
│    │ Conversation A │                                      │ Labels        │
│    │ Conversation B │                                      │ Notes         │
│    │ Conversation C │                                      │ History       │
│    │                │ Composer                             │               │
└────┴────────────────┴──────────────────────────────────────┴───────────────┘
```

## Barra superior

Debe incluir:

- Nombre del inbox/vista actual.
- Cantidad de conversaciones.
- Buscador.
- Filtros.
- Acciones de vista.
- Comando global/búsqueda rápida.
- Notificaciones.
- Perfil.

---

# 7. Lista de conversaciones

Cada fila debe mostrar suficiente contexto para seleccionar una conversación sin abrirla.

## Elementos

```text
[AVATAR]  Nombre del contacto
          Último mensaje...
          etiqueta · canal · tiempo
                         [estado/contador]
```

Opcionalmente:

- Prioridad.
- Equipo.
- Agente.
- Indicador de mensaje nuevo.
- Número de mensajes pendientes.
- Icono del canal.
- SLA.

## Comportamiento

Al hacer clic:

1. Marcar conversación como seleccionada.
2. Cargar mensajes.
3. Cargar datos del contacto.
4. Cargar acciones disponibles.
5. Mantener URL/ruta reproducible.

## Estados visuales

Una conversación debe diferenciarse por estado:

```text
OPEN      → abierta
PENDING   → pospuesta/pendiente
RESOLVED  → resuelta
SNOOZED   → pospuesta hasta fecha/hora
```

No utilizar únicamente color para comunicar el estado; acompañar con texto o iconografía cuando sea necesario.

---

# 8. Búsqueda y filtros

La búsqueda debe estar disponible desde la bandeja.

## Búsqueda

Permitir buscar por:

- Nombre.
- Email.
- Teléfono.
- Texto de conversación.
- ID de conversación.
- Etiqueta.
- Agente.
- Equipo.

## Filtros

El sistema debe soportar filtros combinables.

Ejemplo:

```text
Estado = abierta
AND
Equipo = Soporte
AND
Etiqueta = urgente
```

También:

```text
Estado = abierta
OR
Etiqueta = vip
```

Los filtros documentados para una implementación tipo Chatwoot pueden incluir estado, agente, inbox, equipo, ID de conversación, etiquetas, campañas, fechas, idioma del navegador, país, URL de referencia y atributos personalizados.

## Constructor de filtros

UI:

```text
FILTRAR CONVERSACIONES

[Campo ▼] [Operador ▼] [Valor ▼]

+ Agregar condición

Grupo:
( AND ▼ )

[Cancelar] [Aplicar]
```

## Vistas guardadas

Una vista guardada debe contener:

```json
{
  "name": "Tickets urgentes",
  "entity": "conversation",
  "conditions": [
    {"field": "priority", "operator": "eq", "value": "urgent"},
    {"field": "status", "operator": "eq", "value": "open"}
  ],
  "logic": "AND"
}
```

Al abrirla debe recalcular los resultados actuales.

---

# 9. Pantalla de conversación

## Header de conversación

Debe incluir:

- Avatar.
- Nombre del contacto.
- Canal.
- Estado.
- Agente asignado.
- Equipo.
- Prioridad.
- Menú de acciones.

Ejemplo:

```text
[Avatar] María López           [WhatsApp]
         Cliente desde 2026    [Asignado: Ana]

[Resolver] [Posponer] [Prioridad] [⋮]
```

## Acciones

Mínimas:

- Resolver.
- Reabrir.
- Posponer.
- Asignar agente.
- Asignar equipo.
- Cambiar prioridad.
- Agregar/quitar etiquetas.
- Silenciar.
- Ver información.
- Copiar ID.
- Enviar transcript.

## Timeline

Los mensajes deben mostrarse cronológicamente.

Diferenciar visualmente:

### Mensaje de cliente

```text
               Cliente
               Hola, tengo una duda.
               14:32
```

### Mensaje de agente

```text
Agente
Hola María, claro.
14:33
```

### Nota privada

La nota privada debe usar un tratamiento visual claramente distinto del mensaje público.

```text
┌─────────────────────────────────────┐
│ NOTA PRIVADA                        │
│ Revisar la factura antes de cerrar. │
│ @Carlos                             │
└─────────────────────────────────────┘
```

Nunca debe enviarse una nota privada al cliente.

### Eventos del sistema

Mostrar eventos como:

```text
Ana asignó la conversación a Soporte
La conversación fue marcada como prioritaria
La conversación fue resuelta
```

---

# 10. Composer / editor de respuesta

El editor debe ser uno de los elementos más importantes de la pantalla.

## Estructura

```text
┌─────────────────────────────────────────────────────────┐
│ Responder ▼                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Escribe tu respuesta...                                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ B I U  🔗  😊  📎  🎤     /atajos     [ENVIAR]         │
└─────────────────────────────────────────────────────────┘
```

Debe soportar:

- Texto enriquecido.
- Emojis.
- Adjuntos.
- Imágenes.
- Archivos.
- Respuestas guardadas.
- Menciones.
- Notas privadas.
- Macros.
- Cancelación de envío.
- Estados de envío.

## Selector Responder / Nota privada

```text
[Responder ▼]

Responder al cliente
Nota privada
```

Cambiar a Nota privada debe cambiar visualmente el composer para evitar errores humanos.

---

# 11. Respuestas guardadas / Canned Responses

Crear una biblioteca de respuestas reutilizables.

## Modelo

```text
Título
Atajo
Contenido
Equipo opcional
Variables
Estado activo
```

Ejemplo:

```text
Título: Horario de atención
Atajo: /horario
Contenido:
"Nuestro horario es {{business_hours}}."
```

## UX

Al escribir `/` mostrar sugerencias:

```text
/horario
/reserva
/pago
/envio
```

Seleccionar una respuesta debe insertarla en el editor, pero permitir editarla antes de enviarla.

---

# 12. Contactos

La sección Contactos funciona como un directorio/CRM ligero de usuarios que han interactuado con la plataforma.

## Pantalla de contactos

```text
CONTACTOS

[Buscar contactos................] [Filtros] [+ Nuevo contacto] [Importar]

┌──────────┬─────────────────┬────────────────┬─────────────┬──────────────┐
│ Avatar   │ Nombre          │ Email          │ Teléfono    │ Última act.  │
├──────────┼─────────────────┼────────────────┼─────────────┼──────────────┤
│    ●     │ Juan Pérez      │ juan@...       │ 55...       │ Hace 2 min   │
│    ●     │ María López     │ maria@...      │ 55...       │ Hace 15 min  │
└──────────┴─────────────────┴────────────────┴─────────────┴──────────────┘
```

## Ficha del contacto

Mostrar:

- Nombre.
- Avatar.
- Email.
- Teléfono.
- Empresa.
- Ubicación.
- Canal de origen.
- Navegador.
- Sistema operativo.
- Idioma.
- Etiquetas.
- Atributos personalizados.
- Notas.
- Historial de conversaciones.

## Acciones

- Editar.
- Agregar nota.
- Agregar etiqueta.
- Iniciar conversación.
- Ver historial.
- Fusionar duplicados.
- Eliminar cuando los permisos lo permitan.

---

# 13. Segmentos de contactos

Los segmentos son filtros guardados aplicados a contactos.

Ejemplo:

```text
Clientes frecuentes

País = México
AND
Última actividad >= 30 días
AND
TipoCliente = frecuente
```

Un segmento siempre debe reflejar los datos actuales.

---

# 14. Notas y colaboración

Los agentes deben poder colaborar sin enviar información interna al cliente.

## Funciones

- Notas privadas.
- @menciones.
- Asignación.
- Equipos.
- Etiquetas.
- Historial de cambios.
- Indicadores de presencia.
- Detección de colisión.

## Collision detection

Si dos agentes están visualizando o escribiendo sobre la misma conversación, informar de forma visible.

Ejemplo:

```text
⚠ Carlos también está respondiendo esta conversación.
```

El objetivo es evitar dos respuestas simultáneas o contradictorias.

---

# 15. Asignación de conversaciones

Una conversación puede estar asignada a:

- Ningún agente.
- Un agente.
- Un equipo.

La interfaz debe permitir:

```text
ASIGNAR

Agente
[Buscar agente................]

Equipo
[Soporte ▼]

[Guardar]
```

## Auto-assignment

Soportar reglas para asignar automáticamente una conversación según:

- Equipo.
- Inbox.
- Disponibilidad.
- Capacidad del agente.
- Reglas de negocio.

---

# 16. Equipos

Cada equipo debe tener:

```text
Nombre
Descripción
Agentes
Inbox permitidos
Reglas de asignación
Métricas
```

Pantalla sugerida:

```text
EQUIPOS

[+ Crear equipo]

Soporte       5 agentes    24 abiertas
Ventas        3 agentes     8 abiertas
Facturación   2 agentes     3 abiertas
```

Un agente puede pertenecer a más de un equipo.

---

# 17. Bandejas / Inboxes

Una bandeja representa un canal o flujo de atención.

Ejemplos:

```text
Web Chat
WhatsApp
Email
Instagram
Telegram
SMS
API
```

Cada inbox puede tener configuración propia:

- Nombre.
- Canal.
- Agentes.
- Equipos.
- Horarios.
- SLA.
- Auto-assignment.
- Automatizaciones.
- Identidad visual.
- Mensaje de bienvenida.
- Mensaje fuera de horario.

---

# 18. Canales omnicanal

Diseñar el sistema para que el concepto de canal sea abstracto.

```text
Channel
 ├── Web Chat
 ├── Email
 ├── WhatsApp
 ├── Instagram
 ├── Facebook
 ├── Telegram
 ├── SMS
 ├── Voice
 └── API / Custom
```

Cada canal debe transformarse internamente a un formato común de conversación.

Modelo conceptual:

```json
{
  "conversationId": "conv_123",
  "channel": "whatsapp",
  "contactId": "contact_456",
  "status": "open",
  "priority": "normal",
  "assignedAgentId": "agent_8",
  "teamId": "team_2",
  "messages": []
}
```

---

# 19. Estado de conversación

Usar una máquina de estados explícita.

```text
                    ┌───────────────┐
                    │     OPEN      │
                    └───────┬───────┘
                            │
                 ┌──────────┼──────────┐
                 │          │          │
                 ▼          ▼          ▼
             RESOLVED    SNOOZED     PENDING
                 │          │          │
                 └──────────┴──────────┘
                            │
                            ▼
                         OPEN
```

Reglas:

- Resolver: cierra el ciclo actual.
- Reabrir: devuelve a abierta.
- Posponer: agenda reactivación.
- Pendiente: mantiene la conversación fuera del flujo activo según configuración.

---

# 20. Prioridad

Cada conversación puede tener:

```text
Normal
Alta
Urgente
```

La prioridad debe ser visible:

- En la lista.
- En el encabezado.
- En filtros.
- En automatizaciones.
- En reportes.

---

# 21. Etiquetas

Las etiquetas permiten categorizar conversaciones y contactos.

Ejemplos:

```text
vip
urgente
venta
soporte
reembolso
problema-tecnico
```

Operaciones:

- Crear.
- Editar.
- Eliminar.
- Asignar.
- Quitar.
- Filtrar.

---

# 22. Automatizaciones

Construir un motor de reglas basado en:

```text
TRIGGER
    ↓
CONDITIONS
    ↓
ACTIONS
```

## Triggers

Como mínimo:

- Conversación creada.
- Conversación actualizada.
- Mensaje creado.
- Conversación abierta/reabierta.
- SLA próximo a incumplirse.
- Contacto actualizado.

## Conditions

Ejemplos:

```text
Estado
Prioridad
Agente asignado
Equipo
Inbox
Etiquetas
País
Idioma
Email
Teléfono
Atributos personalizados
Campaña
URL de referencia
Fecha de creación
Última actividad
```

## Operators

```text
equals
not_equals
contains
not_contains
starts_with
exists
not_exists
greater_than
less_than
```

## Actions

Como mínimo:

- Asignar agente.
- Asignar equipo.
- Agregar etiqueta.
- Eliminar etiqueta.
- Cambiar estado.
- Cambiar prioridad.
- Enviar mensaje.
- Enviar nota interna.
- Posponer.
- Ejecutar webhook.
- Ejecutar integración.

## Ejemplo

```yaml
name: Escalar conversación VIP
trigger: conversation_created
conditions:
  - field: contact.tag
    operator: contains
    value: vip
  - field: priority
    operator: equals
    value: urgent
actions:
  - assign_team: customer-success
  - add_label: escalated
  - notify: supervisor
```

---

# 23. Macros

Una macro agrupa varias acciones en un botón.

Ejemplo:

```text
Macro: Escalar reembolso

1. Agregar etiqueta "reembolso"
2. Asignar equipo "Facturación"
3. Cambiar prioridad a "alta"
4. Agregar nota privada
```

Las macros deben poder ejecutarse:

- Desde la conversación.
- Desde el composer.
- Desde el command bar.

Las macros pueden requerir datos adicionales antes de ejecutarse.

---

# 24. Command Bar

Crear una barra de comandos global similar al patrón de navegación por teclado.

Atajo sugerido:

```text
Ctrl + K
```

En macOS:

```text
⌘ + K
```

UI:

```text
┌────────────────────────────────────────────────────────────┐
│ 🔎 Buscar una página o acción...                            │
├────────────────────────────────────────────────────────────┤
│ Conversaciones                                             │
│ Contactos                                                  │
│ Reportes                                                   │
│ Configuración                                              │
│ Resolver conversación                                      │
│ Asignar a agente                                           │
│ Ejecutar macro                                             │
└────────────────────────────────────────────────────────────┘
```

El contenido debe cambiar según el contexto actual.

En una conversación mostrar acciones relacionadas con esa conversación.

---

# 25. Atajos de teclado

Implementar al menos:

```text
Ctrl/Cmd + K → command bar
Ctrl/Cmd + / → ver atajos
Ctrl/Cmd + B → ocultar/mostrar sidebar
Ctrl/Cmd + Enter → enviar mensaje
J → siguiente conversación
K → conversación anterior
E → resolver
O → reabrir
M → posponer
/ → búsqueda rápida
```

Los atajos deben poder desactivarse o visualizarse desde configuración.

---

# 26. Notificaciones

Centro de notificaciones:

```text
NOTIFICACIONES

● Carlos te mencionó en una conversación
  Hace 2 min

● Nueva conversación asignada
  Hace 5 min

● SLA próximo a vencer
  Hace 10 min
```

Tipos:

- Mención.
- Asignación.
- Mensaje nuevo.
- SLA.
- Automatización.
- Error de integración.

---

# 27. Centro de ayuda / Help Center

Crear módulo separado para contenido público de soporte.

## Estructura

```text
HELP CENTER

[ Buscar en el centro de ayuda..................... ]

Categorías

▸ Primeros pasos
▸ Cuenta
▸ Pagos
▸ Integraciones
▸ Preguntas frecuentes

Artículos populares
```

## Artículo

Debe contener:

- Título.
- Descripción.
- Categoría.
- Contenido enriquecido.
- Tabla de contenido opcional.
- Fecha de actualización.
- Artículos relacionados.

## Administración

Estados:

```text
Borrador
Publicado
Archivado
```

---

# 28. IA / agente inteligente

La IA debe tratarse como un actor del sistema, no como una simple caja de chat.

```text
Cliente
   ↓
Conversación
   ↓
Orquestador IA
   ├── Recuperación de conocimiento
   ├── Clasificación
   ├── Generación de respuesta
   ├── Herramientas
   └── Reglas de seguridad
          ↓
      Respuesta
```

Capacidades posibles:

- Respuestas automáticas.
- Resumen de conversación.
- Clasificación.
- Detección de intención.
- Traducción.
- Sugerencia de respuesta.
- Extracción de datos.
- Consulta de base de conocimiento.
- Escalamiento a humano.

## Regla importante

La IA debe poder cambiar de estado:

```text
AI_HANDLING
     ↓
NEEDS_HUMAN
     ↓
ASSIGNED_TO_AGENT
```

No marcar automáticamente una conversación como resuelta solamente porque la IA respondió.

---

# 29. Traducción

El diseño debe permitir conversaciones multilingües.

Funciones posibles:

```text
Idioma detectado: Español

[Ver traducción]
[Traducir respuesta]
```

La traducción no debe alterar el mensaje original.

Modelo:

```json
{
  "messageId": "m1",
  "originalLanguage": "es",
  "originalText": "Hola, necesito ayuda",
  "translation": {
    "language": "en",
    "text": "Hello, I need help"
  }
}
```

---

# 30. SLA y horario laboral

## Business Hours

Cada inbox/equipo puede tener horarios.

Ejemplo:

```text
Lunes    09:00–18:00
Martes   09:00–18:00
Miércoles 09:00–18:00
Jueves   09:00–18:00
Viernes  09:00–18:00
Sábado   cerrado
Domingo  cerrado
```

## SLA

Registrar:

- Primera respuesta.
- Tiempo de respuesta.
- Tiempo de resolución.
- Vencimiento.

Indicadores:

```text
Normal
Próximo a vencer
Incumplido
```

---

# 31. Capacidad de agentes

Cada agente puede tener una capacidad máxima de conversaciones activas.

Ejemplo:

```text
Ana
Capacidad: 10
Actuales: 7
Disponibles: 3
```

El auto-assignment debe respetar este límite cuando la regla esté activa.

---

# 32. Reportes

Crear módulo de Analytics con filtros por fecha.

## Dashboard

KPIs sugeridos:

```text
Conversaciones       1,248
Resueltas               932
Tiempo primera resp.  3m 28s
Tiempo resolución     18m 44s
CSAT                  94%
```

## Gráficas

- Volumen de conversaciones.
- Nuevas conversaciones.
- Conversaciones resueltas.
- Tiempo de primera respuesta.
- Tiempo de resolución.
- Rendimiento por agente.
- Rendimiento por equipo.
- Rendimiento por inbox.
- Rendimiento por etiqueta.
- CSAT.

## Filtros

```text
Fecha desde
Fecha hasta
Inbox
Equipo
Agente
Canal
Etiqueta
Horario laboral sí/no
```

## Agrupación

```text
Día
Semana
Mes
```

## Exportación

Permitir exportar datos en CSV/JSON según necesidad.

---

# 33. Live View

Crear una vista operacional en tiempo real.

```text
LIVE VIEW

Agentes activos: 14
Conversaciones abiertas: 82
En espera: 17
SLA crítico: 5

[LISTA ACTUALIZADA EN TIEMPO REAL]
```

Actualizar mediante WebSocket/SSE u otra estrategia realtime.

---

# 34. CSAT

Después de resolver una conversación, permitir solicitar valoración.

Ejemplo:

```text
¿Cómo fue tu experiencia?

☆ ☆ ☆ ☆ ☆

[Enviar]

Comentario opcional
```

Registrar:

```text
conversation_id
contact_id
rating
comment
created_at
```

---

# 35. Acciones masivas

Desde la lista de conversaciones:

```text
☐ Conversación A
☐ Conversación B
☐ Conversación C
```

Al seleccionar varias:

```text
3 seleccionadas

[Asignar agente]
[Asignar equipo]
[Agregar etiqueta]
[Quitar etiqueta]
[Resolver]
[Posponer]
```

Las acciones masivas deben validar permisos y registrar errores individuales sin perder el resto del lote.

---

# 36. Perfil de agente

Campos:

```text
Nombre
Avatar
Email
Rol
Equipos
Inbox autorizados
Estado online/offline
Capacidad
Zona horaria
Idioma
```

Estados:

```text
Online
Away
Offline
```

---

# 37. Roles y permisos

Implementar RBAC.

Roles base sugeridos:

```text
Admin
Supervisor
Agent
Viewer
```

Permisos granulares:

```text
conversation.read
conversation.write
conversation.assign
conversation.resolve
conversation.delete
contact.read
contact.write
team.manage
inbox.manage
automation.manage
reports.read
settings.manage
```

Nunca depender solamente de ocultar botones en frontend. Los permisos deben validarse en backend.

---

# 38. Configuración

## Organización

```text
Información general
Zona horaria
Idioma
Identidad visual
Dominios
```

## Agentes

```text
Lista
Invitar
Roles
Permisos
Capacidad
```

## Equipos

```text
Crear
Editar
Agentes
Reglas
```

## Inboxes

```text
Canales
Agentes
Horarios
SLA
Auto-assignment
Automatizaciones
```

## Etiquetas

```text
Crear
Editar
Eliminar
```

## Respuestas guardadas

CRUD completo.

## Automatizaciones

CRUD + activación/desactivación + historial.

## Integraciones

Configuración de credenciales y webhooks.

---

# 39. Integraciones

Diseñar una capa de adapters.

```text
IntegrationManager
       │
 ┌─────┼─────┬──────┬──────┐
 ↓     ↓     ↓      ↓      ↓
WhatsApp Email Telegram Slack Custom
```

Cada integración debe implementar un contrato similar a:

```ts
interface ChannelAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(message: OutgoingMessage): Promise<SendResult>;
  receiveMessage(payload: unknown): Promise<IncomingMessage>;
  verifyWebhook?(payload: unknown): boolean;
}
```

Esto evita acoplar toda la aplicación a un proveedor.

---

# 40. Webhooks

Eventos sugeridos:

```text
conversation.created
conversation.updated
conversation.resolved
conversation.reopened
message.created
message.sent
contact.created
contact.updated
contact.deleted
assignment.changed
label.added
label.removed
```

El sistema debe permitir seleccionar qué eventos se envían a cada endpoint.

Registrar:

- Timestamp.
- Endpoint.
- Payload.
- Código HTTP.
- Intentos.
- Resultado.

---

# 41. Realtime

Toda la interfaz de conversación debe diseñarse pensando en cambios en tiempo real.

Eventos:

```text
message.created
message.updated
conversation.updated
conversation.assigned
conversation.status_changed
agent.presence_changed
typing.started
typing.stopped
notification.created
```

Ejemplo:

```text
Cliente → WebSocket → Backend → Todos los agentes autorizados
```

Debe evitarse hacer polling agresivo cuando exista una alternativa realtime.

---

# 42. Modelo de datos conceptual

```text
Organization
 ├── Users
 │    ├── Roles
 │    └── Teams
 │
 ├── Inboxes
 │    └── Channels
 │
 ├── Contacts
 │    ├── ContactLabels
 │    ├── ContactNotes
 │    └── CustomAttributes
 │
 ├── Conversations
 │    ├── Messages
 │    ├── ConversationLabels
 │    ├── Assignments
 │    ├── Events
 │    └── SLA
 │
 ├── Teams
 ├── Automations
 ├── Macros
 ├── CannedResponses
 ├── Reports
 └── Integrations
```

Relaciones fundamentales:

```text
Organization 1 ── N User
Organization 1 ── N Team
Organization 1 ── N Inbox
Organization 1 ── N Contact
Organization 1 ── N Conversation

Contact 1 ── N Conversation
Conversation 1 ── N Message
Conversation N ── N Label
Team N ── N User
Inbox N ── N User
Conversation N ── 1 Agent
Conversation N ── 1 Team
```

---

# 43. Entidad Conversation

Modelo mínimo recomendado:

```ts
interface Conversation {
  id: string;
  organizationId: string;
  inboxId: string;
  contactId: string;
  status: 'open' | 'pending' | 'snoozed' | 'resolved';
  priority: 'normal' | 'high' | 'urgent';
  assignedAgentId?: string;
  teamId?: string;
  subject?: string;
  channel: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}
```

---

# 44. Entidad Message

```ts
interface Message {
  id: string;
  conversationId: string;
  senderType: 'contact' | 'agent' | 'bot' | 'system';
  senderId?: string;
  type: 'text' | 'image' | 'file' | 'audio' | 'system' | 'note';
  body?: string;
  private: boolean;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
  metadata?: Record<string, unknown>;
}
```

---

# 45. Contact model

```ts
interface Contact {
  id: string;
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  company?: string;
  city?: string;
  country?: string;
  browserLanguage?: string;
  browser?: string;
  operatingSystem?: string;
  source?: string;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

---

# 46. Arquitectura frontend recomendada

La referencia actual utiliza Vue 3 y Vite en su frontend; este documento no obliga a usar esas tecnologías.

La implementación propia puede utilizar:

```text
React / Vue / Svelte
        ↓
State Manager
        ↓
API Client
        ↓
WebSocket Client
        ↓
Backend API
```

Separar componentes por dominio:

```text
components/
  conversation/
  contact/
  inbox/
  team/
  automation/
  report/
  settings/
  common/
```

Evitar crear un componente gigante de conversación.

---

# 47. Arquitectura backend recomendada

```text
Client
  ↓
API Gateway / Reverse Proxy
  ↓
REST API
  ├── Auth
  ├── Conversations
  ├── Messages
  ├── Contacts
  ├── Teams
  ├── Inboxes
  ├── Automations
  ├── Reports
  └── Integrations
        ↓
Database
        ↓
Queue / Workers
        ↓
External Channels
```

Para trabajos asíncronos utilizar cola:

```text
Message Received
      ↓
Queue
      ↓
Worker
      ├── Persist
      ├── Automation
      ├── AI
      ├── Notification
      └── Webhook
```

---

# 48. API REST mínima

## Conversations

```http
GET    /api/conversations
GET    /api/conversations/:id
POST   /api/conversations
PATCH  /api/conversations/:id
POST   /api/conversations/:id/resolve
POST   /api/conversations/:id/reopen
POST   /api/conversations/:id/snooze
POST   /api/conversations/:id/assign
POST   /api/conversations/:id/labels
```

## Messages

```http
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/messages
PATCH  /api/messages/:id
```

## Contacts

```http
GET    /api/contacts
GET    /api/contacts/:id
POST   /api/contacts
PATCH  /api/contacts/:id
DELETE /api/contacts/:id
```

## Teams

```http
GET    /api/teams
POST   /api/teams
PATCH  /api/teams/:id
DELETE /api/teams/:id
```

## Automations

```http
GET    /api/automations
POST   /api/automations
PATCH  /api/automations/:id
DELETE /api/automations/:id
POST   /api/automations/:id/test
```

---

# 49. Rendimiento

Objetivos del producto:

```text
First meaningful UI         < 2 s
Abrir conversación          < 500 ms objetivo
Enviar mensaje             respuesta visual inmediata
Actualización realtime      < 1 s objetivo
Búsqueda común              < 500 ms objetivo
Cambio de vista             < 300 ms objetivo
```

La interfaz debe utilizar:

- Lazy loading.
- Paginación/infinite scroll.
- Virtualización de listas largas.
- Caching.
- Debounce para búsqueda.
- Optimistic UI para acciones rápidas.
- WebSocket/SSE para realtime.

---

# 50. Estados de UI obligatorios

Cada pantalla debe tener al menos:

## Loading

```text
Skeleton / spinner contextual
```

## Empty

```text
No hay conversaciones
No hay contactos
No hay resultados
```

## Error

```text
No pudimos cargar los datos.
[Reintentar]
```

## Permission denied

```text
No tienes permisos para realizar esta acción.
```

## Offline / connection lost

```text
⚠ Conexión perdida
Intentando reconectar...
```

## Success

Usar toast breve:

```text
✓ Conversación asignada
```

---

# 51. Responsive

## Desktop

Utilizar las tres columnas.

```text
Sidebar | Conversation list | Conversation | Contact panel
```

## Tablet

Ocultar el panel de contacto o mostrarlo mediante drawer.

## Mobile

Navegación secuencial:

```text
Inbox
  ↓
Conversation list
  ↓
Conversation
  ↓
Contact drawer
```

El composer debe permanecer accesible sobre el teclado móvil.

---

# 52. Accesibilidad

Implementar:

- Navegación por teclado.
- Focus visible.
- Labels para inputs.
- ARIA en botones icon-only.
- Contraste suficiente.
- No depender exclusivamente del color.
- Tamaño táctil apropiado.
- Lectores de pantalla para cambios críticos.

---

# 53. Seguridad

## Backend

Validar siempre:

- Autenticación.
- Autorización.
- Tenant/Organization.
- Propiedad de conversación.
- Acceso a contacto.
- Acceso a inbox.
- Permisos de equipo.

## Mensajes

Sanitizar HTML y contenido enriquecido.

## Adjuntos

Validar:

- MIME type.
- Tamaño.
- Extensión.
- Malware scanning cuando corresponda.

## Webhooks

Validar firmas y secretos.

## Datos sensibles

No mostrar información innecesaria en logs.

---

# 54. Auditoría

Registrar eventos administrativos y operativos:

```text
agent.created
agent.updated
team.created
conversation.assigned
conversation.resolved
conversation.reopened
message.sent
automation.executed
integration.updated
settings.changed
```

Modelo:

```ts
interface AuditLog {
  id: string;
  organizationId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

---

# 55. Diseño de la pantalla de inicio

Dashboard inicial:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Hola, Ana                                      🔔  👤            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Conversaciones    Pendientes    SLA crítico    CSAT             │
│      128             32            4           94%              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Volumen de conversaciones                                        │
│     ╭──────╮                                                     │
│  ╭──╯      ╰──────╮                                              │
│ ╭╯                ╰──                                            │
│                                                                 │
├─────────────────────────────┬───────────────────────────────────┤
│ Mis pendientes              │ Actividad del equipo             │
│ • Cliente A                 │ Ana resolvió 12                   │
│ • Cliente B                 │ Carlos tomó 7                     │
│ • Cliente C                 │ ...                               │
└─────────────────────────────┴───────────────────────────────────┘
```

---

# 56. Microinteracciones

Usar animaciones rápidas y discretas.

Ejemplos:

- Botón cambia de estado al resolver.
- Toast después de acción.
- Nueva conversación aparece con transición corta.
- Mensaje enviado entra inmediatamente al timeline.
- Sidebar se despliega suavemente.
- Modal aparece con fade/scale muy leve.

Duraciones sugeridas:

```text
100–150 ms → microinteracción
150–250 ms → panel
200–300 ms → modal
```

Evitar animaciones superiores a ~300 ms salvo procesos especiales.

---

# 57. Reglas de UX para evitar errores

1. Las acciones destructivas requieren confirmación.
2. Resolver debe ser reversible mediante Reabrir.
3. Nota privada debe verse diferente a una respuesta pública.
4. Si existe un adjunto pendiente, advertir antes de abandonar un mensaje en edición.
5. Al cambiar de conversación con texto no enviado, preguntar o guardar borrador.
6. Las asignaciones deben mostrar el nombre real del agente/equipo.
7. Los filtros activos deben ser visibles.
8. Las acciones masivas deben indicar claramente el número seleccionado.
9. El sistema debe informar cuando una conversación cambió por otro agente.
10. Nunca destruir silenciosamente cambios del usuario.

---

# 58. Prioridad de implementación

## Fase 1 — Core

```text
Auth
Organizations
Agents
Inboxes
Contacts
Conversations
Messages
Assignments
Status
Realtime
```

## Fase 2 — Productividad

```text
Labels
Filters
Saved views
Private notes
Mentions
Canned responses
Keyboard shortcuts
Command bar
Bulk actions
```

## Fase 3 — Operación

```text
Teams
Auto assignment
Business hours
SLA
Macros
Automations
Notifications
```

## Fase 4 — Analytics

```text
Dashboard
Live view
Conversation reports
Agent reports
Team reports
Inbox reports
Label reports
CSAT
Exports
```

## Fase 5 — Canales e integraciones

```text
Web chat
Email
WhatsApp
Instagram
Telegram
SMS
API
Webhooks
Slack
Custom integrations
```

## Fase 6 — IA

```text
AI assistant
RAG / knowledge base
Auto replies
Summaries
Classification
Translation
Human handoff
AI analytics
```

---

# 59. Checklist funcional

Antes de considerar el producto listo:

## Inbox

- [ ] Ver conversaciones.
- [ ] Buscar.
- [ ] Filtrar.
- [ ] Guardar vistas.
- [ ] Abrir conversación.
- [ ] Asignar agente.
- [ ] Asignar equipo.
- [ ] Cambiar prioridad.
- [ ] Etiquetar.
- [ ] Resolver.
- [ ] Reabrir.
- [ ] Posponer.
- [ ] Silenciar.
- [ ] Acciones masivas.

## Conversation

- [ ] Timeline.
- [ ] Mensajes públicos.
- [ ] Notas privadas.
- [ ] Menciones.
- [ ] Adjuntos.
- [ ] Respuestas guardadas.
- [ ] Macros.
- [ ] Estados.
- [ ] Presencia.
- [ ] Collision detection.
- [ ] Realtime.

## Contacts

- [ ] Listado.
- [ ] Búsqueda.
- [ ] Filtros.
- [ ] Segmentos.
- [ ] Crear.
- [ ] Editar.
- [ ] Importar.
- [ ] Historial.
- [ ] Notas.
- [ ] Custom attributes.

## Teams

- [ ] Crear.
- [ ] Editar.
- [ ] Eliminar.
- [ ] Agregar agentes.
- [ ] Métricas.

## Automation

- [ ] Trigger.
- [ ] Conditions.
- [ ] AND/OR.
- [ ] Actions.
- [ ] Activar/desactivar.
- [ ] Historial de ejecución.

## Reports

- [ ] KPIs.
- [ ] Gráficas.
- [ ] Filtros.
- [ ] Agrupación.
- [ ] Exportación.

## Settings

- [ ] Organización.
- [ ] Usuarios.
- [ ] Roles.
- [ ] Equipos.
- [ ] Inboxes.
- [ ] Canales.
- [ ] Horarios.
- [ ] SLA.
- [ ] Etiquetas.
- [ ] Integraciones.
- [ ] Webhooks.

---

# 60. Criterios de aceptación de UX

La implementación puede considerarse coherente con este diseño cuando un agente pueda completar este flujo sin abandonar la pantalla de conversaciones:

```text
1. Recibir conversación.
2. Abrir conversación.
3. Ver quién es el cliente.
4. Ver historial.
5. Identificar el canal.
6. Ver etiquetas.
7. Ver agente/equipo.
8. Leer mensajes.
9. Responder.
10. Agregar nota privada.
11. Asignar responsable.
12. Cambiar prioridad.
13. Resolver.
14. Reabrir si llega una respuesta nueva.
```

El sistema debe sentirse como una herramienta de trabajo continua, no como un conjunto de CRUD independientes.

---

# 61. Reglas para un agente de desarrollo IA

Cuando un agente de programación utilice este documento, debe:

1. Leer el repositorio actual antes de modificar código.
2. Localizar primero la implementación existente del módulo.
3. No duplicar componentes ni servicios si ya existe una abstracción equivalente.
4. Mantener las convenciones actuales del proyecto.
5. Cambiar solamente lo necesario para cumplir el diseño.
6. No romper APIs existentes sin documentar la migración.
7. Reutilizar componentes visuales compartidos.
8. Implementar backend y frontend de forma coordinada.
9. Agregar validaciones en backend además de las del frontend.
10. Crear pruebas para cada flujo crítico.
11. Probar estados de loading, empty, error y success.
12. Probar permisos con usuarios de diferentes roles.
13. Probar realtime con varios clientes simultáneos.
14. Probar conversaciones con muchos mensajes.
15. Validar responsive.
16. Validar accesibilidad básica.
17. No utilizar datos falsos en producción.
18. No marcar procesos como exitosos si no existe confirmación real del backend o proveedor externo.
19. Registrar errores y eventos importantes.
20. Al finalizar cada cambio, documentar archivos modificados, dependencias, pruebas y posibles pendientes.

---

# 62. Instrucción maestra para implementar el diseño

> **Implementa la experiencia descrita en `DESIGN.md` como un producto propio inspirado en patrones de una plataforma de soporte omnicanal. Antes de escribir código, inspecciona el repositorio completo y genera un mapa entre las funcionalidades descritas y los módulos existentes. No reemplaces la arquitectura actual sin justificarlo. Reutiliza componentes y servicios existentes. Implementa primero el núcleo de conversaciones, después productividad, operación, analytics, integraciones e IA. Cada funcionalidad debe tener UI, API/backend, persistencia, permisos, manejo de errores y pruebas cuando aplique. Mantén la interfaz consistente con el sistema visual definido aquí. No copies branding, logotipos, textos de marketing ni assets de Chatwoot; crea una identidad propia.**

---

# 63. Fuentes y referencia funcional

Estas fuentes fueron consultadas para construir esta especificación:

- Repositorio oficial: https://github.com/chatwoot/chatwoot
- README del repositorio: https://github.com/chatwoot/chatwoot/blob/develop/README.md
- Funciones oficiales: https://www.chatwoot.com/features
- Shared Inbox: https://www.chatwoot.com/features/shared-inbox
- Teams: https://www.chatwoot.com/features/teams
- Automations: https://www.chatwoot.com/features/automations
- Keyboard Shortcuts: https://www.chatwoot.com/features/keyboard-shortcuts
- Command Bar: https://www.chatwoot.com/features/command-bar/
- Ayuda / filtros de conversación: https://www.chatwoot.com/hc/user-guide/articles/1784259039-como-usar-los-filtros-de-conversacion
- Ayuda / conceptos básicos del dashboard: https://www.chatwoot.com/hc/user-guide/articles/1784258182-leccion-2-conceptos-basicos-del-panel-de-control
- Ayuda / contactos: https://www.chatwoot.com/hc/user-guide/articles/1677498364-understanding-contacts

---

# 64. Nota de alcance

Este documento **no es una copia del código fuente de Chatwoot** y no intenta reconstruir internamente cada implementación de su repositorio. Es una especificación de diseño y comportamiento suficientemente detallada para que otro desarrollador o agente de programación pueda construir una solución propia con una experiencia funcional comparable.

La referencia actual de Chatwoot continúa evolucionando; por ello, antes de implementar nuevas integraciones o funcionalidades concretas debe verificarse la documentación y el repositorio oficiales.
