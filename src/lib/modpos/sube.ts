import { DEFAULT_BRANCH_ID, type BranchRow } from "@/lib/branches";

import type { FoyEkAlan, KasaFoyu } from "./foy";

/**
 * ModPOS föyünün şube şube ayrılması (docs/MODPOS-API.md › Şubeler; sahibin kararı, 4 Kasım 2026: "Şube başına ayrı
 * anahtar; günlük 2 çekim hakkı şube başına"; 16 Kasım 2026: "şube şube ayır, karıştırma"). Saf: sunucu, betik ve
 * testler paylaşır (tests/modpos-sube.test.ts).
 *
 * İki kural birlikte çalışır:
 *
 * 1. **Anahtar şubenindir.** Tuzla'nın anahtarı `MODPOS_API_KEY` (eski ad, değişmedi), öteki şubeninki
 *    `MODPOS_API_KEY_<KİMLİK>` (`MODPOS_API_KEY_MARINA`). Şubenin anahtarı yoksa o şube için istek gitmez; Tuzla'nın
 *    anahtarına **düşülmez** (düşülseydi Tuzla'nın föyü Marina'nın günü diye yazılırdı). Başka bir şubenin anahtarıyla
 *    aynı anahtar "ortak" sayılır ve kullanılmaz: aynı föy iki şubeye yazılmasın, hak iki kez harcanmasın.
 * 2. **Föyün içi de ayrılır.** Gafdigi'nin anahtarı markaya bağlıysa tek föy birden çok şubenin kasasını taşır
 *    (her `<kasa>` ve `<foysuzGun>` kendi `<sube>`'siyle). Her kasa adından panelin şubesine bağlanır
 *    (`MODPOS_SUBELER` eşlemesi, yoksa adın içinde şubenin adı ya da kimliği geçiyor mu); başka şubenin kasası o
 *    şubenin gününe yazılır, çekenin gününe girmez. Kendi anahtarı olan şubenin kasası başka anahtarın föyünden
 *    alınmaz (kendi föyü esastır). Föyde birden çok şube adı varken bağlanamayan ad hiçbir şubeye yazılmaz (yanlış
 *    şubeye yazmaktansa beklemek): çalışmanın metninde ve Ayarlar kartında söylenir.
 *
 * Föyde tek şube adı varsa (bugünkü durum) föy olduğu gibi çekenin şubesine yazılır: parmak izi değişmez, eski günler
 * "değişti" sayılmaz.
 */

type Env = Record<string, string | undefined>;

/** Şubenin anahtarının ortam değişkeni: Tuzla `MODPOS_API_KEY`, öteki `MODPOS_API_KEY_MARINA` (tire alt çizgi olur) */
export function modposKeyEnv(branchId: string): string {
  return branchId === DEFAULT_BRANCH_ID ? "MODPOS_API_KEY" : `MODPOS_API_KEY_${branchId.toUpperCase().replace(/-/g, "_")}`;
}

/** Elle eşlemenin ortam değişkeni: `ModPOS'taki şube adı=şube kimliği`, `;` ya da satır sonuyla ayrılır */
export const MODPOS_SUBE_MAP_ENV = "MODPOS_SUBELER";

/**
 * Adın karşılaştırma biçimi: Türkçe harfler düzleşir, küçük harf, yalnız harf ve rakam ("LAF FOGATO TUZLA ŞB." →
 * "laffogatotuzlasb")
 */
export function subeKey(name: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return [...name.normalize("NFC").toLocaleLowerCase("tr-TR")]
    .map((h) => map[h] ?? h)
    .join("")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** `MODPOS_SUBELER`'in okunmuşu: ad anahtarı → şube kimliği (bozuk parça atlanır) */
export function parseModposSubeMap(env: Env): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (env[MODPOS_SUBE_MAP_ENV] ?? "").split(/[;\n]/)) {
    const at = part.lastIndexOf("=");
    if (at <= 0) continue;
    const key = subeKey(part.slice(0, at));
    const id = part.slice(at + 1).trim();
    if (key && id) out.set(key, id);
  }
  return out;
}

/** Ad eşlemesinde en kısa ad: "Ka" gibi kısa bir şube adı her kasa adının içinde geçmesin */
const MIN_MATCH = 3;

/**
 * ModPOS'taki şube adını panelin şubesine bağlar: önce elle eşleme (yalnız bilinen şubeye), sonra adın içinde
 * fiziksel şubenin adı ya da kimliği geçiyor mu (tek şube geçiyorsa). Bağlanamazsa null.
 */
export function resolveModposSube(name: string, branches: readonly Pick<BranchRow, "id" | "name" | "kind">[], map: ReadonlyMap<string, string> = new Map()): string | null {
  const key = subeKey(name);
  if (!key) return null;
  const physical = branches.filter((b) => b.kind === "fiziksel");
  const mapped = map.get(key);
  if (mapped !== undefined) return physical.some((b) => b.id === mapped) ? mapped : null;
  const hits = physical.filter((b) => [subeKey(b.name), subeKey(b.id)].some((k) => k.length >= MIN_MATCH && key.includes(k)));
  return hits.length === 1 ? hits[0].id : null;
}

export interface FoySplit {
  /** Şube → o şubenin föyü. Çekenin şubesi hep vardır (kasası yoksa boş föy: gün "çekildi" sayılsın) */
  parts: Map<string, KasaFoyu>;
  /** Hiçbir şubeye bağlanamadığı için yazılmayan ModPOS şube adları */
  unmatched: string[];
  /** Kendi anahtarı olan şubeye ait olduğu için bu föyden alınmayan şubeler */
  skipped: string[];
}

export interface SplitOptions {
  /** Föyü çeken anahtarın şubesi */
  own: string;
  /** Adı şubeye bağlayan işlev (resolveModposSube) */
  resolve: (sube: string) => string | null;
  /** Kendi anahtarı olan şubeler: başka anahtarın föyünden kasaları alınmaz */
  keyed?: ReadonlySet<string>;
  /**
   * Kasası ModPOS olan şubeler (modposBranchIds; çok şube, 27 Kasım 2026). Verilirse kasası ModPOS olmayan şubeye
   * (AsilPOS'a geçmiş Marina) hiçbir föy yazılmaz: başka şubenin föyünde görünen kasası atlanır (`skipped`)
   */
  modposIds?: ReadonlySet<string>;
}

/** `kasa.3.x` → 3; tek kasada yol sırasızdır (`kasa.x`) → 0 */
function extraIndex(yol: string, name: "kasa" | "foysuzGun"): number | null {
  if (!yol.startsWith(`${name}.`)) return null;
  const m = /^\d+/.exec(yol.slice(name.length + 1));
  return m ? Number(m[0]) : 0;
}

/**
 * Föyü şubelere ayırır (yukarıdaki kural 2). Tek şubeye düşen föy olduğu gibi döner (aynı nesne). Ayrılan föyde
 * `ozet` boştur: ModPOS'un özeti bütün kasaların toplamıdır, şubenin değil (panel özeti okumaz, tutarlar kasalardan);
 * tanınmayan alanlar kasası hangi şubedeyse oraya, kök alanlar çekenin föyüne gider. `kota` hepsinde aynıdır (anahtarın).
 */
export function splitFoyByBranch(foy: KasaFoyu, o: SplitOptions): FoySplit {
  const names = new Set([...foy.kasalar.map((k) => k.sube), ...foy.foysuzGunler.map((f) => f.sube)].map((n) => n.trim()).filter(Boolean));
  const single = names.size <= 1;
  const unmatched = new Set<string>();
  const skipped = new Set<string>();
  // Kasanın şubesi: bağlanan şube; tek adlı föyde bağlanamayan ad çekenin; çok adlıda null (yazılmaz)
  const target = (sube: string): string | null => {
    const id = sube.trim() ? o.resolve(sube) : null;
    if (id === null) {
      if (single) return o.own;
      unmatched.add(sube.trim() || "(adsız)");
      return null;
    }
    if (id !== o.own && (o.keyed?.has(id) || (o.modposIds && !o.modposIds.has(id)))) {
      skipped.add(id);
      return null;
    }
    return id;
  };
  const kasaTo = foy.kasalar.map((k) => target(k.sube));
  const foysuzTo = foy.foysuzGunler.map((f) => target(f.sube));
  if ([...kasaTo, ...foysuzTo].every((t) => t === o.own)) return { parts: new Map([[o.own, foy]]), unmatched: [], skipped: [] };
  const ids = [o.own, ...new Set([...kasaTo, ...foysuzTo].filter((t): t is string => t !== null && t !== o.own))];
  const parts = new Map<string, KasaFoyu>();
  for (const id of ids) {
    const extras = (foy.ekAlanlar ?? []).filter((e: FoyEkAlan) => {
      const k = extraIndex(e.yol, "kasa");
      if (k !== null) return kasaTo[k] === id;
      const f = extraIndex(e.yol, "foysuzGun");
      if (f !== null) return foysuzTo[f] === id;
      return id === o.own;
    });
    parts.set(id, {
      ...foy,
      kasalar: foy.kasalar.filter((_, i) => kasaTo[i] === id),
      foysuzGunler: foy.foysuzGunler.filter((_, i) => foysuzTo[i] === id),
      ozet: null,
      ...(foy.ekAlanlar !== undefined ? { ekAlanlar: extras } : {}),
    });
  }
  return { parts, unmatched: [...unmatched], skipped: [...skipped] };
}

/** Çalışmanın metnine eklenen uyarı: bağlanamayan ModPOS şube adı (yoksa null) */
export function splitNoticeText(s: Pick<FoySplit, "unmatched">): string | null {
  if (!s.unmatched.length) return null;
  const list = s.unmatched.map((n) => `"${n}"`).join(", ");
  return `ModPOS'taki ${list} şubesi panelde bir şubeyle eşleşmedi, kasası hiçbir şubeye yazılmadı: Vercel'de ${MODPOS_SUBE_MAP_ENV}'e "ModPOS adı=şube kimliği" yazın`;
}

/** ModPOS'tan çekilen şubeler, sırayla: açık, fiziksel ve kasası ModPOS olanlar (Ayarlar › Şubeler) */
export function modposBranchIds(branches: readonly Pick<BranchRow, "id" | "kind" | "posSource" | "active">[]): string[] {
  return branches.filter((b) => b.active && b.kind === "fiziksel" && b.posSource === "modpos").map((b) => b.id);
}

type SyncStatus = "off" | "preview" | "busy" | "nothing" | "ok" | "partial" | "kota" | "error";

/**
 * Sabah işinin şube şube çalışmalarının tek sonucu (src/lib/job-health.ts modposStep'in girdisi). Hiçbir şube
 * çekilmediyse (anahtar yok) "off". Bir şube hata verip öteki aldıysa "partial"; hepsi hata verdiyse "error". Hata
 * metni şubenin adıyla ("Marina: …"), kalan hak Tuzla'nınki (yoksa ilk şubeninki).
 */
export function combineModposResults<D>(
  runs: readonly { branchId: string; name: string; result: { status: SyncStatus; days: D[]; left: number | null; error?: string } }[],
): { status: SyncStatus; days: D[]; left: number | null; error?: string } {
  const real = runs.filter((r) => r.result.status !== "off" && r.result.status !== "preview");
  if (!real.length) return { status: runs.some((r) => r.result.status === "preview") ? "preview" : "off", days: [], left: null };
  const has = (s: SyncStatus) => real.some((r) => r.result.status === s);
  const errors = real.filter((r) => r.result.status === "error");
  const status: SyncStatus =
    errors.length === real.length
      ? "error"
      : errors.length || has("partial")
        ? "partial"
        : has("ok")
          ? "ok"
          : has("kota")
            ? "kota"
            : has("busy")
              ? "busy"
              : "nothing";
  const error = real
    .filter((r) => r.result.error)
    .map((r) => (runs.length > 1 ? `${r.name}: ${r.result.error}` : r.result.error!))
    .join(" · ");
  const main = real.find((r) => r.branchId === DEFAULT_BRANCH_ID) ?? real[0];
  return { status, days: real.flatMap((r) => r.result.days), left: main.result.left, ...(error ? { error } : {}) };
}
