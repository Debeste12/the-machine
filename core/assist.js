// THE MACHINE // CORE: hulp bij het werken met The Machine.
// - terminal: commandogeschiedenis, aanvullen met Tab en "bedoelde je ...?" bij een tikfout;
// - verwachting: wie is er op dit uur meestal (uit de leefpatronen) en is die er nu ook;
// - terugblik: wat is er gebeurd terwijl je weg was;
// - volglijst: van wie wil je een melding zodra die in beeld komt.
// Alleen rekenen, geen scherm of opslag, zodat alles te testen is.
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const U = C.util, P = C.patterns;
  const HIST_MAX = 100;
  const SECRET = /^\/(sudo_admin|sudo|password|wachtwoord|suddo_admin|sude_admin)\b/i;   // nooit bewaren: daar kan een wachtwoord achter staan

  /* ---------- terminal ---------- */
  // voegt een regel toe aan de geschiedenis (nieuwste achteraan); geeft de nieuwe lijst terug
  function remember(list, line, max) {
    const s = String(line || "").trim(), out = (list || []).slice();
    if (!s || SECRET.test(s)) return out;
    const i = out.indexOf(s);
    if (i >= 0) out.splice(i, 1);                       // zelfde regel opnieuw: schuift naar achteren, geen dubbele
    out.push(s.slice(0, 300));
    return out.slice(-(max || HIST_MAX));
  }
  // bladeren: pos = null (nieuwe regel) of index; dir -1 = ouder, +1 = nieuwer -> { pos, text } (text null = terug naar wat je typte)
  function browse(list, pos, dir) {
    const n = (list || []).length;
    if (!n) return { pos: null, text: null };
    let p = pos == null ? n : pos;
    p += dir;
    if (p >= n) return { pos: null, text: null };
    if (p < 0) p = 0;
    return { pos: p, text: list[p] };
  }
  function distance(a, b) {                            // Levenshtein
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  // dichtstbijzijnde bestaande commando's bij een tikfout (hooguit 2 tekens ernaast, of een duidelijk begin)
  function suggest(cmd, commands) {
    const c = String(cmd || "").toLowerCase(), out = [];
    if (c.length < 2) return out;
    for (const k of new Set(commands || [])) {
      const d = distance(c, k);
      if (k !== c && (d <= (c.length <= 5 ? 1 : 2) || (c.length >= 4 && k.startsWith(c)))) out.push({ k, d: k.startsWith(c) ? Math.min(d, 1) : d });
    }
    return out.sort((x, y) => x.d - y.d || Math.abs(x.k.length - c.length) - Math.abs(y.k.length - c.length) || (x.k < y.k ? -1 : 1)).slice(0, 3).map(x => x.k);
  }
  // Tab: mogelijke aanvullingen voor wat er nu staat -> { list: [hele regels], common: langste gezamenlijke begin }
  // ctx: { commands: ["/tag", ...], names: ["viktor", ...], words: { "/mode": ["monitoring", ...] } }
  function complete(text, ctx) {
    const s = String(text || ""), cmds = [...new Set(ctx.commands || [])].sort();
    let list = [];
    if (!s.startsWith("/")) return { list, common: s };
    const sp = s.indexOf(" ");
    if (sp < 0) list = cmds.filter(c => c.startsWith(s.toLowerCase())).map(c => c + " ");
    else {
      const head = s.slice(0, s.lastIndexOf(" ") + 1), last = s.slice(head.length).toLowerCase(), cmd = s.slice(0, sp).toLowerCase();
      const first = head.trim() === s.slice(0, sp);     // we staan op het eerste argument
      const opts = first && ctx.words && ctx.words[cmd] ? ctx.words[cmd] : [];
      const pool = [...opts, ...(ctx.names || [])];
      list = [...new Set(pool.filter(w => w.toLowerCase().startsWith(last) && w.toLowerCase() !== last))].sort().map(w => head + w);
    }
    let common = list[0] || s;
    for (const l of list) { let i = 0; while (i < common.length && i < l.length && common[i].toLowerCase() === l[i].toLowerCase()) i++; common = common.slice(0, i); }
    return { list, common: list.length ? common : s };
  }

  /* ---------- verwachting ---------- */
  // Wie is er op dit uur van de dag meestal? Op minstens `min` (60%) van de dagen dat we hem zagen, bij minstens 5 dagen geschiedenis.
  // list: [{ id, profile }]  present: Set(id)  -> [{ id, share, days, here }] meest zekere eerst
  function expected(list, now, present, opts) {
    const min = opts && opts.min || 0.6, hour = new Date(now).getHours(), bit = 1 << hour, today = U.dayKey(now), out = [];
    for (const x of list || []) {
      const p = x.profile;
      if (!p || p.days < P.MIN_DAYS) continue;
      let seen = 0, days = 0;
      for (const k of Object.keys(p.byDay)) { if (k === today) continue; days++; if (p.byDay[k] & bit) seen++; }
      if (days < P.MIN_DAYS - 1 || seen / days < min) continue;
      const here = !!(present && present.has(x.id)) || !!((p.byDay[today] || 0) & bit);
      out.push({ id: x.id, share: seen / days, days, seen, here });
    }
    return out.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1));
  }

  /* ---------- terugblik ---------- */
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const hm = ts => { const d = new Date(ts); return `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`; };
  const span = ms => ms < U.HOUR ? `${Math.max(1, Math.round(ms / U.MIN))} MIN` : ms < U.DAY ? `${Math.floor(ms / U.HOUR)} H ${U.pad2(Math.round(ms % U.HOUR / U.MIN))} MIN` : `${Math.floor(ms / U.DAY)} D ${Math.floor(ms % U.DAY / U.HOUR)} H`;
  // w: { people, sightings, events, unknowns, numbers, up }  -> { lines, quiet }
  function recap(w, from, to, opts) {
    const name = opts && opts.name || (p => p.type === "ADMIN" ? "ADMIN" : String(p.name).toUpperCase());
    const ok = new Map((w.people || []).map(p => [p.id, p])), self = opts && opts.self;
    const long = to - from > 20 * U.HOUR, at = ts => (long ? DAYS[new Date(ts).getDay()] + " " : "") + hm(ts);   // langer dan een dag: de dag erbij
    const lines = [`WHILE YOU WERE AWAY // ${span(to - from)} // ${at(from)} - ${at(to)}`];
    let watched = 0, total = 0;
    for (let t = from; t <= to; t += U.HOUR) { total++; if (!w.up || P.upAt(w.up, t)) watched++; }
    if (w.up && watched < total) lines.push(watched ? `  WATCHING ${watched} OF ${total} HOURS // NO RECORD OF THE REST` : "  SYSTEM WAS OFFLINE // NO RECORD");
    const seen = new Map();
    for (const s of w.sightings || []) { if (s.e < from || s.s > to || !ok.has(s.pid) || s.pid === self) continue; const x = seen.get(s.pid) || { n: 0, first: s.s, cams: new Set() }; x.n++; x.cams.add(s.cam); x.first = Math.min(x.first, Math.max(from, s.s)); seen.set(s.pid, x); }
    const unk = new Set((w.unknowns || []).filter(u => u.e >= from && u.s <= to).map(u => u.no)).size;
    const ev = (w.events || []).filter(e => e.ts >= from && e.ts <= to), alerts = ev.filter(e => e.sev >= 3), warns = ev.filter(e => e.sev === 2);
    lines.push(`  SUBJECTS ${seen.size} KNOWN, ${unk} UNKNOWN // ${alerts.length} ALERT${alerts.length === 1 ? "" : "S"}, ${warns.length} WARNING${warns.length === 1 ? "" : "S"}`);
    for (const [pid, x] of [...seen].sort((a, b) => a[1].first - b[1].first).slice(0, 6)) lines.push(`  ${at(x.first)}  ${name(ok.get(pid))} // ${ok.get(pid).type} @ ${[...x.cams].slice(0, 2).join(", ")}${x.n > 1 ? ` (${x.n}X)` : ""}`);
    if (seen.size > 6) lines.push(`  ... AND ${seen.size - 6} MORE`);
    for (const e of alerts.concat(warns).sort((a, b) => a.ts - b.ts).slice(-6)) lines.push(`  ${at(e.ts)}  ${e.cat} // ${e.text}`);
    const quiet = !seen.size && !unk && !alerts.length && !warns.length;
    if (quiet) lines.push("  NOTHING TO REPORT.");
    return { lines, quiet, known: seen.size, unknown: unk, alerts: alerts.length, warnings: warns.length };
  }

  /* ---------- volglijst ---------- */
  // st = { ids: { pid: { since, by } } }
  function watchToggle(st, pid, on, now, by) {
    const ids = Object.assign({}, st && st.ids || {});
    const want = on == null ? !ids[pid] : !!on;
    if (want) ids[pid] = ids[pid] || { since: now, by: by || "" }; else delete ids[pid];
    return { ids };
  }
  const watched = (st, pid) => !!(st && st.ids && st.ids[pid]);
  function watchSanitize(raw, people) {
    const ok = new Set((people || []).map(p => p.id)), ids = {};
    if (raw && raw.ids && typeof raw.ids === "object") for (const k of Object.keys(raw.ids)) if (ok.has(k)) ids[k] = { since: +raw.ids[k].since || 0, by: String(raw.ids[k].by || "") };
    return { ids };
  }

  C.assist = { HIST_MAX, remember, browse, distance, suggest, complete, expected, recap, span, watchToggle, watched, watchSanitize };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
