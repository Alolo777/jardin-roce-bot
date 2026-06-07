-- Migración: Tabla municipios_envio
-- Ejecutar en el SQL Editor de Supabase

create table if not exists municipios_envio (
  id uuid default gen_random_uuid() primary key,
  municipio text not null,
  codigo_postal text not null,
  colonia text,
  zona text not null,
  precio_envio numeric(10,2) not null,
  creado_en timestamptz default now()
);

-- Índices para búsqueda rápida
create index if not exists idx_municipios_envio_municipio on municipios_envio (municipio);
create index if not exists idx_municipios_envio_codigo_postal on municipios_envio (codigo_postal);
create index if not exists idx_municipios_envio_colonia on municipios_envio (colonia);

-- Permitir búsqueda ILIKE (trigram)
create extension if not exists pg_trgm;
create index if not exists idx_municipios_envio_municipio_trgm on municipios_envio using gin (municipio gin_trgm_ops);
create index if not exists idx_municipios_envio_colonia_trgm on municipios_envio using gin (colonia gin_trgm_ops);

-- RLS: solo service_role (admin) puede modificar, todos pueden leer
alter table municipios_envio enable row level security;

create policy "Todos pueden leer municipios"
  on municipios_envio for select using (true);

create policy "Solo service_role puede insertar"
  on municipios_envio for insert with check (true);

create policy "Solo service_role puede actualizar"
  on municipios_envio for update using (true);

create policy "Solo service_role puede eliminar"
  on municipios_envio for delete using (true);
