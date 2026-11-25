// İlk kurulumda eski hesap tablosundan aktarılan kayıtların kullanıcıya görünen adı. Veri değişmez (göç yok): faturanın
// kaynağı `excel` olarak, canlıdaki fiyat geçmişinin ilk satırı ve işlem geçmişinin aktarım satırı eski adlarıyla kayıtlı
// kalır; ekran, asistan ve dışa aktarım bu adları gösterir (yeni kurulumda scripts/seed.ts doğrudan bu adları yazar).
// Saf modül; testleri tests/eski-veri-adlari.test.ts.

/** Faturanın kaynağı (invoices.source / origin; şema enum'u) */
export type InvoiceSource = "manual" | "excel" | "parasut";

/** Eski kayıtların adı: ilk kurulumda içe aktarılan veri */
export const IMPORTED_LABEL = "İçe aktarılmış (eski)";

/** Faturanın kaynağı tabloda ve dışa aktarımda: "Elle", "İçe aktarılmış (eski)", "Paraşüt" */
export const INVOICE_SOURCE_LABEL: Record<InvoiceSource, string> = { manual: "Elle", excel: IMPORTED_LABEL, parasut: "Paraşüt" };

/** Cümle içinde: "elle girilmiş", "içe aktarılmış (eski)", "Paraşüt'ten gelmiş" */
export const INVOICE_SOURCE_PHRASE: Record<InvoiceSource, string> = { manual: "elle girilmiş", excel: "içe aktarılmış (eski)", parasut: "Paraşüt'ten gelmiş" };

/** Kaynak etiketi; bilinmeyen değer olduğu gibi */
export function invoiceSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return (INVOICE_SOURCE_LABEL as Record<string, string>)[source] ?? source;
}

/** Fiyat geçmişinin ilk aktarım satırında kayıtlı yazan ve not (scripts/seed.ts'in eski sürümü yazdı) */
const OLD_PRICE_AUTHOR = "Excel";
const OLD_PRICE_NOTE = "Excel'den aktarıldı";
/** Gösterimde yazanın adı */
export const IMPORT_AUTHOR_LABEL = "İçe aktarım";

/**
 * Fiyat geçmişi satırının gösterimi: ilk aktarım satırının yazanı "İçe aktarım", notu "İçe aktarılmış (eski)". Öteki
 * satırlar olduğu gibi döner (aynı nesne).
 */
export function importedPriceRow<T extends { changedBy: string | null; note: string | null }>(row: T): T {
  const by = row.changedBy === OLD_PRICE_AUTHOR;
  const note = row.note === OLD_PRICE_NOTE;
  if (!by && !note) return row;
  return { ...row, changedBy: by ? IMPORT_AUTHOR_LABEL : row.changedBy, note: note ? IMPORTED_LABEL : row.note };
}

/** İşlem geçmişinde ilk aktarımın eylem adı (kayıtlı "Excel'den aktarım") */
const OLD_IMPORT_ACTIVITY = "Excel'den aktarım";
export const IMPORT_ACTIVITY_LABEL = "İlk veri aktarımı";

/** İşlem geçmişi satırının eylem adı: ilk aktarım "İlk veri aktarımı", öteki eylemler olduğu gibi */
export function activityActionLabel(action: string): string {
  return action === OLD_IMPORT_ACTIVITY ? IMPORT_ACTIVITY_LABEL : action;
}
