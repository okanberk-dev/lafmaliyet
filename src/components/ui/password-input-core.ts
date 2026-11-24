/**
 * Parola kutusunun (password-input.tsx) saf hesabı: parola gücü, göz düğmesinin etiketi, geçiş anındaki nokta ↔ harf
 * listesi. React ve tarayıcı içermez; testler doğrudan bunu okur (tests/zil-bildirim-sifre.test.ts).
 */

import { passwordProblem } from "@/lib/password-rules";

/** Parola gücünün dört basamağı: ad ve çubuğun rengi (panelin belirteçleri; koyu temada kendiliğinden döner) */
export const STRENGTH_LEVELS = [
  { label: "Zayıf", bar: "bg-bad" },
  { label: "Orta", bar: "bg-warn" },
  { label: "İyi", bar: "bg-brand-400" },
  { label: "Güçlü", bar: "bg-brand-500" },
] as const;

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Parolanın gücü: 0 boş; 1 "Zayıf" (panelin kuralına takılır: kısa, yaygın, dizi, kafenin adı ya da e-posta,
 * `passwordProblem`; sunucu da aynı kuralla reddeder); kurala uyanlar karakter çeşidi (küçük, büyük, rakam, işaret)
 * ve uzunlukla (12+ bir, 16+ iki puan) "Orta" (≤2), "İyi" (3–4), "Güçlü" (5+). Türkçe harfler harf sayılır.
 */
export function passwordLevel(value: string, email?: string | null): StrengthLevel {
  if (!value) return 0;
  if (passwordProblem(value, email)) return 1;
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((re) => re.test(value)).length;
  const length = Array.from(value).length;
  const score = kinds + (length >= 16 ? 2 : length >= 12 ? 1 : 0);
  return score >= 5 ? 4 : score >= 3 ? 3 : 2;
}

/** Göz düğmesinin varsayılan etiketleri (panelin sözcüğü "parola") */
export const TOGGLE_LABELS = { show: "Parolayı göster", hide: "Parolayı gizle" } as const;

export const toggleLabel = (visible: boolean, labels: { show: string; hide: string } = TOGGLE_LABELS) => (visible ? labels.hide : labels.show);

/**
 * Göster / gizle geçişinde (kısa bir an) alanın üstünde çizilen işaretler. Gizlerken gerçek karakter HİÇ yazılmaz,
 * yalnız nokta: `char` null. Gösterirken her karakter kendi noktasının yerinde belirir. Karakterler kod noktası
 * olarak sayılır (emoji ve birleşik harf tek nokta).
 */
export function morphGlyphs(value: string, to: "show" | "hide"): { char: string | null }[] {
  return Array.from(value, (c) => ({ char: to === "show" ? c : null }));
}

/** Gözün kapağı: açıkken badem, kapalıyken alt kirpik çizgisi (rare-ui'deki çizimin aynısı) */
export const LID_OPEN = { top: 5.5, bottom: 18.5 } as const;
export const LID_CLOSED = { top: 17, bottom: 17 } as const;
export const LASHES = ["M4.4 14.6 3 16.4", "M9 16.6 8.5 19", "M15 16.6l.5 2.4", "M19.6 14.6l1.4 1.8"] as const;

const corner = (y: number) => 12 + (y - 12) * 0.64;

export const eyePath = ({ top, bottom }: { top: number; bottom: number }) =>
  `M2 12C4 ${corner(top)} 7.5 ${top} 12 ${top}C16.5 ${top} 20 ${corner(top)} 22 12C20 ${corner(bottom)} 16.5 ${bottom} 12 ${bottom}C7.5 ${bottom} 4 ${corner(bottom)} 2 12Z`;
