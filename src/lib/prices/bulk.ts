/**
 * Toplu fiyat değişikliğinin saf kısmı (Ürünler › Fiyatlar › Toplu değiştir, docs/FIYATLAR.md): kural (yüzde, tutar,
 * önerilen fiyat), yuvarlama, satır satır önizleme, değiştirilemeyecek satırların nedeni, özet, kuralın metni,
 * sitenin kapalı sayıldığı hatalar ve siteye bağlı satırların yazım sırası (devre kesici, süre). Fiyat hesabı tamsayı
 * kuruşla yapılır (200 × 1,05 = 210,00000000000003 5'e yukarı 215 olmasın). Ekonomi (net, komisyon, birim kâr, oran,
 * durum) priceProduct'ın formülleriyle; testler eşitliği sınar.
 */

import { statusFor, type ProductStatus } from "../calc/engine";
import { parseNumberTR } from "../calc/expr";
import type { Settings } from "../calc/types";
import { SIZE_LABELS } from "../constants";
import { num } from "../format";
import type { PushFailure } from "../site-menu/push";
import { SITE_MONEY_MAX_MINOR } from "../site-menu/schema";
import { fromMinor, toMinor } from "../site-menu/slot";
import type { SiteMarkerKind } from "../site-menu/view";

// ---------------------------------------------------------------- Yuvarlama

export interface Rounding {
  /** Adım (₺); 0 = yuvarlama yok */
  step: 0 | 1 | 5 | 10;
  mode: "up" | "nearest" | "down";
}

export type RoundingId = "5-up" | "5-nearest" | "5-down" | "10-up" | "1-nearest" | "none";

/** Yuvarlama seçenekleri; `short` kuralın özetinde (geçmişte) */
export const ROUNDINGS: { id: RoundingId; label: string; short: string; rounding: Rounding }[] = [
  { id: "5-up", label: "5 ₺'ye yukarı", short: "5 ₺'ye yukarı", rounding: { step: 5, mode: "up" } },
  { id: "5-nearest", label: "5 ₺'ye en yakın", short: "5 ₺'ye en yakın", rounding: { step: 5, mode: "nearest" } },
  { id: "5-down", label: "5 ₺'ye aşağı", short: "5 ₺'ye aşağı", rounding: { step: 5, mode: "down" } },
  { id: "10-up", label: "10 ₺'ye yukarı", short: "10 ₺'ye yukarı", rounding: { step: 10, mode: "up" } },
  { id: "1-nearest", label: "Tam liraya (en yakın)", short: "tam liraya", rounding: { step: 1, mode: "nearest" } },
  { id: "none", label: "Yuvarlama yok", short: "yuvarlama yok", rounding: { step: 0, mode: "nearest" } },
];

export const roundingById = (id: RoundingId) => (ROUNDINGS.find((r) => r.id === id) ?? ROUNDINGS[0]).rounding;

/** Varsayılan yuvarlama (sahibin kararı D4): artışta 5 ₺'ye yukarı, indirimde 5 ₺'ye aşağı */
export function defaultRounding(amount: number): RoundingId {
  return amount < 0 ? "5-down" : "5-up";
}

/** Kuruşu adıma yuvarlar (tamsayı kuruşla; adım 0 ise olduğu gibi) */
export function roundMinor(minor: number, r: Rounding): number {
  if (!r.step) return minor;
  const stepMinor = r.step * 100;
  const q = minor / stepMinor;
  return (r.mode === "up" ? Math.ceil(q) : r.mode === "down" ? Math.floor(q) : Math.round(q)) * stepMinor;
}

// ---------------------------------------------------------------- Kural

export type BulkRule = { kind: "percent" | "amount"; value: number; rounding: Rounding } | { kind: "suggested" };

/**
 * Kuralın yeni fiyatı. Yüzde: kuruşa yuvarlanır, sonra adıma (önce kuruş: kayan nokta 210,00000000000003'ü 215'e
 * çıkarmasın). Tutar: kuruş toplanır, sonra adıma. Önerilen fiyat: fiyat önerilenin altındaysa önerilen, değilse aynı
 * (fiyat düşmez, sahibin kararı D8; reçetesiz ürünün önerileni 0, değişmez).
 */
export function rulePrice(price: number, suggested: number, rule: BulkRule): number {
  if (rule.kind === "suggested") return Math.max(price, suggested);
  const base = toMinor(price);
  const raw = rule.kind === "percent" ? Math.round(base * (1 + rule.value / 100)) : base + toMinor(rule.value);
  return fromMinor(roundMinor(raw, rule.rounding));
}

/**
 * Değişiklik alanının metni: "10", "%10", "10%", "+10", "-5", "7,5", "5 ₺". Boşsa değer de hata da yok (önizleme
 * beklemede). İndirim %100'ü geçemez.
 */
export function parseRuleAmount(text: string, kind: "percent" | "amount"): { value: number | null; error: string | null } {
  let s = text.trim().replace(/\s/g, "").replace(/−/g, "-");
  if (!s) return { value: null, error: null };
  s = s.replace(/^%/, "").replace(/(%|₺|TL)$/i, "");
  let sign = 1;
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  s = s.replace(/^%/, "");
  const v = /^[\d.,]+$/.test(s) ? parseNumberTR(s) : null;
  if (v === null) return { value: null, error: "Sayı yazın (ör. 10 ya da -5)" };
  const value = sign * v;
  if (kind === "percent" && value < -100) return { value: null, error: "İndirim %100'den büyük olamaz" };
  return { value, error: null };
}

// ---------------------------------------------------------------- Ekonomi

export type PriceSettings = Pick<Settings, "kdv" | "komisyon" | "kartOrani" | "hedefMaliyet">;

export interface Econ {
  net: number;
  commission: number;
  unitProfit: number;
  margin: number;
  costRatio: number;
  status: ProductStatus;
}

const safeDiv = (a: number, b: number) => (b ? a / b : 0);

/**
 * Bir fiyatta ürünün ekonomisi; priceProduct'ın (src/lib/calc/engine.ts) formülleri birebir: net = fiyat ÷ (1 + KDV),
 * komisyon = fiyat × komisyon × kartlı oran, birim kâr = net − maliyet − komisyon, fiyatı 0 reçeteli ürün "Düşük kâr".
 */
export function economicsAt(price: number, cost: number, st: PriceSettings): Econ {
  const net = price / (1 + st.kdv);
  const commission = price * st.komisyon * st.kartOrani;
  const unitProfit = net - cost - commission;
  const costRatio = safeDiv(cost, net);
  return {
    net,
    commission,
    unitProfit,
    margin: safeDiv(unitProfit, net),
    costRatio,
    status: cost > 0 && !(net > 0) ? "Düşük kâr" : statusFor(cost, costRatio, st.hedefMaliyet),
  };
}

// ---------------------------------------------------------------- Önizleme

/** Toplu değişikliğe girebilecek bir ürün (sunucu hazırlar) */
export interface BulkRow {
  id: number;
  name: string;
  size: string;
  categoryId: number;
  category: string;
  active: boolean;
  price: number;
  /** Birim maliyet (KDV hariç, fire dahil); reçetesizde 0 */
  cost: number;
  suggestedPrice: number;
  /** laffogato.net işareti; bağlı değilse null */
  site: SiteMarkerKind | null;
  /** Aramada (Ürün listesiyle aynı metin): ürünün notu ve site işaretinin yazısı ("Sitede", "Bağlı değil") */
  note: string | null;
  siteText: string | null;
  /** Ayda satılan adet (salesBasis, standart aya ölçekli); satış verisi yoksa 0 */
  monthlyQty: number;
}

/** Bağlı ve fiyatı siteye yazılacak (kopuk ve sitede olmayan bağlantı engellidir) */
export const isLinked = (site: SiteMarkerKind | null) => site === "linked" || site === "pending";

/**
 * Satırın neden değiştirilemeyeceği (önizlemede gösterilir, işaretlenemez; sunucu planPush'la yeniden denetler).
 * Maliyetin altına inmek engel değil, uyarıdır (Zararına).
 */
export function blockReason(row: { newPrice: number; site: SiteMarkerKind | null }, ctx: { siteConfigured: boolean }): string | null {
  if (!(row.newPrice > 0)) return "Fiyat 0 ₺'ye ya da altına iner";
  if (isLinked(row.site) && toMinor(row.newPrice) > SITE_MONEY_MAX_MINOR) return "Sitenin üst sınırını aşıyor";
  if (row.site === "broken") return "Site bağlantısı kopuk (sitede L fiyatı yok); önce bağlantıyı düzeltin";
  if (row.site === "missing") return "Bağlı kalem sitede yok; bağlantı sonraki eşitlemede kalkar";
  if (isLinked(row.site) && !ctx.siteConfigured) return "Site bağlantısı kurulmamış; siteye bağlı ürünün fiyatı değiştirilemez";
  return null;
}

export interface PreviewRow extends BulkRow {
  newPrice: number;
  /** Fiyat elle yazıldı (kuralın yerine) */
  overridden: boolean;
  /** Yeni fiyat bugünküyle aynı (kuruşuyla) */
  unchanged: boolean;
  /** İşareti kaldırıldı */
  excluded: boolean;
  blocked: string | null;
  /** Fiyat sitede de değişir */
  linked: boolean;
  before: Econ;
  after: Econ;
  /** (yeni birim kâr − bugünkü) × ayda satılan adet */
  monthlyDelta: number;
  /** Uygulanacak: değişiyor, işaretli ve engelsiz */
  applicable: boolean;
}

/**
 * Satır satır önizleme. Elle yazılan fiyat kuralın yerine geçer ve aynı denetimden geçer. `rule` null ise (değişiklik
 * yazılmadı) yalnız elle yazılanlar değişir.
 */
export function previewRows(
  rows: readonly BulkRow[],
  rule: BulkRule | null,
  overrides: ReadonlyMap<number, number>,
  excluded: ReadonlySet<number>,
  st: PriceSettings,
  ctx: { siteConfigured: boolean },
): PreviewRow[] {
  return rows.map((r) => {
    const override = overrides.get(r.id);
    const newPrice = override ?? (rule ? rulePrice(r.price, r.suggestedPrice, rule) : r.price);
    const unchanged = toMinor(newPrice) === toMinor(r.price);
    const blocked = unchanged ? null : blockReason({ newPrice, site: r.site }, ctx);
    const before = economicsAt(r.price, r.cost, st);
    const after = economicsAt(newPrice, r.cost, st);
    const isExcluded = excluded.has(r.id);
    return {
      ...r,
      newPrice,
      overridden: override !== undefined,
      unchanged,
      excluded: isExcluded,
      blocked,
      linked: isLinked(r.site),
      before,
      after,
      monthlyDelta: (after.unitProfit - before.unitProfit) * r.monthlyQty,
      applicable: !unchanged && !isExcluded && !blocked,
    };
  });
}

export interface BulkSummary {
  /** Uygulanacak satır */
  count: number;
  /** Bunlardan sitede de değişen */
  linked: number;
  /** Fiyatı düşen */
  decreases: number;
  /** Ortalama değişim (oran; 0,098 = +%9,8); uygulanacak yoksa null */
  avgPct: number | null;
  /** Maliyet oranının basit ortalaması önce / sonra (reçeteli satırlar, menuAverages kuralı); yoksa null */
  ratioBefore: number | null;
  ratioAfter: number | null;
  /** Ayda brüt kâr farkı (satış adedi aynı kalırsa) */
  monthlyDelta: number;
}

export function bulkSummary(preview: readonly PreviewRow[]): BulkSummary {
  const list = preview.filter((p) => p.applicable);
  const priced = list.filter((p) => p.price > 0);
  const recipe = list.filter((p) => p.before.status !== "Reçete yok");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    count: list.length,
    linked: list.filter((p) => p.linked).length,
    decreases: list.filter((p) => toMinor(p.newPrice) < toMinor(p.price)).length,
    avgPct: avg(priced.map((p) => (p.newPrice - p.price) / p.price)),
    ratioBefore: avg(recipe.map((p) => p.before.costRatio)),
    ratioAfter: avg(recipe.map((p) => p.after.costRatio)),
    monthlyDelta: list.reduce((a, p) => a + p.monthlyDelta, 0),
  };
}

// ---------------------------------------------------------------- Metinler

const NOTE_MAX = 200;
const signed = (v: number) => (v < 0 ? "−" : "+");

/** Kuralın kısa adı: "+%10 · 5 ₺'ye yukarı", "−5 ₺ · yuvarlama yok", "Önerilen fiyata" */
export function ruleText(rule: BulkRule): string {
  if (rule.kind === "suggested") return "Önerilen fiyata";
  const short = ROUNDINGS.find((r) => r.rounding.step === rule.rounding.step && r.rounding.mode === rule.rounding.mode)?.short ?? "yuvarlama yok";
  const amount = rule.kind === "percent" ? `${signed(rule.value)}%${num(Math.abs(rule.value), 2)}` : `${signed(rule.value)}${num(Math.abs(rule.value), 2)} ₺`;
  return `${amount} · ${short}`;
}

/**
 * Geçmişte toplu değişikliğin başlığı: kural, seçilen kategoriler ve boy, elle yazılan fiyat sayısı. En çok 200
 * karakter; sığmayan kategoriler "… +3 kategori" olur.
 */
export function ruleSummary(rule: BulkRule, scope: { categories: string[]; size: string | null }, overrides = 0): string {
  const head = ruleText(rule);
  const tail = [scope.size ? (SIZE_LABELS[scope.size as keyof typeof SIZE_LABELS] ?? scope.size) : null, overrides ? `${num(overrides)} fiyat elle` : null].filter(
    (x): x is string => !!x,
  );
  const join = (cats: string[], rest: number) =>
    [head, cats.length ? `${cats.join(", ")}${rest ? ` … +${num(rest)} kategori` : ""}` : rest ? `+${num(rest)} kategori` : null, ...tail]
      .filter((x): x is string => !!x)
      .join(" · ");
  let n = scope.categories.length;
  let text = join(scope.categories, 0);
  while (text.length > NOTE_MAX && n > 0) {
    n--;
    text = join(scope.categories.slice(0, n), scope.categories.length - n);
  }
  return text.slice(0, NOTE_MAX);
}

/**
 * Sitenin kapalı sayıldığı yazım hataları (toplu değişikliğin devre kesicisi): ağ, zaman aşımı, bağlantı kurulmamış,
 * imza reddi (401) ve sitenin 5xx'i. Bu hatadan sonra sıradaki ürünler siteye hiç gönderilmez (her biri 8 saniye
 * beklemesin); 400, 404 gibi ürüne özgü hatalarda toplu değişiklik sürer.
 */
export function isSiteDown(failure: PushFailure): boolean {
  if (failure.kind !== "http") return true;
  return failure.status === 401 || failure.status >= 500;
}

/** Sitenin yazma hatasının nedeni (pushSaleChange UserError'ın `cause`'una koyar); başka hatada null */
export function pushFailureOf(e: unknown): PushFailure | null {
  const c = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  if (!c || typeof c !== "object") return null;
  const kind = (c as { kind?: unknown }).kind;
  if (kind === "network" || kind === "timeout" || kind === "off") return { kind };
  const status = (c as { status?: unknown }).status;
  if (kind === "http" && typeof status === "number") return { kind, status, field: (c as { field?: string | null }).field ?? null };
  return null;
}

// ---------------------------------------------------------------- Siteye yazım sırası

/** Siteye bağlı bir satırın yazımının sonucu: yazıldı ya da nedeniyle yazılamadı (sitenin hatasıysa `failure`) */
export type SiteWriteOutcome = { ok: true } | { ok: false; reason: string; failure: PushFailure | null };

export const NOT_TRIED_DOWN = "Siteye ulaşılamadı; denenmedi. Tekrar dene.";
export const NOT_TRIED_LATE = "Süre doldu; denenmedi. Tekrar dene.";

/**
 * Siteye bağlı satırların yazım sırası (toplu değişiklik ve geri alması; src/server/prices/batch.ts). Sitenin toplu
 * yazma ucu yok, her satır tek istek. Gruplar (bir site kalemi) en çok `concurrency` tanesi birlikte; grubun içi sırayla:
 * aynı kalemin M ve L'si yarışmasın (öteki boyu güncelleyen yanıt eski L fiyatını geri yazmasın).
 *
 * Devre kesici: bir yazım site kapalı derse (isSiteDown) henüz başlamamış satırlar gönderilmez (NOT_TRIED_DOWN),
 * yoldakiler biter; ürüne özgü hata (400, 404, fiyat bu sırada değişmiş) sırayı durdurmaz. `deadline`'dan (ms, `now`
 * saatiyle) sonra yeni satır başlamaz (NOT_TRIED_LATE). `write` hata atmaz, sonucu döner. Dönen `failed` yazılamayan
 * her satır ve nedeni (bitiş sırasıyla); tests/fiyatlar.test.ts sahte yazımla sınar.
 */
export async function runSiteGroups<T>(
  groups: readonly (readonly T[])[],
  write: (item: T) => Promise<SiteWriteOutcome>,
  opts: { concurrency: number; deadline: number; now?: () => number },
): Promise<{ failed: { item: T; reason: string }[]; siteDown: boolean }> {
  const now = opts.now ?? Date.now;
  const failed: { item: T; reason: string }[] = [];
  let siteDown = false;
  let next = 0;
  const worker = async () => {
    while (next < groups.length) {
      for (const item of groups[next++]) {
        if (siteDown) failed.push({ item, reason: NOT_TRIED_DOWN });
        else if (now() > opts.deadline) failed.push({ item, reason: NOT_TRIED_LATE });
        else {
          const r = await write(item);
          if (r.ok) continue;
          if (r.failure && isSiteDown(r.failure)) siteDown = true;
          failed.push({ item, reason: r.reason });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, groups.length) }, worker));
  return { failed, siteDown };
}
