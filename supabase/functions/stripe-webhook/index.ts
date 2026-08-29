// Edge Function: stripe-webhook
// Stripe avisa aquí cuando el pago se completa: marca el pedido como pagado,
// abre la ventana de descarga y crea el aviso de venta para el fotógrafo.
//
// Secretos:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
//   supabase secrets set UNLOCK_DAYS=5
//
// Importante: esta función NO debe pedir JWT.
//   Edge Functions → stripe-webhook → Settings → "Verify JWT" = OFF
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Verificación de la firma de Stripe (esquema t=…,v1=…) con HMAC-SHA256.
async function firmaValida(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string])
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${t}.${payload}`)
  );
  const esperado = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Comparación de tiempo constante
  if (esperado.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const sig = req.headers.get("stripe-signature") || "";
  const payload = await req.text();

  if (!secret) return new Response("falta STRIPE_WEBHOOK_SECRET", { status: 500 });
  if (!(await firmaValida(payload, sig, secret))) {
    return new Response("firma no válida", { status: 400 });
  }

  const evento = JSON.parse(payload);
  if (evento.type !== "checkout.session.completed") {
    return new Response("ignorado", { status: 200 });
  }

  const sesion = evento.data.object;
  const orderId = sesion?.metadata?.order_id;
  const ref = sesion?.metadata?.ref || sesion?.client_reference_id;
  if (!orderId && !ref) return new Response("sin pedido", { status: 200 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const dias = Number(Deno.env.get("UNLOCK_DAYS") ?? "5");
  const ahora = new Date().toISOString();

  const q = admin.from("orders").update({ status: "paid", paid_at: ahora });
  const { data: pedido, error } = orderId
    ? await q.eq("id", orderId).select("id,ref,total,buyer_name,buyer_email").single()
    : await q.eq("ref", ref).select("id,ref,total,buyer_name,buyer_email").single();

  if (error || !pedido) return new Response("pedido no encontrado", { status: 200 });

  await admin.from("notifications").insert([
    {
      type: "sale",
      to_owner: true,
      order_id: pedido.id,
      ref: pedido.ref,
      total: pedido.total,
      method: "card",
      from_label: `${pedido.buyer_name} · ${pedido.buyer_email}`
    },
    {
      type: "unlocked",
      to_owner: false,
      to_email: pedido.buyer_email,
      order_id: pedido.id,
      ref: pedido.ref,
      total: pedido.total,
      until: new Date(Date.now() + dias * 86400000).toISOString()
    }
  ]);

  // Email de aviso (si notify está desplegada y con clave de Resend)
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
      },
      body: JSON.stringify({
        kind: "sale",
        ref: pedido.ref,
        total: pedido.total,
        buyer_name: pedido.buyer_name,
        buyer_email: pedido.buyer_email,
        days: dias
      })
    });
  } catch (_) { /* el aviso en la web ya está creado */ }

  return new Response("ok", { status: 200 });
});
