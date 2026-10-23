// Reçete defterinde ml miktarının pompa karşılığı ("2 pompa", "1,5 pompa", "≈ 1,3 pompa"): barista 45 ml püreyi
// 30 ml'lik püre pompasıyla bölmeden döksün. Şurup ve sos şurup pompasıyla, püre püre pompasıyla ölçülür; ikisinin
// basışı Ayarlar › Reçete ölçüleri'nden gelir. Sos & Şurup'ta olup pompayla verilmeyenler (limon özü, kondanse süt)
// ayrıca yazılı (NOT_PUMPED). Saf: tests/pompa.test.ts.

import { formulaParams } from "./calc/expr";
import type { Settings } from "./calc/types";
import { num } from "./format";

/** Satırı püre pompasıyla ölçülen malzeme kategorisi */
export const PUREE_CATEGORY = "Püre";
/** Satırı şurup pompasıyla ölçülen malzeme kategorisi */
export const SYRUP_CATEGORY = "Sos & Şurup";

export type PumpKey = "pompa" | "pompaPure";

/**
 * Sos & Şurup kategorisinde olup pompayla verilmeyen kalemler (adında geçen sözler; büyük-küçük harf gözetilmez):
 * limon özü şişeden ölçüyle, kondanse süt kutudan dökülür. Limonata'da "80 ml · 8 pompa" yazıyordu (PR #10'da sahibe
 * soruldu, 23 Ekim denetimi). Formülde Pompa yazılıysa yine pompa sayılır (yazılan formül önce gelir).
 */
export const NOT_PUMPED = ["limon özü", "limon suyu", "condensed", "kondanse", "yoğunlaştırılmış süt"] as const;

/** Malzeme adı pompayla verilmeyenlerden mi */
export function notPumped(name: string | null | undefined): boolean {
  const n = (name ?? "").toLocaleLowerCase("tr-TR");
  return NOT_PUMPED.some((k) => n.includes(k));
}

export interface PumpLine {
  /** Malzemenin birimiyle miktar (formülse hesaplanmış değeri) */
  qty: number;
  unit: string;
  qtyExpr: string | null;
  /** Malzemenin kategorisi (Hammaddeler) */
  category: string | null | undefined;
  /** Malzemenin adı: Sos & Şurup'ta pompayla verilmeyenler için (NOT_PUMPED) */
  name?: string | null;
  packaging?: boolean;
}

/**
 * Satır hangi pompayla dökülür: formülde Pompa ya da PurePompa geçiyorsa o (yazılan formül kategoriden önce gelir);
 * ikisi birden ya da hiçbiri geçmiyorsa malzemenin kategorisi (Püre → püre pompası, Sos & Şurup → şurup pompası;
 * pompayla verilmeyenler hariç: NOT_PUMPED).
 */
export function pumpOf(line: Pick<PumpLine, "qtyExpr" | "category" | "name">): PumpKey | null {
  if (line.qtyExpr) {
    const used = formulaParams(line.qtyExpr);
    const syrup = used.has("pompa");
    if (syrup !== used.has("pompaPure")) return syrup ? "pompa" : "pompaPure";
  }
  if (line.category === PUREE_CATEGORY) return "pompaPure";
  if (line.category === SYRUP_CATEGORY && !notPumped(line.name)) return "pompa";
  return null;
}

/** Kaç pompa: yalnızca ml ve sıfırdan büyük miktarda, ambalaj dışında; pompa ölçüsü 0 ise (yazılmamış) null */
export function pumpCount(line: PumpLine, settings: Pick<Settings, PumpKey>): number | null {
  if (line.packaging || line.unit !== "ml" || !(line.qty > 0)) return null;
  const key = pumpOf(line);
  const size = key ? Number(settings[key]) : 0;
  return size > 0 ? line.qty / size : null;
}

/**
 * Miktarın altındaki kısa satır: tam ve yarım pompa olduğu gibi ("1 pompa", "1,5 pompa"), gerisi bir ondalıkla
 * yaklaşık ("≈ 1,3 pompa"). Bir ondalığa yuvarlanınca 0 kalan miktar (pompanın yirmide birinden az) yazılmaz.
 */
export function pumpHint(line: PumpLine, settings: Pick<Settings, PumpKey>): string | null {
  const n = pumpCount(line, settings);
  if (n === null) return null;
  const halves = Math.round(n * 2);
  if (halves > 0 && Math.abs(n * 2 - halves) < 1e-6) return `${num(halves / 2, 1)} pompa`;
  const tenths = Math.round(n * 10);
  return tenths > 0 ? `≈ ${num(tenths / 10, 1)} pompa` : null;
}
