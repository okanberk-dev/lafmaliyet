import { renderScene, projectRect, cornerError, type Sahne, type Zemin } from "/workspace/lafmaliyet/.claude/worktrees/wf_6b331e78-280-1/tests/helpers/tarama-sentetik";
import { detectDocument, detectCandidates } from "/workspace/lafmaliyet/.claude/worktrees/wf_6b331e78-280-1/src/lib/scan/detect";
import { seededRandom, type Quad, type RgbaImage } from "/workspace/lafmaliyet/.claude/worktrees/wf_6b331e78-280-1/src/lib/scan/image";
const OUT = "/tmp/claude-0/-workspace/e7df09e3-6394-5a70-b51c-7ee8e4dca445/scratchpad/exp";
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
const W = 750, H = 1000;
const zem: Zemin[] = ["koyu", "doku", "degrade", "acik", "gri", "beyaz", "tahta"];
const rnd = seededRandom(Number(process.env.SEED ?? 1234));
const N = Number(process.env.N ?? 84);
const dump = (process.env.DUMP ?? "").split(",").filter(Boolean).map(Number);
const skipBeyaz = process.env.BEYAZ !== "1";
const stat: Record<string, { n: number; ok: number; miss: number; bad: number; worst: number }> = {};
(async () => {
  for (let i = 0; i < N; i++) {
    const bg = zem[i % zem.length];
    const fis = Math.floor(i / 7) % 2 === 0;
    const aspect = fis ? 1 / (3 + rnd() * 4) : 1 / 1.414;
    const size = fis ? 0.14 + rnd() * 0.12 : 0.5 + rnd() * 0.25;
    const s: Sahne = { width: W, height: H, corners: projectRect({ width: W, height: H, aspect, size, rotDeg: (rnd() - 0.5) * 24, tiltX: rnd() * 25, tiltY: (rnd() - 0.5) * 16 }), paperAspect: aspect, background: bg, text: { rows: fis ? 50 : 30, strength: 0.6 + rnd() * 0.4 }, shadow: rnd() < 0.4 ? rnd() * 0.45 : 0, noise: 2 + rnd() * 3, blur: 0.6 + rnd() * 0.8, curl: fis ? rnd() * 4 : 0, seed: i + 100 };
    if (dump.length && !dump.includes(i)) continue;
    if (skipBeyaz && bg === "beyaz") continue;
    const img = renderScene(s);
    const d = detectDocument(img);
    const key = (fis ? "fis-" : "a4-") + bg;
    const st = (stat[key] ??= { n: 0, ok: 0, miss: 0, bad: 0, worst: 0 });
    st.n++;
    if (dump.length) {
      await save("s" + i, img, d.corners, s.corners);
      console.log(i, key, d.method, d.confidence, d.reasons.join(","), JSON.stringify(s.corners!.map((p) => [Math.round(p.x), Math.round(p.y)])), "bulunan", JSON.stringify(d.corners?.map((p) => [Math.round(p.x), Math.round(p.y)])));
      for (const c of detectCandidates(img).slice(0, 8)) console.log("   ", c.how, c.score.toFixed(3), (cornerError(c.corners, s.corners!, W, H) * 100).toFixed(1) + "%");
    }
    if (!d.corners || d.fillsFrame) { st.miss++; console.log("  yok", key, i, d.reasons.join(",")); continue; }
    const e = cornerError(d.corners, s.corners!, W, H);
    st.worst = Math.max(st.worst, e);
    if (e < 0.015) st.ok++; else { st.bad++; console.log("  kötü", key, i, (e * 100).toFixed(1) + "%", d.method, d.confidence); }
  }
  let n = 0, ok = 0, miss = 0, bad = 0;
  for (const [k, v] of Object.entries(stat)) { console.log(k, `n=${v.n} ok=${v.ok} yok=${v.miss} yanlis=${v.bad} enKotu=${(v.worst * 100).toFixed(2)}%`); n += v.n; ok += v.ok; miss += v.miss; bad += v.bad; }
  console.log(`TOPLAM n=${n} ok=${ok} yok=${miss} yanlis=${bad}`);
})();
