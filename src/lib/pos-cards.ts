import { FEATURE_ELSEWHERE } from "./branch-features";
import { ALL_BRANCHES, type BranchRow, type BranchScope, DEFAULT_BRANCH_ID, tillBranches } from "./branches";
import { lafposBranchOf } from "./lafpos/switch";
import { modposBranchIds } from "./modpos/sube";

/**
 * Ayarlar'ın LafPOS ve ModPOS kartları seçili şubeye göre (şube kapsamı C P2-2; docs/SUBE.md › Ayarlar'da kasa kartları):
 * kasası o sistem olmayan şube seçiliyken kart "Bu şubede kullanılmıyor" satırına iner ve sistemin kullanıldığı şubeyi
 * seçtiren bağlantıyı gösterir; "Tümü"de kartlar şube adıyla çizilir. Hangi şubenin kasasının ne olduğu kütükten:
 * LafPOS'un şubesi `lafposBranchOf` (kasa kaynağı LafPOS olan şube, yoksa Marina), ModPOS'tan çekilenler `modposBranchIds`
 * (hiç yoksa Tuzla, kartın bugünkü kuralı).
 *
 * Saf: veritabanına ve Next'e bağlı değil; `tests/lafpos-sube.test.ts` doğrudan çalıştırır.
 */

type CardBranch = Pick<BranchRow, "id" | "name" | "kind" | "posSource" | "active" | "sortOrder">;

export type PosCardView =
  /** Kart bölümleriyle: `ids` bölümlerin şubeleri, `named` bölüm ve özet şube adıyla ("Tümü"de birden çok kasa) */
  | { kind: "show"; ids: string[]; named: boolean }
  /** Seçili şubede kullanılmıyor: sistemin kullanıldığı şubeler (o şubeyi seçtiren bağlantılar) */
  | { kind: "elsewhere"; users: { id: string; name: string }[] };

/** Özet satırının metni (kart kapalıyken ve telefonda) */
export const POS_ELSEWHERE = FEATURE_ELSEWHERE;

/** Birden çok kasa açıkken "Tümü"de bölümler şube adıyla */
function namedAll(scope: BranchScope, branches: readonly CardBranch[]): boolean {
  return scope === ALL_BRANCHES && tillBranches(branches).length > 1;
}

/**
 * Kartın görünümü: `used` sistemin kullanıldığı şubeler (sıralı). Seçim "Tümü"yse ya da kütükte yoksa bütün bölümler;
 * seçili şube kullanıyorsa yalnız onunki; kullanmıyorsa "kullanılmıyor". Kullanan şubelerin hiçbiri açık fiziksel şube
 * değilse (tek şubeli eski kurulum: LafPOS'un geri düşüş şubesi kütükte yok) kart bugünkü gibi çizilir, satıra inmez
 */
function cardView(scope: BranchScope, branches: readonly CardBranch[], used: readonly string[]): PosCardView {
  const tills = tillBranches(branches);
  const users = tills.filter((b) => used.includes(b.id)).map((b) => ({ id: b.id, name: b.name }));
  const known = branches.some((b) => b.id === scope && b.active);
  if (scope === ALL_BRANCHES || !known || !users.length) return { kind: "show", ids: [...used], named: namedAll(scope, branches) && users.length > 0 };
  if (used.includes(scope)) return { kind: "show", ids: [scope], named: false };
  return { kind: "elsewhere", users };
}

/** LafPOS kartı: LafPOS'un şubesi (lafposBranchOf) seçiliyken ya da "Tümü"de çizilir */
export function lafposCardView(scope: BranchScope, branches: readonly CardBranch[]): PosCardView {
  return cardView(scope, branches, [lafposBranchOf(branches)]);
}

/** ModPOS kartı: ModPOS'tan çekilen şubeler (hiç yoksa Tuzla); tek şube seçiliyken yalnız onun bölümü */
export function modposCardView(scope: BranchScope, branches: readonly CardBranch[]): PosCardView {
  const ids = modposBranchIds(branches);
  return cardView(scope, branches, ids.length ? ids : [DEFAULT_BRANCH_ID]);
}

/** "Kullanılmıyor" kartının açıklaması: "LafPOS Marina şubesinin kasası; ayarları Marina seçiliyken ya da Tümü'nde görünür." */
export function posElsewhereText(system: string, users: readonly { name: string }[]): string {
  const names = users.map((u) => u.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names.at(-1)}` : (names[0] ?? "");
  const whose = names.length > 1 ? `${list} şubelerinin kasası` : `${list} şubesinin kasası`;
  const when = names.length > 1 ? "o şubelerden biri seçiliyken" : `${list} seçiliyken`;
  return `${system} ${whose}; ayarları ${when} ya da Tümü'nde görünür.`;
}
