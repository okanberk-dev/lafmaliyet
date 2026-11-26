/**
 * Tarayıcı ölçümü (docs/FOTOGRAF.md › Tarayıcının ölçümü). Veri setindeki (scripts/tarama-veri.ts) her görsel
 * çekirdeğin `scanDocument`'ından (src/lib/scan) geçer, sonuç bilinen yanıtla karşılaştırılır:
 *
 * - köşe hatası: en kötü köşenin uzaklığı, köşegenin yüzdesi (ortalama, p90); başarı < %2. Kırpılmayan görselde
 *   kullanılan köşeler görüntünün köşeleridir (kaçan belgenin hatası da sayılır).
 * - karar: kırptı / kareyi dolduruyor / belge yok; beklenene göre doğru, kaçan, yanlış (yanlış pozitif dahil).
 * - süre: algılama + açma + görünüm (ms; bu makinede).
 * - okunabilirlik: tesseract.js (src/server/photo-read/ocr.ts ile aynı ayar, Türkçe, tek blok) ile asıl fotoğrafın ve
 *   taranmış hâlin bilinen metne karakter doğruluğu ve tutarların (1.234,56) aynen bulunma oranı; `--ideal` ile doğru
 *   köşelerle taranmış hâlinki de (algılamanın ve görünümün payını ayırır).
 *
 * Kategori, zemin, durum ve senaryo kırılımlı tablolar, karar matrisi ve en kötü 10 görsel yazılır; ayrıntı
 * .data/tarama-olcum/sonuc-<tarih>.json ve son.json'a.
 *
 *   npm run tarama:olc                     # .data/tarama-veri (önce: npx tsx scripts/tarama-veri.ts)
 *   npm run tarama:olc -- --ocr 0          # okunabilirliksiz (hızlı: yalnız köşe, karar, süre)
 *   npm run tarama:olc -- --ideal          # doğru köşelerle taramanın okunabilirliği de
 *   npm run tarama:olc -- --fixture        # tests/fixtures/tarama (regresyon örnekleri)
 *   npm run tarama:olc -- --yalniz pavo    # adında geçenler
 *   npm run tarama:olc -- --cizim          # doğru (yeşil) ve bulunan (kırmızı) köşeler çizili küçük resimler
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { scanDocument, type ScanResult } from "../src/lib/scan";
import type { Quad } from "../src/lib/scan/image";
import { OCR_LANG_DIR } from "../src/server/photo-read/ocr";
import {
  BASARI_ESIGI,
  dortgen,
  gorselOku,
  karakterDogrulugu,
  koseHatasi,
  ortalama,
  pngYap,
  sharpAl,
  sonucu,
  tutarBulma,
  yuzdelik,
  type Beklenen,
  type GorselYaniti,
  type Karar,
  type VeriYaniti,
} from "./tarama/olcu";

interface Okunabilirlik {
  asil: number;
  taranmis: number;
  ideal?: number;
  tutarAsil: number | null;
  tutarTaranmis: number | null;
  tutarIdeal?: number | null;
}

interface Kayit {
  ad: string;
  kategori: string;
  zemin: string;
  durum: string;
  senaryolar: string[];
  beklenen: Beklenen;
  karar: Karar;
  sonuc: "dogru" | "kacan" | "yanlis";
  /** En kötü köşe, köşegenin oranı (doğru köşe yoksa null) */
  hata: number | null;
  hataOrt: number | null;
  guven: number;
  yontem: string;
  nedenler: string[];
  donus: number;
  sure: ScanResult["timings"];
  ocr?: Okunabilirlik;
}

function arg(ad: string): string | undefined {
  const i = process.argv.indexOf(`--${ad}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const yuzde = (x: number | null | undefined, basamak = 1) => (x == null || Number.isNaN(x) ? "–" : `%${(x * 100).toFixed(basamak).replace(".", ",")}`);
const ms = (x: number) => (Number.isNaN(x) ? "–" : String(Math.round(x)));

/* ------------------------------------------------------------------ OCR havuzu */

interface OcrHavuzu {
  oku(gorsel: Buffer): Promise<string>;
  kapat(): Promise<void>;
}

/** tesseract.js işçileri (yeniden kullanılır; ayar src/server/photo-read/ocr.ts ile aynı) */
async function ocrHavuzu(n: number): Promise<OcrHavuzu> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const isciler = await Promise.all(
    Array.from({ length: n }, async () => {
      const w = await createWorker("tur", OEM.LSTM_ONLY, { langPath: OCR_LANG_DIR, cacheMethod: "none", gzip: true });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
      return w;
    }),
  );
  type Isci = (typeof isciler)[number];
  const bos: Isci[] = [...isciler];
  const sira: ((w: Isci) => void)[] = [];
  return {
    async oku(gorsel) {
      const w = bos.pop() ?? (await new Promise<Isci>((res) => sira.push(res)));
      try {
        const r = await w.recognize(gorsel, {}, { text: true });
        return r.data.text ?? "";
      } finally {
        const sonraki = sira.shift();
        if (sonraki) sonraki(w);
        else bos.push(w);
      }
    },
    async kapat() {
      await Promise.all(isciler.map((w) => w.terminate()));
    },
  };
}

/* ------------------------------------------------------------------ çizim */

async function ciz(yol: string, hedef: string, g: GorselYaniti, bulunan: Quad, k: Kayit): Promise<void> {
  const sharp = await sharpAl();
  const T = 520;
  const s = T / Math.max(g.genislik, g.yukseklik);
  const w = Math.round(g.genislik * s);
  const h = Math.round(g.yukseklik * s);
  const poly = (q: readonly { x: number; y: number }[], renk: string) =>
    `<polygon points="${q.map((p) => `${(p.x * s).toFixed(1)},${(p.y * s).toFixed(1)}`).join(" ")}" fill="none" stroke="${renk}" stroke-width="2"/>`;
  const dogru = g.koseler ? poly(dortgen(g.koseler), "#00e000") : "";
  const bul = k.karar === "kirp" ? poly(bulunan, "#ff2020") : "";
  const yazi = `${g.ad} · ${k.sonuc} · ${k.karar} · ${k.hata == null ? "" : yuzde(k.hata)} · ${k.yontem} ${k.guven}`;
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${dogru}${bul}<rect x="0" y="0" width="${w}" height="16" fill="#000a"/><text x="4" y="12" font-size="11" fill="#fff" font-family="sans-serif">${yazi.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
  await sharp(yol)
    .resize(w, h)
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 80 })
    .toFile(hedef);
}

/* ------------------------------------------------------------------ tablolar */

interface Ozet {
  n: number;
  dogru: number;
  kacan: number;
  yanlis: number;
  hataOrt: number;
  hataP90: number;
  enKotu: number;
  sureOrt: number;
  sureP90: number;
  ocrAsil: number;
  ocrTaranmis: number;
  ocrIdeal: number;
  tutarAsil: number;
  tutarTaranmis: number;
}

function ozetle(ks: Kayit[]): Ozet {
  const h = ks.filter((k) => k.hata != null).map((k) => k.hata as number);
  const o = ks.filter((k) => k.ocr);
  const num = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number");
  return {
    n: ks.length,
    dogru: ks.filter((k) => k.sonuc === "dogru").length,
    kacan: ks.filter((k) => k.sonuc === "kacan").length,
    yanlis: ks.filter((k) => k.sonuc === "yanlis").length,
    hataOrt: ortalama(h),
    hataP90: yuzdelik(h, 0.9),
    enKotu: h.length ? Math.max(...h) : NaN,
    sureOrt: ortalama(ks.map((k) => k.sure.total)),
    sureP90: yuzdelik(
      ks.map((k) => k.sure.total),
      0.9,
    ),
    ocrAsil: ortalama(o.map((k) => k.ocr!.asil)),
    ocrTaranmis: ortalama(o.map((k) => k.ocr!.taranmis)),
    ocrIdeal: ortalama(num(o.map((k) => k.ocr!.ideal))),
    tutarAsil: ortalama(num(o.map((k) => k.ocr!.tutarAsil))),
    tutarTaranmis: ortalama(num(o.map((k) => k.ocr!.tutarTaranmis))),
  };
}

function tablo(baslik: string, gruplar: Map<string, Kayit[]>, ideal: boolean): string[] {
  const basliklar = ["", "n", "doğru", "kaçan", "yanlış", "hata ort", "hata p90", "en kötü", "süre ms", "OCR asıl", "OCR tarama", ...(ideal ? ["OCR ideal"] : []), "tutar asıl", "tutar tarama"];
  const satirlar: string[][] = [];
  for (const [ad, ks] of gruplar) {
    const o = ozetle(ks);
    satirlar.push([
      ad,
      String(o.n),
      `${o.dogru} (${yuzde(o.dogru / o.n, 0)})`,
      String(o.kacan),
      String(o.yanlis),
      yuzde(o.hataOrt),
      yuzde(o.hataP90),
      yuzde(o.enKotu),
      ms(o.sureOrt),
      yuzde(o.ocrAsil, 0),
      yuzde(o.ocrTaranmis, 0),
      ...(ideal ? [yuzde(o.ocrIdeal, 0)] : []),
      yuzde(o.tutarAsil, 0),
      yuzde(o.tutarTaranmis, 0),
    ]);
  }
  const gen = basliklar.map((b, i) => Math.max(b.length, ...satirlar.map((s) => s[i].length)));
  const sat = (s: string[]) => "| " + s.map((x, i) => (i === 0 ? x.padEnd(gen[i]) : x.padStart(gen[i]))).join(" | ") + " |";
  return [`\n### ${baslik}\n`, sat(basliklar), "|" + gen.map((g, i) => (i === 0 ? "-".repeat(g + 2) : "-".repeat(g + 1) + ":")).join("|") + "|", ...satirlar.map(sat)];
}

function grupla(ks: Kayit[], anahtar: (k: Kayit) => string[], sira?: readonly string[]): Map<string, Kayit[]> {
  const m = new Map<string, Kayit[]>();
  for (const s of sira ?? []) m.set(s, []);
  for (const k of ks) for (const a of anahtar(k)) m.set(a, [...(m.get(a) ?? []), k]);
  for (const [a, v] of m) if (!v.length) m.delete(a);
  return m;
}

/* ------------------------------------------------------------------ ana akış */

async function main() {
  const fixture = process.argv.includes("--fixture");
  const dizin = arg("veri") ?? (fixture ? "tests/fixtures/tarama" : ".data/tarama-veri");
  const ocrAcik = (arg("ocr") ?? "1") !== "0";
  const ideal = process.argv.includes("--ideal");
  const cizim = process.argv.includes("--cizim");
  const yalniz = arg("yalniz");
  const isci = Number(arg("is") ?? 2);
  const yanitYolu = join(dizin, "yanit.json");
  if (!existsSync(yanitYolu)) {
    console.error(`${yanitYolu} yok. Önce: npx tsx scripts/tarama-veri.ts${fixture ? " --fixture" : ""}`);
    process.exit(2);
  }
  const veri = JSON.parse(readFileSync(yanitYolu, "utf8")) as VeriYaniti;
  const gorseller = veri.gorseller.filter((g) => !yalniz || g.ad.includes(yalniz));
  const ciktiDizini = ".data/tarama-olcum";
  mkdirSync(ciktiDizini, { recursive: true });
  if (cizim) mkdirSync(join(ciktiDizini, "cizim"), { recursive: true });
  const ocr = ocrAcik ? await ocrHavuzu(isci) : null;
  const kayitlar: Kayit[] = [];
  const bekleyen: Promise<void>[] = [];
  const t0 = Date.now();
  for (let i = 0; i < gorseller.length; i++) {
    const g = gorseller[i];
    const yol = join(dizin, g.dosya);
    const img = await gorselOku(yol);
    const r = scanDocument(img);
    const karar: Karar = r.fillsFrame ? (r.method === "tam-kare" ? "tam-kare" : "yok") : "kirp";
    const dogru = g.koseler ? dortgen(g.koseler) : null;
    const h = dogru ? koseHatasi(r.corners, dogru, img.width, img.height) : null;
    const k: Kayit = {
      ad: g.ad,
      kategori: g.kategori,
      zemin: g.zemin,
      durum: g.durum,
      senaryolar: g.senaryolar,
      beklenen: g.beklenen,
      karar,
      sonuc: sonucu(g.beklenen, karar, h?.enKotu ?? null),
      hata: h?.enKotu ?? null,
      hataOrt: h?.ort ?? null,
      guven: Math.round(r.confidence * 1000) / 1000,
      yontem: r.method,
      nedenler: r.reasons,
      donus: Math.round(r.rotation * 10) / 10,
      sure: Object.fromEntries(Object.entries(r.timings).map(([a, v]) => [a, Math.round(v)])) as ScanResult["timings"],
    };
    kayitlar.push(k);
    console.log(
      `${String(i + 1).padStart(3)}/${gorseller.length} ${g.ad.padEnd(44)} ${k.sonuc.padEnd(6)} ${karar.padEnd(8)} ${(k.hata == null ? "" : yuzde(k.hata)).padStart(6)}  ${r.method} ${r.confidence}  ${k.sure.total} ms`,
    );
    if (cizim) await ciz(yol, join(ciktiDizini, "cizim", `${g.ad}.jpg`), g, r.corners, k);
    if (ocr && g.metin.length) {
      const bilinen = g.metin.join("\n");
      const asilBuf = readFileSync(yol);
      const tarBuf = await pngYap(r.image);
      const idealBuf = ideal && dogru && g.beklenen === "kirp" ? await pngYap(scanDocument(img, { corners: dogru }).image) : null;
      bekleyen.push(
        (async () => {
          const [a, t, d] = await Promise.all([ocr.oku(asilBuf), ocr.oku(tarBuf), idealBuf ? ocr.oku(idealBuf) : Promise.resolve(null)]);
          k.ocr = {
            asil: karakterDogrulugu(a, bilinen),
            taranmis: karakterDogrulugu(t, bilinen),
            tutarAsil: tutarBulma(a, bilinen),
            tutarTaranmis: tutarBulma(t, bilinen),
            ...(d !== null ? { ideal: karakterDogrulugu(d, bilinen), tutarIdeal: tutarBulma(d, bilinen) } : {}),
          };
        })(),
      );
      // OCR kuyruğu taramanın çok gerisinde kalmasın (bellek)
      if (bekleyen.length > isci + 2) await bekleyen.shift();
    }
  }
  await Promise.all(bekleyen);
  await ocr?.kapat();
  const sureSn = Math.round((Date.now() - t0) / 1000);

  // ---- rapor
  const satir: string[] = [];
  const kirp = kayitlar.filter((k) => k.beklenen === "kirp");
  const yakin = kayitlar.filter((k) => k.beklenen === "tam-kare");
  const degil = kayitlar.filter((k) => k.beklenen === "belge-degil");
  const belge = kayitlar.filter((k) => k.beklenen !== "belge-degil");
  const ok = ozetle(kirp);
  const hepsi = ozetle(kayitlar);
  const ob = ozetle(belge);
  satir.push(`## Tarayıcı ölçümü — ${dizin} (${kayitlar.length} görsel, ${sureSn} sn)`);
  satir.push("");
  satir.push(`- Köşe (kırpılması gereken ${kirp.length} görsel): başarı ${ok.dogru}/${kirp.length} (${yuzde(ok.dogru / kirp.length, 0)}; en kötü köşe < ${yuzde(BASARI_ESIGI, 0)}), kaçan ${ok.kacan}, yanlış dörtgen ${ok.yanlis}; hata ort ${yuzde(ok.hataOrt)}, p90 ${yuzde(ok.hataP90)}`);
  if (yakin.length) {
    const kat = yakin.filter((k) => k.karar === "tam-kare").length;
    const kirpmadi = yakin.filter((k) => k.sonuc === "dogru").length;
    satir.push(`- Kareyi dolduran (${yakin.length}): "kareyi dolduruyor" dedi ${kat}, kırpmadı ya da doğru kırptı ${kirpmadi}; başka görselde yanlışlıkla "kareyi dolduruyor" ${kayitlar.filter((k) => k.beklenen !== "tam-kare" && k.karar === "tam-kare").length}`);
  }
  if (degil.length) {
    const yok = degil.filter((k) => k.karar === "yok").length;
    const yp = degil.filter((k) => k.karar === "kirp").length;
    satir.push(`- Belge değil (${degil.length}): "belge yok" dedi ${yok}, kırpmadı ${degil.length - yp}, yanlış pozitif (kırptı) ${yp}; belgede "belge yok" ${belge.filter((k) => k.karar === "yok").length}`);
  }
  satir.push(`- Genel doğru: ${hepsi.dogru}/${hepsi.n} (${yuzde(hepsi.dogru / hepsi.n, 0)}); süre ort ${ms(hepsi.sureOrt)} ms, p90 ${ms(hepsi.sureP90)} ms (algılama ort ${ms(ortalama(kayitlar.map((k) => k.sure.detect)))} ms)`);
  if (ocrAcik)
    satir.push(
      `- Okunabilirlik (${belge.filter((k) => k.ocr).length} belge, karakter doğruluğu): asıl ${yuzde(ob.ocrAsil, 0)} → taranmış ${yuzde(ob.ocrTaranmis, 0)}${ideal ? ` (doğru köşelerle ${yuzde(ozetle(kirp).ocrIdeal, 0)})` : ""}; tutar bulma asıl ${yuzde(ob.tutarAsil, 0)} → taranmış ${yuzde(ob.tutarTaranmis, 0)}`,
    );
  const KAT = ["pavo-z", "pavo-gunsonu", "modpos-z", "banka-batch", "market", "market-58", "market-uzun", "fatura-a4", "belge-degil"];
  satir.push(...tablo("Kategori", grupla(kayitlar, (k) => [k.kategori], KAT), ideal));
  satir.push(...tablo("Zemin", grupla(kayitlar, (k) => [k.zemin], ["ahsap", "mermer", "koyu-tezgah", "beyaz-tezgah", "gri-masa", "elde"]), ideal));
  satir.push(...tablo("Durum", grupla(kayitlar, (k) => [k.durum], ["normal", "yakin", "kadraj-disi"]), ideal));
  satir.push(...tablo("Senaryo (bir görsel birden çok satırda)", grupla(kayitlar, (k) => (k.senaryolar.length ? k.senaryolar : ["(etkisiz)"])), ideal));
  // karar matrisi
  satir.push("\n### Karar (satır: beklenen, sütun: tarayıcının kararı)\n");
  satir.push("| beklenen | kırp | kareyi dolduruyor | belge yok |", "|---|---:|---:|---:|");
  for (const b of ["kirp", "tam-kare", "belge-degil"] as Beklenen[]) {
    const ks = kayitlar.filter((k) => k.beklenen === b);
    if (!ks.length) continue;
    const c = (kr: Karar) => ks.filter((k) => k.karar === kr).length;
    satir.push(`| ${b} | ${c("kirp")} | ${c("tam-kare")} | ${c("yok")} |`);
  }
  // en kötü 10
  const kotu = [...kayitlar]
    .filter((k) => k.sonuc !== "dogru" || (k.hata ?? 0) > BASARI_ESIGI * 0.5)
    .sort((a, b) => Number(b.sonuc !== "dogru") - Number(a.sonuc !== "dogru") || (b.hata ?? 1) - (a.hata ?? 1))
    .slice(0, 10);
  satir.push("\n### En kötü 10\n");
  for (const k of kotu)
    satir.push(`- ${k.ad}: ${k.sonuc} (${k.karar}${k.hata == null ? "" : `, hata ${yuzde(k.hata)}`}, ${k.yontem} ${k.guven}; ${k.nedenler.join(" ") || "–"}) [${k.senaryolar.join(", ")}]`);
  const metin = satir.join("\n");
  console.log("\n" + metin);

  const cekirdek = (() => {
    try {
      return execSync("git log -1 --format=%h -- src/lib/scan", { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  })();
  const sonuc = {
    tarih: new Date().toISOString(),
    cekirdek,
    veri: dizin,
    tohum: veri.tohum,
    secenekler: { ocr: ocrAcik, ideal, yalniz: yalniz ?? null },
    ozet: { kirp: ok, hepsi, belge: ob },
    rapor: metin,
    kayitlar,
  };
  const ad = `sonuc-${sonuc.tarih.slice(0, 16).replace(/[-:T]/g, "")}${fixture ? "-fixture" : ""}.json`;
  writeFileSync(join(ciktiDizini, ad), JSON.stringify(sonuc, null, 1));
  writeFileSync(join(ciktiDizini, fixture ? "son-fixture.json" : "son.json"), JSON.stringify(sonuc, null, 1));
  console.log(`\nAyrıntı: ${join(ciktiDizini, ad)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
