"use client";

import { ChevronDown, ScrollText } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { Notice, type NoticeTone } from "@/components/ui/notice";
import { okcFormChecks, okcReconcile, type OkcField } from "@/lib/okc-z";
import { cn } from "@/lib/utils";

import { amountOf, OKC_RATES_SHOWN, okcFigures, okcTKey, okcVKey, type OkcKey, type OkcMoneyKey, type OkcValues } from "./okc-form";

/*
 * Yazarkasa Z raporu kartı (dalga 13 PR-b; docs/planlar/okc-z.md §3.2–§3.6, §8, D16, D18; eski adı "Banka POS Z raporu
 * (yazarkasa)": aynı cihaz üç adla anılıyordu). Dört alan (Günlük toplam, Z no, Nakit, Kredi kartı; fişteki satırın
 * adı yer tutucuda, alan altında satır yok), gerisi Ayrıntılar'da (KDV dökümü,
 * fiş sayısı, yemek kartı, diğer, banka gün sonu yedeği). Değerler ve fotoğraf işaretleri cash-form.tsx'te kalır (köprü:
 * `field` / `textField` / `marked`); bu kart düzeni, canlı denetimi (okcFormChecks: alan başına tek turuncu neden, tek
 * özet satırı) ve kart satırını (okcReconcile) çizer. Kümülatif formda yoktur (D17): personelin denetimi yalnız önceki
 * Z'nin numarasıyla. Personel yalnız kendi düzeltebileceği satırları görür (kart ve kendi içinde); yöneticinin
 * satırları (toplam, nakit, yemek kartı, banka) yalnız yönetici formu düzenlerken (İlke 8).
 *
 * Fotoğraf seçicisi formun başındaki "Fiş fotoğrafları" kartında (cash-form.tsx). Ayrıntılar yöneticide de kapalı
 * gelir; turuncu, hata ya da banka fişinin sorusu varsa kendiliğinden açılır.
 *
 * Doldurma kapısı (OKC_PREFILL_ENABLED, src/lib/okc-z.ts) bu kartı değiştirmez: kapalıyken okunan her rakam alanın
 * altında öneri ("Fotoğraftakini yaz"), açıkken prefillPlan alanı doldurur; ikisi de cash-form'un işaretleriyle çizilir.
 */

/** Kartın yazılan alanları: yazarkasa alanları ve banka gün sonu (yedek) */
type CardKey = OkcKey | "bankPos";

/** Ayrıntılar'daki alanlar (turuncu sayısı ve kendiliğinden açılma) */
const DETAIL_KEYS: readonly CardKey[] = ["okcMealCard", "okcOther", "okcVatTotal", "okcReceipts", "okcT1", "okcV1", "okcT10", "okcV10", "okcT20", "okcV20", "bankPos"];

/** ModPOS'un karşılaştırılan rakamları (yazılmamış olan 0; kart yazılmadıysa kart satırı çıkmaz) */
export interface ModposFigures {
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  /** LafPOS gününde kartla bahşiş + cari tahsilatı (G11): kart karşılaştırması düşer */
  cardExtra?: number | null;
  /** LafPOS gününde yazarkasadan geçmeyen satış ödemeleri (Faz 2): kart, nakit ve toplam karşılaştırmaları düşer */
  offDevice?: { card: number; cash: number } | null;
}

export interface OkcFieldOptions {
  hint?: ReactNode;
  placeholder?: string;
  /** Canlı denetimin turuncusu (fotoğrafın işareti yoksa altında nedeni) */
  warn?: boolean;
}

export function OkcCard({
  values,
  field,
  textField,
  marked,
  failed,
  posPrompt,
  description,
  prevZ,
  extraTakings,
  day,
  audience,
  modpos,
  kasa = "ModPOS",
}: {
  values: OkcValues & { bankPos: string };
  /** Tutar alanı (cash-form'un `field`ı: etiket, fotoğraf işareti, hata) */
  field: (k: OkcMoneyKey | "bankPos", label: string, o?: OkcFieldOptions) => ReactNode;
  /** Z no ve fiş sayısı */
  textField: (k: "okcZNo" | "okcReceipts", label: string, o?: OkcFieldOptions) => ReactNode;
  /** Alanda fotoğrafın turuncusu ya da önerisi var */
  marked: (k: CardKey) => boolean;
  /** Alanda gönderim hatası var (Ayrıntılar açılır) */
  failed: (k: CardKey) => boolean;
  posPrompt: ReactNode;
  description: string;
  /** Önceki yazarkasa Z'si (yalnız gün ve numara; kümülatif personele gitmez, D17) */
  prevZ: { date: string; zNo: string } | null;
  /** Z'de toplam dışı tahsilat var (tutarı yok, D17): ödemelerin günlük toplamdan fazlası turuncu olmaz */
  extraTakings: boolean;
  day: string;
  /** Kim bakıyor: yönetici karşılaştırma satırlarının hepsini görür */
  audience: "staff" | "admin";
  modpos: ModposFigures | null;
  /** Günün kasası (karşılaştırma satırları onun adıyla; geçiş gününden itibaren LafPOS, denetim E-39) */
  kasa?: "ModPOS" | "LafPOS";
}) {
  const uid = useId();
  const f = okcFigures(values);
  const any = [f.okcTotal, f.okcCash, f.okcCard, f.okcMealCard, f.okcOther, f.okcVatTotal].some((x) => x !== null) || f.lines.length > 0;
  const live = any ? okcFormChecks(f, { prevZ, day, extraTakings }) : null;
  const reasonOf = (k: CardKey): string | null => (k === "bankPos" ? null : (live?.fields[k as OkcField] ?? null));
  // Alan başına tek turuncu neden: fotoğrafın işareti varsa o (cash-form çizer), yoksa canlı denetimin nedeni
  const opts = (k: CardKey, hint?: ReactNode, placeholder?: string): OkcFieldOptions => {
    const reason = marked(k) ? null : reasonOf(k);
    return { hint: reason ? <span className="text-warn">{reason}</span> : hint, warn: reason !== null, placeholder };
  };

  // Ayrıntılar: fotoğraftan dolunca açılmaz; içinde turuncu alan, hata ya da ikinci banka fişinin sorusu varsa açık gelir
  // (yöneticide de: her zaman açık gelince yöneticinin formu 12 ekrana çıkıyordu). Kendiliğinden açılan kutu açık kalır: turuncu yazarken kaybolunca kapanmaz (odak ve
  // tuşlar kaybolurdu); yalnız kişi düğmeye basınca kapanır
  const orange = DETAIL_KEYS.filter((k) => marked(k) || reasonOf(k) !== null || failed(k)).length;
  const attention = orange + (posPrompt ? 1 : 0);
  const [chosen, setChosen] = useState<boolean | null>(() => (attention > 0 ? true : null));
  const [seenAttention, setSeenAttention] = useState(attention);
  if (attention !== seenAttention) {
    setSeenAttention(attention);
    // Yeni bir turuncu ya da soru gelince kutu açılır (kişinin kapattığı da)
    if (attention > seenAttention) setChosen(true);
  }
  // Yazarkasa bölümünden önceki rapor (yalnız banka POS yazılı): değer Ayrıntılar'da gizli kalmasın
  const [legacy] = useState(() => Boolean(values.bankPos.trim()) && !any);
  // Banka fişinin sorusu bekliyorsa kutu kapatılamaz (soru içinde)
  const open = Boolean(posPrompt) || (chosen ?? (orange > 0 || legacy));
  const showRate1 = Boolean(values.okcT1.trim() || values.okcV1.trim() || marked("okcT1") || marked("okcV1"));

  // Kart satırı ve (yöneticide) öteki karşılaştırmalar; kendi içindeki denetim özet satırında
  const lines =
    modpos && (any || values.bankPos.trim())
      ? okcReconcile({ ...modpos, bankPos: amountOf(values.bankPos), ...f, okcVat: f.okcVat }, audience, kasa).filter((l) => l.key !== "okc-self")
      : [];

  return (
    <Card>
      <CardHeader icon={<ScrollText />} title="Yazarkasa Z raporu" description={description} />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        {/* Fişteki satırın adı yer tutucuda (alanın altında ayrı satır yerine); turuncu nedeni yine alanın altında */}
        {field("okcTotal", "Günlük toplam", opts("okcTotal", undefined, "NET SATIŞ / TOPLAM satırı"))}
        {textField("okcZNo", "Z no", opts("okcZNo", undefined, "Z NO (fiş no değil)"))}
        {field("okcCash", "Nakit", opts("okcCash", undefined, "isteğe bağlı"))}
        {field("okcCard", "Kredi kartı", opts("okcCard", undefined, "K.KARTI satırı"))}
        <div className="sm:col-span-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${uid}okc-details`}
            onClick={() => setChosen(!open)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] leading-5 ring-1 ring-line pointer-coarse:min-h-11",
              orange ? "bg-warn-soft text-warn ring-warn/30" : "bg-surface text-ink-soft hover:bg-surface/70",
            )}
          >
            <ChevronDown size={15} className={cn("shrink-0 transition-transform", open ? "rotate-180" : undefined)} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Ayrıntılar</span>
              {" · "}
              {orange ? `${orange} rakamı fişle karşılaştırın` : "KDV, fiş sayısı, yemek kartı, banka gün sonu (isteğe bağlı)"}
            </span>
          </button>
          <div id={`${uid}okc-details`} hidden={!open} className="mt-3 grid gap-3 sm:grid-cols-2">
            {field("okcMealCard", "Yemek kartı", opts("okcMealCard", "varsa"))}
            {field("okcOther", "Diğer", opts("okcOther", "varsa (havale, kupon…)"))}
            {field("okcVatTotal", "Toplam KDV", opts("okcVatTotal", "TOPKDV satırı", "isteğe bağlı"))}
            {textField("okcReceipts", "Fiş sayısı", opts("okcReceipts", "MÜŞTERİ FİŞ ADEDİ"))}
            <div className="space-y-2 sm:col-span-2">
              <p className="text-[13px] font-medium text-ink-soft">KDV dökümü</p>
              <p className="text-[13px] leading-5 text-ink-mute">Z&apos;deki VERGİ DÖKÜMÜ: oranın KDV dahil toplamı ve KDV&apos;si.</p>
              {OKC_RATES_SHOWN.filter((r) => r !== 1 || showRate1).map((rate) => (
                <div key={rate} className="grid grid-cols-2 gap-3">
                  {field(okcTKey(rate), `%${rate} toplam`, opts(okcTKey(rate), undefined, "isteğe bağlı"))}
                  {field(okcVKey(rate), `%${rate} KDV`, opts(okcVKey(rate), undefined, "isteğe bağlı"))}
                </div>
              ))}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-[13px] font-medium text-ink-soft">Banka gün sonu fişi (varsa)</p>
              <p className="text-[13px] leading-5 text-ink-mute">Bankanın ayrı gün sonu fişi varsa net toplamı.</p>
              {posPrompt}
              <div className="sm:max-w-[calc(50%-0.375rem)]">{field("bankPos", "Banka gün sonu", { placeholder: "isteğe bağlı" })}</div>
            </div>
          </div>
        </div>
        {live?.summary || lines.length ? (
          <div className="space-y-1.5 sm:col-span-2">
            {live?.summary ? <Notice tone="warn" size="sm" title={live.summary} /> : null}
            {audience === "admin" && live?.summary ? live.admin.slice(0, 3).map((t) => <Notice key={t} tone="neutral" size="sm" title={t} />) : null}
            {lines.map((l) => (
              <Notice key={l.key} tone={NOTE_TONE[l.tone]} size="sm" title={l.text} />
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// Denetim satırının tonu uyarı tonuna (mavi artık uyarı rengi değil: bilgi nötr)
const NOTE_TONE: Record<"good" | "info" | "warn", NoticeTone> = { good: "good", info: "neutral", warn: "warn" };
