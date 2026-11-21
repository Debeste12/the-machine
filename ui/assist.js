// THE MACHINE // CORE: soepeler werken en meedenken (rekenwerk in core/assist.js).
// Terminal:  pijl omhoog/omlaag = eerdere commando's, Tab = aanvullen (commando's, namen, vaste woorden),
//            hulpregel boven de invoer terwijl je typt, Esc = regel leegmaken, "bedoelde je ...?" bij een tikfout.
// /watch:    volglijst; melding (alarm in beeld en in de terminal) zodra iemand van de lijst in beeld komt.
// /recap:    wat er gebeurd is terwijl je weg was; verschijnt vanzelf als je na een half uur of langer terugkomt.
// /expect:   wie The Machine op dit uur verwacht (uit de leefpatronen) en wie er nog niet is; ook op OVERVIEW.
(function () {
  "use strict";
  const UI = window.MachineUI, C = MachineCore, A = C.assist, P = C.patterns, U = C.util, S = UI.S, E = s => escapeHtml(String(s));
  const K_HIST = "machine.cmdhist", K_WATCH = "machine.watch", AWAY_MIN = 30 * U.MIN;

  /* =================== terminal: geschiedenis, Tab, hulpregel =================== */
  let hist = store.get(K_HIST, []), pos = null, draft = "", cyc = null;
  if (!Array.isArray(hist)) hist = [];
  const inp = $("in"), hint = document.createElement("div");
  hint.id = "inHint"; $("inRow").parentElement.insertBefore(hint, $("inRow"));
  const TAGS = Object.keys(TYPES).map(t => t.toLowerCase());
  const WORDS = { "/mode": MODES.map(m => m.toLowerCase()),
                  "/lang": ["en", "nl"], "/autodefense": ["on", "off"], "/console": C_TABS.map(t => t.toLowerCase()), "/watch": ["clear"], "/tag": TAGS, "/log": ["clear"] };
  // v = wat er nu staat: bij /changetag hoort na de naam een type, bij /watch na de naam "off"
  function ctx(v) {
    const role = currentRole();
    const commands = [...new Set([...PROTECTED, ...Object.keys(UI.commands), "/help", "/clear", "/status", "/lang", "/style", "/scan", "/lock"])].filter(c => !ALIAS[c]);
    let names = people.filter(p => mayViewFile(role, p)).map(p => p.name);
    const cmd = String(v || "").split(/\s+/)[0].toLowerCase();
    if (/^\/(changetag|retag)\s+\S+.*\s/i.test(v || "")) names = TAGS;
    else if (cmd === "/watch") { if (/^\/watch\s+\S+.*\s/i.test(v)) names = ["off"]; }
    else if (WORDS[cmd]) names = [];                             // commando met vaste woorden: geen namen erdoor
    return { commands, names, words: WORDS };
  }
  function showHint(list, active) {
    if (!list || !list.length) { hint.innerHTML = ""; return; }
    hint.innerHTML = list.slice(0, 8).map((l, i) => `<span class="${i === active ? "on" : ""}">${E(l.trim())}</span>`).join("") + (list.length > 8 ? `<span class="more">+${list.length - 8}</span>` : "") + `<span class="k">TAB</span>`;
  }
  function liveHint() {
    const v = inp.value;
    if (pendingSecret || !v.startsWith("/") || v.length < 2) return showHint(null);
    const r = A.complete(v, ctx(v));
    showHint(r.list.length === 1 && r.list[0].trim() === v.trim() ? null : r.list.map(l => v.includes(" ") ? l.slice(v.lastIndexOf(" ") + 1) : l));
  }
  inp.addEventListener("input", () => { cyc = null; pos = null; liveHint(); });
  inp.addEventListener("keydown", e => {
    if (pendingSecret) return;                                   // wachtwoordinvoer: nergens aankomen
    if (e.key === "Enter") {
      const t = inp.value.trim();
      if (t && !busy) { hist = A.remember(hist, t); store.set(K_HIST, hist); pos = null; draft = ""; cyc = null; showHint(null); }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (pos == null) draft = inp.value;
      const r = A.browse(hist, pos, e.key === "ArrowUp" ? -1 : 1);
      pos = r.pos; inp.value = r.text == null ? draft : r.text;
      inp.setSelectionRange(inp.value.length, inp.value.length); showHint(null); cyc = null;
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (cyc && cyc.list.length > 1) {                          // nog een keer Tab: door de mogelijkheden bladeren
        cyc.i = (cyc.i + (e.shiftKey ? cyc.list.length - 1 : 1)) % cyc.list.length;
        inp.value = cyc.list[cyc.i]; showHint(cyc.show, cyc.i); return;
      }
      const v = inp.value, r = A.complete(v, ctx(v));
      if (!r.list.length) return;
      if (r.list.length === 1) { inp.value = r.list[0]; showHint(null); cyc = null; return; }
      const show = r.list.map(l => v.includes(" ") ? l.slice(v.lastIndexOf(" ") + 1) : l);
      if (r.common.length > v.length) { inp.value = r.common; cyc = null; showHint(show); return; }
      cyc = { list: r.list, show, i: 0 }; inp.value = r.list[0]; showHint(show, 0);
      return;
    }
    if (e.key === "Escape" && inp.value && !cOpen) { inp.value = ""; pos = null; cyc = null; showHint(null); e.stopPropagation(); }
  }, true);
  // tikfout in een commando: het dichtstbijzijnde bestaande commando noemen
  UI.didYouMean = c => {
    const s = A.suggest(c, ctx().commands);
    if (s.length) setTimeout(() => print(`DID YOU MEAN ${s.join("  OR  ")} ?   (Tab completes commands)`, "warn"), 0);
  };

  /* =================== volglijst =================== */
  let watch = A.watchSanitize(store.get(K_WATCH, null), people);
  const saveWatch = () => store.set(K_WATCH, watch);
  UI.watched = pid => A.watched(watch, pid);
  function watchAlert(p, cam) {
    UI.emit("SUBJECT", 3, `WATCHLIST // ${pName(p)} // ${p.type} @ ${cam}`, { pid: p.id, cam, kind: "WATCH" });
    hudMessage(`WATCHLIST // ${pName(p)}`, "var(--red)", 4000);
    if (terminalReady) print(`WATCHLIST // ${pName(p)} IS IN VIEW @ ${cam}`, "err");
  }
  UI.listeners.push(ev => {
    if (ev.cat !== "SUBJECT" || ev.kind !== "ARRIVAL" || !ev.pid || !A.watched(watch, ev.pid)) return;
    const p = personById(ev.pid); if (!p) return;
    setTimeout(() => watchAlert(p, ev.cam || camNow()), 50);     // na de aankomstregel zelf
  });
  // op welke camera is iemand nu te zien (lopend blok van de tijdlijn), of null
  const camOf = pid => { const now = Date.now(); for (const e of openSight.values()) if (e.pid === pid && now - e.e < SIGHT_GAP) return e.cam; return null; };
  UI.commands["/watch"] = async args => {
    const role = currentRole(), a0 = (args[0] || "").toLowerCase();
    watch = A.watchSanitize(watch, people);
    if (!a0) {
      const ids = Object.keys(watch.ids).filter(id => mayViewFile(role, personById(id)));
      if (!ids.length) { print("WATCHLIST EMPTY.   /watch <name> = alert when that subject comes into view   /watch <name> off   /watch clear", "ok"); return; }
      print(`WATCHLIST // ${ids.length}   (/watch <name> off, /watch clear)`, "ok");
      const present = UI.presentIds();
      for (const id of ids) { const p = personById(id), m = memory[id] || {}; print(`  ${pName(p).padEnd(18)} ${p.type.padEnd(18)} ${present.has(id) ? "IN VIEW NOW" : m.lastSeen ? "LAST SEEN " + ago(m.lastSeen).toUpperCase() : "NEVER SEEN"}`, present.has(id) ? "err" : "machine"); }
      return;
    }
    if (a0 === "clear" || a0 === "wis") { watch = { ids: {} }; saveWatch(); print("WATCHLIST CLEARED", "ok"); return; }
    const last = (args[args.length - 1] || "").toLowerCase(), off = ["off", "uit", "remove"].includes(last) && args.length > 1;
    const p = resolvePerson(off ? args.slice(0, -1) : args).p;
    if (!p || !mayViewFile(role, p)) { print("SUBJECT NOT FOUND.   Usage: /watch <name>   /watch <name> off   /watch clear", "err"); return; }
    watch = A.watchToggle(watch, p.id, !off, Date.now(), role); saveWatch();
    print(off ? `${pName(p)} REMOVED FROM WATCHLIST` : `WATCHING ${pName(p)} // ALERT WHEN IN VIEW`, "ok");
    UI.emit("SUBJECT", 1, `WATCHLIST // ${pName(p)} ${off ? "REMOVED" : "ADDED"} BY ${role}`, { pid: p.id, kind: "PROFILE" });
    const cam = !off && camOf(p.id);
    if (cam) watchAlert(p, cam);                                 // staat hij er nu al: meteen melden, niet pas bij de volgende keer
    if (cOpen) renderConsole(false);
  };

  /* =================== terugblik =================== */
  function recapFor(role, from, to, self) {
    const w = UI.world(role);
    return A.recap({ people: w.people, sightings: w.sightings, events: w.events, unknowns: w.unknowns, up: S.up }, from, to, { name: pName, self });
  }
  function printRecap(r) {
    if (r.quiet) { print(`${r.lines[0]} // NOTHING TO REPORT`, "ok"); return; }
    r.lines.forEach((l, i) => print(l, i === 0 ? "ok" : /ALERT|WEAPON|CASE|NUMBER|THREAT/.test(l) && i > 1 ? "warn" : "machine"));
  }
  // iemand met rechten komt na een half uur of langer terug achter de pc
  const lastRecap = {};
  UI.listeners.push(ev => {
    if (ev.cat !== "SUBJECT" || ev.kind !== "ARRIVAL" || !ev.pid || !terminalReady) return;
    const p = personById(ev.pid); if (!p || !P.TRUSTED.has(p.type) || (ev.cam && ev.cam !== camNow())) return;
    let cur = null, prev = null;
    for (let i = sightings.length - 1; i >= 0; i--) if (sightings[i].pid === p.id) { if (!cur) cur = sightings[i]; else { prev = sightings[i]; break; } }
    const now = Date.now();
    if (!prev || now - prev.e < AWAY_MIN || now - (lastRecap[p.id] || 0) < AWAY_MIN) return;
    lastRecap[p.id] = now;
    const from = Math.max(prev.e, now - 3 * U.DAY);
    setTimeout(() => {
      const r = recapFor(p.type, from, now, p.id);
      print(`WELCOME BACK, ${pName(p)}.`, "ok");
      printRecap(r);
    }, 1500);
  });
  UI.commands["/recap"] = async args => {
    const h = Math.min(72, Math.max(0.25, parseFloat(args[0]) || 8)), now = Date.now(), me = speaker();
    printRecap(recapFor(currentRole(), now - h * U.HOUR, now, me && me.person ? me.person.id : null));
  };

  /* =================== verwachting =================== */
  let expAt = 0, expCache = [];
  function expectedNow(role) {
    const now = Date.now();
    if (now - expAt > 60000) {                                   // patronen veranderen langzaam: één keer per minuut is genoeg
      expCache = people.map(p => ({ id: p.id, profile: P.profile(sightings, p.id, { to: now }) }));
      expAt = now;
    }
    return A.expected(expCache, now, UI.presentIds()).filter(x => { const p = personById(x.id); return p && mayViewFile(role, p); });
  }
  UI.expectedHtml = role => {
    const list = expectedNow(role);
    if (!list.length) return "";
    const h = new Date().getHours();
    return `<div class="sub" style="margin-top:8px">EXPECTED ${U.pad2(h)}:00-${U.pad2((h + 1) % 24)}:00 // FROM PATTERN OF LIFE</div>` + list.slice(0, 5).map(x => { const p = personById(x.id);
      return `<div class="row p" data-pid="${p.id}" data-file="1" title="OPEN FILE"><span class="m" style="color:${TYPES[p.type].color}">${E(pName(p))} <span style="color:var(--grey)">${Math.round(x.share * 100)}% OF ${x.days} DAYS</span></span><span class="v" style="color:${x.here ? "var(--green)" : "var(--yellow)"}">${x.here ? "HERE" : "NOT YET"}</span></div>`; }).join("");
  };
  UI.commands["/expect"] = async () => {
    const list = expectedNow(currentRole()), h = new Date().getHours();
    if (!list.length) { print(`NO ONE EXPECTED ${U.pad2(h)}:00-${U.pad2((h + 1) % 24)}:00.   (needs 5 days of history per subject)`, "ok"); return; }
    print(`EXPECTED ${U.pad2(h)}:00-${U.pad2((h + 1) % 24)}:00 // FROM PATTERN OF LIFE`, "ok");
    for (const x of list) { const p = personById(x.id); print(`  ${pName(p).padEnd(18)} ${String(Math.round(x.share * 100)).padStart(3)}% OF ${x.days} DAYS   ${x.here ? "HERE" : "NOT YET SEEN"}`, x.here ? "machine" : "warn"); }
  };
  UI.assist = { history: () => hist.slice(), ctx, expectedNow, watchList: () => Object.keys(watch.ids) };
})();
