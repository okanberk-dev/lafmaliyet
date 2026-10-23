/**
 * Gün içinde kasadan çıkanlar (saf; tests/fotograf-okuma.test.ts): satır adları, akşam raporunun "Neye çıktı" notu,
 * raporla satırların tutmadığı uyarısı ve personelin kuralları. Kayıtlar cash_outs tablosunda; ekran
 * src/app/panel/kasa/cash-outs.tsx, eylemler src/server/actions/cash-outs.ts.
 */

import { z } from "zod";

import { money } from "./format";

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
 * e-Arşiv hayır (Paraşüt'ten de gelir, iki kez sayılmasın; yönetici bakar); teslim hiçbir zaman.
 */
export function staffToExpenses(kind: CashOutKind, docType: CashOutDocType): boolean {
  return kind === "harcama" && (docType === "fis" || docType === "yok");
}

/** Satırın kaydedilişi: yeni satır, düzeltme ya da silinenin geri alınması */
export type CashOutSaveMode = "new" | "edit" | "restore";

/**
 * Satırın Aylık harcamalar kaydı olacak mı. Yönetici anahtarla seçer. Personel yalnız satırı eklerken kurala göre
 * (staffToExpenses); düzeltmede kaydın şimdiki hâli kalır: yöneticinin Aylık harcamalar'dan sildiği kayıt geri gelmez,
 * faturaya açtığı kayıt silinmez. Geri almada ikisinde de silinen satırdaki gibi. Teslimin kaydı olmaz.
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
}): boolean {
  if (o.kind !== "harcama") return false;
  if (o.admin || o.mode === "restore") return o.requested;
  if (o.mode === "edit") return o.hasExpense;
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
}

/** "Geri al" bu kadar süre geçerli (bildirim 8 sn görünür; fotoğrafı az önce bırakılmış sayma penceresiyle aynı) */
export const CASH_OUT_UNDO_MS = 15 * 60_000;

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
