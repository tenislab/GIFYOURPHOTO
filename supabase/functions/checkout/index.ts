import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function stripeKey() {
  const mode = (Deno.env.get("STRIPE_MODE") ?? "live").toLowerCase();
  return mode === "test"
    ? (Deno.env.get("STRIPE_SECRET_TEST") ?? Deno.env.get("STRIPE_SECRET_KEY"))
    : (Deno.env.get("STRIPE_SECRET_LIVE") ?? Deno.env.get("STRIPE_SECRET_KEY"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const key = stripeKey();
  if (!key) return json({ error: "falta la clave de Stripe" }, 500);
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
  const body = await req.json().catch(() => ({}));

  // ---- 2) Confirmar un pago al volver de Stripe ----
  if (body.session_id) {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + body.session_id, {
      headers: { Authorization: `Bearer ${key}` }
    });
    const sesion = await r.json();
    if (!r.ok) return json({ error: sesion?.error?.message || "error de Stripe" }, 502);
    if (sesion.payment_status !== "paid") return json({ paid: false });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const dias = Number(Deno.env.get("UNLOCK_DAYS") ?? "5");
    const orderId = sesion?.metadata?.order_id;
    const ref = sesion?.metadata?.ref || sesion?.client_reference_id;

    const q = admin.from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .select("id,ref,total,buyer_name,buyer_email");
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
  }

  // ---- 1) Crear la página de pago ----
  const order_id = body.order_id;
  if (!order_id) return json({ error: "order_id requerido" }, 400);

  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }
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
  const form = new URLSearchParams({
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
    success_url: `${site}/?pedido=${order.ref}&pagado=1&sesion={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/?pedido=${order.ref}&pagado=0`,
    locale: "es"
  });
  if (order.buyer_email) form.set("customer_email", order.buyer_email);

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
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
