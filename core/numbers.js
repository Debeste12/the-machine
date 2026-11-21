// THE MACHINE // CORE: de nummers.
// The Machine geeft een nummer af als iemand gevaar vormt (PERPETRATOR) of gevaar loopt (VICTIM), en er ook echt
// iets kan gebeuren: de persoon is kort geleden gezien. Eén actief nummer per persoon.
// state: { seq, list: [{ seq, pid, ssn, status, list, role, score, risk, peak, why[], issuedAt, updatedAt,
//                        belowSince, resolvedAt, reason, closedBy, closeScore, history[{ ts, text }] }] }
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const U = C.util;
  const ISSUE_SCORE = 60, ISSUE_RISK = 50;        // afgeven vanaf deze dreiging of dit risico
  const CLEAR = 35, CLEAR_MS = 24 * U.HOUR;       // vanzelf opgelost als beide zo lang onder deze waarde blijven
  const RECENT_MS = 24 * U.HOUR;                  // "kort geleden gezien"
  const IDLE_MS = 7 * U.DAY;                      // zo lang niet gezien: nummer vervalt
  const COOLDOWN_MS = 7 * U.DAY, COOLDOWN_RISE = 10;   // na met de hand sluiten: rust, tenzij de score duidelijk stijgt
  const KEEP = 200, HISTORY = 20;

  const empty = () => ({ seq: 0, list: [] });
  const forPid = (st, pid) => st.list.find(n => n.pid === pid && n.status === "ACTIVE") || null;
  const active = st => st.list.filter(n => n.status === "ACTIVE")
    .sort((a, b) => (a.list === b.list ? 0 : a.list === "RELEVANT" ? -1 : 1) || Math.max(b.score, b.risk) - Math.max(a.score, a.risk) || a.seq - b.seq);
  const note = (n, ts, text) => { n.history.push({ ts, text }); if (n.history.length > HISTORY) n.history.splice(1, n.history.length - HISTORY); };
  const why = a => (a.role === "VICTIM" ? a.riskFactors || [] : a.role === "PERPETRATOR" ? a.factors || [] : [...(a.factors || []), ...(a.riskFactors || [])])
    .slice().sort((x, y) => y.w - x.w).slice(0, 3).map(f => f.key);
  function roleOf(a) {
    if (a.role && a.role !== "NONE") return a.role;
    return a.score >= ISSUE_SCORE ? "PERPETRATOR" : "VICTIM";
  }
  function resolve(n, now, reason, by) {
    n.status = "RESOLVED"; n.resolvedAt = now; n.reason = reason; n.updatedAt = now;
    if (by) n.closedBy = by;
    n.closeScore = Math.max(n.score, n.risk);
    note(n, now, "RESOLVED // " + reason);
  }

  // ctx: { now, people, byId (uit threat.assessAll), memory, inView? }  ->  { issued, resolved, changed }
  function update(st, ctx) {
    const now = ctx.now, out = { issued: [], resolved: [], changed: [] };
    const ppl = new Set((ctx.people || []).map(p => p.id)), inView = new Set(ctx.inView || []);
    const lastSeen = pid => inView.has(pid) ? now : ((ctx.memory || {})[pid] || {}).lastSeen || 0;
    // 1: lopende nummers bijwerken of oplossen
    for (const n of st.list) {
      if (n.status !== "ACTIVE") continue;
      const a = (ctx.byId || {})[n.pid];
      if (!ppl.has(n.pid) || !a) { resolve(n, now, "PROFILE REMOVED"); out.resolved.push(n); continue; }
      n.score = a.score; n.risk = a.risk; n.peak = Math.max(n.peak, a.score, a.risk); n.updatedAt = now;
      if (Math.max(a.score, a.risk) < CLEAR) { if (n.belowSince == null) n.belowSince = now; } else n.belowSince = null;
      if (n.belowSince != null && now - n.belowSince >= CLEAR_MS) { resolve(n, now, "THREAT SUBSIDED"); out.resolved.push(n); continue; }
      const seen = Math.max(lastSeen(n.pid), n.issuedAt);
      if (now - seen >= IDLE_MS) { resolve(n, now, "SUBJECT INACTIVE"); out.resolved.push(n); continue; }
      if (Math.max(a.score, a.risk) >= CLEAR) {
        const role = roleOf(a), list = a.relevant ? "RELEVANT" : "IRRELEVANT";
        if (role !== n.role || list !== n.list) {
          note(n, now, `${n.role} / ${n.list} -> ${role} / ${list}`);
          n.role = role; n.list = list; out.changed.push(n);
        }
        n.why = why(a);
      }
    }
    // 2: nieuwe nummers
    for (const pid of ppl) {
      const a = (ctx.byId || {})[pid];
      if (!a || (a.score < ISSUE_SCORE && a.risk < ISSUE_RISK) || forPid(st, pid)) continue;
      if (now - lastSeen(pid) > RECENT_MS) continue;
      const prev = st.list.filter(n => n.pid === pid && n.closedBy).pop();
      if (prev && now - prev.resolvedAt < COOLDOWN_MS && Math.max(a.score, a.risk) < prev.closeScore + COOLDOWN_RISE) continue;
      const n = { seq: ++st.seq, pid, ssn: U.ssnFor(pid), status: "ACTIVE", list: a.relevant ? "RELEVANT" : "IRRELEVANT", role: roleOf(a),
        score: a.score, risk: a.risk, peak: Math.max(a.score, a.risk), why: why(a), issuedAt: now, updatedAt: now, belowSince: null, history: [] };
      note(n, now, `ISSUED // ${n.role} // ${n.list}`);
      st.list.push(n); out.issued.push(n);
    }
    // 3: opslag begrenzen: oudste opgeloste nummers eerst weg
    while (st.list.length > KEEP) {
      const i = st.list.findIndex(n => n.status !== "ACTIVE");
      if (i < 0) break;
      st.list.splice(i, 1);
    }
    return out;
  }
  // met de hand sluiten (ADMIN); geeft het nummer terug, of null als het niet bestaat of al gesloten is
  function close(st, seq, by, reason, now) {
    const n = st.list.find(x => x.seq === seq);
    if (!n || n.status !== "ACTIVE") return null;
    resolve(n, now, String(reason || "").trim().toUpperCase() || "CLOSED BY " + by, by);
    return n;
  }
  function sanitize(raw) {
    const st = empty();
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.list)) return st;
    for (const n of raw.list) {
      if (!n || typeof n.seq !== "number" || !n.pid || typeof n.issuedAt !== "number") continue;
      st.list.push({ list: "IRRELEVANT", role: "UNDETERMINED", score: 0, risk: 0, peak: 0, why: [], updatedAt: n.issuedAt, belowSince: null, ...n,
        status: n.status === "ACTIVE" ? "ACTIVE" : "RESOLVED", ssn: n.ssn || U.ssnFor(n.pid), history: Array.isArray(n.history) ? n.history : [] });
    }
    st.seq = Math.max(typeof raw.seq === "number" ? raw.seq : 0, ...st.list.map(n => n.seq), 0);
    return st;
  }

  C.numbers = { ISSUE_SCORE, ISSUE_RISK, CLEAR, CLEAR_MS, RECENT_MS, IDLE_MS, COOLDOWN_MS, KEEP, empty, update, close, active, forPid, sanitize };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
