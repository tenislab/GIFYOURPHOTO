-- ============================================================
-- PARCHE · PAGO CON TARJETA
-- Pegar en Supabase → SQL Editor → Run.
-- La tabla de pedidos no aceptaba el método 'card'.
-- ============================================================

alter table public.orders drop constraint if exists orders_method_check;
alter table public.orders add constraint orders_method_check
  check (method in ('card','revolut','transfer','cash'));

-- Comprobación: debe listar los cuatro métodos
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.orders'::regclass and conname = 'orders_method_check';
