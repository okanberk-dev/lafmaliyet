import { renderScene, projectRect, cornerError } from "../tests/helpers/tarama-sentetik";
import { scanDocument } from "../src/lib/scan";

const W = 1670, H = 2220;
const scenes = {
  a4: { width: W, height: H, corners: projectRect({ width: W, height: H, aspect: 1 / 1.414, size: 0.72, rotDeg: 5, tiltX: 18, tiltY: 5 }), paperAspect: 1 / 1.414, background: "tahta" as const, text: { rows: 40 }, noise: 3, blur: 1, seed: 21 },
  fis: { width: W, height: H, corners: projectRect({ width: W, height: H, aspect: 1 / 6, size: 0.2, rotDeg: -3, tiltX: 12 }), paperAspect: 1 / 6, background: "acik" as const, text: { rows: 70, strength: 0.75 }, noise: 3, blur: 1, seed: 22 },
};
for (const [name, s] of Object.entries(scenes)) {
  const img = renderScene(s);
  for (let rep = 0; rep < 4; rep++) {
    const r = scanDocument(img);
    const t = r.timings;
    console.log(name, `err ${(cornerError(r.corners, s.corners, W, H) * 100).toFixed(2)}% ${r.method} ${r.confidence} out ${r.image.width}x${r.image.height} detect ${t.detect.toFixed(0)} warp ${t.warp.toFixed(0)} enhance ${t.enhance.toFixed(0)} total ${t.total.toFixed(0)} rot ${r.rotation}`);
  }
}
