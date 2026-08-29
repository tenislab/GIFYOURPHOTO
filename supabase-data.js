// Capa de datos de la galería.
// Con supabase-config.js rellenado usa Supabase; si no, guarda en el navegador.
// API (todo async): init, load, signUp, signIn, signOut, saveAlbum, saveGroup,
// createOrder, markPaid, downloadUrls.
(function () {
  const STORE = "jrr-gallery-v1";
  const cfg = (window.JRR_SUPABASE || {});
  const live = !!(cfg.url && cfg.anonKey && window.supabase);
  let sb = live ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { return {}; }
  };
  const writeLocal = (patch) => {
    const next = Object.assign(readLocal(), patch);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch (e) {}
    return next;
  };

  const publicUrl = (path) =>
    path && sb ? sb.storage.from("previews").getPublicUrl(path).data.publicUrl : "";

  const API = {
    mode: live ? "supabase" : "local",

    async init() { return API.mode; },

    async load() {
      if (!live) {
        const d = readLocal();
        return { users: d.users || [], user: d.user || null, groups: d.groups || null, orders: d.orders || [] };
      }
      const { data: sess } = await sb.auth.getSession();
      let user = null;
      if (sess && sess.session) {
        const uid = sess.session.user.id;
        const { data: p } = await sb.from("profiles").select("id,name,role").eq("id", uid).single();
        user = p ? { id: p.id, name: p.name, role: p.role, email: sess.session.user.email } : null;
      }
      const { data: groups } = await sb
        .from("groups")
        .select("id,name,city,palette,poster_path,albums(id,run_date,name,km,price_photo,price_video,published,media(id,kind,preview_path,file_name,position))")
        .order("created_at", { ascending: true });

      const mapped = (groups || []).map(g => ({
        id: g.id, name: g.name, city: g.city, palette: g.palette,
        poster: g.poster_path ? publicUrl(g.poster_path) : "",
        items: (g.albums || [])
          .slice()
          .sort((a, b) => (a.run_date < b.run_date ? 1 : -1))
          .map(a => ({
            id: a.id, date: a.run_date, name: a.name, km: a.km,
            pricePhoto: a.price_photo, priceVideo: a.price_video, published: a.published,
            media: (a.media || [])
              .slice()
              .sort((x, y) => x.position - y.position)
              .map(m => ({ id: m.id, kind: m.kind, name: m.file_name, url: publicUrl(m.preview_path) }))
          }))
      }));

      let orders = [];
      if (user) {
        const { data: os } = await sb
          .from("orders")
          .select("id,ref,method,status,total,buyer_name,buyer_email,created_at,order_items(media_id)")
          .order("created_at", { ascending: false });
        orders = (os || []).map(o => ({
          id: o.id, ref: o.ref, method: o.method, status: o.status, total: Number(o.total),
          buyerName: o.buyer_name, buyerEmail: o.buyer_email, date: o.created_at,
          lines: (o.order_items || []).map(i => ({ mediaId: i.media_id }))
        }));
      }
      return { users: [], user, groups: mapped, orders };
    },

    async signUp({ name, email, pass, role }) {
      if (!live) {
        const d = readLocal();
        const users = d.users || [];
        if (users.some(u => u.email === email)) return { error: "exists" };
        const user = { name, email, pass, role };
        writeLocal({ users: users.concat([user]), user });
        return { user };
      }
      const { data, error } = await sb.auth.signUp({
        email, password: pass, options: { data: { name, role } }
      });
      if (error) return { error: error.message };
      return { user: { id: data.user && data.user.id, name, email, role } };
    },

    async signIn({ email, pass }) {
      if (!live) {
        const d = readLocal();
        const found = (d.users || []).find(u => u.email === email);
        if (!found) return { error: "nouser" };
        if (found.pass !== pass) return { error: "wrongpass" };
        writeLocal({ user: found });
        return { user: found };
      }
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) return { error: error.message };
      const { data: p } = await sb.from("profiles").select("id,name,role").eq("id", data.user.id).single();
      return { user: { id: data.user.id, email, name: p ? p.name : email, role: p ? p.role : "runner" } };
    },

    async resetPassword(email) {
      if (!live) return { error: "local" };
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      return error ? { error: error.message } : { ok: true };
    },

    async changePassword(pass) {
      if (!live) return { error: "local" };
      const { error } = await sb.auth.updateUser({ password: pass });
      return error ? { error: error.message } : { ok: true };
    },

    async signOut() {
      if (!live) { writeLocal({ user: null }); return {}; }
      await sb.auth.signOut();
      return {};
    },

    // Persistencia del catálogo. En local se guarda tal cual; en Supabase se
    // hace upsert de grupo/álbum y se suben los archivos a los dos buckets.
    async saveGroups(groups) {
      if (!live) { writeLocal({ groups }); return { ok: true }; }
      return { ok: true }; // en modo Supabase cada acción escribe su tabla
    },

    async saveGroup(group) {
      if (!live) return { ok: true };
      const { data: who } = await sb.auth.getUser();
      const uid = who && who.user && who.user.id;
      if (!uid) return { error: "sin sesión" };
      const row = {
        owner_id: uid,
        name: group.name || "Grupo sin nombre",
        city: group.city || "",
        palette: group.palette || 0
      };
      if (group.id && String(group.id).length > 20) row.id = group.id;
      const { data, error } = await sb.from("groups").upsert(row).select("id").single();
      return error ? { error: error.message } : { id: data.id };
    },

    async setGroupPoster(groupId, file) {
      if (!live || !file) return { ok: false };
      const path = "groups/" + groupId + "-" + Date.now() + ".jpg";
      const up = await sb.storage.from("previews").upload(path, file, {
        contentType: file.type || "image/jpeg", upsert: true
      });
      if (up.error) return { error: up.error.message };
      const { error } = await sb.from("groups").update({ poster_path: path }).eq("id", groupId);
      return error ? { error: error.message } : { ok: true, path };
    },

    // Primer arranque: si no hay ningún grupo, crea el del club.
    async ensureGroup(name, city) {
      if (!live) return { ok: true };
      const { data: existing } = await sb.from("groups").select("id").limit(1);
      if (existing && existing.length) return { id: existing[0].id };
      return API.saveGroup({ name, city, palette: 0 });
    },

    async saveAlbum(groupId, album, files) {
      if (!live) return { ok: true };
      if (!groupId || String(groupId).length < 20) {
        const g = await API.ensureGroup("HAMK RUN CLUB", "Hämeenlinna");
        if (g.error) return { error: g.error };
        groupId = g.id;
      }
      const { data: a, error } = await sb.from("albums").upsert({
        id: album.id && album.id.length > 20 ? album.id : undefined,
        group_id: groupId, run_date: album.date, name: album.name, km: album.km || null,
        price_photo: album.pricePhoto, price_video: album.priceVideo, published: album.published
      }).select("id").single();
      if (error) return { error: error.message };

      let position = 0;
      for (const item of (files || [])) {
        const f = item.file;
        if (!f) continue;
        const kind = f.type.indexOf("video") === 0 ? "video" : "photo";
        const safe = f.name.replace(/[^\w.\-]/g, "_");
        const base = a.id + "/" + Date.now() + "-" + position + "-" + safe;

        const upOriginal = await sb.storage.from("originals").upload(base, f, { upsert: true });
        if (upOriginal.error) continue;

        // Preview visible: la versión reducida con marca de agua CSS hasta que
        // la Edge Function watermark la reescriba incrustada en el píxel.
        let previewPath = null;
        if (item.preview) {
          const blob = await (await fetch(item.preview)).blob();
          const pPath = base.replace(/\.[^.]+$/, "") + "-preview.jpg";
          const upPreview = await sb.storage.from("previews").upload(pPath, blob, {
            contentType: "image/jpeg", upsert: true
          });
          if (!upPreview.error) previewPath = pPath;
        }

        const { data: inserted } = await sb.from("media").insert({
          album_id: a.id, kind, original_path: base, preview_path: previewPath,
          file_name: f.name, bytes: f.size, position: position++
        }).select("id").single();

        // Marca de agua incrustada: reescribe la preview dentro del píxel.
        if (inserted && kind === "photo") {
          sb.functions.invoke("watermark", {
            body: { media_id: inserted.id, original_path: base }
          }).catch(() => {});
        }
      }
      return { id: a.id };
    },

    // Emails (Edge Function notify). Falla en silencio si no está desplegada.
    async sendEmail(payload) {
      if (!live) return { ok: false };
      try {
        const { error } = await sb.functions.invoke("notify", { body: payload });
        return error ? { error: error.message } : { ok: true };
      } catch (e) {
        return { error: String(e) };
      }
    },

    async createOrder(order) {
      if (!live) {
        const d = readLocal();
        const orders = (d.orders || []).concat([order]);
        writeLocal({ orders });
        return { order };
      }
      const { data: o, error } = await sb.from("orders").insert({
        buyer_id: order.buyerId, buyer_name: order.buyerName, buyer_email: order.buyerEmail,
        method: order.method, total: order.total
      }).select("id,ref").single();
      if (error) return { error: error.message };
      const rows = order.lines.map(l => ({ order_id: o.id, media_id: l.mediaId, unit_price: l.price }));
      if (rows.length) await sb.from("order_items").insert(rows);
      return { order: Object.assign({}, order, { id: o.id, ref: o.ref }) };
    },

    async markPaid(orderId) {
      if (!live) {
        const d = readLocal();
        const orders = (d.orders || []).map(o => o.id === orderId ? Object.assign({}, o, { status: "paid" }) : o);
        writeLocal({ orders });
        return { ok: true };
      }
      const { error } = await sb.from("orders")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", orderId);
      return error ? { error: error.message } : { ok: true };
    },

    // Enlaces de descarga del original. En Supabase los firma una Edge Function
    // que comprueba que el pedido está pagado (has_paid_media).
    async downloadUrls(orderId) {
      if (!live) return { urls: [] };
      // El nombre de la función puede estar en minúscula o con mayúscula.
      for (const name of ["download", "Download"]) {
        try {
          const { data, error } = await sb.functions.invoke(name, { body: { order_id: orderId } });
          if (!error) return { urls: (data && data.urls) || [] };
        } catch (e) { /* probamos el siguiente nombre */ }
      }
      return { error: "download", urls: [] };
    }
  };

  window.JRRData = API;
})();
