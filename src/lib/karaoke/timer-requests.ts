import { z } from "zod";

import { dayShortTR, durationLabel, timeRange, trClock } from "./session";

/**
 * Karaoke sayacının silinmesi ve oturumun bitirilmesinin saf kuralları (sunucu, ekran ve testler paylaşır; denetim
 * E-15 ve E-65; docs/KARAOKE.md › Sayacı silmek, bitirmek, geri açmak). Personel panelden açılan sayacı açılışından
 * sonraki ilk 10 dakikada doğrudan siler (yanlış açılan sayaç); sonrası yöneticinin onayına gider (staff_requests, tür
 * `karaoke-sil`). Sitenin rezervasyonu panelden silinmez. Yönetici her sayacı doğrudan siler. "Bitti" ve "Geri aç"
 * işlem geçmişine yazılır; iptal edilmiş ya da süresi dolmuş oturum yeniden açılmaz. Hiçbir metinde tutar yok.
 * Testler: tests/karaoke-istek.test.ts, tests/karaoke-istek-db.test.ts.
 */

/** Personelin sayacı doğrudan silebildiği süre: açılıştan bu kadar dakika (sonrası yöneticinin onayıyla) */
export const KARAOKE_DELETE_FREE_MINUTES = 10;

export type KaraokeDeleteMode = "direct" | "request" | "none";

/**
 * Bu kişi bu oturumu nasıl siler: sitenin rezervasyonu hiç (sitede yönetilir); yönetici panel sayacını doğrudan;
 * personel açılıştan sonraki ilk 10 dakikada doğrudan, sonra istekle. Saat sunucunun (ekranda canlı ucun saati).
 */
export function karaokeDeleteMode(s: { source: "site" | "panel"; startsAt: string | Date }, role: "admin" | "staff", nowMs: number): KaraokeDeleteMode {
  if (s.source !== "panel") return "none";
  if (role === "admin") return "direct";
  const start = typeof s.startsAt === "string" ? Date.parse(s.startsAt) : s.startsAt.getTime();
  return nowMs - start < KARAOKE_DELETE_FREE_MINUTES * 60_000 ? "direct" : "request";
}

/** Ortak metinler (personele de görünür; tutar yok) */
export const KARAOKE_REQUEST_TEXT = {
  siteOnly: "Yalnızca panelden açılan sayaç silinebilir",
  gone: "Oturum bulunamadı; sayfayı yenileyin",
  askOnly: `Sayacın açılışından ${KARAOKE_DELETE_FREE_MINUTES} dakika geçti; silinmesi yöneticinin onayıyla. Nedenini yazıp silinmesini isteyin`,
  useDirect: `Bu sayacı kendiniz silebilirsiniz (açılıştan sonraki ilk ${KARAOKE_DELETE_FREE_MINUTES} dakika); istek gerekmez`,
  messageShort: "Açıklama en az 3 karakter olmalı",
  deleteAsk: "Silinmesini iste",
  reasonLabel: "Neden?",
  pending: "Silinmesi onay bekliyor",
  /** Satırda "Geri aç"ın yanında durur: tek kelimeyle ayrışmasın */
  withdraw: "İsteği geri çek",
  /** Doğrudan silme ya da onay aynı sayacın öteki bekleyen isteklerini bu notla kapatır */
  deleted: "Sayaç silindi",
  /** Onayda sayaç yoksa istek bu notla kapanır, hiçbir şey silinmez */
  alreadyGone: "Sayaç zaten silinmişti",
  cancelledReopen: "İptal edilmiş oturum yeniden açılamaz",
  pastReopen: "Süresi dolmuş oturum yeniden açılamaz",
} as const;

/**
 * Silme isteğinin yükü (staff_requests.payload): sayacın istendiği andaki zamanları ve kimin açtığı. Etiket (misafirin
 * adı olabilir) yüke yazılmaz: oturumun kendisinden okunur, 3 × 366 günlük temizlik onu boşaltır, istek tutmaz.
 */
export const KaraokeDeletePayload = z.object({
  sessionId: z.number().int().positive(),
  /** ISO */
  startsAt: z.string(),
  endsAt: z.string(),
  extraMinutes: z.number().int(),
  guests: z.number().int().nullable(),
  endedAt: z.string().nullable(),
  endedBy: z.string().nullable(),
  createdBy: z.string().nullable(),
});
export type KaraokeDeletePayloadT = z.output<typeof KaraokeDeletePayload>;

const endMs = (p: { endsAt: string; extraMinutes: number }) => Date.parse(p.endsAt) + p.extraMinutes * 60_000;

/** "24 Eki 21:00–23:00" (uzatmalar dahil bitiş) */
export function sessionWhen(p: { startsAt: string; endsAt: string; extraMinutes: number }): string {
  const start = Date.parse(p.startsAt);
  return `${dayShortTR(trClock(start).date)} ${timeRange(start, endMs(p))}`;
}

/** İsteğin başlığı (tutarsız, adsız; zil, sabah e-postası, Son kararlar): "Karaoke sayacı silme · 24 Eki 21:00–23:00" */
export function karaokeDeleteTitle(p: { startsAt: string; endsAt: string; extraMinutes: number }): string {
  return `Karaoke sayacı silme · ${sessionWhen(p)}`;
}

/**
 * Ekrandaki ad: etiket, yoksa "Rezervasyonsuz oturum" (sayaç) ya da "İsimsiz rezervasyon" (site). Cümlenin öznesi olur
 * ("Rezervasyonsuz oturum bitirildi"; denetim UI-07), zildeki adla aynı
 */
export const sessionName = (s: { customerName: string | null; source: "site" | "panel" }) =>
  s.customerName || (s.source === "panel" ? "Rezervasyonsuz oturum" : "İsimsiz rezervasyon");

/**
 * "Bitti"nin işlem geçmişi ayrıntısı: oturum, planlanan bitiş ve ne olduğu. Erken bitirme kaç dakika erken olduğunu,
 * süre dolduktan sonra "Haber verdim" o anı, başlamadan bitirme bunu söyler.
 */
export function endedLogDetail(s: { customerName: string | null; source: "site" | "panel"; startsAt: Date; endsAt: Date; extraMinutes: number }, now: Date): string {
  const when = sessionWhen({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), extraMinutes: s.extraMinutes });
  const end = s.endsAt.getTime() + s.extraMinutes * 60_000;
  const at = trClock(now.getTime()).time;
  const what =
    now.getTime() < s.startsAt.getTime()
      ? `başlamadan bitirildi ${at}`
      : now.getTime() < end
        ? `bitirildi ${at} (${durationLabel(Math.ceil((end - now.getTime()) / 60_000))} erken)`
        : `süre dolunca haber verildi ${at}`;
  return `${sessionName(s)} · ${when} · ${what}`;
}

/** "Geri aç"ın ayrıntısı: kimin ne zaman bitirdiği (temizlenmeden önce okunur) */
export function reopenLogDetail(s: { customerName: string | null; source: "site" | "panel"; startsAt: Date; endsAt: Date; extraMinutes: number; endedAt: Date | null; endedBy: string | null }): string {
  const when = sessionWhen({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), extraMinutes: s.extraMinutes });
  const ended = s.endedAt ? `${s.endedBy ?? "Biri"} bitirmişti (${trClock(s.endedAt.getTime()).time})` : "bitirilmemişti";
  return `${sessionName(s)} · ${when} · ${ended}`;
}

/** Silinen sayacın işlem geçmişi ayrıntısı: "Mehmet · 24 Eki 21:00–23:00 · Ayşe açmıştı" */
export function deletedLogDetail(s: { customerName: string | null; source: "site" | "panel"; startsAt: Date; endsAt: Date; extraMinutes: number; createdBy: string | null }): string {
  const when = sessionWhen({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), extraMinutes: s.extraMinutes });
  return [sessionName(s), when, s.createdBy ? `${s.createdBy} açmıştı` : null].filter(Boolean).join(" · ");
}

/**
 * "Geri aç" yapılabilir mi (null: evet): iptal edilmiş (iade edilen, ödemesi düşen) oturum açılmaz; uzatmalar dahil
 * bitişi geçmiş oturum da açılmaz (açılsa süre doldu alarmı çalardı). Ekran düğmeyi aynı kuralla gösterir.
 */
export function reopenRefusal(
  s: { status: string; paymentStatus: string; endsAt: Date | string; extraMinutes: number },
  nowMs: number,
): string | null {
  if (s.status === "cancelled" || s.paymentStatus === "refunded" || s.paymentStatus === "expired") return KARAOKE_REQUEST_TEXT.cancelledReopen;
  const end = (typeof s.endsAt === "string" ? Date.parse(s.endsAt) : s.endsAt.getTime()) + s.extraMinutes * 60_000;
  return end <= nowMs ? KARAOKE_REQUEST_TEXT.pastReopen : null;
}

/**
 * Onaya gidebilir mi (yalnız sayaç ve süresinden sonra): yoksa ret metni. Silme isteği açılırken ve ekranda aynı kural.
 */
export function deleteRequestRefusal(mode: KaraokeDeleteMode): string | null {
  return mode === "none" ? KARAOKE_REQUEST_TEXT.siteOnly : mode === "direct" ? KARAOKE_REQUEST_TEXT.useDirect : null;
}

/** Personelin zilinde kendi isteğinin sonucu: "Silme onaylandı: karaoke sayacı 24 Eki 21:00–23:00" */
export function staffKaraokeResult(o: { status: "approved" | "rejected" | "superseded" | "expired"; when: string; note: string | null }): { title: string; body: string } {
  const what = `karaoke sayacı ${o.when}`;
  if (o.status === "superseded") return { title: `İstek kapandı: ${what}`, body: o.note ?? KARAOKE_REQUEST_TEXT.deleted };
  const verb = o.status === "approved" ? "onaylandı" : o.status === "rejected" ? "reddedildi" : "süresi doldu";
  return {
    title: `Silme ${verb}: ${what}`,
    body: o.note ? `Not: ${o.note}` : o.status === "approved" ? "Sayaç listeden çıktı" : "Yönetici not yazmadı",
  };
}

/** Bekleyen silme isteği (canlı uç; ekranın satırı): kimin istediği ve isteğin sürümü. Yük ve neden yok */
export interface KaraokeDeleteAsk {
  sessionId: number;
  requestId: number;
  by: string;
  byId: number | null;
}
