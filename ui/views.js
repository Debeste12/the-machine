// THE MACHINE // CORE: verbeterde console-pagina's TIMELINE en NETWORK.
// TIMELINE: terugbladeren in de tijd, dreigingsverloop als strook, markeringen voor zaken / nummers / wapens /
//           afwijkingen, en een baan voor onbekenden.
// NETWORK:  dreigingsring per subject, afstand tot de dichtstbijzijnde dreiging, kortste keten daarheen,
//           sleutelfiguren (zonder wie een groep uiteenvalt) en knooppunten die je kunt verslepen.
// Als dit bestand ontbreekt of faalt, tekent index.html zijn eigen eenvoudiger versie.
(function () {
  "use strict";
  const UI = window.MachineUI, C = MachineCore, U = C.util, G = C.graph, S = UI.S, E = s => escapeHtml(String(s));
  const lvlCol = v => UI.levelColor(U.levelOf(v));

  /* =================== TIMELINE =================== */
  let tlEnd = null;                        // null = live (venster eindigt nu), anders vast eindtijdstip
  const MARK = { CASE: { c: "var(--red)", s: "sq", n: "CASE" }, WEAPON: { c: "var(--red)", s: "di", n: "WEAPON" }, NUMBER: { c: "var(--white)", s: "ci", n: "NUMBER" },
                 ANOMALY: { c: "var(--yellow)", s: "tr", n: "ANOMALY" }, ACCESS: { c: "var(--yellow)", s: "x", n: "DENIED" } };
  const marked = e => MARK[e.cat] && (e.cat !== "ACCESS" || e.kind === "DENIED" || e.kind === "ESCALATED");
  function shape(m, x, y, r) {
    if (m.s === "sq") return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${m.c}"/>`;
    if (m.s === "di") return `<path d="M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z" fill="${m.c}"/>`;
    if (m.s === "ci") return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${m.c}" stroke-width="1.6"/>`;
    if (m.s === "tr") return `<path d="M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z" fill="${m.c}"/>`;
    return `<path d="M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}" stroke="${m.c}" stroke-width="2"/>`;
  }
  function timeline(W) {
    const now = Date.now(), span = C_RANGES[cRange], to = tlEnd == null ? now : Math.min(now, tlEnd), from = to - span, live = tlEnd == null;
    const ok = new Set(cPeople().map(p => p.id));
    const segs = sightings.filter(s => s.e >= from && s.s <= to && ok.has(s.pid) && personById(s.pid));
    const unk = S.unknowns.filter(u => u.e >= from && u.s <= to);
    const evs = S.events.filter(e => e.ts >= from && e.ts <= to && marked(e) && UI.visible(e, cRole));
    const fmt = t => new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
    const bar = `<div class="bar2">RANGE ${Object.keys(C_RANGES).map(r => `<button data-range="${r}" class="${r === cRange ? "on" : ""}">${r}</button>`).join("")}
      &nbsp; <button data-ui="tl-prev" title="earlier">&lt;</button><button data-ui="tl-next" title="later"${live ? " disabled" : ""}>&gt;</button><button data-ui="tl-now" class="${live ? "on" : ""}">${live ? "LIVE" : "NOW"}</button>
      <span class="ax">${E(fmt(from))} - ${live ? "NOW" : E(fmt(to))}</span>
      &nbsp; GROUP <button data-group="SUBJECT" class="${cGroup === "SUBJECT" ? "on" : ""}">BY SUBJECT</button><button data-group="CAMERA" class="${cGroup === "CAMERA" ? "on" : ""}">BY CAMERA</button>
      ${cSel && personById(cSel) ? `&nbsp; SELECTED: ${E(pName(personById(cSel)))} <button data-sel="">CLEAR</button>` : ""}</div>`;
    const byS = cGroup === "SUBJECT", key = s => byS ? s.pid : s.cam;
    const lanes = [...new Set(segs.map(key).concat(byS ? [] : unk.map(u => u.cam)))].sort((a, b) => byS ? (b === cSel) - (a === cSel) || pName(personById(a)).localeCompare(pName(personById(b))) : a.localeCompare(b));
    const unkLane = byS && unk.length;
    const LW = 150, LH = 26, HT = 14, top = 22 + HT + 6 + LH, w = Math.max(300, W), tw = w - LW - 10, h = top + (lanes.length + (unkLane ? 1 : 0)) * LH + 6;
    const X = t => LW + (Math.min(to, Math.max(from, t)) - from) / span * tw;
    const step = { "1H": 600e3, "6H": 3600e3, "24H": 3 * 3600e3, "7D": 86400e3 }[cRange];
    let ticks = "";
    const off = new Date(from).getTimezoneOffset() * 60000;
    for (let t = Math.ceil((from - off) / step) * step + off; t <= to; t += step) {
      const d = new Date(t), lbl = cRange === "7D" ? d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit" }).toUpperCase() : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      ticks += `<line class="gl" x1="${X(t)}" x2="${X(t)}" y1="16" y2="${h}"/><text class="ax" x="${X(t) + 3}" y="12">${lbl}</text>`;
    }
    // strook met het dreigingsniveau (hoogste per kolom)
    const cols = Math.max(20, Math.min(240, Math.floor(tw / 4))), cw = tw / cols, lev = new Array(cols).fill(-1);
    for (const [t, v] of S.hist) if (t >= from && t <= to) { const i = Math.min(cols - 1, Math.floor((t - from) / span * cols)); if (v > lev[i]) lev[i] = v; }
    if (live) lev[cols - 1] = Math.max(lev[cols - 1], Math.round(S.level * 100));
    const tcol = v => v >= 70 ? "var(--red)" : v >= 30 ? "var(--yellow)" : "var(--green)";
    const strip = lev.map((v, i) => v < 0 ? "" : `<rect x="${LW + i * cw}" y="${20 + HT - Math.max(2, v / 100 * HT)}" width="${Math.max(1, cw - .5)}" height="${Math.max(2, v / 100 * HT)}" fill="${tcol(v)}" fill-opacity="${v < 30 ? .45 : .9}"><title>THREAT LEVEL ${v}%</title></rect>`).join("");
    // baan met markeringen
    const ey = 22 + HT + 6;
    const marks = evs.map(e => { const m = MARK[e.cat], dim = cSel && e.pid !== cSel;
      return `<g class="${e.pid && ok.has(e.pid) ? "nd" : ""}"${e.pid && ok.has(e.pid) ? ` data-pid="${e.pid}"` : ""} opacity="${dim ? .25 : 1}">${shape(m, X(e.ts), ey + LH / 2, 4)}<title>${E(stamp(e.ts) + "\n" + e.cat + " // " + e.text)}</title></g>`; }).join("");
    const laneSvg = lanes.map((k, i) => {
      const y = top + i * LH, p = byS ? personById(k) : null;
      const label = byS ? pName(p) : k, col = byS ? TYPES[p.type].color : "var(--white)";
      const bars = segs.filter(s => key(s) === k).map(s => {
        const q = personById(s.pid), x = X(s.s), bw = Math.max(3, X(s.e) - x), c = TYPES[s.type] ? TYPES[s.type].color : TYPES[q.type].color;
        const txt = byS ? s.cam.replace(/^CAM_/, "") : pName(q), hl = cSel && s.pid === cSel;
        const tip = `${pName(q)} // ${s.cam}\n${stamp(s.s)} - ${new Date(s.e).toLocaleTimeString("en-GB")} (${durTxt(s.e - s.s)})`;
        return `<rect class="sg" data-pid="${s.pid}" x="${x}" y="${y + 4}" width="${bw}" height="${LH - 8}" fill="${c}" fill-opacity="${cSel && !hl ? .25 : .8}"${hl ? ` stroke="#fff"` : ""}><title>${E(tip)}</title></rect>` +
          (bw > txt.length * 7 + 6 ? `<text x="${x + 3}" y="${y + LH / 2 + 4}" style="fill:#000;font-size:10px;pointer-events:none">${E(txt)}</text>` : "");
      }).join("");
      const ub = byS ? "" : unk.filter(u => u.cam === k).map(u => `<rect x="${X(u.s)}" y="${y + 8}" width="${Math.max(3, X(u.e) - X(u.s))}" height="${LH - 16}" fill="#888" fill-opacity=".6"><title>${E(`UNKNOWN #${u.no} // ${u.cam}\n${stamp(u.s)} (${durTxt(u.e - u.s)})`)}</title></rect>`).join("");
      // markeringen van deze persoon op de eigen baan
      const own = byS ? evs.filter(e => e.pid === k).map(e => `<g>${shape(MARK[e.cat], X(e.ts), y + 3, 2.5)}<title>${E(stamp(e.ts) + "\n" + e.text)}</title></g>`).join("") : "";
      return `<rect class="lane" x="${LW}" y="${y + 2}" width="${tw}" height="${LH - 4}"/>
        <text x="4" y="${y + LH / 2 + 4}" style="fill:${col}"${byS ? ` class="nd" data-pid="${k}"` : ""}>${E(label.length > 18 ? label.slice(0, 17) + "…" : label)}</text>${ub}${bars}${own}`;
    }).join("");
    const uy = top + lanes.length * LH;
    const unkSvg = unkLane ? `<rect class="lane" x="${LW}" y="${uy + 2}" width="${tw}" height="${LH - 4}"/><text x="4" y="${uy + LH / 2 + 4}" class="ax">UNKNOWN SUBJECTS</text>` +
      unk.map(u => `<rect x="${X(u.s)}" y="${uy + 6}" width="${Math.max(3, X(u.e) - X(u.s))}" height="${LH - 12}" fill="#888" fill-opacity=".7"><title>${E(`UNKNOWN #${u.no} // ${u.cam}\n${stamp(u.s)} (${durTxt(u.e - u.s)})`)}</title></rect>`).join("") : "";
    const legend = `<div class="ax tlLegend">${Object.values(MARK).map(m => `<svg viewBox="0 0 12 12" width="12" height="12">${shape(m, 6, 6, 3.5)}</svg> ${m.n}`).join(" &nbsp; ")}</div>`;
    // lijst: waarnemingen en markeringen door elkaar
    const rows = segs.filter(s => !cSel || s.pid === cSel).map(s => ({ t: s.s, s }))
      .concat(evs.filter(e => !cSel || e.pid === cSel).map(e => ({ t: e.ts, e })))
      .concat(cSel ? [] : unk.map(u => ({ t: u.s, u }))).sort((a, b) => b.t - a.t).slice(0, 100);
    const list = rows.map(r => {
      if (r.e) return `<div class="row s${r.e.sev}"${r.e.pid && ok.has(r.e.pid) ? ` data-ui="tl-sel" data-pid="${r.e.pid}"` : ""}><span class="t">${E(shortStamp(r.t))}</span><span class="k">${E(r.e.cat)}</span><span class="m">${E(r.e.text)}</span></div>`;
      if (r.u) return `<div class="row s0"><span class="t">${E(shortStamp(r.t))}</span><span class="k">${E(durTxt(r.u.e - r.u.s))}</span><span class="m"><span class="ty bg-grey">UNKNOWN</span> UNKNOWN #${r.u.no} @ ${E(r.u.cam)}</span></div>`;
      const s = r.s, q = personById(s.pid);
      return `<div class="row"><span class="t">${E(shortStamp(s.s))}</span><span class="k">${E(durTxt(s.e - s.s))}</span><span class="m">${tyTag(s.type || q.type)} ${E(pName(q))} @ ${E(s.cam)}${now - s.e < SIGHT_GAP ? ` <span class="live">// LIVE</span>` : ""}</span></div>`;
    }).join("");
    return bar + `<svg viewBox="0 0 ${w} ${h}" height="${h}">${ticks}
      <text x="4" y="${20 + HT - 2}" class="ax">THREAT LEVEL</text><rect class="lane" x="${LW}" y="20" width="${tw}" height="${HT}"/>${strip}
      <text x="4" y="${ey + LH / 2 + 4}" class="ax">EVENTS</text><rect class="lane" x="${LW}" y="${ey + 2}" width="${tw}" height="${LH - 4}"/>${marks}
      ${laneSvg}${unkSvg}${live ? `<line class="now" x1="${X(to)}" x2="${X(to)}" y1="16" y2="${h}"/>` : ""}</svg>${legend}
      ${rows.length ? `<div class="lbl">SIGHTINGS AND EVENTS // ${rows.length}${rows.length === 100 ? "+" : ""}</div><div id="cLog">${list}</div>` : `<div class="empty">NOTHING RECORDED IN THIS WINDOW</div>`}`;
  }
  UI.pages.TIMELINE = {
    html: timeline,
    click(b) {
      const span = C_RANGES[cRange], now = Date.now(), k = b.dataset.ui;
      if (k === "tl-prev") tlEnd = (tlEnd == null ? now : tlEnd) - span / 2;
      else if (k === "tl-next") { tlEnd = (tlEnd == null ? now : tlEnd) + span / 2; if (tlEnd >= now) tlEnd = null; }
      else if (k === "tl-now") tlEnd = null;
      else if (k === "tl-sel") cSel = cSel === b.dataset.pid ? null : b.dataset.pid;
    },
  };

  /* =================== NETWORK =================== */
  let netW = 0, netH = 0, drag = null, pinned = {};
  const isThreat = (p, a) => /THREAT/.test(p.type) || (a && !a.trusted && a.score >= 60);
  function layout(nodes, edges, w, h) {
    const pos = {};
    nodes.forEach((p, i) => { const o = cNetPos[p.id], a = i / nodes.length * Math.PI * 2;
      pos[p.id] = o ? { x: o.x * w, y: o.y * h } : { x: w / 2 + Math.cos(a) * w * .28, y: h / 2 + Math.sin(a) * h * .28 }; });
    const k = Math.min(150, Math.sqrt(w * h / Math.max(1, nodes.length)) * .62);
    for (let it = 0; it < 260; it++) {
      const t = 1 - it / 260, d = {};
      nodes.forEach(p => d[p.id] = { x: (w / 2 - pos[p.id].x) * .05, y: (h / 2 - pos[p.id].y) * .08 });   // zwaartekracht houdt losse groepjes bij het midden
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const A = pos[nodes[i].id], B = pos[nodes[j].id], dx = A.x - B.x || .1, dy = A.y - B.y || .1, r = Math.max(8, Math.hypot(dx, dy)), f = r > 2.2 * k ? 0 : k * k / r / r;   // ver weg = geen afstoting, anders drijven losse groepjes naar de rand
        d[nodes[i].id].x += dx * f; d[nodes[i].id].y += dy * f; d[nodes[j].id].x -= dx * f; d[nodes[j].id].y -= dy * f;
      }
      for (const e of edges) {
        const A = pos[e.a], B = pos[e.b], dx = A.x - B.x, dy = A.y - B.y, r = Math.max(1, Math.hypot(dx, dy));
        const f = r / k * (e.l.rel ? .9 : Math.min(.9, .3 + Math.log2(1 + e.l.n) * .15));
        d[e.a].x -= dx * f; d[e.a].y -= dy * f; d[e.b].x += dx * f; d[e.b].y += dy * f;
      }
      nodes.forEach(p => { if (pinned[p.id]) return; const v = d[p.id], m = Math.hypot(v.x, v.y) || 1, s = Math.min(m, 14 * t + .5);
        pos[p.id].x = Math.min(w - 60, Math.max(60, pos[p.id].x + v.x / m * s)); pos[p.id].y = Math.min(h - 40, Math.max(34, pos[p.id].y + v.y / m * s)); });
    }
    nodes.forEach(p => cNetPos[p.id] = { x: pos[p.id].x / w, y: pos[p.id].y / h });
    return pos;
  }
  function network(W) {
    const nodes = cPeople(), ids = nodes.map(p => p.id), idSet = new Set(ids);
    if (!nodes.length) return `<div class="empty">NO REGISTERED SUBJECTS</div>`;
    const byId = UI.assess().byId, present = UI.presentIds();
    const edges = Object.entries(links).map(([k, l]) => ({ a: k.split("|")[0], b: k.split("|")[1], l })).filter(e => idSet.has(e.a) && idSet.has(e.b) && (e.l.n || e.l.rel));
    const w = netW = Math.max(320, W - (W > 700 ? 292 : 0)), h = netH = Math.max(340, Math.min(640, Math.round(w * .62)));
    const pos = layout(nodes, edges, w, h);
    const adj = G.adjacency(links, ids), threats = nodes.filter(p => isThreat(p, byId[p.id])).map(p => p.id);
    const dist = G.hops(adj, threats), keyIds = new Set(G.connectors(adj, ids));
    // keten van de geselecteerde persoon naar de dichtstbijzijnde dreiging
    let chain = null;
    if (cSel && idSet.has(cSel) && !threats.includes(cSel)) for (const t of threats) { const p = G.path(adj, cSel, t); if (p && (!chain || p.length < chain.length)) chain = p; }
    const inChain = (a, b) => chain && chain.some((x, i) => i && ((x === a && chain[i - 1] === b) || (x === b && chain[i - 1] === a)));
    const on = e => cSel && (e.a === cSel || e.b === cSel);
    const lines = edges.map(e => {
      const A = pos[e.a], B = pos[e.b], sw = e.l.rel ? 2 : Math.min(5, 1 + Math.log2(1 + e.l.n)), ch = inChain(e.a, e.b), dim = cSel && !on(e) && !ch;
      const tip = `${pName(personById(e.a))} - ${pName(personById(e.b))}${e.l.rel ? `\n${e.l.rel.toUpperCase()}` : ""}${e.l.n ? `\nSEEN TOGETHER ${e.l.n}x (${durTxt(e.l.secs * 1000)})` : ""}`;
      return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${ch ? "var(--red)" : on(e) ? "var(--yellow)" : e.l.rel ? "var(--white)" : "#777"}" stroke-width="${ch ? sw + 1 : sw}" stroke-opacity="${dim ? .18 : .9}"${e.l.rel ? "" : ` stroke-dasharray="4 4"`}><title>${E(tip)}</title></line>` +
        (e.l.rel && !dim ? `<text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 - 4}" text-anchor="middle" class="ax">${E(e.l.rel.toUpperCase().slice(0, 24))}</text>` : "");
    }).join("");
    const dots = nodes.map(p => {
      const { x, y } = pos[p.id], c = TYPES[p.type].color, sel = p.id === cSel, a = byId[p.id], deg = (adj[p.id] || []).length;
      const Sz = 24 + Math.min(12, deg * 3), dim = cSel && !sel && !edges.some(e => on(e) && (e.a === p.id || e.b === p.id)) && !(chain && chain.includes(p.id));
      const br = (sx, sy) => `M${x + sx * Sz / 2} ${y + sy * (Sz / 2 - 7)}V${y + sy * Sz / 2}H${x + sx * (Sz / 2 - 7)}`;
      const sc = a && !a.trusted ? a.score : 0, R = Sz / 2 + 8, circ = 2 * Math.PI * R;
      const ring = sc >= 5 ? `<circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="#222" stroke-width="3"/><circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="${lvlCol(sc)}" stroke-width="3" stroke-dasharray="${circ * sc / 100} ${circ}" transform="rotate(-90 ${x} ${y})"/>` : "";
      const nr = S.numbers.list.find(n => n.pid === p.id && n.status === "ACTIVE");
      return `<g class="nd" data-pid="${p.id}" opacity="${dim ? .3 : 1}">${ring}<rect x="${x - Sz / 2}" y="${y - Sz / 2}" width="${Sz}" height="${Sz}" fill="#000" stroke="${c}" stroke-dasharray="3 3" stroke-opacity=".7"/>
        <path d="${br(-1, -1)} ${br(1, -1)} ${br(-1, 1)} ${br(1, 1)}" fill="none" stroke="${c}" stroke-width="${sel ? 4 : 2.5}"/>
        ${present.has(p.id) ? `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--green)"><animate attributeName="opacity" values="1;.2;1" dur="1.4s" repeatCount="indefinite"/></circle>` : ""}
        ${keyIds.has(p.id) ? `<text x="${x + Sz / 2 + 4}" y="${y - Sz / 2 + 2}" style="fill:var(--yellow);font-size:10px">KEY</text>` : ""}
        ${nr ? `<text x="${x}" y="${y - R - 5}" text-anchor="middle" style="fill:${nr.list === "RELEVANT" ? "var(--red)" : "var(--white)"};font-size:10px">${E(nr.ssn)}</text>` : ""}
        <text x="${x}" y="${y + R + 12}" text-anchor="middle" style="fill:${c}">${E(pName(p).slice(0, 16))}</text><title>${E(`${pName(p)} // ${p.type}${sc ? ` // THREAT ${Math.round(sc)}%` : ""}\nDRAG TO MOVE`)}</title></g>`;
    }).join("");
    const sp = cSel && personById(cSel), comps = G.components(adj, ids).filter(c => c.length > 1);
    const row = (l, v, col) => `<div class="row"><span>${l}</span><span class="v"${col ? ` style="color:${col}"` : ""}>${v}</span></div>`;
    let info;
    if (sp && idSet.has(sp.id)) {
      const a = byId[sp.id], d = dist[sp.id];
      info = `<div class="lbl" style="margin-top:0">SUBJECT</div><div>${tyTag(sp.type)} ${E(pName(sp))}</div>
        ${a ? (a.trusted ? row("THREAT", "TRUSTED", "var(--green)") : row("THREAT", `${Math.round(a.score)}% ${a.level}`, UI.levelColor(a.level))) + row("RISK", `${Math.round(a.risk)}% ${a.riskLevel}`, UI.levelColor(a.riskLevel)) : ""}
        ${row("DISTANCE TO THREAT", threats.includes(sp.id) ? "IS A THREAT" : d === undefined ? "NO PATH" : d === 1 ? "DIRECT CONTACT" : `${d} STEPS`, d !== undefined && d <= 1 ? "var(--red)" : d === 2 ? "var(--yellow)" : "var(--grey)")}
        ${chain ? `<div class="ax" style="font-size:10px;line-height:1.5">CHAIN: ${chain.map(id => E(pName(personById(id)))).join(" &gt; ")}</div>` : ""}
        ${keyIds.has(sp.id) ? `<div class="ax" style="font-size:10px;color:var(--yellow)">KEY FIGURE // GROUP FALLS APART WITHOUT THIS SUBJECT</div>` : ""}
        <div class="lbl">CONNECTIONS</div>${linksOf(sp).filter(l => idSet.has(l.other.id)).map(l => `<div class="row"><span>${E(pName(l.other))}${l.rel ? ` <span class="ax">// ${E(l.rel.toUpperCase())}</span>` : ""}</span><span class="v">${l.n ? `${l.n}x ${durTxt(l.secs * 1000)}` : "--"}</span></div>
          ${l.n ? `<div class="row ax" style="font-size:10px"><span>${E((l.cams || []).join(", "))}</span><span>${E(ago(l.last))}</span></div>` : ""}`).join("") || `<div class="empty">NO KNOWN CONNECTIONS</div>`}
        <div class="lbl">ACTIONS</div><button data-go="TIMELINE">TIMELINE</button> <button data-file="1">FILE</button> <button data-sel="">CLEAR</button>`;
    } else {
      const near = nodes.filter(p => dist[p.id] === 1 && !UI.assess().byId[p.id]?.trusted).map(p => pName(p));
      info = `<div class="lbl" style="margin-top:0">NETWORK // ${nodes.length} SUBJECTS // ${edges.length} LINKS</div>
        ${row("GROUPS", comps.length || "--")}${row("THREATS", threats.length || "--", threats.length ? "var(--red)" : "")}
        ${row("IN CONTACT WITH A THREAT", near.length || "--", near.length ? "var(--yellow)" : "")}
        ${near.length ? `<div class="ax" style="font-size:10px;line-height:1.5">${E(near.join(", "))}</div>` : ""}
        ${keyIds.size ? row("KEY FIGURES", E([...keyIds].map(id => pName(personById(id))).join(", ")), "var(--yellow)") : ""}
        <div class="lbl">LEGEND</div><div class="ax" style="line-height:1.6;font-size:10px">CLICK A SUBJECT FOR ITS CONNECTIONS. DRAG TO MOVE.<br>- - -  SEEN TOGETHER ON THE SAME CAMERA<br>———  KNOWN RELATION (/link a + b relation)<br>RING = THREAT SCORE // RED LINE = CHAIN TO NEAREST THREAT<br>GREEN DOT = IN VIEW NOW // KEY = HOLDS A GROUP TOGETHER</div>
        ${Object.keys(pinned).length ? `<div class="lbl">LAYOUT</div><button data-ui="net-reset">RESET LAYOUT</button>` : ""}`;
    }
    return `<div id="cNet"><div class="graph"><svg id="cNetSvg" viewBox="0 0 ${w} ${h}" height="${h}">${lines}${dots}</svg></div><div class="info"${sp ? ` data-pid="${sp.id}"` : ""}>${info}</div></div>`;
  }
  UI.pages.NETWORK = { html: network, click(b) { if (b.dataset.ui === "net-reset") { pinned = {}; for (const k of Object.keys(cNetPos)) delete cNetPos[k]; } } };

  // verslepen: knooppunt vastpakken, loslaten = vastgezet op die plek
  const con = $("console");
  con.addEventListener("pointerdown", e => {
    if (cTab !== "NETWORK") return;
    const g = e.target.closest("#cNetSvg .nd"); if (!g) return;
    drag = { pid: g.dataset.pid, x: e.clientX, y: e.clientY, moved: false };
  });
  addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    const svg = $("cNetSvg"); if (!svg) { drag = null; return; }
    drag.moved = true;
    const r = svg.getBoundingClientRect();
    cNetPos[drag.pid] = { x: Math.min(.97, Math.max(.03, (e.clientX - r.left) / r.width)), y: Math.min(.95, Math.max(.05, (e.clientY - r.top) / r.height)) };
    pinned[drag.pid] = true;
    renderConsole(false);
  });
  addEventListener("pointerup", () => { if (drag && drag.moved) { const stop = ev => { ev.stopPropagation(); con.removeEventListener("click", stop, true); }; con.addEventListener("click", stop, true); setTimeout(() => con.removeEventListener("click", stop, true), 50); } drag = null; });
  // het netwerk elke 4 seconden verversen (ring, in beeld, nummers), behalve tijdens slepen
  setInterval(() => { if (cOpen && cTab === "NETWORK" && !drag) renderConsole(false); }, 4000);
})();
