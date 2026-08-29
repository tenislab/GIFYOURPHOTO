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
        user = p ? {
          id: p.id, name: p.name, role: p.role,
          email: sess.session.user.email,
          avatar: (sess.session.user.user_metadata || {}).avatar || ""
        } : null;
      }
      // 'hidden' puede no existir todavía en la base: si falla, repetimos sin ella.
      let groups = null;
      const conHidden = await sb
        .from("groups")
        .select("id,name,city,palette,poster_path,albums(id,run_date,name,km,price_photo,price_video,published,media(id,kind,preview_path,file_name,position,hidden))")
        .order("created_at", { ascending: true });
      if (conHidden.error) {
        const sinHidden = await sb
          .from("groups")
          .select("id,name,city,palette,poster_path,albums(id,run_date,name,km,price_photo,price_video,published,media(id,kind,preview_path,file_name,position))")
          .order("created_at", { ascending: true });
        groups = sinHidden.data;
      } else {
        groups = conHidden.data;
      }

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
              .filter(m => !m.hidden)
              .slice()
              .sort((x, y) => x.position - y.position)
              .map(m => ({ id: m.id, kind: m.kind, name: m.file_name, url: publicUrl(m.preview_path) }))
          }))
      }));

      let orders = [];
      let notifs = [];
      if (user) {
        const { data: os } = await sb
          .from("orders")
          .select("id,ref,method,status,total,buyer_name,buyer_email,created_at,paid_at,order_items(media_id)")
          .order("created_at", { ascending: false });
        const days = Number(window.JRR_UNLOCK_DAYS || 5);
        orders = (os || []).map(o => ({
          id: o.id, ref: o.ref, method: o.method, status: o.status, total: Number(o.total),
          buyerName: o.buyer_name, buyerEmail: o.buyer_email, concept: o.buyer_name, date: o.created_at,
          unlockedUntil: o.paid_at ? new Date(new Date(o.paid_at).getTime() + days * 86400000).toISOString() : null,
          lines: (o.order_items || []).map(i => ({ mediaId: i.media_id }))
        }));
        const n = await API.listNotifications();
        notifs = n.notifs || [];
      }
      return { users: [], user, groups: mapped, orders, notifs };
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

    // Borra un álbum y sus archivos, salvo lo que tenga descarga activa: eso se
    // conserva hasta que caduque, para no dejar sin archivo a quien ya pagó.
    async deleteAlbum(albumId, unlockDays) {
      if (!live) return { ok: true };
      const dias = Number(unlockDays ?? 5);
      const { data: media } = await sb.from("media")
        .select("id,original_path,preview_path").eq("album_id", albumId);
      if (!media || !media.length) {
        const b0 = await sb.from("albums").delete().eq("id", albumId);
        return b0.error ? { error: b0.error.message } : { ok: true, borrado: true };
      }

      // ¿Qué archivos están dentro de una ventana de descarga abierta?
      const ids = media.map(m => m.id);
      const { data: vivos } = await sb
        .from("order_items")
        .select("media_id, orders!inner(status,paid_at)")
        .in("media_id", ids)
        .eq("orders.status", "paid");
      const limite = Date.now() - dias * 86400000;
      const protegidos = new Set(
        (vivos || [])
          .filter(v => v.orders && v.orders.paid_at && new Date(v.orders.paid_at).getTime() > limite)
          .map(v => v.media_id)
      );

      // Las previews se retiran siempre: el álbum desaparece de la galería.
      const previas = media.map(m => m.preview_path).filter(Boolean);
      if (previas.length) await sb.storage.from("previews").remove(previas);

      // Los originales solo si nadie tiene descarga viva.
      const originales = media
        .filter(m => !protegidos.has(m.id) && m.original_path)
        .map(m => m.original_path);
      if (originales.length) await sb.storage.from("originals").remove(originales);

      await sb.from("media").update({ hidden: true }).eq("album_id", albumId);
      await sb.from("albums").update({ published: false }).eq("id", albumId);

      if (!protegidos.size) {
        const borrado = await sb.from("albums").delete().eq("id", albumId);
        if (!borrado.error) return { ok: true, borrado: true };
      }
      return { ok: true, borrado: false, protegidos: protegidos.size };
    },

    async deleteOrder(orderId) {
      if (!live) {
        const d = readLocal();
        writeLocal({ orders: (d.orders || []).filter(o => o.id !== orderId) });
        return { ok: true };
      }
      const { error } = await sb.from("orders").delete().eq("id", orderId);
      return error ? { error: error.message } : { ok: true };
    },

    async deleteMedia(mediaId) {
      if (!live) return { ok: true };
      const { data: m } = await sb.from("media").select("original_path,preview_path").eq("id", mediaId).single();
      const { error } = await sb.from("media").delete().eq("id", mediaId);

      // Si la foto está en un pedido, la base la protege: la ocultamos.
      if (error) {
        const oculta = await sb.from("media").update({ hidden: true }).eq("id", mediaId);
        if (oculta.error) return { error: oculta.error.message };
      }
      if (m) {
        if (m.original_path) await sb.storage.from("originals").remove([m.original_path]);
        if (m.preview_path) await sb.storage.from("previews").remove([m.preview_path]);
      }
      return { ok: true };
    },

    async deleteGroup(groupId) {
      if (!live) return { ok: true };
      const { error } = await sb.from("groups").delete().eq("id", groupId);
      return error ? { error: error.message } : { ok: true };
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
          sb.functions.invoke((window.JRR_FUNCTIONS || {}).watermark || "watermark", {
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
        const fn = (window.JRR_FUNCTIONS || {}).notify || "notify";
        const { error } = await sb.functions.invoke(fn, { body: payload });
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
      const { data: who } = await sb.auth.getUser();
      const uid = (who && who.user && who.user.id) || null;
      const { data: o, error } = await sb.from("orders").insert({
        buyer_id: uid, buyer_name: order.buyerName, buyer_email: order.buyerEmail,
        method: order.method, total: order.total,
        status: order.status === "paid" ? "paid" : "pending",
        paid_at: order.status === "paid" ? new Date().toISOString() : null
      }).select("id,ref").single();
      if (error) return { error: error.message };
      const rows = order.lines.map(l => ({ order_id: o.id, media_id: l.mediaId, unit_price: l.price }));
      if (rows.length) await sb.from("order_items").insert(rows);
      return { order: Object.assign({}, order, { id: o.id, ref: o.ref }) };
    },

    // ---- Avisos (viajan entre el corredor y el fotógrafo) ----
    async listNotifications() {
      if (!live) return { notifs: (readLocal().notifs || []) };
      const { data, error } = await sb
        .from("notifications")
        .select("id,type,to_owner,to_email,order_id,ref,total,method,from_label,until,handled,created_at")
        .order("created_at", { ascending: true });
      if (error) return { notifs: [], error: error.message };
      return {
        notifs: (data || []).map(n => ({
          id: n.id, type: n.type, audience: n.to_owner ? "owner" : n.to_email,
          orderId: n.order_id, ref: n.ref, total: Number(n.total || 0), method: n.method,
          from: n.from_label, until: n.until, handled: n.handled, createdAt: n.created_at
        }))
      };
    },

    async addNotification(n) {
      if (!live) return { ok: true };
      const { error } = await sb.from("notifications").insert({
        type: n.type,
        to_owner: n.audience === "owner",
        to_email: n.audience === "owner" ? null : n.audience,
        order_id: n.orderId && String(n.orderId).length > 20 ? n.orderId : null,
        ref: n.ref, total: n.total, method: n.method || null,
        from_label: n.from || null, until: n.until || null
      });
      return error ? { error: error.message } : { ok: true };
    },

    async handleNotification(id) {
      if (!live) return { ok: true };
      const { error } = await sb.from("notifications").update({ handled: true }).eq("id", id);
      return error ? { error: error.message } : { ok: true };
    },

    async markPaid(orderId, ref) {
      if (!live) {
        const d = readLocal();
        const orders = (d.orders || []).map(o => o.id === orderId ? Object.assign({}, o, { status: "paid" }) : o);
        writeLocal({ orders });
        return { ok: true };
      }
      const patch = { status: "paid", paid_at: new Date().toISOString() };
      const uuid = orderId && String(orderId).length > 20;
      const q = uuid
        ? sb.from("orders").update(patch).eq("id", orderId)
        : sb.from("orders").update(patch).eq("ref", ref || orderId);
      const { error } = await q;
      return error ? { error: error.message } : { ok: true };
    },

    // Enlaces de descarga del original. En Supabase los firma una Edge Function
    // que comprueba que el pedido está pagado (has_paid_media).
    async downloadUrls(orderId) {
      if (!live) return { urls: [] };
      const { data: sess } = await sb.auth.getSession();
      const token = sess && sess.session ? sess.session.access_token : null;
      if (!token) return { reason: "sin-sesion", urls: [] };
      const cfgNames = (window.JRR_FUNCTIONS || {});
      const names = [cfgNames.download || "download", "download", "Download"];
      let last = { reason: "sin-funcion", urls: [] };
      for (const name of names) {
        try {
          const r = await fetch(cfg.url + "/functions/v1/" + name, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
              apikey: cfg.anonKey
            },
            body: JSON.stringify({ order_id: orderId })
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok) return { urls: body.urls || [] };
          if (r.status === 402) return { reason: "no-pagado", urls: [] };
          if (r.status === 410) return { reason: "caducado", urls: [] };
          if (r.status === 404) { last = { reason: "no-encontrado", urls: [] }; continue; }
          last = { reason: body.error || "error", urls: [] };
        } catch (e) { /* nombre no válido: probamos el siguiente */ }
      }
      return last;
    },

    // Avatar: se guarda en la propia cuenta, sin tocar la base de datos.
    async setAvatar(key) {
      if (!live) return { ok: true };
      const { error } = await sb.auth.updateUser({ data: { avatar: key } });
      return error ? { error: error.message } : { ok: true };
    },

    // Pregunta a Stripe si la sesión está cobrada (no depende del webhook).
    async verifyStripe(sessionId) {
      if (!live) return { paid: false };
      const name = (window.JRR_FUNCTIONS || {}).checkout || "checkout";
      const { data: sess } = await sb.auth.getSession();
      const token = sess && sess.session ? sess.session.access_token : cfg.anonKey;
      try {
        const r = await fetch(cfg.url + "/functions/v1/" + name, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
            apikey: cfg.anonKey
          },
          body: JSON.stringify({ session_id: sessionId })
        });
        const body = await r.json().catch(() => ({}));
        return r.ok ? body : { paid: false, error: body.error };
      } catch (e) {
        return { paid: false, error: String(e) };
      }
    },

    // Página de pago de Stripe para un pedido ya creado.
    async stripeCheckout(orderId) {
      if (!live) return { error: "local" };
      const { data: sess } = await sb.auth.getSession();
      const token = sess && sess.session ? sess.session.access_token : null;
      if (!token) return { error: "sin-sesion" };
      const name = (window.JRR_FUNCTIONS || {}).checkout || "checkout";
      try {
        const r = await fetch(cfg.url + "/functions/v1/" + name, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
            apikey: cfg.anonKey
          },
          body: JSON.stringify({ order_id: orderId })
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body.url) return { error: body.error || "stripe" };
        return { url: body.url, id: body.id };
      } catch (e) {
        return { error: String(e) };
      }
    }
  };

  window.JRRData = API;
})();
