/**
 * Tarayıcı ölçümünün veri seti (docs/FOTOGRAF.md › Tarayıcının ölçümü). Gerçekçi kâğıtlar (Pavo detaylı Z, gün sonu,
 * ModPOS Z, banka batch fişi, market fişi 80 / 58 mm ve uzun rulo, A4 e-Arşiv fatura; scripts/tarama/kagit.ts)
 * Playwright ile resme çevrilir, telefonla çekilmiş gibi zemine bindirilir (scripts/tarama/sahne.ts) ve JPEG yazılır;
 * belge olmayan fotoğraflar (POS ekranı, tablo, telefon, koli, fincan, paketler) da vardır. Her görselin doğru köşeleri,
 * beklenen sonucu (kırp / kareyi dolduruyor / belge değil), kategori, zemin, senaryo etiketleri ve bilinen metni
 * `yanit.json`'a yazılır. Tohumludur: aynı tohum aynı veri setini üretir.
 *
 *   npx tsx scripts/tarama-veri.ts                  # 96 görsel → .data/tarama-veri/ (depoya girmez)
 *   npx tsx scripts/tarama-veri.ts --n 120 --tohum 7
 *   npx tsx scripts/tarama-veri.ts --fixture        # regresyon örnekleri → tests/fixtures/tarama/ (her biri < 60 KB)
 *
 * Görsel kodlama sharp ile (next'in isteğe bağlı bağımlılığı; yalnız betikler kullanır, uygulama kodu değil).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { seededRandom } from "../src/lib/scan/image";
import { KAGIT_TURLERI, NESNE_TURLERI, kagitUret, nesneUret, type Kagit, type KagitTuru, type NesneTuru } from "./tarama/kagit";
import { sharpAl, type GorselYaniti, type Kategori, type VeriYaniti } from "./tarama/olcu";
import { ZEMINLER, sahneCiz, sahnePlanla, type Durum, type Zemin } from "./tarama/sahne";

interface Plan {
  kategori: Kategori;
  nesne?: NesneTuru;
  zemin: Zemin;
  durum: Durum;
  W: number;
  H: number;
}

const TERMAL = new Set<Kategori>(["pavo-z", "pavo-gunsonu", "modpos-z", "banka-batch", "market", "market-58", "market-uzun"]);

function arg(ad: string): string | undefined {
  const i = process.argv.indexOf(`--${ad}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Veri setinin dağılımı: belge değil ~%12, kareyi dolduran ~%8, kadraj dışı ~%8, kalanı normal (8 kâğıt türü sırayla) */
function planla(n: number, rnd: () => number): Plan[] {
  const out: Plan[] = [];
  const kare = (): [number, number] => {
    const r = rnd();
    return r < 0.6 ? [1500, 2000] : r < 0.9 ? [1200, 1600] : [1080, 1920];
  };
  const nBelgeDegil = Math.round(n * 0.125);
  const nYakin = Math.round(n * 0.085);
  const nKadraj = Math.round(n * 0.085);
  const nNormal = n - nBelgeDegil - nYakin - nKadraj;
  for (let j = 0; j < nNormal; j++) {
    const kategori = KAGIT_TURLERI[j % KAGIT_TURLERI.length];
    const zemin = ZEMINLER[(j + Math.floor(j / KAGIT_TURLERI.length)) % ZEMINLER.length];
    let [W, H] = kare();
    // dar uzun fişi yatay tutup çekmek (kâğıt yana dönük)
    if ((kategori === "market-uzun" || kategori === "pavo-z" || kategori === "market") && rnd() < 0.12) [W, H] = [2000, 1500];
    out.push({ kategori, zemin, durum: "normal", W, H });
  }
  const YAKIN: KagitTuru[] = ["fatura-a4", "pavo-z", "fatura-a4", "market", "modpos-z", "fatura-a4", "market-uzun", "pavo-gunsonu"];
  for (let j = 0; j < nYakin; j++) {
    const [W, H] = kare();
    out.push({ kategori: YAKIN[j % YAKIN.length], zemin: ZEMINLER[(j * 5 + 1) % ZEMINLER.length], durum: "yakin", W, H });
  }
  const KADRAJ: KagitTuru[] = ["market-uzun", "pavo-z", "market-uzun", "modpos-z", "pavo-gunsonu", "fatura-a4", "market-uzun", "pavo-z"];
  for (let j = 0; j < nKadraj; j++) {
    const [W, H] = kare();
    out.push({ kategori: KADRAJ[j % KADRAJ.length], zemin: ZEMINLER[(j * 5 + 3) % ZEMINLER.length], durum: "kadraj-disi", W, H });
  }
  for (let j = 0; j < nBelgeDegil; j++) {
    const [W, H] = kare();
    out.push({ kategori: "belge-degil", nesne: NESNE_TURLERI[j % NESNE_TURLERI.length], zemin: ZEMINLER[(j * 5 + 2) % ZEMINLER.length], durum: "normal", W, H });
  }
  // karıştır (alt küme de çeşitli olsun)
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}

/** Regresyon örnekleri: on küçük görsel, her durumdan */
const FIXTURE: Plan[] = (
  [
    ["pavo-z", "ahsap", "normal"],
    ["market-uzun", "beyaz-tezgah", "normal"],
    ["banka-batch", "koyu-tezgah", "normal"],
    ["fatura-a4", "mermer", "normal"],
    ["modpos-z", "gri-masa", "normal"],
    ["market-58", "elde", "normal"],
    ["pavo-gunsonu", "ahsap", "kadraj-disi"],
    ["fatura-a4", "gri-masa", "yakin"],
    ["belge-degil", "koyu-tezgah", "normal", "ekran-pos"],
    ["belge-degil", "ahsap", "normal", "kutu"],
  ] as [Kategori, Zemin, Durum, NesneTuru?][]
).map(([kategori, zemin, durum, nesne]) => ({ kategori, zemin, durum, nesne, W: 540, H: 720 }));

/*
 * Playwright depoda bağımlılık değil (geliştirme makinesinin genel kurulumu, NODE_PATH); ESM içe aktarımı NODE_PATH'e
 * bakmadığı için require ile yüklenir. Kullanılan kadarının tipi burada.
 */
interface Sayfa {
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  setContent(html: string, o: { waitUntil: "load" }): Promise<void>;
  evaluate(f: () => Promise<void>): Promise<void>;
  screenshot(o: { fullPage: boolean; omitBackground: boolean; type: "png" }): Promise<Buffer>;
  close(): Promise<void>;
}
interface Baglam {
  newPage(): Promise<Sayfa>;
}
interface Tarayici {
  newContext(o: { deviceScaleFactor: number; viewport: { width: number; height: number } }): Promise<Baglam>;
  close(): Promise<void>;
}
function playwright(): { chromium: { launch(): Promise<Tarayici> } } {
  return createRequire(join(process.cwd(), "package.json"))("playwright");
}

/** Kâğıdın HTML'ini PNG'ye çevirir (tam sayfa; nesnelerde saydam zemin) */
async function kagitPng(tarayici: Tarayici, baglamlar: Map<number, Baglam>, k: Kagit): Promise<Buffer> {
  let ctx = baglamlar.get(k.olcek);
  if (!ctx) {
    ctx = await tarayici.newContext({ deviceScaleFactor: k.olcek, viewport: { width: k.genislik, height: 600 } });
    baglamlar.set(k.olcek, ctx);
  }
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: k.genislik, height: 600 });
    await page.setContent(k.html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    return await page.screenshot({ fullPage: true, omitBackground: k.saydam, type: "png" });
  } finally {
    await page.close();
  }
}

async function main() {
  const fixture = process.argv.includes("--fixture");
  const tohum = Number(arg("tohum") ?? (fixture ? 4242 : 2026));
  const n = Number(arg("n") ?? 96);
  const cikti = arg("cikti") ?? (fixture ? "tests/fixtures/tarama" : ".data/tarama-veri");
  const rnd = seededRandom(tohum);
  const planlar = fixture ? FIXTURE : planla(n, rnd);
  rmSync(cikti, { recursive: true, force: true });
  mkdirSync(cikti, { recursive: true });
  const sharp = await sharpAl();
  const { chromium } = playwright();
  const tarayici = await chromium.launch();
  const baglamlar = new Map<number, Baglam>();
  const gorseller: GorselYaniti[] = [];
  const t0 = Date.now();
  try {
    for (let i = 0; i < planlar.length; i++) {
      const p = planlar[i];
      const gTohum = tohum * 1000 + i;
      const r = seededRandom(gTohum);
      const kagit = p.kategori === "belge-degil" ? nesneUret(p.nesne ?? "kutu", r) : kagitUret(p.kategori, r);
      const png = await kagitPng(tarayici, baglamlar, kagit);
      const meta = await sharp(png).metadata();
      const tw = meta.width ?? 1;
      const th = meta.height ?? 1;
      const plan = sahnePlanla(
        { W: p.W, H: p.H, zemin: p.zemin, durum: p.durum, oran: tw / th, termal: TERMAL.has(p.kategori), nesne: p.kategori === "belge-degil" },
        r,
        gTohum,
      );
      // doku izdüşümdeki boya yakın küçültülür (ızgara örneklemesi büyük küçültmede yazıyı bozmasın)
      const hedef = Math.max(16, Math.min(th, plan.dokuBoyu));
      const dokuBuf = await sharp(png)
        .resize(hedef < th ? { height: hedef } : undefined)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgb = sahneCiz(plan, { width: dokuBuf.info.width, height: dokuBuf.info.height, data: dokuBuf.data }, r);
      const ad = `${String(i).padStart(3, "0")}-${p.kategori === "belge-degil" ? `degil-${p.nesne}` : p.kategori}-${p.zemin}${p.durum === "normal" ? "" : `-${p.durum}`}`;
      const dosya = `${ad}.jpg`;
      const ham = sharp(Buffer.from(rgb), { raw: { width: p.W, height: p.H, channels: 3 } });
      let kalite = fixture ? 78 : Math.round(55 + r() * 37);
      let jpg = await ham.clone().jpeg({ quality: kalite }).toBuffer();
      // regresyon örnekleri küçük kalsın (< 60 KB)
      while (fixture && jpg.length > 58_000 && kalite > 30) {
        kalite -= 6;
        jpg = await ham.clone().jpeg({ quality: kalite }).toBuffer();
      }
      writeFileSync(join(cikti, dosya), jpg);
      const etiketler = [...plan.etiketler];
      if (kalite < 65) etiketler.push("jpeg-dusuk");
      if (p.kategori === "market-uzun") etiketler.push("uzun");
      if (p.kategori === "market-58" || p.kategori === "banka-batch") etiketler.push("58mm");
      gorseller.push({
        ad,
        dosya,
        genislik: p.W,
        yukseklik: p.H,
        kategori: p.kategori,
        ...(p.nesne ? { nesne: p.nesne } : {}),
        zemin: p.zemin,
        durum: p.durum,
        beklenen: p.kategori === "belge-degil" ? "belge-degil" : p.durum === "yakin" ? "tam-kare" : "kirp",
        koseler: plan.koseler ? plan.koseler.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10] as [number, number]) : null,
        senaryolar: etiketler,
        jpegKalite: kalite,
        tohum: gTohum,
        metin: kagit.metin,
      });
      console.log(`${String(i + 1).padStart(3)}/${planlar.length}  ${dosya}  ${Math.round(jpg.length / 1024)} KB  [${etiketler.join(", ")}]`);
    }
  } finally {
    await tarayici.close();
  }
  const yanit: VeriYaniti = { surum: 1, tohum, gorseller };
  writeFileSync(join(cikti, "yanit.json"), JSON.stringify(yanit, null, fixture ? 1 : 0) + "\n");
  console.log(`\n${gorseller.length} görsel → ${cikti}/ (${Math.round((Date.now() - t0) / 1000)} sn)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
