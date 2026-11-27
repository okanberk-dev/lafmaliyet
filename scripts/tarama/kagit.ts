/**
 * Tarayıcı ölçümünün kâğıtları (docs/FOTOGRAF.md › Tarayıcının ölçümü): Pavo detaylı Z, AsilPOS/Pavo gün sonu, ModPOS Z,
 * banka batch fişi, market fişi (80 ve 58 mm; uzun rulo) ve A4 e-Arşiv fatura; ayrıca belge OLMAYAN nesneler (POS ekranı, tablo
 * açık dizüstü, telefon, koli, ürünler). Her kâğıt tohumlu üretilir: aynı tohum aynı HTML'i ve aynı bilinen metni verir.
 * HTML Playwright ile resme çevrilir (scripts/tarama-veri.ts); bilinen metin okunabilirlik ölçümünde kullanılır
 * (scripts/tarama-olc.ts). İçerik uydurmadır: gerçek işletme, kişi ya da banka yok.
 */

import { ESKI_KAGIT_ADI } from "../../src/lib/asilpos/eski-adlar";

export type KagitTuru = "pavo-z" | "pavo-gunsonu" | "modpos-z" | "banka-batch" | "market" | "market-58" | "market-uzun" | "fatura-a4";
export const KAGIT_TURLERI: readonly KagitTuru[] = ["pavo-z", "pavo-gunsonu", "modpos-z", "banka-batch", "market", "market-58", "market-uzun", "fatura-a4"];

export type NesneTuru = "ekran-pos" | "ekran-tablo" | "telefon" | "kutu" | "urun-fincan" | "urun-paket";
export const NESNE_TURLERI: readonly NesneTuru[] = ["ekran-pos", "ekran-tablo", "telefon", "kutu", "urun-fincan", "urun-paket"];

export interface Kagit {
  html: string;
  /** Sayfanın CSS genişliği (px) ve cihaz ölçeği: 80 mm rulo 576 nokta, 58 mm 384 nokta, A4 794 px */
  genislik: number;
  olcek: number;
  /** Kâğıttaki yazı, satır satır (süs çizgileri, barkod yok); nesnelerde boş */
  metin: string[];
  /** Saydam zeminle çekilir (nesneler: yuvarlak fincan, köşesi yuvarlak tablet) */
  saydam: boolean;
}

type Rnd = () => number;

interface Satir {
  l?: string;
  r?: string;
  c?: string;
  kalin?: boolean;
  buyuk?: boolean;
  cizgi?: boolean;
  bosluk?: boolean;
  barkod?: boolean;
  logo?: string;
}

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ri = (rnd: Rnd, a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const sec = <T>(rnd: Rnd, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const iki = (n: number) => String(n).padStart(2, "0");
const para = (rnd: Rnd, a: number, b: number) => Math.round((a + rnd() * (b - a)) * 4) / 4;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function tarihSaat(rnd: Rnd): { tarih: string; saat: string } {
  return { tarih: `${iki(ri(rnd, 1, 28))}.${iki(ri(rnd, 1, 12))}.2026`, saat: `${iki(ri(rnd, 21, 23))}:${iki(ri(rnd, 0, 59))}` };
}

const FIRMALAR = [
  ["ÖRNEK KAHVE GIDA SAN. TİC. LTD. ŞTİ.", "CUMHURİYET MAH. İSTASYON CAD. NO:14/A", "TUZLA / İSTANBUL", "TUZLA V.D. 6340128457"],
  ["DENEME DONDURMA VE KAHVE A.Ş.", "YALI MAH. SAHİL YOLU SOK. NO:7", "KARTAL / İSTANBUL", "KARTAL V.D. 2910456738"],
  ["ŞUBE ÜÇ YİYECEK İÇECEK LTD. ŞTİ.", "BAĞLARBAŞI MAH. ÇINAR SOK. NO:22/B", "PENDİK / İSTANBUL", "PENDİK V.D. 8120347765"],
] as const;

function baslik(rnd: Rnd): Satir[] {
  const f = sec(rnd, FIRMALAR);
  return [{ c: f[0], kalin: true }, { c: f[1] }, { c: f[2] }, { c: f[3] }];
}

function pavoZ(rnd: Rnd): Satir[] {
  const { tarih, saat } = tarihSaat(rnd);
  const s: Satir[] = [...baslik(rnd), { cizgi: true }];
  s.push({ l: `TARİH : ${tarih}`, r: `SAAT : ${saat}` });
  s.push({ l: `FİŞ NO : ${String(ri(rnd, 80, 260)).padStart(4, "0")}`, r: `Z NO : ${String(ri(rnd, 100, 400)).padStart(4, "0")}` });
  s.push({ bosluk: true }, { c: "DETAYLI Z RAPORU", buyuk: true }, { cizgi: true });
  let top = 0;
  let kdvTop = 0;
  for (const oran of [1, 10, 20]) {
    const t = para(rnd, 600, 9000);
    const k = Math.round(((t * oran) / (100 + oran)) * 100) / 100;
    top += t;
    kdvTop += k;
    s.push({ l: `TOPLAM %${oran}`, r: `*${tl(t)}` }, { l: `KDV %${oran}`, r: `*${tl(k)}` });
  }
  s.push({ cizgi: true }, { l: "TOPLAM", r: `*${tl(top)}`, buyuk: true }, { l: "TOPLAM KDV", r: `*${tl(kdvTop)}`, kalin: true }, { cizgi: true });
  const nakit = Math.round(top * (0.2 + rnd() * 0.2) * 4) / 4;
  const yemek = Math.round(top * (0.03 + rnd() * 0.06) * 4) / 4;
  s.push({ l: "NAKİT", r: `*${tl(nakit)}` }, { l: "KREDİ KARTI", r: `*${tl(top - nakit - yemek)}` }, { l: "YEMEK KARTI", r: `*${tl(yemek)}` }, { cizgi: true });
  s.push({ c: "DEPARTMAN SATIŞLARI", kalin: true });
  for (const d of ["KAHVE", "SOĞUK İÇECEK", "DONDURMA", "TATLI", "PAKET ÜRÜN", "ÇAY", "ATIŞTIRMALIK", "DİĞER"]) {
    s.push({ l: `${d} x${ri(rnd, 4, 180)}`, r: `*${tl(para(rnd, 120, 4200))}` });
  }
  s.push({ cizgi: true });
  s.push({ l: "SATIŞ FİŞ ADEDİ", r: String(ri(rnd, 60, 240)) }, { l: "İPTAL FİŞ ADEDİ", r: String(ri(rnd, 0, 4)) });
  s.push({ l: "İPTAL TUTARI", r: `*${tl(para(rnd, 0, 300))}` }, { l: "İNDİRİM TOPLAMI", r: `*${tl(para(rnd, 0, 500))}` });
  s.push({ l: "ARTIRIM TOPLAMI", r: "*0,00" }, { l: "FATURA ADEDİ", r: String(ri(rnd, 0, 3)) }, { l: "FATURA TOPLAMI", r: `*${tl(para(rnd, 0, 2000))}` });
  s.push({ cizgi: true }, { l: "KÜMÜLATİF TOPLAM", r: `*${tl(para(rnd, 900000, 4000000))}` }, { l: "KÜMÜLATİF KDV", r: `*${tl(para(rnd, 80000, 400000))}` });
  s.push({ l: "EKÜ NO", r: String(ri(rnd, 1, 6)).padStart(4, "0") }, { l: "EKÜ KALAN", r: `%${ri(rnd, 20, 95)}` }, { cizgi: true });
  s.push({ c: `MF PV ${String(ri(rnd, 10000, 99999)).padStart(8, "0")}`, kalin: true }, { c: "MALİ DEĞERİ YOKTUR YAZMAZ" }, { bosluk: true });
  return s;
}

function pavoGunSonu(rnd: Rnd): Satir[] {
  const { tarih, saat } = tarihSaat(rnd);
  const zNo = ri(rnd, 12, 96);
  const s: Satir[] = [{ c: sec(rnd, FIRMALAR)[0], kalin: true }, { c: `GÜN SONU · Z ${zNo}`, buyuk: true }, { c: `${tarih} ${saat}` }, { cizgi: true }];
  const brut = para(rnd, 9000, 32000);
  const ind = para(rnd, 0, 600);
  const iade = para(rnd, 0, 250);
  s.push({ l: "BRÜT SATIŞ", r: tl(brut) }, { l: "İNDİRİM", r: `-${tl(ind)}` }, { l: "İADE", r: `-${tl(iade)}` });
  s.push({ l: "NET CİRO", r: tl(brut - ind - iade), buyuk: true }, { cizgi: true });
  const nakit = Math.round((brut - ind - iade) * (0.2 + rnd() * 0.25) * 4) / 4;
  s.push({ l: "NAKİT", r: tl(nakit) }, { l: "KART", r: tl(brut - ind - iade - nakit) }, { l: "FİŞ ADEDİ", r: String(ri(rnd, 70, 260)) });
  s.push({ l: "ORTALAMA FİŞ", r: tl(para(rnd, 90, 240)) }, { l: "KASA AÇILIŞ", r: tl(para(rnd, 500, 2000)) }, { l: "KASADAN ÇIKAN", r: tl(para(rnd, 0, 900)) });
  s.push({ c: "AsilPOS yönetim raporudur, mali Z değildir" }, { cizgi: true }, { c: "BANKA GÜN SONU · PAVO", kalin: true }, { l: "Bankalar", r: "Adet   Tutar" });
  let bt = 0;
  for (const b of ["ÖRNEKBANK", "DENEME BANKASI", "ÜÇÜNCÜ KATILIM"]) {
    const t = para(rnd, 800, 9000);
    bt += t;
    s.push({ l: b, r: `${ri(rnd, 8, 90)}   ${tl(t)}` });
  }
  s.push({ l: "BANKA TOPLAMI", r: tl(bt), kalin: true }, { cizgi: true }, { c: `PAVO - ${ESKI_KAGIT_ADI} KARŞILAŞTIRMA`, kalin: true });
  s.push({ l: "AsilPOS kart", r: tl(bt) }, { l: "Pavo banka", r: tl(bt) }, { l: "Fark", r: "0,00" }, { bosluk: true });
  return s;
}

function modposZ(rnd: Rnd): Satir[] {
  const { tarih, saat } = tarihSaat(rnd);
  const s: Satir[] = [{ c: "MODPOS", buyuk: true }, ...baslik(rnd), { cizgi: true }, { c: "Z RAPORU", buyuk: true }];
  s.push({ l: `Tarih: ${tarih}`, r: `Saat: ${saat}` }, { l: `Z No: ${ri(rnd, 200, 900)}`, r: `Kasa: ${ri(rnd, 1, 3)}` }, { l: "Kasiyer:", r: sec(rnd, ["KASA 1", "VARDİYA A", "VARDİYA B"]) }, { cizgi: true });
  s.push({ c: "ÜRÜN GRUPLARI", kalin: true });
  let top = 0;
  for (const g of ["Espresso Bazlı", "Filtre Kahve", "Soğuk Kahve", "Affogato", "Dondurma", "Pasta & Tatlı", "Sandviç", "Şişe İçecek", "Çekirdek Kahve"]) {
    const t = para(rnd, 150, 5200);
    top += t;
    s.push({ l: `${g} (${ri(rnd, 3, 160)})`, r: tl(t) });
  }
  s.push({ cizgi: true }, { l: "GENEL TOPLAM", r: tl(top), buyuk: true });
  const nakit = Math.round(top * (0.15 + rnd() * 0.3) * 4) / 4;
  s.push({ l: "Nakit", r: tl(nakit) }, { l: "Kredi Kartı", r: tl(Math.round((top - nakit) * 0.9 * 4) / 4) }, { l: "Yemek Çeki", r: tl(Math.round((top - nakit) * 0.1 * 4) / 4) });
  s.push({ cizgi: true }, { l: "KDV %1 Matrah", r: tl(top * 0.2) }, { l: "KDV %10 Matrah", r: tl(top * 0.7) }, { l: "KDV %20 Matrah", r: tl(top * 0.1) });
  s.push({ l: "İkram", r: tl(para(rnd, 0, 300)) }, { l: "İptal", r: tl(para(rnd, 0, 200)) }, { l: "Adisyon Sayısı", r: String(ri(rnd, 60, 300)) }, { l: "Kişi Başı", r: tl(para(rnd, 80, 220)) });
  s.push({ cizgi: true }, { c: "Bu belge bilgi amaçlıdır" }, { bosluk: true });
  return s;
}

function bankaBatch(rnd: Rnd): Satir[] {
  const { tarih, saat } = tarihSaat(rnd);
  const banka = sec(rnd, ["ÖRNEKBANK", "DENEME BANKASI", "ÜÇÜNCÜ KATILIM"]);
  const s: Satir[] = [{ c: banka, buyuk: true }, { c: sec(rnd, FIRMALAR)[0].slice(0, 26) }, { c: "TUZLA / İSTANBUL" }, { cizgi: true }];
  s.push({ l: "İŞYERİ NO", r: String(ri(rnd, 100000000, 999999999)) }, { l: "TERMİNAL NO", r: `PV${ri(rnd, 100000, 999999)}` });
  s.push({ l: tarih, r: saat }, { l: "BATCH NO", r: String(ri(rnd, 100, 999)).padStart(6, "0") }, { bosluk: true }, { c: "GÜN SONU RAPORU", buyuk: true }, { c: "GRUP KAPAMA BAŞARILI", kalin: true }, { cizgi: true });
  let adet = 0;
  let top = 0;
  for (const k of ["VISA", "MASTERCARD", "TROY", "AMEX"]) {
    const a = ri(rnd, 0, 60);
    const t = a ? para(rnd, 200, 6000) : 0;
    adet += a;
    top += t;
    s.push({ l: `${k}  ${a}`, r: `${tl(t)} TL` });
  }
  s.push({ cizgi: true }, { l: "SATIŞ ADET", r: String(adet) }, { l: "SATIŞ TUTAR", r: `${tl(top)} TL`, kalin: true }, { l: "İADE ADET", r: "0" }, { l: "İADE TUTAR", r: "0,00 TL" });
  s.push({ l: "İPTAL ADET", r: String(ri(rnd, 0, 2)) }, { l: "NET TOPLAM", r: `${tl(top)} TL`, buyuk: true }, { cizgi: true }, { c: "BU BELGEYİ SAKLAYINIZ" }, { bosluk: true });
  return s;
}

const URUNLER = [
  "SÜT 1 LT", "TAM BUĞDAY EKMEK", "YUMURTA 15'Lİ", "BEYAZ PEYNİR KG", "ÇAY 1000 GR", "TOZ ŞEKER 5 KG", "AYÇİÇEK YAĞI 5 LT", "DOMATES KG", "SALATALIK KG",
  "KAŞAR PEYNİRİ 600G", "TEREYAĞI 250 GR", "MAKARNA 500 GR", "PİRİNÇ 2,5 KG", "SU 5 LT", "KAĞIT HAVLU 6'LI", "BULAŞIK DETERJANI", "ÇÖP TORBASI",
  "LİMON KG", "MUZ KG", "KREMA 200 ML", "FINDIK EZMESİ", "ÇİKOLATA 80 GR", "MADEN SUYU 6'LI", "PEÇETE 100'LÜ", "ISLAK MENDİL",
] as const;

function market(rnd: Rnd, dar: boolean, uzun = false): Satir[] {
  const { tarih, saat } = tarihSaat(rnd);
  const s: Satir[] = [{ logo: sec(rnd, ["ÖM", "DM", "ÜÇ"]) }, { c: sec(rnd, ["ÖRNEK MARKET A.Ş.", "DENEME GROSS MARKET", "ÜÇ YILDIZ SÜPERMARKET"]), kalin: true }];
  s.push({ c: "MERKEZ MAH. ÇARŞI CAD. NO:5" }, { c: "TUZLA / İSTANBUL" }, { c: "ANADOLU KURUMLAR V.D. 7340012986" }, { cizgi: true });
  s.push({ l: tarih, r: `FİŞ NO: ${String(ri(rnd, 1, 400)).padStart(4, "0")}` }, { l: `SAAT: ${saat}`, r: `KASA: ${ri(rnd, 1, 9)}` }, { cizgi: true });
  // uzun fiş: 80 mm rulo, 32–44 kalem (boy / en ≈ 1:7)
  const n = uzun ? ri(rnd, 32, 44) : dar ? ri(rnd, 5, 9) : ri(rnd, 11, 22);
  let top = 0;
  let kdv = 0;
  for (let i = 0; i < n; i++) {
    const u = sec(rnd, URUNLER);
    const fiyat = para(rnd, 12, 480);
    const oran = sec(rnd, [1, 10, 20]);
    top += fiyat;
    kdv += (fiyat * oran) / (100 + oran);
    const ad = dar ? u.slice(0, 15) : u;
    if (!dar && rnd() < 0.3) s.push({ l: `${ri(rnd, 2, 6)} AD x ${tl(fiyat / 2)}` });
    s.push({ l: `${ad} %${iki(oran)}`, r: `*${tl(fiyat)}` });
  }
  s.push({ cizgi: true }, { l: "TOPKDV", r: `*${tl(kdv)}` }, { l: "TOPLAM", r: `*${tl(top)}`, buyuk: true }, { cizgi: true });
  if (rnd() < 0.5) {
    const verilen = Math.ceil(top / 100) * 100;
    s.push({ l: "NAKİT", r: `*${tl(verilen)}` }, { l: "PARA ÜSTÜ", r: `*${tl(verilen - top)}` });
  } else {
    s.push({ l: "KREDİ KARTI", r: `*${tl(top)}` }, { l: "ONAY KODU", r: String(ri(rnd, 100000, 999999)) });
  }
  s.push({ cizgi: true }, { l: `EKÜ NO: ${ri(rnd, 1, 4)}`, r: `Z NO: ${ri(rnd, 100, 900)}` }, { c: `MF YK ${ri(rnd, 10000000, 99999999)}`, kalin: true });
  s.push({ c: "TEŞEKKÜR EDERİZ" }, { barkod: true }, { bosluk: true });
  return s;
}

function fisHtml(satirlar: Satir[], o: { genislik: number; punto: number; font: string; kagit: string; murekkep: string }): { html: string; metin: string[] } {
  const metin: string[] = [];
  const g: string[] = [];
  for (const s of satirlar) {
    const cls = `${s.kalin ? " k" : ""}${s.buyuk ? " b" : ""}`;
    if (s.cizgi) g.push(`<div class="cz"></div>`);
    else if (s.bosluk) g.push(`<div class="bs"></div>`);
    else if (s.barkod) g.push(`<div class="bk"></div>`);
    else if (s.logo) g.push(`<div class="lg"><span>${esc(s.logo)}</span></div>`);
    else if (s.c != null) {
      g.push(`<div class="s c${cls}">${esc(s.c)}</div>`);
      metin.push(s.c);
    } else {
      g.push(`<div class="s${cls}"><span>${esc(s.l ?? "")}</span><span>${esc(s.r ?? "")}</span></div>`);
      metin.push(`${s.l ?? ""} ${s.r ?? ""}`.trim());
    }
  }
  const p = o.punto;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${o.genislik}px;background:${o.kagit};color:${o.murekkep};font-family:${o.font};font-size:${p}px;line-height:1.28;padding:${Math.round(p * 1.4)}px ${Math.round(p * 0.8)}px ${Math.round(p * 2.2)}px;filter:blur(0.35px)}
.s{display:flex;justify-content:space-between;white-space:pre;gap:${p}px}
.s.c{justify-content:center;text-align:center}
.k{font-weight:700}
.b{font-size:${Math.round(p * 1.5)}px;font-weight:700;line-height:1.35}
.cz{border-top:2px dashed ${o.murekkep};margin:${Math.round(p * 0.45)}px 0}
.bs{height:${p}px}
.bk{height:${p * 3}px;margin:${p}px ${p * 2}px 0;background:repeating-linear-gradient(90deg,${o.murekkep} 0 2px,transparent 2px 5px,${o.murekkep} 5px 6px,transparent 6px 10px,${o.murekkep} 10px 13px,transparent 13px 15px)}
.lg{display:flex;justify-content:center;margin-bottom:${Math.round(p * 0.5)}px}
.lg span{display:flex;align-items:center;justify-content:center;width:${p * 4}px;height:${p * 4}px;border-radius:50%;background:${o.murekkep};color:${o.kagit};font-weight:700;font-size:${Math.round(p * 1.6)}px;font-family:sans-serif}
</style></head><body>${g.join("")}</body></html>`;
  return { html, metin };
}

function faturaA4(rnd: Rnd): { html: string; metin: string[] } {
  const { tarih, saat } = tarihSaat(rnd);
  const metin: string[] = [];
  const m = (s: string) => {
    metin.push(s);
    return esc(s);
  };
  const satici = sec(rnd, ["ÖRNEK TOPTAN GIDA PAZARLAMA A.Ş.", "DENEME AMBALAJ SANAYİ LTD. ŞTİ.", "ÜÇ DAĞITIM LOJİSTİK TİC. A.Ş."]);
  const no = `GIB2026${String(ri(rnd, 1, 999999999)).padStart(9, "0")}`;
  const kalemler = ["Süt 1 L (koli 12)", "Kahve çekirdeği 1 kg", "Karton bardak 8 oz (1000 adet)", "Bardak kapağı (1000 adet)", "Pipet kağıt (500 adet)", "Vanilya şurubu 700 ml",
    "Karamel sosu 1 kg", "Peçete baskılı (koli)", "Çikolata sosu 1 kg", "Toz şeker stick (1000 adet)", "Krema 1 L", "Dondurma külahı (koli)", "Temizlik seti", "Islak mendil tekli (koli)"];
  const n = ri(rnd, 7, 13);
  let ara = 0;
  let kdv = 0;
  const tr: string[] = [];
  for (let i = 0; i < n; i++) {
    const miktar = ri(rnd, 1, 40);
    const birim = para(rnd, 18, 950);
    const oran = sec(rnd, [1, 10, 20]);
    const tutar = miktar * birim;
    ara += tutar;
    kdv += (tutar * oran) / 100;
    const h = [String(i + 1), kalemler[(i + ri(rnd, 0, 3)) % kalemler.length], String(miktar), "Adet", tl(birim), `%${oran}`, tl((tutar * oran) / 100), tl(tutar)];
    metin.push(h.join(" "));
    tr.push(`<tr>${h.map((x, j) => `<td class="${j >= 2 && j !== 3 ? "r" : ""}">${esc(x)}</td>`).join("")}</tr>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:794px;min-height:1123px;background:#fdfdfb;color:#161616;font-family:"DejaVu Sans",Arial,sans-serif;font-size:11.5px;line-height:1.45;padding:44px 46px}
.ust{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.kutu{border:1px solid #333;padding:8px 10px;width:300px}
h1{font-size:19px;letter-spacing:.5px}
.lg{width:92px;height:92px;border-radius:50%;border:3px solid #1f3a6e;color:#1f3a6e;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;text-align:center}
table{width:100%;border-collapse:collapse;margin-top:22px}
th{background:#e8ebf1;border:1px solid #333;padding:5px 4px;font-size:10.5px;text-align:left}
td{border:1px solid #666;padding:5px 4px}
.r{text-align:right}
.top{margin:14px 0 0 auto;width:310px}
.top div{display:flex;justify-content:space-between;border:1px solid #666;border-top:0;padding:5px 8px}
.top div:first-child{border-top:1px solid #666}
.top .g{font-weight:700;background:#e8ebf1}
.not{margin-top:26px;border:1px solid #666;padding:8px 10px}
.qr{width:92px;height:92px;background:conic-gradient(#111 25%,#fdfdfb 0 50%,#111 0 75%,#fdfdfb 0) 0 0/11px 11px;border:5px solid #fdfdfb;outline:1px solid #333}
</style></head><body>
<div class="ust"><div><div class="kutu"><b>${m(satici)}</b><br>${m("Organize Sanayi Bölgesi 4. Cadde No:18")}<br>${m("Gebze / KOCAELİ")}<br>${m(`Vergi Dairesi: İlyasbey VKN: ${ri(rnd, 1000000000, 9999999999)}`)}<br>${m("Tel: 0262 555 01 23 E-Posta: muhasebe@ornek.example")}</div></div>
<div class="lg">e-Arşiv<br>Fatura</div><div class="qr"></div></div>
<div class="ust" style="margin-top:22px"><div class="kutu"><b>${m("SAYIN")}</b><br>${m(sec(rnd, FIRMALAR)[0])}<br>${m("Cumhuriyet Mah. İstasyon Cad. No:14/A Tuzla / İSTANBUL")}<br>${m(`Vergi Dairesi: Tuzla VKN: ${ri(rnd, 1000000000, 9999999999)}`)}</div>
<div class="kutu" style="width:270px"><h1>${m("e-ARŞİV FATURA")}</h1>${m(`Fatura No: ${no}`)}<br>${m(`Fatura Tarihi: ${tarih} ${saat}`)}<br>${m("Senaryo: EARSIVFATURA")}<br>${m("Fatura Tipi: SATIŞ")}<br>${m(`ETTN: ${ri(rnd, 10000000, 99999999).toString(16)}-4c1e-8a2b-${ri(rnd, 100000, 999999)}f3d2`)}</div></div>
<table><thead><tr>${["Sıra", "Mal / Hizmet", "Miktar", "Birim", "Birim Fiyat", "KDV", "KDV Tutarı", "Mal Hizmet Tutarı"].map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${tr.join("")}</tbody></table>
<div class="top"><div><span>${esc("Mal Hizmet Toplam Tutarı")}</span><span>${esc(tl(ara))} TL</span></div><div><span>${esc("Hesaplanan KDV")}</span><span>${esc(tl(kdv))} TL</span></div><div class="g"><span>${esc("Ödenecek Tutar")}</span><span>${esc(tl(ara + kdv))} TL</span></div></div>
<div class="not">${m("Not: İrsaliye yerine geçer. Ödeme vadesi fatura tarihinden itibaren 30 gündür.")}<br>${m("Bu fatura e-Arşiv izni kapsamında elektronik ortamda iletilmiştir.")}</div>
</body></html>`;
  metin.push("Sıra Mal / Hizmet Miktar Birim Birim Fiyat KDV KDV Tutarı Mal Hizmet Tutarı");
  metin.push(`Mal Hizmet Toplam Tutarı ${tl(ara)} TL`, `Hesaplanan KDV ${tl(kdv)} TL`, `Ödenecek Tutar ${tl(ara + kdv)} TL`);
  return { html, metin };
}

/** Tohumlu kâğıt: HTML, CSS genişliği ve bilinen metin */
export function kagitUret(tur: KagitTuru, rnd: Rnd): Kagit {
  const termal = { kagit: sec(rnd, ["#fbfaf5", "#f8f8f6", "#fdfcf7"]), murekkep: sec(rnd, ["#17171c", "#1f1d2b", "#262626"]) };
  const dejavu = `"DejaVu Sans Mono",monospace`;
  const yap = (satirlar: Satir[], genislik: number, font: string, punto: number, olcek: number): Kagit => ({ ...fisHtml(satirlar, { genislik, punto, font, ...termal }), genislik, olcek, saydam: false });
  switch (tur) {
    case "pavo-z":
      return yap(pavoZ(rnd), 576, dejavu, 20, 1.5);
    case "pavo-gunsonu":
      return yap(pavoGunSonu(rnd), 576, dejavu, 20, 1.5);
    case "modpos-z":
      return yap(modposZ(rnd), 576, `"JetBrains Mono","DejaVu Sans Mono",monospace`, 20, 1.5);
    case "banka-batch":
      return yap(bankaBatch(rnd), 384, `"Courier 10 Pitch","DejaVu Sans Mono",monospace`, 20, 2);
    case "market":
      return yap(market(rnd, false), 576, dejavu, 20, 1.5);
    case "market-58":
      return yap(market(rnd, true), 384, dejavu, 17, 2);
    case "market-uzun":
      return yap(market(rnd, false, true), 576, dejavu, 20, 1.5);
    case "fatura-a4":
      return { ...faturaA4(rnd), genislik: 794, olcek: 1.6, saydam: false };
  }
}

/** Belge olmayan nesne (üstten görünüş): fotoğrafa kâğıt gibi bindirilir, beklenen sonuç "kırpma yok" */
export function nesneUret(tur: NesneTuru, rnd: Rnd): Kagit {
  const renkler = ["#c0392b", "#d68910", "#1e8449", "#2471a3", "#7d3c98", "#b9770e", "#148f77", "#a93226"];
  let govde = "";
  let genislik = 900;
  let stil = "";
  if (tur === "ekran-pos") {
    const kare = Array.from({ length: 12 }, (_, i) => `<div style="background:${renkler[(i + ri(rnd, 0, 7)) % 8]}">${esc(sec(rnd, ["Latte", "Americano", "Affogato", "Mocha", "Çay", "Tost", "Brownie", "Su"]))}<b>${ri(rnd, 40, 190)} ₺</b></div>`).join("");
    const sepet = Array.from({ length: 6 }, () => `<p><span>${esc(sec(rnd, ["Latte", "Affogato", "Su", "Brownie"]))}</span><span>${ri(rnd, 40, 190)},00</span></p>`).join("");
    stil = `.t{background:#16171b;border-radius:34px;padding:30px;display:flex;gap:14px;height:640px}.g{flex:2;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.g div{border-radius:10px;color:#fff;padding:10px;font:600 17px sans-serif;display:flex;flex-direction:column;justify-content:space-between}.sp{flex:1;background:#f4f5f7;border-radius:10px;padding:14px;font:15px sans-serif}.sp p{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #ccc}.sp h3{background:#1e8449;color:#fff;padding:12px;border-radius:8px;margin-top:20px;text-align:center}`;
    govde = `<div class="t"><div class="g">${kare}</div><div class="sp"><b>Adisyon 14</b>${sepet}<h3>ÖDEME AL</h3></div></div>`;
  } else if (tur === "ekran-tablo") {
    const satir = Array.from({ length: 18 }, (_, i) => `<tr><td>${i + 1}</td><td>${esc(sec(rnd, URUNLER))}</td><td>${ri(rnd, 1, 90)}</td><td>${tl(para(rnd, 10, 900))}</td><td>${tl(para(rnd, 100, 9000))}</td></tr>`).join("");
    stil = `.d{background:#9a9da3;border-radius:18px;padding:18px 18px 46px;height:620px}.e{background:#fff;height:100%;border:10px solid #111;border-radius:6px;overflow:hidden;font:12px sans-serif}.m{background:#1d6f42;color:#fff;padding:7px 10px;font-weight:700}table{border-collapse:collapse;width:100%}td{border:1px solid #c8c8c8;padding:4px 6px}`;
    govde = `<div class="d"><div class="e"><div class="m">stok-sayimi.xlsx</div><table>${satir}</table></div></div>`;
  } else if (tur === "telefon") {
    genislik = 420;
    const balon = Array.from({ length: 7 }, (_, i) => `<p class="${i % 2 ? "b" : "a"}">${esc(sec(rnd, ["Z raporu geldi mi?", "Birazdan atıyorum", "Kasa sayıldı", "Tamamdır", "Yarın 9'da açılış", "Süt siparişi verildi"]))}</p>`).join("");
    stil = `.t{background:#0b0b0d;border-radius:44px;padding:16px;height:840px}.e{background:#121b22;border-radius:30px;height:100%;padding:60px 14px;font:16px sans-serif;color:#e9edef;display:flex;flex-direction:column;gap:12px}p{padding:10px 13px;border-radius:12px;max-width:75%}.a{background:#1f2c34;align-self:flex-start}.b{background:#005c4b;align-self:flex-end}`;
    govde = `<div class="t"><div class="e">${balon}</div></div>`;
  } else if (tur === "kutu") {
    const kahve = sec(rnd, ["#b08a5a", "#a57c4c", "#c29a68"]);
    stil = `.k{background:${kahve};height:620px;position:relative;box-shadow:inset 0 0 60px rgba(60,30,0,.35)}.k:before{content:"";position:absolute;left:0;right:0;top:50%;height:3px;background:rgba(40,20,0,.55)}.bant{position:absolute;left:0;right:0;top:calc(50% - 38px);height:76px;background:rgba(235,215,170,.55)}.et{position:absolute;right:70px;top:70px;width:210px;background:#f3f1ea;padding:10px;font:11px sans-serif;color:#222}.d{position:absolute;left:80px;bottom:80px;border:5px solid #8e2b1d;color:#8e2b1d;font:700 34px sans-serif;padding:6px 18px;transform:rotate(-8deg)}`;
    govde = `<div class="k"><div class="bant"></div><div class="et"><b>ALICI</b><br>Deneme Kahve Şubesi<br>Tuzla / İstanbul<br>Koli 2 / 5</div><div class="d">KIRILIR</div></div>`;
  } else if (tur === "urun-fincan") {
    const f = (x: number, y: number, r: number, ic: string) =>
      `<div style="position:absolute;left:${x}px;top:${y}px;width:${r * 2.6}px;height:${r * 2.6}px;border-radius:50%;background:radial-gradient(#f4f1ea 60%,#d9d4c8 70%);box-shadow:0 0 0 2px #bbb"><div style="position:absolute;left:${r * 0.3}px;top:${r * 0.3}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:#fbfaf7;box-shadow:inset 0 0 0 ${r * 0.14}px #e8e4da"><div style="position:absolute;inset:${r * 0.22}px;border-radius:50%;background:radial-gradient(circle at 40% 35%,${ic},#2b1608)"></div></div></div>`;
    stil = `.s{height:700px;position:relative}.kt{position:absolute;left:560px;top:380px;width:230px;height:230px;background:#2471a3;border-radius:14px;box-shadow:inset 0 0 0 12px #1b5a85;color:#fff;font:700 36px sans-serif;display:flex;align-items:center;justify-content:center}`;
    govde = `<div class="s">${f(40, 60, 110, "#7a4a22")}${f(430, 20, 90, "#c89b62")}${f(120, 400, 95, "#4a2a12")}<div class="kt">SÜT</div></div>`;
  } else {
    const p = (x: number, y: number, w: number, h: number, renk: string, ad: string, a: number) =>
      `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:linear-gradient(100deg,${renk},#fff3 45%,${renk} 60%);border-radius:${Math.min(w, h) * 0.18}px;transform:rotate(${a}deg);display:flex;align-items:center;justify-content:center;color:#fff;font:700 ${Math.round(Math.min(w, h) * 0.24)}px sans-serif;box-shadow:inset 0 0 0 4px #0002">${esc(ad)}</div>`;
    stil = `.s{height:720px;position:relative}`;
    govde = `<div class="s">${p(40, 60, 330, 170, sec(rnd, renkler), "CİPS", -8)}${p(470, 40, 150, 380, sec(rnd, renkler), "KOLA", 6)}${p(90, 330, 300, 300, sec(rnd, renkler), "KAHVE", 14)}${p(660, 380, 200, 260, sec(rnd, renkler), "ÇAY", -4)}</div>`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{width:${genislik}px;background:transparent}${stil}</style></head><body>${govde}</body></html>`;
  return { html, genislik, olcek: 1.4, metin: [], saydam: true };
}
