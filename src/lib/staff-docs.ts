/**
 * Personel belgeleri için saf kurallar (sunucu ve istemci birlikte kullanır; tests/personel-belge.test.ts sınar):
 * belge türleri, geçerliliğin durumu (süresiz, geçerli, 30 gün içinde bitiyor, bitti), yöneticiye hatırlatmalar (zil
 * satırları, e-posta satırları ve tekil anahtarlar) ve yüklenen dosyanın denetimi. Ayrıntı docs/PERSONEL-BELGE.md.
 *
 * Geçerlilik bitişi belgenin geçerli olduğu SON gündür: o gün "bugün bitiyor", ertesi gün "bitti". Hatırlatma iki
 * aşamalı: bitişe 30 gün ve daha az kala bir kez ("30"), bitince bir kez ("bitti"). Anahtar bitiş gününü taşır:
 * belge yenilenip tarihi değişince aşamalar yeniden işler. İşten ayrılmış kişinin belgesi hatırlatılmaz.
 */

import { extensionFor, fileSlug, MAX_UPLOAD_BYTES, UPLOAD_MIMES, type DocumentMime } from "./documents";
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
  /** Kişinin kaydı etkin mi (pasif kişinin belgesi hatırlatılmaz; verilmezse etkin) */
  staffActive?: boolean;
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

/** Aynı belgenin yenisiyle eşleşme anahtarı: kişi + tür ("diger"de adı da; büyük-küçük harf ve aksan farkı gözetilmez) */
function sameDocKey(d: Pick<DocFact, "staffId" | "kind" | "label">): string {
  const label = d.kind === "diger" ? (d.label ?? "").toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim() : "";
  return `${d.staffId}|${d.kind}|${label}`;
}

/**
 * Yenilenmiş (eskimiş) belgeler: aynı kişinin aynı türden (öteki belgelerde aynı addan) daha geç biten belgesi varsa
 * eskisi "yenilendi" sayılır, hatırlatılmaz. Süresiz belge en geç biten sayılır; bitişler eşitse sonra eklenen geçer.
 * Böylece sağlık raporu yenilenince eskisini silmek gerekmez (geçmiş olarak kalır).
 */
export function supersededIds(docs: readonly Pick<DocFact, "id" | "staffId" | "kind" | "label" | "validUntil">[]): Set<number> {
  const latest = new Map<string, { id: number; until: string }>();
  for (const d of docs) {
    const key = sameDocKey(d);
    const until = d.validUntil ?? "9999-12-31";
    const cur = latest.get(key);
    if (!cur || until > cur.until || (until === cur.until && d.id > cur.id)) latest.set(key, { id: d.id, until });
  }
  const current = new Set([...latest.values()].map((v) => v.id));
  return new Set(docs.filter((d) => !current.has(d.id)).map((d) => d.id));
}

/** Kişi ayrılmış mı: son ayı bu aydan önce (ya da kaydı pasif) */
export const staffLeft = (endMonth: string | null | undefined, today: string, active = true) => !active || Boolean(endMonth && endMonth < today.slice(0, 7));

/**
 * Hatırlatılacak belgeler: bitmiş ya da 30 gün içinde bitecek, yenilenmemiş, kişisi hâlâ çalışan. Sıra: bitenler önce
 * (en eski bitiş başta), sonra yaklaşanlar (en yakın başta); eşitlikte kişinin adı.
 */
export function docAlerts(docs: readonly DocFact[], today: string): DocAlert[] {
  const old = supersededIds(docs);
  const out: DocAlert[] = [];
  for (const d of docs) {
    if (old.has(d.id) || staffLeft(d.staffEndMonth, today, d.staffActive ?? true)) continue;
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

/** Sabah e-postasının kutusu (src/server/notify/digest-template.ts DigestBox ile aynı biçim) */
export interface DocDigestBox {
  title: string;
  lines: { strong?: string; text: string; tone?: "bad" | "warn" | "muted" }[];
  href: string;
  link: string;
  subjectPart: string | null;
  headline: string | null;
}

const DIGEST_ROWS = 8;

/**
 * Sabah e-postasının "Personel belgeleri" kutusu: yalnız bu sabah ilk kez bildirilenler (freshDocAlerts), bitenler
 * kırmızı, yaklaşanlar turuncu; en çok 8 satır, kalanı "ve N belge daha". Hatırlatma yoksa null.
 */
export function docDigestBox(alerts: readonly DocAlert[], today: string): DocDigestBox | null {
  if (!alerts.length) return null;
  const expired = alerts.filter((a) => a.stage === "expired").length;
  const soon = alerts.length - expired;
  const parts = [
    expired ? `${num(expired)} personel belgesinin süresi doldu` : null,
    soon ? (soon === 1 ? "1 personel belgesi 30 gün içinde bitiyor" : `${num(soon)} personel belgesi 30 gün içinde bitiyor`) : null,
  ].filter((p): p is string => Boolean(p));
  const lines: DocDigestBox["lines"] = alerts.slice(0, DIGEST_ROWS).map((a) => ({
    strong: `${a.staffName} · ${a.title}`,
    text: `${docStatusText(a.validUntil, today)} (bitiş ${dateTR(a.validUntil)})`,
    tone: a.stage === "expired" ? "bad" : "warn",
  }));
  if (alerts.length > DIGEST_ROWS) lines.push({ text: `ve ${num(alerts.length - DIGEST_ROWS)} belge daha`, tone: "muted" });
  const subject = parts.join(" · ");
  return {
    title: "Personel belgeleri",
    lines,
    href: DOCS_HREF,
    link: "Personel belgelerini aç",
    subjectPart: subject,
    headline: subject.charAt(0).toLocaleUpperCase("tr-TR") + subject.slice(1),
  };
}

/** İndirilen dosyanın adı: "Ayse-Yilmaz_Saglik-raporu_2027-03-12.pdf" (kişi, belge, bitiş) */
export function staffDocFileName(d: { staffName: string; kind: string; label?: string | null; validUntil?: string | null }, mime: DocumentMime): string {
  const parts = [fileSlug(d.staffName) || "personel", fileSlug(docTitle(d)) || "belge", d.validUntil ?? ""].filter(Boolean);
  return `${parts.join("_")}.${extensionFor(mime)}`;
}

/** Her çalışanda beklenen belgeler (eksikse kişinin satırında "Eksik" yazar; hatırlatma değil, bilgi) */
export const EXPECTED_KINDS: readonly DocKind[] = ["hijyen", "saglik", "sgk"];

/** Kişinin hiç girilmemiş beklenen belgeleri */
export function missingKinds(docs: readonly { kind: string }[]): DocKind[] {
  return EXPECTED_KINDS.filter((k) => !docs.some((d) => d.kind === k));
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
