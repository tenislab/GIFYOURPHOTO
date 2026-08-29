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
      const { data, error } = await sb.from("groups").upsert({
        id: group.id || undefined, name: group.name, city: group.city, palette: group.palette
      }).select("id").single();
      return error ? { error: error.message } : { id: data.id };
    },

    async saveAlbum(groupId, album, files) {
      if (!live) return { ok: true };
      const { data: a, error } = await sb.from("albums").upsert({
        id: album.id && album.id.length > 20 ? album.id : undefined,
        group_id: groupId, run_date: album.date, name: album.name, km: album.km || null,
        price_photo: album.pricePhoto, price_video: album.priceVideo, published: album.published
      }).select("id").single();
      if (error) return { error: error.message };

      let position = 0;
      for (const f of (files || [])) {
        const kind = f.type.indexOf("video") === 0 ? "video" : "photo";
        const base = a.id + "/" + Date.now() + "-" + f.name.replace(/[^\w.\-]/g, "_");
        const up = await sb.storage.from("originals").upload(base, f);
        if (up.error) continue;
        // La preview con marca de agua la genera la Edge Function watermark;
        // hasta entonces se referencia el mismo nombre en el bucket público.
        await sb.from("media").insert({
          album_id: a.id, kind, original_path: base, preview_path: base,
          file_name: f.name, bytes: f.size, position: position++
        });
      }
      return { id: a.id };
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
      const { data, error } = await sb.functions.invoke("download", { body: { order_id: orderId } });
      return error ? { error: error.message, urls: [] } : { urls: (data && data.urls) || [] };
    }
  };

  window.JRRData = API;
})();
