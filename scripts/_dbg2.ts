import { renderScene, projectRect } from "../tests/helpers/tarama-sentetik";
import { scanDocument } from "../src/lib/scan";
import { detectDocument } from "../src/lib/scan/detect";
import { estimateSkew } from "../src/lib/scan/enhance";
import { warpQuad } from "../src/lib/scan/warp";

const OUT = "/tmp/claude-0/-workspace-lafmaliyet/e7df09e3-6394-5a70-b51c-7ee8e4dca445/scratchpad/exp";
const W = 1670, H = 2220;
const a4 = projectRect({ width: W, height: H, aspect: 1 / 1.414, size: 0.8, rotDeg: 5, tiltX: 18, tiltY: 5 });
console.log("a4 truth", a4.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
const img = renderScene({ width: W, height: H, corners: a4, paperAspect: 1 / 1.414, background: "tahta", text: { rows: 40 }, noise: 3, blur: 1, seed: 21 });
const d = detectDocument(img);
console.log("a4 det  ", d.corners!.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), d.method, d.reasons);

const fisQ = projectRect({ width: W, height: H, aspect: 1 / 6, size: 0.2, rotDeg: -3, tiltX: 12 });
const fis = renderScene({ width: W, height: H, corners: fisQ, paperAspect: 1 / 6, background: "acik", text: { rows: 70, strength: 0.75 }, noise: 3, blur: 1, seed: 22 });
const w1 = warpQuad(fis, fisQ, 378, 1995);
console.log("fis truth-warp skew", estimateSkew(w1));
const r = scanDocument(fis, { deskew: false });
console.log("fis scan corners", r.corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), "truth", fisQ.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
(async () => {
  const sharp = (await import("sharp")).default;
  await sharp(Buffer.from(r.image.data.buffer), { raw: { width: r.image.width, height: r.image.height, channels: 4 } }).png().toFile(`${OUT}/fis-noskew.png`);
  await sharp(Buffer.from(w1.data.buffer), { raw: { width: w1.width, height: w1.height, channels: 4 } }).png().toFile(`${OUT}/fis-truthwarp.png`);
})();
