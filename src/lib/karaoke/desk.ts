import { z } from "zod";

import { addDays, isCalendarDate } from "@/lib/reminders";

import { KARAOKE_DELETE_FREE_MINUTES } from "./timer-requests";
import { dayShortTR, timeRange, trClock, type DeskKind, type KaraokeStatus, type SiteReservation } from "./session";
import { DESK_BLOCK_NOTE_PREFIX, parseSiteReservation } from "./site";
import { karaokePullError } from "./sync-text";

/**
 * Elle karaoke rezervasyonu ve saati kapatma (saf; sunucu, ekran ve testler paylaşır: tests/karaoke-elle.test.ts).
 * Operatör, 22 Kasım 2026: "Ladminden de girilebilsin aynı şekilde". Bar, telefonla ya da kasada gelen grubu ya da
 * köşkün kapattığı saatleri (etkinlik, bakım) laffogato.net'in odasının takvimine yazar: saatler sitede, uygulamada ve
 * kasada hemen dolu görünür. Panel bunu kendisi tutmaz; sitenin imzalı `POST /api/panel/karaoke` ucuna gönderir
 * (sitedeki kural src/lib/mobile/karaoke-desk.ts, sözleşme laffogato `docs/PANEL-KARAOKE.md` › Elle rezervasyon ve
 * kapalı saat), satır panele her zamanki eşitlemeyle gelir. Telefon ve e-posta yalnız siteye gider: panel onları
 * saklamaz, yazmaz, işlem geçmişine koymaz (sitenin GET'i de göndermez). Ayrıntı: docs/KARAOKE.md › Elle rezervasyon ve
 * saati kapatma.
 */

export type { DeskKind };

/** Formun alanları (sitenin hata yanıtındaki `field` bunlara eşlenir) */
export type DeskField = "kind" | "date" | "startHour" | "hours" | "guests" | "name" | "phone" | "email" | "note";

/** Bugünden bu kadar gün sonrasına kadar (sitenin rezervasyon penceresi daha kısaysa site söyler) */
export const DESK_DAYS_AHEAD = 60;
/** Personel elle satırı yazıldıktan sonraki bu kadar dakikada kaldırır (sayaç silmenin kuralı); sonrası yönetici */
export const DESK_REMOVE_FREE_MINUTES = KARAOKE_DELETE_FREE_MINUTES;

const NAME_MAX = 60;
const NOTE_MAX = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sunucu eyleminin girdisi. Yapısal sınırlar burada; odanın saatleri, kapasite ve rezervasyon penceresi sitenin
 * kuralıdır (site Türkçe mesajla reddeder, mesaj alanın yanında gösterilir).
 */
export const deskInputSchema = z
  .object({
    kind: z.enum(["booking", "block"]),
    date: z.string().refine(isCalendarDate, "Geçerli bir gün seçin"),
    startHour: z.number().int("Başlangıç tam saat olmalı").min(0).max(23, "Başlangıç en geç 23:00"),
    hours: z.number().int("Süre tam saat olmalı").min(1, "Süre en az 1 saat").max(24),
    guests: z.number().int().min(1, "Kişi sayısı en az 1").max(100, "Kişi sayısı en çok 100").nullish(),
    name: z.string().trim().max(NAME_MAX, "Ad en çok 60 karakter").default(""),
    phone: z
      .string()
      .trim()
      .max(30)
      .default("")
      .transform((v) => v.replace(/[^\d+ ]/g, "").slice(0, 20)),
    email: z.string().trim().toLowerCase().max(120, "E-posta çok uzun").default(""),
    note: z.string().trim().max(NOTE_MAX, "Not en çok 300 karakter").default(""),
  })
  .superRefine((v, ctx) => {
    if (v.startHour + v.hours > 24) ctx.addIssue({ code: "custom", path: ["hours"], message: "Bitiş en geç 24:00" });
    if (v.kind === "booking" && !v.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Misafirin adını yazın" });
    if (v.kind === "booking" && !v.guests) ctx.addIssue({ code: "custom", path: ["guests"], message: "Kişi sayısını yazın" });
    if (v.kind === "booking" && v.email && !EMAIL_RE.test(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "E-posta adresi geçersiz" });
  });

export type DeskInput = z.input<typeof deskInputSchema>;
export type DeskData = z.output<typeof deskInputSchema>;

/** Zod hatasının ilk alanı ve metni (formun alanına) */
export function deskIssue(e: z.ZodError): { field: DeskField | null; message: string } {
  const issue = e.issues[0];
  const key = issue?.path[0];
  const field = typeof key === "string" && (FIELDS as readonly string[]).includes(key) ? (key as DeskField) : null;
  return { field, message: issue?.message ?? "Geçersiz bilgi" };
}

const FIELDS: readonly DeskField[] = ["kind", "date", "startHour", "hours", "guests", "name", "phone", "email", "note"];

/** Türkiye saatiyle bugün ve günün dakikası (formun seçenekleri ve sunucunun denetimi aynı saate bakar) */
export function deskNow(ms: number): { today: string; minutes: number } {
  const { date, time } = trClock(ms);
  const [h, m] = time.split(":").map(Number);
  return { today: date, minutes: h * 60 + m };
}

/**
 * Günün ve saatin panelin bildiği kuralı (sunucu, siteye gitmeden önce; form da aynı sınırları seçeneklerinde uygular):
 * bugünden 60 gün sonrasına kadar; bugün bitmiş saat seçilemez (başlamış ama bitmemiş saat seçilir: o saate elle
 * eklenen rezervasyonun sayacı hemen başlar). Yoksa null.
 */
export function deskWhenProblem(d: Pick<DeskData, "date" | "startHour" | "hours">, now: { today: string; minutes: number }): { field: DeskField; message: string } | null {
  if (d.date < now.today) return { field: "date", message: "Geçmiş bir gün seçilemez" };
  if (d.date > addDays(now.today, DESK_DAYS_AHEAD)) return { field: "date", message: `En çok ${DESK_DAYS_AHEAD} gün sonrası seçilebilir` };
  if (d.date === now.today && (d.startHour + d.hours) * 60 <= now.minutes) return { field: "startHour", message: "Bu saatler bugün geçti" };
  return null;
}

/** Sitenin POST gövdesi: tam bu metin imzalanır ve gönderilir (src/server/site-link.ts › signedSiteFetch) */
export function deskCreateBody(d: DeskData, actor: string): string {
  const block = d.kind === "block";
  return JSON.stringify({
    action: "create",
    kind: d.kind,
    date: d.date,
    startHour: d.startHour,
    hours: d.hours,
    guests: block ? 1 : (d.guests ?? 1),
    name: block ? "" : d.name,
    phone: block ? "" : d.phone,
    email: block ? "" : d.email,
    note: d.note,
    actor: actorName(actor),
  });
}

export function deskCancelBody(id: string, actor: string): string {
  return JSON.stringify({ action: "cancel", id, actor: actorName(actor) });
}

/** Sitenin olay kaydına düşen ad ("Yönetim paneli · <ad>"); boş ad sitede 400 `actor` olurdu */
function actorName(actor: string): string {
  return actor.trim().slice(0, 60) || "ladmin";
}

/** Rezervasyonun Türkiye saatiyle anları: gün + başlangıç saati (24:00 ertesi günün 00:00'ı) */
export function deskInstants(date: string, startHour: number, hours: number): { start: number; end: number } {
  const start = Date.parse(`${date}T00:00:00Z`) - 3 * 3_600_000 + startHour * 3_600_000;
  return { start, end: start + hours * 3_600_000 };
}

/** "28 Kas 20:00–22:00" (işlem geçmişi ve bildirim; göreli değil) */
export function deskWhen(date: string, startHour: number, hours: number): string {
  const { start, end } = deskInstants(date, startHour, hours);
  return `${dayShortTR(date)} ${timeRange(start, end)}`;
}

/** Kapatılan saatin nedeni: sitenin notu "Kapalı: özel etkinlik" → "özel etkinlik"; neden yazılmadıysa null */
export function blockReason(note: string | null | undefined): string | null {
  const t = (note ?? "").trim();
  if (!t.startsWith(DESK_BLOCK_NOTE_PREFIX)) return t || null;
  const rest = t.slice(DESK_BLOCK_NOTE_PREFIX.length).replace(/^\s*:\s*/, "").trim();
  return rest || null;
}

// ---------------------------------------------------------------- Sitenin yanıtı

export type DeskOp = "create" | "cancel";

/** Sitenin yanıtının panel için anlamı */
export type DeskReply =
  | { ok: true; reservation: SiteReservation | null }
  | {
      ok: false;
      /** Sitenin hata kodu (ya da "timeout", "network", "format", "http") */
      code: string;
      /** Hatanın düştüğü form alanı; yoksa pencerenin başında */
      field: DeskField | null;
      message: string;
      /** Metin kurulum ayrıntısı taşır (anahtar adı, sitenin sürümü): personele kısa söz gider */
      setup: boolean;
      /** Site yazmış olabilir (zaman aşımı): ekran listeyi eşitleyip bakmayı söyler */
      uncertain: boolean;
    };

/** Sitenin `field`'ı formun alanıysa o; `body`, `action`, `actor`, `id` formun dışı (pencerenin başında) */
function formField(v: unknown): DeskField | null {
  return typeof v === "string" && (FIELDS as readonly string[]).includes(v) ? (v as DeskField) : null;
}

const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Sitenin yanıtı → panelin sonucu. Sitenin `message`'ı Türkçe ve kullanıcıya yöneliktir (400 `invalid`, 409 `slot_taken`
 * ve `too_many`): olduğu gibi, alanın yanında gösterilir. Başka kodlar burada Türkçeye çevrilir. 2xx'te gövde okunamasa
 * da yazım olmuştur (eşitleme satırı getirir).
 */
export function deskReply(op: DeskOp, status: number, json: unknown): DeskReply {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (status >= 200 && status < 300) {
    return { ok: true, reservation: op === "create" ? parseSiteReservation(body?.reservation) : null };
  }
  const code = str(body?.error, 40);
  const siteMessage = str(body?.message);
  const fail = (message: string, o: { field?: DeskField | null; setup?: boolean; uncertain?: boolean; code?: string } = {}): DeskReply => ({
    ok: false,
    code: o.code ?? code ?? "http",
    field: o.field ?? null,
    message,
    setup: o.setup ?? false,
    uncertain: o.uncertain ?? false,
  });
  if (status === 400) {
    const field = formField(body?.field);
    if (siteMessage) return fail(siteMessage, { field });
    if (body?.field === "actor") return fail("Hesabınızın adı boş; Hesabım'dan bir ad yazın.");
    if (body?.field === "id") return fail("Satırın kimliği okunamadı; sayfayı yenileyin.");
    if (field) return fail(`Site bu alanı kabul etmedi: ${FIELD_LABEL[field]}.`, { field });
    return fail("Site isteği okuyamadı (site ile panel uyumsuz olabilir).", { setup: true });
  }
  if (status === 409) {
    switch (code) {
      case "slot_taken":
        return fail(siteMessage ?? "Bu saatlerin bir kısmı dolu. Başka bir saat seçin.", { field: formField(body?.field) ?? "startHour" });
      case "too_many":
        return fail(siteMessage ?? "Bu e-postanın zaten iki açık rezervasyonu var. E-postayı boş bırakıp yeniden deneyin.", { field: formField(body?.field) ?? "email" });
      case "not_desk":
        return fail("Bu rezervasyon sitede alındı; iptali ve iadesi sitenin panelinden yapılır.");
      case "already_cancelled":
        return fail("Bu satır zaten kaldırılmıştı.");
      case "raced":
        return fail("Satır aynı anda değişti; listeyi yenileyip yeniden deneyin.");
      case "wrong_branch":
        return fail("Karaoke odası Tuzla'nın; site başka şube adına yazmadı.", { setup: true });
      default:
        return fail(siteMessage ?? "Site işlemi kabul etmedi; listeyi yenileyip yeniden deneyin.");
    }
  }
  if (status === 404) {
    // Sitenin JSON `not_found`'u satır yok demek; gövdesi JSON olmayan 404 ucun kendisi yok (site güncel değil)
    if (code === "not_found") return fail("Bu satır sitede bulunamadı; listeyi yenileyin.");
    return fail("Sitede elle rezervasyon ucu yok (laffogato.net güncel değil).", { setup: true });
  }
  if (status === 401) return fail(karaokePullError({ kind: "http", status }), { setup: true });
  if (status === 403) return fail("Site bu işlemi panelin anahtarına açmadı.", { setup: true });
  if (status === 413) return fail("İstek çok uzun; notu kısaltın.", { field: "note" });
  if (status === 503) {
    if (code === "unavailable") return fail("Sitenin veritabanı şu an okunamıyor; birkaç dakika sonra yeniden deneyin.");
    return fail(karaokePullError({ kind: "http", status, code }), { setup: true });
  }
  return fail(karaokePullError({ kind: "http", status, code }), { setup: true });
}

/** İstek siteye ulaşmadı ya da yanıtı gelmedi. Zaman aşımında site yazmış olabilir: liste eşitlenip bakılmalı */
export function deskFetchFailure(kind: "timeout" | "network" | "format", op: DeskOp): DeskReply {
  if (kind === "timeout") {
    return {
      ok: false,
      code: "timeout",
      field: null,
      message: `Site 8 saniyede yanıt vermedi; ${op === "create" ? "satır yazılmış" : "satır kaldırılmış"} olabilir. Listeye bakıp gerekirse yeniden deneyin.`,
      setup: false,
      uncertain: true,
    };
  }
  if (kind === "network") return { ok: false, code: "network", field: null, message: "Siteye ulaşılamadı; bağlantıyı kontrol edip yeniden deneyin.", setup: false, uncertain: false };
  return { ok: false, code: "format", field: null, message: karaokePullError({ kind: "format" }), setup: true, uncertain: false };
}

/** Kurulum ayrıntısı yöneticiye; personel ne olmadığını ve kime haber vereceğini görür (src/lib/staff-errors.ts) */
export function deskMessageFor(role: "admin" | "staff", reply: Extract<DeskReply, { ok: false }>, op: DeskOp): string {
  if (role === "admin" || !reply.setup) return reply.message;
  return `Site bağlantısında sorun var; ${op === "create" ? "satır eklenmedi" : "satır kaldırılmadı"}. Yöneticiye haber verin.`;
}

const FIELD_LABEL: Record<DeskField, string> = {
  kind: "tür",
  date: "gün",
  startHour: "başlangıç",
  hours: "süre",
  guests: "kişi",
  name: "ad",
  phone: "telefon",
  email: "e-posta",
  note: "not",
};

// ---------------------------------------------------------------- Kaldırma

export const DESK_TEXT = {
  notDesk: "Yalnız elle eklenen satır buradan kaldırılır; sitede alınan rezervasyonun iptali ve iadesi sitenin panelinde.",
  gone: "Satır bulunamadı; sayfayı yenileyin.",
  already: "Bu satır zaten kaldırılmıştı.",
  staffLate: `Elle eklenen satırı ilk ${DESK_REMOVE_FREE_MINUTES} dakikada kaldırabilirsiniz; şimdi kaldırmak için yöneticiye haber verin.`,
} as const;

/**
 * Bu kişi bu elle satırı kaldırabilir mi (null: evet). Yönetici her zaman; personel satır sitede yazıldıktan sonraki ilk
 * 10 dakikada (yanlış girilen satır; sayaç silmenin kuralı, timer-requests.ts). Sitede alınan rezervasyon ve zaten
 * kaldırılmış satır hiç. Saat sunucunun (ekranda canlı ucun saati).
 */
export function deskRemoveRefusal(
  s: { desk: DeskKind | null; status: KaraokeStatus; bookedAt: string | Date | null },
  role: "admin" | "staff",
  nowMs: number,
): string | null {
  if (!s.desk) return DESK_TEXT.notDesk;
  if (s.status === "cancelled") return DESK_TEXT.already;
  if (role === "admin") return null;
  const at = s.bookedAt === null ? NaN : typeof s.bookedAt === "string" ? Date.parse(s.bookedAt) : s.bookedAt.getTime();
  return Number.isFinite(at) && nowMs - at < DESK_REMOVE_FREE_MINUTES * 60_000 ? null : DESK_TEXT.staffLate;
}

// ---------------------------------------------------------------- Metinler

/** Eklemenin bildirimi (ekran): rezervasyonda sayacın kendiliğinden başlayacağı, kapatmada saatlerin dolu görüneceği */
export function deskAddedToast(kind: DeskKind, when: string, email: boolean): { title: string; description: string } {
  if (kind === "block") return { title: `Saatler kapatıldı · ${when}`, description: "Sitede, uygulamada ve kasada dolu görünür." };
  return {
    title: `Rezervasyon eklendi · ${when}`,
    description: `Saati gelince sayaç kendiliğinden başlar, süre dolunca alarm çalar. Ödeme köşkte alınır.${email ? " Misafire onay e-postası gider." : ""}`,
  };
}

/** İşlem geçmişinin satırı (telefon ve e-posta yok) */
export function deskLogLine(op: DeskOp, kind: DeskKind, o: { when: string; name: string | null; guests: number | null; note: string | null; email?: boolean }): { action: string; detail: string } {
  if (kind === "block") {
    const reason = blockReason(o.note);
    return {
      action: op === "create" ? "Karaoke saatleri kapatıldı" : "Kapatılan karaoke saatleri açıldı",
      detail: [o.when, reason].filter(Boolean).join(" · "),
    };
  }
  return {
    action: op === "create" ? "Karaoke elle rezervasyon eklendi" : "Karaoke elle rezervasyonu kaldırıldı",
    detail: [o.name?.trim() || "İsimsiz", o.guests ? `${o.guests} kişi` : null, o.when, op === "create" && o.email ? "misafire onay e-postası" : null].filter(Boolean).join(" · "),
  };
}

/**
 * Formun başlangıç seçenekleri: odanın saatleri (Doluluk › Oda saatleri; varsayılan 12:00–24:00) içinde ve gece yarısını
 * geçmeden (site takvim gününe yazar); bugünse bitmiş saat çıkmaz. `close` iş günü ölçeğinde (24 = gece yarısı).
 */
export function deskStartHours(hours: { open: number; close: number }, date: string, now: { today: string; minutes: number }): number[] {
  const open = Math.max(0, Math.min(23, hours.open));
  const close = Math.min(24, hours.close);
  const out: number[] = [];
  for (let h = open; h < close; h++) {
    if (date === now.today && (h + 1) * 60 <= now.minutes) continue;
    out.push(h);
  }
  return out;
}

/** Seçilen başlangıçtan kapanışa kadar süreler (1 saat …) */
export function deskLengths(hours: { close: number }, startHour: number): number[] {
  const close = Math.min(24, hours.close);
  const out: number[] = [];
  for (let n = 1; startHour + n <= close; n++) out.push(n);
  return out;
}

/** Formun gün seçenekleri: bugünden 60 gün sonrasına */
export function deskDays(today: string): string[] {
  return Array.from({ length: DESK_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i));
}
