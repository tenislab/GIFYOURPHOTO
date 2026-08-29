-- ============================================================
-- PARCHE · PERMISOS DE BORRADO + LIMPIEZA DE PRUEBAS
-- Pegar en Supabase → SQL Editor → Run.
-- ============================================================

-- El fotógrafo puede borrar avisos y pedidos (antes no podía)
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete
  using (public.is_owner());

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete
  using (public.is_owner());

drop policy if exists order_items_delete on public.order_items;
create policy order_items_delete on public.order_items for delete
  using (public.is_owner());

-- Limpieza de las filas de diagnóstico
delete from public.notifications where ref in ('JRR-PRUEBA','JRR-TEST','JRR-TEST2','T');
delete from public.orders where buyer_email in ('t@t.com','x@x.com','g@g.com');

-- Comprobación
select 'avisos' as tabla, count(*) as filas from public.notifications
union all
select 'pedidos', count(*) from public.orders;
