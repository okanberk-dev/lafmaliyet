/**
 * Personel belgeleri için saf kurallar (sunucu ve istemci birlikte kullanır; tests/personel-belge.test.ts sınar):
 * belge türleri, geçerliliğin durumu (süresiz, geçerli, 30 gün içinde bitiyor, bitti), yöneticiye hatırlatmalar (zil
 * satırları, e-posta satırları ve tekil anahtarlar) ve yüklenen dosyanın denetimi. Ayrıntı docs/PERSONEL-BELGE.md.
 *
 * Geçerlilik bitişi belgenin geçerli olduğu SON gündür: o gün "bugün bitiyor", ertesi gün "bitti". Hatırlatma iki
 * aşamalı: bitişe 30 gün ve daha az kala bir kez ("30"), bitince bir kez ("bitti"). Anahtar bitiş gününü taşır:
 * belge yenilenip tarihi değişince aşamalar yeniden işler. İşten ayrılmış kişinin belgesi hatırlatılmaz.
 */

import { MAX_UPLOAD_BYTES, UPLOAD_MIMES, type DocumentMime } from "./documents";
import { dateTR, num } from "./format";
import { daysBetween, isCalendarDate } from "./reminders";

export type DocKind = "hijyen" | "saglik" | "sgk" | "diger";
export const DOC_KINDS: readonly DocKind[] = ["hijyen", "saglik", "sgk", "diger"];
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  hijyen: "Hijyen eğitimi",
  saglik: "Sağlık raporu",
  sgk: "SGK işe giriş",
  diger: "Diğer belge",
};
/** Türün kısa açıklaması (formda seçimin altında) */
export const DOC_KIND_HINT: Record<DocKind, string> = {
  hijyen: "Hijyen eğitimi belgesi; süresizse bitişi boş bırakın.",
  saglik: "Portör muayenesi / sağlık raporu; çoğunlukla yılda bir yenilenir.",
  sgk: "SGK işe giriş bildirgesi; bitişi yoktur, boş bırakın.",
  diger: "Sözleşme, kimlik fotokopisi, ikametgâh gibi; adını yazın.",
};

export function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);
}

/** Bitişe bu kadar gün ve daha az kala "yakında bitiyor" */
export const DOC_SOON_DAYS = 30;
/** Kişi başına en çok belge (yanlışlıkla döngüye giren yükleme depoyu doldurmasın) */
export const MAX_DOCS_PER_STAFF = 40;
export const MAX_DOC_BYTES = MAX_UPLOAD_BYTES;
export const DOC_MIMES: readonly DocumentMime[] = UPLOAD_MIMES;

export type DocStage = "none" | "ok" | "soon" | "expired";

/** Belgenin durumu: bitişi yoksa "none"; bitiş günü dahil geçerli */
export function docStage(validUntil: string | null | undefined, today: string): DocStage {
  if (!validUntil) return "none";
  const left = daysBetween(today, validUntil);
  if (left < 0) return "expired";
  return left <= DOC_SOON_DAYS ? "soon" : "ok";
}

/** "Süresiz", "12.03.2027'ye kadar", "12 gün kaldı", "Yarın bitiyor", "Bugün bitiyor", "Dün bitti", "5 gün önce bitti" */
export function docStatusText(validUntil: string | null | undefined, today: string): string {
  if (!validUntil) return "Süresiz";
  const left = daysBetween(today, validUntil);
  if (left > DOC_SOON_DAYS) return `${dateTR(validUntil)} tarihine kadar`;
  if (left > 1) return `${num(left)} gün kaldı`;
  if (left === 1) return "Yarın bitiyor";
  if (left === 0) return "Bugün bitiyor";
  if (left === -1) return "Dün bitti";
  return `${num(-left)} gün önce bitti`;
}

/** Belgenin adı: türün adı, "diger"de yazılan ad; ek ad varsa "Sağlık raporu · portör" */
export function docTitle(d: { kind: string; label?: string | null }): string {
  const label = d.label?.trim() || "";
  if (!isDocKind(d.kind)) return label || "Belge";
  if (d.kind === "diger") return label || DOC_KIND_LABEL.diger;
  return label ? `${DOC_KIND_LABEL[d.kind]} · ${label}` : DOC_KIND_LABEL[d.kind];
}

export interface DocFact {
  id: number;
  staffId: number;
  staffName: string;
  /** Kişinin son ayı ("YYYY-MM"); geçmişse kişi ayrılmıştır, belgesi hatırlatılmaz */
  staffEndMonth?: string | null;
  branchId?: string | null;
  kind: string;
  label?: string | null;
  validUntil: string | null;
}

export interface DocAlert {
  /** notification_log anahtarı: "belge:<id>:<bitiş>:30" ya da "belge:<id>:<bitiş>:bitti" */
  key: string;
  id: number;
  staffId: number;
  staffName: string;
  branchId: string | null;
  title: string;
  stage: "soon" | "expired";
  validUntil: string;
  /** Bitişe kalan gün (bittiyse eksi) */
  daysLeft: number;
}

export const docLogKey = (id: number, validUntil: string, stage: "soon" | "expired") => `belge:${id}:${validUntil}:${stage === "soon" ? "30" : "bitti"}`;

/**
 * Hatırlatılacak belgeler: bitmiş ya da 30 gün içinde bitecek, kişisi hâlâ çalışan. Sıra: bitenler önce (en eski
 * bitiş başta), sonra yaklaşanlar (en yakın başta); eşitlikte kişinin adı.
 */
export function docAlerts(docs: readonly DocFact[], today: string): DocAlert[] {
  const month = today.slice(0, 7);
  const out: DocAlert[] = [];
  for (const d of docs) {
    if (d.staffEndMonth && d.staffEndMonth < month) continue;
    const stage = docStage(d.validUntil, today);
    if (stage !== "soon" && stage !== "expired") continue;
    const validUntil = d.validUntil!;
    out.push({
      key: docLogKey(d.id, validUntil, stage),
      id: d.id,
      staffId: d.staffId,
      staffName: d.staffName,
      branchId: d.branchId ?? null,
      title: docTitle(d),
      stage,
      validUntil,
      daysLeft: daysBetween(today, validUntil),
    });
  }
  return out.sort((a, b) => (a.stage === b.stage ? a.validUntil.localeCompare(b.validUntil) || a.staffName.localeCompare(b.staffName, "tr") : a.stage === "expired" ? -1 : 1));
}

/** "Ayşe · Sağlık raporu (5 gün önce bitti)" */
export function docAlertLine(a: DocAlert, today: string): string {
  return `${a.staffName} · ${a.title} (${docStatusText(a.validUntil, today).toLocaleLowerCase("tr-TR")})`;
}

export const DOCS_HREF = "/panel/personel/belgeler";

export interface DocBellRow {
  id: string;
  kind: "warning" | "info";
  title: string;
  body: string;
  href: string;
}

const BELL_NAMES = 3;

/**
 * Zil satırları (yalnız yönetici, grup Uyarılar): bitenler tek satır, yaklaşanlar tek satır. Kimlik belgelerden ve
 * bitiş günlerinden türer: yeni belge bitince ya da yaklaşınca satır yeniden okunmamış olur, gün geçti diye olmaz.
 */
export function docBellRows(alerts: readonly DocAlert[], today: string): DocBellRow[] {
  const rows: DocBellRow[] = [];
  const part = (stage: "soon" | "expired") => alerts.filter((a) => a.stage === stage);
  const body = (list: DocAlert[]) => {
    const shown = list.slice(0, BELL_NAMES).map((a) => docAlertLine(a, today));
    return `${shown.join(", ")}${list.length > BELL_NAMES ? ` ve ${num(list.length - BELL_NAMES)} belge daha` : ""}.`;
  };
  const idOf = (list: DocAlert[]) => list.map((a) => `${a.id}.${a.validUntil}`).join("_");
  const expired = part("expired");
  if (expired.length) {
    rows.push({
      id: `belge-bitti-${idOf(expired)}`,
      kind: "warning",
      title: expired.length === 1 ? "1 personel belgesinin süresi doldu" : `${num(expired.length)} personel belgesinin süresi doldu`,
      body: body(expired),
      href: DOCS_HREF,
    });
  }
  const soon = part("soon");
  if (soon.length) {
    rows.push({
      id: `belge-yakin-${idOf(soon)}`,
      kind: "info",
      title: soon.length === 1 ? "1 personel belgesi 30 gün içinde bitiyor" : `${num(soon.length)} personel belgesi 30 gün içinde bitiyor`,
      body: body(soon),
      href: DOCS_HREF,
    });
  }
  return rows;
}

/** E-postanın konusu: "Personel belgeleri: 2 belgenin süresi doldu · 1 belge 30 gün içinde bitiyor" */
export function docEmailSubject(alerts: readonly DocAlert[]): string {
  const expired = alerts.filter((a) => a.stage === "expired").length;
  const soon = alerts.length - expired;
  const parts = [expired ? `${num(expired)} belgenin süresi doldu` : null, soon ? `${num(soon)} belge 30 gün içinde bitiyor` : null].filter(Boolean);
  return `Personel belgeleri: ${parts.join(" · ")}`;
}

/** Daha önce bildirilmemiş hatırlatmalar (anahtarı `sent`te olmayan) */
export function freshDocAlerts(alerts: readonly DocAlert[], sent: ReadonlySet<string>): DocAlert[] {
  return alerts.filter((a) => !sent.has(a.key));
}

export interface DocInput {
  kind: string;
  label?: string | null;
  issuedOn?: string | null;
  validUntil?: string | null;
}

/** Belge formunun hatası (yoksa null): tür, "diger"de ad, tarihler takvimde var ve bitiş düzenlenmeden önce değil */
export function docInputProblem(d: DocInput): string | null {
  if (!isDocKind(d.kind)) return "Belge türü seçin";
  if (d.kind === "diger" && !d.label?.trim()) return "Belgenin adını yazın";
  if ((d.label?.trim().length ?? 0) > 80) return "Belgenin adı çok uzun";
  if (d.issuedOn && !isCalendarDate(d.issuedOn)) return "Düzenlenme tarihi geçersiz";
  if (d.validUntil && !isCalendarDate(d.validUntil)) return "Geçerlilik bitişi geçersiz";
  if (d.issuedOn && d.validUntil && d.validUntil < d.issuedOn) return "Geçerlilik bitişi düzenlenme tarihinden önce olamaz";
  return null;
}

/** Yüklenen dosyanın hatası (yoksa null); tür içerikten okunmuş olmalı (sniffMime) */
export function docFileProblem(size: number, mime: DocumentMime | null): string | null {
  if (!size) return "Dosya boş; yeniden seçin";
  if (size > MAX_DOC_BYTES) return "Dosya 4 MB'tan büyük; fotoğrafı küçültüp yeniden deneyin.";
  if (!mime || !DOC_MIMES.includes(mime)) return "Yalnız PDF, JPG, PNG ya da WebP yüklenebilir.";
  return null;
}

/** Belgenin panel içindeki tek adresi (deponun adresi hiçbir yerde görünmez) */
export const staffDocUrl = (id: number, download = false) => `/api/personel/belge/${id}${download ? "?indir=1" : ""}`;
