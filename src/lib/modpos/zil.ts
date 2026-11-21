import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { branchDayKey } from "@/lib/cash-report";
import { branchSwitchDay, isLafposDay } from "@/lib/lafpos/switch";
import { dayMonthTR, longDateTR } from "@/lib/reminders";

import { modposDiffs, modposDiffText, type ModposDiff, type ModposSavedFields } from "./compare";
import type { KasaFoyu } from "./foy";
import type { ModposState } from "./status";
import { sheetZ } from "./z";

/**
 * ModPOS kasa föyünün yöneticiye uyarıları (saf; zil src/server/bell/kasa.ts ve src/server/bell/modpos.ts, Bugün
 * src/server/data/today.ts ve sabah e-postası aynı kuralı okur; tests/modpos-zil.test.ts). Belge: docs/MODPOS-API.md ›
 * Nerede görünür, docs/BILDIRIMLER.md, docs/BUGUN.md. Personele hiçbiri gitmez: föyün tutarları yalnız yöneticinindir.
 *
 * - **Kasa raporu ModPOS föyünden farklı**: raporun Z alanları, açılışı ya da sayılan nakdi saklanan föyden farklı
 *   (src/lib/modpos/compare.ts modposDiffs; 1 kuruş hassasiyet). Yalnız ModPOS günlerinde (LafPOS'a geçiş günü boşken ya
 *   da gün ondan önceyken) ve yalnız kasası kapanmış föyde: gün açıkken "Bu günü çek"le alınan föy o anki tutarlardır,
 *   akşamki raporla karşılaştırılsa her alan farklı görünürdü (ertesi sabah kendiliğinden yeniden çekilir).
 * - **ModPOS kasa föyü çekilemiyor**: anahtar tanımlı ama çalışmıyor (geçersiz, kapalı, süresi dolmuş, IP kısıtı,
 *   yetki ya da biçimi bozuk). Hak dolması ve günlük hatalar uyarı değildir (olağan; ertesi sabah yeniden denenir).
 */

/** Karşılaştırılan föy: saklanan satırın gereken alanları (src/server/modpos/store.ts ModposSheet) */
export interface ModposSheetLite {
  day: string;
  /** Föyün şubesi (yoksa Tuzla): rapor yalnız kendi şubesinin föyüyle karşılaştırılır */
  branchId?: string;
  foy: KasaFoyu;
  revision: number;
  /** Kesin mi (kasasız föy kesinleşmeden karşılaştırılmaz; verilmezse kesin sayılır) */
  final?: boolean;
}

/** Föyünden farklı yazılan rapor, föyü ve farklı alanları */
export interface ModposMismatch<R> {
  report: R;
  sheet: ModposSheetLite;
  diffs: ModposDiff[];
}

/** Zilin ve e-postanın başlığı */
export const MODPOS_MISMATCH_TITLE = "Kasa raporu ModPOS API'den farklı";
/** Anahtar çalışmıyorken zilin ve e-postanın başlığı */
export const MODPOS_KEY_TITLE = "ModPOS API'den veri çekilemiyor";
/** Zilin gövdesinin en çok uzunluğu (LafPOS satırıyla aynı) */
export const MODPOS_BELL_BODY_MAX = 220;

/** Rapor ile föyün eşleşme anahtarı: (şube, gün). Şubesi verilmeyen kayıt Tuzla'nındır (şubeler öncesi) */
export function modposPairKey(branchId: string | null | undefined, day: string): string {
  return `${branchId ?? DEFAULT_BRANCH_ID}|${day}`;
}

/**
 * Föyünden farklı yazılan raporlar, raporların sırasıyla. LafPOS günü (geçiş gününden itibaren), föyü olmayan, satışsız
 * (foyZ null) ya da kasası hâlâ açık föyün günü atlanır (docs/MODPOS-API.md › Nerede görünür, karşılaştırma kuralları).
 * Rapor yalnız **kendi şubesinin** föyüyle karşılaştırılır (şube, gün): "Tümü" seçiliyken Marina'nın raporu Tuzla'nın
 * föyüyle karşılaştırılmaz (docs/MODPOS-API.md › Şubeler). Geçiş günü yalnız LafPOS'un şubesinin kasasınındır
 * (branchSwitchDay): ModPOS'ta kalan şubenin raporu geçiş gününden sonra da föyüyle karşılaştırılır.
 */
export function modposMismatches<R extends ModposSavedFields & { date: string; branchId?: string | null }>(
  reports: readonly R[],
  sheets: readonly ModposSheetLite[],
  switchDay: string | null,
): ModposMismatch<R>[] {
  const byDay = new Map(sheets.map((x) => [modposPairKey(x.branchId, x.day), x]));
  const out: ModposMismatch<R>[] = [];
  for (const report of reports) {
    if (isLafposDay(report.date, branchSwitchDay(switchDay, report.branchId))) continue;
    const sheet = byDay.get(modposPairKey(report.branchId, report.date));
    const z = sheet ? sheetZ(sheet) : null;
    if (!sheet || !z || z.durum === "ACIK") continue;
    const diffs = modposDiffs(report, z);
    if (diffs.length) out.push({ report, sheet, diffs });
  }
  return out;
}

/** Bugün'ün kasa satırları için yalnız günler (bugun/logic.ts cashFlags'e verilir: "ModPOS föyünden farklı") */
export function modposMismatchDates(reports: readonly (ModposSavedFields & { date: string; branchId?: string | null })[], sheets: readonly ModposSheetLite[], switchDay: string | null): Set<string> {
  return new Set(modposMismatches(reports, sheets, switchDay).map((m) => m.report.date));
}

/**
 * "Tümü"de birden çok kasa: Bugün'ün şube şube işaretleri için (şube, gün) anahtarları (branchDayKey; bugun/logic.ts
 * cashFlagsByBranch'e verilir). Şubesi verilmeyen rapor Tuzla'nındır
 */
export function modposMismatchBranchDays(
  reports: readonly (ModposSavedFields & { date: string; branchId?: string | null })[],
  sheets: readonly ModposSheetLite[],
  switchDay: string | null,
): Set<string> {
  return new Set(modposMismatches(reports, sheets, switchDay).map((m) => branchDayKey(m.report.branchId ?? DEFAULT_BRANCH_ID, m.report.date)));
}

/**
 * Zilin satırı (yönetici, Kasa başlığı). Kimlik raporun ve föyün sürümünden: rapor yeniden gönderilince ya da föy
 * değişince yeniden okunmamış olur. Gövde "2 Kasım Pazartesi · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺); …", en çok
 * MODPOS_BELL_BODY_MAX harf.
 */
export function modposMismatchBell(m: ModposMismatch<{ date: string; revision: number; branchId?: string | null }>, branchName?: string): { id: string; title: string; body: string; href: string } {
  const date = m.report.date;
  // Tuzla'dan başka şubenin satırı kimliğinde ve adresinde şubeyi taşır (adresin ?sube='si panelin seçimine geçer)
  const sube = m.report.branchId && m.report.branchId !== DEFAULT_BRANCH_ID ? m.report.branchId : null;
  const body = `${branchName ? `${branchName} · ` : ""}${longDateTR(date)} · ${m.diffs.map(modposDiffText).join("; ")}`;
  return {
    id: `kasa-modpos-${date}${sube ? `-${sube}` : ""}-r${m.report.revision}-s${m.sheet.revision}`,
    title: MODPOS_MISMATCH_TITLE,
    body: body.length > MODPOS_BELL_BODY_MAX ? `${body.slice(0, MODPOS_BELL_BODY_MAX - 1)}…` : body,
    href: `/panel/kasa?gun=${date}${sube ? `&sube=${sube}` : ""}`,
  };
}

/**
 * Sabah e-postasının satırı: "Kasa raporu ModPOS föyünden farklı. 2 Kasım · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)";
 * birden çok kasa açıkken şubenin adıyla: "Kasa raporu ModPOS API'den farklı (Marina). 2 Kasım · …"
 */
export function modposMismatchDigestText(date: string, diffs: readonly ModposDiff[], branchName?: string): string {
  return `${MODPOS_MISMATCH_TITLE}${branchName ? ` (${branchName})` : ""}. ${dayMonthTR(date)} · ${diffs.map(modposDiffText).join("; ")}`;
}

/** Anahtarın uyarısı: kimlik, başlık, gövde ve hatanın anı (biçim sorununda null) */
export interface ModposKeyAlert {
  id: string;
  title: string;
  body: string;
  at: string | null;
}

/** Biçimi bozuk anahtarın metni (Ayarlar kartının "Anahtar bozuk" satırıyla aynı öğüt) */
export const MODPOS_KEY_FORMAT_TEXT = "MODPOS_API_KEY'in biçimi bozuk: Vercel'deki değeri Gafdigi'nin verdiği anahtarla aynen değiştirip yeniden yayınlayın";

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/**
 * Anahtar çalışmıyor mu (docs/MODPOS-API.md › Nerede görünür, › Sorun giderme). `keyProblem` src/lib/modpos/request.ts
 * modposKeyProblem: anahtar yoksa ("missing") uyarı yok (Ayarlar kartı gri "Kurulmadı" der, sakin dil); biçimi bozuksa
 * ("format") canlıda uyarı (önizleme hiç çekmez, orada susar). Anahtar tanımlıyken son hata anahtarın kendisiyle ilgiliyse
 * (keyError) ve son başarılı çekimden sonraysa uyarı. Kimlik hatanın kodundan ve son başarılı çekimden: aynı hata her
 * sabah yeniden okunmamış olmaz, sorun düzelip yeniden çıkınca (araya başarılı çekim girince) yeni uyarı sayılır.
 */
export function modposKeyAlert(o: {
  keyProblem: "missing" | "format" | "shared" | null;
  preview: boolean;
  state: ModposState | null;
  /** Şube (Tuzla'dan başkaysa kimliğe ve başlığa girer; docs/MODPOS-API.md › Şubeler) */
  branch?: { id: string; name: string };
  /** Anahtarın ortam değişkeni (biçim ve ortaklık metninde) */
  keyEnv?: string;
  /** Ortak anahtarın metni (src/server/modpos/sync.ts sharedKeyText) */
  sharedText?: string;
}): ModposKeyAlert | null {
  if (o.keyProblem === "missing") return null;
  const other = o.branch && o.branch.id !== DEFAULT_BRANCH_ID ? o.branch : null;
  const id = (x: string) => (other ? `${x}-${other.id}` : x);
  const title = other ? `${MODPOS_KEY_TITLE} (${other.name})` : MODPOS_KEY_TITLE;
  const keyEnv = o.keyEnv ?? "MODPOS_API_KEY";
  if (o.keyProblem === "format") {
    return o.preview ? null : { id: id("modpos-anahtar-bicim"), title, body: MODPOS_KEY_FORMAT_TEXT.replace("MODPOS_API_KEY", keyEnv), at: null };
  }
  if (o.keyProblem === "shared") {
    return o.preview ? null : { id: id("modpos-anahtar-ortak"), title, body: o.sharedText ?? `${keyEnv} başka bir şubenin ModPOS anahtarıyla aynı`, at: null };
  }
  const err = o.state?.lastError ?? null;
  if (!err?.keyError) return null;
  const ok = o.state?.lastOk ?? null;
  const okAt = ok ? time(ok.at) : null;
  const errAt = time(err.at);
  if (okAt !== null && (errAt === null || okAt >= errAt)) return null;
  return { id: id(`modpos-anahtar-${err.kod}-${okAt ?? 0}`), title, body: err.text, at: errAt === null ? null : err.at };
}

/** Sabah e-postasının satırı: "ModPOS kasa föyü çekilemiyor. ModPOS API anahtarı geçersiz: …" */
export function modposKeyDigestText(a: ModposKeyAlert): string {
  return `${a.title}. ${a.body}`;
}
