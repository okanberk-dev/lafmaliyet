// Testte sentetik fiş görseli (docs/FOTOGRAF.md › Kodla okuma): verilen satırlar Inter yazı tipiyle (vardiya PDF'inin
// gömülü alt kümesi, Türkçe harfler dahil) kenar yumuşatmalı gri PNG'ye çizilir. Dış kitaplık yok: glifler fontkit'in
// yollarından düz çokgenlere çevrilir, 3×3 alt örneklemeyle doldurulur, PNG zlib'le yazılır. Kodla okumanın (OCR +
// kural tabanlı ayrıştırıcı) testi gerçek bir görselle, ağsız koşsun diye.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import * as fontkit from "@pdf-lib/fontkit";

const FONT = join(process.cwd(), "src/server/vardiya/fonts/Inter-Regular.subset.ttf");
/** Alt örnekleme: her piksel 3×3 örnek */
const SS = 3;

type Pt = [number, number];

/** Glif yolunu düz çokgenlere çevirir (eğriler 8 parçaya bölünür) */
function outline(path: fontkit.Path): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  let at: Pt = [0, 0];
  const ctx = {
    moveTo(x: number, y: number) {
      if (cur.length) polys.push(cur);
      cur = [[x, y]];
      at = [x, y];
    },
    lineTo(x: number, y: number) {
      cur.push([x, y]);
      at = [x, y];
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      const [x0, y0] = at;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        cur.push([u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y]);
      }
      at = [x, y];
    },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      const [x0, y0] = at;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        cur.push([
          u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
          u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        ]);
      }
      at = [x, y];
    },
    closePath() {
      if (cur.length) polys.push(cur);
      cur = [];
    },
  };
  (path.toFunction() as unknown as (c: typeof ctx) => void)(ctx);
  if (cur.length) polys.push(cur);
  return polys;
}

/** Sıfır olmayan sarım kuralıyla çokgenleri yüksek çözünürlüklü maskeye doldurur */
function fill(mask: Uint8Array, w: number, h: number, polys: Pt[][]): void {
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5;
    const xs: { x: number; d: number }[] = [];
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const [x0, y0] = p[i];
        const [x1, y1] = p[(i + 1) % p.length];
        if (y0 === y1 || sy < Math.min(y0, y1) || sy >= Math.max(y0, y1)) continue;
        xs.push({ x: x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0), d: y1 > y0 ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].d;
      if (wind === 0) continue;
      const from = Math.max(0, Math.ceil(xs[k].x - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1].x - 0.5));
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
  }
}

function png(gray: Uint8Array, w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 0; // gri
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]));
}

/**
 * Fiş görseli: her satır soldan; "SOL|SAĞ" biçimindeki satırın sağ yanı sağa yaslanır (termal fişteki gibi). `size`
 * yazı yüksekliği (piksel), `width` görselin genişliği
 */
export function slipPng(lines: readonly string[], o: { width?: number; size?: number } = {}): Uint8Array {
  const font = fontkit.create(readFileSync(FONT));
  const size = o.size ?? 28;
  const width = o.width ?? 760;
  const lineH = Math.round(size * 1.6);
  const margin = Math.round(size * 1.2);
  const height = lineH * lines.length + margin * 2;
  const W = width * SS;
  const H = height * SS;
  const mask = new Uint8Array(W * H);
  const scale = (size * SS) / font.unitsPerEm;
  const draw = (text: string, x0: number, base: number, alignRight: boolean) => {
    const run = font.layout(text);
    const total = run.positions.reduce((a, p) => a + p.xAdvance, 0) * scale;
    let x = alignRight ? x0 - total : x0;
    run.glyphs.forEach((g, i) => {
      const polys = outline(g.path).map((p) => p.map(([gx, gy]) => [x + gx * scale, base - gy * scale] as Pt));
      fill(mask, W, H, polys);
      x += run.positions[i].xAdvance * scale;
    });
  };
  lines.forEach((line, i) => {
    const base = (margin + lineH * i + size) * SS;
    const [left, right] = line.split("|");
    if (left) draw(left, margin * SS, base, false);
    if (right !== undefined && right !== "") draw(right, (width - margin) * SS, base, true);
  });
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) n += mask[(y * SS + dy) * W + x * SS + dx];
      gray[y * width + x] = Math.round(250 - (n / (SS * SS)) * 230);
    }
  }
  return png(gray, width, height);
}
