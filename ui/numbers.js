// THE MACHINE // CORE: de nummers in beeld. Console-pagina NUMBERS (RELEVANT- en IRRELEVANT-lijst),
// de melding bij een nieuw nummer en de commando's /numbers en /number.
(function () {
  "use strict";
  const UI = window.MachineUI, C = MachineCore, N = C.numbers, U = C.util, S = UI.S, E = s => escapeHtml(String(s));
  const ROLE_BAR = { PERPETRATOR: "bg-red", VICTIM: "bg-yellow", UNDETERMINED: "bg-grey" };
  const WHY = { CLASSIFICATION: "CLASSIFICATION", WEAPON: "WEAPON HISTORY", CASES: "CASE INVOLVEMENT", VIOLATIONS: "ACCESS VIOLATIONS", DEVIATIONS: "BEHAVIOURAL DEVIATIONS",
                ASSOCIATION: "NETWORK ASSOCIATION", EXPOSURE: "EXPOSURE TO THREAT", BYSTANDER: "PRESENT AT INCIDENT", SIGNALS: "WARNING SIGNALS", TARGETED: "THREAT TO SYSTEM ACTIVE" };
  let sel = null, show = "ACTIVE", reason = "";
  const mayClose = role => mayCloseCase(role);
  // naam van de persoon achter een nummer, alleen als deze rol dat dossier mag zien
  const who = (n, role) => { const p = personById(n.pid); return !p ? "FORGOTTEN SUBJECT" : mayViewFile(role, p) ? pName(p) : "RESTRICTED"; };
  const findNr = s => { const q = String(s || "").replace(/^#/, ""); return S.numbers.list.find(n => String(n.seq) === q || n.ssn === q) || null; };

  function card(n) {
    const p = personById(n.pid), may = p && mayViewFile(cRole, p), open = sel === n.seq, m = may ? memory[p.id] || {} : {};
    const col = v => UI.levelColor(U.levelOf(v));
    return `<div class="card${open ? " sel" : ""}" data-ui="num-sel" data-nr="${n.seq}"${may ? ` data-pid="${p.id}"` : ""}>
      <div class="top"><div><div class="ssn">${E(n.ssn)}</div><div class="meta">NO. ${n.seq} // ISSUED ${E(ago(n.issuedAt))}</div></div>
        <span class="role ${ROLE_BAR[n.role] || "bg-grey"}">${n.role}</span></div>
      <div class="who">${may ? tyTag(p.type) + " " : ""}${E(who(n, cRole))}${may && UI.presentIds().has(p.id) ? ` <span class="live">// IN VIEW</span>` : may && m.lastSeen ? ` <span class="meta">// SEEN ${E(ago(m.lastSeen))}</span>` : ""}</div>
      <div class="row"><span>THREAT</span><span style="color:${col(n.score)}">${Math.round(n.score)}%</span></div><div class="tbar"><i style="width:${Math.max(2, n.score)}%;background:${col(n.score)}"></i></div>
      <div class="row"><span>RISK</span><span style="color:${col(n.risk)}">${Math.round(n.risk)}%</span></div><div class="tbar"><i style="width:${Math.max(2, n.risk)}%;background:${col(n.risk)}"></i></div>
      <div class="meta">${may ? E((n.why || []).map(k => WHY[k] || k).join(" // ") || "--") : "DETAILS RESTRICTED"}</div>
      ${open ? `<div class="hist">${n.history.slice().reverse().map(h => `<div>${E(shortStamp(h.ts))} &nbsp; ${E(h.text)}</div>`).join("")}</div>
        <div class="act">${may ? `<button data-file="1">FILE</button><button data-go="TIMELINE">TIMELINE</button><button data-go="NETWORK">NETWORK</button>` : ""}
        ${mayClose(cRole) ? `<input id="cNumWhy" value="${E(reason)}" placeholder="reason..." spellcheck="false"><button data-ui="num-close" data-nr="${n.seq}">CLOSE NUMBER</button>` : ""}</div>` : ""}
    </div>`;
  }
  UI.pages.NUMBERS = {
    html() {
      const act = N.active(S.numbers), rel = act.filter(n => n.list === "RELEVANT"), irr = act.filter(n => n.list !== "RELEVANT");
      const old = S.numbers.list.filter(n => n.status !== "ACTIVE").sort((a, b) => b.resolvedAt - a.resolvedAt).slice(0, 40);
      const colHtml = (cls, title, list, none) => `<div class="col ${cls}"><div class="hd">${title} // ${list.length}</div>${list.map(card).join("") || `<div class="nonef">${none}</div>`}</div>`;
      return `<div class="bar2">${act.length} ACTIVE NUMBER${act.length === 1 ? "" : "S"} // ${S.numbers.list.length - act.length} RESOLVED // CLEARANCE ${E(cRole)}
          &nbsp; SHOW ${["ACTIVE", "ALL"].map(s => `<button data-ui="num-show" data-v="${s}" class="${s === show ? "on" : ""}">${s}</button>`).join("")}</div>
        <div id="cNum">${colHtml("rel", "RELEVANT", rel, "NO RELEVANT NUMBERS")}${colHtml("irr", "IRRELEVANT", irr, "NO IRRELEVANT NUMBERS")}</div>
        ${!act.length ? `<div class="ax" style="color:var(--grey);line-height:1.6;margin-top:6px">A NUMBER COMES UP WHEN SOMEONE IS LIKELY TO BE INVOLVED IN A THREAT, AS PERPETRATOR (THREAT 60%+) OR AS VICTIM (RISK 50%+),<br>AND WAS SEEN IN THE LAST 24 HOURS. IT RESOLVES BY ITSELF WHEN THE THREAT SUBSIDES.</div>` : ""}
        ${show === "ALL" ? `<div class="lbl">RESOLVED // ${old.length}</div><div id="cNumOld">${old.length ? `<table><tr><th>NO.</th><th>NUMBER</th><th>SUBJECT</th><th>ROLE</th><th>LIST</th><th>PEAK</th><th>ISSUED</th><th>RESOLVED</th><th>REASON</th></tr>
          ${old.map(n => `<tr><td>${n.seq}</td><td>${E(n.ssn)}</td><td>${E(who(n, cRole))}</td><td>${n.role}</td><td>${n.list}</td><td>${Math.round(n.peak)}%</td><td>${E(shortStamp(n.issuedAt))}</td><td>${E(shortStamp(n.resolvedAt))}</td><td>${E(n.reason || "")}${n.closedBy ? ` <span style="color:var(--grey)">// ${E(n.closedBy)}</span>` : ""}</td></tr>`).join("")}</table>`
          : `<div class="empty">NO RESOLVED NUMBERS</div>`}</div>` : ""}`;
    },
    click(b) {
      const ui = b.dataset.ui;
      if (ui === "num-show") show = b.dataset.v;
      if (ui === "num-sel") { const nr = +b.dataset.nr; if (sel !== nr) reason = ""; sel = sel === nr ? null : nr; }
      if (ui === "num-close" && mayClose(cRole)) closeNumber(findNr(b.dataset.nr), cRole, reason);
    },
  };
  $("console").addEventListener("input", e => { if (e.target.id === "cNumWhy") reason = e.target.value; });
  $("console").addEventListener("keydown", e => { if (e.target.id === "cNumWhy" && e.key === "Enter" && mayClose(cRole)) { closeNumber(findNr(sel), cRole, reason); renderConsole(false); } });

  function closeNumber(n, by, why) {
    const c = n && N.close(S.numbers, n.seq, by, why, Date.now());
    if (!c) return null;
    reason = ""; UI.markDirty("numbers"); UI.persist();
    UI.emit("NUMBER", 1, `NUMBER ${c.ssn} CLOSED BY ${by} // ${c.reason}`, { pid: personById(c.pid) ? c.pid : undefined, nr: c.seq, kind: "RESOLVED" });
    return c;
  }

  /* ---------- melding bij een nieuw nummer ---------- */
  let cardTimer = null;
  UI.listeners.push(ev => {
    if (ev.cat !== "NUMBER" || ev.kind !== "ISSUED") return;
    const n = S.numbers.list.find(x => x.seq === ev.nr);
    if (!n) return;
    const role = currentRole(), name = who(n, role), el = $("numCard");
    el.className = "on" + (n.list === "RELEVANT" ? " rel" : "");
    el.innerHTML = `<div class="h">NEW NUMBER</div><div class="ssn">${E(n.ssn)}</div><div class="who">${E(name)}</div><div class="meta">${n.role} // ${n.list} LIST // /numbers</div>`;
    clearTimeout(cardTimer); cardTimer = setTimeout(() => { el.className = ""; }, 9000);
    if (terminalReady) print(`NEW NUMBER // ${n.ssn} // ${name} // ${n.role} // ${n.list}`, n.list === "RELEVANT" ? "err" : "warn");
  });

  /* ---------- commando's ---------- */
  UI.commands["/numbers"] = async () => { openConsole("NUMBERS", currentRole()); print(`CONSOLE // NUMBERS   (F2 / Esc closes, 1-${C_TABS.length} = page)`, "ok"); };
  UI.commands["/number"] = async args => {
    const role = currentRole(), n = findNr(args[0]), act = (args[1] || "").toLowerCase();
    if (!n) {
      const list = N.active(S.numbers);
      if (args[0]) { print(`NUMBER ${args[0]} NOT FOUND`, "err"); return; }
      if (!list.length) { print("NO ACTIVE NUMBERS.   Usage: /number <nr> [close [reason]]"); return; }
      print(`ACTIVE NUMBERS // ${list.length}   (/number <nr> [close [reason]])`);
      print(list.map(x => `${String(x.seq).padStart(3)}  ${x.ssn}  ${x.list.padEnd(10)} ${x.role.padEnd(12)} ${who(x, role)}`).join("\n"), "warn");
      return;
    }
    if (["close", "sluit", "dicht"].includes(act)) {
      if (!mayClose(role)) { print(`ACCESS DENIED // ${role} CLEARANCE INSUFFICIENT`, "err"); return; }
      if (n.status !== "ACTIVE") { print(`NUMBER ${n.ssn} IS ALREADY RESOLVED`, "warn"); return; }
      closeNumber(n, role, args.slice(2).join(" "));
      print(`NUMBER ${n.ssn} CLOSED`, "ok");
      if (cOpen) renderConsole(false);
      return;
    }
    const p = personById(n.pid), may = p && mayViewFile(role, p);
    print(`NUMBER ${n.ssn} // NO. ${n.seq} // ${n.status}\n${who(n, role)} // ${n.role} // ${n.list} LIST\nTHREAT ${Math.round(n.score)}%  RISK ${Math.round(n.risk)}%  PEAK ${Math.round(n.peak)}%` +
      (may ? `\nWHY ${(n.why || []).map(k => WHY[k] || k).join(", ") || "--"}` : "") + "\n" + n.history.map(h => `${shortStamp(h.ts)}  ${h.text}`).join("\n"), n.status === "ACTIVE" ? "warn" : "sys");
    sel = n.seq;
  };
  UI.numberWho = who;
})();
