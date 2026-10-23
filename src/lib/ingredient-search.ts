/**
 * Reçete önerisindeki malzeme aramasının kuralı (src/app/panel/receteler/ingredient-picker.tsx): hangi malzemeler hangi
 * sırayla görünür, Enter (telefonda "Ara") neyi seçer, "Listede yok" ne zaman çıkar. Arama Türkçe harf, büyük/küçük
 * harf ve aksan farkı gözetmez (looseKey: "cilek" = "Çilek"); aynı ad denetimiyle aynı anahtar, böylece listede
 * görünen ad ikinci kez eklenmez. Saf: tarayıcı ve veritabanı yok, tests/ingredient-search.test.ts sınar.
 */

import { looseKey } from "./count-item";

export interface SearchIngredient {
  id: number;
  name: string;
  category: string;
  active: boolean;
}

export interface IngredientSearch<T extends SearchIngredient> {
  /** Görünen gruplar ve malzemeleri, gösterilecek sırayla */
  groups: (readonly [string, T[]])[];
  /** Adı yazılanla aynı olan malzeme (pasif olsa da): varsa "ekle" çıkmaz */
  exact: T | undefined;
  /** Enter'ın seçeceği malzeme: seçilebilir tam eşleşme ya da tek seçilebilir aday; yoksa Enter seçmez */
  enterPick: T | undefined;
}

/**
 * Eşleşmenin derecesi (küçük önce): 0 ad aynı, 1 ad yazılanla başlar, 2 her sözcük adın bir sözcüğünün başı, 3 ad her
 * sözcüğü içerir. Adı tutmayan malzeme için null.
 */
function nameRank(name: string, q: string, words: string[]): number | null {
  const key = looseKey(name);
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (!words.every((w) => key.includes(w))) return null;
  const nameWords = key.split(" ");
  return words.every((w) => nameWords.some((n) => n.startsWith(w))) ? 2 : 3;
}

/**
 * Önce adlar aranır; hiçbir ad tutmazsa kategori adıyla da aranır ("şurup" yazınca Sos & Şurup grubu). Böylece "Su"
 * yazınca "Sos & Şurup" grubundaki her şey gelmez. Sonuçlar dereceye göre sıralanır (tam ad en üstte; en iyi
 * sonucu taşıyan grup önce), aynı derecede önceki sıra korunur. Pasif malzeme görünür ama seçilemez (satırda seçili
 * olan hariç).
 */
export function searchIngredients<T extends SearchIngredient>(
  grouped: readonly (readonly [string, readonly T[]])[],
  query: string,
  value: number | null,
): IngredientSearch<T> {
  const selectable = (i: T) => i.active || i.id === value;
  const q = looseKey(query);
  if (!q) {
    const groups = grouped.filter(([, list]) => list.length).map(([cat, list]): readonly [string, T[]] => [cat, [...list]]);
    const candidates = groups.flatMap(([, list]) => list).filter(selectable);
    return { groups, exact: undefined, enterPick: candidates.length === 1 ? candidates[0] : undefined };
  }
  const words = q.split(" ");
  const ranked = grouped.map(([cat, list]) => [cat, list.map((i) => ({ i, rank: nameRank(i.name, q, words) }))] as const);
  const byName = ranked.some(([, list]) => list.some((x) => x.rank !== null));
  const catKey = (cat: string) => looseKey(cat);
  const groups = ranked
    .map(([cat, list], order) => {
      const hits = byName
        ? list.filter((x) => x.rank !== null)
        : list.filter((x) => words.every((w) => `${looseKey(x.i.name)} ${catKey(cat)}`.includes(w))).map((x) => ({ ...x, rank: 4 }));
      const sorted = hits.map((x, at) => ({ ...x, at })).sort((a, b) => (a.rank ?? 4) - (b.rank ?? 4) || a.at - b.at);
      return { cat, order, best: sorted[0]?.rank ?? 4, list: sorted.map((x) => x.i) };
    })
    .filter((g) => g.list.length)
    .sort((a, b) => a.best - b.best || a.order - b.order)
    .map((g) => [g.cat, g.list] as const);
  const all = groups.flatMap(([, list]) => list);
  // Aynı adlı iki kayıt kalmışsa (eski kopya) seçilebilir olan
  const exacts = all.filter((i) => looseKey(i.name) === q);
  const exact = exacts.find(selectable) ?? exacts[0];
  const candidates = all.filter(selectable);
  const enterPick = exact ? (selectable(exact) ? exact : undefined) : candidates.length === 1 ? candidates[0] : undefined;
  return { groups, exact, enterPick };
}
