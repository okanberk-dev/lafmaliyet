import type { Role } from "@/lib/constants";
import { staffSiteText } from "@/lib/staff-errors";

import type { CallReason, SiteCall } from "./schema";
import { isStageSetupFailure, type StageFailure } from "./stage";

/**
 * Masa çağrıları ("Garson çağır"; laffogato.net'in sipariş listesine 6 Kas 2026'da eklenen `calls`): kartın metinleri,
 * açık çağrılar, zil kuralı, bildirim metni ve "Gördüm" düğmesinin sonucu (saf, zod'suz: ekranın paketine girer;
 * sunucu ve testler de paylaşır). Sözleşme sitenin docs/PANEL-ORDERS.md'si, panel tarafı docs/SITE-SIPARIS.md.
 *
 * KVKK: çağrıda müşteriye dair hiçbir şey yok (masa, sebep, an). "Gördüm" siteye yalnız çağrının kimliğini ve panel
 * kullanıcısının adını gönderir (`{"id","actor"}`).
 */

/** Sitenin "Gördüm" ucu (imzalı, aşama ucuyla aynı kural) */
export const CALL_ACK_PATH = "/api/panel/calls/ack";

/** Site yalnız bundan yeni açık çağrıları gönderir; panel de eski kopyadaki daha eski çağrıyı göstermez ve çalmaz */
export const CALL_OPEN_MS = 15 * 60_000;

/** Kartın sebep satırı; bilinmeyen sebep genel "Çağırıyor" */
export const CALL_REASON_TEXT: Record<CallReason, string> = {
  waiter: "Garson çağırıyor",
  water: "Su istiyor",
  napkin: "Peçete istiyor",
  other: "Çağırıyor",
};

export function callReasonText(reason: CallReason | string | null | undefined): string {
  return CALL_REASON_TEXT[reason as CallReason] ?? CALL_REASON_TEXT.other;
}

/**
 * Hâlâ açık sayılan çağrılar: son 15 dakikada açılmış (sitenin süresi dolan çağrısı pingsiz kalkar; son listenin
 * kopyası bir sonraki çekmeye kadar eski kalabilir). En eski önde: en uzun bekleyen masa önce.
 */
export function openCalls<T extends Pick<SiteCall, "createdAt">>(calls: readonly T[] | null | undefined, nowMs: number): T[] {
  return (calls ?? [])
    .filter((c) => {
      const at = Date.parse(c.createdAt);
      return Number.isFinite(at) && nowMs - at < CALL_OPEN_MS;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** "az önce", "3 dk önce" */
export function callAgeLabel(createdAt: string, nowMs: number): string {
  const at = Date.parse(createdAt);
  const min = Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 60_000)) : 0;
  return min < 1 ? "az önce" : `${min} dk önce`;
}

/** Ekranda görünen her şeyin özeti: aynıysa çağrılar değişmemiştir (sürüm artmaz) */
export function callsFingerprint(calls: readonly SiteCall[]): string {
  return JSON.stringify(calls.map((c) => [c.id, c.tableCode, c.label, c.reason, c.createdAt]));
}

/**
 * Önceki listede olmayan çağrılar (sunucunun bildirimi için). Önceki liste hiç yoksa (panelin ilk çekmesi ya da
 * çağrılardan önce yazılmış kopya) hiçbiri yeni sayılmaz.
 */
export function newCallIds(prev: readonly Pick<SiteCall, "id">[] | null, next: readonly Pick<SiteCall, "id">[]): string[] {
  if (!prev) return [];
  const known = new Set(prev.map((c) => c.id));
  return next.filter((c) => !known.has(c.id)).map((c) => c.id);
}

/**
 * Bu ekranın çalacağı çağrılar: bu cihazın görmediği her açık çağrı bir kez. İlk yüklemede (`first`) iki dakikadan
 * eski çağrılar sessizce görülmüş sayılır (kartı zaten ekranda). Süresi dolmuş çağrı çalmaz.
 */
export function callsToRing<T extends Pick<SiteCall, "id" | "createdAt">>(
  calls: readonly T[] | null | undefined,
  seen: ReadonlySet<string>,
  opts: { first: boolean; nowMs: number; freshMs?: number },
): { ring: T[]; markSeen: string[] } {
  const fresh = opts.freshMs ?? 120_000;
  const unseen = (calls ?? []).filter((c) => !seen.has(c.id));
  const ring = openCalls(unseen, opts.nowMs).filter((c) => !opts.first || opts.nowMs - Date.parse(c.createdAt) <= fresh);
  return { ring, markSeen: unseen.map((c) => c.id) };
}

/** Zil ve bildirim metni: "Masa 4 · Su istiyor"; birden çoksa "2 masa çağrısı" ve masalar */
export function callRingMessage(calls: readonly Pick<SiteCall, "label" | "reason">[]): { title: string; body: string } {
  if (!calls.length) return { title: "", body: "" };
  const line = (c: Pick<SiteCall, "label" | "reason">) => `${c.label} · ${callReasonText(c.reason)}`;
  if (calls.length === 1) return { title: line(calls[0]), body: "Masa çağrısı" };
  return { title: `${calls.length} masa çağrısı`, body: calls.map(line).join(", ") };
}

/** "Gördüm" başarılı: "Masa 4 · görüldü" */
export function callAckDoneMessage(label: string | null | undefined): string {
  return `${label || "Masa"} · görüldü`;
}

/** Çağrı sitede artık açık değil (başka cihaz gördü ya da süresi doldu): ekran yenilendi */
export function callGoneMessage(label: string | null | undefined): string {
  return `${label || "Masa"} · çağrı zaten kapanmış`;
}

/** 2xx ama yanıt okunamadı: çağrı büyük olasılıkla görüldü, liste yeniden çekildi */
export const CALL_UNREADABLE_MESSAGE = "Sitenin yanıtı okunamadı; ekran yenilendi, çağrının kalkıp kalkmadığına bakın.";

/** Personelin "Gördüm"de gördüğü kurulum hatası: anahtar adı, imza ve sitenin sürümü yalnız yöneticiye (E-64) */
export const CALL_STAFF_ERROR = staffSiteText("çağrı işaretlenmedi");

/**
 * "Gördüm" olmayınca gösterilen metin. Personel kurulum hatasında sabit metni görür; yönetici ayrıntıyı. Hata türleri
 * aşama ucuyla aynı (`StageFailure`). Aynı çağrıyı yeniden işaretlemek güvenli: site aynı yanıtı verir.
 */
export function callAckFailureMessage(failure: StageFailure, role: Role = "admin"): string {
  if (role !== "admin" && isStageSetupFailure(failure)) return CALL_STAFF_ERROR;
  if (failure.kind === "off") return "laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)";
  if (failure.kind === "timeout") return "Site 8 saniyede yanıt vermedi; tekrar deneyin.";
  if (failure.kind === "network") return "Siteye ulaşılamadı; tekrar deneyin.";
  switch (failure.status) {
    case 400:
      return "Site isteği kabul etmedi; panel güncel olmayabilir.";
    case 401:
      return "İmza reddedildi: iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?";
    case 404:
      // Uç varsa site JSON ve `error` döner (bulunamadı: eylem onu "zaten kapanmış" sayar); yoksa Next'in 404 sayfası
      return failure.error ? "Çağrı sitede bulunamadı; ekran yenilendi." : "Sitede masa çağrısı ucu yok (laffogato.net güncel değil)";
    case 413:
      return "Site isteği çok büyük buldu; çağrı işaretlenmedi.";
    case 503:
      return failure.error === "not_configured"
        ? "Sitede KARAOKE_SYNC_SECRET tanımlı değil; çağrı işaretlenmedi."
        : "Sitenin veritabanı şu an okunamıyor; tekrar deneyin.";
    default:
      return `Site yanıt vermedi (HTTP ${failure.status}); tekrar deneyin.`;
  }
}
