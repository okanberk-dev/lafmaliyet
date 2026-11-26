import { carryCheck, carryDiffText, computeCash, openingNeedsNote, reportNo, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { normalizeVat, sameVat, type OkcVatLine } from "@/lib/okc-z";
import { addDays, longDateTR } from "@/lib/reminders";

import { pavoSectionHtml, pavoSectionText, pavoState } from "./bank-pos";
import type { BankPos, PosDayZ, PosIkram, PosOffDevice, PosOkc, PosPayment } from "./day";
import { lafposPhotoDone, lafposPhotoNeed, photoCheckText, photoSourceText, photoUnsureText, type LafposPhotoCheck, type LafposPhotoNeed, type LafposPhotoReport } from "./foto";
import type { LafposDayDetail } from "./gun-ayrinti";

/**
 * LafPOS gün sonunun otomasyonu (saf; docs/LAFPOS.md › Gün sonu otomasyonu; sunucu tarafı src/server/lafpos/gun-sonu.ts):
 * LafPOS'un şubesinin (Marina) gün sonu gelince Kasa raporuna kendiliğinden yazılacak alanlar, düzeltme gelince elle
 * düzeltilmiş alanı ezmeyen birleştirme ve gün sonu e-postasının metni. Yalnız geçiş gününden sonraki LafPOS günleri;
 * ModPOS'taki şube (Tuzla) hiçbir şekilde etkilenmez.
 */

/**
 * Otomatik yazılan rapor alanları: Z, kasa, not ve (gün sonu tam, 24 Kasım 2026) cihazların rakamları. Yazarkasanın Z
 * no'su (okcZNo, Faz 2) LafPOS'tan gelir: günün son tamamlanan cihaz fişinin mali Z'si (LafPOS'un `zNo`'sundan ayrı
 * alan); gelmezse (Pavo satış sonucunda Z yok) kayıtlı değer kalır. Banka POS Pavo'nun kendi gün sonlarından (Σ batch;
 * bankPosAuto), yazarkasa alanları LafPOS'un cihaz belgelerinden (okcAuto). Cihaz rakamı yoksa alan boş kalır
 * (uydurulmaz; birleştirmede boş değer kayıtlıyı silmez), not neyin eksik olduğunu söyler. Kümülatif, KDV kümülatifi ve
 * yazarkasa dışı tahsilat yalnız fotoğraftan (yönetici)
 */
export const AUTO_FIELDS = [
  "zNo",
  "okcZNo",
  "receipts",
  "zTotal",
  "cash",
  "card",
  "mealCard",
  "online",
  "other",
  "offRevenue",
  "discounts",
  "openingCash",
  "cashIn",
  "cashOut",
  "cashOutNote",
  "countedCash",
  "handedOver",
  "note",
  "bankPos",
  "okcReceipts",
  "okcTotal",
  "okcCash",
  "okcCard",
  "okcMealCard",
  "okcOther",
  "okcVat",
  "okcVatTotal",
] as const;
export type AutoField = (typeof AUTO_FIELDS)[number];
export type AutoValue = number | string | OkcVatLine[] | null;
export type AutoValues = Record<AutoField, AutoValue>;

/** Günün cihaz verisi (gövdenin bankPos'u, okc'si ve offDevice'ı; eski LafPOS'ta yok) */
export interface AutoDevice {
  bankPos?: BankPos | null;
  okc?: PosOkc | null;
  offDevice?: PosOffDevice | null;
}

/** Otomatik raporun "gönderen"i */
export const LAFPOS_AUTO_BY = "LafPOS (otomatik)";

/** Eksiklerin kısa adı (e-posta; tam metin autoGaps'ten) */
export const MISSING_LABEL: Record<string, string> = {
  bankPos: "Banka POS (Pavo gün sonu)",
  okc: "Yazarkasa (cihaz belgesi)",
  okcZNo: "Yazarkasa Z no",
  countedCash: "Sayılan nakit (LafPOS'ta sayım yok)",
  photo: "gün sonu fotoğrafı (personel ekler)",
};

/** Cihaz boşluklarının tam metinleri (raporun notu ve e-posta söyler; personel bunları değil fotoğrafı görür) */
export const GAP_TEXT = {
  bankMissing: "Banka POS: LafPOS'tan Pavo gün sonu gelmedi",
  bankUnknown: "Banka POS: Pavo gün sonunun sonucu belirsiz; LafPOS'ta Yönetim › Yazarkasa POS › Doğrula",
  bankNoTotal: "Banka POS: Pavo gün sonunda tutar okunamadı",
  bankNotClosed: "Banka POS: Pavo'nun kapanış gün sonu gelmedi (yalnız gün içinde alınan var); LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al",
  okcMissing: "Yazarkasa: LafPOS'ta cihaz belgesi yok",
  okcZNo: "Yazarkasa: Z no LafPOS'ta yok",
} as const;

/** "Banka POS: Pavo gün sonu alınamadı (hata 5085: Günsonu alınamadı (kod 5085)); LafPOS'ta Yönetim › …" */
export function bankFailedText(b: Pick<BankPos, "errorCode" | "message">): string {
  const why = [b.errorCode ? `hata ${b.errorCode}` : null, b.message].filter(Boolean).join(": ");
  return `Banka POS: Pavo gün sonu alınamadı${why ? ` (${why})` : ""}; LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al`;
}

/**
 * Rapor yokken (LafPOS'ta sayım yok, fotoğraf bekliyor) ya da rapor yazılmadan önce fotoğrafın karşılaştırılacağı
 * alanlar: otomatik raporun yazacağı değerler (Banka POS = Pavo'nun gün sonları, yazarkasa alanları cihaz belgelerinden;
 * okcAuto ile aynı eşleme). `lafposZNo` LafPOS'un yazarkasa Z no'su (yoksa null)
 */
export function deviceCompareReport(d: { bankPos: BankPos | null; okc: PosOkc | null; lafposZNo: string | null }): LafposPhotoReport {
  const okc = d.okc;
  return {
    bankPos: bankPosAuto(d.bankPos).value,
    okcZNo: d.lafposZNo,
    okcTotal: okc?.total ?? null,
    okcCash: okc?.cash ?? null,
    okcCard: okc?.card ?? null,
    okcMealCard: okc?.mealCard ?? null,
    okcOther: okc?.other ?? null,
    okcVat: okc?.vat?.length ? okc.vat : null,
    lafposZNo: d.lafposZNo,
  };
}

/**
 * Raporun Banka POS'u Pavo'nun kendi sonucundan: günün başarılı gün sonlarının toplamı (gün ortasında elle alınan da;
 * Σ batches.total). Son sonuç başarılı değilse (alınamadı ya da belirsiz) alan boş kalır: kapanıştan sonraki kart
 * henüz hiçbir batch'te değil, öncekilerin toplamı günün bankası değildir. Aynı nedenle başarılı sonuç yalnız gün içinde
 * alınmışsa (hiçbir batch `dayClosed` değil: kapanışta gün ortasındaki elle gün sonu son sonuçtur) alan boş kalır. Batch
 * listesi olmayan eski gövdede son sonucun Pavo kartı. Değer yoksa `gap` tam olarak nedenini söyler
 */
export function bankPosAuto(b: BankPos | null | undefined): { value: number | null; gap: string | null } {
  if (!b) return { value: null, gap: GAP_TEXT.bankMissing };
  if (b.status === "failed") return { value: null, gap: bankFailedText(b) };
  if (b.status !== "ok") return { value: null, gap: GAP_TEXT.bankUnknown };
  if (b.batches && b.batches.length) {
    if (b.batches.some((x) => x.total === null)) return { value: null, gap: GAP_TEXT.bankNoTotal };
    if (!b.batches.some((x) => x.dayClosed)) return { value: null, gap: GAP_TEXT.bankNotClosed };
    return { value: round2(b.batches.reduce((a, x) => a + (x.total ?? 0), 0)), gap: null };
  }
  return b.pavoCard === null ? { value: null, gap: GAP_TEXT.bankNoTotal } : { value: b.pavoCard, gap: null };
}

/** Raporun yazarkasa alanları LafPOS'un cihaz belgelerinden; cihaz belgesi yoksa hepsi boş */
export function okcAuto(okc: PosOkc | null | undefined): Pick<AutoValues, "okcReceipts" | "okcTotal" | "okcCash" | "okcCard" | "okcMealCard" | "okcOther" | "okcVat" | "okcVatTotal"> {
  if (!okc) return { okcReceipts: null, okcTotal: null, okcCash: null, okcCard: null, okcMealCard: null, okcOther: null, okcVat: null, okcVatTotal: null };
  const vat = okc.vat === null ? null : normalizeVat(okc.vat);
  return {
    okcReceipts: okc.docs,
    okcTotal: okc.total,
    okcCash: okc.cash,
    okcCard: okc.card,
    okcMealCard: okc.mealCard,
    okcOther: okc.other,
    okcVat: vat && vat.length ? vat : null,
    okcVatTotal: vat === null ? null : round2(vat.reduce((a, l) => a + l.vat, 0)),
  };
}

/**
 * Cihaz boşlukları (anahtar ve tam metin): Banka POS, yazarkasa belgesi, mali Z basan cihazda Z no; sayım yoksa sayılan
 * nakit. Pavo (e-Arşiv, Z basmaz) Z no'suz eksik sayılmaz
 */
export function autoGaps(z: Pick<PosDayZ, "countedCash" | "okcZNo">, device: AutoDevice = {}): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const bank = bankPosAuto(device.bankPos);
  if (bank.gap) out.push({ key: "bankPos", text: bank.gap });
  if (!device.okc) out.push({ key: "okc", text: GAP_TEXT.okcMissing });
  else if (device.okc.zReport && !z.okcZNo) out.push({ key: "okcZNo", text: GAP_TEXT.okcZNo });
  if (z.countedCash === null) out.push({ key: "countedCash", text: MISSING_LABEL.countedCash });
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Panelin Kasadan çıkanlar'ı (o gün, o şube) */
export interface DayOuts {
  count: number;
  total: number;
  note: string | null;
}

/**
 * Eksikler (lafpos_day_ends.missing): cihaz boşlukları (autoGaps'in anahtarları; LafPOS gün sonunda sayım yoksa sayılan
 * nakit: uydurulmaz, rapor yazılmaz) ve `photo` verildiyse istenen gün sonu fotoğrafı eklenene kadar "photo"
 */
export function autoMissing(
  z: Pick<PosDayZ, "countedCash"> & Partial<Pick<PosDayZ, "okcZNo">>,
  device: AutoDevice = {},
  photo?: { attached: number; check?: Pick<LafposPhotoCheck, "state"> | null },
): string[] {
  const keys = autoGaps({ countedCash: z.countedCash, okcZNo: z.okcZNo ?? null }, device).map((g) => g.key);
  if (photo && !lafposPhotoDone(lafposPhotoNeed({ bankPos: device.bankPos, okc: device.okc }), photo.attached, photo.check ?? null)) keys.push("photo");
  return keys;
}

/**
 * Raporun otomatik notu: kaynağı, açılışın önceki devirden farkı (ve LafPOS'ta yazılan nedeni), LafPOS'un kapanış notu ve
 * cihaz boşluklarının tam metni. Personelden bir şey istemez ("panelden ekleyin" yok): cihazın rakamı LafPOS'ta alınır,
 * fotoğraf ayrı (lafpos_day_ends.missing)
 */
export function autoNote(o: { gaps: readonly string[]; carry: string | null; opening?: string | null; closeNote?: string | null }): string {
  const parts = ["LafPOS gün sonundan otomatik yazıldı."];
  if (o.carry) parts.push(o.carry);
  if (o.opening) parts.push(o.opening);
  if (o.closeNote) parts.push(`Kapanış notu (LafPOS): ${o.closeNote}.`);
  if (o.gaps.length) parts.push(`Eksik: ${o.gaps.join(" · ")}.`);
  return parts.join(" ");
}

/**
 * LafPOS'un Z özetinden raporun alanları (eşleme "LafPOS'tan doldur"unkiyle aynı, src/lib/lafpos/prefill.ts): gün
 * içinde çıkan panelin Kasadan çıkanlar'ıdır (girildiyse; docs/LAFPOS.md E-35), yoksa LafPOS'un harcama + teslimi;
 * teslim edilen 0. Sayım yoksa `countedCash` null (rapor yazılmaz). `prevCarry`: önceki raporun devri (açılış farkı
 * nota yazılır, LafPOS'taki açılış kalır)
 */
export function autoValuesOf(date: string, z: PosDayZ, outs: DayOuts, prevCarry: { date: string; amount: number } | null, device: AutoDevice = {}): AutoValues {
  const check = carryCheck(date, z.openingCash, prevCarry);
  const carry =
    check && openingNeedsNote({ check, openingCash: z.openingCash, prevOpening: null, note: null })
      ? `Açılış önceki raporun devrinden ${carryDiffText(check)}; LafPOS'taki açılış yazıldı.`
      : null;
  const opening = lafposOpeningNote(z, carry !== null);
  return {
    zNo: String(z.zNo),
    okcZNo: z.okcZNo ?? null,
    receipts: z.receipts,
    zTotal: z.zTotal,
    cash: z.cash,
    card: z.card,
    mealCard: z.mealCard,
    online: z.online,
    other: z.other,
    offRevenue: z.offRevenue,
    discounts: z.discounts,
    openingCash: z.openingCash,
    cashIn: z.cashIn ?? 0,
    cashOut: outs.count ? outs.total : round2(z.cashOut + z.handedOver),
    cashOutNote: outs.count ? outs.note : null,
    countedCash: z.countedCash,
    handedOver: 0,
    // Sayım yoksa rapor yazılmaz (sayılan nakdin boşluğu e-postada): not yalnız cihazların boşluklarını söyler
    note: autoNote({ gaps: autoGaps(z, device).filter((g) => g.key !== "countedCash").map((g) => g.text), carry, opening, closeNote: z.closeNote ?? null }),
    bankPos: bankPosAuto(device.bankPos).value,
    ...okcAuto(device.okc),
  };
}

/**
 * Kasa zinciri (Faz 3; docs/LAFPOS.md › Kasa zinciri): LafPOS'un açılışta beklediği (önceki günün devri), fark ve
 * kasiyerin yazdığı neden raporun notuna. Panelin kendi devir denetimi (önceki raporun devri) tutmadıysa onun cümlesi
 * zaten yazılır: yalnız neden eklenir ("Neden (LafPOS): …"). Panelde önceki rapor yoksa LafPOS'un farkı (kuruştan
 * büyükse) ve nedeni: "Açılış LafPOS'ta beklenenden 20,50 ₺ fazla (beklenen 1.279,50 ₺); neden: …". Alanları
 * göndermeyen eski LafPOS'ta ve farksız, nedensiz açılışta null
 */
export function lafposOpeningNote(z: Pick<PosDayZ, "expectedOpening" | "openingDiff" | "openingReason">, carryNoted: boolean): string | null {
  const reason = z.openingReason ?? null;
  if (carryNoted) return reason ? `Neden (LafPOS): ${reason}.` : null;
  const diff = z.openingDiff ?? null;
  if (diff !== null && z.expectedOpening != null && Math.abs(diff) >= 0.01) {
    return `Açılış LafPOS'ta beklenenden ${money(Math.abs(diff))} ${diff < 0 ? "az" : "fazla"} (beklenen ${money(z.expectedOpening)})${reason ? `; neden: ${reason}` : ""}.`;
  }
  return reason ? `Açılış notu (LafPOS): ${reason}.` : null;
}

const same = (a: AutoValue | undefined, b: AutoValue | undefined) =>
  Array.isArray(a) || Array.isArray(b)
    ? sameVat(Array.isArray(a) ? a : null, Array.isArray(b) ? b : null)
    : typeof a === "number" && typeof b === "number"
      ? Math.round(a * 100) === Math.round(b * 100)
      : (a ?? null) === (b ?? null);

/**
 * Düzeltme gelince birleştirme: kayıtlı değer son otomatik değere eşitse (elle değişmemiş) yenisi yazılır, değilse
 * (personel ya da yönetici düzeltti) kayıtlı kalır. Yeni değer boşsa (ör. sayım yok) kayıtlı kalır. `auto`: bundan
 * sonra karşılaştırılacak otomatik değerler (korunan alanda eskisi)
 */
export function mergeAuto(current: AutoValues, lastAuto: AutoValues, next: AutoValues): { values: AutoValues; auto: AutoValues; changed: AutoField[]; kept: AutoField[] } {
  const values = { ...current };
  const auto = { ...lastAuto };
  const changed: AutoField[] = [];
  const kept: AutoField[] = [];
  for (const f of AUTO_FIELDS) {
    if (next[f] === null && f !== "cashOutNote" && f !== "offRevenue" && f !== "discounts") continue;
    if (!same(current[f], lastAuto[f])) {
      if (!same(current[f], next[f])) kept.push(f);
      continue;
    }
    auto[f] = next[f];
    if (!same(current[f], next[f])) {
      values[f] = next[f];
      changed.push(f);
    }
  }
  return { values, auto, changed, kept };
}

/** Kayıtlı raporun otomatik alanları (yazarkasa alanı yoksa boş) */
export function autoValuesOfReport(r: Pick<CashReportFields, Exclude<AutoField, "discounts" | "okcZNo" | "okcReceipts" | "okcTotal" | "okcCash" | "okcCard" | "okcMealCard" | "okcOther" | "okcVat" | "okcVatTotal">> & Partial<Pick<CashReportFields, "discounts" | "okcZNo" | "okcReceipts" | "okcTotal" | "okcCash" | "okcCard" | "okcMealCard" | "okcOther" | "okcVat" | "okcVatTotal">>): AutoValues {
  return Object.fromEntries(AUTO_FIELDS.map((f) => [f, (r as Record<string, unknown>)[f] ?? null])) as AutoValues;
}

/** Yazarkasa alanları (LafPOS'un cihaz belgeleri ve yazarkasa Z no'su): elle girilmiş raporda grup olarak dolar */
export const OKC_DEVICE_FIELDS = ["okcZNo", "okcReceipts", "okcTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcVat", "okcVatTotal"] as const;
export type DeviceField = "bankPos" | (typeof OKC_DEVICE_FIELDS)[number];

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Elle girilmiş LafPOS günü raporunun boş cihaz alanları (denetim 25 Kasım 2026, bulgu 6): yönetici raporu gün sonundan
 * önce (ya da sayımsız gün sonundan sonra) girdiyse LafPOS'un gönderimi raporu "elle girildi" sayar, Z'ye ve kasaya
 * dokunmaz; yalnız boş cihaz alanları dolar. Banka POS boşsa Pavo'nun gün sonundan (bankPosAuto); yazarkasa alanlarının
 * hiçbiri yazılı değilse LafPOS'un cihaz belgelerinden ve yazarkasa Z no'sundan, grup olarak (bir yazarkasa alanı elle
 * yazılmışsa hiçbiri yazılmaz: iki kaynağın rakamı bir raporda karışıp "Yazarkasa tutmuyor" demesin). Elle girilen değer
 * hiç ezilmez; cihazın rakamı yoksa alan boş kalır. Yazılacak alan yoksa boş nesne. Doldurulan alan artık boş olmadığı
 * için sonraki gönderimler ona dokunmaz (bir kez dolar)
 */
export function humanDeviceFill(saved: Partial<Pick<CashReportFields, DeviceField>>, next: Pick<AutoValues, DeviceField>): Partial<Pick<AutoValues, DeviceField>> {
  const out: Partial<Pick<AutoValues, DeviceField>> = {};
  if (isBlank(saved.bankPos) && typeof next.bankPos === "number") out.bankPos = next.bankPos;
  if (OKC_DEVICE_FIELDS.every((f) => isBlank(saved[f]))) {
    for (const f of OKC_DEVICE_FIELDS) if (!isBlank(next[f])) out[f] = next[f];
  }
  return out;
}

/**
 * Z'nin ve ikram satırının Faz 2 anahtarları (23 Kasım 2026) ve Z'nin Faz 3 açılış anahtarları (kasa zinciri): günün
 * özetine girmez
 */
const FAZ2_Z_KEYS: ReadonlySet<string> = new Set([
  "listValue",
  "ikramTotal",
  "odenmezTotal",
  "zayiTotal",
  "vat",
  "openedAt",
  "closedAt",
  "okcZNo",
  "expectedOpening",
  "openingDiff",
  "openingReason",
  // Gün sonu tam (24 Kasım 2026): nakit bahşiş (cashIn'in içinde), kapanış notu, föyde sayılan
  "cashTips",
  "closeNote",
  "methodCounts",
]);
const FAZ2_IKRAM_KEYS: ReadonlySet<string> = new Set(["kind", "personKind"]);
/** Gün sonu tam: ödemenin cinsi (cari / havale) özete girmez */
const PAYMENT_SOFT_KEYS: ReadonlySet<string> = new Set(["kind"]);
const withoutKeys = (v: unknown, keys: ReadonlySet<string>): unknown =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !keys.has(k))) : v;

/**
 * Günün içerik özeti (FNV-1a, 32 bit): aynı içerik yeniden gelirse e-posta yinelenmez. Faz 2 anahtarları (Z'nin liste ve
 * tür toplamları, KDV dökümü, açılış / kapanış anı, yazarkasa Z no'su; ikramın türü ve kişi türü) ve Faz 3'ün açılış
 * anahtarları (beklenen, fark, neden: gün açılırken bir kez yazılır, sonra değişmez) özete girmez: aynı
 * rakamlarla yalnız onları ekleyen gönderim (yükseltmeden önce saklanıp sonra yeniden gönderilen gün) düzeltme değildir,
 * "Düzeltildi" e-postası yollamaz. Faz 2 anahtarları öteki alanlardan türer: rakam değişince özet zaten değişir
 */
export function dayHash(day: { z: unknown; payments: unknown; ikram: unknown }): string {
  const ikram = Array.isArray(day.ikram) ? day.ikram.map((l) => withoutKeys(l, FAZ2_IKRAM_KEYS)) : day.ikram;
  const payments = Array.isArray(day.payments) ? day.payments.map((p) => withoutKeys(p, PAYMENT_SOFT_KEYS)) : day.payments;
  const text = JSON.stringify([withoutKeys(day.z, FAZ2_Z_KEYS), payments, ikram]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- Gün sonu e-postası

/** Kıyas günü: tarih ve satış (Z toplamı); o gün satış bilinmiyorsa null */
export interface DayCompare {
  date: string;
  zTotal: number | null;
}

/** Kasa raporunun durumu e-postada */
export type ReportState = "auto" | "updated" | "human" | "no-count" | "none";

export interface DayEndMail {
  branchName: string;
  date: string;
  z: PosDayZ;
  payments: readonly PosPayment[];
  ikram: readonly PosIkram[];
  /** Raporun (ya da LafPOS'un) kasa alanları: olması gereken ve fark bunlardan */
  values: AutoValues | null;
  missing: readonly string[];
  report: ReportState;
  /** LafPOS günü düzeltip yeniden gönderdi (önceki e-posta sayımlı bir günü taşıyordu) */
  corrected: boolean;
  /**
   * Önceki e-posta sayımsız günü taşıyordu, bu ilk sayımlı olanı (konuda "· kasa sayıldı"; düzeltme sayılmaz). Verilmezse
   * false
   */
  recount?: boolean;
  yesterday: DayCompare;
  lastWeek: DayCompare;
  /** laffogato.net'in o şubeye düşen online satışı (kasadan geçmez); okunamadıysa null */
  online: number | null;
  link: string;
  /** Pavo – LafPOS kart karşılaştırması (geldiyse; src/lib/lafpos/bank-pos.ts) */
  bankPos?: BankPos | null;
  /** Gün sonu tam: yazarkasanın cihaz belgeleri (gövdenin okc'si; yoksa null) */
  okc?: PosOkc | null;
  /** Gün sonu tam: istenen gün sonu fotoğrafı, eklenen sayı ve fotoğraf ↔ LafPOS karşılaştırması (verilmezse bölüm yok) */
  /** `reads`: fotoğraf başına okunan satırlar (okcReadRows); yoksa bölüm yok */
  photo?: { need: LafposPhotoNeed; attached: number; check: LafposPhotoCheck | null; reads?: readonly (readonly [string, string])[][] } | null;
  /**
   * Faz 2 ayrıntısı (src/lib/lafpos/gun-ayrinti.ts): yazarkasadan geçmeyen, ödeme iptalleri, iptal edilen kalemler,
   * yazarkasa Z no, KDV dökümü, düzeltmenin nedeni. Eski LafPOS'un gününde bölümleri boş
   */
  detail?: LafposDayDetail | null;
}

/** Kıyas metni: "18.000 ₺ (%11 fazla)" / "bilinmiyor" */
export function compareText(today: number, other: number | null): string {
  if (other === null) return "bilinmiyor";
  if (other <= 0) return money(other);
  const pct = Math.round(((today - other) / other) * 100);
  return `${money(other)} (${pct === 0 ? "aynı" : `%${Math.abs(pct)} ${pct > 0 ? "fazla" : "az"}`})`;
}

/**
 * Gün sonu e-postalarının ortak başı, Tuzla'nın kasa e-postasıyla aynı biçim (reportSubject): "Kasa raporu KR-20261122 ·
 * Marina · 22 Kasım Pazar". Gün sonu, Pavo ve fotoğraf e-postası bununla başlar: gelen kutusunda aynı günün e-postaları
 * yan yana durur, aramada birlikte çıkar
 */
export function dayEndSubjectHead(branchName: string, date: string): string {
  return `Kasa raporu ${reportNo(date)} · ${branchName} · ${longDateTR(date)}`;
}

/**
 * Konu: "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · 120 ₺ eksik" (`result`: kasa tutuyor, 120 ₺ eksik, sayım
 * yok). Düzeltmede sonda "· düzeltildi"; sayımsız giden gün sayımla gelince "· kasa sayıldı" (düzeltme değil)
 */
export function dayEndSubject(branchName: string, date: string, o: { result: string; corrected?: boolean; recount?: boolean }): string {
  return `${dayEndSubjectHead(branchName, date)} · ${o.result}${o.recount ? " · kasa sayıldı" : o.corrected ? " · düzeltildi" : ""}`;
}

/**
 * Gönderilmiş gün sonu e-postasının konusundan: sayımsız günü mü taşıyordu (sonuç "sayım yok"). Sonraki sayımlı e-posta
 * "düzeltildi" değil "kasa sayıldı" der. Eski biçimdeki konu ("Marina gün sonu · …") sayımlı sayılır (önceki davranış)
 */
export function dayEndSubjectNoCount(subject: string): boolean {
  return / · sayım yok(?: · |$)/.test(subject);
}

/** Konudaki kasa sonucu (Kasa bölümünün farkıyla aynı): "kasa tutuyor", "120 ₺ eksik", "sayım yok" */
export function dayEndCashResult(m: Pick<DayEndMail, "z" | "values">): string {
  const v = m.values;
  const cash = v && typeof v.countedCash === "number" ? computeCash(cashFieldsOf(v)) : null;
  const d = cash ? cash.cashDiff : m.z.cashDiff;
  if (d === null || (!cash && m.z.countedCash === null)) return "sayım yok";
  const word = diffWord(d);
  return word === "tutuyor" ? "kasa tutuyor" : word;
}

const REPORT_TEXT: Record<ReportState, string> = {
  auto: "Kasa raporu LafPOS'tan kendiliğinden yazıldı.",
  updated: "Kasa raporu LafPOS'un düzeltmesiyle güncellendi; elle düzeltilen alanlar korundu.",
  human: "Kasa raporunu personel girdi; LafPOS'tan farklı yazılan varsa panel gösterir.",
  "no-count": "LafPOS'ta gün sonu sayımı yok: Kasa raporu yazılmadı. Çekmeceyi LafPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayın; LafPOS günü yeniden gönderir.",
  none: "Kasa raporu henüz yok.",
};

/** E-postanın satırları (başlık, değer); HTML ve düz metin aynı satırlardan */
export function dayEndSections(m: DayEndMail): { title: string; rows: [string, string][] }[] {
  const z = m.z;
  const pay: [string, string][] = [
    ["Nakit", money(z.cash)],
    ["Kredi / banka kartı", money(z.card)],
    ...(z.mealCard ? ([["Yemek kartı", money(z.mealCard)]] as [string, string][]) : []),
    ...(z.online ? ([["Online ödeme (paket platformu)", money(z.online)]] as [string, string][]) : []),
    ...(z.other ? ([["Diğer", money(z.other)]] as [string, string][]) : []),
  ];
  const detail: [string, string][] = m.payments
    .filter((p) => p.amount > 0)
    .map((p) => [`· ${p.name}${p.count ? ` (${p.count})` : ""}`, money(p.amount)]);
  const ikramValue = round2(m.ikram.reduce((a, l) => a + l.menuValue, 0));
  const ikramQty = round2(m.ikram.reduce((a, l) => a + l.qty, 0));
  const v = m.values;
  const cash = v && typeof v.countedCash === "number" ? computeCash(cashFieldsOf(v)) : null;
  const kasa: [string, string][] = [
    ["Açılış", money(z.openingCash)],
    ["Olması gereken nakit", money(cash ? cash.expectedCash : (z.expectedCash ?? round2(z.openingCash + z.cash + (z.cashIn ?? 0) - z.cashOut - z.handedOver)))],
    ["Sayılan nakit", z.countedCash === null ? "sayım yok" : money(v && typeof v.countedCash === "number" ? v.countedCash : z.countedCash)],
    ["Kasa farkı", cash ? diffWord(cash.cashDiff) : z.cashDiff === null ? "sayım yok" : diffWord(z.cashDiff)],
  ];
  return [
    { title: "Satış", rows: [["Toplam satış (Z)", money(z.zTotal)], ["Z no · fiş", `${z.zNo} · ${z.receipts} fiş`], ...(z.discounts ? ([["İndirim", money(z.discounts)]] as [string, string][]) : [])] },
    { title: "Ödemeler", rows: [...pay, ...detail] },
    {
      title: "İkram ve ödenmez",
      rows: [
        ["Ödenmez / ikram (Z)", money(z.offRevenue)],
        ["İkram edilen", m.ikram.length ? `${ikramQty} adet · menü değeri ${money(ikramValue)}` : "yok"],
      ],
    },
    { title: "Kasa (nakit)", rows: kasa },
    {
      title: "Kıyas (toplam satış)",
      rows: [
        [`Dün (${longDateTR(m.yesterday.date)})`, compareText(z.zTotal, m.yesterday.zTotal)],
        [`Geçen hafta (${longDateTR(m.lastWeek.date)})`, compareText(z.zTotal, m.lastWeek.zTotal)],
      ],
    },
    ...(m.online !== null ? [{ title: "laffogato.net (kasadan geçmez)", rows: [["Online sipariş", money(m.online)]] as [string, string][] }] : []),
    // Gün sonu tam: Banka POS ve yazarkasa cihazlardan (LafPOS), personelin fotoğrafı ve LafPOS'la karşılaştırması
    ...(m.bankPos !== undefined || m.okc !== undefined || m.photo ? [{ title: "Cihazlar ve fotoğraf", rows: deviceRows(m) }] : []),
    // Fotoğraf ↔ LafPOS satır satır (yalnız yönetici e-postası; sahibin isteği, 24 Kasım 2026: "farklı olunca belirsin")
    ...(m.photo?.check && (m.photo.check.rows.length || m.photo.check.state === "belirsiz") ? [{ title: PHOTO_TITLE, rows: photoRows(m.photo.check) }] : []),
    // Fotoğrafta okunan rakamlar (karşılaştırmadan bağımsız; sahibin isteği, 25 Kasım 2026)
    ...photoReadSections(m.photo?.reads),
    // Faz 2: yazarkasadan geçmeyen, ödeme iptalleri, iptal edilen kalemler, yazarkasa Z no ve KDV (gönderim sırası yazılmaz)
    ...(m.detail?.sections.filter((x) => x.title !== "Gönderim") ?? []),
  ];
}

const PHOTO_TITLE = "Fotoğraf ↔ LafPOS";

/** "Fotoğrafta okunan" bölümleri: fotoğraf başına bir bölüm, birden çok fotoğrafta sırasıyla */
function photoReadSections(reads: readonly (readonly [string, string])[][] | undefined): { title: string; rows: [string, string][] }[] {
  const list = (reads ?? []).filter((r) => r.length);
  return list.map((rows, i) => ({ title: list.length > 1 ? `Fotoğrafta okunan (${i + 1}. fotoğraf)` : "Fotoğrafta okunan", rows: rows.map(([a, b]) => [a, b] as [string, string]) }));
}

/**
 * Fotoğraf ↔ LafPOS satırları (gün sonu ve fotoğraf e-postası): okuyan (yapay zekâ / kod), "okunamadı — yönetici baksın"
 * durumu ve her satır "fotoğrafta X · LafPOS'ta Y · aynı | FARK | okunamadı"
 */
export function photoRows(check: LafposPhotoCheck): [string, string][] {
  const rows: [string, string][] = [["Okuyan", photoSourceText(check)]];
  if (check.state === "belirsiz") rows.push(["Durum", "okunamadı — yönetici baksın (kodla okunan bir satır güvenle seçilmedi; rakam uydurulmadı)"]);
  for (const r of check.rows) rows.push([r.label, `fotoğrafta ${r.photo} · LafPOS'ta ${r.lafpos} · ${r.info ? "bilgi" : r.ok ? "aynı" : r.unread ? "okunamadı" : "FARK"}`]);
  return rows;
}

/** Z raporu e-postası bu süreden eski fotoğrafa gitmez (yükseltmeden önce eklenmiş eski günlere toplu e-posta yok) */
export const PHOTO_MAIL_FRESH_MS = 48 * 3600_000;

/**
 * Z raporu (gün sonu fotoğrafı) e-postası gerekir mi. Sahibin istekleri: 24 Kasım 2026 "farklı olunca belirsin"; 25 Kasım
 * 2026 "z raporu yükleyince mail gelmedi" ve "z tutsa da tutuyor diye yine rapor şeklinde gönderilsin". Fark ve "yönetici
 * baksın" her zaman; öteki durumlar (tutuyor, okunamadı, okunmadı) fotoğraf tazeyse (`fresh`: son 48 saatte eklendi,
 * photoMailFresh). Gün sonu e-postası fotoğrafı içerse de Z raporu ayrıca gider. Karşılaştırma yoksa e-posta yok
 */
export function photoMailNeeded(check: Pick<LafposPhotoCheck, "state"> | null | undefined, o: { fresh?: boolean } = {}): boolean {
  if (!check) return false;
  return check.state === "fark" || check.state === "belirsiz" || o.fresh === true;
}

/** En yeni fotoğraf son 48 saatte mi eklendi (photoMailNeeded'in `fresh`'i) */
export function photoMailFresh(newestPhotoAt: Date | null, now: Date): boolean {
  if (!newestPhotoAt) return false;
  return now.getTime() - newestPhotoAt.getTime() <= PHOTO_MAIL_FRESH_MS;
}

/**
 * Karşılaştırmanın özeti (aynı içerik bir kez gider): durum, okuyan ve satırlar; karşılaştırmanın anı ve bilgi satırları
 * girmez (bilgi satırı eklenince gönderilmiş fark e-postası yeniden gitmez)
 */
export function photoCheckHash(check: LafposPhotoCheck): string {
  // Fotoğraftan okunup raporun boş Z no'suna yazılan numara ("gönderilmedi; raporda 0011") yeni bilgi değildir: özet
  // değişmez (yoksa aynı fotoğraf için ikinci e-posta giderdi). İkinci fotoğraf da bildirilir: fotoğraf sayısı 1'den
  // büyükse özete girer (tek fotoğraflı eski özetler aynı kalır, yükseltmeden sonra yeniden gönderim yok)
  const lafposText = (r: LafposPhotoCheck["rows"][number]) => (r.label === "Yazarkasa Z no" ? r.lafpos.replace(/; raporda .*$/, "") : r.lafpos);
  const rows = check.rows.filter((r) => !r.info).map((r) => [r.label, r.photo, lafposText(r), r.ok]);
  const text = JSON.stringify(check.photos > 1 ? [check.state, check.source ?? "ai", check.model ?? null, rows, check.photos] : [check.state, check.source ?? "ai", check.model ?? null, rows]);
  return fnv1a(text);
}

/**
 * 25 Kasım 2026'dan önceki özet formülü (Z no'nun "raporda" eki ve fotoğraf sayısı ayrımı yok): yükseltmeden önce gitmiş
 * fotoğraf e-postasının kaydı bu özetle durur; sendPhotoEmail ikisine de bakar (aynı e-posta ikinci kez gitmez)
 */
export function photoCheckHashLegacy(check: LafposPhotoCheck): string {
  return fnv1a(JSON.stringify([check.state, check.source ?? "ai", check.model ?? null, check.rows.filter((r) => !r.info).map((r) => [r.label, r.photo, r.lafpos, r.ok])]));
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Fotoğraf e-postasının konu sonu ve üst satırı, karşılaştırmanın durumuna göre */
const PHOTO_MAIL_STATE: Record<LafposPhotoCheck["state"], { subject: string; headline: string; tone: "ok" | "bad" | "warn" }> = {
  uyumlu: { subject: "Z raporu tutuyor", headline: "Z raporu tutuyor: fotoğraftaki rakamlar LafPOS'la aynı", tone: "ok" },
  fark: { subject: "Z raporu LafPOS'tan FARKLI", headline: "Z raporu tutmuyor: fotoğraf LafPOS'un rakamlarından farklı okundu", tone: "bad" },
  okunamadi: { subject: "Z raporu okunamadı", headline: "Z raporu okunamadı ya da yanlış belge; personelden yeniden çekmesi istendi", tone: "warn" },
  okunmadi: { subject: "Z raporu alındı · okunmadı", headline: "Z raporunun fotoğrafı alındı ama henüz okunmadı; fotoğrafa bakın", tone: "warn" },
  belirsiz: { subject: "Z raporu okunamadı, yönetici baksın", headline: "", tone: "warn" },
};

const TONE = { ok: { bg: "#f0fdf4", fg: "#166534" }, bad: { bg: "#fef2f2", fg: "#991b1b" }, warn: { bg: "#fff7ed", fg: "#9a3412" } } as const;

/** Fotoğrafta okunanın başlığı (e-postanın ikinci bölümü) */
const READ_TITLE = "Fotoğrafta okunan";

/**
 * Fotoğraf e-postası (yalnız yöneticinin alıcıları): gün sonu e-postası gittikten sonra eklenen her gün sonu fotoğrafı
 * (photoMailNeeded). Üstte durum (aynı / FARKLI / okunamadı / yönetici baksın), altında karşılaştırma satır satır,
 * fotoğrafta okunan rakamlar (`reads`, okcReadRows) ve ekleyen; fotoğrafın kendisi e-postaya eklenir (sunucu,
 * sendPhotoEmail). Personele hiçbir zaman gitmez
 */
export function renderPhotoMail(m: {
  branchName: string;
  date: string;
  check: LafposPhotoCheck;
  link: string;
  /** Fotoğrafta okunanlar (fotoğraf başına satırlar); yoksa bölüm yok */
  reads?: readonly (readonly [string, string])[][];
  /** Ekleyen(ler)in adı */
  by?: string | null;
  /** E-postaya eklenen fotoğraf sayısı */
  attachments?: number;
}): { subject: string; html: string; text: string } {
  const st = PHOTO_MAIL_STATE[m.check.state];
  const subject = `${dayEndSubjectHead(m.branchName, m.date)} · ${st.subject}`;
  const rows = photoRows(m.check);
  const headline = m.check.state === "belirsiz" ? `${photoUnsureText(m.check)}: fotoğrafa bakın` : st.headline;
  const tone = TONE[st.tone];
  const reads = (m.reads ?? []).filter((r) => r.length);
  const readSections = reads.map((r, i) => ({ title: reads.length > 1 ? `${READ_TITLE} (${i + 1}. fotoğraf)` : READ_TITLE, rows: r }));
  const meta = [
    m.by ? `Ekleyen: ${m.by}` : null,
    m.attachments ? `Fotoğraf ${m.attachments > 1 ? `${m.attachments} ek olarak` : "ek olarak"} bu e-postada.` : null,
  ].filter((x): x is string => Boolean(x));
  const rowHtml = ([label, value]: readonly [string, string]) =>
    `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:#3f3f46;vertical-align:top">${esc(label)}</td><td align="right" style="padding:6px 0 6px 12px;font-family:${FONT};font-size:14px;font-weight:${/· FARK$/.test(value) ? 700 : 600};color:${/· FARK$/.test(value) ? "#b91c1c" : "#171717"}">${esc(value)}</td></tr>`;
  const sectionHtml = (title: string, list: readonly (readonly [string, string])[]) =>
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td colspan="2" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(title)}</td></tr>${list.map(rowHtml).join("")}</table>`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px;font-family:${FONT}"><div style="font-size:16px;font-weight:600;color:#171717">L'Affogato ${esc(m.branchName)}</div><div style="font-size:12px;color:#71717a">Gün sonu fotoğrafı · ${esc(longDateTR(m.date))} ${m.date.slice(0, 4)} · gün sonu e-postası daha önce gitti</div></td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:22px 20px">
    <div style="background:${tone.bg};border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${tone.fg}">${esc(headline)}</div>
    ${meta.length ? `<div style="margin-top:10px;font-family:${FONT};font-size:13px;line-height:18px;color:#52525b">${meta.map(esc).join("<br>")}</div>` : ""}
    ${sectionHtml(PHOTO_TITLE, rows)}
    ${readSections.map((x) => sectionHtml(x.title, x.rows)).join("")}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717"><a href="${esc(m.link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;color:#a1a1aa;text-align:center">Bu e-posta kasa raporu alıcılarına gönderildi.</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    subject,
    "",
    headline,
    ...meta,
    "",
    PHOTO_TITLE,
    ...rows.map(([l, v]) => `${l}: ${v}`),
    ...readSections.flatMap((x) => ["", x.title, ...x.rows.map(([l, v]) => `${l}: ${v}`)]),
    "",
    `Panelde aç: ${m.link}`,
  ].join("\n");
  return { subject, html, text };
}

/** "Banka POS: 995 ₺ (000278 240 ₺ + 000279 755 ₺)", ya da "boş · <tam neden>"; yazarkasanın kaynağı; fotoğraf */
function deviceRows(m: DayEndMail): [string, string][] {
  const rows: [string, string][] = [];
  const bank = bankPosAuto(m.bankPos);
  if (bank.value === null) rows.push(["Banka POS", `boş · ${bank.gap}`]);
  else {
    const batches = m.bankPos?.batches?.length ? m.bankPos.batches : null;
    const parts = batches ? batches.map((b) => `${b.batchNo ?? "batch"} ${money(b.total)}`).join(" + ") : m.bankPos?.batchNo ? `batch ${m.bankPos.batchNo}` : null;
    rows.push(["Banka POS", `${money(bank.value)}${parts ? ` (${parts})` : ""}`]);
  }
  rows.push(["Yazarkasa", m.okc ? `LafPOS cihaz belgeleri · ${m.okc.docs} belge · ${money(m.okc.total)}` : GAP_TEXT.okcMissing.replace(/^Yazarkasa: /, "")]);
  if (m.photo) rows.push(["Fotoğraf", photoCheckText(m.photo.check, m.photo.need, m.photo.attached)]);
  return rows;
}

function diffWord(d: number): string {
  if (Math.abs(d) < 0.005) return "tutuyor";
  return `${money(Math.abs(d))} ${d < 0 ? "eksik" : "fazla"}`;
}

function cashFieldsOf(v: AutoValues) {
  const n = (f: AutoField) => (typeof v[f] === "number" ? (v[f] as number) : 0);
  return {
    zTotal: n("zTotal"),
    cash: n("cash"),
    card: n("card"),
    mealCard: n("mealCard"),
    online: n("online"),
    other: n("other"),
    offRevenue: typeof v.offRevenue === "number" ? v.offRevenue : null,
    openingCash: n("openingCash"),
    cashIn: n("cashIn"),
    cashOut: n("cashOut"),
    countedCash: n("countedCash"),
    handedOver: n("handedOver"),
    bankPos: null,
    okcCard: null,
  };
}

/** Üst satırlar: düzeltme notu, raporun durumu, eksikler */
export function dayEndNotes(m: DayEndMail): string[] {
  const out: string[] = [];
  // Faz 2: LafPOS düzeltmenin türünü ve nedenini yollar (yeniden açılış, sonradan sayım)
  const why = m.detail?.correction ? m.detail.correction.replace(/^Düzeltme: /, "") : null;
  if (m.recount) out.push("Önceki e-postada sayım yoktu; LafPOS günü sayımla yeniden gönderdi.");
  else if (m.corrected) out.push(`Düzeltildi: ${why ? `${why}; ` : "LafPOS bu günü yeniden gönderdi; "}bu e-postadaki rakamlar öncekinin yerine geçer.`);
  out.push(REPORT_TEXT[m.report]);
  const missing = m.report === "human" ? [] : m.missing.map((f) => MISSING_LABEL[f] ?? f);
  if (missing.length) out.push(`Eksik: ${missing.join(", ")}.`);
  return out;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Gün sonu e-postası: konu, HTML ve düz metin. Maliyet ve kâr yok (alıcılar yönetici ya da hesabı olmayan adres) */
export function renderDayEnd(m: DayEndMail): { subject: string; html: string; text: string } {
  const subject = `${dayEndSubject(m.branchName, m.date, { result: dayEndCashResult(m), corrected: m.corrected, recount: m.recount })}${m.bankPos && pavoState(m.bankPos) === "fark" ? " · Pavo FARK VAR" : ""}${m.photo?.check?.state === "fark" ? " · Fotoğraf FARKLI" : ""}`;
  const sections = dayEndSections(m);
  const notes = dayEndNotes(m);
  const rowHtml = ([label, value]: [string, string]) =>
    `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:#3f3f46">${esc(label)}</td><td align="right" style="padding:6px 0 6px 12px;font-family:${FONT};font-size:14px;font-weight:600;color:#171717;white-space:nowrap">${esc(value)}</td></tr>`;
  const sectionHtml = (s: { title: string; rows: [string, string][] }) =>
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td colspan="2" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(s.title)}</td></tr>${s.rows.map(rowHtml).join("")}</table>`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px;font-family:${FONT}"><div style="font-size:16px;font-weight:600;color:#171717">L'Affogato ${esc(m.branchName)}</div><div style="font-size:12px;color:#71717a">LafPOS gün sonu · ${esc(longDateTR(m.date))} ${m.date.slice(0, 4)}</div></td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:22px 20px">
    <div style="font-family:${FONT};font-size:13px;color:#71717a">Toplam satış</div>
    <div style="font-family:${FONT};font-size:28px;line-height:34px;font-weight:700;color:#171717">${esc(money(m.z.zTotal))}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px"><tr><td style="background:${m.corrected ? "#fff7ed" : "#f4f4f5"};border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:13px;line-height:18px;color:${m.corrected ? "#9a3412" : "#3f3f46"}">${notes.map(esc).join("<br>")}</td></tr></table>
    ${sections.map(sectionHtml).join("\n    ")}${m.bankPos ? `\n    ${pavoSectionHtml(m.bankPos)}` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717"><a href="${esc(m.link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;color:#a1a1aa;text-align:center">Bu e-posta kasa raporu alıcılarına gönderildi.</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    subject,
    "",
    `Toplam satış: ${money(m.z.zTotal)}`,
    ...notes,
    ...sections.flatMap((s) => ["", s.title, ...s.rows.map(([l, v]) => `${l}: ${v}`)]),
    ...(m.bankPos ? ["", ...pavoSectionText(m.bankPos)] : []),
    "",
    `Panelde aç: ${m.link}`,
  ].join("\n");
  return { subject, html, text };
}

/** Çalışanların sayımsız gün uyarısı (e-posta, Bugün ve zil aynı cümle): ne oldu, ne yapılacak */
export const STAFF_NO_COUNT_TEXT = "LafPOS'ta gün sonu sayımı yok, kasa raporu yazılmadı. Çekmeceyi LafPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayın; LafPOS günü yeniden gönderir.";
/** Yöneticinin aynı durumu (Bugün ve zil): rapor neden yok, ne zaman gelir */
export const LAFPOS_NO_COUNT_ADMIN_TEXT = "LafPOS gün sonu geldi, çekmece sayılmadı. Rapor sayım gelince kendiliğinden yazılır; LafPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayılır.";

/**
 * Çalışanların kısa e-postası (saf): sayım varsa "Marina · gün sonu alındı" (Z no, fiş sayısı; `amounts` açıksa ciro ve
 * ödeme türleri), sayım yoksa "Marina · kasa sayılmadı" uyarısı ve ne yapılacağı (teşekkür yok: iş bitmedi). Kasa farkı,
 * maliyet ve karaoke ödemesi hiç girmez
 */
export function renderStaffDayEnd(m: { branchName: string; date: string; kind: "alindi" | "sayim-yok"; z: Pick<PosDayZ, "zNo" | "receipts" | "zTotal" | "cash" | "card" | "mealCard" | "other">; amounts: boolean }): {
  subject: string;
  html: string;
  text: string;
} {
  const day = longDateTR(m.date);
  if (m.kind === "sayim-yok") {
    const subject = `${m.branchName} · kasa sayılmadı · ${day}`;
    const text = [`${m.branchName} gün sonu sayımsız geldi (${day}).`, "", STAFF_NO_COUNT_TEXT].join("\n");
    const html = `<!doctype html><html lang="tr"><body style="font-family:Inter,Arial,sans-serif;color:#171a26"><h2 style="margin:0 0 12px">${esc(m.branchName)} · kasa sayılmadı</h2><p style="color:#5f6371;margin:0 0 12px">${esc(day)}</p><p style="margin:0">${esc(STAFF_NO_COUNT_TEXT)}</p></body></html>`;
    return { subject, html, text };
  }
  const z = m.z;
  const tlText = (v: number) => `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  const rows: [string, string][] = [["Z no", String(z.zNo)], ["Fiş sayısı", String(z.receipts)]];
  if (m.amounts) {
    rows.push(["Toplam satış", tlText(z.zTotal)], ["Nakit", tlText(z.cash)], ["Kart", tlText(z.card)]);
    if (z.mealCard) rows.push(["Yemek kartı", tlText(z.mealCard)]);
    if (z.other) rows.push(["Diğer", tlText(z.other)]);
  }
  const subject = `${m.branchName} · gün sonu alındı · ${day}`;
  const text = [`${m.branchName} gün sonu alındı (${day}).`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", "Emeğiniz için teşekkürler."].join("\n");
  const html = `<!doctype html><html lang="tr"><body style="font-family:Inter,Arial,sans-serif;color:#171a26"><h2 style="margin:0 0 12px">${esc(m.branchName)} · gün sonu alındı</h2><p style="color:#5f6371;margin:0 0 12px">${esc(day)}</p><table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5f6371">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join("")}</table><p style="margin-top:16px">Emeğiniz için teşekkürler.</p></body></html>`;
  return { subject, html, text };
}

/** Kıyas günleri: dün ve geçen haftanın aynı günü */
export function compareDays(date: string): { yesterday: string; lastWeek: string } {
  return { yesterday: addDays(date, -1), lastWeek: addDays(date, -7) };
}
