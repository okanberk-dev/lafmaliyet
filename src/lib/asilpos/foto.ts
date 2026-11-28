import { dateTR, money } from "@/lib/format";
import { normalizeVat, sameVat, zNoNumber, type OkcVatLine } from "@/lib/okc-z";
import { businessDayOf, printedAmount, round2 } from "@/lib/photo-read/common";
import { modelName, type ReadingSource } from "@/lib/photo-read/models";
import { okcPaperView } from "@/lib/photo-read/okc";
import type { AmountRaw, KasaOkc } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";

import type { BankPos, PosOkc } from "./day";

/**
 * AsilPOS gününün gün sonu fotoğrafı (sahibin isteği, 24 Kasım 2026: "sadece gün sonu ladmine personel foto atsın";
 * docs/ASILPOS.md › Gün sonu otomasyonu; saf, tests/asilpos-gun-sonu-tam.test.ts). Kasa raporunun rakamları AsilPOS'tan ve
 * Pavo'dan kendiliğinden yazılır; personel yalnız fotoğraf ekler. Pavo istenince detaylı Z basar (sahibin yanıtı, 24
 * Kasım 2026: "Pavo cihazdan fiş isteyince veriyor, Z olarak detaylı"): tek fişte banka gün sonu (batch'ler) ve Z'nin
 * rakamları (Z no, toplam, nakit, kart, yemek kartı / diğer, KDV); personelden tek fotoğraf istenir. AsilPOS'un
 * `okc.zReport`'u Pavo için hâlâ false gelir, ölçü değildir. Yalnız ayrı mali Z basan cihazda (TokenX) yazarkasa Z'si
 * ayrıca istenir. Fotoğraf hiçbir alanı yazmaz (tek istisna: AsilPOS Z no göndermediyse fotoğrafta okunan Z no): okunuşu
 * AsilPOS'un rakamlarıyla karşılaştırılır, sonuç yöneticiye gider (asilpos_day_ends.photo_check). Personel yalnız
 * "Fotoğraf alındı" ya da "Fotoğraf okunamadı / yanlış belge, yeniden çekin" görür.
 */

/** Personelin gördüğü metinler (başka hiçbir iş yok) */
export const ASILPOS_PHOTO_TEXT = {
  slip: "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin",
  z: "Yazarkasa Z raporunun fotoğrafını ekleyin",
  done: "Fotoğraf alındı",
  /**
   * Pavo'nun sonucu AsilPOS'a henüz gelmedi (Banka POS yok): fotoğraf yokken "alındı" denmez. Personel için iş aynı (fişi
   * Pavo istenince basar); bekleyen sonuç yöneticinin
   */
  waiting: "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin",
  retry: "Fotoğraf okunamadı / yanlış belge, yeniden çekin",
} as const;

/** Personelin Kasa sayfasının alt başlığı, AsilPOS'un otomatik gününde (rakam girmez, yalnız fotoğraf) */
export const ASILPOS_STAFF_DESCRIPTION = "Rakamlar AsilPOS'tan geldi; Pavo'dan gün sonu fişini (detaylı Z) alıp fotoğrafını ekleyin.";
/** Sayım bekleyen AsilPOS günü (gün sonu geldi, rapor yok): rakam henüz yok, rapor AsilPOS'tan gelecek */
export const ASILPOS_STAFF_WAITING_DESCRIPTION = "Kasa raporu AsilPOS'tan gelecek; Pavo'dan gün sonu fişini (detaylı Z) alıp fotoğrafını ekleyin.";

/**
 * AsilPOS gününde gün sonundan önce (AsilPOS'un şubesi, geçiş gününden itibaren, AsilPOS'un gün sonu gelmedi, rapor yok)
 * personelin gördüğü (son denetim, 24 Kasım 2026): form yok, rapor AsilPOS'tan gelir. Bugün'ün akşam satırı da bunu söyler
 */
export const ASILPOS_STAFF_BEFORE_DAY_END_TEXT = "Kapanışta AsilPOS'ta Günü kapat'a basın; rapor AsilPOS'tan gelir, sonra Pavo'nun gün sonu fişinin (detaylı Z) fotoğrafını eklersiniz.";
/**
 * Gün sonu geldi ama AsilPOS'ta sayım yok (rapor bekleniyor): personelin Kasa sayfasındaki tek uyarı. Alt başlık "Kasa
 * raporu AsilPOS'tan gelecek" dediği için başlık onu tekrarlamaz; yalnız ne yapılacağı (aynı mesaj dört yerde
 * okunuyordu: alt başlık, uyarı, kart açıklaması, bilgi kutusu)
 */
export const ASILPOS_STAFF_NO_COUNT = {
  title: "AsilPOS'ta kasa sayılmadı",
  text: "Çekmeceyi AsilPOS'ta sayın (Kasa › Geçmiş günler › Kasa föyü); rapor sonra kendiliğinden gelir.",
} as const;
/** Aynı günün alt başlığı */
export const ASILPOS_STAFF_BEFORE_DAY_END_DESCRIPTION = "Kasa raporu AsilPOS'tan gelecek: kapanışta AsilPOS'ta Günü kapat'a basın.";

/**
 * Personelin kasa formu yerine bilgi mi görür: şubenin kendi AsilPOS günü (`asilposDay`, şubenin geçiş günüyle), gün sonu
 * gelmedi ve rapor yok. Yönetici formu görür (AsilPOS hiç göndermezse yedek yol); dünden eski gün geç rapor yolundan girer.
 * Elle girilmiş rapor eski yolla
 */
export function staffBeforeAsilposDayEnd(o: { admin: boolean; asilposDay: boolean; dayEnd: boolean; hasReport: boolean }): boolean {
  return !o.admin && o.asilposDay && !o.dayEnd && !o.hasReport;
}

/**
 * Personelin AsilPOS gününde formdan yazımını sunucu reddeder (saveCashReport): rapor AsilPOS'tan gelir, otomatik raporun
 * rakamlarını yalnız yönetici düzeltir. Kör kasa (bulgu 0, src/lib/asilpos/kor-kasa.ts): yöneticinin elle girdiği AsilPOS
 * günü raporunu da personel değiştirmez, düzeltme önermez (`manual`); WhatsApp metnini sayımsız alır (28 Kasım 2026)
 */
export const ASILPOS_STAFF_WRITE_TEXT = {
  fresh: "AsilPOS gününün kasa raporu AsilPOS'tan gelir: kapanışta AsilPOS'ta Günü kapat'a basın. AsilPOS göndermezse yöneticinize yazın.",
  auto: "Bu rapor AsilPOS'tan yazıldı; rakamlarını yalnız yönetici düzeltir. Gün sonu fotoğrafını Kasa sayfasından ekleyin.",
  manual: "AsilPOS gününün kasa raporunu yalnız yönetici düzeltir; yanlışlık varsa yöneticinize yazın.",
} as const;

/** Personelin alt başlığı: AsilPOS günü değilse null (eski metin); otomatik raporlu gün ya da sayım bekleyen gün */
export function staffAsilposDescriptionOf(state: { auto: boolean } | null): string | null {
  if (!state) return null;
  return state.auto ? ASILPOS_STAFF_DESCRIPTION : ASILPOS_STAFF_WAITING_DESCRIPTION;
}

/**
 * Personel bu raporu AsilPOS'un otomatik raporu olarak mı görür (rakamlar salt okunur; Düzenle, silme isteği, fotoğraf
 * farkı ve notun yönetici yönergesi yok; WhatsApp ve Metni kopyala sayımsız metinle, 28 Kasım 2026). Kapalı kalır: fotoğraf durumu okunamadıysa (`photoAuto` null) raporun
 * kendi kaydı (asilpos_day_ends.report_id) karar verir, o da okunamadıysa ("error") gizli
 */
export function staffAsilposAutoOf(o: { admin: boolean; hasReport: boolean; photoAuto: boolean | null; reportAuto: boolean | "error" }): boolean {
  if (o.admin || !o.hasReport) return false;
  return o.photoAuto === true || o.reportAuto !== false;
}

/** Rapora bağlı gün sonu fotoğrafının adı (AsilPOS günü): Pavo'nun fişi; ayrı mali Z basan cihazda "Yazarkasa Z" */
export function asilposPhotoLabel(need: Pick<AsilposPhotoNeed, "z">): string {
  return need.z ? "Yazarkasa Z" : "Pavo gün sonu fişi";
}

/**
 * Personelin gördüğü fotoğraf farkı: AsilPOS'un otomatik gününde hiç (fark yöneticinin uyarısı; eski "Fotoğraftan farklı
 * yazılan" yolu da personele gösterilmez). Yönetici ve ModPOS / elle girilen gün eskisi gibi
 */
export function staffPhotoDiffs<T>(diffs: readonly T[] | null, o: { admin: boolean; asilposAuto: boolean }): T[] | null {
  if (diffs === null) return null;
  return !o.admin && o.asilposAuto ? [] : [...diffs];
}

/**
 * Otomatik raporun notu personele: "Eksik: …" bölümü (yöneticinin yönergesi: "AsilPOS'ta Yönetim › Yazarkasa POS › …")
 * yerine kısa nötr satır. Banka POS hâlâ boşsa "Banka POS henüz gelmedi; yönetici ilgileniyor" (yönetici yazdıysa yok),
 * yazarkasa alanları boşsa aynısı yazarkasa için; başka eksik personele söylenmez
 */
export function staffAutoNote(note: string | null, r: { bankPos: number | null; okcTotal?: number | null }): string | null {
  if (note === null) return null;
  // Otomatik eksik bölümü notun sonundadır (autoNote); kapanış notunda geçen "Eksik:" personelin kendi yazısıdır, kesilmez
  const at = note.lastIndexOf(" Eksik: ");
  if (at < 0 && !note.startsWith("Eksik: ")) return note;
  const head = at < 0 ? "" : note.slice(0, at);
  const gaps = note.slice(at < 0 ? 0 : at + 1);
  const lines: string[] = [];
  if (/Banka POS/.test(gaps) && r.bankPos === null) lines.push("Banka POS henüz gelmedi; yönetici ilgileniyor.");
  if (/Yazarkasa/.test(gaps) && (r.okcTotal ?? null) === null) lines.push("Yazarkasa belgeleri henüz gelmedi; yönetici ilgileniyor.");
  return [head, ...lines].filter(Boolean).join(" ") || null;
}

/**
 * İstenen fotoğraflar: Pavo'nun gün sonu fişi (detaylı Z; tek fotoğraf, banka gün sonu da Z de üstünde); yalnız ayrı mali
 * Z basan cihazda (TokenX) yazarkasa Z'si de. Pavo'nun sonucu henüz gelmediyse istenen 0 (fotoğraf yine alınır)
 */
export interface AsilposPhotoNeed {
  slip: boolean;
  z: boolean;
  count: number;
}

export function asilposPhotoNeed(d: { bankPos: BankPos | null | undefined; okc: PosOkc | null | undefined }): AsilposPhotoNeed {
  const slip = Boolean(d.bankPos);
  const z = d.okc?.zReport === true && d.okc.provider === "tokenx";
  return { slip, z, count: (slip ? 1 : 0) + (z ? 1 : 0) };
}

/**
 * Fotoğrafın bir okunuşu: ai_calls'un son başarılı sonucu (okunmadıysa raw null; okuma düştüyse error). `source`: yapay
 * zekâ ("ai", varsayılan) ya da kodla okuma ("kod": OCR + Pavo fişinin ayrıştırıcısı, src/lib/photo-read/pavo-ocr.ts);
 * `model` okuyan model (kodda OCR_MODEL)
 */
export interface AsilposPhotoRead {
  photoId: number;
  raw: KasaOkc | null;
  error: string | null;
  source?: ReadingSource;
  model?: string | null;
}

/** Fotoğrafın AsilPOS'la karşılaştırması: satır, fotoğraftaki, AsilPOS'taki, tutuyor mu */
export interface AsilposPhotoRow {
  label: string;
  photo: string;
  asilpos: string;
  ok: boolean;
  /** Fotoğraftaki rakam okunmadı (kodla okunan günde "okunamadı — yönetici baksın"; yapay zekâda fark) */
  unread?: boolean;
  /**
   * Yalnız bilgi (karşılaştırma değil, fark sayılmaz; e-postada "aynı" yerine "bilgi"; karşılaştırmanın özetine girmez):
   * ör. Pavo gününde fotoğrafta Z'nin rakamları yok, onlar AsilPOS'tan geldi
   */
  info?: boolean;
}

export interface AsilposPhotoCheck {
  /** Karşılaştırmanın anı (ISO) */
  at: string;
  /** Rapora bağlı gün sonu fotoğrafı sayısı */
  photos: number;
  /**
   * "uyumlu" fotoğraf AsilPOS'u tutuyor; "fark" yöneticinin uyarısı; "okunamadi" okunamadı ya da yanlış belge (personel
   * yeniden çeker); "okunmadi" okuma yok (henüz okunmadı); "belirsiz" kodla okundu (yapay zekâ yoktu) ama karşılaştırılan
   * bir satır yüksek güvenle okunmadı: "okunamadı — yönetici baksın" (personelin işi bitti, rakam uydurulmaz)
   */
  state: "uyumlu" | "fark" | "okunamadi" | "okunmadi" | "belirsiz";
  /** Okuyan: yapay zekâ ya da kod (eski kayıtta yok: yapay zekâ) */
  source?: ReadingSource | null;
  /** Okuyan model (yapay zekâda "claude-haiku-5-5" / "claude-opus-5-5"; kodda OCR_MODEL) */
  model?: string | null;
  rows: AsilposPhotoRow[];
  /** Tutmayan satırların kısa metni (zil, e-posta, ay satırı) */
  issues: string[];
  /** Raporun Banka POS'u boşken (Pavo alınamadı) fotoğrafta okunan toplam: yönetici "Banka POS'a yaz" ile yazar */
  readBankPos: number | null;
  /**
   * AsilPOS yazarkasa Z no'su göndermediyse fotoğrafta (Pavo'nun detaylı Z'si) okunan Z no: yalnız fotoğraf AsilPOS'u
   * tutuyorsa (uyumlu) ve Z'nin günü doğrulandıysa. Sunucu raporun boş Z no'suna yazar (yönetici silmediyse), yönetici
   * "fotoğraftan okundu" görür. AsilPOS gönderdiyse yok (yalnız karşılaştırılır). Eski kayıtta alan yok
   */
  zNoFromPhoto?: string | null;
}

/** Raporun karşılaştırılan alanları (AsilPOS'tan yazılmış değerler) */
export interface AsilposPhotoReport {
  bankPos: number | null;
  okcZNo: string | null;
  okcTotal: number | null;
  okcCash: number | null;
  okcCard: number | null;
  okcMealCard: number | null;
  okcOther?: number | null;
  okcVat: OkcVatLine[] | null;
  /**
   * AsilPOS'un gönderdiği yazarkasa Z no'su (gövdenin `z.okcZNo`'su). Yoksa (undefined) raporunki AsilPOS'unki sayılır.
   * null: AsilPOS göndermedi, fotoğrafta okunan Z no yazılabilir (`zNoFromPhoto`)
   */
  asilposZNo?: string | null;
}

const TOL = 0.01;
const near = (a: number, b: number) => Math.abs(round2(a - b)) <= TOL;
/** Batch no karşılaştırması: baştaki sıfırlar ve boşluklar önemsiz ("000279" = "279") */
const batchKey = (v: string) => v.replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
const amountOf = (v: number | null) => (v === null ? "okunamadı" : money(v));

/**
 * Fotoğraf(lar)ın okunuşu ↔ AsilPOS. Pavo gün sonu fişi: okunan her batch no AsilPOS'un batch'lerinde, batch sayısı aynı,
 * okunan netlerin toplamı raporun Banka POS'u (±0,01), fişin günü raporun günü (ertesi gün 05:00'ten önce basılan da),
 * son batch'in banka dökümü Pavo'nunkiyle aynı. Z'nin rakamları (Pavo'nun detaylı Z'si ya da ayrı mali Z): okunduysa Z
 * no, günlük toplam, nakit, kart, yemek kartı, diğer ve KDV dökümü raporun yazarkasa alanlarıyla; ayrı mali Z basan cihazda
 * (TokenX) Z fotoğrafı yoksa "yok"; Z'nin günü fişin günüyle aynı kuralla. Aynı batch (no ve banka) bir kez sayılır; farklı
 * tutarla okunduysa fark. Banka POS boşsa okunan toplam yöneticiye önerilir; AsilPOS Z no göndermediyse, fotoğraf uyumlu ve
 * Z'nin günü doğrulanmışsa okunan Z no `zNoFromPhoto`.
 */
export function asilposPhotoCheck(
  i: { day: string; reads: readonly AsilposPhotoRead[]; bankPos: BankPos | null; okc: PosOkc | null; report: AsilposPhotoReport },
  now: Date = new Date(),
): AsilposPhotoCheck {
  // Okunuşun karşılaştırılan hâli (okcPaperView): AsilPOS'un kendi kâğıdı ("GÜN SONU · Z n" / "BANKA GÜN SONU · PAVO")
  // yalnız banka gün sonudur, Z no'su ve NET CİRO'su Z sayılmaz (zNoFromPhoto olmaz); banka kısmı okunmuş yazılım Z'si
  // de banka gün sonu fişidir. Kodla okunan fotoğrafta "low" güvenli rakam okunmamış sayılır (strictView); kaynak: biri
  // kodla okunduysa "kod"
  const reads = i.reads.map((r) => {
    if (!r.raw) return r;
    const raw = okcPaperView(r.raw);
    return { ...r, raw: r.source === "kod" ? strictView(raw) : raw };
  });
  const kod = reads.some((r) => r.source === "kod");
  const lead = reads.find((r) => r.source === "kod") ?? reads.find((r) => r.raw) ?? reads[0];
  const base = {
    at: now.toISOString(),
    photos: i.reads.length,
    rows: [] as AsilposPhotoRow[],
    issues: [] as string[],
    readBankPos: null as number | null,
    zNoFromPhoto: null as string | null,
    source: lead ? (lead.source ?? "ai") : null,
    model: lead?.model ?? null,
  };
  // Batch satırı okunmamış Pavo fişi (ör. batch bölümü kadrajın dışında) karşılaştırılacak bir şey vermez: okunamadı sayılır
  const usable = reads.filter((r) => r.raw && r.raw.readable && ((r.raw.documentType === "batch_slip" && r.raw.batches.length > 0) || r.raw.documentType === "z_report"));
  if (!usable.length) {
    const failed = reads.some((r) => r.error !== null || (r.raw !== null && !usable.includes(r)));
    // Kodla okunup bir şey seçilmediyse fotoğraf kötü olmayabilir (OCR'ın sınırı): personelden yeniden çekmesi istenmez, yönetici bakar
    if (kod) return { ...base, state: "belirsiz" };
    return { ...base, state: failed ? "okunamadi" : "okunmadi" };
  }
  const rows: AsilposPhotoRow[] = [];
  let readBankPos: number | null = null;
  let zNoFromPhoto: string | null = null;

  // Pavo gün sonu fişi (yalnız ya da Z'nin altında basılmış). Okunan her batch'in tutarı: NET; NET okunmadıysa satış − iade
  const netOf = (b: KasaOkc["batches"][number]) => {
    const net = printedAmount(b.netTotal).value;
    if (net !== null) return net;
    const sales = printedAmount(b.salesTotal).value;
    return sales === null ? null : round2(sales - (b.refundTotal.text === null ? 0 : (printedAmount(b.refundTotal).value ?? 0)));
  };
  // Aynı fişin birden çok fotoğrafı (personel birden çok çekebilir): aynı batch no ve banka bir kez sayılır, tutarın metni
  // farklı okunsa da ("755,00" / "755.00") ya da bir fotoğrafta NET satırı kesik olsa da. Aynı batch iki farklı tutarla
  // okunduysa tutarı belirsizdir (toplam yok, "Banka POS'a yaz" önerisi yok) ve fark satırı yöneticiye. Aynı batch'in
  // farklı bankaları (Pavo'nun banka dökümü) ayrı satırdır
  const bankKey = (v: string | null) => (v ?? "").toLocaleLowerCase("tr").replace(/[^0-9a-zçğıöşü]/g, "");
  type Slip = { raw: KasaOkc; no: string | null; bank: string; net: number | null; nets: number[] };
  const slips: Slip[] = [];
  for (const r of usable) {
    for (const b of r.raw!.batches) {
      const no = b.batchNo?.trim() || null;
      const bank = bankKey(b.bank);
      const net = netOf(b);
      const same = no === null ? [] : slips.filter((x) => x.no !== null && batchKey(x.no) === batchKey(no));
      // Banka adı bir fotoğrafta okunmadıysa aynı batch'in tek satırı odur
      const had = same.find((x) => x.bank === bank) ?? (same.length === 1 && (bank === "" || same[0].bank === "") ? same[0] : undefined);
      if (!had) {
        slips.push({ raw: r.raw!, no, bank, net, nets: net === null ? [] : [net] });
        continue;
      }
      if (net !== null && !had.nets.some((n) => near(n, net))) had.nets.push(net);
      had.net = had.nets.length === 1 ? had.nets[0] : null;
      if (!had.bank) had.bank = bank;
    }
  }
  const slipAmount = (x: Pick<Slip, "net" | "nets">) => (x.nets.length > 1 ? x.nets.map(money).join(" / ") : amountOf(x.net));
  // Fişin günü satırının belgesi: Z ayrı bir kâğıttaysa (ayrı fiş) Z'nin günü ayrıca karşılaştırılır
  let slipDay: { raw: KasaOkc; ok: boolean } | null = null;
  if (slips.length && i.bankPos) {
    const readNos = [...new Set(slips.flatMap((x) => (x.no ? [x.no] : [])))].filter((n, k, all) => all.findIndex((m) => batchKey(m) === batchKey(n)) === k);
    const asilposBatches = i.bankPos.batches ?? (i.bankPos.batchNo ? [{ batchNo: i.bankPos.batchNo, total: i.bankPos.pavoCard }] : []);
    const asilposNos = asilposBatches.flatMap((b) => (b.batchNo ? [b.batchNo] : []));
    const totals = new Map(asilposBatches.flatMap((b) => (b.batchNo ? [[batchKey(b.batchNo), b.total] as const] : [])));
    // Günde birden çok Pavo gün sonu olabilir (gün içinde elle alınan + kapanış); personel her fişi çekmeyebilir. Fotoğrafta
    // AsilPOS'un batch'lerinin yalnız bir kısmı varsa (bilinmeyen batch yok) yalnız çekilen batch'ler karşılaştırılır: her
    // birinin tutarı AsilPOS'taki batch'iyle; çekilmeyenler bilgi satırıdır (fark değil). Hepsi çekildiyse sayı ve toplam
    const keys = new Set(readNos.map(batchKey));
    const known = new Set(asilposNos.map(batchKey));
    const partial = readNos.length > 0 && asilposNos.length > 0 && [...keys].every((k) => known.has(k)) && asilposNos.some((n) => !keys.has(batchKey(n)));
    if (readNos.length) {
      rows.push({ label: "Batch no", photo: readNos.join(", "), asilpos: asilposNos.join(", ") || "yok", ok: readNos.every((n) => known.has(batchKey(n))) });
      if (!partial) rows.push({ label: "Batch sayısı", photo: String(keys.size), asilpos: String(asilposBatches.length), ok: keys.size === asilposBatches.length });
    }
    const sum = slips.every((x) => x.net !== null) ? round2(slips.reduce((a, x) => a + x.net!, 0)) : null;
    if (partial) {
      // Çekilen her batch (bankaları toplanır) AsilPOS'taki batch'iyle
      for (const no of readNos) {
        const mine = slips.filter((x) => x.no !== null && batchKey(x.no) === batchKey(no));
        const clash = mine.find((x) => x.nets.length > 1);
        const net = mine.every((x) => x.net !== null) ? round2(mine.reduce((a, x) => a + x.net!, 0)) : null;
        const asilpos = totals.get(batchKey(no)) ?? null;
        rows.push({ label: `Batch ${no}`, photo: clash ? slipAmount(clash) : amountOf(net), asilpos: amountOf(asilpos), ok: !clash && net !== null && asilpos !== null && near(net, asilpos), ...(!clash && net === null ? { unread: true } : {}) });
      }
      const unshot = asilposNos.filter((n) => !keys.has(batchKey(n)));
      rows.push({ label: "Fotoğrafı olmayan batch", photo: "yok", asilpos: unshot.join(", "), ok: true });
    } else {
      // Farklı tutarla okunan batch: tutarı belirsiz
      for (const x of slips.filter((y) => y.nets.length > 1)) {
        const asilpos = x.no ? (totals.get(batchKey(x.no)) ?? null) : null;
        rows.push({ label: `Batch ${x.no ?? "?"}`, photo: slipAmount(x), asilpos: asilpos === null ? "yok" : money(asilpos), ok: false });
      }
      if (i.report.bankPos === null) {
        readBankPos = sum;
        rows.push({ label: "Banka POS toplamı", photo: amountOf(sum), asilpos: "boş", ok: true });
      } else {
        rows.push({ label: "Banka POS toplamı", photo: amountOf(sum), asilpos: money(i.report.bankPos), ok: sum !== null && near(sum, i.report.bankPos), ...(sum === null ? { unread: true } : {}) });
      }
    }
    // Fişin günü: başlıktaki tarih ve saat (05:00'ten önce basılan bir önceki gün); saatsizse batch'in tarihi, ertesi gün de olur
    const slipRaw = usable.find((r) => r.raw!.documentType === "batch_slip")?.raw ?? slips[0].raw;
    const printed = businessDayOf(slipRaw.date, slipRaw.time);
    const fallback = slipRaw.batches.find((b) => b.date)?.date ?? usable.flatMap((r) => r.raw!.batches).find((b) => b.date)?.date ?? null;
    const shown = printed ?? fallback;
    if (shown) {
      const ok = printed ? printed === i.day || (slipRaw.time === null && printed === addDays(i.day, 1)) : fallback === i.day || fallback === addDays(i.day, 1);
      rows.push({ label: "Fişin günü", photo: dateTR(shown), asilpos: dateTR(i.day), ok });
      slipDay = { raw: slipRaw, ok };
    }
    // Son batch'in banka dökümü (Pavo'nun acquirer satırları)
    const acq = i.bankPos.acquirers.map((a) => a.total).filter((t): t is number => t !== null);
    const last = i.bankPos.batchNo ? batchKey(i.bankPos.batchNo) : null;
    const lastRead = slips.filter((x) => last !== null && x.no !== null && batchKey(x.no) === last);
    // Son batch'in yalnız toplamı okunduysa (banka adı yok, tek satır; ör. AsilPOS kâğıdının TOPLAM'ı) döküm okunmamıştır:
    // birden çok bankalı dökümle karşılaştırılmaz (toplamı Banka POS satırı karşılaştırır)
    const totalOnly = lastRead.length === 1 && lastRead[0].bank === "" && acq.length > 1;
    if (acq.length && lastRead.length && !totalOnly) {
      const a = [...acq].sort((x, y) => x - y);
      const r = lastRead.map((x) => x.net).filter((n): n is number => n !== null).sort((x, y) => x - y);
      const ok = a.length === r.length && a.every((v, k) => near(v, r[k]));
      rows.push({ label: "Banka dökümü", photo: r.map(money).join(" + ") || "okunamadı", asilpos: a.map(money).join(" + "), ok, ...(lastRead.some((x) => x.net === null) ? { unread: true } : {}) });
    }
  }

  // Z'nin rakamları: Pavo'nun detaylı Z'si (gün sonu fişiyle aynı kâğıtta) ya da ayrı mali Z basan cihazın (TokenX) Z'si.
  // Okunduysa her cihazda karşılaştırılır (AsilPOS'un `zReport`'u Pavo için false gelir, ölçü değil); TokenX'te Z yoksa "yok"
  // Birden çok Z okunduysa (aynı fişin iki fotoğrafı) her biri karşılaştırılır: satır hepsi AsilPOS'u tutunca tamam
  const zs = usable.filter((r) => r.raw!.documentType === "z_report").map((r) => r.raw!);
  const separateZ = i.okc?.zReport === true && i.okc.provider === "tokenx";
  // Z'nin günü (fişin günüyle aynı kural): fişin günü satırı aynı kâğıttan (detaylı Z) geldiyse o; ayrı Z'nin kendi tarihi.
  // Fotoğraftan Z no yalnız günü doğrulanmış Z'den yazılır (günü okunmayan ya da başka günün Z'si rapora girmez)
  let zDayOk = zs.length > 0;
  if (!zs.length) {
    if (separateZ) rows.push({ label: "Yazarkasa Z", photo: "yok", asilpos: "bekleniyor", ok: false });
  } else {
    const own = zs.filter((z) => z !== slipDay?.raw);
    if (zs.some((z) => z === slipDay?.raw) && !slipDay!.ok) zDayOk = false;
    const days = own.map((z) => {
      const printed = businessDayOf(z.date, z.time);
      const fallback = z.batches.find((b) => b.date)?.date ?? null;
      const shown = printed ?? fallback;
      if (!shown) return null;
      return { shown, ok: printed ? printed === i.day || (z.time === null && printed === addDays(i.day, 1)) : fallback === i.day || fallback === addDays(i.day, 1) };
    });
    if (days.some((d) => d === null)) zDayOk = false;
    const read = days.filter((d): d is { shown: string; ok: boolean } => d !== null);
    if (read.length) {
      const ok = read.every((d) => d.ok);
      if (!ok) zDayOk = false;
      rows.push({ label: "Z'nin günü", photo: [...new Set(read.map((d) => dateTR(d.shown)))].join(" / "), asilpos: dateTR(i.day), ok });
    }
    const uniq = (xs: readonly string[]) => [...new Set(xs)].join(" / ");
    const sameNo = (a: string, b: string) => (zNoNumber(a) !== null && zNoNumber(b) !== null ? zNoNumber(a) === zNoNumber(b) : a === b);
    const nos = zs.map((z) => z.zNo.text?.trim() || (z.zNo.value !== null ? String(z.zNo.value) : null));
    const readNos = nos.filter((n): n is string => n !== null);
    const asilposNo = i.report.asilposZNo === undefined ? i.report.okcZNo : i.report.asilposZNo;
    if (asilposNo) {
      // AsilPOS gönderdi: raporunkiyle (elle düzeltilmişse o) karşılaştırılır
      const reportNo = i.report.okcZNo ?? asilposNo;
      rows.push({ label: "Yazarkasa Z no", photo: uniq(nos.map((n) => n ?? "okunamadı")), asilpos: reportNo, ok: nos.every((n) => n !== null && sameNo(n, reportNo)), ...(nos.some((n) => n === null) ? { unread: true } : {}) });
    } else if (readNos.length) {
      // AsilPOS göndermedi: fotoğraftaki raporun boş Z no'suna yazılır (sunucu; okunanlar birbirini tutuyorsa); raporda başka
      // bir Z no varsa ya da fotoğraflar farklı Z no gösteriyorsa fark
      const agreed = readNos.every((n) => sameNo(n, readNos[0]));
      if (agreed) zNoFromPhoto = readNos[0];
      rows.push({
        label: "Yazarkasa Z no",
        photo: `${uniq(readNos)} (fotoğraftan okundu)`,
        asilpos: i.report.okcZNo ? `gönderilmedi; raporda ${i.report.okcZNo}` : "gönderilmedi",
        ok: agreed && (i.report.okcZNo === null || sameNo(readNos[0], i.report.okcZNo)),
      });
    }
    // Ödeme bölümü hiç okunmadıysa (kadrajın dışında) bu Z'nin ödeme satırları karşılaştırılmaz (undefined); okunduysa
    // basılmayan satır 0 sayılır (cihaz sıfır satırı basmaz). Kodla okunan Z'de tanınmayan satır 0 uydurulmaz (OCR satırı
    // kaçırmış ya da etiketini yanlış okumuş olabilir): AsilPOS'ta da 0 ise tutar, değilse okunamadı
    const kodRaws = new Set(reads.flatMap((r) => (r.source === "kod" && r.raw ? [r.raw] : [])));
    const sumOf = (z: KasaOkc, kinds: readonly string[], asilpos: number) => {
      if (!z.payments.length) return undefined;
      const lines = z.payments.filter((p) => kinds.includes(p.kind));
      if (!lines.length && kodRaws.has(z)) return near(asilpos, 0) ? 0 : null;
      const xs = lines.map((p) => printedAmount(p.amount).value);
      return xs.some((x) => x === null) ? null : round2((xs as number[]).reduce((a, x) => a + x, 0));
    };
    // Kart satırı basmayan cihaz kartı yalnız banka adlarıyla basar (OKC_TASK): o zaman banka satırları kart sayılır
    const cardOf = (z: KasaOkc, asilpos: number) => (z.payments.some((p) => p.kind === "card") ? sumOf(z, ["card"], asilpos) : sumOf(z, ["bank_subline"], asilpos));
    const pairs: [string, (z: KasaOkc, asilpos: number) => number | null | undefined, number | null | undefined][] = [
      ["Yazarkasa toplamı", (z) => printedAmount(z.dailyTotal).value, i.report.okcTotal],
      ["Yazarkasa nakdi", (z, l) => sumOf(z, ["cash"], l), i.report.okcCash],
      ["Yazarkasa kartı", cardOf, i.report.okcCard],
      ["Yazarkasa yemek kartı", (z, l) => sumOf(z, ["meal_card"], l), i.report.okcMealCard],
      ["Yazarkasa diğer", (z, l) => sumOf(z, ["other"], l), i.report.okcOther],
    ];
    for (const [label, read, asilpos] of pairs) {
      if (asilpos === null || asilpos === undefined) continue;
      const photo = zs.map((z) => read(z, asilpos)).filter((v): v is number | null => v !== undefined);
      if (!photo.length) continue;
      rows.push({ label, photo: uniq(photo.map(amountOf)), asilpos: money(asilpos), ok: photo.every((v) => v !== null && near(v, asilpos)), ...(photo.some((v) => v === null) ? { unread: true } : {}) });
    }
    if (i.report.okcVat) {
      const text = (xs: readonly OkcVatLine[]) => xs.map((g) => `%${g.rate} ${money(g.vat)}`).join(" · ") || "yok";
      const vats = zs.map((z) =>
        normalizeVat(
          z.kdvGroups.flatMap((g) => {
            const t = printedAmount(g.total).value;
            const v = printedAmount(g.vat).value;
            return t !== null && v !== null ? [{ rate: g.rate, total: t, vat: v }] : [];
          }),
        ),
      );
      // Kodla okunan Z'de KDV dökümü hiç seçilmediyse "yok" değil okunmamış (OCR kaçırmış olabilir)
      const vatUnread = zs.some((z) => (kod && !z.kdvGroups.length) || z.kdvGroups.some((g) => printedAmount(g.total).value === null || printedAmount(g.vat).value === null));
      rows.push({ label: "Yazarkasa KDV", photo: uniq(vats.map(text)), asilpos: text(normalizeVat(i.report.okcVat)), ok: vats.every((v) => sameVat(v, i.report.okcVat!)), ...(vatUnread ? { unread: true } : {}) });
    }
  }

  // Karşılaştırılan hiçbir satır yoksa "uyumlu" denmez: Pavo fişi okundu ama AsilPOS'ta karşılığı henüz yok (Pavo'nun sonucu
  // gelmedi) ise okunmadı, öteki durumda (ör. Pavo cihazında Z fotoğrafı, fiş yok) okunamadı / yanlış belge
  if (!rows.length) return { ...base, state: slips.length && !i.bankPos ? "okunmadi" : kod ? "belirsiz" : "okunamadi" };
  // Pavo gününde (ayrı mali Z yok) fotoğrafta Z'nin rakamları yoksa (yalnız banka gün sonu: Pavo'nun fişi ya da AsilPOS'un
  // kâğıdı) yöneticiye bilgi: Z rakamları AsilPOS'tan geldi, fotoğrafla karşılaştırılmadı. Fark değildir, alarm gitmez
  if (!zs.length && i.okc?.provider === "pavo") rows.push({ label: "Pavo detaylı Z", photo: "yok", asilpos: "Z rakamları geldi", ok: true, info: true });
  const issues = rows.filter((r) => !r.ok).map((r) => `${r.label}: fotoğrafta ${r.photo}; AsilPOS'ta ${r.asilpos}`);
  // Kodla okunan günde "uyumlu" / "fark" yalnız her karşılaştırılan satır yüksek güvenle okunduysa ve en az bir tutar
  // (Banka POS ya da yazarkasa toplamı, batch tutarı) karşılaştırıldıysa; değilse "okunamadı — yönetici baksın"
  if (kod) {
    const hasAmount = rows.some((r) => r.label === "Banka POS toplamı" || r.label === "Yazarkasa toplamı" || /^Batch [0-9?]/.test(r.label));
    if (!hasAmount || rows.some((r) => r.unread && !r.ok)) return { ...base, rows, issues, state: "belirsiz" };
  }
  const state = issues.length ? "fark" : "uyumlu";
  // Fotoğraftan Z no yalnız fotoğraf AsilPOS'u tutuyorsa (uyumlu) ve Z'nin günü doğrulandıysa: başka günün Z'si, rakamı
  // farklı Z ya da günü okunmayan Z rapora Z no yazmaz (aynı Z no iki raporda olur, Z zinciri ve kümülatif bozulur)
  return { ...base, rows, issues, readBankPos, zNoFromPhoto: state === "uyumlu" && zDayOk ? zNoFromPhoto : null, state };
}

/**
 * Kodla okunan okunuşun katı hâli: güveni "high" olmayan her tutar, Z no ve tarih okunmamış (null) sayılır. Karşılaştırma
 * şüpheli bir rakamla "uyumlu" ya da "fark" demesin; okunmayan satır "okunamadı — yönetici baksın"a gider
 */
function strictView(raw: KasaOkc): KasaOkc {
  const a = (x: AmountRaw): AmountRaw => (x.confidence === "high" ? x : NONE);
  return {
    ...raw,
    date: raw.dateConfidence === "high" ? raw.date : null,
    time: raw.dateConfidence === "high" ? raw.time : null,
    zNo: raw.zNo.confidence === "high" ? raw.zNo : { text: null, value: null, confidence: "low" },
    dailyTotal: a(raw.dailyTotal),
    totalVat: a(raw.totalVat),
    kdvGroups: raw.kdvGroups.map((g) => ({ ...g, total: a(g.total), vat: a(g.vat) })),
    payments: raw.payments.map((p) => ({ ...p, amount: a(p.amount) })),
    // Batch'in tutarı NET'tir, NET basılmadıysa satış − iade (netOf). Basılmış ama güvenle okunmamış NET ya da İADE varsa
    // satıştan tutar hesaplanmaz (satış − 0 uydurma olur): satış da okunmamış sayılır, batch'in tutarı "okunamadı"
    batches: raw.batches.map((b) => {
      const unsure = (x: AmountRaw) => printed(x) && x.confidence !== "high";
      const noFallback = unsure(b.netTotal) || unsure(b.refundTotal);
      return { ...b, salesTotal: noFallback ? NONE : a(b.salesTotal), refundTotal: printed(b.refundTotal) ? a(b.refundTotal) : b.refundTotal, netTotal: a(b.netTotal) };
    }),
  };
}

const NONE: AmountRaw = { text: null, value: null, confidence: "low" };
/** Tutar fişte basılmış mı (okunduysa metni ya da değeri var) */
const printed = (x: AmountRaw) => x.text !== null || x.value !== null;

/** Okuyanın adı (yöneticinin kartı, e-posta): "Yapay zekâ (Claude Haiku 5.5)" ya da "Kodla okundu" */
export function photoSourceText(check: Pick<AsilposPhotoCheck, "source" | "model"> | null): string {
  if (check?.source === "kod") return "Kodla okundu";
  return check?.model ? `Yapay zekâ (${modelName(check.model)})` : "Yapay zekâ";
}

/**
 * "Yönetici baksın"ın (belirsiz) nedeni: kodla okunan satırlardan biri güvenle seçilmediyse o; OCR düştüyse (hata, süre)
 * ya da fişte hiçbir şey seçilmediyse karşılaştırılan satır yoktur, "kodla okundu" denmez
 */
export function photoUnsureText(check: Pick<AsilposPhotoCheck, "rows">): string {
  return check.rows.length ? "Yapay zekâ kullanılamadı; fotoğraf kodla okundu ama bir satır güvenle seçilmedi" : "Yapay zekâ kullanılamadı ve fotoğraf kodla da okunamadı";
}

/**
 * Personelin tek satırı: istenen fotoğraf eklenene kadar ne çekileceği; eklenince "Fotoğraf alındı", okunamadı ya da
 * yanlış belgeyse yeniden çekmesi. Fotoğrafla AsilPOS'un farkı personele söylenmez (yöneticinin uyarısı)
 */
export function staffPhotoLine(need: AsilposPhotoNeed, attached: number, check: Pick<AsilposPhotoCheck, "state"> | null): string {
  if (need.count === 0 && attached === 0) return ASILPOS_PHOTO_TEXT.waiting;
  if (attached < need.count) {
    if (need.slip && need.z && attached === 0) return `${ASILPOS_PHOTO_TEXT.slip}. ${ASILPOS_PHOTO_TEXT.z}`;
    return need.slip && attached === 0 ? ASILPOS_PHOTO_TEXT.slip : ASILPOS_PHOTO_TEXT.z;
  }
  if (check?.state === "okunamadi") return ASILPOS_PHOTO_TEXT.retry;
  return ASILPOS_PHOTO_TEXT.done;
}

/**
 * Fotoğraf tamam mı (günün raporu bitti): istenen sayı eklendi ve okunamadı / yanlış belge değil. Pavo'nun sonucu henüz
 * gelmediyse (istenen 0) fotoğrafsız gün tamam sayılmaz: Pavo'nun fişi gün sonunda basılır, çekilince tamamlanır
 */
export function asilposPhotoDone(need: AsilposPhotoNeed, attached: number, check: Pick<AsilposPhotoCheck, "state"> | null): boolean {
  if (need.count === 0 && attached === 0) return false;
  return attached >= need.count && check?.state !== "okunamadi";
}

/** Yöneticinin kısa satırı (ay satırının rozeti, e-posta): "Fotoğraf ↔ AsilPOS: farklı (2)" */
export function photoCheckText(check: AsilposPhotoCheck | null, need: AsilposPhotoNeed, attached: number): string {
  if (need.count === 0 && attached === 0) return "bekleniyor (Pavo gün sonu henüz gelmedi)";
  if (attached < need.count) return `bekleniyor (${[need.slip && attached === 0 ? "Pavo gün sonu fişi" : null, need.z ? "yazarkasa Z" : null].filter(Boolean).join(", ") || "fotoğraf"})`;
  if (!check) return "alındı";
  switch (check.state) {
    case "uyumlu":
      return "alındı · AsilPOS'la aynı";
    case "fark":
      return `alındı · AsilPOS'tan farklı: ${check.issues.join("; ")}`;
    case "okunamadi":
      return "okunamadı ya da yanlış belge (personel yeniden çeker)";
    case "belirsiz":
      return "alındı · kodla okunamadı, yönetici baksın";
    default:
      return "alındı · okunmadı";
  }
}
