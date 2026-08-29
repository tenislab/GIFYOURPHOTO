# Despliegue — copia y pega

Proyecto: `lclvboyfwwegvyyjpscw`

## 1. Instalar la CLI y entrar

```bash
npm install -g supabase
supabase login
supabase link --project-ref lclvboyfwwegvyyjpscw
```

Si `npm install -g` te da problemas, usa `npx supabase` delante de cada comando (`npx supabase link --project-ref …`).

## 2. Secretos

```bash
supabase secrets set WM_TEXT="@JRR"
supabase secrets set UNLOCK_DAYS=5
supabase secrets set OWNER_EMAIL=jaimerivasgranada@gmail.com
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set FROM_EMAIL="Galeria JRR <onboarding@resend.dev>"
```

`RESEND_API_KEY` se saca gratis en resend.com (3.000 emails/mes). Hasta que la pongas, los emails no salen pero nada se rompe: los avisos siguen viéndose dentro de la web.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya existen solas: no hay que ponerlas.

## 3. Desplegar las cinco funciones

```bash
supabase functions deploy watermark
supabase functions deploy download
supabase functions deploy notify
supabase functions deploy checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

⚠️ `stripe-webhook` necesita **Verify JWT = OFF**. Con la CLI es el flag `--no-verify-jwt`;
si la despliegas desde el panel web, entra en la función → Settings → apaga *Verify JWT*.
Si se queda encendido, Stripe recibe un rechazo y ningún pedido se marca como pagado.

Secretos de Stripe (además de los del punto 2):

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_tu_clave
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_tu_secreto
supabase secrets set SITE_URL=https://jrrfoto.vercel.app
```

Y en Stripe → Developers → Webhooks → *Add endpoint*:
URL `https://lclvboyfwwegvyyjpscw.supabase.co/functions/v1/stripe-webhook`, evento `checkout.session.completed`.

Comprobar que están arriba:

```bash
supabase functions list
```

- **watermark** — al subir cada foto, incrusta `@JRR` en diagonal dentro del píxel y guarda esa versión en el bucket público. El original nunca sale del bucket privado. Esto es lo que hace que la marca no se pueda quitar con el clic derecho.
- **download** — recibe un pedido, comprueba que está pagado y dentro de los 5 días, y devuelve enlaces firmados que caducan en 5 minutos.
- **notify** — manda los emails (venta a ti, descarga lista al comprador).
- **checkout** — crea la página de pago de Stripe para un pedido.
- **stripe-webhook** — Stripe avisa aquí al cobrar: marca el pedido pagado, abre los días de descarga y crea los avisos.

## 4. URLs de la web (esto quita el `localhost`)

Authentication → **URL Configuration**:

- **Site URL**: `https://jrrfoto-git-main-rivasreinosojaime-3247s-projects.vercel.app`
- **Redirect URLs**: añade la misma línea, y `https://claude.ai/*` si quieres poder confirmar cuentas desde la vista previa.

Si no quieres que los corredores confirmen el email: Authentication → **Sign In / Providers → Email** → desactiva *Confirm email*.

## 5. Límites de vídeo

Storage → **Settings**: el límite por archivo son 50 MB en el plan gratis. En el plan Pro puedes subirlo a 5 GB. La web ya avisa si un vídeo pasa del límite que tengas puesto.

## Comprobación final

1. Entra como fotógrafo y crea un álbum con 2 fotos.
2. En Storage debe aparecer el original en `originals` y la versión con marca en `previews`.
3. Con otra cuenta, compra una foto y acepta el pago desde Avisos: el corredor recibe email y el botón *Descargar* le da un enlace que caduca.
