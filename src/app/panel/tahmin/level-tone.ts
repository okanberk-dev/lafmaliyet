import type { Tone } from "@/components/ui/badge";
import type { ForecastLevel } from "@/lib/forecast/model";

/** Yoğunluk rozetinin rengi (Satış tahmini ve Bugün kartı): Yüksek uyarı, Normal gri, Düşük mavi */
export const LEVEL_TONE: Record<ForecastLevel, Tone> = { yuksek: "amber", normal: "gray", dusuk: "blue", kapali: "gray" };
