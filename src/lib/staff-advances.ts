/**
 * Personel avansları için saf kurallar (tests/personel-avans.test.ts sınar; docs/PERSONEL-BELGE.md › Avans).
 *
 * İki hareket vardır, tutar hep artı: `avans` kişiye verilen para, `kesinti` maaşından düşülen. Kişinin bakiyesi
 * (maaşından daha düşülecek olan) = avansların toplamı − kesintilerin toplamı. Kesinti bakiyeyi aşamaz (kişi
 * alacaklı duruma düşmez; fazla kesinti yazım hatasıdır).
 *
 * Maaş hesabıyla tutarlılık: avans gider DEĞİLDİR. Maaş (Giderler › Maaşlar) işveren maliyetiyle zaten kâr-zararda;
 * avans o maaşın erken ödenen parçasıdır, ayrıca gider yazılırsa aynı para iki kez sayılır. Bu yüzden avanslar hiçbir
 * maliyet hesabına girmez; yalnız "bu ay ele geçecek" tutarı gösterir: net maaş + ek ödemeler − o ay düşülen.
 */

export type AdvanceKind = "avans" | "kesinti";
export const ADVANCE_KINDS: readonly AdvanceKind[] = ["avans", "kesinti"];
export const ADVANCE_KIND_LABEL: Record<AdvanceKind, string> = { avans: "Avans verildi", kesinti: "Maaştan düşüldü" };

export interface AdvanceRow {
  id: number;
  staffId: number;
  /** YYYY-MM-DD */
  date: string;
  kind: AdvanceKind;
  amount: number;
  note?: string | null;
}

export interface AdvanceTotals {
  /** Verilen avansların toplamı */
  given: number;
  /** Maaştan düşülenlerin toplamı */
  deducted: number;
  /** Kalan (maaştan daha düşülecek) */
  balance: number;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function advanceTotals(rows: readonly Pick<AdvanceRow, "kind" | "amount">[]): AdvanceTotals {
  let given = 0;
  let deducted = 0;
  for (const r of rows) {
    if (r.kind === "avans") given += r.amount;
    else deducted += r.amount;
  }
  return { given: round2(given), deducted: round2(deducted), balance: round2(given - deducted) };
}

/** Kişi başına toplamlar (hareketi olmayan kişi haritada yok) */
export function totalsByStaff(rows: readonly AdvanceRow[]): Map<number, AdvanceTotals> {
  const groups = new Map<number, AdvanceRow[]>();
  for (const r of rows) groups.set(r.staffId, [...(groups.get(r.staffId) ?? []), r]);
  return new Map([...groups].map(([id, list]) => [id, advanceTotals(list)]));
}

/** Hareketler eskiden yeniye, her birinin ardından kalan bakiyeyle (aynı günde kimlik sırası) */
export function withRunningBalance<T extends AdvanceRow>(rows: readonly T[]): (T & { balanceAfter: number })[] {
  let balance = 0;
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((r) => {
      balance = round2(balance + (r.kind === "avans" ? r.amount : -r.amount));
      return { ...r, balanceAfter: balance };
    });
}

/** O ay ("YYYY-MM") maaştan düşülenlerin toplamı */
export function deductedInMonth(rows: readonly AdvanceRow[], month: string): number {
  return round2(rows.filter((r) => r.kind === "kesinti" && r.date.startsWith(month)).reduce((a, r) => a + r.amount, 0));
}

/** Bu ay ele geçecek: net maaş + ek ödemeler − bu ay düşülen (eksiye inmez) */
export function payableThisMonth(net: number, extras: number, deducted: number): number {
  return Math.max(0, round2(net + extras - deducted));
}

export const MAX_ADVANCE = 10_000_000;

/**
 * Yeni hareketin hatası (yoksa null). `balance`: kişinin bu hareketten ÖNCEKİ bakiyesi. İleri tarihli hareket
 * yazılmaz (avans verilmiş, kesinti yapılmış olmalı).
 */
export function advanceProblem(input: { kind: string; amount: number; date: string }, ctx: { balance: number; today: string }): string | null {
  if (input.kind !== "avans" && input.kind !== "kesinti") return "Hareket türü seçin";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Tutar 0'dan büyük olmalı";
  if (input.amount > MAX_ADVANCE) return "Tutar çok büyük";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Tarih seçin";
  if (input.date > ctx.today) return "İleri tarihli hareket yazılamaz";
  if (input.kind === "kesinti" && round2(input.amount) > round2(ctx.balance)) {
    return ctx.balance > 0 ? "Kesinti kalan avansı aşamaz" : "Bu kişinin kalan avansı yok; önce avansı yazın";
  }
  return null;
}

/**
 * Hareket silinebilir mi (yoksa neden): avans silinince kalan hareketlerin bakiyesi hiçbir anda eksiye düşmemeli
 * (kesintisi yapılmış avans silinmez; önce kesinti silinir).
 */
export function deleteProblem(rows: readonly AdvanceRow[], id: number): string | null {
  const target = rows.find((r) => r.id === id);
  if (!target) return "Hareket bulunamadı";
  if (target.kind === "kesinti") return null;
  const rest = withRunningBalance(rows.filter((r) => r.id !== id));
  return rest.some((r) => r.balanceAfter < -0.005) ? "Bu avansın kesintisi yazılmış; önce kesintiyi silin" : null;
}

/**
 * Kalan avans net maaşı aşıyorsa uyarı (tek maaşla kapanmaz); maaşı bilinmeyende (part-time) uyarı yok. Ekranda
 * Notice'in başlığı ve satırı
 */
export function balanceWarning(balance: number, net: number | null): { title: string; text: string } | null {
  if (net === null || net <= 0 || balance <= net + 0.005) return null;
  return { title: "Kalan avans bir aylık net maaşı aşıyor", text: "Tek maaştan düşülemez; birkaç aya bölüp düşün." };
}
