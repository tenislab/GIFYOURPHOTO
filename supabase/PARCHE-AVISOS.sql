-- ============================================================
-- PARCHE · AVISOS Y PEDIDOS
-- Pegar en Supabase → SQL Editor → Run. Se puede repetir.
-- Arregla: los avisos no viajaban entre el corredor y el fotógrafo,
-- y los pedidos se rechazaban al guardarse.
-- ============================================================

-- 1. Tabla de avisos ------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('claim','sale','unlocked')),
  to_owner boolean not null default false,
  to_email text,
  order_id uuid references public.orders(id) on delete cascade,
  ref text,
  total numeric,
  method text,
  from_label text,
  until timestamptz,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_owner_idx on public.notifications (to_owner, handled, created_at desc);
create index if not exists notifications_email_idx on public.notifications (to_email, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select using (
  (to_owner and public.is_owner())
  or (to_email is not null and to_email = coalesce(auth.jwt() ->> 'email', ''))
);

-- Cualquiera puede avisar de que ha pagado (también quien compra sin cuenta)
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert with check (true);

-- Solo el fotógrafo marca un aviso como atendido
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (public.is_owner()) with check (public.is_owner());

-- 2. Pedidos: permitir compra sin cuenta pagando con tarjeta --------
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert with check (
  buyer_id = auth.uid()
  or (buyer_id is null and method = 'card')
);

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items for insert with check (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.status in ('pending','paid')
      and (o.buyer_id = auth.uid() or o.buyer_id is null)
  )
);

-- 3. Comprobación ---------------------------------------------------
select 'notifications' as tabla, count(*) as filas from public.notifications
union all
select 'orders', count(*) from public.orders;
