/**
 * E-posta tasarım sisteminin değerleri (saf; docs/BILDIRIMLER.md › E-posta tasarımı). Renkler panelin açık ve koyu
 * temasından (src/app/globals.css, docs/TASARIM.md): mürekkep #171717, zinc-100 zemin, beyaz kart; durum renkleri
 * yalnız anlam taşırken (yeşil tutuyor, kırmızı fark, turuncu dikkat). Koyu değerler panelin koyu temasının
 * (docs/KOYU-TEMA.md) karşılıkları; e-posta istemcisi koyu temadaysa <head>'deki @media (prefers-color-scheme: dark)
 * bunları uygular (Apple Mail, iOS Mail, Outlook; Gmail kendi çevirisini yapar).
 */

/** Sistem yazı tipi yığını (e-postada web yazı tipi yüklenmez; Outlook'ta Arial, layout.ts'teki MSO kuralı) */
export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Açık tema */
export const LIGHT = {
  /** Sayfanın zemini (kartın çevresi) */
  bg: "#f4f4f5",
  /** Kart */
  card: "#ffffff",
  /** Kartın içindeki kuyu: büyük rakam kutusu, nötr not */
  well: "#f4f4f5",
  ink: "#171717",
  /** Satır etiketi ve gövde metni */
  soft: "#52525b",
  /** Açıklama, alt bilgi (beyazda 5,3:1; zeminde 4,8:1) */
  mute: "#6b6b74",
  /** İnce ayraç */
  line: "#ebebee",
  /** Ana düğme: siyah, beyaz yazı */
  primary: "#171717",
  onPrimary: "#ffffff",
  /** L'Af karosu: siyah zemin, limon yazı */
  tile: "#171717",
  tileInk: "#c0f21e",
} as const;

/** Koyu tema (panelin html.dark değerleri) */
export const DARK = {
  bg: "#0f0e0d",
  card: "#1e1c1b",
  well: "#2b2928",
  ink: "#ffffff",
  soft: "#d6d3d0",
  mute: "#a8a5a2",
  line: "#3a3836",
  /** Koyuda ana eylem L'Affogato yeşili */
  primary: "#5fcf98",
  onPrimary: "#04140c",
  tile: "#2b2928",
  tileInk: "#c0f21e",
} as const;

/** Durum tonu: iyi (yeşil), uyarı (turuncu), kötü (kırmızı), nötr (gri) */
export type Tone = "good" | "warn" | "bad" | "neutral";

/**
 * Tonların renkleri. `bg` bandın ve rozetin zemini, `ink` bandın metni (zemininde AA), `title` bandın başlığı, `value`
 * beyaz kartta satır değerinin rengi (AA), `mark` bandın işaret dairesi, `markInk` dairenin içindeki işaret
 */
export const TONES: Record<Tone, { bg: string; ink: string; title: string; value: string; mark: string; markInk: string; glyph: string }> = {
  good: { bg: "#f0fdf4", ink: "#166534", title: "#14532d", value: "#15803d", mark: "#16a34a", markInk: "#ffffff", glyph: "✓" },
  warn: { bg: "#fff7ed", ink: "#9a3412", title: "#7c2d12", value: "#c2410c", mark: "#ea580c", markInk: "#ffffff", glyph: "!" },
  bad: { bg: "#fef2f2", ink: "#991b1b", title: "#7f1d1d", value: "#b91c1c", mark: "#dc2626", markInk: "#ffffff", glyph: "×" },
  neutral: { bg: "#f4f4f5", ink: "#3f3f46", title: "#171717", value: "#171717", mark: "#71717a", markInk: "#ffffff", glyph: "i" },
};

/** Tonların koyu karşılıkları (panelin good-soft / warn-soft / bad-soft ve -ink değerleri) */
export const DARK_TONES: Record<Tone, { bg: string; ink: string; title: string; value: string; mark: string; markInk: string }> = {
  good: { bg: "#183326", ink: "#bdf2d5", title: "#e2f7ec", value: "#72d6a3", mark: "#5fcf98", markInk: "#04140c" },
  warn: { bg: "#33260f", ink: "#ffd796", title: "#fde3bd", value: "#f2b451", mark: "#f2b451", markInk: "#1a1206" },
  bad: { bg: "#3a1b18", ink: "#ffbcb5", title: "#ffe1dd", value: "#ff8278", mark: "#ff8278", markInk: "#2a0d0a" },
  neutral: { bg: "#2b2928", ink: "#d6d3d0", title: "#ffffff", value: "#ffffff", mark: "#a8a5a2", markInk: "#0f0e0d" },
};

/** Ölçüler (px). Kart içi 32 masaüstünde, 20 telefonda; bölümler arası 28 / 22 */
export const SPACE = {
  /** Kartın en geniş hâli (Outlook'ta sabit) */
  width: 600,
  cardPad: 32,
  cardPadPhone: 20,
  /** Gövdedeki bloklar arası (layout'un `body` dizisi) */
  gap: 28,
  gapPhone: 22,
  /** Bir bölümün içi: başlıktan satırlara, satırın dikey dolgusu */
  rowPad: 12,
  radius: 16,
  radiusInner: 12,
} as const;

/** Telefon uyarlamasının kırılma noktası: kart 600 px + kenar boşlukları sığmıyorsa */
export const PHONE_MAX = 620;
