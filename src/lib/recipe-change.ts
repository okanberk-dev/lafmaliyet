/**
 * Reçete değişiklik önerisinin saf hesapları: öneri anındaki reçete ile önerilen reçetenin farkı (yönetici "ne nasılmış,
 * ne olmuş" diye görsün), işlem geçmişine giden kısa özet ve iki reçetenin aynı olup olmadığı. Personelin yeni ürün
 * önerisinin denetimi de burada (sayfa ve sunucu aynı kural). Hem sunucu hem tarayıcı kullanır; tests/recete-onay.test.ts
 * ve tests/yeni-urun-onerisi.test.ts sınar.
 */

import type { ProposedProduct, RecipeSnapshot } from "@/server/db/schema";

import { SIZE_LABELS } from "./constants";
import { cleanName, formulaStartMessage, isUnpriced, nameKey, readMoneyText, startsLikeFormula, type MoneyRead } from "./count-item";
import { money, num } from "./format";

export type { ProposedProduct, RecipeSnapshot };
export type SnapshotLine = RecipeSnapshot["items"][number];

export type DiffRow =
  | { kind: "same"; key: string; name: string; unit: string; before: SnapshotLine; after: SnapshotLine }
  | { kind: "changed"; key: string; name: string; unit: string; before: SnapshotLine; after: SnapshotLine; qty: boolean; note: boolean }
  | { kind: "added"; key: string; name: string; unit: string; after: SnapshotLine }
  | { kind: "removed"; key: string; name: string; unit: string; before: SnapshotLine };

export interface RecipeDiff {
  rows: DiffRow[];
  note: { before: string; after: string; changed: boolean };
  added: number;
  removed: number;
  changed: number;
  /** Hiçbir satır ve not değişmedi */
  empty: boolean;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();
/** Formüller boşluk ve büyük/küçük harf farkı gözetmeden karşılaştırılır ("2 * shotcift" = "2*ShotCift") */
const exprKey = (v: string | null | undefined) => clean(v).replace(/^=/, "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");

/** İki satırın miktarı aynı mı: formülde formül metni, düz sayıda değer (kayan nokta payıyla) */
export function sameQty(a: Pick<SnapshotLine, "qty" | "qtyExpr">, b: Pick<SnapshotLine, "qty" | "qtyExpr">): boolean {
  if (a.qtyExpr || b.qtyExpr) return exprKey(a.qtyExpr) === exprKey(b.qtyExpr);
  return Math.abs(a.qty - b.qty) < 1e-9;
}

/**
 * Satırlar malzemeye göre eşleşir; aynı malzeme bir reçetede iki kez geçerse sırayla (1., 2. geçiş) eşleşir.
 * Sonuç önerilen reçetenin sırasındadır, çıkarılan satırlar sonda.
 */
export function diffRecipe(before: RecipeSnapshot, after: RecipeSnapshot): RecipeDiff {
  const keyed = (items: SnapshotLine[]) => {
    const seen = new Map<number, number>();
    return items.map((line) => {
      const n = (seen.get(line.ingredientId) ?? 0) + 1;
      seen.set(line.ingredientId, n);
      return { key: `${line.ingredientId}#${n}`, line };
    });
  };
  const prev = new Map(keyed(before.items).map((x) => [x.key, x.line]));
  const rows: DiffRow[] = [];
  const used = new Set<string>();
  for (const { key, line } of keyed(after.items)) {
    const old = prev.get(key);
    if (!old) {
      rows.push({ kind: "added", key, name: line.name, unit: line.unit, after: line });
      continue;
    }
    used.add(key);
    const qty = !sameQty(old, line);
    const note = clean(old.note) !== clean(line.note);
    rows.push(qty || note ? { kind: "changed", key, name: line.name, unit: line.unit, before: old, after: line, qty, note } : { kind: "same", key, name: line.name, unit: line.unit, before: old, after: line });
  }
  for (const [key, line] of prev) {
    if (!used.has(key)) rows.push({ kind: "removed", key, name: line.name, unit: line.unit, before: line });
  }
  const noteBefore = clean(before.note);
  const noteAfter = clean(after.note);
  const count = (k: DiffRow["kind"]) => rows.filter((r) => r.kind === k).length;
  const added = count("added");
  const removed = count("removed");
  const changed = count("changed");
  // Yalnızca sıra değiştiyse de değişiklik sayılır (barista malzemeyi o sırayla koyar)
  const reordered = !added && !removed && before.items.some((l, i) => l.ingredientId !== after.items[i]?.ingredientId);
  return {
    rows,
    note: { before: noteBefore, after: noteAfter, changed: noteBefore !== noteAfter },
    added,
    removed,
    changed,
    empty: !added && !removed && !changed && !reordered && noteBefore === noteAfter,
  };
}

/**
 * Değişiklik önerisinde maliyet farkını taşıyan satırların (eklenen ya da miktarı değişen) paket fiyatı tahmini olan
 * malzemeleri: öneride "Yeni malzeme" ile personelin yazdığı ya da faturadan gelmemiş fiyat. Onaylar'daki reçete kartı
 * "Tahmini fiyatlı" diye söyler; fiyatı hiç girilmemiş olanlar (isUnpriced) ayrı uyarıdadır.
 */
export function estimateNames(
  before: RecipeSnapshot,
  after: RecipeSnapshot,
  ingById: ReadonlyMap<number, { name: string; active: boolean; priceSource: string; packagePrice: number; isEstimate: boolean }>,
): string[] {
  const names = diffRecipe(before, after).rows.flatMap((r) => {
    if (r.kind !== "added" && !(r.kind === "changed" && r.qty)) return [];
    const ing = ingById.get(r.after.ingredientId);
    return ing && ing.isEstimate && !isUnpriced(ing) ? [ing.name] : [];
  });
  return [...new Set(names)];
}

/** İki reçete aynı mı (onayda: öneriden sonra reçete değişti mi) */
export function sameRecipe(a: RecipeSnapshot, b: RecipeSnapshot): boolean {
  return diffRecipe(a, b).empty;
}

/** "18 gr", formülde "2*ShotCift (36 gr)" */
export function qtyLabel(line: Pick<SnapshotLine, "qty" | "qtyExpr" | "unit">): string {
  const value = `${num(line.qty, 3)} ${line.unit}`.trim();
  return line.qtyExpr ? `${line.qtyExpr.replace(/^=/, "")} (${value})` : value;
}

/** İşlem geçmişi ve bildirim için tek satır: "Süt 200 → 220 ml; Karamel eklendi (10 ml); Şeker çıkarıldı; not değişti" */
export function summarizeDiff(diff: RecipeDiff, max = 400): string {
  const parts: string[] = [];
  for (const r of diff.rows) {
    if (r.kind === "added") parts.push(`${r.name} eklendi (${qtyLabel(r.after)})`);
    else if (r.kind === "removed") parts.push(`${r.name} çıkarıldı`);
    else if (r.kind === "changed") parts.push(r.qty ? `${r.name} ${qtyLabel(r.before)} → ${qtyLabel(r.after)}` : `${r.name} satır notu değişti`);
  }
  if (diff.note.changed) parts.push("hazırlama notu değişti");
  if (!parts.length) return diff.empty ? "değişiklik yok" : "malzeme sırası değişti";
  const text = parts.join("; ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Onay bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

// ---------------------------------------------------------------- Yeni ürün önerisi

export type RequestKind = "change" | "new";
export type ProductSize = ProposedProduct["size"];

/** Yeni ürün önerisinin "öneri anındaki reçetesi": ürün henüz yok */
export const EMPTY_SNAPSHOT: RecipeSnapshot = { note: null, items: [] };

export const NEW_PRODUCT_NAME_MIN = 2;
export const NEW_PRODUCT_NAME_MAX = 120;

/** "Çilekli Latte · Medium" (ekranda boyun uzun adı, Reçete defteri ve onaylarla aynı) */
export const productSizeLabel = (name: string, size: ProductSize) => `${name} · ${SIZE_LABELS[size]}`;

/**
 * Cümle içinde boy: "Medium boyu", "Large boyunu", "tek boyunun" (`suffix` u, nu, nun: boyu, boyunu, boyunun).
 * SIZE_LABELS.Tek zaten "Tek boy" olduğu için "Tek boy boyu" yazılmasın (öneri penceresinin "Tek boydan kopyala"sı
 * gibi). Birden çok boy çoğul: "Medium ve tek boyları", "boylarını", "boylarının".
 */
export function sizePhrase(sizes: ProductSize | readonly ProductSize[], suffix: "u" | "nu" | "nun" = "u"): string {
  const list = typeof sizes === "string" ? [sizes] : [...sizes];
  const names = list.map((x) => (x === "Tek" ? "tek" : SIZE_LABELS[x]));
  const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names.at(-1)}` : (names[0] ?? "");
  const word = names.length > 1 ? { u: "boyları", nu: "boylarını", nun: "boylarının" }[suffix] : { u: "boyu", nu: "boyunu", nun: "boyunun" }[suffix];
  return `${joined} ${word}`;
}

export interface NewProductDraft {
  name: string;
  categoryId: number | null;
  /** Seçilen boylar ve her boyun reçete satırı sayısı */
  sizes: { size: ProductSize; lines: number }[];
}

/**
 * Yeni ürün önerisinin denetimi (öneri penceresi ve sunucu aynı kural): ad 2–120 harf, kategori, en az bir boy, her
 * boyda en az bir malzeme; aynı ad + boyda ürün (pasif de olsa) ya da bekleyen yeni ürün önerisi yok. Ad Türkçe büyük /
 * küçük harf ve boşluk farkı gözetmeden karşılaştırılır (nameKey). Ad =, +, - ya da @ ile başlamaz (Ürünler'in CSV'si
 * Excel'de formül çalıştırmasın). İlk sorunun metni döner, sorun yoksa null.
 */
export function newProductIssue(
  draft: NewProductDraft,
  existing: { name: string; size: string }[],
  pending: { name: string; size: string }[],
): string | null {
  const name = cleanName(draft.name);
  if (!name) return "Ürün adını yazın";
  if (name.length < NEW_PRODUCT_NAME_MIN) return `Ürün adı en az ${NEW_PRODUCT_NAME_MIN} harf olmalı`;
  if (name.length > NEW_PRODUCT_NAME_MAX) return "Ürün adı çok uzun";
  if (startsLikeFormula(name)) return formulaStartMessage("Ürün adı");
  if (!draft.categoryId) return "Kategori seçin";
  if (!draft.sizes.length) return "En az bir boy seçin";
  for (const s of draft.sizes) {
    const taken = takenIssue(name, s.size, existing, pending);
    if (taken) return taken;
    if (!s.lines) return `${SIZE_LABELS[s.size]} için en az bir malzeme ekleyin`;
  }
  return null;
}

/** Personelin önerdiği satış fiyatının üst sınırı (KDV dahil, boy başına) */
export const PROPOSED_PRICE_MAX = 10_000;

/**
 * "Satış fiyatı (₺, KDV dahil)": personel boy başına yazabilir, boş bırakabilir. Yazılan fiyat bir ipucudur: yönetici
 * Onaylar'da önceden dolu görür, onaylarken değiştirebilir. Sunucu aynı sınırları zod ile uygular.
 */
export function readProposedPrice(text: string): MoneyRead {
  return readMoneyText(text, { label: "Satış fiyatı", accusative: "Satış fiyatını", max: PROPOSED_PRICE_MAX });
}

/** Aynı ad + boyda ürün ya da bekleyen öneri varsa metni (öneri penceresi adın altında hemen gösterir), yoksa null */
export function takenIssue(name: string, size: ProductSize, existing: { name: string; size: string }[], pending: { name: string; size: string }[]): string | null {
  const key = nameKey(name);
  if (!key) return null;
  const label = productSizeLabel(cleanName(name), size);
  if (existing.some((p) => p.size === size && nameKey(p.name) === key)) return `“${label}” zaten var`;
  if (pending.some((p) => p.size === size && nameKey(p.name) === key)) return `“${label}” için bekleyen bir öneri var`;
  return null;
}

/**
 * Aynı ad + boyda bekleyen yeni ürün önerisi varsa metni (Türkçe büyük/küçük harf ve boşluk farkı gözetmeden), yoksa
 * null. Öneri bekliyorken aynı ürün başka yoldan (Ürünler › Yeni ürün, Site menüsü › "Panelde aç ve bağla") açılırsa
 * öneri "zaten var"a takılır, personelin reçetesi ürüne ulaşmaz (denetim B14): önce öneri karara bağlanır. Sunucu yeni
 * ürün kilidi altında, pencere göndermeden söyler. `then`: metnin sonu ("önce Onaylar'da onaylayın …").
 */
export function pendingProposalIssue(
  name: string,
  sizes: readonly ProductSize[],
  pending: readonly { name: string; size: ProductSize; by: string }[],
  then: string,
): string | null {
  const key = nameKey(name);
  if (!key) return null;
  const hit = pending.find((p) => sizes.includes(p.size) && nameKey(p.name) === key);
  if (!hit) return null;
  return `“${productSizeLabel(hit.name, hit.size)}” için ${genitive(hit.by)} bekleyen yeni ürün önerisi var: ${then}`;
}

const SIZE_ORDER: ProductSize[] = ["M", "L", "Tek"];

/**
 * Zil: bekleyen yeni ürün önerileri ad (nameKey) ve öneren başına tek satır, boyları birlikte, en eskisi önce.
 * "Yeni ürün önerisi: Çilekli Latte · Medium, Large (Ayşe)". Personel satış fiyatı yazdıysa `body`'de boy boy:
 * "Önerilen fiyat: Medium 165 ₺, Large 185 ₺".
 */
export function groupNewProposals<T extends { id: number; name: string; size: ProductSize; by: string; message: string | null; price?: number | null }>(
  rows: T[],
): { ids: number[]; name: string; sizes: ProductSize[]; by: string; message: string | null; title: string; body: string }[] {
  type Group = { ids: number[]; name: string; sizes: ProductSize[]; by: string; message: string | null; prices: Map<ProductSize, number> };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${nameKey(r.name)}|${r.by}`;
    const g: Group = groups.get(key) ?? { ids: [], name: r.name, sizes: [], by: r.by, message: r.message, prices: new Map() };
    g.ids.push(r.id);
    if (!g.sizes.includes(r.size)) g.sizes.push(r.size);
    if (r.price && !g.prices.has(r.size)) g.prices.set(r.size, r.price);
    g.message ??= r.message;
    groups.set(key, g);
  }
  return [...groups.values()].map(({ prices, ...g }) => {
    const sizes = [...g.sizes].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
    const priced = sizes.filter((x) => prices.has(x)).map((x) => `${SIZE_LABELS[x]} ${money(prices.get(x))}`);
    const body = [priced.length ? `Önerilen fiyat: ${priced.join(", ")}` : null, g.message ? `Not: ${g.message}` : null].filter(Boolean).join(" · ");
    return { ...g, sizes, title: `Yeni ürün önerisi: ${g.name} · ${sizes.map((x) => SIZE_LABELS[x]).join(", ")} (${g.by})`, body: body || "Satış fiyatını yazıp onaylayın" };
  });
}

/** Reçete defterindeki şerit: "2 reçete değişikliği ve 1 yeni ürün önerisi onay bekliyor" */
export function pendingSummary(changes: number, newProducts: number): string {
  const parts = [changes ? `${num(changes)} reçete değişikliği` : null, newProducts ? `${num(newProducts)} yeni ürün önerisi` : null].filter(Boolean);
  return parts.length ? `${parts.join(" ve ")} onay bekliyor` : "";
}

/**
 * Türkçe tamlayan eki, kesme işaretiyle: "Ayşe'nin", "Mehmet'in", "Can'ın", "Oğuz'un", "Gül'ün" (son ünlüye göre;
 * ünlüyle biten ada n kaynaştırması). İşlem geçmişindeki "… · Ayşe'nin önerisi" için.
 */
export function genitive(name: string): string {
  const n = name.trim();
  const lower = n.toLocaleLowerCase("tr-TR");
  const vowels = "aeıioöuü";
  const last = [...lower].reverse().find((c) => vowels.includes(c)) ?? "e";
  const v = "aı".includes(last) ? "ı" : "ei".includes(last) ? "i" : "ou".includes(last) ? "u" : "ü";
  return `${n}'${vowels.includes(lower.at(-1) ?? "") ? "n" : ""}${v}n`;
}

// ---------------------------------------------------------------- Yeni ürün önerisinin onayı (denetim E-55)

/**
 * Yeni ürün önerisinin grubu: aynı kişinin aynı adla (önerdiği ad, nameKey) başka boylarda önerdikleri aynı ürünün
 * boylarıdır ("Cilekli latte" M ve L). Kişinin hesabı silindiyse (requestedBy boş) adıyla. Yönetici bir boyu başka
 * adla onaylarsa öteki boy da o adı alır: M/L çifti POS eşleşmesinde, site bağında, reçete defterinde ve analizde
 * aynı adı ister. Grup önerilen adla kurulur (onaydaki adla değil): onaydan sonra da aynı kalır.
 */
export function proposalGroupKey(r: { requestedBy: number | null; requestedByName: string; name: string }): string {
  return `${r.requestedBy !== null ? `u${r.requestedBy}` : `ad:${nameKey(r.requestedByName)}`}|${nameKey(r.name)}`;
}

/**
 * Onaylanan boyun adı. Önerinin öteki boyu daha önce eklendiyse (`pair`: o ürünün bugünkü adı ve boyu) ad onunkidir:
 * yalnız büyük/küçük harf ve boşluk farkıyla yazılan ad o ada döner, başka bir ad reddedilir. Öteki boy yoksa yazılan ad.
 */
export function pairedName(typed: string, size: ProductSize, pair: { name: string; size: string } | null): { name: string; error: null } | { name: null; error: string } {
  const name = cleanName(typed);
  if (!pair || nameKey(pair.name) === nameKey(name)) return { name: pair ? pair.name : name, error: null };
  const pairSize = pair.size in SIZE_LABELS ? sizePhrase(pair.size as ProductSize) : `${pair.size} boyu`;
  return {
    name: null,
    error: `Bu önerinin ${pairSize} “${pair.name}” adıyla eklendi; ${sizePhrase(size, "nu")} da aynı adla onaylayın (iki boy tek ürün olarak eşleşsin)`,
  };
}

/**
 * Formülü bugünkü ayarlarla negatif (ya da sayı olmayan) çıkan satır onaylanmaz: reçeteye eksi miktar yazılırsa
 * maliyet ve stok tüketimi ters işler. Personel önerirken denetlenir; ayar sonradan değişmiş olabilir.
 */
export function negativeQtyIssue(line: Pick<SnapshotLine, "name" | "qtyExpr" | "unit">, qty: number): string | null {
  if (Number.isFinite(qty) && qty >= 0) return null;
  const expr = line.qtyExpr ? line.qtyExpr.replace(/^=/, "").trim() : "";
  const fix = "öneri onaylanamaz. Ayarlar'daki ölçüyü düzeltin ya da öneriyi reddedin";
  if (!Number.isFinite(qty)) return `${line.name}: miktar bugünkü ayarlarla hesaplanamıyor${expr ? ` (${expr})` : ""}; ${fix}`;
  const value = `${num(qty, 3)} ${line.unit}`.trim();
  return `${line.name}: miktar bugünkü ayarlarla negatif çıkıyor (${expr ? `${expr} = ${value}` : value}); ${fix}`;
}

/** Arada pasife alınan malzeme: yeni ürünün reçetesine yazılmaz (öneri penceresi de pasif malzemeyi seçtirmez) */
export function inactiveIngredientsIssue(names: readonly string[]): string | null {
  if (!names.length) return null;
  return `${[...new Set(names)].join(", ")} pasif; öneri onaylanamaz. Malzemeyi Hammaddeler › Pasif'ten yeniden açın ya da öneriyi reddedin`;
}
