// Veza aplikacije sa Supabase-om: prijava, podaci (nalozi, klijenti, podešavanja), fotografije i korisnici.
// Daje isti interfejs koji koristi ostatak aplikacije (db, assets, downloads, user).
// Sva prava proverava sama baza (RLS) – vidi supabase/schema.sql.
(function () {
  const C = window.RN_CONFIG || {};
  const LOGIN_DOMAIN = "nalozi.local";
  const BUCKET = "nalozi";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
  };

  if (!C.supabaseUrl || !C.supabaseKey || !window.supabase) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = '<div style="padding:24px;font:16px system-ui">Aplikacija nije podešena: u <b>config.js</b> nedostaju adresa i ključ Supabase projekta.</div>';
    });
    window.claude = { use: () => new Promise(() => {}) };
    return;
  }

  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "rn_auth" },
  });
  const BLOB = C.supabaseUrl.replace(/\/$/, "") + "/storage/v1/object/public/" + BUCKET + "/";
  let me = null;

  const toEmail = (login) => {
    login = String(login || "").trim().toLowerCase();
    return login.includes("@") ? login : login + "@" + LOGIN_DOMAIN;
  };
  const errMsg = (e) => {
    const m = (e && (e.message || e.error_description || e.error)) || "Greška";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "Nema veze sa serverom. Proverite internet.";
    if (/row-level security|permission denied|violates row-level/i.test(m)) return "Vaša uloga nema pravo na ovu radnju.";
    if (/Invalid login credentials/i.test(m)) return "Pogrešno korisničko ime ili lozinka.";
    if (/banned/i.test(m)) return "Ovaj nalog je deaktiviran.";
    return m;
  };
  const chk = ({ data, error }) => { if (error) throw new Error(errMsg(error)); return data; };

  async function loadMe() {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return null;
    const { data, error } = await sb.from("profiles").select("id,name,username,is_admin,uloga,active").eq("id", s.session.user.id).maybeSingle();
    if (error) {
      // bez interneta: radi sa poslednjim poznatim korisnikom
      if (/fetch|network/i.test(error.message || "")) { try { return JSON.parse(ls.get("rn_me") || "null"); } catch (e) { return null; } }
      return null;
    }
    if (!data || !data.active) { await sb.auth.signOut(); ls.set("rn_login_msg", "Ovaj nalog je deaktiviran."); return null; }
    return { id: data.id, name: data.name, username: data.username, isAdmin: data.is_admin, uloga: data.uloga, email: s.session.user.email };
  }

  // ---------- prijava ----------
  function loginScreen() {
    return new Promise((resolve) => {
      const msg = ls.get("rn_login_msg") || "";
      ls.del("rn_login_msg");
      const box = document.createElement("div");
      box.className = "login-wrap";
      box.innerHTML =
        '<form class="login" novalidate><div class="login-logo"></div>' +
        '<h1>Prijava</h1><p class="lead">Radni nalozi servisa na terenu</p>' +
        '<div class="f"><label class="l" for="lg_u">Korisničko ime ili e-pošta</label><input type="text" id="lg_u" autocomplete="username" autocapitalize="none"></div>' +
        '<div class="f"><label class="l" for="lg_p">Lozinka</label><input type="password" id="lg_p" autocomplete="current-password"></div>' +
        '<div class="msg" role="alert"></div><button type="submit" class="btn pri">Prijavi se</button></form>';
      document.body.appendChild(box);
      if (window.RN_LOGO_D) box.querySelector(".login-logo").innerHTML = '<img src="' + window.RN_LOGO_D + '" alt="MonitoringNET">';
      const m = box.querySelector(".msg");
      m.textContent = msg;
      box.querySelector("#lg_u").value = ls.get("rn_last_user") || "";
      setTimeout(() => box.querySelector(ls.get("rn_last_user") ? "#lg_p" : "#lg_u").focus(), 50);
      box.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const b = box.querySelector("button");
        b.disabled = true; b.textContent = "Prijavljivanje…"; m.textContent = "";
        try {
          const login = box.querySelector("#lg_u").value.trim();
          const { error } = await sb.auth.signInWithPassword({ email: toEmail(login), password: box.querySelector("#lg_p").value });
          if (error) throw error;
          const u = await loadMe();
          if (!u) throw new Error(ls.get("rn_login_msg") || "Nalog nije aktivan.");
          ls.set("rn_last_user", login);
          box.remove();
          resolve(u);
        } catch (err) {
          m.textContent = errMsg(err);
          b.disabled = false; b.textContent = "Prijavi se";
        }
      });
    });
  }

  let ready = null;
  function session() {
    if (ready) return ready;
    ready = (async () => {
      me = await loadMe();
      if (!me) me = await loginScreen();
      ls.set("rn_me", JSON.stringify(me));
      userMenu();
      return me;
    })();
    return ready;
  }

  async function logout() {
    await sb.auth.signOut();
    location.reload();
  }

  // ---------- meni korisnika ----------
  function userMenu() {
    const row = document.querySelector(".hrow");
    if (!row || document.getElementById("umBtn")) return;
    const w = document.createElement("div");
    w.className = "um";
    w.innerHTML = '<button type="button" class="um-btn" id="umBtn" aria-haspopup="true" aria-expanded="false"></button>' +
      '<div class="um-menu" id="umMenu" hidden><button type="button" id="umPass">Promeni lozinku</button><button type="button" id="umOut">Odjavi se</button></div>';
    row.appendChild(w);
    const btn = w.querySelector("#umBtn"), menu = w.querySelector("#umMenu");
    btn.textContent = me.name || me.username;
    btn.onclick = () => { menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); };
    document.addEventListener("click", (e) => { if (!w.contains(e.target)) menu.hidden = true; });
    w.querySelector("#umOut").onclick = logout;
    w.querySelector("#umPass").onclick = () => { menu.hidden = true; passwordDialog(); };
  }

  function passwordDialog() {
    const box = document.createElement("div");
    box.className = "overlay";
    box.innerHTML = '<form class="sheet-panel" novalidate><div class="sec-h"><h2>Promena lozinke</h2></div>' +
      '<div class="grid"><div class="f full"><label class="l" for="pw_o">Trenutna lozinka</label><input type="password" id="pw_o" autocomplete="current-password"></div>' +
      '<div class="f full"><label class="l" for="pw_n">Nova lozinka (bar 8 znakova)</label><input type="password" id="pw_n" autocomplete="new-password"></div></div>' +
      '<div class="actions"><div class="msg" role="alert"></div><button type="button" class="btn" data-x>Odustani</button><button type="submit" class="btn pri">Sačuvaj lozinku</button></div></form>';
    document.body.appendChild(box);
    box.querySelector("[data-x]").onclick = () => box.remove();
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const m = box.querySelector(".msg"), nova = box.querySelector("#pw_n").value;
      try {
        if (nova.length < 8) throw new Error("Nova lozinka mora imati bar 8 znakova.");
        const { error: e1 } = await sb.auth.signInWithPassword({ email: me.email, password: box.querySelector("#pw_o").value });
        if (e1) throw new Error("Trenutna lozinka nije tačna.");
        const { error: e2 } = await sb.auth.updateUser({ password: nova });
        if (e2) throw e2;
        box.remove();
        if (window.toastRN) window.toastRN("Lozinka je promenjena.");
      } catch (err) { m.textContent = errMsg(err); }
    });
  }

  // ---------- podaci ----------
  const subs = [];
  const meta = { fromCache: false, hasPendingWrites: false };
  const docSnap = (id, data) => ({ id, exists: data !== undefined && data !== null, data: () => data || undefined, metadata: meta });

  async function fetchCol(col) {
    if (col === "clanovi") {
      if (me.isAdmin) {
        const rows = chk(await sb.from("profiles").select("id,uloga"));
        return rows.filter((u) => u.uloga).map((u) => ({ id: u.id, data: { uloga: u.uloga } }));
      }
      return me.uloga ? [{ id: me.id, data: { uloga: me.uloga } }] : [];
    }
    const q = sb.from(col).select("id,data");
    return chk(await (col === "nalozi" ? q.order("created_at", { ascending: false }).limit(5000) : q.limit(5000)));
  }
  async function fetchDoc(col, id) {
    const r = chk(await sb.from(col).select("data").eq("id", id).maybeSingle());
    return r ? r.data : null;
  }

  function colSnap(rows, s) {
    let docs = rows.map((r) => docSnap(r.id, r.data));
    if (s.order) {
      const f = s.order, k = s.dir === "desc" ? -1 : 1;
      docs.sort((a, b) => {
        const x = a.data()[f], y = b.data()[f];
        if (x === y) return 0;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return (x > y ? 1 : -1) * k;
      });
    }
    if (s.limit) docs = docs.slice(0, s.limit);
    return { docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => [] };
  }

  async function refresh(filterCol) {
    for (const s of subs) {
      const col = s.path.split("/")[0];
      if (filterCol && col !== filterCol) continue;
      try {
        if (s.kind === "col") s.next(colSnap(await fetchCol(s.path), s));
        else s.next(docSnap(s.path.split("/")[1], await fetchDoc(col, s.path.split("/")[1])));
      } catch (e) {
        if (!/veze/.test(e.message) && s.error) s.error({ code: "unavailable", message: e.message });
      }
    }
  }
  setInterval(() => { if (!document.hidden && me) refresh(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && me) refresh(); });
  window.addEventListener("online", () => me && refresh());

  function query(path, order, dir, limit) {
    return {
      orderBy: (f, d) => query(path, f, d, limit),
      limit: (n) => query(path, order, dir, n),
      async get() { return colSnap(await fetchCol(path), { order, dir, limit }); },
      onSnapshot(next, error) {
        const s = { kind: "col", path, order, dir, limit, next, error };
        subs.push(s);
        fetchCol(path).then((rows) => next(colSnap(rows, s))).catch((e) => error && error({ code: "unavailable", message: e.message }));
        return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
      },
    };
  }

  function docRef(path) {
    const [col, id] = path.split("/");
    return {
      id,
      async get() { return docSnap(id, await fetchDoc(col, id)); },
      onSnapshot(next, error) {
        const s = { kind: "doc", path, next, error };
        subs.push(s);
        fetchDoc(col, id).then((d) => next(docSnap(id, d))).catch((e) => error && error({ code: "unavailable", message: e.message }));
        return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
      },
      async set(data) {
        let out;
        if (col === "clanovi") {
          chk(await sb.from("profiles").update({ uloga: data.uloga || null }).eq("id", id));
          out = data;
        } else {
          const ex = chk(await sb.from(col).select("id").eq("id", id).maybeSingle());
          if (ex) {
            const row = chk(await sb.from(col).update({ data }).eq("id", id).select("data").maybeSingle());
            out = row ? row.data : data;
          } else {
            // bez „returning": uloga koja ne vidi arhivu i dalje sme da zatvori nalog
            chk(await sb.from(col).insert({ id, data }));
            out = (await fetchDoc(col, id).catch(() => null)) || data;
          }
        }
        refresh(col);
        return out;
      },
      async update(part) {
        const cur = await fetchDoc(col, id);
        if (!cur) throw new Error("Ne postoji.");
        const row = chk(await sb.from(col).update({ data: Object.assign({}, cur, part) }).eq("id", id).select("data").maybeSingle());
        refresh(col);
        return row ? row.data : null;
      },
      async delete() {
        if (col === "clanovi") chk(await sb.from("profiles").update({ uloga: null }).eq("id", id));
        else {
          const r = chk(await sb.from(col).delete().eq("id", id).select("id"));
          if (!r || !r.length) throw new Error("Vaša uloga nema pravo na ovu radnju.");
        }
        refresh(col);
      },
    };
  }

  const db = { doc: docRef, collection: (p) => query(p) };

  const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/svg+xml": ".svg", "application/pdf": ".pdf" };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const assets = {
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type || "image/jpeg";
      const id = rid() + (EXT[type] || "");
      chk(await sb.storage.from(BUCKET).upload(id, blob, { contentType: type, upsert: false, cacheControl: "31536000" }));
      return { id, url: BLOB + id, sizeBytes: blob.size, contentType: type };
    },
  };

  const downloads = { save: ({ filename, data }) => window.RNNative.saveFile(filename, data) };

  const user = {
    id: async () => me && me.id,
    canEdit: async () => !!(me && me.isAdmin),
    async profiles(ids) {
      ids = [...new Set([].concat(ids).filter(Boolean))];
      const out = {};
      if (!ids.length) return out;
      let rows = [];
      try { rows = chk(await sb.from("profiles").select("id,name").in("id", ids.filter((i) => /^[0-9a-f-]{36}$/.test(i)))); } catch (e) {}
      const m = Object.fromEntries(rows.map((r) => [r.id, r.name]));
      ids.forEach((id) => (out[id] = { id, name: m[id] || "", avatarUrl: "", isMe: me && id === me.id }));
      return out;
    },
    search: async () => [],
  };

  // ---------- administracija korisnika i e-pošta (Edge funkcije) ----------
  async function fn(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
      if (/Failed to send|fetch/i.test(msg)) msg = "Funkcija „" + name + "” nije dostupna. Proverite da je postavljena u Supabase-u.";
      throw new Error(msg);
    }
    return data;
  }
  const users = {
    async list() {
      const rows = chk(await sb.from("profiles").select("id,name,username,is_admin,uloga,active,created_at").order("name"));
      return rows.map((u) => ({ id: u.id, name: u.name, username: (u.username || "").replace("@" + LOGIN_DOMAIN, ""), isAdmin: u.is_admin, uloga: u.uloga, active: u.active }));
    },
    async update(id, patch) {
      if (patch.active !== undefined) {
        // Ako funkcija rn-admin nije postavljena, deaktivacija ide direktno u bazu (baza tada uskraćuje sve podatke)
        try { await fn("rn-admin", { action: "active", id, active: patch.active }); }
        catch (e) { chk(await sb.from("profiles").update({ active: !!patch.active }).eq("id", id)); }
      }
      if (patch.password !== undefined) {
        try { await fn("rn-admin", { action: "password", id, password: patch.password }); }
        catch (e) { throw new Error("Lozinku promenite u Supabase-u: Authentication → Users → korisnik → ⋯ → Reset password / Update user."); }
      }
      const p = {};
      if (patch.uloga !== undefined) p.uloga = patch.uloga || null;
      if (patch.isAdmin !== undefined) p.is_admin = !!patch.isAdmin;
      if (patch.name !== undefined) p.name = patch.name;
      if (Object.keys(p).length) chk(await sb.from("profiles").update(p).eq("id", id));
    },
    async create({ name, username, password, uloga, isAdmin }) {
      let r;
      try { r = await fn("rn-admin", { action: "create", login: username, name, password, uloga, isAdmin }); }
      catch (e) {
        if (/nije dostupna/.test(e.message))
          throw new Error("Novog korisnika napravite u Supabase-u: Authentication → Users → Add user (e-pošta npr. " +
            (String(username || "ime").includes("@") ? username : (username || "ime") + "@" + LOGIN_DOMAIN) +
            ", lozinka, ✔ Auto Confirm). Zatim mu ovde podesite ime i ulogu.");
        throw e;
      }
      return { name, username: r.login.replace("@" + LOGIN_DOMAIN, "") };
    },
  };
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function sendEmail(id, to, pdfBlob) {
    return fn("rn-email", { id, to, pdf: await toB64(pdfBlob) });
  }

  const caps = { db, assets, downloads, user };
  window.claude = { use: (name) => session().then(() => caps[name] || null) };
  window.RN = { me: () => me, blob: BLOB, logout, session, users, sendEmail, sb };
})();
