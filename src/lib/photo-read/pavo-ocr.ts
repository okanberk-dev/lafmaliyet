/**
 * Kodla okuma: OCR satırlarından Pavo'nun gün sonu fişinin (istenince basılan detaylı Z: banka gün sonu ve Z'nin rakamları
 * tek fişte) kural tabanlı ayrıştırıcısı (saf; tests/gun-sonu-foto.test.ts, gerçek OCR'la tests/gun-sonu-foto-ocr.test.ts).
 * Sahibin isteği (24 Kasım 2026): "eğer AI token biterse de kod ile bir şey yaz ... ondan en doğru sonucu alabileceği
 * şekilde okusun". Yapay zekâ yokken (anahtar, kredi, sınır, hata; src/lib/photo-read/lafpos-read.ts) fotoğraf
 * src/server/photo-read/ocr.ts ile okunur, satırlar buraya gelir; çıktı yapay zekânın şemasıyla aynıdır (KasaOkcRaw), aynı
 * karşılaştırmadan geçer (src/lib/lafpos/foto.ts lafposPhotoCheck).
 *
 * Kurallar: rakam yalnız basıldığı gibi alınır, hiçbir rakam hesaplanmaz ya da tamamlanmaz. Tutar Türkçe biçimde
 * ("1.234,56", "*4160,00", sonda TL / ₺) olmalı; OCR'ın sözcük güveni OCR_MIN_CONFIDENCE'ın altındaysa ya da etiketin
 * sözcükleri seçilmiyorsa tutarın güveni "low"dur. Kendi içinde tutmayan satırlar (Σ ödemeler ≠ toplam, Σ KDV grupları ≠
 * toplam, KDV oranı tutmuyor, satış − iade ≠ net) hep birlikte "low" olur. Karşılaştırma kodla okunan "low" rakamı
 * okunmamış sayar: karşılaştırılan bir satır okunmadıysa sonuç "okunamadı — yönetici baksın"dır (uyumlu / fark değil).
 * KÜM. (kümülatif) satırları bugünün rakamı değildir, alınmaz.
 */

import { round2 } from "./common";
import type { AmountRaw, KasaOkc } from "./schemas";

export interface OcrWord {
  text: string;
  /** 0–100 (tesseract'ın sözcük güveni) */
  confidence: number;
}

export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
}

/** Bu güvenin altındaki sözcük (tutar, oran, Z no, batch no, tarih) şüphelidir */
export const OCR_MIN_CONFIDENCE = 80;
/** Etiketin sözcükleri bundan düşük güvenle okunduysa etiket yanlış okunmuş olabilir */
const LABEL_MIN_CONFIDENCE = 60;
const TOL = 0.01;

const AMOUNT = /^\*?((?:\d{1,3}(?:\.\d{3})+)|\d+),(\d{2})(?:TL|₺)?$/;

/** Türkçe tutar: "1.234,56", "*4160,00", "474,09TL"; ondalığı nokta olan ya da bozuk binlik ayraçlı metin null */
export function parseAmountTR(s: string): number | null {
  const m = AMOUNT.exec(s.trim().replace(/\s+/g, ""));
  if (!m) return null;
  return round2(Number(m[1].replace(/\./g, "")) + Number(m[2]) / 100);
}

/** Etiket karşılaştırması: büyük harf, Türkçe harfler aksansız ("KREDİ KARTI" → "KREDI KARTI") */
const fold = (s: string) =>
  s
    .toLocaleUpperCase("tr-TR")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9%.:/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const LOW_NONE: AmountRaw = { text: null, value: null, confidence: "low" };
const KDV_RATES = new Set([0, 1, 8, 10, 18, 20]);
const BANKS = ["GARANTI", "AKBANK", "YAPI KREDI", "IS BANKASI", "ISBANK", "ZIRAAT", "HALKBANK", "VAKIF", "QNB", "DENIZBANK", "TEB", "ING", "KUVEYT", "ALBARAKA", "SEKERBANK", "ODEABANK", "FIBABANK", "PAPARA", "PARAM"];
const MEAL = ["YEMEK", "MULTINET", "SODEXO", "PLUXEE", "EDENRED", "SETCARD", "TICKET", "METROPOL"];
const DAILY_TOTAL = new Set(["TOPLAM", "NET SATIS", "MALI VERI TOPLAM", "TOPSAT", "GENEL TOPLAM", "TOPLAM SATIS", "Z TOPLAM", "KDV DAHIL TOPLAM"]);

type Kind = KasaOkc["payments"][number]["kind"];
type Batch = KasaOkc["batches"][number];

/** Satırın tutarı (son tutar sözcüğü) ve etiketi; tutar yoksa null */
function splitLine(l: OcrLine): { label: OcrWord[]; amount: OcrWord } | null {
  const words = l.words.filter((w) => w.text.trim());
  let end = words.length;
  // Sondaki ayrı "TL" / "₺"
  if (end > 1 && /^(TL|₺)$/i.test(words[end - 1].text)) end--;
  const last = words[end - 1];
  if (!last || parseAmountTR(last.text) === null) return null;
  return { label: words.slice(0, end - 1), amount: last };
}

const sure = (w: OcrWord | undefined) => Boolean(w && w.confidence >= OCR_MIN_CONFIDENCE);
const labelSure = (ws: readonly OcrWord[]) => ws.every((w) => w.confidence >= LABEL_MIN_CONFIDENCE);

function amountOf(w: OcrWord, label: readonly OcrWord[]): AmountRaw {
  return { text: w.text, value: parseAmountTR(w.text), confidence: sure(w) && labelSure(label) ? "high" : "low" };
}

const low = (a: AmountRaw): AmountRaw => (a.text === null && a.value === null ? a : { ...a, confidence: "low" });
const isHigh = (a: AmountRaw) => a.confidence === "high" && a.value !== null;
/** Aynı alan ikinci kez okununca: aynı tutarsa kalır (ikisi de güvenliyse güvenli), farklıysa şüpheli */
function merge(prev: AmountRaw, next: AmountRaw): AmountRaw {
  if (prev.text === null && prev.value === null) return next;
  if (prev.value !== null && prev.value === next.value) return isHigh(prev) && isHigh(next) ? prev : low(prev);
  return low(prev);
}
const bankHit = (f: string) => BANKS.some((b) => new RegExp(`(^|\\s)${b}(\\s|$)`).test(f));

/**
 * LafPOS'un kendi gün sonu kâğıdının işaretleri (katlanmış metinde): "GÜN SONU · Z n" başlığı, "LafPOS yönetim
 * raporudur, mali Z değildir", "BANKA GÜN SONU · PAVO", "PAVO - LAFPOS KARŞILAŞTIRMA", "Pavo cihazının banka gün sonu
 * özetidir" (LafPOS src/lib/print.tsx ZReceipt, BankEodReceipt)
 */
const LAFPOS_MARK = /^GUN SONU Z \d+$|LAFPOS YONETIM RAPORUDUR|MALI Z DEGILDIR|BANKA GUN SONU PAVO|PAVO LAFPOS KARSILASTIRMA|PAVO CIHAZININ BANKA GUN SONU/;

/** İşaret karşılaştırması: ayraçlar ("·" OCR'da ":" ya da "." okunabilir) boşluk */
const markOf = (s: string) => fold(s).replace(/[.:/]/g, " ").replace(/\s+/g, " ").trim();

/** Kâğıt LafPOS'un kendi gün sonu kâğıdı mı (OCR satırlarından) */
export function isLafposPaperOcr(lines: readonly OcrLine[]): boolean {
  return lines.some((l) => LAFPOS_MARK.test(markOf(l.text)));
}

/**
 * LafPOS'un kâğıdı → KasaOkcRaw. Mali değildir: Z no'su, NET CİRO'su, ödemeleri ve KDV'si (LafPOS'un kendi rakamları)
 * okunmaz, Z sayılmaz. Banka kısmı ("BANKA GÜN SONU · PAVO") varsa banka gün sonu fişidir: "Bankalar" altındaki her satır
 * aynı batch'in bir bankası (batch no "Batch" satırından, net = satırın tutarı); banka satırı yoksa TOPLAM tek satır.
 * Bankaların toplamı TOPLAM'ı tutmuyorsa hepsi şüpheli. "PAVO - LAFPOS KARŞILAŞTIRMA" satırları (Pavo kart toplamı,
 * LafPOS kart toplamı, FARK) okunmaz. Banka kısmı yoksa yazılım Z'si (yanlış belge). Başlık aynen (okc.ts isLafposPaper)
 */
function parseLafposPaperOcr(lines: readonly OcrLine[]): { raw: KasaOkc; found: string[] } {
  const found = new Set<string>(["lafpos"]);
  let title: string | null = null;
  let date: string | null = null;
  let time: string | null = null;
  let dateConfidence: "high" | "low" = "low";
  let inBank = false;
  let batchNo: string | null = null;
  let total: AmountRaw = LOW_NONE;
  const banks: { bank: string; net: AmountRaw }[] = [];
  for (const l of lines) {
    const f = fold(l.text);
    if (!f) continue;
    if (date === null) {
      const dw = l.words.find((w) => /^\d{2}[./-]\d{2}[./-]\d{4}$/.test(w.text.replace(/[^\d./-]/g, "")));
      const m = dw ? /(\d{2})[./-](\d{2})[./-](\d{4})/.exec(dw.text) : null;
      if (m && dw && sure(dw)) {
        const iso = `${m[3]}-${m[2]}-${m[1]}`;
        if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
          date = iso;
          dateConfidence = "high";
          found.add("date");
          const tw = l.words.find((w) => /^\d{2}[:.]\d{2}$/.test(w.text));
          if (tw && sure(tw)) time = tw.text.replace(".", ":");
        }
      }
    }
    const mark = markOf(l.text);
    if (/^GUN SONU Z \d+$/.test(mark)) {
      title ??= l.text.trim();
      continue;
    }
    if (/BANKA GUN SONU PAVO/.test(mark)) {
      title ??= l.text.trim();
      inBank = true;
      continue;
    }
    if (!inBank) continue;
    // Karşılaştırma ve sonrası banka kısmı değil
    if (/PAVO LAFPOS KARSILASTIRMA|PAVO CIHAZININ/.test(mark)) {
      inBank = false;
      continue;
    }
    const bm = /^BATCH\s*:?\s*(\d+)$/.exec(f);
    if (bm) {
      const w = l.words.find((x) => x.text.replace(/\D/g, "") === bm[1]);
      batchNo = sure(w) ? bm[1] : null;
      continue;
    }
    const split = splitLine(l);
    if (!split) continue;
    const label = split.label.filter((w, k, all) => !(k === all.length - 1 && /^\(?\d+\)?$/.test(w.text)));
    const lf = fold(label.map((w) => w.text).join(" "));
    if (!lf || /^(CIHAZ SAATI|ALINIS|YAZDIRMA|BANKALAR|ISLEM YOK)/.test(lf)) continue;
    const amount = amountOf(split.amount, label);
    if (lf === "TOPLAM") {
      total = merge(total, amount);
      found.add("total");
      continue;
    }
    banks.push({ bank: label.map((w) => w.text).join(" ").trim(), net: amount });
    found.add("batch");
  }
  // Bankaların toplamı TOPLAM'ı tutmalı (hiçbir rakam düzeltilmez; tutmuyorsa hepsi şüpheli)
  if (banks.length && isHigh(total) && banks.every((b) => isHigh(b.net)) && Math.abs(round2(banks.reduce((a, b) => a + b.net.value!, 0)) - total.value!) > TOL) {
    for (const b of banks) b.net = low(b.net);
  }
  const entries = banks.length ? banks : total.text !== null ? [{ bank: null, net: total }] : [];
  const batches: Batch[] = entries.map((e) => ({ bank: e.bank, batchNo, date, salesTotal: LOW_NONE, refundTotal: LOW_NONE, netTotal: e.net, transactionCount: null }));
  const documentType: KasaOkc["documentType"] = batches.length ? "batch_slip" : title ? "software_z" : "other";
  const raw: KasaOkc = {
    documentType,
    fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
    readable: documentType !== "other",
    title,
    date,
    time,
    dateConfidence,
    zNo: { text: null, value: null, confidence: "low" },
    receiptCount: { text: null, value: null, confidence: "low" },
    dailyTotal: LOW_NONE,
    dailyTotalLabel: null,
    kdvGroups: [],
    totalVat: LOW_NONE,
    payments: [],
    outside: [],
    voids: LOW_NONE,
    discounts: LOW_NONE,
    cumulativeTotal: LOW_NONE,
    cumulativeVat: LOW_NONE,
    batches,
    issues: [],
  };
  return { raw, found: [...found] };
}

/**
 * OCR satırları → KasaOkcRaw. `found` hangi alanların okunduğunu söyler (günlük ve yöneticinin ayrıntısı için). Hiçbir
 * şey seçilmediyse belge türü "other" ve okunamaz. LafPOS'un kendi kâğıdı ayrı kurallarla okunur (Z sayılmaz)
 */
export function parsePavoOcr(lines: readonly OcrLine[]): { raw: KasaOkc; found: string[] } {
  if (isLafposPaperOcr(lines)) return parseLafposPaperOcr(lines);
  const found = new Set<string>();
  let date: string | null = null;
  let time: string | null = null;
  let dateConfidence: "high" | "low" = "low";
  let zNo: KasaOkc["zNo"] = { text: null, value: null, confidence: "low" };
  let receiptCount: KasaOkc["receiptCount"] = { text: null, value: null, confidence: "low" };
  let zMarker = false;
  let dailyTotal: AmountRaw = LOW_NONE;
  let dailyLabel: string | null = null;
  let totalVat: AmountRaw = LOW_NONE;
  let discounts: AmountRaw = LOW_NONE;
  let voids: AmountRaw = LOW_NONE;
  const payments: KasaOkc["payments"] = [];
  const kdv = new Map<number, { total: AmountRaw; vat: AmountRaw }>();
  const batches: Batch[] = [];
  /** Açık batch (banka bölümü) ve sonraki batch'in bankası */
  const cur: { open: Batch | null; bank: string | null } = { open: null, bank: null };
  const newBatch = (batchNo: string | null): Batch => {
    const b: Batch = { bank: cur.bank, batchNo, date: null, salesTotal: LOW_NONE, refundTotal: LOW_NONE, netTotal: LOW_NONE, transactionCount: null };
    batches.push(b);
    cur.bank = null;
    cur.open = b;
    found.add("batch");
    return b;
  };
  const kdvSet = (rate: number, key: "total" | "vat", a: AmountRaw) => {
    const g = kdv.get(rate) ?? { total: LOW_NONE, vat: LOW_NONE };
    g[key] = merge(g[key], a);
    kdv.set(rate, g);
    found.add("kdv");
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = fold(l.text);
    if (!f) continue;

    // Tarih ve saat (başlıkta): yalnız güvenle okunduysa
    if (date === null) {
      const dw = l.words.find((w) => /^\d{2}[./-]\d{2}[./-]\d{4}$/.test(w.text.replace(/[^\d./-]/g, "")));
      const m = dw ? /(\d{2})[./-](\d{2})[./-](\d{4})/.exec(dw.text) : null;
      if (m && dw) {
        const iso = `${m[3]}-${m[2]}-${m[1]}`;
        if (sure(dw) && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
          date = iso;
          dateConfidence = "high";
          found.add("date");
        }
        const tw = l.words.find((w) => /^\d{2}[:.]\d{2}$/.test(w.text));
        if (tw && sure(tw)) time = tw.text.replace(".", ":");
      }
    }
    // Kümülatif satırlar bugünün rakamı değil
    if (/\bKUM\b|\bKUM\.|KUMULATIF|KUMSAT|KUMKDV/.test(f)) continue;

    // Z no
    const zm = /\bZ\s*(?:NO|SAYAC|SAYACI)\b\s*:?\s*(\d+)/.exec(f);
    if (zm) {
      const w = l.words.find((x) => x.text.replace(/\D/g, "") === zm[1]);
      zNo = { text: zm[1], value: Number(zm[1]), confidence: sure(w) ? "high" : "low" };
      zMarker = true;
      found.add("zNo");
      cur.open = null;
      continue;
    }
    if (/\bZ RAPORU\b|\bDETAYLI Z\b/.test(f)) {
      zMarker = true;
      cur.open = null;
      continue;
    }
    // Batch / grup no: yeni batch (bankası önceki satırdaki banka adı)
    const bm = /\b(?:BATCH|GRUP|GRP)\s*(?:NO)?\s*:?\s*(\d+)/.exec(f);
    if (bm) {
      const w = l.words.find((x) => x.text.replace(/\D/g, "") === bm[1]);
      if (cur.open && cur.open.batchNo === null && cur.open.netTotal.text === null) cur.open.batchNo = sure(w) ? bm[1] : null;
      else newBatch(sure(w) ? bm[1] : null);
      continue;
    }
    const split = splitLine(l);
    // Banka adı satırı (tutarsız): sonraki batch'in bankası
    if (!split && bankHit(f)) {
      if (cur.open && cur.open.netTotal.text !== null) cur.open = null;
      if (cur.open && cur.open.bank === null) cur.open.bank = l.text.trim();
      else cur.bank = l.text.trim();
      continue;
    }
    // Etiket bu satırda, tutar alt satırda ("NAKİT 41" / "*1.055,00")
    let label: OcrWord[];
    let amountWord: OcrWord;
    if (split) {
      label = split.label;
      amountWord = split.amount;
    } else {
      const next = lines[i + 1];
      const nextSplit = next ? splitLine(next) : null;
      if (!nextSplit || nextSplit.label.length) {
        // Tutarsız sayaç satırları: fiş sayısı
        const cm = /\b(?:MUSTERI FIS ADEDI|MALI FIS ADEDI|FIS SAYISI|FIS ADEDI)\b\s*:?\s*(\d+)$/.exec(f);
        if (cm) {
          const w = l.words[l.words.length - 1];
          receiptCount = { text: cm[1], value: Number(cm[1]), confidence: sure(w) ? "high" : "low" };
        }
        continue;
      }
      // Etiketin sonundaki adet atılır
      label = l.words.filter((w, k, all) => !(k === all.length - 1 && /^\d+$/.test(w.text)));
      amountWord = nextSplit.amount;
      i++;
    }
    const lf = fold(label.map((w) => w.text).join(" "))
      .replace(/[:.]+$/, "")
      .trim();
    const amount = amountOf(amountWord, label);

    // KDV dökümü: "%10 TOPLAM", "%10 KDV", "KDV %10", "TOPKDV"; oran seçilmiyorsa (OCR % işaretini kaçırdı) şüpheli satır
    const kdvLike = /%|\bKDV\b|TOPKDV|MATRAH/.test(lf) || /^\S*\d\S*\s+(TOPLAM|TOP)$/.test(lf);
    if (kdvLike) {
      if (/^(MALI VERI )?TOPKDV$|^TOPLAM KDV$/.test(lf)) {
        totalVat = merge(totalVat, amount);
        continue;
      }
      if (/MATRAH/.test(lf)) continue;
      const rm = /%\s*(\d{1,2})\b/.exec(lf) ?? /\bKDV\s*%?\s*(\d{1,2})\b/.exec(lf) ?? /^(\d{1,2})\s/.exec(lf);
      const rateWord = rm ? label.find((w) => w.text.replace(/\D/g, "").endsWith(rm[1])) : undefined;
      const rate = rm ? Number(rm[1]) : NaN;
      const key = /\bKDV\b|TOPKDV/.test(lf) && !/TOPLAM|TUTAR/.test(lf) ? "vat" : "total";
      const okRate = rm !== null && KDV_RATES.has(rate) && sure(rateWord);
      kdvSet(okRate ? rate : -1, key, okRate ? amount : low(amount));
      continue;
    }

    // Banka gün sonu bölümü
    if (/^(SATIS TOPLAMI|SATIS|TOPLAM SATIS TUTARI)$/.test(lf) || /^(IADE TOPLAMI|IADE)$/.test(lf) || /^(NET TOPLAM|NET)$/.test(lf)) {
      const b = cur.open ?? newBatch(null);
      const k = /IADE/.test(lf) ? "refundTotal" : /SATIS/.test(lf) ? "salesTotal" : "netTotal";
      b[k] = merge(b[k], amount);
      continue;
    }
    if (cur.open && /^(TOPLAM|GENEL TOPLAM)$/.test(lf) && cur.open.netTotal.text === null) {
      cur.open.netTotal = amount;
      continue;
    }

    // Z'nin rakamları (tanınan satır açık batch'i kapatır; tanınmayan satır, ör. kart markası alt toplamı, atlanır)
    if (DAILY_TOTAL.has(lf)) {
      cur.open = null;
      if (dailyTotal.text === null) dailyLabel = lf;
      dailyTotal = merge(dailyTotal, amount);
      found.add("dailyTotal");
      continue;
    }
    if (/^INDIRIM/.test(lf)) {
      cur.open = null;
      discounts = merge(discounts, amount);
      continue;
    }
    if (/IPTAL/.test(lf)) {
      voids = merge(voids, amount);
      continue;
    }
    const kind: Kind | null = /^KASA NAKIT/.test(lf)
      ? "drawer"
      : /^NAKIT\b/.test(lf)
        ? "cash"
        : MEAL.some((m) => lf.includes(m))
          ? "meal_card"
          : /^(KREDI KARTI|K\.? ?KARTI|KREDI|BANKA KARTI|KART)\b/.test(lf)
            ? "card"
            : /^(DIGER|HAVALE|EFT|ACIK HESAP|CARI|KUPON)\b/.test(lf)
              ? "other"
              : bankHit(lf)
                ? "bank_subline"
                : null;
    if (kind) {
      cur.open = null;
      payments.push({ label: label.map((w) => w.text).join(" "), count: null, amount, kind });
      found.add("payments");
    }
  }

  // Kendi içinde tutarlılık: tutmayan satırlar hep birlikte şüpheli (hiçbir rakam düzeltilmez)
  const pays = payments.filter((p) => p.kind === "cash" || p.kind === "card" || p.kind === "meal_card" || p.kind === "other");
  if (isHigh(dailyTotal) && pays.length && pays.every((p) => isHigh(p.amount))) {
    const sum = round2(pays.reduce((a, p) => a + p.amount.value!, 0));
    if (Math.abs(sum - dailyTotal.value!) > TOL) {
      dailyTotal = low(dailyTotal);
      for (const p of pays) p.amount = low(p.amount);
    }
  }
  const groups = [...kdv.entries()].map(([rate, g]) => ({ rate: Math.max(rate, 0), total: rate < 0 ? low(g.total) : g.total, vat: rate < 0 ? low(g.vat) : g.vat, base: null }));
  for (const g of groups) {
    // KDV oranı tutarla tutmalı (KDV dahil tutar × oran / (100 + oran), kuruş yuvarlaması payıyla)
    if (isHigh(g.total) && isHigh(g.vat) && Math.abs((g.total.value! * g.rate) / (100 + g.rate) - g.vat.value!) > 0.05) {
      g.total = low(g.total);
      g.vat = low(g.vat);
    }
  }
  if (isHigh(dailyTotal) && groups.length && groups.every((g) => isHigh(g.total)) && Math.abs(round2(groups.reduce((a, g) => a + g.total.value!, 0)) - dailyTotal.value!) > TOL) {
    for (const g of groups) g.total = low(g.total);
  }
  if (isHigh(totalVat) && groups.length && groups.every((g) => isHigh(g.vat)) && Math.abs(round2(groups.reduce((a, g) => a + g.vat.value!, 0)) - totalVat.value!) > TOL) {
    for (const g of groups) g.vat = low(g.vat);
    totalVat = low(totalVat);
  }
  for (const b of batches) {
    const refund = b.refundTotal.text === null ? 0 : isHigh(b.refundTotal) ? b.refundTotal.value! : null;
    if (isHigh(b.salesTotal) && isHigh(b.netTotal) && refund !== null && Math.abs(round2(b.salesTotal.value! - refund) - b.netTotal.value!) > TOL) {
      b.salesTotal = low(b.salesTotal);
      b.netTotal = low(b.netTotal);
      b.refundTotal = low(b.refundTotal);
    }
    b.date = date;
  }

  const zFound = zMarker || zNo.text !== null || dailyTotal.text !== null || pays.length > 0;
  const documentType: KasaOkc["documentType"] = zFound ? "z_report" : batches.length ? "batch_slip" : "other";
  const raw: KasaOkc = {
    documentType,
    fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: groups.length > 0 },
    readable: documentType !== "other",
    title: zMarker ? "Z RAPORU" : null,
    date,
    time,
    dateConfidence,
    zNo,
    receiptCount,
    dailyTotal,
    dailyTotalLabel: dailyLabel,
    kdvGroups: groups,
    totalVat,
    payments,
    outside: [],
    voids,
    discounts,
    cumulativeTotal: LOW_NONE,
    cumulativeVat: LOW_NONE,
    batches,
    issues: [],
  };
  return { raw, found: [...found] };
}
