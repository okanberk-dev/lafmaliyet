import { dateTR, money } from "@/lib/format";
import { normalizeVat, sameVat, zNoNumber, type OkcVatLine } from "@/lib/okc-z";
import { businessDayOf, printedAmount, round2 } from "@/lib/photo-read/common";
import type { KasaOkc } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";

import type { BankPos, PosOkc } from "./day";

/**
 * LafPOS gününün gün sonu fotoğrafı (sahibin isteği, 24 Kasım 2026: "sadece gün sonu ladmine personel foto atsın";
 * docs/LAFPOS.md › Gün sonu otomasyonu; saf, tests/lafpos-gun-sonu-tam.test.ts). Kasa raporunun rakamları LafPOS'tan ve
 * Pavo'dan kendiliğinden yazılır; personel yalnız fotoğraf ekler. Pavo istenince detaylı Z basar (sahibin yanıtı, 24
 * Kasım 2026: "Pavo cihazdan fiş isteyince veriyor, Z olarak detaylı"): tek fişte banka gün sonu (batch'ler) ve Z'nin
 * rakamları (Z no, toplam, nakit, kart, yemek kartı / diğer, KDV); personelden tek fotoğraf istenir. LafPOS'un
 * `okc.zReport`'u Pavo için hâlâ false gelir, ölçü değildir. Yalnız ayrı mali Z basan cihazda (TokenX) yazarkasa Z'si
 * ayrıca istenir. Fotoğraf hiçbir alanı yazmaz (tek istisna: LafPOS Z no göndermediyse fotoğrafta okunan Z no): okunuşu
 * LafPOS'un rakamlarıyla karşılaştırılır, sonuç yöneticiye gider (lafpos_day_ends.photo_check). Personel yalnız
 * "Fotoğraf alındı" ya da "Fotoğraf okunamadı / yanlış belge, yeniden çekin" görür.
 */

/** Personelin gördüğü metinler (başka hiçbir iş yok) */
export const LAFPOS_PHOTO_TEXT = {
  slip: "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin",
  z: "Yazarkasa Z raporunun fotoğrafını ekleyin",
  done: "Fotoğraf alındı",
  /**
   * Pavo'nun sonucu LafPOS'a henüz gelmedi (Banka POS yok): fotoğraf yokken "alındı" denmez. Personel için iş aynı (fişi
   * Pavo istenince basar); bekleyen sonuç yöneticinin
   */
  waiting: "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin",
  retry: "Fotoğraf okunamadı / yanlış belge, yeniden çekin",
} as const;

/** Personelin Kasa sayfasının alt başlığı, LafPOS'un otomatik gününde (rakam girmez, yalnız fotoğraf) */
export const LAFPOS_STAFF_DESCRIPTION = "Rakamlar LafPOS'tan geldi; Pavo'dan gün sonu fişini (detaylı Z) alıp fotoğrafını ekleyin.";

/** Rapora bağlı gün sonu fotoğrafının adı (LafPOS günü): Pavo'nun fişi; ayrı mali Z basan cihazda "Yazarkasa Z" */
export function lafposPhotoLabel(need: Pick<LafposPhotoNeed, "z">): string {
  return need.z ? "Yazarkasa Z" : "Pavo gün sonu fişi";
}

/**
 * Personelin gördüğü fotoğraf farkı: LafPOS'un otomatik gününde hiç (fark yöneticinin uyarısı; eski "Fotoğraftan farklı
 * yazılan" yolu da personele gösterilmez). Yönetici ve ModPOS / elle girilen gün eskisi gibi
 */
export function staffPhotoDiffs<T>(diffs: readonly T[] | null, o: { admin: boolean; lafposAuto: boolean }): T[] | null {
  if (diffs === null) return null;
  return !o.admin && o.lafposAuto ? [] : [...diffs];
}

/**
 * Otomatik raporun notu personele: "Eksik: …" bölümü (yöneticinin yönergesi: "LafPOS'ta Yönetim › Yazarkasa POS › …")
 * yerine kısa nötr satır. Banka POS hâlâ boşsa "Banka POS henüz gelmedi; yönetici ilgileniyor" (yönetici yazdıysa yok),
 * yazarkasa alanları boşsa aynısı yazarkasa için; başka eksik personele söylenmez
 */
export function staffAutoNote(note: string | null, r: { bankPos: number | null; okcTotal?: number | null }): string | null {
  if (note === null) return null;
  const at = note.indexOf(" Eksik: ");
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
export interface LafposPhotoNeed {
  slip: boolean;
  z: boolean;
  count: number;
}

export function lafposPhotoNeed(d: { bankPos: BankPos | null | undefined; okc: PosOkc | null | undefined }): LafposPhotoNeed {
  const slip = Boolean(d.bankPos);
  const z = d.okc?.zReport === true && d.okc.provider === "tokenx";
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
  /**
   * LafPOS yazarkasa Z no'su göndermediyse fotoğrafta (Pavo'nun detaylı Z'si) okunan Z no: sunucu raporun boş Z no'suna
   * yazar, yönetici "fotoğraftan okundu" görür. LafPOS gönderdiyse yok (yalnız karşılaştırılır). Eski kayıtta alan yok
   */
  zNoFromPhoto?: string | null;
}

/** Raporun karşılaştırılan alanları (LafPOS'tan yazılmış değerler) */
export interface LafposPhotoReport {
  bankPos: number | null;
  okcZNo: string | null;
  okcTotal: number | null;
  okcCash: number | null;
  okcCard: number | null;
  okcMealCard: number | null;
  okcOther?: number | null;
  okcVat: OkcVatLine[] | null;
  /**
   * LafPOS'un gönderdiği yazarkasa Z no'su (gövdenin `z.okcZNo`'su). Yoksa (undefined) raporunki LafPOS'unki sayılır.
   * null: LafPOS göndermedi, fotoğrafta okunan Z no yazılabilir (`zNoFromPhoto`)
   */
  lafposZNo?: string | null;
}

const TOL = 0.01;
const near = (a: number, b: number) => Math.abs(round2(a - b)) <= TOL;
/** Batch no karşılaştırması: baştaki sıfırlar ve boşluklar önemsiz ("000279" = "279") */
const batchKey = (v: string) => v.replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
const amountOf = (v: number | null) => (v === null ? "okunamadı" : money(v));

/**
 * Fotoğraf(lar)ın okunuşu ↔ LafPOS. Pavo gün sonu fişi: okunan her batch no LafPOS'un batch'lerinde, batch sayısı aynı,
 * okunan netlerin toplamı raporun Banka POS'u (±0,01), fişin günü raporun günü (ertesi gün 05:00'ten önce basılan da),
 * son batch'in banka dökümü Pavo'nunkiyle aynı. Z'nin rakamları (Pavo'nun detaylı Z'si ya da ayrı mali Z): okunduysa Z
 * no, günlük toplam, nakit, kart, yemek kartı, diğer ve KDV dökümü raporun yazarkasa alanlarıyla; ayrı mali Z basan cihazda
 * (TokenX) Z fotoğrafı yoksa "yok". Banka POS boşsa okunan toplam yöneticiye önerilir; LafPOS Z no göndermediyse okunan Z
 * no `zNoFromPhoto`.
 */
export function lafposPhotoCheck(
  i: { day: string; reads: readonly LafposPhotoRead[]; bankPos: BankPos | null; okc: PosOkc | null; report: LafposPhotoReport },
  now: Date = new Date(),
): LafposPhotoCheck {
  const base = { at: now.toISOString(), photos: i.reads.length, rows: [] as LafposPhotoRow[], issues: [] as string[], readBankPos: null as number | null, zNoFromPhoto: null as string | null };
  // Batch satırı okunmamış Pavo fişi (ör. batch bölümü kadrajın dışında) karşılaştırılacak bir şey vermez: okunamadı sayılır
  const usable = i.reads.filter((r) => r.raw && r.raw.readable && ((r.raw.documentType === "batch_slip" && r.raw.batches.length > 0) || r.raw.documentType === "z_report"));
  if (!usable.length) {
    const failed = i.reads.some((r) => r.error !== null || (r.raw !== null && !usable.includes(r)));
    return { ...base, state: failed ? "okunamadi" : "okunmadi" };
  }
  const rows: LafposPhotoRow[] = [];
  let readBankPos: number | null = null;
  let zNoFromPhoto: string | null = null;

  // Pavo gün sonu fişi (yalnız ya da Z'nin altında basılmış)
  // Aynı fişin iki fotoğrafı (personel birden çok çekebilir): aynı batch no ve aynı tutar bir kez sayılır; farklı tutarla
  // okunan aynı batch ise iki kez kalır (fark yöneticiye)
  const seenSlip = new Set<string>();
  const slips = usable
    .flatMap((r) => r.raw!.batches.map((b) => ({ raw: r.raw!, b })))
    .filter(({ b }) => {
      if (!b.batchNo?.trim()) return true;
      const key = `${batchKey(b.batchNo.trim())}|${b.netTotal.text ?? ""}|${b.salesTotal.text ?? ""}`;
      if (seenSlip.has(key)) return false;
      seenSlip.add(key);
      return true;
    });
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

  // Z'nin rakamları: Pavo'nun detaylı Z'si (gün sonu fişiyle aynı kâğıtta) ya da ayrı mali Z basan cihazın (TokenX) Z'si.
  // Okunduysa her cihazda karşılaştırılır (LafPOS'un `zReport`'u Pavo için false gelir, ölçü değil); TokenX'te Z yoksa "yok"
  // Birden çok Z okunduysa (aynı fişin iki fotoğrafı) her biri karşılaştırılır: satır hepsi LafPOS'u tutunca tamam
  const zs = usable.filter((r) => r.raw!.documentType === "z_report").map((r) => r.raw!);
  const separateZ = i.okc?.zReport === true && i.okc.provider === "tokenx";
  if (!zs.length) {
    if (separateZ) rows.push({ label: "Yazarkasa Z", photo: "yok", lafpos: "bekleniyor", ok: false });
  } else {
    const uniq = (xs: readonly string[]) => [...new Set(xs)].join(" / ");
    const sameNo = (a: string, b: string) => (zNoNumber(a) !== null && zNoNumber(b) !== null ? zNoNumber(a) === zNoNumber(b) : a === b);
    const nos = zs.map((z) => z.zNo.text?.trim() || (z.zNo.value !== null ? String(z.zNo.value) : null));
    const readNos = nos.filter((n): n is string => n !== null);
    const lafposNo = i.report.lafposZNo === undefined ? i.report.okcZNo : i.report.lafposZNo;
    if (lafposNo) {
      // LafPOS gönderdi: raporunkiyle (elle düzeltilmişse o) karşılaştırılır
      const reportNo = i.report.okcZNo ?? lafposNo;
      rows.push({ label: "Yazarkasa Z no", photo: uniq(nos.map((n) => n ?? "okunamadı")), lafpos: reportNo, ok: nos.every((n) => n !== null && sameNo(n, reportNo)) });
    } else if (readNos.length) {
      // LafPOS göndermedi: fotoğraftaki raporun boş Z no'suna yazılır (sunucu; okunanlar birbirini tutuyorsa); raporda başka
      // bir Z no varsa ya da fotoğraflar farklı Z no gösteriyorsa fark
      const agreed = readNos.every((n) => sameNo(n, readNos[0]));
      if (agreed) zNoFromPhoto = readNos[0];
      rows.push({
        label: "Yazarkasa Z no",
        photo: `${uniq(readNos)} (fotoğraftan okundu)`,
        lafpos: i.report.okcZNo ? `gönderilmedi; raporda ${i.report.okcZNo}` : "gönderilmedi",
        ok: agreed && (i.report.okcZNo === null || sameNo(readNos[0], i.report.okcZNo)),
      });
    }
    const sumOf = (z: KasaOkc, kinds: readonly string[]) => {
      const xs = z.payments.filter((p) => kinds.includes(p.kind)).map((p) => printedAmount(p.amount).value);
      return xs.some((x) => x === null) ? null : round2((xs as number[]).reduce((a, x) => a + x, 0));
    };
    // Kart satırı basmayan cihaz kartı yalnız banka adlarıyla basar (OKC_TASK): o zaman banka satırları kart sayılır
    const cardOf = (z: KasaOkc) => (z.payments.some((p) => p.kind === "card") ? sumOf(z, ["card"]) : sumOf(z, ["bank_subline"]));
    const pairs: [string, (z: KasaOkc) => number | null, number | null | undefined][] = [
      ["Yazarkasa toplamı", (z) => printedAmount(z.dailyTotal).value, i.report.okcTotal],
      ["Yazarkasa nakdi", (z) => sumOf(z, ["cash"]), i.report.okcCash],
      ["Yazarkasa kartı", cardOf, i.report.okcCard],
      ["Yazarkasa yemek kartı", (z) => sumOf(z, ["meal_card"]), i.report.okcMealCard],
      ["Yazarkasa diğer", (z) => sumOf(z, ["other"]), i.report.okcOther],
    ];
    for (const [label, read, lafpos] of pairs) {
      if (lafpos === null || lafpos === undefined) continue;
      const photo = zs.map(read);
      rows.push({ label, photo: uniq(photo.map(amountOf)), lafpos: money(lafpos), ok: photo.every((v) => v !== null && near(v, lafpos)) });
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
      rows.push({ label: "Yazarkasa KDV", photo: uniq(vats.map(text)), lafpos: text(normalizeVat(i.report.okcVat)), ok: vats.every((v) => sameVat(v, i.report.okcVat!)) });
    }
  }

  // Karşılaştırılan hiçbir satır yoksa "uyumlu" denmez: Pavo fişi okundu ama LafPOS'ta karşılığı henüz yok (Pavo'nun sonucu
  // gelmedi) ise okunmadı, öteki durumda (ör. Pavo cihazında Z fotoğrafı, fiş yok) okunamadı / yanlış belge
  if (!rows.length) return { ...base, state: slips.length && !i.bankPos ? "okunmadi" : "okunamadi" };
  const issues = rows.filter((r) => !r.ok).map((r) => `${r.label}: fotoğrafta ${r.photo}; LafPOS'ta ${r.lafpos}`);
  return { ...base, rows, issues, readBankPos, zNoFromPhoto, state: issues.length ? "fark" : "uyumlu" };
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
