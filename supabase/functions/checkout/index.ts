// Edge Function: checkout
// Crea la página de pago de Stripe para un pedido y devuelve su URL.
// La clave secreta vive SOLO aquí, nunca en la web.
//
// Secretos necesarios:
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
//   supabase secrets set SITE_URL=https://jrrfoto.vercel.app
//
// POST { order_id }  ->  { url }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // STRIPE_MODE = "test" | "live". Cada modo usa su propia clave, así no hace
  // falta borrar ninguna para cambiar de entorno.
  const mode = (Deno.env.get("STRIPE_MODE") ?? "live").toLowerCase();
  const key = mode === "test"
    ? (Deno.env.get("STRIPE_SECRET_TEST") ?? Deno.env.get("STRIPE_SECRET_KEY"))
    : (Deno.env.get("STRIPE_SECRET_LIVE") ?? Deno.env.get("STRIPE_SECRET_KEY"));
  if (!key) return json({ error: "falta la clave de Stripe para el modo " + mode }, 500);
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");

  const auth = req.headers.get("Authorization") || "";
  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return json({ error: "order_id requerido" }, 400);

  // Con el JWT del comprador: RLS garantiza que el pedido es suyo.
  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } }
  );

  const { data: order, error } = await asUser
    .from("orders")
    .select("id,ref,total,status,buyer_email,order_items(media_id)")
    .eq("id", order_id)
    .single();

  if (error || !order) return json({ error: "pedido no encontrado" }, 404);
  if (order.status === "paid") return json({ error: "pedido ya pagado" }, 409);

  const cents = Math.round(Number(order.total) * 100);
  if (cents < 50) return json({ error: "importe mínimo 0,50 €" }, 400);

  const items = (order.order_items || []).length;
  const body = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]": `Fotos y vídeos · ${order.ref}`,
    "line_items[0][price_data][product_data][description]": `${items} archivo(s) sin marca de agua`,
    client_reference_id: order.ref,
    "metadata[order_id]": order.id,
    "metadata[ref]": order.ref,
    "metadata[origen]": "galeria-jrr",
    success_url: `${site}/?pedido=${order.ref}&pagado=1`,
    cancel_url: `${site}/?pedido=${order.ref}&pagado=0`,
    locale: "es"
  });
  if (order.buyer_email) body.set("customer_email", order.buyer_email);

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const session = await r.json();
  if (!r.ok) return json({ error: session?.error?.message || "error de Stripe" }, 502);

  return json({ url: session.url, id: session.id });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
