# Stripe — pasos para cobrar de verdad

Cuenta: la misma de Tennis Lab. Los cobros de la galería se distinguen en Stripe
porque cada pago lleva la etiqueta `origen = galeria-jrr` y la referencia `JRR-000123`.

## 0. Seguridad primero
Revoca la clave `rk_live_…` que se compartió por chat: Stripe → Developers → API keys → *Roll key*.
Las claves secretas solo se pegan en Supabase → Edge Functions → Secrets. Nunca en la web ni en un chat.

## 1. Secretos en Supabase
Edge Functions → Secrets → pegar en el campo *Name*:

```
STRIPE_SECRET_KEY=sk_live_tu_clave_secreta
SITE_URL=https://jrrfoto.vercel.app
UNLOCK_DAYS=5
```

## 2. Desplegar las dos funciones nuevas
Edge Functions → *Deploy a new function* → *Via Editor*:

- Nombre `checkout` → pegar `supabase/functions/checkout/index.ts`
- Nombre `stripe-webhook` → pegar `supabase/functions/stripe-webhook/index.ts`

En `stripe-webhook` → Settings → **Verify JWT = OFF** (Stripe no envía token).
En `checkout` → Verify JWT queda **ON** (necesita saber quién compra).

## 3. Avisar a Stripe de dónde está el webhook
Stripe → Developers → Webhooks → *Add endpoint*:

- URL: `https://lclvboyfwwegvyyjpscw.supabase.co/functions/v1/stripe-webhook`
- Evento: `checkout.session.completed`

Copia el `whsec_…` que aparece y añádelo en Supabase como secreto:

```
STRIPE_WEBHOOK_SECRET=whsec_tu_secreto
```

## 4. Comprobar
Compra una foto con otra cuenta y una tarjeta real de 1 €. Debe pasar esto:

1. Vas a la página de pago de Stripe y vuelves a la galería.
2. El pedido aparece como **pagado** sin que toques nada.
3. Te llega el email de venta y al comprador su aviso con los días de descarga.
4. El botón *Descargar* entrega el archivo sin marca de agua.

Si el pedido se queda pendiente: Stripe → Webhooks → tu endpoint → pestaña de intentos.
Ahí se ve el error exacto (lo normal es tener el `whsec` mal o el *Verify JWT* encendido).

## Notas
- Stripe cobra 1,5 % + 0,25 € por pago con tarjeta europea: de 1 € te quedan 0,73 €.
  Por eso está el pack de 5 archivos por 4 € (te quedan 3,69 €).
- Importe mínimo por pago: 0,50 €.
- Revolut, transferencia y efectivo siguen funcionando sin comisión, con tu confirmación manual.
- Al cobrar de forma habitual hace falta alta de autónomo y declarar los ingresos;
  rellena tu NIF en los ajustes (sección *Datos legales*) para que salga en la web.
