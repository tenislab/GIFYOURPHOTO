-- Galería @JRR — esquema Supabase
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists "pgcrypto";

-- PERFILES ------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  role text not null default 'runner' check (role in ('runner','owner')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'runner')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner');
$$;

-- GRUPOS / SÁBADOS / ARCHIVOS ----------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  city text not null default '',
  palette int not null default 0,
  poster_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  run_date date not null,
  name text not null default '',
  km numeric,
  price_photo numeric not null default 1,
  price_video numeric not null default 3,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists albums_group_date_idx on public.albums (group_id, run_date desc);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  kind text not null check (kind in ('photo','video')),
  -- original: bucket privado. preview: bucket público con marca de agua
  original_path text not null,
  preview_path text,
  file_name text,
  bytes bigint,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists media_album_idx on public.media (album_id, position);

-- PEDIDOS -------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  buyer_id uuid references public.profiles(id) on delete set null,
  buyer_name text not null default '',
  buyer_email text not null default '',
  method text not null check (method in ('revolut','transfer','cash')),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  total numeric not null default 0,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete restrict,
  unit_price numeric not null,
  unique (order_id, media_id)
);

-- Referencia legible tipo JRR-000123
create sequence if not exists public.order_ref_seq;
create or replace function public.set_order_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null or new.ref = '' then
    new.ref := 'JRR-' || lpad(nextval('public.order_ref_seq')::text, 6, '0');
  end if;
  return new;
end $$;
drop trigger if exists orders_set_ref on public.orders;
create trigger orders_set_ref before insert on public.orders
  for each row execute function public.set_order_ref();

-- ¿Este usuario ya pagó este archivo? (lo usa la Edge Function de descarga)
create or replace function public.has_paid_media(p_media uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.media_id = p_media and o.status = 'paid' and o.buyer_id = auth.uid()
  );
$$;

-- RLS -----------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.groups       enable row level security;
alter table public.albums       enable row level security;
alter table public.media        enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_owner());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = auth.uid());

-- Catálogo: lectura pública de lo publicado; escritura solo el fotógrafo
drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select using (true);
drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists albums_read on public.albums;
create policy albums_read on public.albums for select using (published or public.is_owner());
drop policy if exists albums_write on public.albums;
create policy albums_write on public.albums for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists media_read on public.media;
create policy media_read on public.media for select using (
  public.is_owner() or exists (select 1 from public.albums a where a.id = album_id and a.published)
);
drop policy if exists media_write on public.media;
create policy media_write on public.media for all using (public.is_owner()) with check (public.is_owner());

-- Pedidos: cada quien ve los suyos; el fotógrafo ve todos y cobra
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select using (buyer_id = auth.uid() or public.is_owner());
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert with check (buyer_id = auth.uid());
drop policy if exists orders_owner_update on public.orders;
create policy orders_owner_update on public.orders for update using (public.is_owner()) with check (public.is_owner());

drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select using (
  public.is_owner() or exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid())
);
drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid() and o.status = 'pending')
);

-- STORAGE -------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('previews', 'previews', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('originals', 'originals', false)
  on conflict (id) do nothing;

drop policy if exists previews_public_read on storage.objects;
create policy previews_public_read on storage.objects for select using (bucket_id = 'previews');

drop policy if exists previews_owner_write on storage.objects;
create policy previews_owner_write on storage.objects for all
  using (bucket_id = 'previews' and public.is_owner())
  with check (bucket_id = 'previews' and public.is_owner());

-- Los originales NO se leen por RLS: se sirven con signed URL desde una
-- Edge Function que comprueba has_paid_media(). Solo el fotógrafo escribe.
drop policy if exists originals_owner_all on storage.objects;
create policy originals_owner_all on storage.objects for all
  using (bucket_id = 'originals' and public.is_owner())
  with check (bucket_id = 'originals' and public.is_owner());
