// THE MACHINE // CORE: vragen beantwoorden uit het eigen geheugen.
// - UI.factsFor(vraag): echte feiten (wie, waar, wanneer, nummers, zaken) die bij de vraag passen; die gaan mee
//   in de opdracht aan het taalmodel, zodat het antwoord klopt in plaats van verzonnen is.
// - /briefing: situatierapport, altijd uit de feiten opgebouwd (werkt dus ook zonder Ollama); met Ollama komt er
//   een korte beoordeling in woorden achteraan.
// - Zonder Ollama geeft een gewone vraag de feiten zelf terug in plaats van alleen een foutmelding.
// Iedereen krijgt alleen te zien wat de eigen rol mag inzien (zelfde regels als de dossiers).
(function () {
  "use strict";
  const UI = window.MachineUI, C = MachineCore, Q = C.query, S = UI.S;
  function world(role) {
    const now = Date.now(), ok = people.filter(p => mayViewFile(role, p)), ids = new Set(ok.map(p => p.id));
    const amb = UI.ambient();
    return { now, people: ok, memory, sightings: sightings.filter(s => ids.has(s.pid)), links, cases: cases.filter(c => mayViewCase ? mayViewCase(role, c) : true),
      events: S.events.filter(e => UI.visible(e, role)), numbers: S.numbers.list.filter(n => ids.has(n.pid)), unknowns: S.unknowns,
      byId: UI.assess().byId, present: UI.presentIds(), level: { tl: S.tl, pct: Math.round(S.level * 100), reasons: amb ? amb.reasons : [] },
      cams: feeds.map(f => f.tag) };
  }
  const name = p => pName(p);
  UI.world = world;
  UI.factsFor = q => { try { return Q.facts(world(currentRole()), { question: q, name }); } catch (e) { console.error("CORE // facts", e); return ""; } };

  // Ollama uit: antwoord rechtstreeks uit de feiten
  UI.offline = text => {
    const lines = Q.facts(world(currentRole()), { question: text, name }).split("\n").slice(1).filter(Boolean);
    print("AI CORE OFFLINE // ANSWERING FROM SURVEILLANCE MEMORY", "warn");
    for (const l of lines.slice(0, 14)) print(l.replace(/^- /, "").toUpperCase(), "machine");
    return true;
  };

  UI.commands["/briefing"] = async () => {
    const role = currentRole(), w = world(role), lines = Q.briefing(w, { lang, name });
    lines.forEach((l, i) => print(l, i === 0 ? "ok" : /^\s/.test(l) ? "machine" : "warn"));
    UI.emit("SYSTEM", 0, `BRIEFING REQUESTED // ${role}`, { kind: "BRIEFING" });
    const verdict = lines[lines.length - 1].replace(/^[^:]*:\s*/, "");
    if (!model) return;
    // met taalmodel: twee zinnen beoordeling, alleen op basis van het rapport hierboven
    busy = true; processing(true);
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(OLLAMA + "/api/chat", { method: "POST", signal: ctl.signal, body: JSON.stringify({ model, stream: false, options: { temperature: 0.2, num_predict: 90 },
        messages: [{ role: "system", content: `You are The Machine from Person of Interest. Give your assessment of the situation report below in at most two short sentences, in ${lang === "nl" ? "Dutch" : "English"}. Use only what the report says. No greeting, no lists.` },
                   { role: "user", content: lines.join("\n") }] }) });
      clearTimeout(to);
      const text = r.ok ? ((await r.json()).message || {}).content || "" : "";
      if (text.trim()) await typeOut(text.trim().toUpperCase());
    } catch (e) { console.warn("briefing: taalmodel gaf geen antwoord", e); }
    busy = false; processing(false);
  };
})();
