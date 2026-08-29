# Conectar la galería a Supabase

Ahora mismo la web funciona en **modo local**: cuentas, sábados y pedidos se guardan en el navegador. Estos son los pasos para pasarla a real.

## 1. Crear el proyecto
1. supabase.com → New project (región Europa, p. ej. Frankfurt).
2. Project Settings → API: copia **Project URL** y **anon key**.
3. Pega los dos valores en `supabase-config.js`. Nada más: la web detecta que hay credenciales y deja de usar el navegador.

## 2. Crear las tablas
SQL Editor → pega `supabase/schema.sql` → Run. Crea:

- `profiles` — nombre y rol (`runner` / `owner`). Se rellena solo al registrarse.
- `groups` → `albums` → `media` — grupos, sábados y archivos.
- `orders` + `order_items` — pedidos con referencia `JRR-000123`, método (revolut / transfer / cash) y estado (pending / paid).
- Buckets `previews` (público, con marca de agua) y `originals` (privado).
- RLS: el catálogo publicado lo ve cualquiera, cada corredor solo ve sus pedidos, y solo tu cuenta `owner` sube archivos y marca cobros.

## 3. Ponerte como fotógrafo
Regístrate en la web y luego, en SQL Editor:

```sql
update public.profiles set role = 'owner' where id = (
  select id from auth.users where email = 'tu@email.com'
);
```

## 4. Marca de agua y descargas (las dos Edge Functions)
La marca de agua actual es CSS: se salta con el clic derecho. Con Supabase:

- **`watermark`** — se dispara al subir a `originals`, genera la versión con `@JRR` en diagonal y la guarda en `previews`. Solo esa se muestra en la web.
- **`download`** — recibe un `order_id`, comprueba con `has_paid_media()` que está pagado y devuelve *signed URLs* de 5 minutos del original. El bucket privado nunca se expone.

## 5. Pagos
Revolut, transferencia y efectivo son manuales por diseño: el pedido nace `pending`, tú confirmas y la descarga se abre. Sin comisiones y sin integración.

Si más adelante quieres cobro automático: Stripe Checkout + webhook que ponga `status = 'paid'`. El resto del flujo ya no cambia.

## 6. Pendiente legal
Consentimiento de imagen de los corredores, aviso de privacidad y facturación como autónomo.
