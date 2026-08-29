// Edge Function: notify
// Manda los emails de la galería con Resend.
//   - venta pagada / aviso de pago recibido  -> al fotógrafo
//   - archivos listos para descargar         -> al corredor
//
// Deploy:
//   supabase secrets set RESEND_API_KEY=re_xxx OWNER_EMAIL=jaimerivasgranada@gmail.com FROM_EMAIL="Galeria JRR <avisos@tudominio.com>"
//   supabase functions deploy notify
//
// POST { kind: "sale" | "claim" | "unlocked", ref, total, buyer_name, buyer_email, days }
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const euro = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n || 0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL") ?? "Galeria JRR <onboarding@resend.dev>";
  const owner = Deno.env.get("OWNER_EMAIL") ?? "";
  if (!key) return json({ error: "falta RESEND_API_KEY" }, 500);

  const b = await req.json().catch(() => ({}));
  const { kind, ref, total, buyer_name, buyer_email, days } = b;

  let to = "";
  let subject = "";
  let body = "";

  if (kind === "sale") {
    to = owner;
    subject = `Venta pagada · ${ref} · ${euro(total)}`;
    body = `${buyer_name} (${buyer_email}) ha pagado con tarjeta.\nPedido ${ref} · ${euro(total)}.\nYa tiene la descarga abierta ${days ?? 5} días.`;
  } else if (kind === "claim") {
    to = owner;
    subject = `Dice que ha pagado · ${ref} · ${euro(total)}`;
    body = `${buyer_name} (${buyer_email}) dice que ha pagado el pedido ${ref} (${euro(total)}).\nEntra en Avisos y acepta el pago para desbloquear la descarga.`;
  } else if (kind === "unlocked") {
    to = buyer_email;
    subject = `Tus fotos ya están listas · ${ref}`;
    body = `Pago confirmado del pedido ${ref}.\nTienes ${days ?? 5} días para descargar tus archivos sin marca de agua.\nEntra en la galería con tu cuenta y ve a "Mis compras".`;
  } else {
    return json({ error: "kind no válido" }, 400);
  }

  if (!to) return json({ error: "sin destinatario" }, 400);

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text: body })
  });

  if (!r.ok) return json({ error: await r.text() }, 502);
  return json({ sent: true, to });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
