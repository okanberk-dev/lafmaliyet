import { renderScene, projectRect } from "../tests/helpers/tarama-sentetik";
import { enhance, warpQuad, estimateSize } from "../src/lib/scan";

const W = 1670, H = 2220;
const q = projectRect({ width: W, height: H, aspect: 1 / 1.414, size: 0.72, rotDeg: 5, tiltX: 18, tiltY: 5 });
const img = renderScene({ width: W, height: H, corners: q, paperAspect: 1 / 1.414, background: "tahta", text: { rows: 40 }, noise: 3, blur: 1, seed: 21 });
const sz = estimateSize(q, W, H, 2000);
let t = performance.now();
let warped = warpQuad(img, q, sz.width, sz.height);
for (let i = 0; i < 5; i++) warped = warpQuad(img, q, sz.width, sz.height);
console.log("warp avg", ((performance.now() - t) / 6).toFixed(0), "ms", sz.width, sz.height);
t = performance.now();
for (let i = 0; i < 8; i++) enhance(warped, "belge");
console.log("enhance avg", ((performance.now() - t) / 8).toFixed(0), "ms");
