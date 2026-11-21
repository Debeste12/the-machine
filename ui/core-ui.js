// THE MACHINE // CORE-UI: koppelt de rekenlogica (core/*.js) aan de app (index.html).
// Dit bestand houdt de toestand van de denklaag bij (gebeurtenissen, onbekenden, nummers, dreigingsverloop),
// vangt de haakjes uit index.html op (HOOK("naam", ...)) en rekent elke 2 seconden de dreigingsanalyse door.
// De andere ui-bestanden hangen hun pagina's en commando's aan MachineUI (pages, commands, listeners).
(function () {
  "use strict";
  const C = MachineCore, U = C.util, EV = C.events, SEV = EV.SEV, P = C.patterns, N = C.numbers;
  const KEY = { events: "machine.events", unknowns: "machine.unknowns", up: "machine.uptime", numbers: "machine.numbers",
                hist: "machine.threathist", camFirst: "machine.camfirst" };
  const UNK_KEEP = 800;                 // zoveel blokken van onbekenden bewaren
  const HIST_STEP = 5 * U.MIN, HIST_KEEP = 7 * 288;   // dreigingsverloop: elke 5 min een punt, 7 dagen
  const ARRIVAL_GAP = 5 * U.MIN;        // zo lang weg = opnieuw "aangekomen"
  const ANOM_REPEAT = 6 * U.HOUR;       // dezelfde afwijking voor dezelfde persoon hooguit zo vaak
  const FEED_SHOW = 6, FEED_MS = 45000; // ANALYSIS FEED: zoveel regels, zo lang zichtbaar
  const E = s => escapeHtml(String(s));

  const S = {
    events: EV.sanitize(store.get(KEY.events, [])),
    unknowns: (store.get(KEY.unknowns, []) || []).filter(u => u && typeof u.s === "number" && typeof u.e === "number" && u.cam),
    up: store.get(KEY.up, {}) || {},
    numbers: N.sanitize(store.get(KEY.numbers, null)),
    hist: (store.get(KEY.hist, []) || []).filter(h => Array.isArray(h) && h.length === 2),
    camFirst: store.get(KEY.camFirst, {}) || {},
    assessment: { byId: {}, at: 0 }, level: 0, levelMax: 0, tl: "LOW",
  };
  const dirty = {};                     // welke opslag moet weggeschreven worden
  const UI = window.MachineUI = { S, KEY, pages: {}, commands: {}, listeners: [], hourly: [], onStored: [] };
  // nummers van onbekenden lopen door over sessies heen, zodat UNKNOWN #3 van gisteren niet dezelfde lijkt als die van vandaag
  unknownNo = Math.max(unknownNo, ...S.unknowns.map(u => u.no || 0), 0);

  /* ---------- gebeurtenissen ---------- */
  function emit(cat, sev, text, extra) {
    const ev = EV.make(cat, sev, String(text).toUpperCase(), extra);
    if (!EV.push(S.events, ev)) return null;
    dirty.events = true;
    for (const f of UI.listeners) try { f(ev); } catch (e) { console.error("CORE // listener", e); }
    renderFeed();
    return ev;
  }
  // mag deze rol deze gebeurtenis zien? (zelfde regels als dossiers)
  const visible = (ev, role) => { const p = ev.pid && personById(ev.pid); return !p || mayViewFile(role, p); };
  const nameOf = pid => { const p = personById(pid); return p ? pName(p) : "FORGOTTEN"; };

  /* ---------- ANALYSIS FEED: wat The Machine opmerkt, als lopende regels op het beeld ---------- */
  const SEV_CLS = ["i", "n", "w", "a"];
  function renderFeed() {
    const el = $("afeed");
    if (!el) return;
    const now = Date.now(), role = currentRole();
    const list = EV.query(S.events, { from: now - FEED_MS, limit: FEED_SHOW, hide: e => e.kind === "GRANTED" || !visible(e, role) }).reverse();   // toegestane commando's staan alleen in het LOG
    const html = list.length ? `<div class="h">ANALYSIS FEED</div>` + list.map(e =>
      `<div class="r ${SEV_CLS[e.sev]}" style="opacity:${Math.max(.55, 1 - (now - e.ts) / FEED_MS * .6).toFixed(1)}"><span class="t">${new Date(e.ts).toLocaleTimeString("en-GB")}</span><span class="c">${e.cat}</span><span class="m">${E(e.text)}</span></div>`).join("") : "";
    if (html !== el._html) { el._html = html; el.innerHTML = html; }   // alleen tekenen als er iets veranderd is
  }
  setInterval(renderFeed, 1000);

  /* ---------- dreigingsanalyse ---------- */
  let lastAssess = 0, ambCache = null, ambAt = 0;
  function assess(force) {
    const now = Date.now();
    if (!force && now - lastAssess < 2000) return S.assessment;
    S.assessment = C.threat.assessAll({ now, people, memory, sightings, links, cases, events: S.events });
    lastAssess = now;
    return S.assessment;
  }
  const assessOf = pid => assess().byId[pid] || null;
  // wie is er nu te zien, op welke camera dan ook (lopende blokken van de tijdlijn)
  function presentIds() {
    const now = Date.now(), ids = new Set();
    for (const e of openSight.values()) if (now - e.e < SIGHT_GAP) ids.add(e.pid);
    return ids;
  }
  function ambient() {
    const now = Date.now();
    if (ambCache && now - ambAt < 1000) return ambCache;
    ambCache = C.threat.ambient({ now, inView: [...presentIds()], byId: assess().byId, numbers: S.numbers.list, cases });
    ambAt = now;
    return ambCache;
  }
  const LEVELS = ["LOW", "ELEVATED", "HIGH", "CRITICAL"];
  const levelColor = l => l === "CRITICAL" || l === "HIGH" ? "var(--red)" : l === "ELEVATED" ? "var(--yellow)" : "var(--green)";
  const lastLevel = {};                 // pid -> niveau bij de vorige ronde (alleen stijgingen melden)

  /* ---------- afwijkingen ---------- */
  const lastAnom = {};                  // "pid|kind" -> tijd van de laatste melding
  for (const e of S.events) if (e.cat === "ANOMALY" && e.pid && e.kind) lastAnom[e.pid + "|" + e.kind] = e.ts;
  function anomaly(p, a, cam, sev) {
    const k = p.id + "|" + a.kind, now = Date.now();
    if (now - (lastAnom[k] || 0) < ANOM_REPEAT) return;
    lastAnom[k] = now;
    emit("ANOMALY", sev, `${pName(p)} // ${a.text}`, { pid: p.id, cam, kind: a.kind, w: a.w });
  }
  const camProfile = pid => P.profile(sightings.filter(s => s.pid === pid).map(s => ({ ...s, cam: camKey(s.cam) })), pid);
  const loitStep = new WeakMap();       // blok -> hoogste gemelde stap
  const openUnk = new Map();            // "nr|cam" -> lopend blok van een onbekende
  function loiterCheck(now) {
    for (const e of openSight.values()) {
      if (now - e.e >= SIGHT_GAP) continue;
      const p = personById(e.pid), l = p && P.loiter(e.e - e.s, p.type);
      if (!l || (loitStep.get(e) || 0) >= l.step) continue;
      loitStep.set(e, l.step);
      emit("ANOMALY", l.step === 2 ? SEV.WARN : SEV.NOTICE, `${pName(p)} // ${l.text} // ${e.cam}`, { pid: p.id, cam: e.cam, kind: "LOITER", w: l.w });
    }
    // onbekenden: alleen op andere camera's dan DESK (wie achter de pc zit hangt niet rond)
    const desk = deskFeed();
    for (const e of openUnk.values()) {
      if (now - e.e >= SIGHT_GAP || (desk && e.cam === desk.tag)) continue;
      const l = P.loiter(e.e - e.s, "IRRELEVANT");
      if (!l || (loitStep.get(e) || 0) >= l.step) continue;
      loitStep.set(e, l.step);
      emit("ANOMALY", l.step === 2 ? SEV.WARN : SEV.NOTICE, `UNKNOWN #${e.no} // ${l.text} // ${e.cam}`, { cam: e.cam, kind: "LOITER", w: l.w });
    }
  }
  let lastHour = null;
  function hourlyCheck(now) {
    const slot = Math.floor(now / U.HOUR);
    if (slot === lastHour || new Date(now).getMinutes() < 5) return;
    lastHour = slot;
    for (const p of people) {
      const m = P.missedRoutine(P.profile(sightings, p.id), S.up, now);
      if (m) anomaly(p, m, undefined, SEV.NOTICE);
    }
    for (const f of UI.hourly) try { f(now); } catch (e) { console.error("CORE // hourly", e); }
  }

  /* ---------- de ronde: elke 2 seconden ---------- */
  let lastSave = 0, lastHist = S.hist.length ? S.hist[S.hist.length - 1][0] : 0;
  function tick() {
    if (!terminalReady) return;
    const now = Date.now();
    const before = S.up[U.dayKey(now)];
    P.markUp(S.up, now);
    if (S.up[U.dayKey(now)] !== before) dirty.up = true;

    const a = assess(true);
    for (const p of people) {
      const x = a.byId[p.id], was = lastLevel[p.id];
      if (!x) continue;
      if (was && LEVELS.indexOf(x.level) > LEVELS.indexOf(was))
        emit("SUBJECT", x.level === "LOW" ? SEV.INFO : SEV.WARN, `THREAT ASSESSMENT // ${pName(p)} // ${was} > ${x.level} (${Math.round(x.score)}%)${x.factors[0] ? " // " + x.factors[0].label : ""}`, { pid: p.id, kind: "LEVEL" });
      lastLevel[p.id] = x.level;
    }
    const r = N.update(S.numbers, { now, people, byId: a.byId, memory, inView: [...presentIds()] });
    for (const n of r.issued) emit("NUMBER", SEV.ALERT, `NEW NUMBER // ${n.ssn} // ${nameOf(n.pid)} // ${n.role} // ${n.list}`, { pid: n.pid, nr: n.seq, kind: "ISSUED" });
    for (const n of r.changed) emit("NUMBER", SEV.WARN, `NUMBER ${n.ssn} // ${nameOf(n.pid)} // NOW ${n.role} // ${n.list}`, { pid: n.pid, nr: n.seq, kind: "CHANGED" });
    for (const n of r.resolved) emit("NUMBER", SEV.NOTICE, `NUMBER ${n.ssn} RESOLVED // ${n.reason}`, { pid: personById(n.pid) ? n.pid : undefined, nr: n.seq, kind: "RESOLVED" });
    if (r.issued.length || r.changed.length || r.resolved.length || S.numbers.list.some(n => n.status === "ACTIVE")) dirty.numbers = true;

    loiterCheck(now);
    hourlyCheck(now);
    if (now - lastHist >= HIST_STEP) {
      S.hist.push([now, Math.round(S.levelMax * 100)]);
      if (S.hist.length > HIST_KEEP) S.hist.splice(0, S.hist.length - HIST_KEEP);
      S.levelMax = S.level; lastHist = now; dirty.hist = true;
    }
    if (now - lastSave > 10000) persist();
  }
  function persist() {
    lastSave = Date.now();
    for (const k of Object.keys(dirty)) {
      if (!dirty[k]) continue;
      dirty[k] = false;
      store.set(KEY[k], S[k]);
    }
  }
  addEventListener("beforeunload", persist);
  let fullWarned = 0;

  /* ---------- haakjes uit index.html ---------- */
  Object.assign(UI, {
    emit, visible, renderFeed, assess, assessOf, presentIds, persist, nameOf, levelColor, LEVELS,
    markDirty: k => { dirty[k] = true; },
    stored(k, ok) {
      if (!ok && Date.now() - fullWarned > 10 * U.MIN) { fullWarned = Date.now(); emit("MEMORY", SEV.WARN, "BROWSER STORAGE FULL // NOT EVERYTHING IS SAVED // SEE /memory"); }
      for (const f of UI.onStored) try { f(k, ok); } catch (e) { console.error("CORE // stored", e); }
    },
    online() {
      emit("SYSTEM", SEV.INFO, `SYSTEM ONLINE // ${people.length} PROFILE${people.length === 1 ? "" : "S"} // ${S.events.length} EVENTS IN MEMORY`);
      for (const p of people) { const x = assess(true).byId[p.id]; if (x) lastLevel[p.id] = x.level; }
      setInterval(tick, 2000);
    },
    denied(c, role, f) {
      const p = f && f.person;
      emit("ACCESS", SEV.WARN, `DENIED ${c} // ${p ? pName(p) + " // " : ""}${role}`, { pid: p ? p.id : undefined, kind: "DENIED" });
    },
    granted(c, role, f) {
      const p = f && f.person;
      emit("ACCESS", SEV.INFO, `GRANTED ${c} // ${role}`, { pid: p ? p.id : undefined, kind: "GRANTED" });
    },
    escalated(p) { emit("ACCESS", SEV.ALERT, `${pName(p)} // UNAUTHORIZED COMMAND // NOW THREAT TO SYSTEM`, { pid: p.id, kind: "ESCALATED" }); },
    caseOpened(c, pid, cam) {
      emit("CASE", SEV.ALERT, `CASE ${caseNr(c.nr)} OPENED // ${c.kind} // ${pid && personById(pid) ? nameOf(pid) : "UNIDENTIFIED"} @ ${cam}`, { pid: pid || undefined, cam, nr: c.nr, kind: "OPENED" });
    },
    caseClosed(c, by) { emit("CASE", SEV.NOTICE, `CASE ${caseNr(c.nr)} CLOSED BY ${by}${c.reason ? " // " + c.reason : ""}`, { pid: c.pids[0], nr: c.nr, kind: "CLOSED" }); },
    caseReopened(c, by) { emit("CASE", SEV.WARN, `CASE ${caseNr(c.nr)} REOPENED BY ${by}`, { pid: c.pids[0], nr: c.nr, kind: "REOPENED" }); },
    handoff(s, name, from, to, gone) {
      emit("HANDOFF", /THREAT/.test(s.type || "") ? SEV.WARN : SEV.INFO, `${name} // ${from} > ${to} (${Math.round(gone / 1000)}S)`, { pid: s.person ? s.person.id : undefined, cam: to });
    },
    weapon(p, e, level, cam) {
      const k = p.id + "|W" + level, now = Date.now();
      if (now - (lastAnom[k] || 0) < U.MIN) return;
      lastAnom[k] = now;
      emit("WEAPON", level === "THREAT" ? SEV.ALERT : SEV.WARN, `${pName(p)} // ${level === "THREAT" ? "WEAPON CONFIRMED" : "WEAPON DETECTED"} // ${e.label}`, { pid: p.id, cam: cam || camNow(), kind: level });
    },
    threatSeen(why, t) { if (!(t && t.person)) emit("WEAPON", SEV.ALERT, `UNIDENTIFIED SUBJECT // THREAT ${why}`, { cam: camNow(), kind: "THREAT" }); },
    profile(what, p) { emit("SUBJECT", SEV.NOTICE, p ? `${pName(p)} // ${what} // ${p.type}` : what, { pid: p ? p.id : undefined, kind: "PROFILE" }); },
    feedOn(f) {
      const k = camKey(f.tag);
      if (!S.camFirst[k]) { S.camFirst[k] = Date.now(); dirty.camFirst = true; }
      emit("CAMERA", SEV.INFO, `${f.tag} ONLINE${f.remote ? " // TRANSMITTER" : ""}`, { cam: f.tag });
    },
    feedOff(f) { emit("CAMERA", SEV.WARN, `${f.tag} // SIGNAL LOST`, { cam: f.tag }); },
    mode(m, auto) { emit("SYSTEM", m === "DEFENSE" ? SEV.WARN : SEV.NOTICE, `MODE ${m}${auto ? " (AUTO)" : ""}`, { kind: "MODE" }); },
    level(level, tl) {
      S.level = level; if (level > S.levelMax) S.levelMax = level;
      if (tl === S.tl) return;
      const up = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(tl) > ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(S.tl);
      S.tl = tl;
      if (!terminalReady) return;
      const why = ambient().reasons[0];
      emit("SYSTEM", up ? (tl === "MEDIUM" ? SEV.NOTICE : SEV.WARN) : SEV.INFO, `THREAT LEVEL ${tl}${up && why ? " // " + why : ""}`, { kind: "LEVEL" });
    },
    ambient,
    // nieuw blok op de tijdlijn: aankomst melden en vergelijken met het leefpatroon van deze persoon
    sighting(e, p, cam) {
      let prev = null;
      for (let i = sightings.length - 1; i >= 0; i--) if (sightings[i] !== e && sightings[i].pid === p.id) { prev = sightings[i]; break; }
      if (!prev || e.s - prev.e > ARRIVAL_GAP)
        emit("SUBJECT", /THREAT/.test(e.type || "") ? SEV.WARN : SEV.INFO, `${pName(p) === e.type ? e.type : e.type + " " + pName(p)} @ ${cam}`, { pid: p.id, cam, kind: "ARRIVAL" });
      const hist = sightings.filter(s => s.pid === p.id && s !== e).map(s => ({ ...s, cam: camKey(s.cam) }));
      const k = camKey(cam), trusted = P.TRUSTED.has(p.type);
      const found = P.checkSighting({ sighting: { cam: k, s: e.s }, profile: P.profile(hist, p.id, { to: e.s }), type: p.type,
                                      camAgeMs: e.s - (S.camFirst[k] || e.s) });
      for (const a of found) anomaly(p, a, cam, trusted ? SEV.INFO : SEV.WARN);
    },
    // twee mensen voor het eerst (of opnieuw) samen in beeld: eerste contact met een dreiging is een waarschuwingssignaal
    together(a, b, cam, l) {
      if (l.n !== 1) return;
      const by = assess().byId;
      for (const [me, other] of [[a, b], [b, a]]) {
        const x = by[other], mine = by[me], p = personById(me), o = personById(other);
        if (!p || !o || !x || !mine || x.own < 40 || mine.own >= 40) continue;
        anomaly(p, { kind: "CONTACT", w: 0.15, text: `FIRST CONTACT WITH ${pName(o)} (${o.type})` }, cam, SEV.WARN);
      }
    },
    // onbekenden krijgen ook blokken op de tijdlijn (alleen in deze browser, alleen nummer + camera + tijd)
    unknown(s, f, now) {
      if (now - s.born < 3000) return;                                 // flitsjes overslaan
      const no = subjNo(s), cam = f.tag, k = no + "|" + cam;
      let e = openUnk.get(k);
      if (e && now - e.e < SIGHT_GAP) e.e = now;
      else {
        const prev = [...S.unknowns].reverse().find(u => u.no === no);
        e = { no, cam, s: now, e: now };
        S.unknowns.push(e); openUnk.set(k, e);
        if (S.unknowns.length > UNK_KEEP) S.unknowns.splice(0, S.unknowns.length - UNK_KEEP);
        if (!prev || now - prev.e > ARRIVAL_GAP) emit("SUBJECT", SEV.INFO, `UNKNOWN #${no} @ ${cam}`, { cam, kind: "ARRIVAL" });
      }
      dirty.unknowns = true;
    },
    // regel onder het kader in beeld
    boxInfo(p) {
      const a = assessOf(p.id);
      if (!a) return null;
      const n = N.forPid(S.numbers, p.id), tail = n ? " // NUMBER" : "";
      if (a.score >= 25 && a.score >= a.risk) return { text: `THREAT ${Math.round(a.score)}%${tail}`, color: a.score >= 50 ? "#ff2a2a" : "#f5d90a" };
      if (a.risk >= 25) return { text: `AT RISK ${Math.round(a.risk)}%${tail}`, color: "#f5d90a" };
      return n ? { text: "NUMBER", color: "#f5d90a" } : null;
    },
    numberOf: pid => N.forPid(S.numbers, pid),
    watched: pid => UI.watched ? UI.watched(pid) : false,
    dossierHtml,
    facts(q) { return UI.factsFor ? UI.factsFor(q) : ""; },
    page(tab, W) { const pg = UI.pages[tab]; return pg ? pg.html(W) : null; },
    async command(c, args, raw) {
      const h = UI.commands[c];
      if (!h) { if (UI.didYouMean) UI.didYouMean(c); return false; }
      await h(args, raw);
      return true;
    },
  });

  /* ---------- dossier: dreigingsanalyse, leefpatroon en afwijkingen ---------- */
  const profCache = new Map();          // pid -> { at, prof }
  function profileOf(pid) {
    const c = profCache.get(pid), now = Date.now();
    if (c && now - c.at < 30000) return c.prof;
    const prof = camProfile(pid);
    profCache.set(pid, { at: now, prof });
    return prof;
  }
  const bar = (v, color) => `<div class="tbar"><i style="width:${Math.max(2, Math.min(100, v))}%;background:${color}"></i></div>`;
  function factorRows(list) {
    return list.map(f => `<div class="fac"><span class="w">+${Math.round(f.w * 100)}%</span><span class="l">${E(f.label)}</span><span class="d">${E(f.detail || "")}</span></div>`).join("");
  }
  function heatmap(prof) {
    const weeks = Math.max(1, Math.ceil(prof.days / 7));
    const days = ["M", "T", "W", "T", "F", "S", "S"];
    let rows = "";
    for (let d = 0; d < 7; d++) {
      rows += `<div class="hr"><span>${days[d]}</span>`;
      for (let h = 0; h < 24; h++) { const v = Math.min(1, prof.grid[d][h] / weeks); rows += `<i style="opacity:${v ? (.25 + .75 * v).toFixed(2) : 0}" title="${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][d]} ${U.pad2(h)}:00 // ${prof.grid[d][h]} DAY${prof.grid[d][h] === 1 ? "" : "S"}"></i>`; }
      rows += `</div>`;
    }
    return `<div class="heat">${rows}<div class="hx"><span></span><b>00</b><b>06</b><b>12</b><b>18</b></div></div>`;
  }
  // "MON-FRI 09-17" in woorden: de uren waarop deze persoon op minstens 40% van zijn dagen te zien is
  function usualText(prof) {
    if (prof.days < P.MIN_DAYS) return `INSUFFICIENT DATA // ${prof.days} OF ${P.MIN_DAYS} DAYS OBSERVED`;
    const hrs = []; for (let h = 0; h < 24; h++) { let n = 0; for (const k of Object.keys(prof.byDay)) if (prof.byDay[k] & (1 << h)) n++; if (n / prof.days >= .4) hrs.push(h); }
    const cam = Object.entries(prof.cams).sort((a, b) => b[1] - a[1])[0];
    if (!hrs.length) return `NO FIXED ROUTINE // ${prof.days} DAYS OBSERVED${cam ? " // MOSTLY " + cam[0] : ""}`;
    const spans = []; let a = hrs[0], b = hrs[0];
    for (const h of hrs.slice(1)) { if (h === b + 1) b = h; else { spans.push([a, b]); a = b = h; } }
    spans.push([a, b]);
    return `USUALLY ${spans.map(([x, y]) => `${U.pad2(x)}-${U.pad2((y + 1) % 24)}H`).join(", ")}${cam ? " // MOSTLY " + cam[0] : ""} // ${prof.days} DAYS OBSERVED`;
  }
  function dossierHtml(p) {
    const a = assessOf(p.id);
    if (!a) return "";
    const n = N.forPid(S.numbers, p.id), prof = profileOf(p.id), now = Date.now();
    const devs = EV.query(S.events, { cats: ["ANOMALY"], pid: p.id, from: now - 7 * U.DAY, limit: 5 });
    const role = a.role === "NONE" ? "--" : `${a.role}${a.role === "UNDETERMINED" ? "" : ` ${Math.round((a.role === "VICTIM" ? a.pVictim : a.pPerp) * 100)}%`}`;
    return `<div class="sec core">
      <div class="lbl">THREAT ASSESSMENT:</div>
      ${a.trusted ? `<div class="row"><span>THREAT</span><span class="v" style="color:var(--green)">TRUSTED // NOT ASSESSED</span></div>`
        : `<div class="row"><span>THREAT</span><span class="v" style="color:${levelColor(a.level)}">${Math.round(a.score)}% ${a.level}</span></div>${bar(a.score, levelColor(a.level))}`}
      <div class="row"><span>RISK (AS VICTIM)</span><span class="v" style="color:${levelColor(a.riskLevel)}">${Math.round(a.risk)}% ${a.riskLevel}</span></div>${bar(a.risk, levelColor(a.riskLevel))}
      <div class="row"><span>LIKELY ROLE</span><span class="v">${role}</span></div>
      ${n ? `<div class="row"><span>NUMBER</span><span class="v">${E(n.ssn)} // ${n.list}</span></div>` : ""}
      ${UI.watched && UI.watched(p.id) ? `<div class="row"><span>WATCHLIST</span><span class="v" style="color:var(--red)">ALERT WHEN IN VIEW</span></div>` : ""}
      ${a.factors.length ? `<div class="lbl" style="margin-top:6px">WHY (THREAT):</div>${factorRows(a.factors)}` : ""}
      ${a.riskFactors.length ? `<div class="lbl" style="margin-top:6px">WHY (RISK):</div>${factorRows(a.riskFactors)}` : ""}
    </div>
    <div class="sec core">
      <div class="lbl">PATTERN OF LIFE:</div>
      ${prof.blocks ? heatmap(prof) : ""}
      <div class="item" style="font-size:11px">${E(usualText(prof))}</div>
      ${devs.length ? `<div class="lbl" style="margin-top:6px">DEVIATIONS (7 DAYS):</div>` + devs.map(e => `<div class="item"><span class="t">${shortStamp(e.ts)}</span>${E(e.text.replace(pName(p) + " // ", ""))}</div>`).join("") : ""}
    </div>`;
  }

  /* ---------- /threat: de analyse als tekst ---------- */
  UI.commands["/threat"] = async args => {
    const role = currentRole(), by = assess(true).byId;
    if (!args.length) {
      const list = people.filter(p => mayViewFile(role, p) && by[p.id]).sort((x, y) => Math.max(by[y.id].score, by[y.id].risk) - Math.max(by[x.id].score, by[x.id].risk)).slice(0, 12);
      if (!list.length) { print("THREAT ASSESSMENT // INSUFFICIENT DATA // NO REGISTERED SUBJECTS", "warn"); return; }
      print("THREAT ASSESSMENT // ALL SUBJECTS   (/threat <name|#> = reasons)");
      print(list.map(p => { const a = by[p.id]; return `${pName(p).padEnd(18).slice(0, 18)} ${p.type.padEnd(18)} THREAT ${String(Math.round(a.score)).padStart(3)}% ${a.level.padEnd(9)} RISK ${String(Math.round(a.risk)).padStart(3)}%  ${a.role === "NONE" ? "" : a.role}`; }).join("\n"));
      return;
    }
    const r = resolvePerson(args), p = r.p;
    if (!p) { print(L().changeNone, "err"); return; }
    if (!mayViewFile(role, p)) { print(L().dossierDenied(role, p.type), "err"); hudMessage("ACCESS DENIED", "var(--red)"); return; }
    const a = by[p.id], n = N.forPid(S.numbers, p.id);
    const fac = l => l.map(f => `  +${String(Math.round(f.w * 100)).padStart(2)}%  ${f.label.padEnd(24)} ${f.detail || ""}`).join("\n");
    print(`THREAT ASSESSMENT // ${pName(p)} // ${p.type}`, a.score >= 50 ? "err" : a.score >= 25 || a.risk >= 25 ? "warn" : "ok");
    print((a.trusted ? "THREAT  TRUSTED, NOT ASSESSED" : `THREAT  ${Math.round(a.score)}% ${a.level}`) + `\nRISK    ${Math.round(a.risk)}% ${a.riskLevel}\nROLE    ${a.role === "NONE" ? "--" : a.role}` +
      (n ? `\nNUMBER  ${n.ssn} // ${n.list}` : "") +
      (a.factors.length ? "\nWHY (THREAT)\n" + fac(a.factors) : "") + (a.riskFactors.length ? "\nWHY (RISK)\n" + fac(a.riskFactors) : "") +
      (!a.factors.length && !a.riskFactors.length ? "\nNO INDICATORS" : ""));
  };

  // klikken op onderdelen van de CORE-pagina's: [data-ui] wordt hier afgehandeld, vóór de klik-afhandeling van de console zelf
  $("console").addEventListener("click", e => {
    // een knop van de console zelf (FILE, TIMELINE, tabblad) of een invoerveld binnen zo'n onderdeel gaat voor
    const b = e.target.closest("[data-ui],[data-file],[data-go],[data-tab],input");
    if (!b || !b.dataset.ui) return;
    e.stopPropagation();
    const pg = UI.pages[cTab];
    if (pg && pg.click) pg.click(b, e);
    renderConsole(false);
  }, true);
})();
