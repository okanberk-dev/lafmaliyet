import { dateTR, money } from "@/lib/format";
import { normalizeVat, sameVat, zNoNumber, type OkcVatLine } from "@/lib/okc-z";
import { businessDayOf, printedAmount, round2 } from "@/lib/photo-read/common";
import type { KasaOkc } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";

import type { BankPos, PosOkc } from "./day";

/**
 * LafPOS gününün gün sonu fotoğrafı (sahibin isteği, 24 Kasım 2026: "sadece gün sonu ladmine personel foto atsın";
 * docs/LAFPOS.md › Gün sonu otomasyonu; saf, tests/lafpos-gun-sonu-tam.test.ts). Kasa raporunun rakamları LafPOS'tan ve
 * Pavo'dan kendiliğinden yazılır; personel yalnız fotoğraf ekler (Pavo'nun gün sonu fişi; mali Z basan cihazda yazarkasa
 * Z'si de). Fotoğraf hiçbir alanı yazmaz: okunuşu LafPOS'un rakamlarıyla karşılaştırılır, sonuç yöneticiye gider
 * (lafpos_day_ends.photo_check). Personel yalnız "Fotoğraf alındı" ya da "Fotoğraf okunamadı / yanlış belge, yeniden
 * çekin" görür.
 */

/** Personelin gördüğü metinler (başka hiçbir iş yok) */
export const LAFPOS_PHOTO_TEXT = {
  slip: "Pavo gün sonu fişinin fotoğrafını ekleyin",
  z: "Yazarkasa Z raporunun fotoğrafını ekleyin",
  done: "Fotoğraf alındı",
  /** Pavo'nun sonucu LafPOS'a henüz gelmedi (Banka POS yok): fotoğraf yokken "alındı" denmez */
  waiting: "Pavo gün sonu bekleniyor; gün sonu fişinin fotoğrafını ekleyin",
  retry: "Fotoğraf okunamadı / yanlış belge, yeniden çekin",
} as const;

/** İstenen fotoğraflar: Pavo sonucu geldiyse gün sonu fişi; cihaz mali Z basıyorsa (TokenX) Z'si de */
export interface LafposPhotoNeed {
  slip: boolean;
  z: boolean;
  count: number;
}

export function lafposPhotoNeed(d: { bankPos: BankPos | null | undefined; okc: PosOkc | null | undefined }): LafposPhotoNeed {
  const slip = Boolean(d.bankPos);
  const z = d.okc?.zReport === true;
  return { slip, z, count: (slip ? 1 : 0) + (z ? 1 : 0) };
}

/** Fotoğrafın bir okunuşu: ai_calls'un son başarılı sonucu (okunmadıysa raw null; okuma düştüyse error) */
export interface LafposPhotoRead {
  photoId: number;
  raw: KasaOkc | null;
  error: string | null;
}

/** Fotoğrafın LafPOS'la karşılaştırması: satır, fotoğraftaki, LafPOS'taki, tutuyor mu */
export interface LafposPhotoRow {
  label: string;
  photo: string;
  lafpos: string;
  ok: boolean;
}

export interface LafposPhotoCheck {
  /** Karşılaştırmanın anı (ISO) */
  at: string;
  /** Rapora bağlı gün sonu fotoğrafı sayısı */
  photos: number;
  /**
   * "uyumlu" fotoğraf LafPOS'u tutuyor; "fark" yöneticinin uyarısı; "okunamadi" okunamadı ya da yanlış belge (personel
   * yeniden çeker); "okunmadi" okuma yok (bu ortamda kapalı, ya da henüz okunmadı)
   */
  state: "uyumlu" | "fark" | "okunamadi" | "okunmadi";
  rows: LafposPhotoRow[];
  /** Tutmayan satırların kısa metni (zil, e-posta, ay satırı) */
  issues: string[];
  /** Raporun Banka POS'u boşken (Pavo alınamadı) fotoğrafta okunan toplam: yönetici "Banka POS'a yaz" ile yazar */
  readBankPos: number | null;
}

/** Raporun karşılaştırılan alanları (LafPOS'tan yazılmış değerler) */
export interface LafposPhotoReport {
  bankPos: number | null;
  okcZNo: string | null;
  okcTotal: number | null;
  okcCash: number | null;
  okcCard: number | null;
  okcMealCard: number | null;
  okcVat: OkcVatLine[] | null;
}

const TOL = 0.01;
const near = (a: number, b: number) => Math.abs(round2(a - b)) <= TOL;
/** Batch no karşılaştırması: baştaki sıfırlar ve boşluklar önemsiz ("000279" = "279") */
const batchKey = (v: string) => v.replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
const amountOf = (v: number | null) => (v === null ? "okunamadı" : money(v));

/**
 * Fotoğraf(lar)ın okunuşu ↔ LafPOS. Pavo gün sonu fişi: okunan her batch no LafPOS'un batch'lerinde, batch sayısı aynı,
 * okunan netlerin toplamı raporun Banka POS'u (±0,01), fişin günü raporun günü (ertesi gün 05:00'ten önce basılan da),
 * son batch'in banka dökümü Pavo'nunkiyle aynı. Yazarkasa Z'si (yalnız cihaz Z basıyorsa): Z no, günlük toplam, nakit,
 * kart, yemek kartı ve KDV dökümü raporun yazarkasa alanlarıyla. Banka POS boşsa okunan toplam yöneticiye önerilir.
 */
export function lafposPhotoCheck(
  i: { day: string; reads: readonly LafposPhotoRead[]; bankPos: BankPos | null; okc: PosOkc | null; report: LafposPhotoReport },
  now: Date = new Date(),
): LafposPhotoCheck {
  const base = { at: now.toISOString(), photos: i.reads.length, rows: [] as LafposPhotoRow[], issues: [] as string[], readBankPos: null as number | null };
  // Batch satırı okunmamış Pavo fişi (ör. batch bölümü kadrajın dışında) karşılaştırılacak bir şey vermez: okunamadı sayılır
  const usable = i.reads.filter((r) => r.raw && r.raw.readable && ((r.raw.documentType === "batch_slip" && r.raw.batches.length > 0) || r.raw.documentType === "z_report"));
  if (!usable.length) {
    const failed = i.reads.some((r) => r.error !== null || (r.raw !== null && !usable.includes(r)));
    return { ...base, state: failed ? "okunamadi" : "okunmadi" };
  }
  const rows: LafposPhotoRow[] = [];
  let readBankPos: number | null = null;

  // Pavo gün sonu fişi (yalnız ya da Z'nin altında basılmış)
  const slips = usable.flatMap((r) => r.raw!.batches.map((b) => ({ raw: r.raw!, b })));
  if (slips.length && i.bankPos) {
    const nets = slips.map(({ b }) => {
      const net = printedAmount(b.netTotal).value;
      if (net !== null) return net;
      const sales = printedAmount(b.salesTotal).value;
      return sales === null ? null : round2(sales - (b.refundTotal.text === null ? 0 : (printedAmount(b.refundTotal).value ?? 0)));
    });
    const readNos = [...new Set(slips.flatMap(({ b }) => (b.batchNo?.trim() ? [b.batchNo.trim()] : [])))];
    const lafposBatches = i.bankPos.batches ?? (i.bankPos.batchNo ? [{ batchNo: i.bankPos.batchNo, total: i.bankPos.pavoCard }] : []);
    const lafposNos = lafposBatches.flatMap((b) => (b.batchNo ? [b.batchNo] : []));
    // Günde birden çok Pavo gün sonu olabilir (gün içinde elle alınan + kapanış); personel her fişi çekmeyebilir. Fotoğrafta
    // LafPOS'un batch'lerinin yalnız bir kısmı varsa (bilinmeyen batch yok) yalnız çekilen batch'ler karşılaştırılır: her
    // birinin tutarı LafPOS'taki batch'iyle; çekilmeyenler bilgi satırıdır (fark değil). Hepsi çekildiyse sayı ve toplam
    const keys = new Set(readNos.map(batchKey));
    const known = new Set(lafposNos.map(batchKey));
    const partial = readNos.length > 0 && lafposNos.length > 0 && [...keys].every((k) => known.has(k)) && lafposNos.some((n) => !keys.has(batchKey(n)));
    if (readNos.length) {
      rows.push({ label: "Batch no", photo: readNos.join(", "), lafpos: lafposNos.join(", ") || "yok", ok: readNos.every((n) => known.has(batchKey(n))) });
      if (!partial) rows.push({ label: "Batch sayısı", photo: String(keys.size), lafpos: String(lafposBatches.length), ok: keys.size === lafposBatches.length });
    }
    const sum = nets.every((n) => n !== null) ? round2((nets as number[]).reduce((a, n) => a + n, 0)) : null;
    if (partial) {
      const totals = new Map(lafposBatches.flatMap((b) => (b.batchNo ? [[batchKey(b.batchNo), b.total] as const] : [])));
      const seen = new Set<string>();
      slips.forEach(({ b }, k) => {
        const key = b.batchNo?.trim() ? batchKey(b.batchNo.trim()) : null;
        if (key === null || seen.has(key)) return;
        seen.add(key);
        const lafpos = totals.get(key) ?? null;
        rows.push({ label: `Batch ${b.batchNo!.trim()}`, photo: amountOf(nets[k]), lafpos: amountOf(lafpos), ok: nets[k] !== null && lafpos !== null && near(nets[k]!, lafpos) });
      });
      const unshot = lafposNos.filter((n) => !keys.has(batchKey(n)));
      rows.push({ label: "Fotoğrafı olmayan batch", photo: "yok", lafpos: unshot.join(", "), ok: true });
    } else if (i.report.bankPos === null) {
      readBankPos = sum;
      rows.push({ label: "Banka POS toplamı", photo: amountOf(sum), lafpos: "boş", ok: true });
    } else {
      rows.push({ label: "Banka POS toplamı", photo: amountOf(sum), lafpos: money(i.report.bankPos), ok: sum !== null && near(sum, i.report.bankPos) });
    }
    // Fişin günü: başlıktaki tarih ve saat (05:00'ten önce basılan bir önceki gün); saatsizse batch'in tarihi, ertesi gün de olur
    const slipRaw = usable.find((r) => r.raw!.documentType === "batch_slip")?.raw ?? slips[0].raw;
    const printed = businessDayOf(slipRaw.date, slipRaw.time);
    const fallback = slips.find(({ b }) => b.date)?.b.date ?? null;
    const shown = printed ?? fallback;
    if (shown) {
      const ok = printed ? printed === i.day || (slipRaw.time === null && printed === addDays(i.day, 1)) : fallback === i.day || fallback === addDays(i.day, 1);
      rows.push({ label: "Fişin günü", photo: dateTR(shown), lafpos: dateTR(i.day), ok });
    }
    // Son batch'in banka dökümü (Pavo'nun acquirer satırları)
    const acq = i.bankPos.acquirers.map((a) => a.total).filter((t): t is number => t !== null);
    const last = i.bankPos.batchNo ? batchKey(i.bankPos.batchNo) : null;
    const lastRead = slips.map((s, k) => ({ no: s.b.batchNo ? batchKey(s.b.batchNo) : null, net: nets[k] })).filter((s) => last !== null && s.no === last);
    if (acq.length && lastRead.length) {
      const a = [...acq].sort((x, y) => x - y);
      const r = lastRead.map((s) => s.net).filter((n): n is number => n !== null).sort((x, y) => x - y);
      const ok = a.length === r.length && a.every((v, k) => near(v, r[k]));
      rows.push({ label: "Banka dökümü", photo: r.map(money).join(" + ") || "okunamadı", lafpos: a.map(money).join(" + "), ok });
    }
  }

  // Yazarkasa Z'si: yalnız cihaz mali Z basıyorsa (Pavo e-Arşiv, Z yok)
  if (i.okc?.zReport) {
    const z = usable.find((r) => r.raw!.documentType === "z_report")?.raw ?? null;
    if (!z) rows.push({ label: "Yazarkasa Z", photo: "yok", lafpos: "bekleniyor", ok: false });
    else {
      const no = z.zNo.text?.trim() || (z.zNo.value !== null ? String(z.zNo.value) : null);
      const sameNo = no !== null && i.report.okcZNo !== null && (zNoNumber(no) !== null && zNoNumber(i.report.okcZNo) !== null ? zNoNumber(no) === zNoNumber(i.report.okcZNo) : no === i.report.okcZNo);
      rows.push({ label: "Yazarkasa Z no", photo: no ?? "okunamadı", lafpos: i.report.okcZNo ?? "yok", ok: sameNo });
      const sumOf = (kinds: readonly string[]) => {
        const xs = z.payments.filter((p) => kinds.includes(p.kind)).map((p) => printedAmount(p.amount).value);
        return xs.some((x) => x === null) ? null : round2((xs as number[]).reduce((a, x) => a + x, 0));
      };
      const pairs: [string, number | null, number | null][] = [
        ["Yazarkasa toplamı", printedAmount(z.dailyTotal).value, i.report.okcTotal],
        ["Yazarkasa nakdi", sumOf(["cash"]), i.report.okcCash],
        ["Yazarkasa kartı", sumOf(["card"]), i.report.okcCard],
        ["Yazarkasa yemek kartı", sumOf(["meal_card"]), i.report.okcMealCard],
      ];
      for (const [label, photo, lafpos] of pairs) {
        if (lafpos === null) continue;
        rows.push({ label, photo: amountOf(photo), lafpos: money(lafpos), ok: photo !== null && near(photo, lafpos) });
      }
      const vat = normalizeVat(
        z.kdvGroups.flatMap((g) => {
          const t = printedAmount(g.total).value;
          const v = printedAmount(g.vat).value;
          return t !== null && v !== null ? [{ rate: g.rate, total: t, vat: v }] : [];
        }),
      );
      if (i.report.okcVat) {
        const text = (xs: readonly OkcVatLine[]) => xs.map((g) => `%${g.rate} ${money(g.vat)}`).join(" · ") || "yok";
        rows.push({ label: "Yazarkasa KDV", photo: text(vat), lafpos: text(normalizeVat(i.report.okcVat)), ok: sameVat(vat, i.report.okcVat) });
      }
    }
  }

  // Karşılaştırılan hiçbir satır yoksa "uyumlu" denmez: Pavo fişi okundu ama LafPOS'ta karşılığı henüz yok (Pavo'nun sonucu
  // gelmedi) ise okunmadı, öteki durumda (ör. Pavo cihazında Z fotoğrafı, fiş yok) okunamadı / yanlış belge
  if (!rows.length) return { ...base, state: slips.length && !i.bankPos ? "okunmadi" : "okunamadi" };
  const issues = rows.filter((r) => !r.ok).map((r) => `${r.label}: fotoğrafta ${r.photo}; LafPOS'ta ${r.lafpos}`);
  return { ...base, rows, issues, readBankPos, state: issues.length ? "fark" : "uyumlu" };
}

/**
 * Personelin tek satırı: istenen fotoğraf eklenene kadar ne çekileceği; eklenince "Fotoğraf alındı", okunamadı ya da
 * yanlış belgeyse yeniden çekmesi. Fotoğrafla LafPOS'un farkı personele söylenmez (yöneticinin uyarısı)
 */
export function staffPhotoLine(need: LafposPhotoNeed, attached: number, check: Pick<LafposPhotoCheck, "state"> | null): string {
  if (need.count === 0 && attached === 0) return LAFPOS_PHOTO_TEXT.waiting;
  if (attached < need.count) {
    if (need.slip && need.z && attached === 0) return `${LAFPOS_PHOTO_TEXT.slip}. ${LAFPOS_PHOTO_TEXT.z}`;
    return need.slip && attached === 0 ? LAFPOS_PHOTO_TEXT.slip : LAFPOS_PHOTO_TEXT.z;
  }
  if (check?.state === "okunamadi") return LAFPOS_PHOTO_TEXT.retry;
  return LAFPOS_PHOTO_TEXT.done;
}

/**
 * Fotoğraf tamam mı (günün raporu bitti): istenen sayı eklendi ve okunamadı / yanlış belge değil. Pavo'nun sonucu henüz
 * gelmediyse (istenen 0) fotoğrafsız gün tamam sayılmaz: Pavo'nun fişi gün sonunda basılır, çekilince tamamlanır
 */
export function lafposPhotoDone(need: LafposPhotoNeed, attached: number, check: Pick<LafposPhotoCheck, "state"> | null): boolean {
  if (need.count === 0 && attached === 0) return false;
  return attached >= need.count && check?.state !== "okunamadi";
}

/** Yöneticinin kısa satırı (ay satırının rozeti, e-posta): "Fotoğraf ↔ LafPOS: farklı (2)" */
export function photoCheckText(check: LafposPhotoCheck | null, need: LafposPhotoNeed, attached: number): string {
  if (need.count === 0 && attached === 0) return "bekleniyor (Pavo gün sonu henüz gelmedi)";
  if (attached < need.count) return `bekleniyor (${[need.slip && attached === 0 ? "Pavo gün sonu fişi" : null, need.z ? "yazarkasa Z" : null].filter(Boolean).join(", ") || "fotoğraf"})`;
  if (!check) return "alındı";
  switch (check.state) {
    case "uyumlu":
      return "alındı · LafPOS'la aynı";
    case "fark":
      return `alındı · LafPOS'tan farklı: ${check.issues.join("; ")}`;
    case "okunamadi":
      return "okunamadı ya da yanlış belge (personel yeniden çeker)";
    default:
      return "alındı · okunmadı";
  }
}
