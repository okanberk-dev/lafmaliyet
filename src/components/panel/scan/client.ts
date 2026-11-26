/**
 * Tarama ekranının tarayıcı tarafı: fotoğrafı çözme (EXIF yönü tarayıcıda uygulanır), ağır işlerin Web Worker'a
 * gönderilmesi (açılamazsa ana iş parçacığında, her işten önce ekrana bir kare bırakılarak), taranmış görüntünün JPEG'e
 * kodlanması (dar fişte 200 px alt sınırı için beyaz pay) ve yapay zekâya gidecek küçük kopya.
 */

import { COMPRESS_ERROR_TEXT, decodeImage, fitWithin, PhotoCompressError } from "@/lib/photo-compress";
import { HINT_IMAGE, SCAN_INPUT, SCAN_OUTPUT, uploadCanvas } from "@/lib/photo-scan";
import type { RgbaImage } from "@/lib/scan";

import type { EngineRequest, EngineResponse } from "./engine";

type Pending = { resolve: (r: EngineResponse) => void; reject: (e: Error) => void; req: EngineRequest };

/**
 * İşleri Worker'da sırayla çalıştırır. Worker açılamaz ya da çökerse aynı motor ana iş parçacığında devralır:
 * yüklenen fotoğraf istemcide de durduğu için (kopyalanarak gönderilir, aktarılmaz) bekleyen işler yeniden çalışır.
 */
export class ScanClient {
  private worker: Worker | null = null;
  private local: ((req: EngineRequest) => EngineResponse) | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private image: RgbaImage | null = null;
  private disposed = false;

  constructor() {
    try {
      this.worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module", name: "belge-tarama" });
      this.worker.onmessage = (e: MessageEvent<{ id: number; res?: EngineResponse; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.res) p.resolve(e.data.res);
        else p.reject(new Error(e.data.error ?? "Tarama yapılamadı"));
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        void this.fallBack();
      };
    } catch {
      this.worker = null;
    }
  }

  /** Worker yok: işler ana iş parçacığında (bekleyenler yeniden) */
  private async fallBack() {
    this.worker?.terminate();
    this.worker = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) this.runLocal(p.req).then(p.resolve, p.reject);
  }

  private async runLocal(req: EngineRequest): Promise<EngineResponse> {
    if (!this.local) {
      const { createEngine } = await import("./engine");
      this.local = createEngine();
      // Worker'a gönderilmiş fotoğraf yerel motora da yüklenir
      if (this.image && req.type !== "load") this.local({ type: "load", image: this.image });
    }
    // Ekran bir kare çizebilsin (düğmenin basılı hâli, "Taranıyor…")
    await new Promise((r) => setTimeout(r, 16));
    if (this.disposed) throw new Error("kapandı");
    return this.local(req);
  }

  call(req: EngineRequest): Promise<EngineResponse> {
    if (req.type === "load") this.image = req.image;
    if (!this.worker) return this.runLocal(req);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, req });
      this.worker!.postMessage({ id, req });
    });
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("kapandı"));
    this.pending.clear();
    this.image = null;
    this.local = null;
  }
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new PhotoCompressError(COMPRESS_ERROR_TEXT);
  return ctx;
}

/**
 * Tuvalin belleği hemen bırakılır: iOS Safari tuvallerin toplam belleğini sınırlar (~384 MB) ve çöp toplayıcıyı
 * beklemeden dolabilir ("Total canvas memory use exceeds the maximum limit"; birkaç tarama ve uzun fiş yeter)
 */
function release(...cs: HTMLCanvasElement[]) {
  for (const c of cs) {
    c.width = 0;
    c.height = 0;
  }
}

function toBlob(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new PhotoCompressError(COMPRESS_ERROR_TEXT))), "image/jpeg", quality));
}

/** RGBA görüntüyü tuvale çizer (verilen ölçüde) */
function drawImage(img: RgbaImage, width = img.width, height = img.height): HTMLCanvasElement {
  const full = canvasOf(img.width, img.height);
  context(full).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (width === img.width && height === img.height) return full;
  const c = canvasOf(width, height);
  const ctx = context(c);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, width, height);
  release(full);
  return c;
}

export interface DecodedPhoto {
  /** Tarayıcının girdisi (en çok 2576 px / ~3,7 MP; okumanın ölçüsü) */
  image: RgbaImage;
  /** Ekranda gösterilen kopya (köşe sürükleme, büyüteç): nesne adresi, kapanınca bırakılır */
  displayUrl: string;
}

/** Fotoğrafı çözer (HEIC'i açamayan tarayıcıda PhotoCompressError; yükleme bu durumda taramasız sürer) */
export async function decodePhoto(file: Blob): Promise<DecodedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    let el: HTMLImageElement;
    try {
      el = await decodeImage(url);
    } catch {
      throw new PhotoCompressError(COMPRESS_ERROR_TEXT);
    }
    const { width, height } = fitWithin(el.naturalWidth, el.naturalHeight, SCAN_INPUT.maxEdge, SCAN_INPUT.maxPixels);
    const c = canvasOf(width, height);
    const ctx = context(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(el, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const d = fitWithin(width, height, 1400);
    const shown = canvasOf(d.width, d.height);
    const sctx = context(shown);
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(c, 0, 0, d.width, d.height);
    release(c);
    const displayUrl = URL.createObjectURL(await toBlob(shown, 0.85));
    release(shown);
    return { image: { width, height, data }, displayUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Taranmış görüntünün JPEG'i (yüklenen ve okunan dosya): dar fişin kısa kenarı 200 px'in altındaysa iki yanına beyaz
 * pay eklenir; `maxBytes`'ı aşarsa daha düşük kaliteyle yeniden kodlanır
 */
export async function encodeScan(img: RgbaImage): Promise<Blob> {
  const box = uploadCanvas(img.width, img.height);
  const drawn = drawImage(img, box.width, box.height);
  let c = drawn;
  if (box.canvasWidth !== box.width || box.canvasHeight !== box.height) {
    c = canvasOf(box.canvasWidth, box.canvasHeight);
    const ctx = context(c);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(drawn, box.x, box.y);
    release(drawn);
  }
  try {
    let blob = await toBlob(c, SCAN_OUTPUT.quality);
    for (const q of [0.6, 0.5]) {
      if (blob.size <= SCAN_OUTPUT.maxBytes) break;
      blob = await toBlob(c, q);
    }
    return blob;
  } finally {
    release(c);
  }
}

/** Önizleme görüntüsünün nesne adresi (kalite önemsiz, hızlı) */
export async function previewUrl(img: RgbaImage): Promise<string> {
  const c = drawImage(img);
  try {
    return URL.createObjectURL(await toBlob(c, 0.85));
  } finally {
    release(c);
  }
}

/** Yapay zekâya gidecek kopya: en uzun kenar 1024 px JPEG */
export async function hintJpeg(img: RgbaImage): Promise<{ blob: Blob; width: number; height: number }> {
  const s = fitWithin(img.width, img.height, HINT_IMAGE.maxEdge);
  const c = drawImage(img, s.width, s.height);
  try {
    return { blob: await toBlob(c, HINT_IMAGE.quality), width: s.width, height: s.height };
  } finally {
    release(c);
  }
}
