// Edge Function: download
// Devuelve enlaces firmados (5 min) de los ORIGINALES de un pedido,
// solo si está pagado y dentro de la ventana de días.
//
// Deploy:  supabase functions deploy download
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const auth = req.headers.get("Authorization") || "";
  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return json({ error: "order_id requerido" }, 400);

  // Cliente con el JWT del usuario: RLS decide qué pedido puede ver.
  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } }
  );

  const { data: order, error } = await asUser
    .from("orders")
    .select("id,status,paid_at,order_items(media_id)")
    .eq("id", order_id)
    .single();

  if (error || !order) return json({ error: "pedido no encontrado" }, 404);
  if (order.status !== "paid") return json({ error: "pedido no pagado" }, 402);

  const days = Number(Deno.env.get("UNLOCK_DAYS") ?? "5");
  if (order.paid_at) {
    const until = new Date(order.paid_at).getTime() + days * 86400000;
    if (Date.now() > until) return json({ error: "descarga caducada" }, 410);
  }

  // service_role solo para firmar: el bucket privado nunca se expone.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const ids = (order.order_items || []).map((i: { media_id: string }) => i.media_id);
  const { data: media } = await admin
    .from("media")
    .select("id,original_path,file_name")
    .in("id", ids);

  const urls: { name: string; url: string }[] = [];
  for (const m of media || []) {
    const { data: signed } = await admin.storage
      .from("originals")
      .createSignedUrl(m.original_path, 300, { download: m.file_name || true });
    if (signed?.signedUrl) urls.push({ name: m.file_name || "foto.jpg", url: signed.signedUrl });
  }

  return json({ urls });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
