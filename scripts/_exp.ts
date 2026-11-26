import { renderScene, projectRect, cornerError, type Sahne } from "../tests/helpers/tarama-sentetik";
import { detectDocument, detectCandidates } from "../src/lib/scan/detect";
import { scanDocument } from "../src/lib/scan";
import type { Quad, RgbaImage } from "../src/lib/scan/image";

const OUT = "/tmp/claude-0/-workspace-lafmaliyet/e7df09e3-6394-5a70-b51c-7ee8e4dca445/scratchpad/exp";
async function save(name: string, img: RgbaImage, q?: Quad | null, q2?: Quad | null) {
  const sharp = (await import("sharp")).default;
  const d = new Uint8ClampedArray(img.data);
  const draw = (qq: Quad, col: number[]) => {
    for (let i = 0; i < 4; i++) {
      const a = qq[i], b = qq[(i + 1) % 4];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let t = 0; t <= L; t += 0.5) {
        const x = Math.round(a.x + (b.x - a.x) * t / L), y = Math.round(a.y + (b.y - a.y) * t / L);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
          const p = (yy * img.width + xx) * 4; d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2];
        }
      }
    }
  };
  if (q2) draw(q2, [0, 255, 0]);
  if (q) draw(q, [255, 0, 0]);
  await sharp(Buffer.from(d.buffer), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(`${OUT}/${name}.png`);
}

const W = 900, H = 1200;
const scenes: Record<string, Sahne> = {
  a4: { width: W, height: H, corners: projectRect({ width: W, height: H, aspect: 1 / 1.414, size: 0.62, rotDeg: 8, tiltX: 25, tiltY: 8 }), paperAspect: 1 / 1.414, background: "tahta", text: { rows: 30 }, noise: 3, blur: 0.8, seed: 2 },
  fis: { width: W, height: H, corners: projectRect({ width: W, height: H, aspect: 1 / 6, size: 0.17, rotDeg: -4, tiltX: 15 }), paperAspect: 1 / 6, background: "acik", text: { rows: 60, strength: 0.8 }, noise: 2.5, blur: 0.7, curl: 3, seed: 3 },
  fisGolge: { width: W, height: H, corners: projectRect({ width: W, height: H, aspect: 1 / 4, size: 0.25, rotDeg: 6, tiltX: 20 }), paperAspect: 1 / 4, background: "gri", text: { rows: 45, strength: 0.7 }, shadow: 0.45, noise: 3, blur: 0.8, seed: 4 },
  dolu: { width: W, height: H, corners: [{ x: -20, y: -15 }, { x: W + 18, y: -20 }, { x: W + 25, y: H + 20 }, { x: -18, y: H + 16 }], background: "koyu", text: { rows: 35 }, noise: 3, seed: 5 },
  yok: { width: W, height: H, corners: null, background: "doku", noise: 4, seed: 6 },
  yok2: { width: W, height: H, corners: null, background: "tahta", noise: 3, seed: 7 },
  fisTasan: { width: W, height: H, corners: [{ x: 380, y: -30 }, { x: 540, y: -25 }, { x: 560, y: H + 30 }, { x: 395, y: H + 25 }], background: "koyu", text: { rows: 70 }, noise: 3, seed: 8 },
  koyuA4: { width: W, height: H, corners: projectRect({ width: W, height: H, aspect: 1 / 1.414, size: 0.7, rotDeg: -12, tiltX: 10 }), paperAspect: 1 / 1.414, background: "koyu", text: { rows: 25 }, noise: 2, seed: 9 },
};
const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
(async () => {
  for (const [name, s] of Object.entries(scenes)) {
    if (only && name !== only) continue;
    let t = performance.now();
    const img = renderScene(s);
    const tr = performance.now() - t;
    t = performance.now();
    const d = detectDocument(img);
    const td = performance.now() - t;
    const err = d.corners && s.corners ? cornerError(d.corners, s.corners, W, H) : null;
    console.log(name, `render ${tr.toFixed(0)}ms detect ${td.toFixed(0)}ms`, d.method, d.confidence, d.fillsFrame, d.reasons.join(","), err === null ? "-" : (err * 100).toFixed(2) + "%");
    if (process.argv.includes("--c")) for (const c of detectCandidates(img).slice(0, 6)) console.log("   ", c.how, c.score.toFixed(3), s.corners ? (cornerError(c.corners, s.corners, W, H) * 100).toFixed(1) + "%" : "");
    await save(name, img, d.corners, s.corners);
    if (process.argv.includes("--s")) {
      const r = scanDocument(img, { corners: d.corners ?? undefined });
      console.log("   scan", r.image.width, r.image.height, r.rotation, JSON.stringify(r.timings));
      await save(name + "-tarama", r.image);
    }
  }
})();
