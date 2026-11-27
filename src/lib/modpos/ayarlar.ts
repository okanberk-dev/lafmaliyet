import { diffKind } from "@/lib/cash-report";
import { money, num } from "@/lib/format";
import { dayMonthYearTR } from "@/lib/asilpos/switch";

import type { ModposDayResult, ModposTone } from "./status";
import { finalAfter, type ModposZ } from "./z";

/**
 * Ayarlar › ModPOS (kasa föyü) kartının saf metinleri (docs/MODPOS-API.md › Nerede görünür, Kota ve çekme sırası, Ay
 * rakamına yedek; tests/modpos-ayarlar.test.ts): "Bu günü çek"in onay penceresi ve sonucu, son çekilen günlerin rozetleri
 * ve satırı, ay rakamına yedek anahtarının işlem geçmişi metni. Sunucu (eylem, kart) ve istemci (onay penceresi) paylaşır;
 * veritabanı ya da ortam okumaz.
 */

/** Anahtar yokken "Bu günü çek"in yanıtı (UserError: sonda nokta yok, ne yapılacağı iki noktadan sonra) */
export const MODPOS_NOT_CONFIGURED = "ModPOS bağlantısı kurulmamış: Vercel'de MODPOS_API_KEY tanımlı değil";
/** Anahtarın biçimi bozukken (boşluk, satır sonu, çok kısa) */
export const MODPOS_KEY_BROKEN = "MODPOS_API_KEY'in biçimi bozuk: Vercel'deki değeri Gafdigi'nin verdiği anahtarla aynen değiştirin";
/** Önizleme dağıtımı canlının veritabanını ve ModPOS hakkını paylaşır: çekmez (src/server/modpos/sync.ts canFetchModpos) */
export const MODPOS_PREVIEW = "Önizleme dağıtımı ModPOS API'den çekmez: canlı panelden çekin";
/** İleri tarih ya da takvimde olmayan gün (servis ILERI_TARIH der, hak boşa gitmesin diye istek gitmez) */
export const MODPOS_DAY_INVALID = "Bu gün ModPOS API'den çekilemez: yalnız bugün ve önceki günler çekilir";

const VERB: Record<Exclude<ModposDayResult, "hata">, string> = { yeni: "alındı", degisti: "değişti", ayni: "değişmedi" };

/** Elle çekimin sonucunun girdisi: src/server/modpos/sync.ts'in ModposSyncResult'ı (yapısal; saf modül sunucuyu içe aktarmaz) */
export interface ModposFetchRun {
  status: "off" | "preview" | "busy" | "nothing" | "ok" | "partial" | "kota" | "error";
  days: { day: string; result: ModposDayResult; text?: string; revision?: number }[];
  left: number | null;
  error?: string;
}

/** Çekilen günün saklanan hâli (sonucun metnine): kesin mi ve Z özeti (satışsız günde null) */
export interface ModposFetchedSheet {
  final: boolean;
  z: ModposZ | null;
}

export type ModposFetchOutcome = { ok: true; title: string; description: string; log: string } | { ok: false; error: string };

/**
 * "Bu günü çek"in sonucu → bildirim (başlık + açıklama) ve işlem geçmişi satırı ("2 Kasım 2026 · alındı · kalan hak 1";
 * docs/MODPOS-API.md › Kota). Gün alınamadıysa hata metni: servisin hatası (src/lib/modpos/request.ts modposErrorText) ya
 * da hak doldu. Kesin olmayan föy (gün açık ya da 07:00'den önce) "kesin değil" der: ertesi sabah kendiliğinden yeniden
 * çekilir.
 */
export function modposFetchOutcome(r: ModposFetchRun, day: string, sheet: ModposFetchedSheet | null): ModposFetchOutcome {
  const d = r.days.find((x) => x.day === day);
  if (d && d.result !== "hata") {
    const verb = VERB[d.result];
    const left = r.left === null ? "bilinmiyor" : String(r.left);
    const parts: string[] = [];
    if (sheet) parts.push(sheet.z ? `Ciro ${money(sheet.z.zTotal)} · ${num(sheet.z.receipts)} fiş` : "Satış yok");
    if (sheet && !sheet.final) parts.push("kesin değil: yarın sabah kendiliğinden yeniden çekilir");
    parts.push(`bugün kalan hak ${left}`);
    const description = parts.join(" · ");
    return {
      ok: true,
      title: `${dayMonthYearTR(day)} ModPOS API verisi ${verb}${d.result === "degisti" && d.revision ? ` (sürüm ${d.revision})` : ""}`,
      description: description.charAt(0).toLocaleUpperCase("tr-TR") + description.slice(1),
      log: `${dayMonthYearTR(day)} · ${verb} · kalan hak ${left}`,
    };
  }
  if (r.status === "off") return { ok: false, error: MODPOS_NOT_CONFIGURED };
  if (r.status === "preview") return { ok: false, error: MODPOS_PREVIEW };
  if (r.status === "nothing") return { ok: false, error: MODPOS_DAY_INVALID };
  return { ok: false, error: d?.text ?? r.error ?? "ModPOS API verisi alınamadı: sonra yeniden deneyin" };
}

/**
 * "Bu günü çek"in onay penceresinin cümleleri: kalan hak ("Bugün 2 hak kaldı; çekince 1 kalır."), bugün seçildiyse
 * kasanın o anki hâli gelir (kesin değil), gün zaten saklıysa yeniden çekmenin ne getireceği, son hak harcanırsa sabah
 * işinin o gün başka gün çekemeyeceği (docs/MODPOS-API.md › Kota ve çekme sırası).
 */
export function modposFetchConfirmLines(o: { day: string; today: string; left: number; stored: boolean | null; now?: Date }): string[] {
  const after = Math.max(0, o.left - 1);
  const out = [`Bugün ${o.left} hak kaldı; çekince ${after} kalır.`];
  if (o.day === o.today) out.push("Bugünün kasası henüz kapanmadıysa tutarlar o anki hâliyle gelir (kesin değil); yarın sabah kendiliğinden yeniden çekilir.");
  // Gece yarısından sonra dün henüz kesin değil (ertesi sabah 07:00): şimdi çekilirse sabah işi aynı günü yeniden çeker
  else if (o.now && o.now.getTime() < finalAfter(o.day) && o.stored !== true)
    out.push("Bu günün verisi sabah 07:00'de kesinleşir; şimdi çekilirse kesin olmaz ve sabah işi aynı günü yeniden çeker (iki hak aynı güne gider).");
  else if (o.stored === true) out.push("Bu günün kesin verisi zaten var; yeniden çekmek yalnız kapanıştan sonra yapılan bir düzeltmeyi gösterir.");
  else if (o.stored === false) out.push("Bu günün verisi kesin değil; sabah işi de yeniden çeker.");
  if (after === 0) out.push("Hak bitince sabah işi bugün başka gün çekemez; hak gece yarısı yenilenir.");
  out.push("Çekim bir dakikaya kadar sürebilir.");
  return out;
}

export interface ModposDayBadge {
  tone: ModposTone;
  text: string;
  title?: string;
}

/** Son çekilen günler listesinin girdisi (src/server/modpos/status.ts loadModposCard) */
export interface ModposDayView {
  day: string;
  state: "KAPALI" | "ACIK" | "BOS";
  final: boolean;
  revision: number;
  z: ModposZ | null;
  /** ModPOS'un uyarıları (foyWarnings) */
  warnings: { kod: string; mesaj: string; tutar: number | null }[];
}

/**
 * Günün uyarı metinleri: ModPOS'un kendi uyarıları (tutarıyla) ve föyün kendi içinde tutmaması (ödemelerin toplamı
 * ciroyu tutmuyor, tanınmayan ödeme kodu; docs/MODPOS-API.md › Eşleme)
 */
export function modposDayWarnings(d: Pick<ModposDayView, "z" | "warnings">): string[] {
  const out = d.warnings.map((w) => (w.tutar !== null && w.tutar !== 0 ? `${w.mesaj} (${money(w.tutar)})` : w.mesaj));
  const gap = d.z?.paymentsGap ?? 0;
  if (Math.abs(gap) >= 0.01) out.push(`Ödemelerin toplamı ciroyu tutmuyor (ödemeler ${money(Math.abs(gap))} ${gap < 0 ? "eksik" : "fazla"})`);
  if (d.z?.unknownCodes.length) out.push(`Tanınmayan ödeme kodu: ${d.z.unknownCodes.join(", ")}`);
  return out;
}

/**
 * Son çekilen günün rozetleri: durum (Kapalı / Açık / Kasa açılmadı / Satış yok), kesin değil, değişti (sürüm), uyarı
 * sayısı. Renk her zaman metinle birlikte; uyarı turuncu, gerisi sakin (gri / yeşil / mavi).
 */
export function modposDayBadges(d: ModposDayView): ModposDayBadge[] {
  const out: ModposDayBadge[] = [];
  if (d.state === "KAPALI") out.push({ tone: "green", text: "Kapalı", title: "Bütün kasalar kapanmış" });
  else if (d.state === "ACIK") out.push({ tone: "amber", text: "Açık", title: "Veri alınırken kasa açıktı" });
  else if (d.z?.foysuz) out.push({ tone: "gray", text: "Kasa açılmadı", title: "Kasa açılmadan satış yapılmış; tutarlar kasasız satıştan" });
  else if (!d.final) out.push({ tone: "gray", text: "Satış yoktu", title: "Veri kasa açılmadan alındı; sabah işi kesin veriyi yeniden çeker" });
  else out.push({ tone: "gray", text: "Satış yok", title: "Bu gün kasa açılmamış, satış yok" });
  if (!d.final) out.push({ tone: "gray", text: "Kesin değil", title: "Gün açıkken ya da ertesi sabah 07:00'den önce alındı; sabah işi yeniden çeker" });
  if (d.revision > 1) out.push({ tone: "blue", text: `Sürüm ${d.revision}`, title: "Veri önceki çekimden sonra değişti; önceki özet Kasa'da" });
  const warnings = modposDayWarnings(d);
  if (warnings.length) out.push({ tone: "amber", text: `${warnings.length} uyarı`, title: warnings.join("; ") });
  return out;
}

/**
 * Günün satırının alt metni: "Z 0312 · 214 fiş · ciro 28.450,50 ₺ · nakit 7.320 ₺ · kart 19.880,50 ₺ · kasa tutuyor".
 * Birden çok kasada Z no yerine kasa sayısı; sayım yoksa nedeni (gün açık, 06:00'da kendiliğinden kapandı); kasası
 * açılmamış gün "kasa açılmadı" (tutarlar föysüz satıştan).
 */
export function modposDayLine(z: ModposZ | null): string {
  if (!z) return "Satış yok";
  const parts: string[] = [];
  if (z.foysuz) parts.push("Kasa açılmadı");
  else if (z.zNo) parts.push(`Z ${z.zNo}`);
  else if (z.kasaSayisi > 1) parts.push(`${z.kasaSayisi} kasa`);
  parts.push(`${num(z.receipts)} fiş`, `ciro ${money(z.zTotal)}`, `nakit ${money(z.cash)}`, `kart ${money(z.card)}`);
  if (z.cashDiff !== null) {
    const k = diffKind(z.cashDiff);
    parts.push(k === "even" ? "kasa tutuyor" : `kasa ${money(Math.abs(z.cashDiff))} ${k === "short" ? "eksik" : "fazla"}`);
  } else if (z.noCount === "acik") parts.push("sayım yok (gün açık)");
  else if (z.noCount === "otomatik") parts.push("sayım yok (06:00'da kendiliğinden kapandı)");
  return parts.join(" · ");
}

/** Ay rakamına yedek anahtarının işlem geçmişi metni (docs/MODPOS-API.md › Ay rakamına yedek) */
export function modposFallbackChangeText(prev: boolean, next: boolean): string {
  const t = (v: boolean) => (v ? "açık" : "kapalı");
  return `ModPOS ay rakamına yedek: ${t(prev)} → ${t(next)}`;
}
