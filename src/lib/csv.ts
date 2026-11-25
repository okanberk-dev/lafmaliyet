// CSV dışa aktarımı (Ürünler, Hammaddeler): Türkçe yerel ayarlı tablo programlarının doğrudan açtığı biçim. Noktalı
// virgül ayraç, UTF-8 BOM (Türkçe harfler bozulmasın), satır sonu CRLF, her hücre tırnak içinde. Sayılar tek biçimde:
// binlik ayraç yok, virgüllü ondalık, sabit ondalık sayısı ("1234,50"); değer yoksa boş hücre (tire değil). Saf modül
// (indirme yardımcısı hariç); testleri tests/csv.test.ts.

/** UTF-8 bayt sırası işareti: tablo programı dosyayı UTF-8 okusun */
export const CSV_BOM = "﻿";

/** Sayı hücresi: "1234,5" biçimi, `digits` ondalık; değer yoksa (null, NaN, sonsuz) boş */
export function csvNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  // -0,00 yazılmasın
  return (Object.is(r, -0) ? 0 : r).toFixed(digits).replace(".", ",");
}

/** Yüzde hücresi: oran (0,305) → "30,5"; sütun adı "(%)" taşır */
export const csvPercent = (v: number | null | undefined, digits = 1): string => csvNumber(v === null || v === undefined ? v : v * 100, digits);

/**
 * Metin hücresi. "=", "+", "-", "@" ile başlayan metin tablo programında formül diye çalışabilir: başına tek tırnak
 * eklenir (görünüşü değişmez, formül çalışmaz). Sekme ve satır başı karakterleri de aynı nedenle önce kalır.
 */
export function csvText(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Satırlardan CSV metni: BOM + noktalı virgül + CRLF, her hücre tırnakta (içindeki tırnak ikilenir) */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (c: string) => `"${c.replace(/"/g, '""')}"`;
  return CSV_BOM + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

/** Tarayıcıda CSV indirir (yalnız istemci) */
export function downloadCsv(filename: string, rows: readonly (readonly string[])[]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
