// THE MACHINE // CORE: console-pagina LOG. Eén logboek voor alles, te filteren op categorie, ernst en tekst.
// Bron: de gebeurtenissenstroom (core/events.js), aangevuld met wat het origineel al bijhield
// (bezoekers en scans uit SURVEILLANCE, blokken van de tijdlijn, notities).
(function () {
  "use strict";
  const UI = window.MachineUI, EV = MachineCore.events, E = s => escapeHtml(String(s));
  const SEV_NAMES = ["ALL", "NOTICE+", "WARN+", "ALERT"];
  let cats = new Set(), minSev = 0;       // lege set = alle categorieën

  function entries(role) {
    const ok = new Set(people.filter(p => mayViewFile(role, p)).map(p => p.id)), out = [], now = Date.now();
    for (const e of UI.S.events) if (UI.visible(e, role)) out.push(e);
    for (const v of visits) {
      if (v.kind === "visit") { if (!v.pid || ok.has(v.pid)) out.push({ ts: v.ts, cat: "SUBJECT", sev: /THREAT/.test(v.tag || "") ? 2 : 0, text: `VISIT // ${v.tag} ${v.name} // ${v.secs}S` }); }
      else out.push({ ts: v.ts, cat: "SYSTEM", sev: /THREAT LEVEL (HIGH|CRITICAL)/.test(v.text || "") ? 2 : 0, text: `SCAN // ${v.text}` });
    }
    // een lopende waarneming krijgt IN VIEW in plaats van een meetikkende duur: zo blijft de pagina stil staan terwijl je leest
    for (const s of sightings.slice(-600)) {
      const p = personById(s.pid);
      if (p && ok.has(p.id)) out.push({ ts: s.s, cat: "SUBJECT", sev: /THREAT/.test(s.type || "") ? 1 : 0, text: `SIGHTING // ${s.type || p.type} ${pName(p)} @ ${s.cam} // ${now - s.e < SIGHT_GAP ? "IN VIEW" : durTxt(s.e - s.s)}` });
    }
    for (const p of people) {
      if (!ok.has(p.id)) continue;
      for (const n of (memory[p.id] || {}).notes || []) out.push({ ts: n.ts, cat: "MEMORY", sev: 0, text: `NOTE // ${pName(p)} // ${n.text}` });
    }
    return out;
  }
  UI.pages.LOG = {
    html() {
      const all = entries(cRole), f = cFilter.toLowerCase(), counts = {};
      const base = all.filter(e => e.ts && e.sev >= minSev && (!f || `${e.cat} ${e.text}`.toLowerCase().includes(f)));
      for (const e of base) counts[e.cat] = (counts[e.cat] || 0) + 1;
      const list = base.filter(e => !cats.size || cats.has(e.cat)).sort((a, b) => b.ts - a.ts).slice(0, 500);
      return `<div class="bar2">FILTER <input id="cFilt" value="${E(cFilter)}" placeholder="name, camera, threat..." spellcheck="false">
          &nbsp; SEVERITY ${SEV_NAMES.map((s, i) => `<button data-ui="log-sev" data-v="${i}" class="${i === minSev ? "on" : ""}">${s}</button>`).join("")}
          &nbsp; ${list.length}${list.length === 500 ? "+" : ""} EVENTS</div>
        <div class="bar2 chips"><button data-ui="log-cat" data-v="" class="${cats.size ? "" : "on"}">ALL<span class="n">${base.length}</span></button>
          ${EV.CATS.filter(c => counts[c] || cats.has(c)).map(c => `<button data-ui="log-cat" data-v="${c}" class="${cats.has(c) ? "on" : ""}">${c}<span class="n">${counts[c] || 0}</span></button>`).join("")}</div>
        <div id="cLog">${list.length ? list.map(e => `<div class="row s${e.sev}"><span class="t">${E(stamp(e.ts))}</span><span class="k">${e.cat}</span><span class="m">${E(String(e.text).toUpperCase())}</span></div>`).join("")
          : `<div class="empty">NO EVENTS</div>`}</div>`;
    },
    click(b) {
      if (b.dataset.ui === "log-sev") minSev = +b.dataset.v;
      if (b.dataset.ui === "log-cat") { const c = b.dataset.v; if (!c) cats = new Set(); else if (cats.has(c)) cats.delete(c); else cats.add(c); }
    },
  };
})();
