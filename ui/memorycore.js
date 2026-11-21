// THE MACHINE // CORE: de geheugenkern. Alles wat The Machine weet staat in de browser (localStorage); dit bestand
// zorgt dat het niet zomaar kwijtraakt:
// - schijfkopie: elke wijziging wordt (even later) ook naar data/state.json geschreven door de lokale server;
// - terugzetten: is de browseropslag leeg (browser gewist, andere browser) dan komt alles vanzelf van schijf terug;
// - dagelijkse momentopname (data/snapshots), de laatste zeven blijven bewaard;
// - middernacht-consolidatie: oude details worden opgeruimd, belangrijke gebeurtenissen blijven;
// - /memory, /backup, /restore, /export en /import.
// Het sudo-wachtwoord gaat nooit mee. Er gaat niets het netwerk op:
// de server luistert alleen op deze computer.
(function () {
  "use strict";
  const UI = window.MachineUI, C = MachineCore, R = C.retention, U = C.util, S = UI.S;
  const H = { "X-Machine": "1" }, K_DAY = "machine.consolidated", RESTORED = "machine.restored", MIRROR_MS = 4000, MIRROR_GAP = 30000;   // kort na een wijziging, maar hooguit eens per 30 seconden (de kopie is het hele geheugen)
  const disk = { ok: null, savedAt: 0, bytes: 0, snaps: [], error: "" };
  let timer = null, saving = false, again = false, pendingImport = null;

  const collect = () => { const all = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); all[k] = localStorage.getItem(k); } } catch {} return all; };
  const api = (path, opt) => fetch(path, Object.assign({ cache: "no-store" }, opt || {}, { headers: Object.assign({}, H, opt && opt.body ? { "Content-Type": "application/json" } : {}) }));
  const mb = n => (n / 1048576).toFixed(n < 104858 ? 2 : 1) + " MB";

  /* ---------- schijfkopie ---------- */
  async function mirror() {
    if (UI.storeFrozen) return false;                      // /restore of /import zet net alles terug: de oude kopie op schijf laten staan
    if (saving) { again = true; return false; }
    saving = true;
    try {
      UI.persist();
      const body = JSON.stringify(R.pack(collect(), { origin: location.origin, app: "the-machine" }));
      const r = await api("data/state", { method: "POST", body });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const was = disk.ok;
      disk.ok = true; disk.savedAt = Date.now(); disk.bytes = body.length; disk.error = "";
      if (was === false) UI.emit("MEMORY", 1, "MEMORY CORE // DISK COPY RESTORED");
      await daily();
    } catch (e) {
      if (disk.ok !== false) { disk.ok = false; disk.error = String(e.message || e); if (terminalReady) UI.emit("MEMORY", 2, "MEMORY CORE // DISK COPY UNAVAILABLE // BROWSER STORAGE ONLY"); }
    }
    saving = false;
    if (again) { again = false; schedule(); }
    return disk.ok === true;
  }
  function schedule() {
    if (timer) return;
    const wait = Math.max(MIRROR_MS, MIRROR_GAP - (Date.now() - (disk.savedAt || 0)));
    timer = setTimeout(() => { timer = null; (window.requestIdleCallback || (f => setTimeout(f, 0)))(() => mirror(), { timeout: 5000 }); }, wait);
  }
  // tabblad naar de achtergrond of dicht: meteen nog een keer wegschrijven
  document.addEventListener("visibilitychange", () => { if (document.hidden && timer) { clearTimeout(timer); timer = null; mirror(); } });
  UI.onStored.push(schedule);

  async function snapshots() {
    try { const r = await api("data/snapshots"); if (r.ok) disk.snaps = await r.json(); } catch {}
    return disk.snaps;
  }
  // één momentopname per dag; oudere automatische vallen af (handmatige blijven)
  async function daily() {
    const name = R.snapshotName(Date.now());
    if (disk.dayDone === name) return;
    await snapshots();
    if (!disk.snaps.some(s => s.name === name)) {
      const r = await api("data/snapshot?name=" + name, { method: "POST" });
      if (r.ok) { UI.emit("MEMORY", 0, `MEMORY CORE // DAILY SNAPSHOT ${name.toUpperCase()}`); await snapshots(); }
    }
    for (const old of R.rotate(disk.snaps.map(s => s.name))) await api("data/snapshot?name=" + old, { method: "DELETE" }).catch(() => {});
    disk.dayDone = name;
  }

  /* ---------- terugzetten ---------- */
  // schrijft een gecontroleerde back-up terug; instellingen die er niet in zitten (sudo) blijven staan
  function apply(keys) {
    UI.storeFrozen = true;                                   // lopende opslag mag de teruggezette gegevens niet overschrijven
    try {
      for (const k of Object.keys(collect())) if (!R.skipKey(k)) localStorage.removeItem(k);
      for (const k of Object.keys(keys)) localStorage.setItem(k, keys[k]);
      return true;
    } catch (e) { console.error(e); return false; }
  }
  // na herladen door /restore, /import of terugzetten van schijf: vanzelf door de ACTIVATE-knop (de camera had al toestemming)
  try {
    if (sessionStorage.getItem("machine.autostart") === "1") {
      sessionStorage.removeItem("machine.autostart");
      const iv = setInterval(() => { const b = document.querySelector("#bootInner button"); if (b) { clearInterval(iv); b.click(); } else if (!$("boot")) clearInterval(iv); }, 300);
    }
  } catch {}
  const reloadSoon = why => { try { sessionStorage.setItem(RESTORED, why); sessionStorage.setItem("machine.autostart", "1"); } catch {} setTimeout(() => location.reload(), 900); };

  // start: browseropslag leeg maar wel een kopie op schijf -> terugzetten en opnieuw laden (voor ACTIVATE)
  (async function boot() {
    let had = null; try { had = localStorage.getItem(STORE.people); } catch {}
    let restored = ""; try { restored = sessionStorage.getItem(RESTORED) || ""; sessionStorage.removeItem(RESTORED); } catch {}
    if (restored) { const wait = setInterval(() => { if (!terminalReady) return; clearInterval(wait); UI.emit("MEMORY", 1, `MEMORY CORE // ${restored}`); print(`MEMORY CORE // ${restored}`, "ok"); }, 500); }
    try {
      const r = await api("data/state");
      if (r.status === 204) { disk.ok = true; if (had != null) schedule(); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const obj = await r.json(); disk.ok = true; disk.savedAt = obj.created || 0; disk.bytes = JSON.stringify(obj).length;
      if (had == null && !restored && !terminalReady) {
        const keys = R.unpack(obj), sum = R.summary(keys);
        if (sum.profiles > 0 && apply(keys)) reloadSoon(`RESTORED FROM DISK // ${sum.profiles} PROFILES // ${sum.sightings} SIGHTINGS`);
      }
      snapshots();
    } catch (e) { disk.ok = false; disk.error = String(e.message || e); }
  })();

  /* ---------- middernacht: opruimen ---------- */
  function consolidate(now) {
    const today = U.dayKey(now), last = store.get(K_DAY, null);
    if (last === today) return;
    const r = R.prune({ events: S.events, unknowns: S.unknowns, hist: S.hist, uptime: S.up }, now);
    if (r.removed.total) {
      S.events.splice(0, S.events.length, ...r.events); S.unknowns.splice(0, S.unknowns.length, ...r.unknowns); S.hist.splice(0, S.hist.length, ...r.hist);
      for (const k of Object.keys(S.up)) if (!(k in r.uptime)) delete S.up[k];
      ["events", "unknowns", "hist", "up"].forEach(UI.markDirty);
    }
    store.set(K_DAY, today);
    if (last) UI.emit("MEMORY", 1, `MIDNIGHT // MEMORY CONSOLIDATED // ${r.removed.total} OLD RECORDS RELEASED`, { kind: "CONSOLIDATED" });
  }
  UI.hourly.push(consolidate);
  const waitOnline = setInterval(() => { if (!terminalReady) return; clearInterval(waitOnline); consolidate(Date.now()); }, 1000);

  UI.diskStatus = () => disk.ok === true ? { text: disk.savedAt ? `SAVED ${ago(disk.savedAt).toUpperCase()}` : "READY", color: "var(--green)" }
    : disk.ok === false ? { text: "UNAVAILABLE", color: "var(--red)" } : { text: "CHECKING", color: "var(--grey)" };
  UI.memory = { mirror, snapshots, disk, consolidate, collect };

  /* ---------- commando's ---------- */
  const cleanName = s => String(s || "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  const stampName = () => { const d = new Date(); return `manual-${d.getFullYear()}${U.pad2(d.getMonth() + 1)}${U.pad2(d.getDate())}-${U.pad2(d.getHours())}${U.pad2(d.getMinutes())}`; };
  const sumLine = s => `${s.profiles} PROFILES // ${s.sightings} SIGHTINGS // ${s.cases} CASES // ${s.events} EVENTS // ${s.numbers} NUMBERS // ${mb(s.bytes * 2)}`;

  UI.commands["/memory"] = async () => {
    const sum = R.summary(R.pack(collect()).keys), used = UI.storageBytes ? UI.storageBytes() : 0;
    print("MEMORY CORE", "ok");
    print(`  IN MEMORY       ${sumLine(sum)}`, "machine");
    print(`  BROWSER STORAGE ${mb(used)} OF ABOUT 10 MB${used > 8e6 ? "  // NEARLY FULL" : ""}`, used > 8e6 ? "err" : "machine");
    print(`  DISK COPY       ${disk.ok === true ? `OK // ${disk.savedAt ? "SAVED " + ago(disk.savedAt).toUpperCase() : "NOTHING SAVED YET"}${disk.bytes ? " // " + mb(disk.bytes) : ""}` : disk.ok === false ? "UNAVAILABLE (" + disk.error + ")" : "CHECKING"}`, disk.ok === false ? "err" : "machine");
    const snaps = await snapshots();
    print(`  SNAPSHOTS       ${snaps.length || "NONE"}${snaps.length ? ": " + snaps.slice(0, 6).map(s => s.name).join(", ") + (snaps.length > 6 ? ", ..." : "") : ""}`, "machine");
    print(`  RETENTION       EVENTS ${R.KEEP.eventDays} DAYS // ALERTS ${R.KEEP.alertDays} DAYS // UNKNOWN SUBJECTS ${R.KEEP.unknownDays} DAYS // CONSOLIDATED ${store.get(K_DAY, "NEVER")}`, "machine");
    print("  /backup [name]   /restore [name]   /export   /import", "warn");
  };
  UI.commands["/backup"] = async args => {
    const name = cleanName(args[0]) || stampName();
    if (/^day-/.test(name)) { print("NAMES STARTING WITH day- ARE RESERVED FOR THE DAILY SNAPSHOT", "warn"); return; }
    if (!(await mirror()) && disk.ok !== true) { print("BACKUP FAILED // DISK COPY UNAVAILABLE // USE /export INSTEAD", "err"); return; }
    try {
      const r = await api("data/snapshot?name=" + name, { method: "POST" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      print(`BACKUP STORED // ${name.toUpperCase()} // ${mb(j.bytes || 0)}   (/restore ${name})`, "ok");
      UI.emit("MEMORY", 1, `BACKUP STORED // ${name.toUpperCase()}`);
    } catch (e) { print("BACKUP FAILED // " + String(e.message || e).toUpperCase(), "err"); }
  };
  UI.commands["/restore"] = async args => {
    const name = cleanName(args[0]);
    if (!name) {
      const snaps = await snapshots();
      if (!snaps.length) { print("NO SNAPSHOTS ON DISK // /backup MAKES ONE", "warn"); return; }
      print("SNAPSHOTS ON DISK   (/restore <name>)", "ok");
      for (const s of snaps.slice(0, 20)) print(`  ${s.name.padEnd(28)} ${stamp(s.ts)}   ${mb(s.bytes)}`, "machine");
      return;
    }
    try {
      const r = await api("data/snapshot?name=" + name);
      if (r.status === 404) { print(`NO SNAPSHOT NAMED ${name.toUpperCase()} // /restore SHOWS THE LIST`, "err"); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const keys = R.unpack(await r.json()), sum = R.summary(keys);
      if ((args[1] || "").toLowerCase() !== "confirm") {
        print(`SNAPSHOT ${name.toUpperCase()} // ${sumLine(sum)}`, "ok");
        print(`THIS REPLACES EVERYTHING IN MEMORY. TYPE: /restore ${name} confirm`, "warn");
        return;
      }
      await mirror(); await api("data/snapshot?name=before-restore", { method: "POST" }).catch(() => {});   // vangnet: de huidige toestand eerst opslaan
      if (!apply(keys)) { UI.storeFrozen = false; print("RESTORE FAILED // BROWSER STORAGE FULL", "err"); return; }
      print(`RESTORING ${name.toUpperCase()} // RELOADING...   (previous state kept as before-restore)`, "warn");
      reloadSoon(`RESTORED SNAPSHOT ${name.toUpperCase()} // ${sum.profiles} PROFILES`);
    } catch (e) { print("RESTORE FAILED // " + String(e.message || e).toUpperCase(), "err"); }
  };
  UI.commands["/export"] = async () => {
    UI.persist(); saveMemory(); saveSightings();
    const pack = R.pack(collect(), { origin: location.origin, app: "the-machine" }), sum = R.summary(pack.keys);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(pack)], { type: "application/json" }));
    a.download = `the-machine-memory-${U.dayKey(Date.now())}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    print(`MEMORY EXPORTED // ${a.download} // ${sumLine(sum)}`, "ok");
    print("THE FILE CONTAINS FACE DATA AND NOTES. KEEP IT PRIVATE.", "warn");
    UI.emit("MEMORY", 1, "MEMORY EXPORTED TO FILE");
  };
  function readImport(text) {
    const keys = R.unpack(JSON.parse(text)), sum = R.summary(keys);
    pendingImport = keys;
    print(`MEMORY FILE // ${sumLine(sum)}`, "ok");
    print("THIS REPLACES EVERYTHING IN MEMORY. TYPE: /import confirm", "warn");
  }
  UI.importText = text => { try { readImport(text); return true; } catch (e) { print("IMPORT FAILED // " + String(e.message || e).toUpperCase(), "err"); return false; } };
  UI.commands["/import"] = async args => {
    if ((args[0] || "").toLowerCase() === "confirm") {
      if (!pendingImport) { print("NOTHING TO IMPORT // TYPE /import AND CHOOSE A FILE FIRST", "warn"); return; }
      await mirror(); await api("data/snapshot?name=before-import", { method: "POST" }).catch(() => {});
      const sum = R.summary(pendingImport);
      if (!apply(pendingImport)) { UI.storeFrozen = false; print("IMPORT FAILED // BROWSER STORAGE FULL", "err"); return; }
      pendingImport = null;
      print("IMPORTING // RELOADING...", "warn");
      reloadSoon(`IMPORTED FROM FILE // ${sum.profiles} PROFILES`);
      return;
    }
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json"; inp.id = "memImport"; inp.style.display = "none";
    inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return; try { readImport(await f.text()); } catch (e) { print("IMPORT FAILED // " + String(e.message || e).toUpperCase(), "err"); } };
    document.body.appendChild(inp); inp.click();
    print("CHOOSE A MEMORY FILE (the-machine-memory-....json)", "ok");
  };
})();
