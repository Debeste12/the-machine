// THE MACHINE // CORE: geheugenbeheer. Wat blijft bewaard, wat wordt opgeruimd, en hoe ziet een back-up eruit.
// - prune: oude details opruimen (de "middernacht-consolidatie"); belangrijke gebeurtenissen blijven langer.
// - pack / unpack: alle gegevens in één bestand (schijfkopie, back-up, export) met controlegetal.
// - snapshotName / rotate: dagelijkse momentopnamen, de oudste automatische vallen af.
// Geen DOM, geen opslag: alleen rekenen, zodat alles te testen is.
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const U = C.util;
  const FORMAT = "the-machine-memory", VERSION = 1;
  const KEEP = { eventDays: 30, alertDays: 180, unknownDays: 14, histDays: 7, uptimeDays: 60, dailySnapshots: 7 };
  // sleutels die nooit in een back-up horen: het sudo-wachtwoord en alles van de demo
  const skipKey = k => k === "machine.sudo" || k.indexOf("machine.sim.") === 0 || k === "machine.autostart" || k.indexOf("machine.") !== 0;

  // st = { events, unknowns, hist, uptime }; geeft nieuwe lijsten terug plus wat er is weggehaald
  function prune(st, now, keep) {
    const K = Object.assign({}, KEEP, keep || {});
    const events = (st.events || []).filter(e => now - e.ts <= (e.sev >= 2 ? K.alertDays : K.eventDays) * U.DAY);
    const unknowns = (st.unknowns || []).filter(u => now - u.e <= K.unknownDays * U.DAY);
    const hist = (st.hist || []).filter(h => now - h[0] <= K.histDays * U.DAY);
    const uptime = {}, minDay = U.dayKey(now - K.uptimeDays * U.DAY);
    for (const k of Object.keys(st.uptime || {})) if (k.slice(0, 10) >= minDay) uptime[k] = st.uptime[k];
    const removed = { events: (st.events || []).length - events.length, unknowns: (st.unknowns || []).length - unknowns.length,
                      hist: (st.hist || []).length - hist.length, uptime: Object.keys(st.uptime || {}).length - Object.keys(uptime).length };
    removed.total = removed.events + removed.unknowns + removed.hist + removed.uptime;
    return { events, unknowns, hist, uptime, removed };
  }

  // keys = { "machine.people": "<json-tekst>", ... } zoals in localStorage
  function checksum(keys) {
    let h = 0;
    for (const k of Object.keys(keys).sort()) h = (h * 31 + U.hash32(k + "=" + keys[k])) >>> 0;
    return h;
  }
  function pack(all, meta) {
    const keys = {};
    for (const k of Object.keys(all || {})) if (!skipKey(k) && typeof all[k] === "string") keys[k] = all[k];
    return Object.assign({ format: FORMAT, version: VERSION, created: Date.now() }, meta || {}, { keys, checksum: checksum(keys) });
  }
  // controleert een back-up; geeft de sleutels terug of gooit een fout met een duidelijke reden
  function unpack(obj) {
    if (!obj || typeof obj !== "object" || obj.format !== FORMAT) throw new Error("NOT A MACHINE MEMORY FILE");
    if (obj.version > VERSION) throw new Error("MEMORY FILE IS FROM A NEWER VERSION");
    if (!obj.keys || typeof obj.keys !== "object") throw new Error("MEMORY FILE IS EMPTY");
    const keys = {};
    for (const k of Object.keys(obj.keys)) {
      if (skipKey(k)) continue;
      if (typeof obj.keys[k] !== "string") throw new Error("MEMORY FILE IS DAMAGED (" + k + ")");
      try { JSON.parse(obj.keys[k]); } catch (e) { throw new Error("MEMORY FILE IS DAMAGED (" + k + ")"); }
      keys[k] = obj.keys[k];
    }
    if (obj.checksum !== undefined && obj.checksum !== checksum(keys)) throw new Error("MEMORY FILE IS DAMAGED (CHECKSUM)");
    return keys;
  }
  // korte inhoudsopgave van een back-up, om te tonen voor het terugzetten
  function summary(keys) {
    const n = (k, f) => { try { const v = JSON.parse(keys[k] || "null"); return v == null ? 0 : f(v); } catch (e) { return 0; } };
    let bytes = 0; for (const k of Object.keys(keys)) bytes += k.length + keys[k].length;
    return { profiles: n("machine.people", v => v.length), sightings: n("machine.sightings", v => v.length), cases: n("machine.cases", v => v.length),
             events: n("machine.events", v => v.length), numbers: n("machine.numbers", v => (v.list || []).length), bytes };
  }

  const snapshotName = now => "day-" + U.dayKey(now);
  // names = bestaande momentopnamen; geeft de automatische (day-...) terug die weg mogen, handmatige blijven altijd staan
  function rotate(names, keep) {
    const auto = (names || []).filter(n => /^day-\d{4}-\d{2}-\d{2}$/.test(n)).sort();
    return auto.slice(0, Math.max(0, auto.length - (keep == null ? KEEP.dailySnapshots : keep)));
  }

  C.retention = { FORMAT, VERSION, KEEP, skipKey, prune, checksum, pack, unpack, summary, snapshotName, rotate };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
