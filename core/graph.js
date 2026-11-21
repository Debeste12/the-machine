// THE MACHINE // CORE: het netwerk als graaf. Wie hangt met wie samen, hoe ver staat iemand van een dreiging af,
// via wie zijn twee mensen verbonden en wie houdt een groep bij elkaar.
// links = { "idA|idB": { n, rel, ... } }  (n = keer samen gezien, rel = ingevulde relatie)
(function (g) {
  const C = g.MachineCore = g.MachineCore || {};

  // -> { id: [buur-id's] } voor alle id's; opts.minN = minimaal zo vaak samen gezien (een ingevulde relatie telt altijd)
  function adjacency(links, ids, opts) {
    const minN = opts && opts.minN || 1, adj = {};
    for (const id of ids) adj[id] = [];
    for (const k of Object.keys(links || {})) {
      const [a, b] = k.split("|"), l = links[k];
      if (!adj[a] || !adj[b] || a === b || !(l.rel || (l.n || 0) >= minN)) continue;
      if (!adj[a].includes(b)) adj[a].push(b);
      if (!adj[b].includes(a)) adj[b].push(a);
    }
    return adj;
  }
  // aantal stappen tot de dichtstbijzijnde bron (breedte-eerst); wie niet bereikbaar is ontbreekt
  function hops(adj, sources) {
    const dist = {}, queue = [];
    for (const s of sources) if (adj[s] && dist[s] === undefined) { dist[s] = 0; queue.push(s); }
    for (let i = 0; i < queue.length; i++) for (const n of adj[queue[i]]) if (dist[n] === undefined) { dist[n] = dist[queue[i]] + 1; queue.push(n); }
    return dist;
  }
  // kortste keten van a naar b: [a, ..., b], of null
  function path(adj, a, b) {
    if (!adj[a] || !adj[b]) return null;
    const prev = { [a]: null }, queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i];
      if (x === b) { const out = []; for (let y = b; y != null; y = prev[y]) out.unshift(y); return out; }
      for (const n of adj[x]) if (!(n in prev)) { prev[n] = x; queue.push(n); }
    }
    return null;
  }
  function components(adj, ids, skip) {
    const seen = new Set(skip ? [skip] : []), out = [];
    for (const id of ids) {
      if (seen.has(id) || !adj[id]) continue;
      const comp = [id]; seen.add(id);
      for (let i = 0; i < comp.length; i++) for (const n of adj[comp[i]]) if (!seen.has(n)) { seen.add(n); comp.push(n); }
      out.push(comp);
    }
    return out.sort((x, y) => y.length - x.length);
  }
  // mensen zonder wie hun groep in losse delen uiteenvalt
  function connectors(adj, ids) {
    const base = components(adj, ids).length, out = [];
    for (const id of ids) if (adj[id] && adj[id].length >= 2 && components(adj, ids, id).length > base) out.push(id);
    return out;
  }

  C.graph = { adjacency, hops, path, components, connectors };
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof globalThis !== "undefined" ? globalThis : self);
