// THE MACHINE // CORE: console-pagina OVERVIEW. Eén scherm met alles wat er nu toe doet:
// dreigingsniveau (met verloop over 24 uur), nummers, zaken, wie waar is, drukte, de subjecten met de hoogste
// dreiging, de laatste gebeurtenissen en de staat van het systeem. Toont alleen wat de rol mag zien.
(function () {
  "use strict";
  const UI = window.MachineUI, C = MachineCore, U = C.util, EV = C.events, N = C.numbers, S = UI.S, E = s => escapeHtml(String(s));
  const TL_COLOR = { LOW: "var(--green)", MEDIUM: "var(--yellow)", HIGH: "var(--red)", CRITICAL: "var(--red)" };
  const none = t => `<div class="nonef">${t}</div>`;

  // verloop van het dreigingsniveau: lijn over de laatste 24 uur; gaten = The Machine stond uit
  function spark(now) {
    const from = now - U.DAY, W = 300, H = 64, pts = S.hist.filter(h => h[0] >= from).concat([[now, Math.round(S.level * 100)]]);
    const X = t => ((t - from) / U.DAY * W).toFixed(1), Y = v => (H - 2 - v / 100 * (H - 6)).toFixed(1);
    let line = "", area = "", start = null, prev = null;
    const close = () => { if (start != null && prev != null) area += `L${X(prev)} ${H}L${X(start)} ${H}Z`; };
    for (const [t, v] of pts) {
      if (prev == null || t - prev > 12 * U.MIN) { close(); line += `M${X(t)} ${Y(v)}`; area += `M${X(t)} ${Y(v)}`; start = t; }
      else { line += `L${X(t)} ${Y(v)}`; area += `L${X(t)} ${Y(v)}`; }
      prev = t;
    }
    close();
    const col = TL_COLOR[S.tl] || "var(--green)";
    let ticks = "";
    for (let h = 6; h < 24; h += 6) ticks += `<line class="gl" x1="${W * h / 24}" x2="${W * h / 24}" y1="0" y2="${H}"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" height="${H}" preserveAspectRatio="none">${ticks}
      <line x1="0" x2="${W}" y1="${Y(50)}" y2="${Y(50)}" stroke="#421" stroke-dasharray="2 3"/><line x1="0" x2="${W}" y1="${Y(20)}" y2="${Y(20)}" stroke="#331" stroke-dasharray="2 3"/>
      <path class="area" d="${area}" fill="${col}"/><path class="spark" d="${line}" stroke="${col}"/></svg>
      <div class="sub" style="display:flex;justify-content:space-between"><span>-24H</span><span>-18H</span><span>-12H</span><span>-6H</span><span>NOW</span></div>`;
  }
  // drukte per uur: bekenden (wit), daarvan met een THREAT-tag (rood), onbekenden (grijs, erbovenop)
  function activity(now, ok) {
    const to = Math.ceil(now / U.HOUR) * U.HOUR, from = to - U.DAY;
    const b = C.patterns.activity(sightings.filter(s => ok.has(s.pid)), S.unknowns, from, to, 24);
    const max = Math.max(1, ...b.map(x => x.known + x.unknown)), W = 300, H = 60, bw = W / 24;
    const bars = b.map((x, i) => {
      const hk = x.known / max * (H - 4), ht = x.threat / max * (H - 4), hu = x.unknown / max * (H - 4), x0 = (i * bw + 1).toFixed(1), w = (bw - 2).toFixed(1);
      const tip = `${U.pad2(new Date(x.t0).getHours())}:00 // ${x.known} KNOWN${x.threat ? ` (${x.threat} THREAT)` : ""} // ${x.unknown} UNKNOWN`;
      return `<g><title>${tip}</title><rect x="${x0}" y="0" width="${w}" height="${H}" fill="#0b0b0b"/>
        <rect x="${x0}" y="${(H - hk).toFixed(1)}" width="${w}" height="${hk.toFixed(1)}" fill="#f2f2f2" fill-opacity=".75"/>
        <rect x="${x0}" y="${(H - ht).toFixed(1)}" width="${w}" height="${ht.toFixed(1)}" fill="#ff2a2a"/>
        <rect x="${x0}" y="${(H - hk - hu).toFixed(1)}" width="${w}" height="${hu.toFixed(1)}" fill="#8a8a8a" fill-opacity=".8"/></g>`;
    }).join("");
    const h0 = new Date(from).getHours(), lbl = i => `${U.pad2((h0 + i) % 24)}H`;
    const total = b.reduce((n, x) => n + x.known + x.unknown, 0);
    return total ? `<svg viewBox="0 0 ${W} ${H}" height="${H}" preserveAspectRatio="none">${bars}</svg>
      <div class="sub" style="display:flex;justify-content:space-between"><span>${lbl(0)}</span><span>${lbl(6)}</span><span>${lbl(12)}</span><span>${lbl(18)}</span><span>NOW</span></div>
      <div class="sub">SUBJECTS PER HOUR // WHITE = KNOWN, RED = THREAT, GREY = UNKNOWN</div>` : none("NO ACTIVITY IN THE LAST 24 HOURS");
  }
  // wie staat nu waar: per camera de bekenden (die deze rol mag zien) en het aantal onbekenden
  function locations(now, ok) {
    const by = {};
    for (const f of feeds) by[f.tag] = { known: [], unk: 0, live: true };
    for (const e of openSight.values()) if (now - e.e < SIGHT_GAP) { const p = personById(e.pid); if (!p) continue; (by[e.cam] = by[e.cam] || { known: [], unk: 0 }).known.push(ok.has(p.id) ? p : null); }
    for (const u of S.unknowns.slice(-60)) if (now - u.e < SIGHT_GAP) (by[u.cam] = by[u.cam] || { known: [], unk: 0 }).unk++;
    const keys = Object.keys(by).sort();
    if (!keys.length) return none("NO CAMERA FEEDS");
    return keys.map(k => { const c = by[k], parts = c.known.map(p => p ? `<span style="color:${TYPES[p.type].color}">${E(pName(p))}</span>` : `<span style="color:var(--grey)">RESTRICTED</span>`);
      if (c.unk) parts.push(`<span style="color:var(--grey)">${c.unk} UNKNOWN</span>`);
      return `<div class="row"><span>${E(k)}</span><span class="m">${parts.join(", ") || `<span style="color:#555">NO SUBJECTS</span>`}</span></div>`; }).join("");
  }
  let bytesAt = 0, bytes = 0;
  function storageBytes() {
    if (Date.now() - bytesAt < 10000) return bytes;
    let n = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || "").length) * 2; } } catch {}
    bytesAt = Date.now(); bytes = n;
    return n;
  }
  UI.storageBytes = storageBytes;

  UI.pages.OVERVIEW = {
    html() {
      const now = Date.now(), role = cRole, ok = new Set(cPeople().map(p => p.id)), by = UI.assess().byId, amb = UI.ambient();
      const act = N.active(S.numbers), rel = act.filter(n => n.list === "RELEVANT").length;
      const myCases = cases.filter(c => mayViewCase(role, c)), open = myCases.filter(c => c.status === "OPEN").sort((a, b) => b.e - a.e);
      const top = cPeople().filter(p => by[p.id]).map(p => ({ p, a: by[p.id], v: Math.max(by[p.id].score, by[p.id].risk) })).filter(x => x.v >= 10).sort((x, y) => y.v - x.v).slice(0, 6);
      const evs = EV.query(S.events, { minSev: 1, limit: 12, hide: e => !UI.visible(e, role) });
      const present = UI.presentIds(), day = U.startOfDay(now);
      const seenToday = new Set(sightings.filter(s => s.e >= day).map(s => s.pid)).size, unkToday = new Set(S.unknowns.filter(u => u.e >= day).map(u => u.no)).size;
      const upMask = S.up[U.dayKey(now)] || 0; let upH = 0; for (let h = 0; h < 24; h++) if (upMask & (1 << h)) upH++;
      const st = storageBytes(), disk = UI.diskStatus ? UI.diskStatus() : null;
      const sysRow = (k, v, c) => `<div class="row"><span>${k}</span><span class="v"${c ? ` style="color:${c}"` : ""}>${E(v)}</span></div>`;
      return `<div id="cOv">
        <div class="pn"><div class="hd"><span>THREAT LEVEL</span><span>${Math.round(S.level * 100)}%</span></div>
          <div class="big" style="color:${TL_COLOR[S.tl]}">${S.tl}</div>
          <div class="sub">${E(amb.reasons.slice(0, 2).join(" // ") || (present.size ? "SUBJECTS IN VIEW // NO INDICATORS" : "NO INDICATORS"))}</div>
          <div style="margin-top:8px">${spark(now)}</div></div>
        <div class="pn"><div class="hd"><span>NUMBERS</span><button data-tab="NUMBERS">OPEN</button></div>
          <div class="cnt"><div><div class="big" style="color:${rel ? "var(--red)" : "var(--grey)"}">${rel}</div><span>RELEVANT</span></div>
            <div><div class="big" style="color:${act.length - rel ? "var(--yellow)" : "var(--grey)"}">${act.length - rel}</div><span>IRRELEVANT</span></div></div>
          <div style="margin-top:8px">${act.slice(0, 4).map(n => `<div class="row"><span class="m">${E(n.ssn)} &nbsp; ${E(UI.numberWho(n, role))}</span><span class="v" style="color:${n.list === "RELEVANT" ? "var(--red)" : "var(--yellow)"}">${n.role}</span></div>`).join("") || none("NO ACTIVE NUMBERS")}</div></div>
        <div class="pn"><div class="hd"><span>CASES</span><button data-tab="CASES">OPEN</button></div>
          <div class="cnt"><div><div class="big" style="color:${open.length ? "var(--red)" : "var(--grey)"}">${open.length}</div><span>OPEN</span></div>
            <div><div class="big" style="color:var(--grey)">${myCases.length - open.length}</div><span>CLOSED</span></div></div>
          <div style="margin-top:8px">${open.slice(0, 4).map(c => `<div class="row"><span class="m">${caseNr(c.nr)} &nbsp; ${E(c.kind)} &nbsp; ${E(caseWho(c, role).slice(0, 2).join(", "))}</span><span class="v${caseLive(c) ? " live" : ""}">${caseLive(c) ? "ACTIVE" : E(ago(c.e))}</span></div>`).join("") || none("NO OPEN CASES")}</div></div>
        <div class="pn"><div class="hd"><span>LOCATIONS // NOW</span><button data-tab="FEEDS">FEEDS</button></div>${locations(now, ok)}
          <div class="sub" style="margin-top:6px">TODAY: ${seenToday} KNOWN // ${unkToday} UNKNOWN SUBJECT${unkToday === 1 ? "" : "S"}</div>${UI.expectedHtml ? UI.expectedHtml(role) : ""}</div>
        <div class="pn"><div class="hd"><span>ACTIVITY // 24 HOURS</span><button data-tab="TIMELINE">TIMELINE</button></div>${activity(now, ok)}</div>
        <div class="pn"><div class="hd"><span>SUBJECTS OF INTEREST</span><button data-tab="SUBJECTS">ALL</button></div>
          ${top.map(({ p, a }) => `<div class="row p" data-pid="${p.id}" data-file="1" title="OPEN FILE"><span class="m" style="color:${TYPES[p.type].color}">${E(pName(p))}${present.has(p.id) ? ` <span class="live">●</span>` : ""}</span>
            <span class="v" style="color:${UI.levelColor(a.score >= a.risk ? a.level : a.riskLevel)}">${a.score >= a.risk ? `THREAT ${Math.round(a.score)}%` : `RISK ${Math.round(a.risk)}%`}</span></div>`).join("") || none(cPeople().length ? "NO SUBJECTS OF INTEREST" : "INSUFFICIENT DATA // NO REGISTERED SUBJECTS")}</div>
        <div class="pn w2"><div class="hd"><span>LATEST EVENTS</span><button data-tab="LOG">LOG</button></div>
          ${evs.map(e => `<div class="ev s${e.sev}"><span class="t">${E(shortStamp(e.ts))}</span><span class="c">${e.cat}</span><span class="m">${E(e.text)}</span></div>`).join("") || none("NO EVENTS YET")}</div>
        <div class="pn"><div class="hd"><span>SYSTEM</span><span>LIVE</span></div>
          ${sysRow("MODE", mode + (autoDefense ? " (AUTO)" : ""), mode === "DEFENSE" ? "var(--red)" : "")}
          ${sysRow("CAMERAS", `${feeds.length} ONLINE`, feeds.length ? "var(--green)" : "var(--red)")}
          ${sysRow("AI CORE", model ? model.toUpperCase() : "OFFLINE", model ? "var(--green)" : "var(--yellow)")}
          ${sysRow("PROFILES", `${people.length}`)}
          ${sysRow("EVENTS IN MEMORY", `${S.events.length}`)}
          ${sysRow("WATCHING TODAY", `${upH} H`)}
          ${sysRow("BROWSER STORAGE", `${(st / 1048576).toFixed(1)} MB OF ~5`, st > 4.5e6 ? "var(--red)" : st > 3.5e6 ? "var(--yellow)" : "")}
          ${disk ? sysRow("MEMORY CORE (DISK)", disk.text, disk.color) : ""}</div>
      </div>`;
    },
  };
  UI.commands["/overview"] = async () => { openConsole("OVERVIEW", currentRole()); print(`CONSOLE // OVERVIEW   (F2 / Esc closes, 1-${C_TABS.length} = page)`, "ok"); };
})();
