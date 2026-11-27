// Ad değişikliği (26 Kasım 2026; plan A1): kafenin kasa programının adı AsilPOS oldu (eski adı ESKI_URUN_ADI). Eski ad yalnız izinli
// yerlerde geçer, eski adların değerleri ve telin altın dosyaları değişmez.
// Çalıştırma: npx tsx --test tests/asilpos-adi.test.ts
//
// İzinli yerler:
// - src/lib/asilpos/eski-adlar.ts (TypeScript dosyaları eski adı yalnız oradan alır);
// - eski yolla kalan URL klasörleri (src/app/api/<eski>/kurulum, src/app/<eski>/indir: kurulu kasalar ve gönderilmiş
//   e-postalar), gönderilmiş migration'lar (drizzle/0000–0097, günlük ve anlık görüntüler) ile eski adlardan taşıyan
//   0098, tests/fixtures (telin altın dosyaları bayt bayt), iki depoda aynı docs/hesap-sozlesmesi.md;
// - TypeScript dışındaki dosyalarda (belge, betik, örnek ortam dosyası) ESKI_AD_METINLERI ve migration etiketleri,
//   belgede ayrıca BELGE_ALINTILARI ve eski git dalları (ESKI_DAL_ADI); eski adlı ortam değişkeni ancak aynı satırda
//   yeni adıyla ya da ESKI_ENV_ADLARI'ndaysa;
// - docs/*.md'den üretilen asistan bilgisi (knowledge-data.ts) belge kuralıyla.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as eskiAdlar from "../src/lib/asilpos/eski-adlar";
import { BELGE_ALINTILARI, ESKI_AD_METINLERI, ESKI_DAL_ADI, ESKI_ENV_ADLARI, ESKI_ENV_ONEKI, ESKI_GOC_ETIKETI, HESAP_SOZLESMESI, TEL_KAYNAK } from "../src/lib/asilpos/eski-adlar";
import { bankPosSchema, parsePosDay } from "../src/lib/asilpos/day";
import { ENV_ONEKI } from "../src/lib/asilpos/env";
import type { AsilposPhotoCheck } from "../src/lib/asilpos/foto";
import { photoCheckFromDb, photoCheckToDb } from "../src/lib/asilpos/foto-kayit";
import { notifyKeys, photoCheckHash, photoCheckHashLegacy, photoRows } from "../src/lib/asilpos/gun-sonu";
import { settingsFromRows } from "../src/lib/constants";

const root = join(__dirname, "..");
const ESKI_AD = new RegExp(TEL_KAYNAK, "i");
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/** Eski yolla kalan URL klasörleri (adları eski; içerikleri yeni işleyiciyi dışa verir) */
const URL_KLASORLERI = [`src/app/api/${TEL_KAYNAK}/`, `src/app/${TEL_KAYNAK}/`];
/** Gönderilmiş migration'lar (0000–0097, günlük ve anlık görüntüler) ve eski adlardan taşıyan 0098 */
const goc = (f: string) => {
  if (f.startsWith("drizzle/meta/") || f === "drizzle/0098_asilpos_adi.sql") return true;
  const m = /^drizzle\/(\d{4})_[a-z_]+\.sql$/.exec(f);
  return m !== null && Number(m[1]) <= 97;
};
/** İçeriğinin tamamı eski adla kalabilen dosyalar */
const tamDosya = (f: string) => f === "src/lib/asilpos/eski-adlar.ts" || f === HESAP_SOZLESMESI || f.startsWith("tests/fixtures/") || goc(f);
/** Eski belgenin yerinde kalan yönlendirme */
const ESKI_BELGE = `docs/${TEL_KAYNAK.toUpperCase()}.md`;
/** Adı eski adla kalabilen dosyalar: URL klasörleri, gönderilmiş migration'lar, eski belgenin yönlendirmesi */
const eskiAdliYol = (f: string) => URL_KLASORLERI.some((k) => f.startsWith(k)) || (goc(f) && !f.startsWith("drizzle/meta/")) || f === ESKI_BELGE;

const IKILI = /\.(ico|png|jpe?g|gif|webp|woff2?|ttf|otf|zip|pdf|mp3|wav|traineddata|gz)$/i;
const TS = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const BELGE = /\.(md|txt)$/;
/** docs/*.md'den üretilen asistan bilgisi: belge kuralı */
const URETILEN = new Set(["src/lib/assistant/knowledge-data.ts"]);

const cikar = (satir: string, metinler: readonly string[]) => [...metinler].sort((a, b) => b.length - a.length).reduce((s, m) => s.split(m).join(""), satir);
/** Eski adlı ortam değişkeni: izinli tam ad ya da aynı satırda yeni adıyla (şablonları da: `<önek>*`, `<önek>X`) */
const ESKI_ENV = new RegExp(`${ESKI_ENV_ONEKI}([A-Z0-9_*]*)`, "g");
const envCikar = (satir: string) => satir.replace(ESKI_ENV, (tam, ad: string) => (ESKI_ENV_ADLARI.includes(tam) || satir.includes(`${ENV_ONEKI}${ad}`) ? "" : tam));
const satirdanCikar = (satir: string, belge: boolean) => {
  let kalan = cikar(envCikar(satir), ESKI_AD_METINLERI).replace(ESKI_GOC_ETIKETI, "");
  if (belge) kalan = cikar(kalan, BELGE_ALINTILARI).replace(ESKI_DAL_ADI, "");
  return kalan;
};

test("eski ad yalnız izinli yerlerde: eski adlar modülü, URL klasörleri, migration'lar, altın dosyalar ve belgedeki alıntı", () => {
  const ihlal: string[] = [];
  for (const f of files) {
    if (ESKI_AD.test(f) && !eskiAdliYol(f)) ihlal.push(`${f}: dosya adı`);
    if (tamDosya(f) || IKILI.test(f)) continue;
    let metin: string;
    try {
      metin = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    if (!ESKI_AD.test(metin)) continue;
    metin.split("\n").forEach((satir, i) => {
      if (!ESKI_AD.test(satir)) return;
      if (TS.test(f) && !URETILEN.has(f)) return void ihlal.push(`${f}:${i + 1}: TypeScript eski adı src/lib/asilpos/eski-adlar.ts'ten almalı`);
      if (!ESKI_AD.test(satirdanCikar(satir, BELGE.test(f) || URETILEN.has(f)))) return;
      ihlal.push(`${f}:${i + 1}: ${satir.trim().slice(0, 160)}`);
    });
  }
  assert.deepEqual(ihlal, []);
});

test("eski adlı ortam değişkeni yalnız izinli adla ya da aynı satırda yeni adıyla birlikte geçer", () => {
  const E = ESKI_ENV_ONEKI;
  for (const satir of [`${E}SYNC_SECRET=`, "const s = process.env." + E + "SYNC_SECRET;", `| \`${E}KURUCU_URL\` | adres |`]) assert.ok(envCikar(satir).includes(E), satir);
  for (const satir of [`\`ASILPOS_SYNC_SECRET\` (eski adı \`${E}SYNC_SECRET\` da okunur)`, `ASILPOS_* (eski ad ${E}* da okunur)`]) assert.ok(!envCikar(satir).includes(E), satir);
  for (const ad of ESKI_ENV_ADLARI) assert.ok(!envCikar(`baglanti.${ad}`).includes(E), ad);
  assert.ok(envCikar(`ASILPOS_CLOUD_URL ve ${E}SYNC_SECRET`).includes(`${E}SYNC_SECRET`), "başka değişkenin yeni adı yetmez");
});

test("eski adların değerleri değişmez (kurulu kasa, canlıdaki eski sürüm, eski satırlar ve Resend bunlara bağlı)", () => {
  const degerler = Object.fromEntries(
    Object.entries(eskiAdlar)
      .filter(([, v]) => typeof v === "string" || (typeof v === "object" && v !== null && !(v instanceof RegExp) && !Array.isArray(v)))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  // Yeni bir eski ad eklenince bu özet bilerek güncellenir; var olan bir değer değişmemeli
  assert.equal(createHash("sha256").update(JSON.stringify(degerler)).digest("hex"), ESKI_ADLAR_OZETI);
});

test("telin altın dosyaları AsilPOS deposuyla bayt bayt aynı kalır; hesap sözleşmesi iki depoda aynı", () => {
  const ozet = (f: string) => createHash("sha256").update(readFileSync(join(root, f))).digest("hex");
  assert.equal(ozet("tests/fixtures/kabul-gunu-2026-11-22.json"), "5fb55e0cc9997c7b84c7ca08b87cad72f4cf47288f5521f6991298a1c08b245c");
  assert.equal(ozet("tests/fixtures/asilpos-gun.golden.json"), "46adb00d0fc3de3be88df7b7cd9a16e8a641b6c5f2c81ec61681230728f0e5d4");
  assert.equal(ozet("tests/fixtures/asilpos-gun-personel.golden.json"), "ea4f82573cb699120dff3bd0c282682ba89091e484e58d0736c7cab293c9b782");
  // Sabiti tests/hesap-sozlesmesi.test.ts'te; burada yalnız dosyanın ad değişikliğinde dokunulmadığı
  assert.ok(readFileSync(join(root, HESAP_SOZLESMESI), "utf8").includes(eskiAdlar.ESKI_URUN_ADI));
});

test("README ve docs/ASILPOS.md ad değişikliği notuyla başlar; eski belge yeni belgeye yönlendirir", () => {
  for (const f of ["README.md", "docs/ASILPOS.md"]) assert.equal(readFileSync(join(root, f), "utf8").split("\n")[0], eskiAdlar.AD_DEGISIKLIGI_NOTU, f);
  const eski = readFileSync(join(root, ESKI_BELGE), "utf8");
  assert.match(eski, /\]\(ASILPOS\.md\)/);
  assert.ok(eski.trim().split("\n").length <= 3, "eski belge yalnız yönlendirme");
});

test("saklanan değerler: eski anahtar okunur, yeni anahtar önce; gönderim kaydının iki anahtarı; tel iki adı da kabul eder", () => {
  // Geçiş gününün settings anahtarı
  assert.equal(settingsFromRows([{ key: eskiAdlar.GECIS_GUNU_AYARI, value: "2026-11-22" }]).asilposGecisGunu, "2026-11-22");
  assert.equal(settingsFromRows([{ key: eskiAdlar.GECIS_GUNU_AYARI, value: "2026-11-22" }, { key: "asilposGecisGunu", value: "2026-11-23" }]).asilposGecisGunu, "2026-11-23");
  assert.equal(settingsFromRows([]).asilposGecisGunu, null);
  // notification_log: yazılan eski önekli anahtar, okunan önce yeni önekli eşi
  const key = `${eskiAdlar.BILDIRIM_ONEKI.gun}marina:2026-11-22`;
  assert.deepEqual(notifyKeys(key), ["asilpos-gun:marina:2026-11-22", key]);
  assert.deepEqual(notifyKeys("cash:2026-11-22:r1"), ["cash:2026-11-22:r1"]);
  // Gün sonu gövdesi: kaynak ve kasa kartı iki adla
  const body = JSON.parse(readFileSync(join(root, "tests/fixtures/asilpos-gun.golden.json"), "utf8")) as Record<string, unknown> & { bankPos?: Record<string, unknown> };
  for (const source of [TEL_KAYNAK, "asilpos"]) assert.ok(parsePosDay(JSON.stringify({ ...body, source })).ok, source);
  const bank = { status: "ok", batchNo: "1", at: "2026-11-22T21:00:00.000Z", pavoCard: 10, asilposCard: 10, diff: 0, acquirers: [], message: null };
  assert.equal(bankPosSchema.parse(bank)[eskiAdlar.TEL_KART_ALANI], 10, "yeni ad saklanan eski ada çevrilir");
  assert.equal(bankPosSchema.parse({ ...bank, asilposCard: undefined, [eskiAdlar.TEL_KART_ALANI]: 7 })[eskiAdlar.TEL_KART_ALANI], 7);
});

test("gün sonu fotoğrafının karşılaştırması: satırın eski adlı alanı okunur, yazılan eski ad; özetler değişmez", () => {
  const ESKI = eskiAdlar.FOTO_SATIR_ALANI;
  // 24 Kasım 2026'dan beri saklanan biçim (canlıdaki eski sürüm yazar ve okur)
  const stored = {
    at: "2026-11-25T21:30:00.000Z",
    photos: 1,
    state: "fark",
    source: "ai",
    model: "m",
    rows: [
      { label: "Banka POS toplamı", photo: "1.000,00 ₺", [ESKI]: "1.000,00 ₺", ok: true },
      { label: "Yazarkasa Z no", photo: "0012", [ESKI]: "gönderilmedi; raporda 0011", ok: false },
      { label: "Pavo detaylı Z", photo: "yok", [ESKI]: "Z rakamları geldi", ok: true, info: true },
    ],
    issues: ["Yazarkasa Z no: fotoğrafta 0012; AsilPOS'ta gönderilmedi; raporda 0011"],
    readBankPos: null,
  };
  const check = photoCheckFromDb(stored);
  assert.deepEqual(
    check.rows.map((r) => r.asilpos),
    ["1.000,00 ₺", "gönderilmedi; raporda 0011", "Z rakamları geldi"],
  );
  assert.ok(check.rows.every((r) => !(ESKI in r)), "eski alan kalmaz");
  assert.deepEqual(Object.keys(check.rows[0]), ["label", "photo", "asilpos", "ok"], "alanların sırası korunur");
  assert.match(photoRows(check)[2][1], /AsilPOS'ta gönderilmedi; raporda 0011/);
  // Özet satırın değerlerinden: eski sürümün aynı satırlarla hesapladığı özet (notification_log anahtarı) değişmez
  const asNew = { ...stored, rows: stored.rows.map(({ [ESKI]: v, ...r }) => ({ ...r, asilpos: v })) } as unknown as AsilposPhotoCheck;
  assert.equal(photoCheckHash(check), photoCheckHash(asNew));
  assert.equal(photoCheckHashLegacy(check), photoCheckHashLegacy(asNew));
  // Yazılan eski ad; yeniden okunan aynı
  const written = photoCheckToDb(check) as typeof stored;
  assert.deepEqual(written, stored);
  assert.deepEqual(photoCheckFromDb(JSON.parse(JSON.stringify(written))), check);
  // Temizlik PR'ının yeni adlı satırı da okunur; ikisi birden varsa yeni ad geçer
  assert.equal(photoCheckFromDb({ ...stored, rows: [{ label: "x", photo: "1", asilpos: "2", ok: false }] }).rows[0].asilpos, "2");
  assert.deepEqual(photoCheckFromDb({ ...stored, rows: [{ label: "x", photo: "1", [ESKI]: "eski", asilpos: "yeni", ok: false }] }).rows[0], { label: "x", photo: "1", asilpos: "yeni", ok: false });
  // Satırsız ya da bozuk değer olduğu gibi
  assert.deepEqual(photoCheckFromDb({ state: "okunmadi" }), { state: "okunmadi" });
});

/** eski-adlar.ts'teki değerlerin özeti (bilerek güncellenir) */
const ESKI_ADLAR_OZETI = "45babebbd813bc9dee2a5886350fe7a2872be76c3e3423c3bb73a2e7578b7e8b";
