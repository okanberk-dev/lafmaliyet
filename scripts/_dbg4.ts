import { projectRect, renderScene, cornerError } from "../tests/helpers/tarama-sentetik";
import { seededRandom, type Quad } from "../src/lib/scan/image";
import { refineCorners } from "../src/lib/scan";

const W = 720, H = 960, DIAG = Math.hypot(W, H);
const corners = projectRect({ width: W, height: H, aspect: 1 / 4, size: 0.25, rotDeg: 6, tiltX: 20 });
const img = renderScene({ width: W, height: H, corners, paperAspect: 1 / 4, background: "gri", text: { rows: 45, strength: 0.7 }, shadow: 0.45, noise: 3, blur: 0.8, seed: 4 });
const rnd = seededRandom(31);
const f = (q: Quad) => q.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ");
console.log("truth", f(corners));
for (let k = 0; k < 5; k++) {
  const hint = corners.map((p) => {
    const a = rnd() * Math.PI * 2;
    const r = DIAG * 0.05 * (0.6 + 0.4 * rnd());
    return { x: Math.max(0, Math.min(W - 1, p.x + Math.cos(a) * r)), y: Math.max(0, Math.min(H - 1, p.y + Math.sin(a) * r)) };
  }) as Quad;
  const r = refineCorners(img, hint);
  const r1 = refineCorners(img, hint, { passes: "iki" });
  console.log(k, "hint", f(hint), "→", f(r.corners), r.sides, (cornerError(r.corners, corners, W, H) * 100).toFixed(2), void r1);
}
