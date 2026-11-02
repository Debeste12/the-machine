// Wapenmodel (YOLOv8s, WeaponShield-AI, MIT: pistool / geweer / mes) in een eigen worker met een eigen
// onnxruntime, zodat het zware model YOLOX (personen volgen) en het stemmodel niet laat wachten.
// Het model staat in twee delen in models/ (bestanden boven 30 MB kunnen niet in één keer naar de pc).
importScripts("lib/ort/ort.wasm.min.js");
const PARTS = ["models/weapon_part_00", "models/weapon_part_01"];
const SIZE = 640, NMS = 0.5;
let net = null;

async function load() {
  ort.env.wasm.wasmPaths = new URL("lib/ort/", self.location.href).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const bufs = await Promise.all(PARTS.map(async p => {
    const r = await fetch(p);
    if (!r.ok) throw new Error(p + " HTTP " + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }));
  const all = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bufs) { all.set(b, o); o += b.length; }
  net = await ort.InferenceSession.create(all);
}

function iou(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return w * h / (a.w * a.h + b.w * b.h - w * h);
}

// uitgang [1, 7, 8400]: per vak cx, cy, w, h (in 640-pixels) en de kans per klasse (0 pistool, 1 geweer, 2 mes)
async function detect(input, min) {
  const out = (await net.run({ images: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) })).output0.data;
  const N = out.length / 7, dets = [];
  for (let i = 0; i < N; i++) {
    let cls = 0, score = out[4 * N + i];
    for (let c = 1; c < 3; c++) if (out[(4 + c) * N + i] > score) { score = out[(4 + c) * N + i]; cls = c; }
    if (score < min) continue;
    const w = out[2 * N + i], h = out[3 * N + i];
    dets.push({ x: out[i] - w / 2, y: out[N + i] - h / 2, w, h, cls, score });
  }
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) if (keep.every(k => k.cls !== d.cls || iou(k, d) < NMS)) keep.push(d);
  return keep.slice(0, 10);
}

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.load) { await load(); self.postMessage({ ready: true }); return; }
    const t0 = performance.now();
    const dets = await detect(m.input, m.min);
    self.postMessage({ id: m.id, dets, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};
