// THE MACHINE // CORE: dreigingsanalyse per persoon.
// Elke factor levert een gewicht tussen 0 en 1; samen via noisy-OR: score = 100 * (1 - (1-w1)(1-w2)...).
// Twee uitkomsten per persoon:
//   score = hoe waarschijnlijk deze persoon zelf een dreiging is (dader)
//   risk  = hoe waarschijnlijk deze persoon gevaar loopt (slachtoffer)
// Emotie telt bewust niet mee (een boze blik maakt niemand een dreiging).
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const U = C.util;
  const BASE = { "THREAT TO SYSTEM": 0.85, THREAT: 0.70, "POTENTIAL THREAT": 0.50, "IRRELEVANT THREAT": 0.45, INDIGO: 0.10,
                 IRRELEVANT: 0.05, FRIENDLY: 0.02, ASSET: 0.01, "ANALOG INTERFACE": 0, ADMIN: 0 };
  const TRUSTED = new Set(["ADMIN", "ANALOG INTERFACE", "ASSET"]);      // kunnen zelf geen dreiging zijn (NEVER_THREAT in index.html)
  const W = {
    weaponConfirmed: 0.60, weaponSuspected: 0.30, weaponHalf: 14 * U.DAY,
    caseOpen: 0.35, caseClosed: 0.20, caseHalf: 30 * U.DAY, bystanderOpen: 0.30, bystanderClosed: 0.15,
    violation: 0.15, violationHalf: 7 * U.DAY, violationMax: 0.40,
    deviationDays: 7 * U.DAY, deviationHalf: 3 * U.DAY, deviationMax: 0.30,
    assoc: 0.35, assocMin: 25, exposure: 0.50, exposureMin: 40, linkHalf: 30 * U.DAY, relStrength: 0.6,
    targetedAdmin: 0.45, targetedOther: 0.30, targetedHalf: 12 * U.HOUR,
    roleMin: 25, roleRatio: 1.25,
  };
  const BEHAVIOUR = new Set(["HOUR", "NIGHT", "CAMERA", "LOITER"]);     // afwijkingen die bij de dader-score horen
  const EXPOSED = new Set(["CONTACT", "ABSENT"]);                       // afwijkingen die bij het risico horen
  const caseNr = n => "#" + String(n).padStart(4, "0");
  const agoTxt = ms => ms < U.HOUR ? `${Math.max(1, Math.round(ms / U.MIN))} MIN AGO` : ms < 2 * U.DAY ? `${Math.round(ms / U.HOUR)} HR AGO` : `${Math.round(ms / U.DAY)} D AGO`;
  const nm = p => p.type === "ADMIN" && (!p.name || p.name === "admin") ? "ADMIN" : String(p.name || p.type).toUpperCase();
  const top = (list, n) => list.sort((a, b) => b.w - a.w).slice(0, n);

  // hoe sterk is de band tussen twee mensen (0..1): vaak en recent samen gezien, of een ingevulde relatie
  function linkStrength(l, now) {
    const co = l.n ? Math.min(1, Math.log2(1 + l.n) / 4) * U.decay(now - (l.last || now), W.linkHalf) : 0;
    return l.rel ? Math.max(W.relStrength, co) : co;
  }

  // eigen factoren (zonder netwerk)
  function intrinsic(p, w, idx) {
    const now = w.now, f = [];
    const base = BASE[p.type] != null ? BASE[p.type] : BASE.IRRELEVANT;
    if (base > 0) f.push({ key: "CLASSIFICATION", label: "CLASSIFICATION", w: base, detail: p.type });
    const weapons = ((w.memory[p.id] || {}).weapons || []).map(x => ({
      w: (x.level === "THREAT" ? W.weaponConfirmed : W.weaponSuspected) * U.decay(now - x.ts, W.weaponHalf), x }));
    if (weapons.length) {
      const best = top(weapons, 3), b = best[0].x;
      f.push({ key: "WEAPON", label: "WEAPON HISTORY", w: U.noisyOr(best.map(x => x.w)),
        detail: `${b.label || "WEAPON"} ${b.level === "THREAT" ? "CONFIRMED" : "SUSPECTED"} ${agoTxt(now - b.ts)}${weapons.length > 1 ? ` // ${weapons.length} INCIDENTS` : ""}` });
    }
    const prim = (idx.casesOf[p.id] || []).filter(c => c.pids[0] === p.id).map(c => ({
      w: c.status === "OPEN" ? W.caseOpen : W.caseClosed * U.decay(now - (c.closedAt || c.e || now), W.caseHalf), c }));
    if (prim.length) {
      const best = top(prim, 3), open = prim.filter(x => x.c.status === "OPEN").length;
      f.push({ key: "CASES", label: "CASE INVOLVEMENT", w: U.noisyOr(best.map(x => x.w)),
        detail: `PRIMARY SUBJECT IN ${prim.length} CASE${prim.length > 1 ? "S" : ""}${open ? ` // ${open} OPEN` : ""} // ${caseNr(best[0].c.nr)} ${best[0].c.kind}` });
    }
    const den = (idx.eventsOf[p.id] || []).filter(e => e.cat === "ACCESS" && e.kind === "DENIED");
    if (den.length) {
      const v = Math.min(W.violationMax, U.noisyOr(den.map(e => W.violation * U.decay(now - e.ts, W.violationHalf))));
      if (v > 0.005) f.push({ key: "VIOLATIONS", label: "ACCESS VIOLATIONS", w: v, detail: `${den.length} DENIED COMMAND${den.length > 1 ? "S" : ""} // LAST ${agoTxt(now - den[den.length - 1].ts)}` });
    }
    const dev = (idx.eventsOf[p.id] || []).filter(e => e.cat === "ANOMALY" && BEHAVIOUR.has(e.kind) && now - e.ts <= W.deviationDays);
    if (dev.length) {
      const v = Math.min(W.deviationMax, U.noisyOr(dev.map(e => (e.w || 0.05) * U.decay(now - e.ts, W.deviationHalf))));
      const kinds = [...new Set(dev.map(e => ({ HOUR: "UNUSUAL HOUR", NIGHT: "NIGHT ACTIVITY", CAMERA: "UNUSUAL LOCATION", LOITER: "LOITERING" })[e.kind]))];
      if (v > 0.005) f.push({ key: "DEVIATIONS", label: "BEHAVIOURAL DEVIATIONS", w: v, detail: `${dev.length} IN 7 DAYS // ${kinds.join(", ")}` });
    }
    return f;
  }

  // w: { now, people, memory, sightings, links, cases, events }  ->  { byId: { pid: beoordeling }, at }
  function assessAll(w) {
    w = { people: [], memory: {}, links: {}, cases: [], events: [], ...w };
    const now = w.now, byId = {}, ppl = {};
    for (const p of w.people) ppl[p.id] = p;
    const idx = { casesOf: {}, eventsOf: {}, linksOf: {} };
    for (const c of w.cases) for (const id of c.pids || []) if (ppl[id] && ppl[(c.pids || [])[0]]) (idx.casesOf[id] = idx.casesOf[id] || []).push(c);
    for (const e of w.events) if (e.pid && ppl[e.pid]) (idx.eventsOf[e.pid] = idx.eventsOf[e.pid] || []).push(e);
    for (const k of Object.keys(w.links)) {
      const [a, b] = k.split("|"), l = w.links[k];
      if (!ppl[a] || !ppl[b]) continue;
      const s = linkStrength(l, now);
      if (s <= 0) continue;
      (idx.linksOf[a] = idx.linksOf[a] || []).push({ other: ppl[b], s, l });
      (idx.linksOf[b] = idx.linksOf[b] || []).push({ other: ppl[a], s, l });
    }
    // 1: eigen score van iedereen
    const own = {};
    for (const p of w.people) {
      const f = TRUSTED.has(p.type) ? [] : intrinsic(p, w, idx);
      own[p.id] = { f, v: U.noisyOr(f.map(x => x.w)) * 100 };
    }
    // 2: netwerk erbij (met de EIGEN score van de ander, zodat verdenking niet als kettingreactie doorloopt) en het risico
    for (const p of w.people) {
      const trusted = TRUSTED.has(p.type), f = own[p.id].f.slice(), rf = [], ls = idx.linksOf[p.id] || [];
      if (!trusted) {
        const as = top(ls.filter(x => own[x.other.id].v >= W.assocMin).map(x => ({ w: W.assoc * own[x.other.id].v / 100 * x.s, x })), 3);
        if (as.length) f.push({ key: "ASSOCIATION", label: "NETWORK ASSOCIATION", w: U.noisyOr(as.map(a => a.w)),
          detail: as.map(a => `${nm(a.x.other)} (${a.x.other.type})`).join(", ") });
      }
      const ex = top(ls.filter(x => own[x.other.id].v >= W.exposureMin).map(x => ({ w: W.exposure * own[x.other.id].v / 100 * x.s, x })), 3);
      if (ex.length) rf.push({ key: "EXPOSURE", label: "EXPOSURE TO THREAT", w: U.noisyOr(ex.map(a => a.w)),
        detail: ex.map(a => `${nm(a.x.other)}${a.x.l.n ? ` // TOGETHER ${a.x.l.n}X` : ""}${a.x.l.rel ? ` // ${String(a.x.l.rel).toUpperCase()}` : ""}`).join(", ") });
      const by = (idx.casesOf[p.id] || []).filter(c => c.pids[0] !== p.id).map(c => ({
        w: c.status === "OPEN" ? W.bystanderOpen : W.bystanderClosed * U.decay(now - (c.closedAt || c.e || now), W.caseHalf), c }));
      if (by.length) { const best = top(by, 3);
        rf.push({ key: "BYSTANDER", label: "PRESENT AT INCIDENT", w: U.noisyOr(best.map(x => x.w)), detail: `CASE ${caseNr(best[0].c.nr)} ${best[0].c.kind}${by.length > 1 ? ` +${by.length - 1}` : ""}` }); }
      const xp = (idx.eventsOf[p.id] || []).filter(e => e.cat === "ANOMALY" && EXPOSED.has(e.kind) && now - e.ts <= W.deviationDays);
      if (xp.length) { const v = Math.min(W.deviationMax, U.noisyOr(xp.map(e => (e.w || 0.05) * U.decay(now - e.ts, W.deviationHalf))));
        if (v > 0.005) rf.push({ key: "SIGNALS", label: "WARNING SIGNALS", w: v, detail: [...new Set(xp.map(e => e.kind === "CONTACT" ? "FIRST CONTACT WITH THREAT" : "ROUTINE BREAK"))].join(", ") }); }
      if (trusted) {
        // een THREAT TO SYSTEM die kort geleden is gezien, bedreigt de Machine en haar mensen
        const sys = w.people.filter(o => o.type === "THREAT TO SYSTEM" && (w.memory[o.id] || {}).lastSeen)
          .map(o => ({ w: (p.type === "ADMIN" ? W.targetedAdmin : W.targetedOther) * U.decay(now - w.memory[o.id].lastSeen, W.targetedHalf), o }));
        const best = top(sys, 2).filter(x => x.w > 0.005);
        if (best.length) rf.push({ key: "TARGETED", label: "THREAT TO SYSTEM ACTIVE", w: U.noisyOr(best.map(x => x.w)), detail: `${nm(best[0].o)} SEEN ${agoTxt(now - w.memory[best[0].o.id].lastSeen)}` });
      }
      f.sort((a, b) => b.w - a.w); rf.sort((a, b) => b.w - a.w);
      const r2 = x => Math.round(x * 100) / 100;
      const score = trusted ? 0 : r2(U.noisyOr(f.map(x => x.w)) * 100), risk = r2(U.noisyOr(rf.map(x => x.w)) * 100);
      let role = "NONE";
      if (Math.max(score, risk) >= W.roleMin) role = score >= risk * W.roleRatio ? "PERPETRATOR" : risk >= score * W.roleRatio ? "VICTIM" : "UNDETERMINED";
      const sum = score + risk;
      const relevant = p.type === "THREAT TO SYSTEM" || (trusted && role === "VICTIM") || (!trusted && role !== "VICTIM" && role !== "NONE" && ls.some(x => TRUSTED.has(x.other.type)));
      byId[p.id] = { pid: p.id, score, risk, level: U.levelOf(score), riskLevel: U.levelOf(risk), factors: trusted ? [] : f, riskFactors: rf,
        role, pPerp: sum ? score / sum : 0, pVictim: sum ? risk / sum : 0, relevant, trusted, own: U.round1(own[p.id].v) };
    }
    return { byId, at: now };
  }

  // Wat de omgeving bijdraagt aan het systeemniveau (0..1), los van de tags die nu in beeld staan:
  // de score van wie in beeld is, actieve nummers en cases met recente activiteit.
  function ambient(a) {
    let value = 0; const reasons = [];
    const up = (v, why) => { if (v > value) value = v; if (v > 0) reasons.push([v, why]); };
    for (const id of a.inView || []) { const s = a.byId[id]; if (s && s.score >= 25) up(0.9 * s.score / 100, `SUBJECT IN VIEW // THREAT ${Math.round(s.score)}%`); }
    const act = (a.numbers || []).filter(n => n.status === "ACTIVE");
    if (act.some(n => n.list === "RELEVANT")) up(0.4, `${act.filter(n => n.list === "RELEVANT").length} RELEVANT NUMBER ACTIVE`);
    else if (act.length) up(0.25, `${act.length} IRRELEVANT NUMBER${act.length > 1 ? "S" : ""} ACTIVE`);
    for (const c of a.cases || []) if (c.status === "OPEN" && a.now - c.e < 30 * U.MIN) up(0.35, `CASE ${caseNr(c.nr)} ACTIVE`);
    return { value, reasons: reasons.sort((x, y) => y[0] - x[0]).map(r => r[1]) };
  }

  C.threat = { BASE, TRUSTED, W, linkStrength, assessAll, ambient };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
