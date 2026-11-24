/**
 * Gün içinde kasadan çıkanlar (saf; tests/fotograf-okuma.test.ts): satır adları, akşam raporunun "Neye çıktı" notu,
 * raporla satırların tutmadığı uyarısı ve personelin kuralları. Kayıtlar cash_outs tablosunda; ekran
 * src/app/panel/kasa/cash-outs.tsx, eylemler src/server/actions/cash-outs.ts.
 */

import { z } from "zod";

import { money } from "./format";
import { daysBetween } from "./reminders";

export type CashOutKind = "harcama" | "teslim";
export type CashOutDocType = "fis" | "e_arsiv" | "fatura" | "yok";

export interface CashOutLine {
  kind: CashOutKind;
  amount: number;
  /** Alışverişte yer, teslimde kime */
  store: string | null;
  /** Ne alındı */
  description: string | null;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Listede satırın adı: "Migros · süt, beyaz peynir" / "Teslim · patrona" */
export function cashOutLabel(l: CashOutLine): string {
  if (l.kind === "teslim") return l.store ? `Teslim · ${l.store}` : "Teslim";
  return [l.store, l.description].filter(Boolean).join(" · ") || "Harcama";
}

/** Bildirimdeki kısa ad: "Migros" / "Teslim · patrona" */
export function cashOutShortLabel(l: CashOutLine): string {
  if (l.kind === "teslim") return l.store ? `Teslim · ${l.store}` : "Teslim";
  return l.store ?? l.description ?? "Harcama";
}

/** Akşam raporunun "Neye çıktı" notundaki kısa adı: "Migros", "buz", "teslim (patrona)" */
function noteWord(l: CashOutLine): string {
  if (l.kind === "teslim") return l.store ? `teslim (${l.store})` : "teslim";
  return l.store ?? l.description ?? "harcama";
}

/** Akşam raporunun "Neye çıktı" notu: "Migros, buz, tamirci" (en çok 200 karakter); satır yoksa null */
export function cashOutNoteOf(lines: CashOutLine[]): string | null {
  if (!lines.length) return null;
  return cut(lines.map(noteWord).join(", "), 200);
}

/** Satırların toplamı (kuruş hassasiyetinde) */
export function cashOutsTotal(lines: { amount: number }[]): number {
  return Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
}

/** Satırların "Teslim" olanlarının toplamı (LafPOS'un tesliminin panele girilmiş kısmı; lafposHandedGap) */
export function teslimTotalOf(lines: { kind: CashOutKind; amount: number }[]): number {
  return cashOutsTotal(lines.filter((l) => l.kind === "teslim"));
}

/**
 * Raporun "Gün içinde kasadan çıkan" tutarı satırların toplamından 1 ₺'den fazla azsa uyarı (engellemez: fişin parası
 * kasadan çıkmamış olabilir). Fazlası uyarılmaz: fişsiz çıkan para da olur.
 */
export function cashOutCheck(cashOut: number, lines: number[]): string | null {
  if (!lines.length) return null;
  const sum = cashOutsTotal(lines.map((amount) => ({ amount })));
  if (cashOut >= sum - 1) return null;
  return `Kasadan çıkanların toplamı ${money(sum)}; burada ${money(cashOut)} yazılı. Fişler kasadan ödendiyse tutarı düzeltin.`;
}

/** WhatsApp ve e-postadaki satır: "Migros (süt, beyaz peynir) 412,50 ₺" */
export function cashOutShortLine(l: CashOutLine): string {
  if (l.kind === "teslim") return `Teslim${l.store ? ` (${l.store})` : ""} ${money(l.amount)}`;
  const head = l.store ?? (l.description ? cut(l.description, 40) : "Harcama");
  const tail = l.store && l.description ? ` (${cut(l.description, 30)})` : "";
  return `${head}${tail} ${money(l.amount)}`;
}

/** WhatsApp / e-postada en çok bu kadar satır; kalanı "ve 2 kalem daha" */
export const CASH_OUT_LINES_SHOWN = 6;

/**
 * Personelin seçebileceği harcama kategorileri: etkin, alım ya da genel gider, "diğer" grubunda (nakit malzeme alımı,
 * bakım, temizlik). Maaş, kira, reklam gibi kategoriler yöneticide kalır.
 */
export function staffCategory(c: { section: string; panelGroup: string; active: boolean }): boolean {
  return c.active && (c.section === "mal" || c.section === "genel") && c.panelGroup === "diger";
}

/**
 * Personelin girdiği satır Aylık harcamalar'a yazılır mı: alışveriş fişi (ya da fişsiz alışveriş) evet; fatura ve
 * e-Arşiv hayır (Paraşüt'ten de gelir, iki kez sayılmasın; faturası gelmezse yöneticinin bekleyen listesinde durur,
 * matchCashOutInvoices); teslim hiçbir zaman.
 */
export function staffToExpenses(kind: CashOutKind, docType: CashOutDocType): boolean {
  return kind === "harcama" && (docType === "fis" || docType === "yok");
}

/** Satırın belgesi fatura ya da e-Arşiv mi: personelin satırı Aylık harcamalar'a yazılmaz (staffToExpenses) */
export const isInvoiceDoc = (docType: CashOutDocType) => docType === "fatura" || docType === "e_arsiv";

/** Satırın kaydedilişi: yeni satır, düzeltme ya da silinenin geri alınması */
export type CashOutSaveMode = "new" | "edit" | "restore";

/**
 * Satırın Aylık harcamalar kaydı olacak mı. Yönetici anahtarla seçer. Personel yalnız satırı eklerken kurala göre
 * (staffToExpenses); düzeltmede kaydın şimdiki hâli kalır: yöneticinin Aylık harcamalar'dan sildiği kayıt geri gelmez,
 * faturaya açtığı kayıt silinmez. Tek istisna: fatura ya da e-Arşiv diye girilmiş, hâlâ faturasını bekleyen satır
 * fişe (ya da belgesize) düzeltilince kural yeniden uygulanır ve kayıt açılır (inceleme D5; yoksa alım ne bekleyen
 * listede ne gelir-giderde kalırdı). Geri almada ikisinde de silinen satırdaki gibi. Teslimin kaydı olmaz.
 */
export function cashOutWritesExpense(o: {
  admin: boolean;
  mode: CashOutSaveMode;
  kind: CashOutKind;
  docType: CashOutDocType;
  /** Yöneticinin anahtarı; geri almada silinen satırın kaydı vardı mı */
  requested: boolean;
  /** Satırın şimdi bir harcama kaydı var mı (düzeltmede) */
  hasExpense: boolean;
  /** Düzeltmede satırın kayıtlı belge türü */
  prevDocType?: CashOutDocType | null;
  /**
   * Düzeltmede satır kasadan faturalı alımların bekleyen listesinde mi (faturası gelmedi, yönetici kapatmadı). Sunucu
   * bilir; pencere bilmez (verilmezse bekliyor sayılır: kategori alanı görünür, kararı sunucu verir)
   */
  awaitingInvoice?: boolean;
  /**
   * Satır kategorisini bekleyen LafPOS harcaması (Faz 3; src/lib/lafpos/cash-moves.ts lafposAwaitingCategory: LafPOS'un
   * açtığı, kaydı olmayan, LafPOS'un personelin kategorisiyle göndermediği harcama). Sunucu saklı gövdeden bilir, pencereye
   * satırla gelir. Personelin düzeltmesi yeni satırın kuralıyla: kategori seçilince kayıt açılır. Kaydı yöneticinin
   * kaldırdığı LafPOS satırında ve sahiplenilen elle girilmiş satırda verilmez: kayıt geri gelmez (inceleme LM-3)
   */
  lafposAwaitingCategory?: boolean;
}): boolean {
  if (o.kind !== "harcama") return false;
  if (o.admin || o.mode === "restore") return o.requested;
  if (o.mode === "edit") {
    const leftInvoice = o.prevDocType != null && isInvoiceDoc(o.prevDocType) && staffToExpenses(o.kind, o.docType) && o.awaitingInvoice !== false;
    const lafposCategory = o.lafposAwaitingCategory === true && staffToExpenses(o.kind, o.docType);
    return o.hasExpense || leftInvoice || lafposCategory;
  }
  return staffToExpenses(o.kind, o.docType);
}

/**
 * Bağlı harcama kaydı personele kapalı mı: personelin seçemediği bir kategorideyse (yöneticinin maaş, kira gibi
 * kategorisi ya da kapatılmış kategori). Personel o satırı silemez, teslime çeviremez, kategorisini değiştiremez;
 * tutarını düzeltebilir (kasadan çıkan para odur).
 */
export function staffExpenseLocked(category: { section: string; panelGroup: string; active: boolean } | null | undefined): boolean {
  return category != null && !staffCategory(category);
}

/** Silinen satırın kopyası: "Geri al" satırı ve harcama kaydını silinmeden önceki gibi geri getirir */
export interface CashOutSnapshot {
  date: string;
  kind: CashOutKind;
  amount: number;
  store: string | null;
  description: string | null;
  receiptDate: string | null;
  receiptNo: string | null;
  vat: number | null;
  docType: CashOutDocType;
  photoId: number | null;
  expense: { categoryId: number; note: string | null; description?: string | null; paymentMethod?: "nakit" | "kart" | "havale" | "diger" | null } | null;
  /**
   * Satırın şubesi: geri alınca kendi şubesine dönsün (docs/SUBE.md). Yoksa Marina'da silinen satır "Tümü"den
   * ya da Tuzla'dan geri alınınca başka şubeye geçerdi. Eski mühürlü verilerde alan yok: o zaman eski davranış.
   */
  branchId?: string | null;
}

/** "Geri al" bu kadar süre geçerli (bildirim CASH_OUT_UNDO_TOAST_MS görünür; fotoğrafı az önce bırakılmış sayma penceresiyle aynı) */
export const CASH_OUT_UNDO_MS = 15 * 60_000;
/** Silinen satırın "Geri al" bildirimi bu kadar görünür (kasadan çıkan penceresi ve personel Yardım'ı aynı sayıyı kullanır) */
export const CASH_OUT_UNDO_TOAST_MS = 8_000;

const snapshotSchema = z.object({
  date: z.string(),
  kind: z.enum(["harcama", "teslim"]),
  amount: z.number(),
  store: z.string().nullable(),
  description: z.string().nullable(),
  receiptDate: z.string().nullable(),
  receiptNo: z.string().nullable(),
  vat: z.number().nullable(),
  docType: z.enum(["fis", "e_arsiv", "fatura", "yok"]),
  photoId: z.number().int().nullable(),
  expense: z
    .object({
      categoryId: z.number().int(),
      note: z.string().nullable(),
      description: z.string().nullable().optional(),
      paymentMethod: z.enum(["nakit", "kart", "havale", "diger"]).nullable().optional(),
    })
    .nullable(),
});

const undoSchema = z.object({ v: z.literal(1), by: z.number().int(), id: z.number().int().positive(), exp: z.number(), snap: snapshotSchema });

/** Mühürlü "Geri al": silinen satırın numarası ve kopyası */
export interface CashOutUndo {
  id: number;
  snap: CashOutSnapshot;
}

/**
 * "Geri al"ın içeriği: kim sildi, ne zamana kadar, silinen satırın numarası ve kendisi. Sunucu bunu mühürler
 * (secret-box "cashout-undo"); istemci yalnız mühürlü metni geri verir, içini değiştiremez. Önceden kopya istemciden
 * olduğu gibi alınıyordu: personel hiç silmediği bir satırı faturalı, kartla ödenmiş ve istediği notla "geri getirip"
 * Aylık harcamalar'a yazdırabiliyordu (fatura Paraşüt'ten de geldiği için iki kez sayılırdı). Satır kendi numarasıyla
 * geri gelir: aynı mühür ikinci kez kopya açamaz.
 */
export function cashOutUndoJson(by: number, id: number, snap: CashOutSnapshot, now: number): string {
  return JSON.stringify({ v: 1, by, id, exp: now + CASH_OUT_UNDO_MS, snap });
}

/** Mühür açıldıktan sonra: aynı kişi ve süresi geçmemişse silinen satırın numarası ve kopyası, değilse null */
export function readCashOutUndo(json: string | null, by: number, now: number): CashOutUndo | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = undoSchema.safeParse(value);
  if (!parsed.success || parsed.data.by !== by || parsed.data.exp <= now) return null;
  return { id: parsed.data.id, snap: parsed.data.snap };
}

/**
 * Personelin Kasa'da gördüğü satır alanları (beyaz liste; docs/planlar cari §8, R9b). Ödeme bağı, tedarikçi kimliği ve
 * dağıtımlar personele gitmez; yalnız satırın bir yönetici kaydına bağlı olduğu (`locked`) söylenir. Yeni bir alan
 * eklenirse burada açıkça eklenir (tests/cari-guvenlik.test.ts anahtar kümesini sabitler).
 */
export const STAFF_CASH_OUT_FIELDS = [
  "id",
  "date",
  "kind",
  "amount",
  "store",
  "description",
  "receiptDate",
  "receiptNo",
  "vat",
  "docType",
  "photoId",
  "createdByName",
  "createdAt",
  "expenseEntryId",
  "categoryId",
  "categoryName",
  // Faz 3: satır LafPOS'un kasa hareketinden geldi (kimlik ULID; kişisel değil): tutar, tür ve gün kilitli
  "lafposId",
  // Faz 3: LafPOS'un kategorisiz yazdığı harcama, kategori seçilince Aylık harcamalar'a yazılır (yalnız işaret)
  "lafposAwaitingCategory",
] as const;

export type StaffCashOutField = (typeof STAFF_CASH_OUT_FIELDS)[number];

/** Personelin satırı: yalnız beyaz listedeki alanlar ve kilit (yöneticinin ödemesine bağlı satır) */
export function staffCashOutRow<T extends Record<StaffCashOutField, unknown>>(row: T, locked: boolean): Pick<T, StaffCashOutField> & { locked: boolean } {
  const out: Partial<Pick<T, StaffCashOutField>> = {};
  for (const k of STAFF_CASH_OUT_FIELDS) out[k] = row[k];
  return { ...(out as Pick<T, StaffCashOutField>), locked };
}

/**
 * Adın eşleşme anahtarı: faturalardaki supplierMatchKey ile aynı kural (sondaki parantez atılır, tek boşluk, Türkçe
 * küçük harf, ı → i). Kasa penceresi fatura kurallarını (ve hesap motorunu) yüklemesin diye burada; ikisinin aynı
 * kaldığını tests/cari-guvenlik.test.ts denetler.
 */
export function nameKey(name: string): string {
  return name
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i");
}

/**
 * Kasa penceresinin ad ipucu (§8): Alışveriş satırının Yer'i bir tedarikçinin adıyla (ya da diğer adıyla) eşleşiyorsa
 * o ad; personel borç ödemesini Teslim · ödeme olarak girsin diye
 */
export function supplierNameHint(store: string, names: readonly string[]): string | null {
  const key = nameKey(store);
  if (!key) return null;
  return names.find((n) => nameKey(n) === key) ?? null;
}

// ---------------------------------------------------------------- Kasadan faturalı alımlar (denetim E-42)

/**
 * Kasadan faturalı alımın faturası: fişin gününden en çok 7 gün önce ya da sonra, tutarı (Ödenecek, KDV dahil) en çok
 * 1 ₺ farklı, aynı mağazadan
 */
export const CASH_OUT_INVOICE_WINDOW = { days: 7, amount: 1 } as const;

/** Bekleyen listesinin satırı: kasadan çıkan, fatura ya da e-Arşiv, Aylık harcamalar'da kaydı yok */
export interface InvoiceCashOut {
  id: number;
  /** Kasanın günü */
  date: string;
  /** Fişin (faturanın) günü; okunmadıysa null */
  receiptDate: string | null;
  store: string | null;
  amount: number;
}

/** Eşleşme adayı fatura */
export interface CashOutInvoiceCandidate {
  id: number;
  date: string;
  supplier: string;
  payable: number;
}

/** Faturanın günü: fişte okunan gün, yoksa kasanın günü */
export const cashOutInvoiceDay = (o: Pick<InvoiceCashOut, "date" | "receiptDate">) => o.receiptDate ?? o.date;

/**
 * Kasanın yazdığı yer ile faturadaki tedarikçi aynı mağaza mı (adın anahtarıyla, nameKey): aynı ad ya da biri ötekinin
 * baştan kelimeleri ("Migros" ile "Migros Ticaret A.Ş."; en az 3 harf). Tedarikçiler'deki diğer adlar ve vergi no
 * çağıranda (aynı tedarikçi kartı) ayrıca bakılır.
 */
export function sameStoreName(store: string, supplier: string): boolean {
  const a = nameKey(store);
  const b = nameKey(supplier);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(`${short} `);
}

/**
 * Kasadan faturalı alımlar ile faturalar (saf; tests/kasa-faturali.test.ts): pencerede (±7 gün, ±1 ₺) ve aynı
 * mağazadan (`sameStore`) faturası olan satır eşleşir, olmayan bekler. Bir faturanın tek alımı olur: önce günü en
 * yakın, sonra tutarı en yakın çift, sonra küçük kimlik. Yersiz satır hiçbir faturayla eşleşmez.
 */
export function matchCashOutInvoices<O extends InvoiceCashOut, I extends CashOutInvoiceCandidate>(
  outs: readonly O[],
  invoices: readonly I[],
  sameStore: (o: O, i: I) => boolean = (o, i) => sameStoreName(o.store ?? "", i.supplier),
): { pending: O[]; matched: Map<number, number> } {
  const pairs: { o: O; i: I; days: number; diff: number }[] = [];
  for (const o of outs) {
    if (!o.store?.trim()) continue;
    const day = cashOutInvoiceDay(o);
    for (const i of invoices) {
      const days = Math.abs(daysBetween(day, i.date));
      const diff = Math.abs(i.payable - o.amount);
      if (days > CASH_OUT_INVOICE_WINDOW.days || diff > CASH_OUT_INVOICE_WINDOW.amount + 0.005) continue;
      if (sameStore(o, i)) pairs.push({ o, i, days, diff });
    }
  }
  pairs.sort((x, y) => x.days - y.days || x.diff - y.diff || x.i.id - y.i.id || x.o.id - y.o.id);
  const matched = new Map<number, number>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (matched.has(p.o.id) || used.has(p.i.id)) continue;
    matched.set(p.o.id, p.i.id);
    used.add(p.i.id);
  }
  return { pending: outs.filter((o) => !matched.has(o.id)), matched };
}

/** Bekleyen listenin yeri: Faturalar › Kontrol bekleyen, listenin başındaki kart */
export const CASH_OUT_INVOICES_HREF = "/panel/faturalar?durum=kontrol#kasa-faturali";

/** Bildirimdeki ve Bugün'deki özet: "Migros 2.400,00 ₺ (24.10)" ya da "Migros 2.400,00 ₺ ve 2 alım daha" */
export function pendingCashOutSummary(rows: readonly Pick<InvoiceCashOut, "store" | "amount" | "date" | "receiptDate">[]): string {
  if (!rows.length) return "";
  const first = rows[0];
  const head = `${first.store?.trim() || "Yeri yazılmamış alım"} ${money(first.amount)}`;
  return rows.length > 1 ? `${head} ve ${rows.length - 1} alım daha` : head;
}
