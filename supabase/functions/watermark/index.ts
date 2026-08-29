// Edge Function: watermark
// Coge un original del bucket privado, le incrusta @JRR en diagonal
// y guarda el resultado en el bucket público `previews`.
// Así la marca de agua va DENTRO del pixel: no se quita con el clic derecho.
//
// Deploy:
//   supabase secrets set WM_TEXT="@JRR"
//   supabase functions deploy watermark
//
// Llamar tras subir (desde la web o con un trigger de Storage):
//   POST { media_id, original_path }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image, decode } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const FONT_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

let fontCache: Uint8Array | null = null;
async function font() {
  if (!fontCache) fontCache = new Uint8Array(await (await fetch(FONT_URL)).arrayBuffer());
  return fontCache;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const { media_id, original_path } = await req.json().catch(() => ({}));
  if (!original_path) return json({ error: "original_path requerido" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: file, error } = await admin.storage.from("originals").download(original_path);
  if (error || !file) return json({ error: "no se pudo leer el original" }, 404);

  const src = await decode(new Uint8Array(await file.arrayBuffer()));
  if (!(src instanceof Image)) return json({ error: "formato no soportado" }, 415);

  // Preview a 1200px de lado largo: se ve bien en el móvil, gasta la mitad de
  // tráfico y no sirve para imprimir.
  const LADO = 1200;
  const long = Math.max(src.width, src.height);
  const img = long > LADO
    ? src.resize(...(src.width >= src.height ? [LADO, Image.RESIZE_AUTO] : [Image.RESIZE_AUTO, LADO]))
    : src;

  const text = Deno.env.get("WM_TEXT") ?? "@JRR";
  const size = Math.max(18, Math.round(img.width / 26));
  const label = await Image.renderText(await font(), size, text, 0xffffff66);
  const stamp = label.rotate(-26, false);

  // Rejilla diagonal por toda la foto.
  const stepX = Math.round(stamp.width * 1.9);
  const stepY = Math.round(stamp.height * 3.4);
  for (let y = -stepY; y < img.height + stepY; y += stepY) {
    const offset = (Math.round(y / stepY) % 2) * Math.round(stepX / 2);
    for (let x = -stepX; x < img.width + stepX; x += stepX) {
      img.composite(stamp, x + offset, y);
    }
  }

  const jpeg = await img.encodeJPEG(72);
  const previewPath = original_path.replace(/\.[^.]+$/, "") + "-wm.jpg";

  const up = await admin.storage.from("previews").upload(previewPath, jpeg, {
    contentType: "image/jpeg",
    upsert: true
  });
  if (up.error) return json({ error: up.error.message }, 500);

  if (media_id) {
    await admin.from("media").update({ preview_path: previewPath }).eq("id", media_id);
  }

  return json({ preview_path: previewPath });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
