import { z } from "zod";

import { businessDate, staffDayEditable } from "./cash-report";
import { shortDayTR } from "./cash-requests";
import { num } from "./format";
import { addDays, monthShortTR } from "./reminders";
import { qtyText, type WasteKind } from "./waste";

/**
 * Geç zayi / ikram ve silme isteği (saf; plan docs/planlar/personel-yetki.md §2.8; docs/ZAYI-IKRAM.md › Geç kayıt ve
 * silme isteği). Personelin doğrudan yolu bugün ve dün; dün, o günün kasa raporu kilitlenene kadar (bugünün raporu da
 * girildiyse; kasanın kuralı staffDayEditable). Dünden önceki 14 güne ve kilitli düne kayıt, başkasının ya da kilitli
 * günün kaydının silinmesi yöneticinin onayına gider (staff_requests, türler `zayi-gec` ve `zayi-sil`). Personele
 * giden hiçbir metinde tutar yok. Testler: tests/zayi-istek.test.ts.
 */

/** Geç kayıt penceresi: dünden önceki günler bugünden en çok bu kadar geriye (bugün 24 ise 10'u dahil) */
export const LATE_WINDOW_DAYS = 14;

/** Günün kasa kilidi: o günün raporu var mı, sonraki bir günün raporu var mı (ikisi de varsa gün kapandı) */
export interface WasteLock {
  hasReport: boolean;
  laterReport: boolean;
}

export type WasteMode = "direct" | "request" | "closed";

/**
 * Personel bu güne nasıl yazar: doğrudan (bugün; dün kilitlenene kadar), istek (kilitli dün ve dünden önceki 14 gün)
 * ya da hiç (ileri gün, 14 günden eski). Yönetici her güne doğrudan yazar (bu kural yalnız personel için).
 */
export function staffWasteMode(date: string, now: Date, lock: WasteLock): WasteMode {
  const today = businessDate(now);
  if (date > today) return "closed";
  if (staffDayEditable(date, lock, now)) return "direct";
  return date >= addDays(today, -LATE_WINDOW_DAYS) ? "request" : "closed";
}

export type WasteDeleteMode = "direct" | "request" | "none";

/**
 * Personel bu kaydı nasıl siler: kendi kaydını doğrudan yolun günlerinde doğrudan; başkasının kaydını ya da kilitli
 * günün kaydını istekle; 14 günden eski kaydı hiç. Sunucuda hesaplanır, satıra prop olarak gider.
 */
export function staffDeleteMode(entry: { date: string; createdBy: number | null }, me: { id: number }, now: Date, lock: WasteLock): WasteDeleteMode {
  const mode = staffWasteMode(entry.date, now, lock);
  if (mode === "closed") return "none";
  return mode === "direct" && entry.createdBy === me.id ? "direct" : "request";
}

/** "Önceki gün" seçicisinin günleri: dünden önceki 13 gün, yeniden eskiye (bugün 24 ise 22 … 10) */
export function lateWasteDays(now: Date): string[] {
  const today = businessDate(now);
  return Array.from({ length: LATE_WINDOW_DAYS - 1 }, (_, i) => addDays(today, -(i + 2)));
}

/** Seçicinin ve kartın kısa günü: "22 Eki Per" */
export const wasteDayLabel = (day: string) => shortDayTR(day);

/** "15 Eki" (başlık ve zil) */
const dayShort = (day: string) => `${Number(day.slice(8, 10))} ${monthShortTR(day)}`;

/** Kalem ve miktar: ürün "2× Latte M", hammadde "Süt 1,5 LT" */
export function wasteItemText(w: { name: string; qty: number; unit: string }): string {
  return w.unit === "adet" ? `${num(w.qty, 3)}× ${w.name}` : `${w.name} ${qtyText(w.qty, w.unit)}`;
}

const KIND_WORD: Record<WasteKind, string> = { zayi: "zayi", ikram: "ikram" };
const KIND_CAP: Record<WasteKind, string> = { zayi: "Zayi", ikram: "İkram" };

/** İsteğin başlığı (tutarsız): "Geç zayi: 2× Latte M · 15 Eki" */
export function lateWasteTitle(p: { kind: WasteKind; name: string; qty: number; unit: string; date: string }): string {
  return `Geç ${KIND_WORD[p.kind]}: ${wasteItemText(p)} · ${dayShort(p.date)}`;
}

/** Silme isteğinin başlığı: "Zayi silme: Süt 1,5 LT · 15 Eki" */
export function wasteDeleteTitle(p: { kind: WasteKind; name: string; qty: number; unit: string; date: string }): string {
  return `${KIND_CAP[p.kind]} silme: ${wasteItemText(p)} · ${dayShort(p.date)}`;
}

/** Ortak metinler (personele de görünür; tutar yok) */
export const WASTE_REQUEST_TEXT = {
  windowOld: "Bu gün 14 günden eski; yalnız yönetici girer",
  backToday: "Bugüne dön",
  lateTitle: "Geç kayıt isteği",
  lateHint: "Bu güne kayıt yöneticinin onayıyla girer. Onaylanınca listeye eklenir.",
  messageLabel: "Yöneticiye açıklama",
  send: "Onaya gönder",
  sameRequest: "Aynı istek bekliyor; miktarı birleştirmek için geri çekip yeniden gönderin",
  useDirect: "Bu güne doğrudan girebilirsiniz; istek gerekmez",
  directOnly: "Personel doğrudan yalnız bugüne ya da düne (kasa raporu girilene kadar) kayıt girer; önceki günler için geç kayıt isteği gönderin",
  deleteOnly: "Bu kaydı yalnız giren kişi bugün ya da dün (kasa raporu girilene kadar) siler; öteki durumda silinmesini isteyin",
  deleteDirect: "Bu kaydı kendiniz silebilirsiniz; istek gerekmez",
  deleteOld: "Bu kayıt 14 günden eski; yalnız yönetici siler",
  deleteAsk: "Silinmesini iste",
  reasonLabel: "Neden?",
  pending: "Onay bekliyor",
  withdraw: "Geri çek",
  gone: "Kayıt zaten silinmişti",
  deleted: "Kayıt silindi",
  messageShort: "Açıklama en az 3 karakter olmalı",
} as const;

/** Geç kayıt isteğinin yükü (staff_requests.payload): kalem istek anındaki adı, birimi ve çarpanıyla */
export const LateWastePayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["zayi", "ikram"]),
  productId: z.number().int().positive().nullable(),
  ingredientId: z.number().int().positive().nullable(),
  name: z.string().min(1),
  unit: z.string().min(1),
  factor: z.number().positive(),
  qty: z.number().positive(),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  /**
   * İsteğin açıldığı şube (docs/SUBE.md). Onay anındaki seçim değil, personelin kaydı girdiği şube esastır:
   * yönetici "Tümü"den onaylayınca Marina'nın zayisi Tuzla'ya yazılmasın. Dalga 3'ten ÖNCE kaydedilmiş
   * isteklerde alan yok, bu yüzden isteğe bağlı: eskiler onayda varsayılan şubeye düşer.
   */
  branchId: z.string().nullish().transform((v) => v ?? null),
});
export type LateWastePayloadT = z.output<typeof LateWastePayload>;

/** Silme isteğinin yükü: kaydın istendiği andaki hâli (onayda satırla karşılaştırılır) */
export const WasteDeletePayload = z.object({
  entryId: z.number().int().positive(),
  entry: z.object({
    date: z.string(),
    kind: z.enum(["zayi", "ikram"]),
    name: z.string(),
    qty: z.number(),
    unit: z.string(),
    reason: z.string().nullable(),
    note: z.string().nullable(),
    createdBy: z.number().int().nullable(),
    createdByName: z.string(),
    /** ISO */
    createdAt: z.string(),
  }),
});
export type WasteDeletePayloadT = z.output<typeof WasteDeletePayload>;

/**
 * Silme isteğindeki kayıt hâlâ aynı kayıt mı: gün, tür, ad, miktar, birim, giren ve an tutmalı (neden ve not
 * değişebilir). Tutmazsa istek "Kayıt zaten silinmişti" diye kapanır, hiçbir şey silinmez.
 */
export function wasteEntryMatches(
  snap: WasteDeletePayloadT["entry"],
  row: { date: string; kind: string; name: string; qty: number; unit: string; createdBy: number | null; createdAt: Date; reason?: string | null; note?: string | null },
): boolean {
  return (
    snap.date === row.date &&
    snap.kind === row.kind &&
    snap.name === row.name &&
    Math.abs(snap.qty - row.qty) < 1e-9 &&
    snap.unit === row.unit &&
    snap.createdBy === row.createdBy &&
    new Date(snap.createdAt).getTime() === row.createdAt.getTime()
  );
}

/** Personelin zilinde kendi isteğinin sonucu: "Geç kayıt onaylandı: 2× Latte M (15 Eki)" */
export function staffWasteResult(o: {
  kind: "zayi-gec" | "zayi-sil";
  status: "approved" | "rejected" | "superseded" | "expired";
  item: string;
  day: string;
  note: string | null;
}): { title: string; body: string } {
  const what = `${o.item} (${dayShort(o.day)})`;
  const head = o.kind === "zayi-gec" ? "Geç kayıt" : "Silme";
  const verb = o.status === "approved" ? "onaylandı" : o.status === "rejected" ? "reddedildi" : o.status === "expired" ? "süresi doldu" : "kapandı";
  const title = o.status === "superseded" ? `İstek kapandı: ${what}` : `${head} ${verb}: ${what}`;
  const body =
    o.status === "superseded"
      ? (o.note ?? WASTE_REQUEST_TEXT.gone)
      : o.note
        ? `Not: ${o.note}`
        : o.status === "approved"
          ? o.kind === "zayi-gec"
            ? "Kayıt listeye eklendi"
            : "Kayıt listeden çıktı"
          : "Yönetici not yazmadı";
  return { title, body };
}

/** Kaydın sahibine: başkasının isteğiyle silindi */
export function wasteDeletedNotice(o: { item: string; day: string; by: string }): string {
  return `Kaydınız silindi: ${o.item} (${dayShort(o.day)}) · ${o.by} istedi`;
}

/** İşlem geçmişinin ayrıntısı: "Latte M 2 adet · 15 Ekim · Döküldü / kırıldı · not" (nedenin ilk 200 karakteri) */
export function wasteRequestLog(o: { name: string; qty: number; unit: string; dayText: string; reason: string | null; message: string | null }): string {
  return [`${o.name} ${qtyText(o.qty, o.unit)}`, o.dayText, o.reason, o.message ? o.message.trim().slice(0, 200) : null].filter(Boolean).join(" · ");
}
