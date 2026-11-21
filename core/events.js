// THE MACHINE // CORE: de gebeurtenissenstroom. Eén logboek voor alles wat The Machine opmerkt of doet.
// Een gebeurtenis: { ts, cat, sev, text, pid?, cam?, kind?, w?, nr? }
//   cat  = categorie (zie CATS), sev = ernst 0..3, pid = betrokken profiel, kind/w = soort en gewicht (afwijkingen)
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const CATS = ["SYSTEM", "ACCESS", "SUBJECT", "HANDOFF", "ANOMALY", "WEAPON", "CASE", "NUMBER", "CAMERA", "MEMORY", "SIM"];
  const SEV = { INFO: 0, NOTICE: 1, WARN: 2, ALERT: 3 };
  const KEEP = 2500, DEDUPE_MS = 5000;

  function make(cat, sev, text, extra) {
    if (!CATS.includes(cat)) throw new Error("onbekende categorie: " + cat);
    const e = { ts: Date.now(), cat, sev: Math.max(0, Math.min(3, sev | 0)), text: String(text) };
    if (extra) for (const k of Object.keys(extra)) if (extra[k] !== undefined && extra[k] !== null) e[k] = extra[k];
    return e;
  }
  // voegt toe (op tijd gesorteerd blijft de lijst vanzelf: nieuwe gebeurtenissen komen achteraan). false = dubbel, overgeslagen
  function push(list, ev, opts) {
    const keep = opts && opts.keep || KEEP, dd = opts && opts.dedupeMs != null ? opts.dedupeMs : DEDUPE_MS;
    for (let i = list.length - 1; i >= 0 && ev.ts - list[i].ts < dd; i--)
      if (list[i].cat === ev.cat && list[i].text === ev.text && list[i].pid === ev.pid) return false;
    list.push(ev);
    while (list.length > keep) {
      // eerst de oudste onbelangrijke melding (INFO/NOTICE) uit de oudste helft; anders gewoon de oudste
      let drop = -1;
      for (let i = 0; i < list.length / 2; i++) if (list[i].sev <= SEV.NOTICE) { drop = i; break; }
      list.splice(drop < 0 ? 0 : drop, 1);
    }
    return true;
  }
  // f: { cats, minSev, q, pid, from, to, limit, hide(e) }   -> nieuwste eerst
  function query(list, f) {
    f = f || {};
    const cats = f.cats && f.cats.length ? new Set(f.cats) : null, q = f.q ? String(f.q).toLowerCase() : "", out = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (f.to != null && e.ts > f.to) continue;
      if (f.from != null && e.ts < f.from) continue;
      if (cats && !cats.has(e.cat)) continue;
      if (f.minSev != null && e.sev < f.minSev) continue;
      if (f.pid && e.pid !== f.pid) continue;
      if (q && !(e.cat + " " + e.text).toLowerCase().includes(q)) continue;
      if (f.hide && f.hide(e)) continue;
      out.push(e);
      if (f.limit && out.length >= f.limit) break;
    }
    return out;
  }
  function countByCat(list, from, to) {
    const out = {};
    for (const e of list) if (e.ts >= from && e.ts <= to) out[e.cat] = (out[e.cat] || 0) + 1;
    return out;
  }
  // wat uit de opslag komt kan beschadigd zijn: alleen geldige gebeurtenissen blijven over
  function sanitize(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const e of raw) {
      if (!e || typeof e.ts !== "number" || !CATS.includes(e.cat) || e.text == null) continue;
      out.push({ ...e, sev: Math.max(0, Math.min(3, e.sev | 0)), text: String(e.text) });
    }
    return out;
  }

  C.events = { CATS, SEV, KEEP, make, push, query, countByCat, sanitize };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
