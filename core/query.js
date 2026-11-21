// THE MACHINE // CORE: vragen aan het geheugen.
// facts()    = korte lijst echte feiten (wie, waar, wanneer) die als context naar het taalmodel gaat, zodat de Machine
//              antwoordt met wat ze werkelijk heeft gezien in plaats van te verzinnen.
// briefing() = vast situatierapport, werkt ook zonder taalmodel.
// De aanroeper geeft alleen mee wat de vrager mag zien (world.people, events, cases, numbers zijn al gefilterd);
// tijdlijnblokken van mensen die niet in world.people staan worden hier genegeerd.
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const U = C.util;
  const MAX_FACTS = 2200;
  const hm = ts => { const d = new Date(ts); return `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`; };
  const dm = ts => { const d = new Date(ts); return `${U.pad2(d.getDate())}/${U.pad2(d.getMonth() + 1)}`; };
  const agoTxt = ms => ms < 90000 ? "just now" : ms < U.HOUR ? `${Math.round(ms / U.MIN)} min ago` : ms < 2 * U.DAY ? `${Math.round(ms / U.HOUR)} h ago` : `${Math.round(ms / U.DAY)} days ago`;
  const defName = p => p.type === "ADMIN" && (!p.name || p.name === "admin") ? "ADMIN" : String(p.name || p.type).toUpperCase();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // tijdvak uit de vraag (Engels en Nederlands), of null
  function parseWindow(q, now) {
    const s = String(q || "").toLowerCase(), day = U.startOfDay(now), h = n => day + n * U.HOUR;
    let m;
    if ((m = /(?:last|past|afgelopen|laatste)\s+(\d{1,3})\s*(hours?|uren|uur|days?|dagen|dag|minutes?|minuten|min)/.exec(s))) {
      const unit = /^(h|u)/.test(m[2]) ? U.HOUR : /^d/.test(m[2]) ? U.DAY : U.MIN, n = Math.max(1, +m[1]);
      return { from: now - n * unit, to: now, label: `LAST ${n} ${unit === U.HOUR ? "HOUR" : unit === U.DAY ? "DAY" : "MINUTE"}${n === 1 ? "" : "S"}` };
    }
    if (/last night|vannacht|afgelopen nacht|vorige nacht/.test(s)) return { from: h(-2), to: Math.min(now, h(6)), label: "LAST NIGHT" };
    if (/last hour|past hour|afgelopen uur|laatste uur/.test(s)) return { from: now - U.HOUR, to: now, label: "LAST HOUR" };
    if (/this morning|vanochtend|vanmorgen/.test(s)) return { from: h(6), to: Math.min(now, h(12)), label: "THIS MORNING" };
    if (/this afternoon|vanmiddag/.test(s)) return { from: h(12), to: Math.min(now, h(18)), label: "THIS AFTERNOON" };
    if (/this evening|tonight|vanavond/.test(s)) return { from: h(18), to: Math.min(now, h(24)), label: "THIS EVENING" };
    if (/yesterday|gisteren/.test(s)) return { from: h(-24), to: day, label: "YESTERDAY" };
    if (/this week|deze week|past week|last week|afgelopen week|vorige week/.test(s)) return { from: now - 7 * U.DAY, to: now, label: "THIS WEEK" };
    if (/today|vandaag/.test(s)) return { from: day, to: now, label: "TODAY" };
    return null;
  }
  // welke bekende mensen worden in de vraag genoemd (hele woorden; nummer met of zonder #)
  function findPeople(q, people) {
    const s = String(q || "").toLowerCase(), out = [];
    if (!s) return out;
    for (const p of people) {
      const names = [p.name, p.nr, p.type === "ADMIN" ? "admin" : null].filter(Boolean).map(x => String(x).toLowerCase());
      if (names.some(n => new RegExp(`(^|[^a-z0-9])#?${esc(n)}($|[^a-z0-9])`).test(s))) out.push(p);
    }
    return out;
  }
  function seenIn(w, from, to, name) {
    const ok = new Map(w.people.map(p => [p.id, p])), by = new Map();
    for (const s of w.sightings) {
      const p = ok.get(s.pid);
      if (!p || s.e < from || s.s > to) continue;
      const x = by.get(p.id) || { p, s: s.s, e: s.e, cams: new Set(), n: 0 };
      x.s = Math.min(x.s, s.s); x.e = Math.max(x.e, s.e); x.cams.add(s.cam); x.n++;
      by.set(p.id, x);
    }
    return [...by.values()].sort((a, b) => a.s - b.s).map(x => `${name(x.p)} (${x.p.type}) ${hm(Math.max(x.s, from))}-${hm(Math.min(x.e, to))} at ${[...x.cams].join(", ")}${x.n > 1 ? `, ${x.n} sightings` : ""}`);
  }
  function personFacts(w, p, name) {
    const bits = [], a = w.byId[p.id], now = w.now;
    let last = null; for (const s of w.sightings) if (s.pid === p.id && (!last || s.e > last.e)) last = s;
    if (w.present && w.present.has(p.id) && last) bits.push(`in view now at ${last.cam}`);
    else if (last) bits.push(`last seen ${agoTxt(now - last.e)} (${dm(last.s)} ${hm(last.s)}-${hm(last.e)}) at ${last.cam}`);
    else bits.push("never seen on camera");
    if (a) {
      if (!a.trusted) bits.push(`threat ${Math.round(a.score)}% ${a.level}${a.factors.length ? ` because of ${a.factors.slice(0, 3).map(f => f.label).join(", ")}` : ""}`);
      if (a.risk >= 10) bits.push(`risk of becoming a victim ${Math.round(a.risk)}%${a.riskFactors.length ? ` because of ${a.riskFactors.slice(0, 2).map(f => f.label).join(", ")}` : ""}`);
      if (a.role && a.role !== "NONE") bits.push(`likely role ${a.role}`);
    }
    const n = (w.numbers || []).find(x => x.pid === p.id && x.status === "ACTIVE");
    if (n) bits.push(`active number ${n.ssn} on the ${n.list} list`);
    const cs = (w.cases || []).filter(c => c.status === "OPEN" && (c.pids || []).includes(p.id));
    if (cs.length) bits.push(`open case #${String(cs[0].nr).padStart(4, "0")} ${cs[0].kind}`);
    const ok = new Map(w.people.map(x => [x.id, x])), ln = [];
    for (const k of Object.keys(w.links || {})) {
      const [x, y] = k.split("|"), o = x === p.id ? ok.get(y) : y === p.id ? ok.get(x) : null, l = w.links[k];
      if (o && (l.n || l.rel)) ln.push({ o, l });
    }
    if (ln.length) bits.push(`connections: ${ln.sort((x, y) => (y.l.n || 0) - (x.l.n || 0)).slice(0, 3).map(x => `${name(x.o)}${x.l.rel ? ` (${x.l.rel})` : ""}${x.l.n ? ` seen together ${x.l.n}x` : ""}`).join("; ")}`);
    const prof = C.patterns.profile(w.sightings, p.id);
    if (prof.days >= C.patterns.MIN_DAYS) {
      const hrs = prof.hours.map((v, h) => [v, h]).sort((x, y) => y[0] - x[0]).slice(0, 3).filter(x => x[0] > 0).map(x => x[1]).sort((x, y) => x - y);
      bits.push(`usually seen around ${hrs.map(h => U.pad2(h) + ":00").join(", ")} (${prof.days} days observed)`);
    }
    return `- ${name(p)} (${p.type}): ${bits.join("; ")}.`;
  }
  // opts: { question, name(p) }  -> tekst voor de systeemprompt
  function facts(w, opts) {
    const name = opts && opts.name || defName, q = opts && opts.question || "", now = w.now, lines = [];
    lines.push("Facts from your own surveillance memory. They are true: use them to answer. If the answer is not in these facts, say that you have no record of it.");
    const act = (w.numbers || []).filter(n => n.status === "ACTIVE"), open = (w.cases || []).filter(c => c.status === "OPEN");
    lines.push(`- Status: threat level ${w.level.tl} (${w.level.pct}%)${w.level.reasons && w.level.reasons[0] ? `, reason: ${w.level.reasons[0]}` : ""}. Active numbers: ${act.length}${act.length ? ` (${act.filter(n => n.list === "RELEVANT").length} relevant)` : ""}. Open cases: ${open.length}.`);
    if (!w.people.length) { lines.push("- No registered subjects yet. Insufficient data."); return lines.join("\n"); }
    const here = w.people.filter(p => w.present && w.present.has(p.id)).map(p => {
      let last = null; for (const s of w.sightings) if (s.pid === p.id && (!last || s.e > last.e)) last = s;
      return `${name(p)} at ${last ? last.cam : "camera"}`; });
    lines.push(`- In view right now: ${here.join(", ") || "no registered subjects"}.`);
    for (const n of act.slice(0, 4)) { const p = w.people.find(x => x.id === n.pid); if (p) lines.push(`- Number ${n.ssn}: ${name(p)}, ${n.role}, ${n.list} list, threat ${Math.round(n.score)}%, risk ${Math.round(n.risk)}%.`); }
    const named = findPeople(q, w.people).slice(0, 3);
    for (const p of named) lines.push(personFacts(w, p, name));
    const win = parseWindow(q, now);
    const evLine = e => `${dm(e.ts)} ${hm(e.ts)} ${e.cat}: ${e.text}`;
    if (win) {
      const seen = seenIn(w, win.from, win.to, name), unk = new Set((w.unknowns || []).filter(u => u.e >= win.from && u.s <= win.to).map(u => u.no)).size;
      lines.push(`- Seen ${win.label} (${dm(win.from)} ${hm(win.from)} to ${dm(win.to)} ${hm(win.to)}): ${seen.slice(0, 12).join("; ") || "no registered subjects"}${seen.length > 12 ? `; and ${seen.length - 12} more` : ""}. Unknown subjects: ${unk}.`);
      const ev = (w.events || []).filter(e => e.ts >= win.from && e.ts <= win.to && e.sev >= 1 && (!named.length || named.some(p => p.id === e.pid))).slice(-8);
      if (ev.length) lines.push(`- Events ${win.label}: ${ev.map(evLine).join(" | ")}`);
    } else {
      const ev = (w.events || []).filter(e => e.sev >= 1 && (!named.length || named.some(p => p.id === e.pid))).slice(-6);
      if (ev.length) lines.push(`- Recent events: ${ev.map(evLine).join(" | ")}`);
    }
    let out = lines.join("\n");
    if (out.length > MAX_FACTS) out = out.slice(0, MAX_FACTS - 3) + "...";
    return out;
  }

  const TXT = {
    en: { title: "SITUATION REPORT", level: "THREAT LEVEL", numbers: "NUMBERS", active: "ACTIVE", relevant: "RELEVANT", cases: "CASES", open: "OPEN", inView: "IN VIEW", nobody: "NO SUBJECTS",
          day: "LAST 24 HOURS", known: "KNOWN", unknown: "UNKNOWN", events: "EVENTS", alerts: "ALERTS", dev: "DEVIATIONS", soi: "SUBJECTS OF INTEREST", verdict: "ASSESSMENT", none: "NONE",
          nodata: "INSUFFICIENT DATA // NO REGISTERED SUBJECTS. LOOK INTO THE CAMERA AND TYPE /admin, THEN /tag.",
          v3: "IMMEDIATE ATTENTION REQUIRED.", v2: "HEIGHTENED VIGILANCE ADVISED.", v1: "MONITORING. NO ACTION REQUIRED.", cams: "CAMERAS" },
    nl: { title: "SITUATIERAPPORT", level: "DREIGINGSNIVEAU", numbers: "NUMMERS", active: "ACTIEF", relevant: "RELEVANT", cases: "ZAKEN", open: "OPEN", inView: "IN BEELD", nobody: "GEEN SUBJECTEN",
          day: "AFGELOPEN 24 UUR", known: "BEKEND", unknown: "ONBEKEND", events: "GEBEURTENISSEN", alerts: "ALARMEN", dev: "AFWIJKINGEN", soi: "SUBJECTEN VAN BELANG", verdict: "OORDEEL", none: "GEEN",
          nodata: "TE WEINIG GEGEVENS // GEEN GEREGISTREERDE SUBJECTEN. KIJK IN DE CAMERA EN TYP /admin, DAARNA /tag.",
          v3: "DIRECTE AANDACHT VEREIST.", v2: "VERHOOGDE WAAKZAAMHEID GEADVISEERD.", v1: "BEWAKING LOOPT. GEEN ACTIE NODIG.", cams: "CAMERA'S" },
  };
  // opts: { lang, name(p) }  -> regels
  function briefing(w, opts) {
    const T = TXT[opts && opts.lang] || TXT.en, name = opts && opts.name || defName, now = w.now, d = new Date(now), L = [];
    const ok = new Map(w.people.map(p => [p.id, p]));
    L.push(`${T.title} // ${U.pad2(d.getDate())}/${U.pad2(d.getMonth() + 1)}/${d.getFullYear()} ${hm(now)}`);
    L.push(`${T.level}: ${w.level.tl} (${w.level.pct}%)${w.level.reasons && w.level.reasons[0] ? " // " + w.level.reasons[0] : ""}`);
    if (!w.people.length) { L.push(T.nodata); return L; }
    const act = (w.numbers || []).filter(n => n.status === "ACTIVE" && ok.has(n.pid)), rel = act.filter(n => n.list === "RELEVANT").length;
    L.push(`${T.numbers}: ${act.length} ${T.active}${act.length ? ` (${rel} ${T.relevant})` : ""}`);
    for (const n of act.slice(0, 5)) L.push(`  ${n.ssn}  ${name(ok.get(n.pid))}  ${n.role}  ${n.list}`);
    const open = (w.cases || []).filter(c => c.status === "OPEN");
    L.push(`${T.cases}: ${open.length} ${T.open}`);
    for (const c of open.slice(0, 4)) L.push(`  #${String(c.nr).padStart(4, "0")}  ${c.kind}  ${(c.pids || []).filter(id => ok.has(id)).map(id => name(ok.get(id))).slice(0, 2).join(", ") || "UNIDENTIFIED"}  ${agoTxt(now - c.e).toUpperCase()}`);
    const here = w.people.filter(p => w.present && w.present.has(p.id)).map(name);
    const unkNow = new Set((w.unknowns || []).filter(u => now - u.e < 20000).map(u => u.no)).size;
    L.push(`${T.inView}: ${[...here, ...(unkNow ? [`${unkNow} ${T.unknown}`] : [])].join(", ") || T.nobody}${w.cams && w.cams.length ? ` // ${w.cams.length} ${T.cams}` : ""}`);
    const from = now - U.DAY, known = new Set(w.sightings.filter(s => s.e >= from && ok.has(s.pid)).map(s => s.pid)).size;
    const unk = new Set((w.unknowns || []).filter(u => u.e >= from).map(u => u.no)).size, ev = (w.events || []).filter(e => e.ts >= from);
    L.push(`${T.day}: ${known} ${T.known}, ${unk} ${T.unknown}, ${ev.length} ${T.events} (${ev.filter(e => e.sev >= 3).length} ${T.alerts})`);
    const dev = ev.filter(e => e.cat === "ANOMALY").slice(-4);
    L.push(`${T.dev}: ${dev.length ? "" : T.none}`);
    for (const e of dev) L.push(`  ${hm(e.ts)}  ${e.text}`);
    const top = w.people.map(p => ({ p, a: w.byId[p.id] })).filter(x => x.a && Math.max(x.a.score, x.a.risk) >= 25).sort((x, y) => Math.max(y.a.score, y.a.risk) - Math.max(x.a.score, x.a.risk)).slice(0, 4);
    L.push(`${T.soi}: ${top.length ? "" : T.none}`);
    for (const { p, a } of top) L.push(`  ${name(p)}  ${p.type}  ${a.score >= a.risk ? `THREAT ${Math.round(a.score)}% ${a.level}` : `RISK ${Math.round(a.risk)}% ${a.riskLevel}`}${a.role !== "NONE" ? "  " + a.role : ""}`);
    const hot = rel > 0 || w.level.tl === "CRITICAL" || (w.level.tl === "HIGH" && open.length > 0);
    L.push(`${T.verdict}: ${hot ? T.v3 : act.length || open.length || w.level.tl !== "LOW" ? T.v2 : T.v1}`);
    return L;
  }

  C.query = { MAX_FACTS, parseWindow, findPeople, facts, briefing };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
