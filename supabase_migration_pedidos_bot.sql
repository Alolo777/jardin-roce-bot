-- Persistencia operativa del bot: pedidos en curso, zonas ambiguas y pruebas de conversación

create table if not exists pedidos_bot (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null unique,
  telefono text,
  estado text not null default 'cotizacion' check (estado in ('cotizacion', 'apartado', 'pagado', 'entregado', 'cancelado')),
  cliente_nombre text,
  producto text,
  arreglo_id uuid,
  precio_arreglo numeric(10,2),
  zona_envio text,
  precio_envio numeric(10,2),
  direccion text,
  sucursal text,
  metodo_pago text,
  nota text,
  total numeric(10,2),
  ultimo_mensaje text,
  requiere_revision boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists pedidos_bot_estado_idx on pedidos_bot (estado);
create index if not exists pedidos_bot_actualizado_idx on pedidos_bot (actualizado_en desc);

create table if not exists zonas_envio_ambiguas (
  id uuid primary key default gen_random_uuid(),
  texto_cliente text not null,
  telefono text,
  candidatos jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'resuelto', 'ignorado')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists zonas_envio_ambiguas_estado_idx on zonas_envio_ambiguas (estado, creado_en desc);

create table if not exists pruebas_conversacion_bot (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  mensajes jsonb not null default '[]'::jsonb,
  esperado jsonb not null default '{}'::jsonb,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
