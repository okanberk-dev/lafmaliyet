// Fotoğraf altyapısı: görselin ölçüsü (yalnız başlıktan), depo anahtarı ve sürücüler (dosya sistemi, bellek, özel
// Vercel Blob), kim görür, saklama süreleri, telefonda küçültme ölçüsü, yükleme hata metinleri, geliştirmedeki kayıtlı
// yanıtlar ve anahtarın sunucuda kaldığını gösteren kaynak denetimleri (src/lib/photo-rules.ts,
// src/server/storage/drivers.ts, src/lib/photo-compress.ts, src/server/ai/replay.ts; docs/FOTOGRAF.md).
// Çalıştırma: npx tsx --test tests/foto-altyapi.test.ts

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { fitWithin, PHOTO_COMPRESS } from "../src/lib/photo-compress";
import { KasaPosRaw, KasaZRaw } from "../src/lib/photo-read/schemas";
import {
  imageSize,
  isPhotoKind,
  keepUntil,
  KEEP_DAYS,
  linkedUntil,
  MAX_OKC_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_REPORT_PHOTOS,
  PHOTO_KIND_LABEL,
  PHOTO_KINDS,
  photoCaption,
  photoUrl,
  photoViewDecision,
  readingOffText,
  uploadRule,
  sizeProblem,
  uploadErrorText,
} from "../src/lib/photo-rules";
import { replayAnswer, replayEnabled } from "../src/server/ai/replay";
import { blobDriver, fsDriver, memoryDriver, PHOTO_KEY_RE, photoKey, type BlobApi } from "../src/server/storage/drivers";

const ROOT = join(__dirname, "..");
const UUID = "0f8e4b2a-6c1d-4e5f-9a7b-3c2d1e0f9a8b";

/** Yalnız başlığı olan PNG: imza + IHDR (genişlik, yükseklik) */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([8, 2, 0, 0, 0], 24);
  return b;
}

/** JPEG: SOI, APP0, isteğe bağlı DHT (C4: çerçeve değil), dolgu baytı, sonra verilen SOF işareti */
function jpeg(width: number, height: number, sof = 0xc0, withDht = true): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  if (withDht) parts.push(0xff, 0xc4, 0x00, 0x05, 0x00, 0x01, 0x02);
  parts.push(0xff); // dolgu
  parts.push(0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  parts.push(0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0);
  return new Uint8Array(parts);
}

function webpHeader(chunk: string): Uint8Array {
  const b = new Uint8Array(30);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  b.set([...chunk].map((c) => c.charCodeAt(0)), 12);
  return b;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = webpHeader("VP8X");
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return b;
}

function webpVp8(width: number, height: number): Uint8Array {
  const b = webpHeader("VP8 ");
  b.set([0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f], 23);
  return b;
}

function webpVp8l(width: number, height: number): Uint8Array {
  const b = webpHeader("VP8L");
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  b.set([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 20);
  return b;
}

test("imageSize: PNG, JPEG (DHT ve dolgu atlanır, ilerlemeli SOF2), WebP VP8 / VP8L / VP8X; tanınmayan null", () => {
  assert.deepEqual(imageSize(png(1, 1)), { width: 1, height: 1 });
  assert.deepEqual(imageSize(png(1600, 1200)), { width: 1600, height: 1200 });
  assert.deepEqual(imageSize(jpeg(1200, 1600)), { width: 1200, height: 1600 });
  assert.deepEqual(imageSize(jpeg(1200, 1600, 0xc2)), { width: 1200, height: 1600 });
  assert.deepEqual(imageSize(jpeg(640, 480, 0xc0, false)), { width: 640, height: 480 });
  assert.deepEqual(imageSize(webpVp8x(1600, 900)), { width: 1600, height: 900 });
  assert.deepEqual(imageSize(webpVp8(321, 207)), { width: 321, height: 207 });
  assert.deepEqual(imageSize(webpVp8l(333, 211)), { width: 333, height: 211 });

  assert.equal(imageSize(new Uint8Array()), null);
  assert.equal(imageSize(new TextEncoder().encode("GIF89a........................")), null);
  assert.equal(imageSize(new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj")), null);
  // Çerçeveye gelmeden görüntü verisi başlayan ya da yarım kalan JPEG
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0])), null);
  assert.equal(imageSize(jpeg(10, 10).subarray(0, 30)), null);
  // Sıfır ölçü geçersiz
  assert.equal(imageSize(png(0, 10)), null);
});

test("imageSize: deneme fişlerinin gerçek JPEG'leri (kayıtlı yanıtlar bu ölçülerle seçilir)", () => {
  const dir = join(ROOT, "docs", "planlar", "ekler", "fotograf-eval", "img");
  const size = (f: string) => imageSize(new Uint8Array(readFileSync(join(dir, f))));
  assert.deepEqual(size("z-raporu.jpg"), { width: 864, height: 1390 });
  assert.deepEqual(size("pos-gun-sonu.jpg"), { width: 768, height: 965 });
  assert.deepEqual(size("market-fisi.jpg"), { width: 864, height: 1069 });
  assert.deepEqual(size("talimatli-fis.jpg"), { width: 864, height: 862 });
});

test("sizeProblem: kısa kenar 200'den küçük ya da uzun kenar 4096'dan büyükse; ölçü yoksa denetlenmez", () => {
  assert.equal(sizeProblem({ width: 1600, height: 1200 }), null);
  assert.equal(sizeProblem({ width: 200, height: 4096 }), null);
  assert.match(sizeProblem({ width: 199, height: 1600 }) ?? "", /çok küçük ya da çok büyük/);
  assert.match(sizeProblem({ width: 4097, height: 1600 }) ?? "", /yeniden çekin/);
  assert.equal(sizeProblem(null), null);
  assert.equal(MAX_PHOTO_BYTES, 2 * 1024 * 1024);
});

test("photoKey: tür / yıl / ay / rastgele kimlik; dışarı çıkan yol kabul edilmez", () => {
  const key = photoKey("kasa-z", new Date("2026-10-22T21:30:00Z"), UUID, "jpg");
  assert.equal(key, `kasa-z/2026/10/${UUID}.jpg`);
  assert.match(key, PHOTO_KEY_RE);
  assert.equal(photoKey("fis", new Date("2027-01-05T08:00:00Z"), UUID, "webp"), `fis/2027/01/${UUID}.webp`);
  for (const bad of ["../x", `kasa-z/2026/10/../../${UUID}.jpg`, `/etc/2026/10/${UUID}.jpg`, `kasa-z/2026/10/${UUID}.gif`, `KASA/2026/10/${UUID}.jpg`]) {
    assert.doesNotMatch(bad, PHOTO_KEY_RE, bad);
  }
  assert.equal(photoUrl(42), "/api/foto/42");
});

test("dosya sistemi sürücüsü: yaz, oku, üzerine yazmaz, sil; geçersiz anahtar reddedilir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foto-"));
  try {
    const d = fsDriver(dir);
    const key = photoKey("fis", new Date("2026-10-22T10:00:00Z"), UUID, "png");
    const bytes = png(300, 400);
    await d.put(key, bytes, "image/png");
    assert.deepEqual(await d.get(key), bytes);
    await assert.rejects(d.put(key, png(1, 1), "image/png"));
    assert.equal(await d.get(photoKey("fis", new Date("2026-10-22T10:00:00Z"), UUID.replace("0f8e", "1f8e"), "png")), null);
    await d.del([key]);
    assert.equal(await d.get(key), null);
    await d.del([key]); // olmayan anahtar hata değil
    await assert.rejects(d.put("../x", bytes, "image/png"), /Geçersiz fotoğraf anahtarı/);
    await assert.rejects(d.get("../../etc/passwd"), /Geçersiz fotoğraf anahtarı/);
    await assert.rejects(d.del(["../x"]), /Geçersiz fotoğraf anahtarı/);
    assert.deepEqual(await readdir(dir), ["fis"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bellek sürücüsü: yaz, oku, sil; aynı anahtara ikinci yazma hata", async () => {
  const d = memoryDriver();
  await d.put("a", new Uint8Array([1, 2]), "image/jpeg");
  assert.deepEqual(await d.get("a"), new Uint8Array([1, 2]));
  await assert.rejects(d.put("a", new Uint8Array([3]), "image/jpeg"));
  assert.deepEqual(d.keys(), ["a"]);
  await d.del(["a", "b"]);
  assert.equal(await d.get("a"), null);
});

test("Blob sürücüsü: özel depo, rastgele ek yok, üzerine yazma yok, bir saat önbellek; akıştan okur", async () => {
  const calls: { op: string; args: unknown[] }[] = [];
  let answer: Awaited<ReturnType<BlobApi["get"]>> = null;
  const api: BlobApi = {
    async put(...args) {
      calls.push({ op: "put", args });
      return {};
    },
    async get(...args) {
      calls.push({ op: "get", args });
      return answer;
    },
    async del(...args) {
      calls.push({ op: "del", args });
    },
  };
  const d = blobDriver(api, "anahtar");
  const bytes = jpeg(800, 600);
  await d.put(`kasa-z/2026/10/${UUID}.jpg`, bytes, "image/jpeg");
  const [put] = calls;
  assert.equal(put.op, "put");
  assert.equal(put.args[0], `kasa-z/2026/10/${UUID}.jpg`);
  assert.ok(Buffer.isBuffer(put.args[1]));
  assert.deepEqual(new Uint8Array(put.args[1] as Buffer), bytes);
  assert.deepEqual(put.args[2], { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 3600, token: "anahtar" });

  answer = { statusCode: 200, stream: new Blob([new Uint8Array(bytes)]).stream() };
  assert.deepEqual(await d.get("k"), bytes);
  assert.deepEqual(calls[1].args, ["k", { access: "private", token: "anahtar" }]);
  answer = { statusCode: 304, stream: null };
  assert.equal(await d.get("k"), null);
  answer = null;
  assert.equal(await d.get("k"), null);

  calls.length = 0;
  await d.del([]);
  assert.equal(calls.length, 0, "boş silme Blob'a gitmez");
  await d.del(["a", "b"]);
  assert.deepEqual(calls[0].args, [["a", "b"], { token: "anahtar" }]);

  // Anahtarsız (Vercel'in OIDC bağlantısı): seçeneklerde token yok
  calls.length = 0;
  await blobDriver(api).put("k", bytes, "image/jpeg");
  const options = calls[0].args[2] as Record<string, unknown>;
  assert.equal("token" in options, false);
  assert.equal(options.access, "private");
});

test("photoViewDecision: süresi dolan hiç kimseye; yönetici hepsine; yükleyen bağlanmamış fotoğrafına; kalanı türün kuralı", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const admin = { id: 1, role: "admin" as const };
  const ayse = { id: 7, role: "staff" as const };
  const mehmet = { id: 8, role: "staff" as const };
  const unlinked = { createdBy: 7, linkedAt: null, expiresAt: new Date("2026-10-24T12:00:00Z") };
  const linked = { createdBy: 7, linkedAt: new Date("2026-10-22T11:00:00Z"), expiresAt: new Date("2027-04-20T00:00:00+03:00") };
  const expired = { createdBy: 7, linkedAt: null, expiresAt: new Date("2026-10-22T11:59:59Z") };
  const forever = { createdBy: 7, linkedAt: new Date("2026-10-22T11:00:00Z"), expiresAt: null };

  assert.equal(photoViewDecision(admin, linked, now), "yes");
  assert.equal(photoViewDecision(admin, forever, now), "yes");
  assert.equal(photoViewDecision(admin, expired, now), "no");
  assert.equal(photoViewDecision(ayse, unlinked, now), "yes");
  assert.equal(photoViewDecision(ayse, expired, now), "no");
  assert.equal(photoViewDecision(ayse, linked, now), "rules");
  assert.equal(photoViewDecision(mehmet, unlinked, now), "rules");
  assert.equal(photoViewDecision(mehmet, linked, now), "rules");
  // Sınırda: tam süresi dolduğu an görülmez
  assert.equal(photoViewDecision(admin, { ...unlinked, expiresAt: now }, now), "no");
  // Veritabanından metin gelse de
  assert.equal(photoViewDecision(ayse, { createdBy: 7, linkedAt: null, expiresAt: "2026-10-24T12:00:00Z" }, now), "yes");
});

test("keepUntil: dayanak günün İstanbul gece yarısından kasa 180, fiş 400, kontrol 60 gün", () => {
  assert.equal(keepUntil("kasa-z", "2026-10-22").toISOString(), new Date("2027-04-20T00:00:00+03:00").toISOString());
  assert.equal(keepUntil("kasa-pos", "2026-10-22").toISOString(), new Date("2027-04-20T00:00:00+03:00").toISOString());
  assert.equal(keepUntil("fis", "2026-10-22").toISOString(), new Date("2027-11-26T00:00:00+03:00").toISOString());
  assert.equal(keepUntil("kontrol", "2026-10-22").toISOString(), new Date("2026-12-21T00:00:00+03:00").toISOString());
  // Artık yıl: 29 Şubat sayılır
  assert.equal(keepUntil("kasa-z", "2027-12-31").toISOString(), new Date("2028-06-28T00:00:00+03:00").toISOString());
  // Bağlarken: geçmiş bir güne sonradan eklenen fotoğrafın süresi bugünden (yoksa ertesi sabah silinirdi)
  assert.equal(linkedUntil("kasa-z", "2026-10-21", "2026-10-21").toISOString(), keepUntil("kasa-z", "2026-10-21").toISOString());
  assert.equal(linkedUntil("kasa-z", "2026-01-05", "2026-10-22").toISOString(), keepUntil("kasa-z", "2026-10-22").toISOString());
  assert.ok(linkedUntil("fis", "2024-03-01", "2026-10-22").getTime() > new Date("2026-10-22T00:00:00+03:00").getTime());
});

test("fitWithin: uzun kenar 1600'e iner, oran korunur; küçük görsel büyütülmez", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(1200, 900, 1600), { width: 1200, height: 900 });
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitWithin(9000, 10, 1600), { width: 1600, height: 2 });
});

test("PHOTO_COMPRESS: telefon fotoğrafını megapiksel, kırpılmış uzun fişi kenar sınırı keser; API ve sunucu sınırlarının içinde", () => {
  const { maxEdge, maxPixels, maxBytes } = PHOTO_COMPRESS;
  // 12 MP telefon fotoğrafı (3:4): alanı ~3,7 MP'ye iner (Claude'un en büyük ölçüsü ~3,75 MP)
  const phone = fitWithin(3024, 4032, maxEdge, maxPixels);
  assert.deepEqual(phone, { width: 1666, height: 2221 });
  assert.ok(phone.width * phone.height <= 3_750_000);
  // kırpılmış uzun Z (1:5): en uzun kenar 2576
  assert.deepEqual(fitWithin(800, 4000, maxEdge, maxPixels), { width: 515, height: 2576 });
  // sınırın içindeki görsel değişmez (kayıtlı deneme görselleri aynı ölçüde gider, AI_REPLAY onları ölçüsünden tanır)
  assert.deepEqual(fitWithin(517, 1600, maxEdge, maxPixels), { width: 517, height: 1600 });
  assert.deepEqual(fitWithin(1200, 1600, maxEdge, maxPixels), { width: 1200, height: 1600 });
  // maxPixels verilmezse yalnız kenar sınırı (fatura belgeleri)
  assert.deepEqual(fitWithin(4032, 3024, 2000), { width: 2000, height: 1500 });
  assert.ok(maxEdge <= 2576 && maxBytes < MAX_PHOTO_BYTES && maxEdge <= 4096);
});

test("uploadErrorText: sunucunun metni önce; yoksa durum koduna göre", () => {
  assert.equal(uploadErrorText(429, { error: "Bir saatte en çok 30 fotoğraf eklenebilir." }), "Bir saatte en çok 30 fotoğraf eklenebilir.");
  assert.equal(uploadErrorText(413, null), "Fotoğraf 2 MB'tan büyük; uygulama küçültemedi, yeniden deneyin.");
  assert.equal(uploadErrorText(413, "<html>Request Entity Too Large</html>"), "Fotoğraf 2 MB'tan büyük; uygulama küçültemedi, yeniden deneyin.");
  assert.match(uploadErrorText(0, null), /Bağlantı kurulamadı/);
  assert.match(uploadErrorText(401, {}), /Oturum kapanmış/);
  assert.match(uploadErrorText(502, { error: "  " }), /kaydedilemedi/);
  assert.equal(uploadErrorText(418, null), "Fotoğraf yüklenemedi (hata 418).");
});

test("readingOffText ve photoCaption", () => {
  assert.equal(readingOffText("on", true), null);
  assert.match(readingOffText("nokey", false) ?? "", /bu ortamda kapalı/);
  assert.match(readingOffText("off", true) ?? "", /Ayarlar › Fotoğraftan okuma/);
  assert.doesNotMatch(readingOffText("off", false) ?? "", /Ayarlar/);
  assert.match(readingOffText("cap", false) ?? "", /sınırı doldu; fotoğraf yine eklenir/);
  assert.equal(photoCaption("kasa-z", "2026-10-22T20:52:00Z", "Ayşe"), "Z raporu · 23:52 · Ayşe");
  assert.equal(photoCaption("fis", new Date("2026-10-22T11:05:00Z"), null), "Fiş · 14:05");
});

test("kayıtlı yanıtlar yalnız geliştirmede ve AI_REPLAY=1 iken; türe ve deneme görselinin ölçüsüne göre seçilir", () => {
  assert.equal(replayEnabled({ NODE_ENV: "development", AI_REPLAY: "1" }), true);
  assert.equal(replayEnabled({ NODE_ENV: "production", AI_REPLAY: "1" }), false);
  assert.equal(replayEnabled({ NODE_ENV: "test", AI_REPLAY: "1" }), false);
  assert.equal(replayEnabled({ NODE_ENV: "development" }), false);
  assert.equal(replayEnabled({ NODE_ENV: "development", AI_REPLAY: "true" }), false);

  const doc = (a: ReturnType<typeof replayAnswer>) => (a.json as { documentType: string }).documentType;
  const Z = { width: 864, height: 1390 };
  const POS = { width: 768, height: 965 };
  const MARKET = { width: 864, height: 1069 };
  const TALIMAT = { width: 864, height: 862 };
  assert.equal((replayAnswer("kasa-z", Z).json as { zNo: string }).zNo, "0187");
  assert.equal(doc(replayAnswer("kasa-z", POS)), "bank_pos_end_of_day");
  assert.equal(doc(replayAnswer("kasa-z", MARKET)), "purchase_receipt");
  assert.equal(doc(replayAnswer("kasa-pos", POS)), "bank_pos_end_of_day");
  assert.equal(doc(replayAnswer("kasa-pos", Z)), "z_report");
  assert.equal(doc(replayAnswer("fis", MARKET)), "purchase_receipt");
  assert.deepEqual((replayAnswer("fis", TALIMAT).json as { issues: string[] }).issues.includes("contains_instructions"), true);
  assert.equal(doc(replayAnswer("fis", Z)), "z_report");
  // Yazarkasanın mali Z'si (make-images.py › yazarkasa-z.jpg): iki kasa bölümünde de belge türü, alan yok
  const OKC = { width: 731, height: 1600 };
  assert.equal(doc(replayAnswer("kasa-z", OKC)), "fiscal_z_report");
  assert.equal(doc(replayAnswer("kasa-pos", OKC)), "fiscal_z_report");
  assert.equal(KasaZRaw.safeParse(replayAnswer("kasa-z", OKC).json).success, true);
  assert.equal(KasaPosRaw.safeParse(replayAnswer("kasa-pos", OKC).json).success, true);
  assert.equal(doc(replayAnswer("fis", OKC)), "z_report");
  // Başka bir fotoğraf: türün olağan yanıtı
  assert.equal(doc(replayAnswer("kasa-z", { width: 1200, height: 1600 })), "z_report");
  assert.equal(doc(replayAnswer("fis", null)), "purchase_receipt");
});

// ── Kaynak denetimleri: anahtar ve depo sunucuda kalır, Blob'a yönlendirme yok ──

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("kaynak: Claude isteğinde düşünme / sıcaklık / ön doldurma yok; Blob özel; fotoğraf yolu kuralla açılır", () => {
  for (const f of ["src/server/ai/claude.ts", "src/server/ai/run.ts"]) {
    const code = read(f)
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    for (const bad of ["temperature", "top_p", "top_k", "thinking:", '"assistant"', "role: \"assistant\""]) {
      assert.equal(code.includes(bad), false, `${f}: ${bad}`);
    }
  }
  const drivers = read("src/server/storage/drivers.ts");
  assert.match(drivers, /access: "private"/);
  const route = read("src/app/api/foto/[id]/route.ts");
  assert.match(route, /canViewPhoto\(/);
  assert.doesNotMatch(route, /redirect/i);
  assert.match(read("src/server/storage/photo-access.ts"), /photoViewDecision\(\{ id: me\.id, role: adminLevel\(me\.role\) \}, photo, now\)/);

  const src = walk(join(ROOT, "src"));
  for (const f of src) {
    const code = readFileSync(f, "utf8");
    const rel = relative(ROOT, f);
    assert.equal(/access:\s*"public"/.test(code), false, `${rel}: herkese açık Blob`);
    assert.equal(code.includes("blob.vercel-storage"), false, `${rel}: Blob adresi`);
    if (!/^\s*["']use client["']/m.test(code)) continue;
    for (const mod of ["@/server/ai", "@/server/storage", "@/server/photo-read", "@anthropic-ai/sdk", "@vercel/blob"]) {
      assert.equal(code.includes(`from "${mod}`), false, `${rel} istemci dosyası ${mod} içeri alıyor`);
    }
  }
  // Claude'u çağıran dosyalar yalnız sunucuda: fotoğraf yolları, okuma ve Ayarlar'ın sunucu bileşenleri
  const callers = src.filter((f) => readFileSync(f, "utf8").includes('from "@/server/ai/claude"')).map((f) => relative(ROOT, f));
  for (const f of callers) {
    assert.ok(
      f.startsWith("src/app/api/foto/") || f.startsWith("src/server/") || f === "src/app/panel/kasa/page.tsx" || f === "src/app/panel/ayarlar/photo-card.tsx",
      `beklenmeyen çağıran: ${f}`,
    );
  }
});

test("uploadRule: yönetici her güne; personel Z / POS'u açık güne ya da geç rapor gününe, fişi son 7 güne; ileri gün ve kontrol yok", () => {
  const today = "2026-10-24";
  // Yönetici: geçmiş ve bugün serbest, ileri gün ve gün yoksa hayır
  assert.equal(uploadRule("admin", "kasa-z", "2026-09-01", today), "yes");
  assert.equal(uploadRule("admin", "fis", today, today), "yes");
  assert.equal(uploadRule("admin", "kasa-z", "2026-10-25", today), "no");
  assert.equal(uploadRule("admin", "kasa-pos", null, today), "no");
  // Kontrol listelerinin kendi yolu var
  assert.equal(uploadRule("admin", "kontrol", today, today), "no");
  assert.equal(uploadRule("staff", "kontrol", today, today), "no");
  // Personel: Z ve POS fotoğrafı açık güne ya da geç rapor gününe (staffDayOpen || staffLateDayOpen); fiş kasadan çıkan
  // isteğinin penceresine (iş günü ile 7 gün öncesi; kapanmış ve eski güne istekle)
  for (const kind of ["kasa-z", "kasa-pos", "kasa-okc"] as const) {
    assert.equal(uploadRule("staff", kind, today, today), "open-or-late");
    assert.equal(uploadRule("staff", kind, "2026-10-14", today), "open-or-late");
  }
  assert.equal(uploadRule("staff", "fis", today, today), "yes");
  assert.equal(uploadRule("staff", "fis", "2026-10-17", today), "yes");
  assert.equal(uploadRule("staff", "fis", "2026-10-16", today), "no");
  assert.equal(uploadRule("staff", "fis", "2026-10-14", today), "no");
  assert.equal(uploadRule("staff", "fis", "2026-10-25", today), "no");
  assert.equal(uploadRule("staff", "kasa-z", "2026-10-25", today), "no");
  assert.equal(uploadRule("staff", "kasa-z", null, today), "no");
  // Kural kaynakta: personelin geç günü yalnız Z / POS'ta, staffLateDayOpen pencereye, ilk rapora, raporsuz ve kapalı olmayan güne bakar
  const rules = readFileSync(join(process.cwd(), "src/server/photo-read/rules.ts"), "utf8");
  assert.match(rules, /if \(rule === "open-or-late" && \(await staffLateDayOpen\(day\)\)\) return true;/);
  // Gün sonu tam (24 Kasım 2026): LafPOS gününün gün sonu fotoğrafı (yalnız yazarkasa bölümü) 14 güne kadar
  assert.match(rules, /return \(kind === "kasa-okc" \|\| kind === "kasa-pos"\) && lafposPhotoDayOpen\(getDb\(\), day, await currentTillBranch\(\), opsLevel\(me\.role\)\);/);
  assert.match(rules, /export async function staffLateDayOpen[\s\S]*?if \(!staffLateDay\(day\)\) return false;[\s\S]*?first\.date >= day \|\| same[\s\S]*?isClosedDay\(day, db, till\)/);
});

test("yazarkasa Z'si (kasa-okc, dalga 13): tür listesinde, 400 gün saklanır, etiketi, bölüme en çok 3 fotoğraf; erişimi kasanın kuralı", () => {
  assert.ok(PHOTO_KINDS.includes("kasa-okc") && isPhotoKind("kasa-okc"));
  assert.equal(KEEP_DAYS["kasa-okc"], 400);
  assert.equal(PHOTO_KIND_LABEL["kasa-okc"], "Yazarkasa Z");
  assert.equal(keepUntil("kasa-okc", "2026-10-22").toISOString(), new Date("2027-11-26T00:00:00+03:00").toISOString());
  assert.equal(linkedUntil("kasa-okc", "2026-01-05", "2026-10-22").toISOString(), keepUntil("kasa-okc", "2026-10-22").toISOString());
  assert.equal(MAX_OKC_PHOTOS, 3);
  assert.ok(MAX_OKC_PHOTOS < MAX_REPORT_PHOTOS);
  // Erişim: personel kuralı kasanınki (aynı canView), saklama türün kendi süresi (src/server/photo-read/rules.ts)
  const rules = readFileSync(join(ROOT, "src/server/photo-read/rules.ts"), "utf8");
  assert.match(rules, /export const okcPhotoRules: PhotoKindRules = \{ \.\.\.cashPhotoRules, keepDays: KEEP_DAYS\["kasa-okc"\] \}/);
  assert.match(readFileSync(join(ROOT, "src/server/storage/photo-access.ts"), "utf8"), /"kasa-okc": okcPhotoRules/);
});
