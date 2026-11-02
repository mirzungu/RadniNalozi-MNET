// Mogućnosti uređaja: skeniranje uživo, GPS lokacija i čuvanje/deljenje fajlova.
// U Android aplikaciji koristi Capacitor dodatke; u pregledaču koristi kameru i lokaciju pregledača.
(function () {
  const Cap = window.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = isNative ? Cap.Plugins || {} : {};

  // ---------- skeniranje ----------
  async function scanNative() {
    const BS = P.BarcodeScanner;
    if (!BS) return undefined;
    try {
      const m = await BS.isGoogleBarcodeScannerModuleAvailable();
      if (m && m.available === false) {
        await BS.installGoogleBarcodeScannerModule();
        throw new Error("Skener se upravo preuzima na telefon. Pokušajte ponovo za minut.");
      }
    } catch (e) {
      if (e && /preuzima/.test(e.message)) throw e;
    }
    try {
      const r = await BS.scan();
      const vals = (r.barcodes || []).map((b) => b.rawValue || b.displayValue).filter(Boolean);
      return vals.length ? vals : null;
    } catch (e) {
      if (/cancel/i.test(String(e && (e.message || e.code)))) return null;
      throw e;
    }
  }

  function scanBrowser() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.ZXing) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.className = "overlay";
      box.innerHTML =
        '<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Skeniranje koda">' +
        '<div class="sec-h"><h2>Usmerite kameru na kod</h2></div>' +
        '<video playsinline muted style="width:100%;max-height:60vh;background:#000;border-radius:6px"></video>' +
        '<p class="stat" style="margin:8px 0">Bar kod ili QR kod se čita sam čim bude oštar.</p>' +
        '<div class="actions" style="margin-top:0"><button type="button" class="btn">Otkaži</button></div></div>';
      document.body.appendChild(box);
      const video = box.querySelector("video");
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      const reader = new ZXing.BrowserMultiFormatReader(hints);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        try { reader.reset(); } catch (e) {}
        box.remove();
        resolve(v);
      };
      box.querySelector("button").onclick = () => finish(null);
      reader
        .decodeFromConstraints({ video: { facingMode: "environment" } }, video, (res) => {
          if (res) finish([res.getText()]);
        })
        .catch(() => finish(undefined));
    });
  }

  async function scan() {
    return isNative ? scanNative() : scanBrowser();
  }

  // ---------- lokacija ----------
  async function locate() {
    if (isNative && P.Geolocation) {
      try {
        const perm = await P.Geolocation.requestPermissions();
        if (perm && perm.location === "denied") throw new Error("Dozvola za lokaciju je odbijena. Uključite je u podešavanjima telefona.");
      } catch (e) {
        if (/odbijena/.test(e.message)) throw e;
      }
      const p = await P.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      return { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), ts: Date.now() };
    }
    if (!navigator.geolocation) throw new Error("Ovaj uređaj ne podržava lokaciju.");
    return new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0), ts: Date.now() }),
        (e) => rej(new Error(e.code === 1 ? "Dozvola za lokaciju je odbijena." : "Lokacija nije očitana. Izađite na otvoren prostor i pokušajte ponovo.")),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      )
    );
  }

  // ---------- čuvanje fajla ----------
  const toBase64 = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

  async function saveFile(filename, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? "text/csv" : "application/octet-stream" });
    if (isNative && P.Filesystem && P.Share) {
      const w = await P.Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: "CACHE" });
      await P.Share.share({ title: filename, url: w.uri, dialogTitle: "Sačuvaj ili pošalji" });
      return { status: "saved" };
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { status: "saved" };
  }

  window.RNNative = { isNative, scan, locate, saveFile };
})();
