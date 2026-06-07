-- Migración: Tabla numeros_ignorados
-- Ejecutar en el SQL Editor de Supabase

create table if not exists numeros_ignorados (
  id uuid default gen_random_uuid() primary key,
  numero text not null unique,
  descripcion text,
  creado_en timestamptz default now()
);

alter table numeros_ignorados enable row level security;

create policy "Todos pueden leer numeros_ignorados"
  on numeros_ignorados for select using (true);

create policy "Solo service_role puede insertar"
  on numeros_ignorados for insert with check (true);

create policy "Solo service_role puede eliminar"
  on numeros_ignorados for delete using (true);
