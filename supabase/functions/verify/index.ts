// Edge Function: verify
// Pregunta a Stripe si una sesión de pago está cobrada y, si lo está, marca el
// pedido como pagado y crea los avisos. Así no depende del webhook.
//
// POST { session_id }  ->  { paid: true|false, ref }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const mode = (Deno.env.get("STRIPE_MODE") ?? "live").toLowerCase();
  const key = mode === "test"
    ? (Deno.env.get("STRIPE_SECRET_TEST") ?? Deno.env.get("STRIPE_SECRET_KEY"))
    : (Deno.env.get("STRIPE_SECRET_LIVE") ?? Deno.env.get("STRIPE_SECRET_KEY"));
  if (!key) return json({ error: "falta la clave de Stripe" }, 500);

  const { session_id } = await req.json().catch(() => ({}));
  if (!session_id) return json({ error: "session_id requerido" }, 400);

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + session_id, {
    headers: { Authorization: `Bearer ${key}` }
  });
  const sesion = await r.json();
  if (!r.ok) return json({ error: sesion?.error?.message || "error de Stripe" }, 502);
  if (sesion.payment_status !== "paid") return json({ paid: false });

  const orderId = sesion?.metadata?.order_id;
  const ref = sesion?.metadata?.ref || sesion?.client_reference_id;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const dias = Number(Deno.env.get("UNLOCK_DAYS") ?? "5");
  const q = admin.from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .select("id,ref,total,status,buyer_name,buyer_email");
  const { data: pedido } = orderId
    ? await q.eq("id", orderId).single()
    : await q.eq("ref", ref).single();

  if (!pedido) return json({ paid: true, ref, aviso: "pedido no encontrado" });

  const { data: yaHay } = await admin.from("notifications")
    .select("id").eq("order_id", pedido.id).eq("type", "sale").limit(1);

  if (!yaHay || !yaHay.length) {
    await admin.from("notifications").insert([
      {
        type: "sale", to_owner: true, order_id: pedido.id, ref: pedido.ref,
        total: pedido.total, method: "card",
        from_label: `${pedido.buyer_name} · ${pedido.buyer_email}`
      },
      {
        type: "unlocked", to_owner: false, to_email: pedido.buyer_email,
        order_id: pedido.id, ref: pedido.ref, total: pedido.total,
        until: new Date(Date.now() + dias * 86400000).toISOString()
      }
    ]);
  }

  return json({ paid: true, ref: pedido.ref });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
