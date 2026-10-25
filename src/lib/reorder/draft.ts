/**
 * Personelin mal siparişi taslağı (docs/MAL-SIPARISI.md › Personelin sipariş taslağı; plan
 * docs/planlar/personel-yetki.md §2.4). Personel hızlı sayımdan sonra fiyatsız bir taslak hazırlar ve onaya gönderir;
 * yönetici tahmini tutarı görür, gerekirse miktarları değiştirir ve onaylar; onaylanan taslağı personel tek dokunuşla
 * gönderir (önce kayıt, sonra WhatsApp). Taslak ortak onay kuyruğunda (staff_requests, tür `mal-taslak`, konu
 * `tedarikci:<anahtar>`) bekler; tedarikçi başına tek canlı taslak (kısmi benzersiz dizin).
 *
 * Saf modül: taslağın yükü ve sonucu (zod), süre, personelin beyaz listeli görünümü, yöneticinin işaretleri, başlık ve
 * metinler. Taslak fiyatsızdır: satırlarda fiyat, tutar ya da hedef yok (tests/mal-siparisi-taslak.test.ts).
 */

import { z } from "zod";

import { businessDate, DAY_TURN_HOUR } from "../cash-report";
import { num } from "../format";
import { addDays } from "../reminders";

/** Taslağın türü (staff_requests.kind) */
export const DRAFT_KIND = "mal-taslak" as const;

/** Tedarikçinin konusu: "tedarikci:<anahtar>" */
export const draftSubject = (supplierKey: string) => `tedarikci:${supplierKey}`;

/** Bir taslakta en çok bu kadar satır */
export const DRAFT_MAX_LINES = 40;
/** Satırda en çok bu kadar sipariş birimi */
export const DRAFT_MAX_QTY = 9999;
/** Tedarikçiye not en çok bu kadar karakter */
export const DRAFT_NOTE_MAX = 300;
/** Gönderen kişi bu süre içinde "WhatsApp'ta yeniden aç" ve "Geri al" görür */
export const DRAFT_UNDO_MS = 10 * 60_000;
/** Onay bekleyen taslak bu süreden sonra (ya da hiçbir yönetici cihazına ulaşılamadıysa) "Yöneticiye haber ver" çıkar */
export const DRAFT_NUDGE_MS = 30 * 60_000;
/** Taslak güncellenince yöneticilere giden push en çok bu sıklıkta */
export const DRAFT_PUSH_MS = 15 * 60_000;

const zNum = z.number().finite();

/** Taslağın satırı: fiyatsız. Miktarlar sipariş biriminde; eldeki, geçen ve beklenen sayım biriminde */
export const DraftLine = z.object({
  ingredientId: z.number().int().positive(),
  /** Hammaddenin paneldeki adı */
  name: z.string(),
  /** Tedarikçinin ürün adı (mesajdaki) */
  orderName: z.string(),
  /** Sipariş biriminde miktar (personelin yazdığı) */
  qty: zNum.min(0),
  /** Sipariş birimi ("koli") */
  unit: z.string(),
  /** 1 sipariş biriminin içeriği, hammaddenin kendi biriminde */
  unitSize: zNum.positive(),
  /** Sayım birimi (KG, LT, ADET, DİLİM) */
  countUnit: z.string().nullable(),
  /** Önerilen birim sayısı; öneri yoksa (sayılmadı, hedef yok) null */
  suggested: zNum.min(0).nullable(),
  /** Eldeki (son sayım), sayım biriminde */
  onHand: zNum.nullable(),
  /** Bir önceki sayım ve günü (sayım biriminde) */
  prevCount: zNum.nullable(),
  prevCountDay: z.string().nullable(),
  /** Önceki sayımdan günlük kullanımla beklenen eldeki (sayım biriminde); hesaplanamazsa null */
  expectedOnHand: zNum.nullable(),
  /** Son sayımın anı (ISO) */
  countedAt: z.string().nullable(),
});
export type DraftLineT = z.infer<typeof DraftLine>;

/** staff_requests.payload (tür `mal-taslak`) */
export const DraftPayload = z.object({
  supplierKey: z.string().min(1),
  /** Tedarikçi kartının kimliği: gönderirken kart değiştiyse taslak düşer */
  supplierCardId: z.number().int().nullable(),
  supplier: z.string(),
  lines: z.array(DraftLine).min(1),
  supplierNote: z.string().nullable(),
  /** Gönderimde en az bir yönetici cihazında onay bildirimi açıktı */
  notified: z.boolean().default(false),
  /** Yöneticilere son push'un anı (ISO; taslak güncellenince en çok 15 dakikada bir) */
  pushedAt: z.string().nullable().default(null),
});
export type DraftPayloadT = z.infer<typeof DraftPayload>;

/** staff_requests.result: yöneticinin onayladığı satırlar, tedarikçiye not ve tedarikçiye gidecek mesaj */
export const DraftResult = z.object({
  approvedLines: z.array(z.object({ ingredientId: z.number().int().positive(), qty: zNum.min(0) })),
  supplierNote: z.string().nullable(),
  message: z.string(),
  /** Yönetici miktarları değiştirdi ya da satır çıkardı */
  edited: z.boolean(),
});
export type DraftResultT = z.infer<typeof DraftResult>;

export const DRAFT_TEXT = {
  admin: "Yönetici doğrudan gönderir; Mal siparişi'nden gönderin",
  noPhone: "Bu tedarikçiye yönetici gönderir",
  noSupplier: "Tedarikçi bulunamadı; sayfayı yenileyin",
  stale: "Önce hızlı sayım yapın",
  noLines: "Sipariş edilecek kalem yok",
  ownApproved: "Bu tedarikçinin onaylanmış taslağı var; önce onu gönderin",
  rejectNote: "Reddederken personele bir not yazın",
  supplierChanged: "Tedarikçi değişti; yeniden hazırlayın",
  linesChanged: "Kalemler değişti; yeniden hazırlayın",
  expired: "Süresi doldu; yeniden hazırlayın",
  sentMeanwhile: "Bu tedarikçiye bu arada sipariş gönderildi; taslak kapandı",
  notApproved: "Bu taslak onaylı değil; sayfayı yenileyin",
  undoGone: "Geri alınamaz: 10 dakika geçti, mal geldi, faturası bağlandı ya da sipariş kapandı. Yöneticiye yazın.",
  undoNotYours: "Siparişi yalnız gönderen kişi geri alır",
  superseded: "Yönetici siparişi kendisi gönderdi",
} as const;

/** Başlık (zil, sabah e-postası, Son kararlar): "Kaldi · 5 kalem" (tutarsız) */
export function draftTitle(supplier: string, lines: readonly { qty: number }[]): string {
  return `${supplier} · ${num(lines.filter((l) => l.qty > 0).length)} kalem`;
}

/**
 * Taslağın son anı: hazırlandığı (ya da onaylandığı) iş günü D ise D+2 günü 05:00 (Türkiye). Onayda yeniden
 * hesaplanır. 26 Ekim 23:00'te onaylanan taslak 28 Ekim 05:00'e (02:00Z) kadar canlıdır.
 */
export function draftDeadline(at: Date): Date {
  return new Date(`${addDays(businessDate(at), 2)}T${String(DAY_TURN_HOUR).padStart(2, "0")}:00:00+03:00`);
}

/** Canlı (bekleyen ya da onaylı) taslağın süresi doldu mu (tam son anda dolar) */
export function isDraftExpired(row: { status: string; expiresAt: Date | string | null }, now: Date): boolean {
  if (row.status !== "pending" && row.status !== "approved") return false;
  if (row.expiresAt === null) return false;
  const t = typeof row.expiresAt === "string" ? Date.parse(row.expiresAt) : row.expiresAt.getTime();
  return t <= now.getTime();
}

/** Yükü okur; bozuksa null */
export function parseDraftPayload(v: unknown): DraftPayloadT | null {
  const r = DraftPayload.safeParse(v);
  return r.success ? r.data : null;
}

export function parseDraftResult(v: unknown): DraftResultT | null {
  const r = DraftResult.safeParse(v);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------- Personelin görünümü (beyaz liste)

/** Personele giden satır: ad, sipariş adı, miktar, birim, eldeki ve öneri. Fiyat, hedef ve günlük kullanım yok */
export interface StaffDraftLine {
  ingredientId: number;
  name: string;
  orderName: string;
  qty: number;
  unit: string;
  countUnit: string | null;
  onHand: number | null;
  suggested: number | null;
}

/** Personelin taslak kartındaki durum (canlıyken süresi dolmuşsa "expired" okunur) */
export interface StaffDraftView {
  id: number;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "superseded" | "expired" | "done" | "cancelled";
  version: number;
  supplier: string;
  lines: StaffDraftLine[];
  /** Onaylanan satırlar (onaylı ve gönderilmiş taslakta); yoksa null */
  approvedLines: { ingredientId: number; orderName: string; qty: number; unit: string }[] | null;
  supplierNote: string | null;
  requestedByName: string;
  /** Taslak bu kişinin */
  mine: boolean;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** Yöneticinin personele notu (onay ya da ret) */
  reviewNote: string | null;
  /** Yönetici miktarları değiştirdi */
  edited: boolean;
  /** Gönderimde yönetici cihazına onay bildirimi gitti */
  notified: boolean;
  /** Gönderilen sipariş (tamamlandı ve geri alındı) */
  orderId: number | null;
  /** Gönderim anı ve gönderen (tamamlandı) */
  sentAt: string | null;
  sentByName: string | null;
  /** Gönderen bu kişi ve 10 dakika geçmedi: yeniden aç ve geri al */
  undoable: boolean;
}

type StaffDraftRow = {
  id: number;
  status: StaffDraftView["status"] | "revoked";
  version: number;
  payload: unknown;
  result: unknown;
  requestedBy: number | null;
  requestedByName: string;
  createdAt: Date;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  resultId: number | null;
  expiresAt: Date | null;
};

/**
 * Personelin gördüğü taslak: yük ve sonuç beyaz listeden geçer (fiyat, tutar, hedef, beklenen, mesaj, numara ve
 * bağlantı yok). Süresi dolmuş canlı taslak "expired" okunur. `sent`: gönderilen siparişin anı ve göndereni.
 */
export function staffDraftView(
  row: StaffDraftRow,
  me: { id: number },
  now: Date,
  sent: { sentAt: Date; sentBy: number | null; sentByName: string; open: boolean } | null = null,
): StaffDraftView | null {
  const p = parseDraftPayload(row.payload);
  if (!p || row.status === "revoked") return null;
  const r = parseDraftResult(row.result);
  const byId = new Map(p.lines.map((l) => [l.ingredientId, l]));
  const status = isDraftExpired(row, now) ? "expired" : row.status;
  const undoable = status === "done" && sent !== null && sent.open && sent.sentBy === me.id && now.getTime() - sent.sentAt.getTime() < DRAFT_UNDO_MS;
  return {
    id: row.id,
    status,
    version: row.version,
    supplier: p.supplier,
    lines: p.lines.map((l) => ({
      ingredientId: l.ingredientId,
      name: l.name,
      orderName: l.orderName,
      qty: l.qty,
      unit: l.unit,
      countUnit: l.countUnit,
      onHand: l.onHand,
      suggested: l.suggested,
    })),
    approvedLines: r
      ? r.approvedLines
          .filter((a) => a.qty > 0)
          .flatMap((a) => {
            const l = byId.get(a.ingredientId);
            return l ? [{ ingredientId: a.ingredientId, orderName: l.orderName, qty: a.qty, unit: l.unit }] : [];
          })
      : null,
    supplierNote: r ? r.supplierNote : p.supplierNote,
    requestedByName: row.requestedByName,
    mine: row.requestedBy === me.id,
    createdAt: row.createdAt.toISOString(),
    reviewedByName: row.reviewedByName,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    edited: r?.edited ?? false,
    notified: p.notified,
    orderId: row.resultId,
    sentAt: sent?.sentAt.toISOString() ?? null,
    sentByName: sent?.sentByName ?? null,
    undoable,
  };
}

// ---------------------------------------------------------------- Yöneticinin işaretleri

export type DraftFlagKey = "fazla" | "oneri-yok" | "dusuk-sayim" | "gec-sayim";
export interface DraftFlag {
  key: DraftFlagKey;
  text: string;
}

/** Eldeki beklenenin bu oranından azsa "Sayım beklenenden düşük" */
export const LOW_COUNT_RATIO = 0.5;
/** Satır, taslaktan bu kadar önce ve günün öteki sayımlarından bu kadar sonra sayıldıysa "Sayım taslaktan … önce değişti" */
const LATE_COUNT_BEFORE_MS = 15 * 60_000;
const LATE_COUNT_AFTER_MS = 30 * 60_000;

/**
 * Bir satırın işaretleri (yönetici, Onaylar): öneriden fazla; öneri yoktu (sayılmadı ya da hedef yok, ya da öneri 0);
 * sayım beklenenden düşük (eldeki, önceki sayımdan günlük kullanımla beklenenin yarısından az: şişirilmiş sipariş);
 * sayım taslaktan hemen önce değişti (satır günün öteki sayımlarından en az 30 dakika sonra ve taslaktan en çok 15
 * dakika önce sayıldı). `firstCountAt`: taslağın satırlarının o günkü ilk sayımı.
 */
export function draftFlags(line: Pick<DraftLineT, "qty" | "suggested" | "onHand" | "expectedOnHand" | "countedAt">, ctx: { draftAt: Date; firstCountAt: string | null }): DraftFlag[] {
  const out: DraftFlag[] = [];
  if (line.qty > 0) {
    if (line.suggested === null || line.suggested === 0) out.push({ key: "oneri-yok", text: "Öneri yoktu" });
    else if (line.qty > line.suggested) out.push({ key: "fazla", text: "Öneriden fazla" });
  }
  if (line.onHand !== null && line.expectedOnHand !== null && line.expectedOnHand > 0 && line.onHand < line.expectedOnHand * LOW_COUNT_RATIO) {
    out.push({ key: "dusuk-sayim", text: "Sayım beklenenden düşük" });
  }
  const at = line.countedAt ? Date.parse(line.countedAt) : NaN;
  const first = ctx.firstCountAt ? Date.parse(ctx.firstCountAt) : NaN;
  const before = ctx.draftAt.getTime() - at;
  if (Number.isFinite(at) && Number.isFinite(first) && before >= 0 && before <= LATE_COUNT_BEFORE_MS && at - first >= LATE_COUNT_AFTER_MS) {
    out.push({ key: "gec-sayim", text: `Sayım taslaktan ${num(Math.max(1, Math.round(before / 60_000)))} dk önce değişti` });
  }
  return out;
}

/** Taslağın satırlarının o günkü (son sayımın günü) ilk sayımı: gec-sayim işaretinin dayanağı */
export function firstCountAt(lines: readonly Pick<DraftLineT, "countedAt">[]): string | null {
  const at = lines.map((l) => (l.countedAt ? Date.parse(l.countedAt) : NaN)).filter(Number.isFinite);
  return at.length ? new Date(Math.min(...at)).toISOString() : null;
}

/** Taslak "temiz": hiçbir satırda işaret yok ve her satır önerinin aynısı ("İşaretsizleri onayla") */
export function draftClean(p: Pick<DraftPayloadT, "lines">, draftAt: Date): boolean {
  const first = firstCountAt(p.lines);
  return p.lines.every((l) => l.suggested !== null && l.qty === l.suggested && draftFlags(l, { draftAt, firstCountAt: first }).length === 0);
}

/** Yönetici miktarları değiştirdi mi (satır çıkarıldı ya da miktar farklı) */
export function draftEdited(lines: readonly Pick<DraftLineT, "ingredientId" | "qty">[], approved: readonly { ingredientId: number; qty: number }[]): boolean {
  const a = new Map(approved.map((x) => [x.ingredientId, x.qty]));
  return lines.some((l) => (a.get(l.ingredientId) ?? 0) !== l.qty) || approved.some((x) => x.qty > 0 && !lines.some((l) => l.ingredientId === x.ingredientId));
}

/** Önceki sayımdan günlük kullanımla beklenen eldeki (sayım biriminde, 0'ın altına inmez); hesaplanamazsa null */
export function expectedOnHand(prevCount: number | null, perDayCount: number | null, days: number | null): number | null {
  if (prevCount === null || perDayCount === null || days === null || days <= 0) return null;
  return Math.max(0, Math.round((prevCount - perDayCount * days) * 10) / 10);
}

/** "Yöneticiye haber ver" mesajı (tutarsız): "Mal siparişi taslağı onay bekliyor: Kaldi (5 kalem). <adres>" */
export function nudgeText(supplier: string, lineCount: number, link: string): string {
  return `Mal siparişi taslağı onay bekliyor: ${supplier} (${num(lineCount)} kalem). ${link}`;
}
