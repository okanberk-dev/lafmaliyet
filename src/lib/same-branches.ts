/**
 * Genel bakış'ın aydan aya rozetleri "Tümü"de aynı şubelerle (denetim bulgusu 65; docs/SUBE.md › Aydan aya rozetler).
 * "Tümü"nün ay rakamı şubelerin toplamıdır: Marina 13 Kasım'da açıldı, Kasım'ın Ekim'e göre rozeti yalnız yeni şube
 * yüzünden "+%40" diyordu, Aralık'ın Kasım'a göre rozeti de Marina'nın yarım Kasım'ı yüzünden. Önceki ayın 1'inden sonra
 * açılan şube kıyas dışıdır: POS cirosu ve günlük ortalama iki ayda da açık şubelerin ay bilgisiyle (Month.byBranch)
 * kıyaslanır, şubeye bölünemeyen rakamların (net satış, brüt ve net kâr) rozeti çizilmez; ipucu yeni şubeyi adıyla söyler.
 * Saf modül; testleri tests/sube-rozet.test.ts.
 */

import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import type { Month } from "@/lib/calc/types";
import { monthLabel } from "@/lib/format";
import { dayLocativeTR, monthLocativeTR, shiftMonth } from "@/lib/reminders";

export interface BranchOpening {
  id: string;
  name: string;
  /** Açılış günü (Şube ayarları); yoksa Tuzla hep açık, öteki şubeler ilk verisinin ayında açıldı sayılır */
  openedOn: string | null;
}

/** Bir değerin iki ayı ve değişimi */
export interface SameBranchValue {
  cur: number;
  prev: number;
  growth: number | null;
}

export interface SameBranchBasis {
  /** Kıyas dışı kalan yeni şubeler ve ne zaman açıldıkları, bulunma hâlinde ("13 Kasım'da" ya da "Kasım'da") */
  fresh: { id: string; name: string; since: string }[];
  /** İki ayda da sayılan şubelerin adları */
  kept: string[];
  /** POS cirosu, iki ayda da açık şubelerle; kıyaslanacak şube yoksa null */
  pos: SameBranchValue | null;
  /** Günlük ortalama ciro: şube şube POS cirosu ÷ açık gün, toplanır */
  daily: SameBranchValue | null;
  /** POS cirosu ve günlük ortalamanın ipucuna eklenen cümle (başta boşluk) */
  note: string;
  /** Şubeye bölünemeyen rakamların (net satış, brüt ve net kâr) ipucuna: rozet neden yok (başta boşluk) */
  noBadge: string;
}

const hasData = (m: Month | undefined): m is Month => !!m && ((m.posRevenue ?? 0) > 0 || (m.openDays ?? 0) > 0);
const growthOf = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);

/**
 * Ayın önceki ayla kıyasının aynı şubeler temeli. "Tümü" değilse (ayın şube kırılımı yok) ya da yeni açılan şube yoksa
 * null: rozetler bugünkü gibi. Yeni şube: ayda verisi olan ve açılış günü önceki ayın 1'inden sonra olan şube; açılış
 * günü yazılmamışsa Tuzla hiç, öteki şube ilk verisi önceki ayda ya da bu ayda başladıysa.
 */
export function sameBranchBasis(monthInfo: ReadonlyMap<string, Month>, month: string, branches: readonly BranchOpening[]): SameBranchBasis | null {
  const cur = monthInfo.get(month)?.byBranch;
  if (!cur) return null;
  const prevMonth = shiftMonth(month, -1);
  const prev = monthInfo.get(prevMonth)?.byBranch ?? {};
  const firstMonth = (id: string): string | null =>
    [...monthInfo.entries()]
      .filter(([, m]) => hasData(m.byBranch?.[id]))
      .map(([m]) => m)
      .sort()[0] ?? null;
  const fresh: SameBranchBasis["fresh"] = [];
  const kept: { id: string; name: string }[] = [];
  for (const id of Object.keys(cur).filter((id) => hasData(cur[id])).sort()) {
    const b = branches.find((x) => x.id === id);
    const name = b?.name ?? id;
    if (b?.openedOn) {
      if (b.openedOn > `${prevMonth}-01`) fresh.push({ id, name, since: dayLocativeTR(b.openedOn) });
      else if (hasData(prev[id])) kept.push({ id, name });
      continue;
    }
    const first = id === DEFAULT_BRANCH_ID ? null : firstMonth(id);
    if (first !== null && first >= prevMonth) fresh.push({ id, name, since: monthLocativeTR(first) });
    else if (hasData(prev[id])) kept.push({ id, name });
  }
  if (!fresh.length) return null;
  const pick = (f: (m: Month) => number | null) => {
    if (!kept.length) return null;
    const a = kept.reduce((s, b) => s + (f(cur[b.id]) ?? 0), 0);
    const p = kept.reduce((s, b) => s + (f(prev[b.id]) ?? 0), 0);
    return { cur: a, prev: p, growth: growthOf(a, p) };
  };
  const names = fresh.map((f) => `${f.name} ${f.since}`).join(", ");
  const keptNames = kept.map((k) => k.name);
  return {
    fresh,
    kept: keptNames,
    pos: pick((m) => m.posRevenue),
    daily: pick((m) => (m.openDays ? (m.posRevenue ?? 0) / m.openDays : null)),
    note: keptNames.length
      ? ` Rozet: ${monthLabel(prevMonth)} ayına göre yalnız iki ayda da açık şubelerle (${keptNames.join(", ")}); ${names} açıldı, kıyas dışı.`
      : ` Rozet yok: ${names} açıldı, ${monthLabel(prevMonth)} ayıyla aynı şubeler kıyaslanamıyor.`,
    noBadge: ` Rozet yok: ${names} açıldı; bu rakam şubeye bölünmediği için ${monthLabel(prevMonth)} ayıyla aynı şubelerle kıyaslanamıyor.`,
  };
}
