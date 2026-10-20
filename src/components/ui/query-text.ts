/**
 * Arama kutusu ile adres çubuğundaki ?ara= değerinin eşitlenmesi (filters.tsx useQueryText): saf fonksiyonlar,
 * tests/query-text.test.ts.
 *
 * - `text`: kutuda görünen metin, `seen`: adreste en son görülen değer, `written`: kutunun kendisinin adrese
 *   yazdığı ve yansıması henüz gelmemiş değer.
 * - Kendi yazdığımız değerin adrese yansıması kutuyu ezmez (kullanıcı o sırada yazmayı sürdürüyor olabilir) ve bir
 *   kez tüketilir: sonraki her dış değişiklik (geri tuşu, "Temizle", karttan dönüş) kutuya yansır.
 * - Next 16 (cacheComponents) önceki sayfayı gizli tutar: ürün kartı açıkken gizli liste kartın adresini görür
 *   (arama yok, kutu boşalır); "← Ürünler" ya da geri tuşuyla dönünce ?ara=mocha yeniden okunur ve kutu dolar.
 */
export interface QueryTextState {
  text: string;
  seen: string;
  written: string | null;
}

export function initialQueryText(fromUrl: string): QueryTextState {
  return { text: fromUrl, seen: fromUrl, written: null };
}

/** Adres değeri değiştiyse yeni durum; değişmediyse aynı nesne (çizim sırasında güvenle çağrılır) */
export function syncQueryText(state: QueryTextState, fromUrl: string): QueryTextState {
  if (fromUrl === state.seen) return state;
  // Kendi yazdığımızın yansıması: kutu olduğu gibi kalır, bekleyen yazma tüketilir
  if (state.written !== null && fromUrl === state.written) return { ...state, seen: fromUrl, written: null };
  // Dışarıdan gelen değişiklik: kutu adresi izler; bekleyen yazma artık geçersiz
  return { text: fromUrl, seen: fromUrl, written: null };
}

/** Kullanıcı yazdı (kutu hemen güncellenir; adres sonra yazılır) */
export function typeQueryText(state: QueryTextState, text: string): QueryTextState {
  return state.text === text ? state : { ...state, text };
}

/** Kutu adrese `value` yazmak üzere: yansıması gelince kutuyu ezmesin */
export function markQueryTextWritten(state: QueryTextState, value: string): QueryTextState {
  return { ...state, written: value };
}
