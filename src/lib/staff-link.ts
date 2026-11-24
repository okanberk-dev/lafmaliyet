// Maaş satırının Vardiya / hesap bağlantısı (Faz 5; sahibin kararı 2: "doğru hesap bağlansın"). Saf kurallar: eylem
// (src/server/actions/costs.ts saveStaff) ve Maaşlar'ın seçicisi aynı işlevleri çağırır; testleri
// tests/personel-part-time.test.ts ve tests/personel-baglanti-db.test.ts.
//
// - Bağlantı yalnız yöneticinin açık seçimiyle kurulur; ad benzerliğiyle kendiliğinden bağlanmaz, seçici önseçmez.
// - Panel hesabı (staff.userId) Vardiya'da "u:<id>"; hesabı olmayan çalışan adıyla "n:<küçük harfli ad>" (personRef).
// - Bir hesap (ya da bir şubedeki bir ad) aynı ayda tek maaş satırına bağlanır: aralığı çakışan iki satır aynı kişiyi
//   gösteremez. "Devam ettir"in açtığı yeni kayıttan önceki satır kendi geçmişiyle bağlı kalabilir (aralıkları ayrık).
//   Bu yüzden bir hesaba birden çok (aralığı ayrık) satır düşebilir: hesap başına liste verenler (LM-4b'nin
//   /api/panel/pos/personel'i) hesap başına tek öğe vermelidir. Veritabanında tekil indeks yok (kural aralığa bağlı); eylem
//   denetimi ve yazımı bir işlem kilidi altında yapar (src/server/actions/costs.ts lockStaffLinks).

import type { MonthRange } from "./calc/types";

/**
 * Maaşlar'ın seçicisinin seçenekleri (src/server/data/staff-links.ts): panel hesapları ve Vardiya'da hesabı olmadan
 * adıyla yazılmış kişiler (şube başına)
 */
export interface StaffLinkOptions {
  users: { id: number; name: string; email: string; branchId: string | null; active: boolean }[];
  names: { ref: string; name: string; branchId: string }[];
}

/** Hesabı olmayan Vardiya kişisinin anahtarı: "n:" + boş olmayan ad (src/lib/vardiya.ts nameRef) */
export const PERSON_REF_PATTERN = /^n:\S.{0,79}$/;

export interface LinkRow extends MonthRange {
  id: number | null;
  name: string;
  branchId: string;
  userId: number | null;
  personRef: string | null;
}

/** İki aralık ortak bir ayı paylaşıyor mu (boş başlangıç / bitiş = sınırsız) */
export function rangesOverlap(a: MonthRange, b: MonthRange): boolean {
  const aFrom = a.startMonth ?? "0000-00";
  const bFrom = b.startMonth ?? "0000-00";
  const aTo = a.endMonth ?? "9999-99";
  const bTo = b.endMonth ?? "9999-99";
  return aFrom <= bTo && bFrom <= aTo;
}

/** Aynı kişiyi gösteriyor mu: aynı hesap (şubeden bağımsız) ya da aynı şubede aynı Vardiya adı */
const samePerson = (a: LinkRow, b: LinkRow) =>
  (a.userId !== null && a.userId === b.userId) || (a.personRef !== null && a.personRef === b.personRef && a.branchId === b.branchId);

/**
 * Bağlantı çakışması: aynı hesaba / ada bağlı, aralığı çakışan başka bir satır varsa ret metni; yoksa null. `others`
 * kendisi dışındaki satırlar (aynı kayıt listesindeki yeni değerleriyle)
 */
export function linkConflict(self: LinkRow, others: readonly LinkRow[]): string | null {
  if (self.userId === null && self.personRef === null) return null;
  const hit = others.find((o) => o.id !== self.id && samePerson(self, o) && rangesOverlap(self, o));
  if (!hit) return null;
  const what = self.userId !== null ? "Bu hesap" : "Bu Vardiya kişisi";
  return `${self.name}: ${what} aynı aylarda "${hit.name}" maaş satırına bağlı. Bir kişi aynı ayda tek satıra bağlanır; önce o satırın bağlantısını kaldırın ya da bitiş ayını girin.`;
}

/** Seçicinin değeri: "u:<id>", "n:<ad>" ya da "" (bağlı değil) */
export function linkValue(row: { userId?: number | null; personRef?: string | null }): string {
  if (row.userId) return `u:${row.userId}`;
  return row.personRef ?? "";
}

/** Seçicinin değerinden bağlantı (bozuk değer: bağlı değil) */
export function parseLinkValue(v: string): { userId: number | null; personRef: string | null } {
  const u = /^u:(\d{1,9})$/.exec(v);
  if (u) return { userId: Number(u[1]), personRef: null };
  if (PERSON_REF_PATTERN.test(v)) return { userId: null, personRef: v };
  return { userId: null, personRef: null };
}
