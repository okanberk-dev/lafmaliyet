import "server-only";

import { ALL_BRANCHES, type BranchRow, type BranchScope } from "@/lib/branches";
import { cleanName, foldName, ToolInputError } from "@/lib/mcp/answers/common";

/*
 * İşlem önizlemelerinin ortak çözücüleri (salt okunur; docs/ASISTAN-ISLEMLER.md › Veri talimat değildir). Model kimlik
 * vermez, ad verir: ad sunucunun okuduğu satırlarla eşleşir. Tek eşleşme yoksa kart açılmaz; ToolInputError'un metni
 * asistana döner (adaylarla), asistan kullanıcıya sorar.
 */

/**
 * Adla tek kayıt: önce birebir (büyük / küçük harf, Türkçe harf ve aksan farkı yok), sonra adında geçen. Araç
 * çıktısında kısaltılmış ad ("…" ile biten) başıyla eşleşir. Birden çok aday ya da hiç yoksa ToolInputError.
 */
export function pickByName<T>(rows: readonly T[], query: string, nameOf: (r: T) => string, what: string, hint = ""): T {
  const raw = query.trim();
  const cut = raw.endsWith("…") ? foldName(raw.slice(0, -1)) : null;
  const q = foldName(raw);
  const exact = rows.filter((r) => (cut ? foldName(nameOf(r)).startsWith(cut) : foldName(nameOf(r)) === q));
  if (exact.length === 1) return exact[0];
  const pool = exact.length ? exact : rows.filter((r) => foldName(nameOf(r)).includes(cut ?? q));
  if (pool.length === 1) return pool[0];
  const names = [...new Set(pool.map((r) => cleanName(nameOf(r))))].slice(0, 8);
  if (!pool.length) throw new ToolInputError(`${what} bulunamadı: “${cleanName(raw, 60)}”.${hint ? ` ${hint}` : ""}`);
  throw new ToolInputError(`Birden çok ${what.toLocaleLowerCase("tr-TR")} eşleşti: ${names.join(", ")}. Kullanıcıya hangisi olduğunu sor.`);
}

/** "işletme geneli", "genel", "hepsi" */
const COMPANY_WIDE = new Set(["isletme geneli", "isletme", "genel", "hepsi", "tumu", "tum subeler"]);

/**
 * Şubeye özgü yazımın şubesi (kasa, zayi, vardiya): verilen ad ya da kimlik etkin bir fiziksel şube olmalı. Verilmezse
 * paneldeki seçim; "Tümü" seçiliyken şube belirsizdir (yazımlar sessizce Tuzla'ya düşerdi): kart açılmaz, asistan sorar.
 */
export function physicalBranch(raw: string | undefined, scope: BranchScope, branches: readonly BranchRow[]): BranchRow {
  const physical = branches.filter((b) => b.active && b.kind === "fiziksel");
  if (raw) {
    const q = foldName(raw);
    const hit = physical.find((b) => b.id === raw || foldName(b.name) === q);
    if (!hit) throw new ToolInputError(`Şube bulunamadı: “${cleanName(raw, 40)}”. Şubeler: ${physical.map((b) => b.name).join(", ")}.`);
    return hit;
  }
  const chosen = physical.find((b) => b.id === scope);
  if (chosen) return chosen;
  throw new ToolInputError(
    `Panelde “Tümü” seçili; bu kayıt tek bir şubeye yazılır. Kullanıcıya hangi şube olduğunu sor (${physical.map((b) => b.name).join(", ")}); kendin seçme.`,
  );
}

/**
 * Gider ve hatırlatıcının şubesi: fiziksel şube ya da işletme geneli (null). Verilmezse seçili şube, "Tümü"de işletme
 * geneli (ekrandaki gibi). Dönüş: kayıt şubesi (null = işletme geneli) ve yazımın kapsamı.
 */
export function expenseBranch(raw: string | undefined, scope: BranchScope, branches: readonly BranchRow[]): { branchId: string | null; scope: BranchScope; label: string } {
  if (raw && COMPANY_WIDE.has(foldName(raw))) return { branchId: null, scope: ALL_BRANCHES, label: "İşletme geneli" };
  if (raw) {
    const b = physicalBranch(raw, scope, branches);
    return { branchId: b.id, scope: b.id, label: b.name };
  }
  const chosen = branches.find((b) => b.id === scope && b.active && b.kind === "fiziksel");
  return chosen ? { branchId: chosen.id, scope: chosen.id, label: chosen.name } : { branchId: null, scope: ALL_BRANCHES, label: "İşletme geneli" };
}
