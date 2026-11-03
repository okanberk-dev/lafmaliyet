import { isLafposDay } from "@/lib/lafpos/switch";
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
export const MODPOS_MISMATCH_TITLE = "Kasa raporu ModPOS föyünden farklı";
/** Anahtar çalışmıyorken zilin ve e-postanın başlığı */
export const MODPOS_KEY_TITLE = "ModPOS kasa föyü çekilemiyor";
/** Zilin gövdesinin en çok uzunluğu (LafPOS satırıyla aynı) */
export const MODPOS_BELL_BODY_MAX = 220;

/**
 * Föyünden farklı yazılan raporlar, raporların sırasıyla. LafPOS günü (geçiş gününden itibaren), föyü olmayan, satışsız
 * (foyZ null) ya da kasası hâlâ açık föyün günü atlanır (docs/MODPOS-API.md › Nerede görünür, karşılaştırma kuralları).
 */
export function modposMismatches<R extends ModposSavedFields & { date: string }>(
  reports: readonly R[],
  sheets: readonly ModposSheetLite[],
  switchDay: string | null,
): ModposMismatch<R>[] {
  const byDay = new Map(sheets.map((x) => [x.day, x]));
  const out: ModposMismatch<R>[] = [];
  for (const report of reports) {
    if (isLafposDay(report.date, switchDay)) continue;
    const sheet = byDay.get(report.date);
    const z = sheet ? sheetZ(sheet) : null;
    if (!sheet || !z || z.durum === "ACIK") continue;
    const diffs = modposDiffs(report, z);
    if (diffs.length) out.push({ report, sheet, diffs });
  }
  return out;
}

/** Bugün'ün kasa satırları için yalnız günler (bugun/logic.ts cashFlags'e verilir: "ModPOS föyünden farklı") */
export function modposMismatchDates(reports: readonly (ModposSavedFields & { date: string })[], sheets: readonly ModposSheetLite[], switchDay: string | null): Set<string> {
  return new Set(modposMismatches(reports, sheets, switchDay).map((m) => m.report.date));
}

/**
 * Zilin satırı (yönetici, Kasa başlığı). Kimlik raporun ve föyün sürümünden: rapor yeniden gönderilince ya da föy
 * değişince yeniden okunmamış olur. Gövde "2 Kasım Pazartesi · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺); …", en çok
 * MODPOS_BELL_BODY_MAX harf.
 */
export function modposMismatchBell(m: ModposMismatch<{ date: string; revision: number }>): { id: string; title: string; body: string; href: string } {
  const date = m.report.date;
  const body = `${longDateTR(date)} · ${m.diffs.map(modposDiffText).join("; ")}`;
  return {
    id: `kasa-modpos-${date}-r${m.report.revision}-s${m.sheet.revision}`,
    title: MODPOS_MISMATCH_TITLE,
    body: body.length > MODPOS_BELL_BODY_MAX ? `${body.slice(0, MODPOS_BELL_BODY_MAX - 1)}…` : body,
    href: `/panel/kasa?gun=${date}`,
  };
}

/** Sabah e-postasının satırı: "Kasa raporu ModPOS föyünden farklı. 2 Kasım · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)" */
export function modposMismatchDigestText(date: string, diffs: readonly ModposDiff[]): string {
  return `${MODPOS_MISMATCH_TITLE}. ${dayMonthTR(date)} · ${diffs.map(modposDiffText).join("; ")}`;
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
export function modposKeyAlert(o: { keyProblem: "missing" | "format" | null; preview: boolean; state: ModposState | null }): ModposKeyAlert | null {
  if (o.keyProblem === "missing") return null;
  if (o.keyProblem === "format") return o.preview ? null : { id: "modpos-anahtar-bicim", title: MODPOS_KEY_TITLE, body: MODPOS_KEY_FORMAT_TEXT, at: null };
  const err = o.state?.lastError ?? null;
  if (!err?.keyError) return null;
  const ok = o.state?.lastOk ?? null;
  const okAt = ok ? time(ok.at) : null;
  const errAt = time(err.at);
  if (okAt !== null && (errAt === null || okAt >= errAt)) return null;
  return { id: `modpos-anahtar-${err.kod}-${okAt ?? 0}`, title: MODPOS_KEY_TITLE, body: err.text, at: errAt === null ? null : err.at };
}

/** Sabah e-postasının satırı: "ModPOS kasa föyü çekilemiyor. ModPOS API anahtarı geçersiz: …" */
export function modposKeyDigestText(a: ModposKeyAlert): string {
  return `${a.title}. ${a.body}`;
}
