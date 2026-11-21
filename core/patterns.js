// THE MACHINE // CORE: leefpatronen en afwijkingen.
// Uit de tijdlijn (sightings) leert The Machine per persoon wanneer en waar die normaal te zien is.
// Wijkt een nieuwe waarneming daarvan af, dan is dat een afwijking (DEVIATION) die meeweegt in de dreigingsanalyse.
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const U = C.util;
  const MIN_DAYS = 5, MIN_BLOCKS = 10;          // minder geschiedenis = nog geen oordeel
  const CAM_MIN_AGE = 3 * U.DAY;                // een camera moet zo lang bestaan voordat "nooit daar gezien" iets zegt
  const NIGHT_FROM = 0, NIGHT_TO = 5;           // 00:00 - 05:00
  const LOITER_1 = 3 * U.MIN, LOITER_2 = 10 * U.MIN;
  const TRUSTED = new Set(["ADMIN", "ANALOG INTERFACE", "ASSET"]);
  const NO_LOITER = new Set(["ADMIN", "ANALOG INTERFACE", "ASSET", "FRIENDLY", "INDIGO"]);
  const UP_KEEP_DAYS = 60;
  const dow = ts => (new Date(ts).getDay() + 6) % 7;   // maandag = 0
  const hhmm = ts => { const d = new Date(ts); return `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`; };

  // opts: { to } = alleen geschiedenis vóór dit moment
  // -> { blocks, days, total, first, last, hours[24] ms, grid[7][24] aantal dagen, cams{} ms, camBlocks{}, byDay{ dag: uurmasker } }
  function profile(sightings, pid, opts) {
    const to = opts && opts.to != null ? opts.to : Infinity;
    const p = { pid, blocks: 0, days: 0, total: 0, first: null, last: null, hours: new Array(24).fill(0),
                grid: Array.from({ length: 7 }, () => new Array(24).fill(0)), cams: {}, camBlocks: {}, byDay: {} };
    for (const s of sightings) {
      if (s.pid !== pid || s.s >= to) continue;
      const end = Math.min(Math.max(s.e, s.s + 1000), to);   // één moment gezien telt als één seconde
      p.blocks++; p.total += end - s.s;
      p.first = p.first == null ? s.s : Math.min(p.first, s.s); p.last = p.last == null ? end : Math.max(p.last, end);
      p.cams[s.cam] = (p.cams[s.cam] || 0) + (end - s.s); p.camBlocks[s.cam] = (p.camBlocks[s.cam] || 0) + 1;
      // per uur opdelen
      let t = s.s;
      while (t < end) {
        const d = new Date(t), h = d.getHours();
        const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1).getTime();
        const part = Math.min(end, next) - t;
        p.hours[h] += part;
        const k = U.dayKey(t);
        p.byDay[k] = (p.byDay[k] || 0) | (1 << h);
        t += part;
      }
    }
    for (const k of Object.keys(p.byDay)) {
      const [y, m, d] = k.split("-").map(Number), row = dow(new Date(y, m - 1, d).getTime());
      for (let h = 0; h < 24; h++) if (p.byDay[k] & (1 << h)) p.grid[row][h]++;
    }
    p.days = Object.keys(p.byDay).length;
    return p;
  }
  // op hoeveel dagen was deze persoon te zien rond dit uur (uur ervoor, het uur zelf, uur erna)
  function daysAround(p, hour) {
    const mask = (1 << ((hour + 23) % 24)) | (1 << hour) | (1 << ((hour + 1) % 24));
    let n = 0;
    for (const k of Object.keys(p.byDay)) if (p.byDay[k] & mask) n++;
    return n;
  }
  // Nieuwe waarneming tegen het patroon van vóór die waarneming.
  // a: { sighting: { cam, s }, profile, type, camAgeMs }  -> [{ kind: HOUR | NIGHT | CAMERA, w, text }]
  function checkSighting(a) {
    const p = a.profile, s = a.sighting, out = [];
    if (!p || p.days < MIN_DAYS || p.blocks < MIN_BLOCKS) return out;
    const h = new Date(s.s).getHours(), share = daysAround(p, h) / p.days;
    if (share < 0.1) out.push({ kind: "HOUR", w: share === 0 ? 0.12 : 0.06, text: `UNUSUAL HOUR // ${hhmm(s.s)} // SEEN AT THIS HOUR ON ${daysAround(p, h)} OF ${p.days} DAYS` });
    if (h >= NIGHT_FROM && h < NIGHT_TO && share < 0.3 && !TRUSTED.has(a.type)) out.push({ kind: "NIGHT", w: 0.08, text: `NIGHT ACTIVITY // ${hhmm(s.s)}` });
    if (a.camAgeMs != null && a.camAgeMs >= CAM_MIN_AGE && !p.camBlocks[s.cam])
      out.push({ kind: "CAMERA", w: 0.08, text: `UNUSUAL LOCATION // ${s.cam} // NEVER SEEN HERE IN ${p.blocks} SIGHTINGS` });
    return out;
  }
  // blijft iemand zonder vertrouwde rol lang op één camera hangen: stap 1 na 3 min, stap 2 na 10 min
  function loiter(ms, type) {
    if (NO_LOITER.has(type) || ms < LOITER_1) return null;
    const step = ms >= LOITER_2 ? 2 : 1;
    return { kind: "LOITER", step, w: step === 2 ? 0.18 : 0.1, text: `LOITERING // ${Math.floor(ms / U.MIN)} MIN` };
  }
  // Wanneer stond The Machine aan: { dag: uurmasker }. Nodig om "niet gezien" te onderscheiden van "niet gekeken".
  function markUp(up, ts) {
    const k = U.dayKey(ts);
    up[k] = (up[k] || 0) | (1 << new Date(ts).getHours());
    const keys = Object.keys(up).sort();
    while (keys.length > UP_KEEP_DAYS) delete up[keys.shift()];
    return up;
  }
  const upAt = (up, ts) => !!((up[U.dayKey(ts)] || 0) & (1 << new Date(ts).getHours()));
  // Gemiste routine: in het uur dat net voorbij is was deze persoon op minstens 3 van de laatste 4 zelfde weekdagen
  // te zien (terwijl de Machine toen aan stond), en vandaag in dat uur niet (terwijl de Machine nu ook aan stond).
  function missedRoutine(p, up, now) {
    if (!p || p.days < MIN_DAYS) return null;
    const d = new Date(now), slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() - 1).getTime();
    const hour = new Date(slot).getHours(), bit = 1 << hour;
    if (!upAt(up, slot) || (p.byDay[U.dayKey(slot)] || 0) & bit) return null;
    let watched = 0, seen = 0;
    for (let w = 1; w <= 4; w++) {
      const sd = new Date(slot); sd.setDate(sd.getDate() - 7 * w);
      const t = sd.getTime();
      if (!upAt(up, t)) continue;
      watched++;
      if ((p.byDay[U.dayKey(t)] || 0) & bit) seen++;
    }
    if (seen < 3 && !(watched === 2 && seen === 2)) return null;
    const day = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][dow(slot)];
    return { kind: "ABSENT", w: 0.05, hour, slot, text: `ROUTINE BREAK // NOT SEEN ${day} ${U.pad2(hour)}:00-${U.pad2((hour + 1) % 24)}:00 // PRESENT ${seen} OF LAST ${watched} ${day}S` };
  }
  // Drukte: hoeveel verschillende bekende / onbekende subjecten per tijdvak, en hoeveel daarvan met een THREAT-tag
  function activity(sightings, unknowns, from, to, buckets) {
    const size = (to - from) / buckets, out = [];
    for (let i = 0; i < buckets; i++) out.push({ t0: from + i * size, t1: from + (i + 1) * size, k: new Set(), u: new Set(), th: new Set() });
    const add = (s, id, key) => {
      if (s.e < from || s.s >= to) return;
      const a = Math.max(0, Math.floor((s.s - from) / size)), b = Math.min(buckets - 1, Math.floor((Math.max(s.s, s.e - 1) - from) / size));
      for (let i = a; i <= b; i++) { out[i][key].add(id); if (key === "k" && /THREAT/.test(s.type || "")) out[i].th.add(id); }
    };
    for (const s of sightings) add(s, s.pid, "k");
    for (const s of unknowns || []) add(s, s.no, "u");
    return out.map(b => ({ t0: b.t0, t1: b.t1, known: b.k.size, unknown: b.u.size, threat: b.th.size }));
  }

  C.patterns = { MIN_DAYS, MIN_BLOCKS, UP_KEEP_DAYS, TRUSTED, profile, daysAround, checkSighting, loiter, markUp, upAt, missedRoutine, activity };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
