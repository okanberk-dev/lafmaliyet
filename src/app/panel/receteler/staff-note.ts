/**
 * Personelin Reçete defterinde ürünün notu (docs/planlar/ux-sade.md §9 #23, H6): fiyat kaynağını, maliyeti ya da
 * ModPOS'u anan not yönetici notudur, personelin kartında çizilmez. Başka not (hazırlama sözü, "M = solo") kalır;
 * reçete satırlarının notları aynı, yönetici görünümü aynen. Veri süzülmez: değişiklik önerisi penceresi notun kendisiyle
 * başlar, `proposeRecipeChanges` önceki hâli veritabanından okur; süzülmüş not önerinin onayında ürünün notunu silerdi
 */
export const STAFF_HIDDEN_NOTE = /fiyat|maliyet|modpos|patron|₺|\btl\b/i;

export function staffRecipeNote(note: string | null): string | null {
  return note && STAFF_HIDDEN_NOTE.test(note) ? null : note;
}
