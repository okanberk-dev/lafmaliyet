// Belge tarayıcıyı (src/lib/scan) gerçek fotoğraflarla denemek için. Uygulamada tarama telefonda, tarayıcıda çalışır
// (sunucu görseli çözmez); bu betik yalnız geliştiricinin bilgisayarında fotoğrafı çözmek ve sonucu yazmak için sharp'ı
// dinamik yükler (Next'in bağımlılığı olarak gelir; uygulamanın koduna girmez). Her fotoğraf için: algılanan dörtgen
// fotoğrafın üzerine çizilir (`<ad>-kose.jpg`: yeşil güvenli, sarı orta, kırmızı düşük), taranmış hâl yazılır
// (`<ad>-<mod>.png`), satır satır yöntem / güven / nedenler / süreler basılır. docs/FOTOGRAF.md › Belge tarama.
//
// Kullanım:
//   npx tsx scripts/tarama-dene.ts <fotoğraf|klasör>... [--cikti <klasör>] [--mod belge|gri|renkli|orijinal|hepsi]
//        [--ipucu x1,y1,x2,y2,x3,y3,x4,y4] [--ust up|right|down|left] [--en 2000] [--egiklik-yok] [--json]
//   npx tsx scripts/tarama-dene.ts --sentetik [--cikti <klasör>]
//   --cikti      çıktı klasörü (varsayılan .data/tarama-dene; depoya girmez)
//   --mod        taranmış görünüm (varsayılan belge; "hepsi" dört modu da yazar)
//   --ipucu      yapay zekânın verdiği gibi 0–1000 oranlı dört köşe: algılama yapılmaz, köşeler kenarlara oturtulur
//   --ust        yapay zekânın "top" ipucu: belgenin üst kenarı görüntünün hangi tarafında (çıktı ona göre çevrilir)
//   --en         çıktının uzun kenarı (px)
//   --sentetik   fotoğraf yerine testlerin sentetik sahneleri (tests/helpers/tarama-sentetik.ts); köşe hatası da basılır
//   --json       sonuçları ayrıca `sonuc.json`'a yazar
// Telefondaki akışı taklit etmek için fotoğraf önce yüklemedeki ölçüye (PHOTO_COMPRESS: uzun kenar ≤ 2576 px,
// ≤ 3,7 megapiksel) küçültülür; asıl çözünürlük için --asil.

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { PHOTO_COMPRESS, fitWithin } from "../src/lib/photo-compress";
import { scaleQuad } from "../src/lib/scan/image";
import {
  cornersFromHint,
  cornersToHint,
  orderCorners,
  rotationForTop,
  scanDocument,
  SCAN_MODES,
  thumbnail,
  type DocumentTop,
  type Quad,
  type RgbaImage,
  type ScanMode,
} from "../src/lib/scan";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const VALUED = new Set(["--cikti", "--mod", "--ipucu", "--ust", "--en"]);
const inputs = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));
const OUT = opt("--cikti") ?? ".data/tarama-dene";
const modeArg = opt("--mod") ?? "belge";
const modes: ScanMode[] = modeArg === "hepsi" ? [...SCAN_MODES] : SCAN_MODES.includes(modeArg as ScanMode) ? [modeArg as ScanMode] : [];
const maxEdge = Number(opt("--en") ?? 2000);
const hintArg = opt("--ipucu");
const topArg = opt("--ust") as DocumentTop | undefined;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff"]);

type Sharp = (typeof import("sharp"))["default"];

async function loadSharp(): Promise<Sharp> {
  try {
    return (await import("sharp")).default;
  } catch {
    console.error("sharp yüklenemedi (npm install sonrası node_modules/sharp olmalı).");
    process.exit(1);
  }
}

async function readImage(sharp: Sharp, file: string): Promise<RgbaImage> {
  // .rotate(): EXIF yönü uygulanır (telefonda tarayıcı da çözerken uygular)
  let pipe = sharp(file).rotate();
  if (!has("--asil")) {
    const meta = await sharp(file).rotate().metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    const w = (swap ? meta.height : meta.width) ?? 0;
    const h = (swap ? meta.width : meta.height) ?? 0;
    const fit = fitWithin(w, h, PHOTO_COMPRESS.maxEdge, PHOTO_COMPRESS.maxPixels);
    if (fit.width < w) pipe = pipe.resize(fit.width, fit.height, { kernel: "lanczos3" });
  }
  const { data, info } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

async function writePng(sharp: Sharp, img: RgbaImage, file: string): Promise<void> {
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toFile(file);
}

/** Dörtgeni fotoğrafın küçük kopyasının üzerine çizer (çizgi uzun kenarın ~%0,4'ü, köşede nokta) */
function drawQuad(img: RgbaImage, q: Quad, color: [number, number, number]): RgbaImage {
  const out: RgbaImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const r = Math.max(1, Math.round(Math.max(img.width, img.height) * 0.002));
  const dot = (x: number, y: number, rr: number) => {
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        const xx = Math.round(x) + dx;
        const yy = Math.round(y) + dy;
        if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
        out.data.set([color[0], color[1], color[2], 255], (yy * img.width + xx) * 4);
      }
    }
  };
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let t = 0; t <= L; t += 0.5) dot(a.x + ((b.x - a.x) * t) / L, a.y + ((b.y - a.y) * t) / L, r);
    dot(a.x, a.y, r * 4);
  }
  return out;
}

const colorFor = (c: number): [number, number, number] => (c >= 0.6 ? [40, 200, 80] : c >= 0.35 ? [240, 190, 20] : [230, 40, 40]);

interface Row {
  file: string;
  width: number;
  height: number;
  method: string;
  confidence: number;
  fillsFrame: boolean;
  corners: [number, number][];
  rotation: number;
  reasons: string[];
  out: string;
  ms: { detect: number; warp: number; enhance: number; total: number };
  error?: number;
}

async function run(sharp: Sharp, name: string, img: RgbaImage, truth: Quad | null, rows: Row[]): Promise<void> {
  let corners: Quad | null = null;
  if (hintArg) {
    const v = hintArg.split(",").map(Number);
    corners = cornersFromHint(
      [0, 1, 2, 3].map((i) => [v[2 * i], v[2 * i + 1]] as [number, number]),
      img.width,
      img.height,
    );
    if (!corners) console.warn(`${name}: --ipucu sekiz sayı olmalı; algılamaya dönülüyor`);
  }
  const rotate = rotationForTop(topArg);
  let first: ReturnType<typeof scanDocument> | null = null;
  for (const mode of modes) {
    const r = scanDocument(img, { mode, maxEdge, corners, refine: !!corners, rotate, deskew: !has("--egiklik-yok") });
    first ??= r;
    const out = join(OUT, `${name}-${mode}.png`);
    await writePng(sharp, r.image, out);
    const row: Row = {
      file: name,
      width: img.width,
      height: img.height,
      method: r.method,
      confidence: r.confidence,
      fillsFrame: r.fillsFrame,
      corners: cornersToHint(r.corners, img.width, img.height),
      rotation: r.rotation,
      reasons: r.reasons,
      out,
      ms: {
        detect: Math.round(r.timings.detect),
        warp: Math.round(r.timings.warp),
        enhance: Math.round(r.timings.enhance),
        total: Math.round(r.timings.total),
      },
    };
    if (truth && !r.fillsFrame) {
      const t = orderCorners(truth);
      row.error = Math.max(...r.corners.map((p, i) => Math.hypot(p.x - t[i].x, p.y - t[i].y))) / Math.hypot(img.width, img.height);
    }
    rows.push(row);
    const err = row.error === undefined ? "" : ` köşe hatası %${(row.error * 100).toFixed(2)}`;
    console.log(
      `${name} [${mode}] ${img.width}×${img.height} → ${r.image.width}×${r.image.height}  ${r.method} güven ${r.confidence.toFixed(2)}` +
        `${r.fillsFrame ? " (kırpılmadı)" : ""}${r.rotation ? ` eğiklik ${r.rotation.toFixed(1)}°` : ""}${err}  ` +
        `algılama ${row.ms.detect} + açma ${row.ms.warp} + görünüm ${row.ms.enhance} = ${row.ms.total} ms  [${r.reasons.join(", ")}]`,
    );
  }
  if (first) {
    // köşe çizimi küçük kopyada (uzun kenar 1200 px), JPEG: tam çözünürlüklü PNG gereksiz büyük
    const small = thumbnail(img, 1200);
    const q = scaleQuad(first.corners, img.width, img.height, small.width, small.height);
    const drawn = drawQuad(small, q, colorFor(first.confidence));
    await sharp(Buffer.from(drawn.data.buffer, drawn.data.byteOffset, drawn.data.length), { raw: { width: drawn.width, height: drawn.height, channels: 4 } })
      .jpeg({ quality: 82 })
      .toFile(join(OUT, `${name}-kose.jpg`));
  }
}

function collect(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const f of readdirSync(p).sort()) if (IMAGE_EXT.has(extname(f).toLowerCase())) out.push(join(p, f));
    } else out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  if (!modes.length) {
    console.error(`--mod şunlardan biri: ${SCAN_MODES.join(", ")}, hepsi`);
    process.exit(1);
  }
  if (!inputs.length && !has("--sentetik")) {
    console.error("Kullanım: npx tsx scripts/tarama-dene.ts <fotoğraf|klasör>... [--mod belge|hepsi] [--ipucu …] (ya da --sentetik)");
    process.exit(1);
  }
  const sharp = await loadSharp();
  mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];
  if (has("--sentetik")) {
    const { projectRect, renderScene } = await import("../tests/helpers/tarama-sentetik");
    const W = 1670;
    const H = 2220;
    const scenes = {
      a4: { aspect: 1 / Math.SQRT2, size: 0.72, rotDeg: 5, tiltX: 18, tiltY: 5, background: "tahta", rows: 40 },
      fis: { aspect: 1 / 6, size: 0.2, rotDeg: -3, tiltX: 12, tiltY: 0, background: "acik", rows: 70 },
      fisGolge: { aspect: 1 / 4, size: 0.25, rotDeg: 6, tiltX: 20, tiltY: 0, background: "gri", rows: 45 },
    } as const;
    for (const [name, s] of Object.entries(scenes)) {
      const corners = projectRect({ width: W, height: H, aspect: s.aspect, size: s.size, rotDeg: s.rotDeg, tiltX: s.tiltX, tiltY: s.tiltY });
      const img = renderScene({
        width: W,
        height: H,
        corners,
        paperAspect: s.aspect,
        background: s.background,
        text: { rows: s.rows, strength: 0.8 },
        shadow: name === "fisGolge" ? 0.4 : 0,
        noise: 3,
        blur: 1,
        seed: 21,
      });
      await run(sharp, `sentetik-${name}`, img, corners, rows);
    }
  }
  for (const file of collect(inputs)) {
    const name = basename(file, extname(file));
    try {
      await run(sharp, name, await readImage(sharp, file), null, rows);
    } catch (e) {
      console.error(`${file}: ${(e as Error).message}`);
    }
  }
  if (has("--json")) writeFileSync(join(OUT, "sonuc.json"), JSON.stringify(rows, null, 2));
  console.log(`\nÇıktılar: ${OUT}`);
}

void main();
