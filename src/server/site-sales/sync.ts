import "server-only";

import { eq, like, sql, type SQL } from "drizzle-orm";

import { salesMonthsToPull, siteBranchMatches, siteBranchOf, tillRowOrNull, type SiteBranch, type TillOnlineRow } from "@/lib/site-sales/calc";
import { monthRange, parseSiteSales, readSalesRecord, SiteSalesFormatError, type SiteSales, type SiteSalesMonth } from "@/lib/site-sales/schema";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { signedSiteFetch, siteLinkSecret, siteUrl } from "@/server/site-link";

/**
 * laffogato.net'in online satışları → panel (docs/SITE-SATIS.md; sözleşme sitenin docs/PANEL-SALES.md'si): imzalı
 * `GET /api/panel/sales?month=YYYY-MM` ay başına bir kayıt olarak saklanır (integration_state `site_sales:YYYY-MM`;
 * yeniden çekmek üzerine yazar, eski bir yanıt yenisinin üstüne yazılmaz). Kâr-zarar (ayrı gelir satırları, KDV hariç)
 * ve tutarlılık (kafe satırlarının tüketimi) bu kayıtları hesap motoruna verir (src/server/data/dataset.ts).
 *
 * Ne zaman: günlük iş (içinde bulunulan ay ve önceki iki ay: cayma hakkıyla dönen koli ya da ileri tarihli karaokenin
 * iptali kapanmış ayı haftalar sonra düşürür; salesMonthsToPull) ve Gelir-gider'deki "Siteden yenile". Kasa raporunun
 * günlük satırı (`?from=GÜN&to=GÜN`) saklanmaz, rapor açılınca, gönderilince ve e-postalanınca sorulur; site düşük ya da
 * yavaşsa (8 sn) satır görünmez, rapor hiç beklemez / bozulmaz.
 *
 * KVKK: siteden yalnız toplamlar ve ürün satırları gelir (müşteri adı, e-posta, sipariş numarası yok).
 */

const STATE_KEY = "site_sales_sync";
const MONTH_PREFIX = "site_sales:";
const monthKey = (month: string) => `${MONTH_PREFIX}${month}`;
/** Elle çekilebilecek en eski ay: sitenin online siparişleri bundan önce yok */
export const SITE_SALES_FIRST_MONTH = "2026-01";

export interface SalesSyncState {
  /** Son çekme denemesi (başarılı ya da değil) */
  lastPullAt: string | null;
  /** Son başarılı çekme */
  lastOkAt: string | null;
  /** Son denemenin hatası (başarılıysa null) */
  lastError: string | null;
  /** Son denenen ay */
  lastMonth: string | null;
}

const EMPTY: SalesSyncState = { lastPullAt: null, lastOkAt: null, lastError: null, lastMonth: null };

type Exec = { execute: (query: SQL) => Promise<unknown> };

export async function readSalesState(): Promise<SalesSyncState> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, STATE_KEY)).limit(1);
  return { ...EMPTY, ...((row?.value as Partial<SalesSyncState> | undefined) ?? {}) };
}

async function patchState(patch: Partial<SalesSyncState>, db: Exec = getDb()): Promise<void> {
  await db.execute(sql`
    insert into integration_state (key, value) values (${STATE_KEY}, ${JSON.stringify(patch)}::jsonb)
    on conflict (key) do update set value = integration_state.value || ${JSON.stringify(patch)}::jsonb, updated_at = now()`);
}

/** Saklanan bütün aylar (hesap motoru için; okunamayan kayıt atlanır) */
export async function loadSiteSales(): Promise<SiteSalesMonth[]> {
  const rows = await getDb()
    .select({ value: s.integrationState.value })
    .from(s.integrationState)
    // "_" LIKE'ta tek karakter demek: önek harfiyen aransın
    .where(like(s.integrationState.key, `${MONTH_PREFIX.replace(/_/g, "\\_")}%`));
  return rows.flatMap((r) => readSalesRecord(r.value) ?? []).sort((a, b) => a.month.localeCompare(b.month));
}

/** Sitenin hata yanıtının yöneticiye okunur açıklaması */
export function salesFailureMessage(failure: { kind: "timeout" } | { kind: "network" } | { kind: "http"; status: number }): string {
  if (failure.kind === "timeout") return "Site 8 saniyede yanıt vermedi";
  if (failure.kind === "network") return "Siteye ulaşılamadı";
  switch (failure.status) {
    case 401:
      return "Site isteği reddetti (imza): iki projedeki KARAOKE_SYNC_SECRET aynı mı, sunucu saatleri doğru mu?";
    case 404:
      return "Sitede panel satış ucu yok (laffogato.net güncel değil)";
    case 400:
      return "Site dönemi kabul etmedi (geçersiz dönem)";
    case 422:
      return "Dönemde çok sipariş var; site ay ay değil gün gün sorulmalı";
    case 503:
      return "Sitede KARAOKE_SYNC_SECRET tanımlı değil ya da sitenin veritabanı okunamadı";
    default:
      return `Site yanıt vermedi (HTTP ${failure.status})`;
  }
}

class SalesRequestError extends Error {}

/**
 * Sitenin bir dönemin satışı (imzalı). Hata: SalesRequestError, Türkçe açıklamalı. `branch` verilirse `&branch=` ile o
 * şubenin siparişleri istenir ve yanıtın şubesi denetlenir (siteBranchMatches); verilmezse bütün şubeler (aylık kayıt:
 * işletmenin cirosu)
 */
async function fetchSales(secret: string, range: { from: string; to: string }, query: Record<string, string>, branch?: SiteBranch): Promise<SiteSales> {
  const url = new URL("/api/panel/sales", siteUrl());
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  if (branch) url.searchParams.set("branch", branch);
  let res: Response;
  try {
    res = await signedSiteFetch(secret, url);
  } catch (e) {
    throw new SalesRequestError(salesFailureMessage(e instanceof Error && e.name === "TimeoutError" ? { kind: "timeout" } : { kind: "network" }));
  }
  if (!res.ok) throw new SalesRequestError(salesFailureMessage({ kind: "http", status: res.status }));
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new SalesRequestError("Sitenin satış yanıtı okunamadı");
  }
  if (branch && !siteBranchMatches(branch, (json as { branch?: unknown } | null)?.branch)) throw new SalesRequestError("Site şubeye göre satış vermedi (laffogato.net güncel değil)");
  try {
    return parseSiteSales(json, range);
  } catch (e) {
    throw new SalesRequestError(e instanceof SiteSalesFormatError ? e.message : "Sitenin satış yanıtı okunamadı");
  }
}

export type SalesPullResult = { month: string; status: "ok"; record: SiteSalesMonth } | { month: string; status: "error"; error: string };

/**
 * Bir ayı çeker ve saklar. Aynı ay için daha yeni bir yanıt (site saatine göre) zaten yazıldıysa eskisi yazılmaz.
 * Hata olursa önceki kayıt olduğu gibi kalır, yalnız durum yazılır.
 */
async function pullMonth(secret: string, month: string): Promise<SalesPullResult> {
  const range = monthRange(month);
  let sales: SiteSales;
  try {
    sales = await fetchSales(secret, range, { month });
  } catch (e) {
    return { month, status: "error", error: (e instanceof Error ? e.message : "Bilinmeyen hata").slice(0, 300) };
  }
  const record: SiteSalesMonth = { ...sales, month, pulledAt: new Date().toISOString() };
  const value = JSON.stringify(record);
  await getDb().execute(sql`
    insert into integration_state (key, value) values (${monthKey(month)}, ${value}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
      where (integration_state.value->>'now') is null
         or (integration_state.value->>'now')::timestamptz <= (excluded.value->>'now')::timestamptz`);
  return { month, status: "ok", record };
}

/**
 * Ayları çeker ve saklar (aylar aynı anda sorulur: site yavaşsa günlük iş en çok 8 saniye bekler). Aynı ay için daha
 * yeni bir yanıt (site saatine göre) zaten yazıldıysa eskisi yazılmaz. Bir ay çekilemezse önceki kaydı olduğu gibi
 * kalır, öteki aylar yine yazılır; durum (son deneme, son hata) bir kez yazılır.
 */
export async function syncSiteSales(months: string[] = salesMonthsToPull(todayTR())): Promise<{ status: "off" } | { status: "ok" | "error"; results: SalesPullResult[] }> {
  const secret = siteLinkSecret();
  if (!secret) return { status: "off" };
  const tryAt = new Date().toISOString();
  const results = await Promise.all(months.map((m) => pullMonth(secret, m)));
  const failed = results.filter((r): r is Extract<SalesPullResult, { status: "error" }> => r.status === "error");
  const ok = results.find((r) => r.status === "ok");
  await patchState({
    lastPullAt: tryAt,
    lastError: failed.length ? failed.map((r) => `${r.month}: ${r.error}`).join(" · ").slice(0, 300) : null,
    lastMonth: months[0] ?? null,
    ...(ok ? { lastOkAt: new Date().toISOString() } : {}),
  });
  return { status: failed.length ? "error" : "ok", results };
}

/**
 * Kasa raporunun bilgi satırı: o günün online satışı ve karaoke ön ödemesi (sitenin günü, gece yarısında biter), kasanın
 * şubesinin (`&branch=tuzla|marina`; verilmezse Tuzla, siteBranchOf). Saklanmaz; bağlantı kapalı, site düşük ya da yavaş
 * (8 sn) ise, yanıt okunamazsa ya da başka şubenin rakamıysa null: rapor satırsız gider, hiçbir zaman beklemez ya da
 * bozulmaz. Kasa farkına ve hiçbir kasa rakamına girmez.
 */
export async function fetchTillOnlineRow(day: string, branchId?: string | null): Promise<TillOnlineRow | null> {
  const secret = siteLinkSecret();
  const branch = siteBranchOf(branchId);
  if (!secret || !branch || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return tillRowOrNull(day, () =>
    fetchSales(secret, { from: day, to: day }, { from: day, to: day }, branch).catch((e: unknown) => {
      console.warn("[satis] kasa raporu satırı alınamadı:", e instanceof Error ? e.message : "bilinmeyen hata");
      throw e;
    }),
  );
}

/**
 * Kapalı gün kanıtı (docs/KASA-RAPORU.md › Kafe kapalıydı): sitenin o günkü kafe, elle girilen, kasada ödenen ve mağaza
 * sipariş sayıları (tutar yok; sitenin günü gece yarısında biter), kapalı bildirilen şubenin (`&branch=tuzla|marina`;
 * verilmezse Tuzla, siteBranchOf; docs/SUBE.md › Kapalı gün): Tuzla'nın siparişleri Marina'nın kapalı gününü kapatmasın.
 * Saklanmaz; bağlantı kapalı, site düşük ya da yavaş (8 sn) ise, yanıt başka şubenin rakamıysa (şubesiz eski site Marina
 * için) ya da şubenin sitede karşılığı yoksa null: yönetici kartı "site okunamadı" der, onayı kapatmaz.
 */
export async function fetchSiteDayCounts(day: string, branchId?: string | null): Promise<{ cafe: number; manual: number; counter: number; shop: number } | null> {
  const secret = siteLinkSecret();
  const branch = siteBranchOf(branchId);
  if (!secret || !branch || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  try {
    const sales = await fetchSales(secret, { from: day, to: day }, { from: day, to: day }, branch);
    return { cafe: sales.cafe.orders, manual: sales.manual.orders, counter: sales.counter?.orders ?? 0, shop: sales.shop.orders };
  } catch (e) {
    console.warn("[satis] kapalı gün için site sayıları alınamadı:", e instanceof Error ? e.message : "bilinmeyen hata");
    return null;
  }
}
