// THE MACHINE // CORE: gedeelde hulpfuncties. Geen DOM, werkt in de browser en in Node (tests).
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  // vaste willekeurige reeks per seed (voor de simulatie en herhaalbare tests)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // meerdere losse aanwijzingen samen: 1 - (1-w1)(1-w2)...  Blijft altijd onder de 1 en elke aanwijzing telt mee.
  const noisyOr = ws => 1 - ws.reduce((p, w) => p * (1 - clamp(w, 0, 1)), 1);
  // hoeveel een gebeurtenis van `age` ms oud nog telt, bij een halfwaardetijd
  const decay = (age, halfLife) => age <= 0 ? 1 : Math.pow(0.5, age / halfLife);
  const pad2 = n => String(n).padStart(2, "0");
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function hash32(s) {                      // FNV-1a
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  // "Nummer" zoals in de serie, maar verzonnen: 9xx-xx-xxxx (de 900-reeks wordt niet als echt nummer uitgegeven).
  function ssnFor(id) {
    const h = hash32(String(id)), h2 = hash32(String(id) + "#");
    return `${900 + h % 100}-${pad2(1 + (h >>> 8) % 99)}-${String(1 + h2 % 9999).padStart(4, "0")}`;
  }
  const levelOf = score => score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "ELEVATED" : "LOW";
  const round1 = x => Math.round(x * 10) / 10;

  C.util = { MIN, HOUR, DAY, clamp, mulberry32, noisyOr, decay, pad2, dayKey, startOfDay, hash32, ssnFor, levelOf, round1 };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
