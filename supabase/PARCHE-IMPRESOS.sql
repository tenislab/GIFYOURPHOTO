-- ============================================================
--  @JRR · Encargos de producto impreso y permisos de imagen
--  Pegar entero en Supabase → SQL Editor → Run.
--  Se puede ejecutar dos veces sin romper nada.
-- ============================================================

-- 1) ENCARGOS DE PRODUCTO IMPRESO -----------------------------
--    Se piden por la web y se pagan en mano al entregar.

create table if not exists public.print_orders (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  buyer_id      uuid references auth.users(id) on delete set null,
  buyer_name    text,
  buyer_email   text,
  buyer_phone   text,
  group_id      uuid references public.groups(id) on delete set null,
  album_id      uuid references public.albums(id) on delete set null,
  media_id      uuid references public.media(id)  on delete set null,
  product       text not null,
  product_label text,
  qty           int  not null default 1,
  unit_price    numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  notes         text,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);

alter table public.print_orders
  drop constraint if exists print_orders_status_check;
alter table public.print_orders
  add constraint print_orders_status_check
  check (status in ('pending','confirmed','ready','delivered','cancelled'));

-- Referencia legible: IMP-000001, IMP-000002…
create sequence if not exists public.print_ref_seq;

create or replace function public.set_print_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null then
    new.ref := 'IMP-' || lpad(nextval('public.print_ref_seq')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_print_ref on public.print_orders;
create trigger trg_print_ref
  before insert on public.print_orders
  for each row execute function public.set_print_ref();

create index if not exists print_orders_buyer_idx on public.print_orders(buyer_id);
create index if not exists print_orders_status_idx on public.print_orders(status);

alter table public.print_orders enable row level security;

-- Cada uno ve y crea los suyos; el fotógrafo lo ve y gestiona todo.
drop policy if exists print_select on public.print_orders;
create policy print_select on public.print_orders for select
  using (
    buyer_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

drop policy if exists print_insert on public.print_orders;
create policy print_insert on public.print_orders for insert
  with check (buyer_id = auth.uid());

drop policy if exists print_update on public.print_orders;
create policy print_update on public.print_orders for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

drop policy if exists print_delete on public.print_orders;
create policy print_delete on public.print_orders for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));


-- 2) AVISOS: admitir el tipo 'print' ---------------------------
--    Sin esto el aviso del encargo se rechaza y no te llega nada.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('claim','sale','unlocked','print'));


-- 3) PERMISOS DE IMAGEN DE MENORES ----------------------------
--    Se añaden columnas a la tabla 'consents' que ya existe.
--    Un consentimiento con player_name relleno es el de un menor.

alter table public.consents add column if not exists player_name   text;
alter table public.consents add column if not exists guardian_name text;
alter table public.consents add column if not exists guardian_id   text;
alter table public.consents add column if not exists relation      text;
alter table public.consents add column if not exists allow_gallery boolean not null default true;
alter table public.consents add column if not exists allow_social  boolean not null default false;
alter table public.consents add column if not exists signature     text;

create index if not exists consents_player_idx on public.consents(player_name);

-- El fotógrafo tiene que poder leer los permisos firmados.
drop policy if exists consents_select_owner on public.consents;
create policy consents_select_owner on public.consents for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );
