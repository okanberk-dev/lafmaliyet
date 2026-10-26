"use client";

import { ChevronDown, Info, ScrollText, TriangleAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { parseNumberTR } from "@/lib/calc/expr";
import type { CashReportFields } from "@/lib/cash-report";
import { okcFormChecks, okcFormError, okcReconcile, type OkcField, type OkcFormValues, type OkcVatInput, type OkcVatLine } from "@/lib/okc-z";
import { cn } from "@/lib/utils";

/*
 * Banka POS Z raporu (yazarkasa) kartı (dalga 13 PR-b; docs/planlar/okc-z.md §3.2–§3.6, §8, D16, D18). Bugünkü "Kart"
 * kartının yerine: fotoğraf + dört alan (Günlük toplam, Z no, Nakit, Kredi kartı), gerisi Ayrıntılar'da (KDV dökümü,
 * fiş sayısı, yemek kartı, diğer, banka gün sonu yedeği). Değerler ve fotoğraf işaretleri cash-form.tsx'te kalır (köprü:
 * `field` / `textField` / `marked`); bu kart düzeni, canlı denetimi (okcFormChecks: alan başına tek turuncu neden, tek
 * özet satırı) ve kart satırını (okcReconcile) çizer. Kümülatif formda yoktur (D17): personelin denetimi yalnız önceki
 * Z'nin numarasıyla. Personel yalnız kendi düzeltebileceği satırları görür (kart ve kendi içinde); yöneticinin
 * satırları (toplam, nakit, yemek kartı, banka) yalnız yönetici formu düzenlerken (İlke 8).
 *
 * Doldurma kapısı (OKC_PREFILL_ENABLED, src/lib/okc-z.ts) bu kartı değiştirmez: kapalıyken okunan her rakam alanın
 * altında öneri ("Fotoğraftakini yaz"), açıkken prefillPlan alanı doldurur; ikisi de cash-form'un işaretleriyle çizilir.
 */

/** Yazarkasa tutar alanları (formdaki sırayla); döküm `okcT*` / `okcV*` olarak iki sütunda yazılır */
export const OKC_MONEY_KEYS = ["okcTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcVatTotal", "okcT1", "okcV1", "okcT10", "okcV10", "okcT20", "okcV20"] as const;
export type OkcMoneyKey = (typeof OKC_MONEY_KEYS)[number];
export type OkcKey = OkcMoneyKey | "okcZNo" | "okcReceipts";
export const OKC_KEYS: readonly OkcKey[] = ["okcZNo", "okcReceipts", ...OKC_MONEY_KEYS];
export type OkcValues = Record<OkcKey, string>;

/** Kartın yazılan alanları: yazarkasa alanları ve banka gün sonu (yedek) */
type CardKey = OkcKey | "bankPos";

const RATES = [1, 10, 20] as const;
const tKey = (rate: number) => `okcT${rate}` as OkcMoneyKey;
const vKey = (rate: number) => `okcV${rate}` as OkcMoneyKey;

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

/** Kayıtlı raporun (ya da bekleyen isteğin) yazarkasa alanları formun metnine */
export function okcValuesOf(r: Partial<CashReportFields> | null): OkcValues {
  const out = Object.fromEntries(OKC_KEYS.map((k) => [k, ""])) as OkcValues;
  if (!r) return out;
  out.okcZNo = r.okcZNo ?? "";
  out.okcReceipts = r.okcReceipts === null || r.okcReceipts === undefined ? "" : String(r.okcReceipts);
  for (const k of ["okcTotal", "okcVatTotal", "okcCash", "okcCard", "okcMealCard", "okcOther"] as const) out[k] = text(r[k]);
  for (const l of r.okcVat ?? []) {
    if (!RATES.includes(l.rate as (typeof RATES)[number])) continue;
    out[tKey(l.rate)] = text(l.total);
    out[vKey(l.rate)] = text(l.vat);
  }
  return out;
}

const amountOf = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = parseNumberTR(t);
  return n === null || n < 0 ? null : Math.round(n * 100) / 100;
};

/** Formun yazarkasa metinleri sayıya (okunamayan tutar boş sayılır; canlı denetim için) */
function figuresOf(v: OkcValues): OkcFormValues & { lines: OkcVatInput[] } {
  const lines: OkcVatInput[] = RATES.map((rate) => ({ rate, total: amountOf(v[tKey(rate)]), vat: amountOf(v[vKey(rate)]) })).filter((l) => l.total !== null || l.vat !== null);
  const receipts = v.okcReceipts.trim() ? Number(v.okcReceipts.replace(/\D/g, "")) : null;
  return {
    okcZNo: v.okcZNo.trim() || null,
    okcReceipts: receipts !== null && Number.isFinite(receipts) ? receipts : null,
    okcTotal: amountOf(v.okcTotal),
    okcVatTotal: amountOf(v.okcVatTotal),
    okcCash: amountOf(v.okcCash),
    okcCard: amountOf(v.okcCard),
    okcMealCard: amountOf(v.okcMealCard),
    okcOther: amountOf(v.okcOther),
    // Kimliklere yalnız toplamı ve KDV'si birlikte yazılan oranlar (eksik çift gönderimde söylenir)
    okcVat: lines.filter((l): l is OkcVatLine => l.total !== null && l.vat !== null),
    lines,
  };
}

/**
 * Gönderimde yazarkasa alanları (plan §3.2; sunucu aynı kuralı aynı metinle uygular, okcFormError): bölüm boş
 * kalabilir; bir tutar yazıldıysa günlük toplam, nakit ve kredi kartı; oranın toplamı ile KDV'si birlikte, KDV
 * toplamdan büyük değil. Hatalı alan ve metni, yoksa raporun yazarkasa alanları (boşlar null)
 */
export function okcFieldsOf(v: OkcValues): { fields: Pick<CashReportFields, "okcZNo" | "okcReceipts" | "okcTotal" | "okcVatTotal" | "okcVat" | "okcCash" | "okcCard" | "okcMealCard" | "okcOther"> | null; errors: Partial<Record<OkcKey, string>> } {
  const errors: Partial<Record<OkcKey, string>> = {};
  for (const k of OKC_MONEY_KEYS) if (v[k].trim() && amountOf(v[k]) === null) errors[k] = "Geçerli bir tutar yazın (ör. 1.250,50)";
  if (Object.keys(errors).length) return { fields: null, errors };
  const f = figuresOf(v);
  const message = okcFormError({ ...f, okcVat: f.lines });
  if (message) {
    // Kuralın alanı (okcFormError'un sırasıyla): önce döküm çiftleri, sonra günlük toplam, nakit, kart
    const pair = f.lines.find((l) => (l.total === null) !== (l.vat === null) || (l.total !== null && l.vat !== null && l.vat > l.total + 0.005));
    const key: OkcKey = pair ? (pair.total === null ? tKey(pair.rate) : vKey(pair.rate)) : f.okcTotal === null ? "okcTotal" : f.okcCash === null ? "okcCash" : "okcCard";
    return { fields: null, errors: { [key]: message } };
  }
  return {
    fields: {
      okcZNo: f.okcZNo,
      okcReceipts: f.okcReceipts,
      okcTotal: f.okcTotal,
      okcVatTotal: f.okcVatTotal,
      okcVat: f.okcVat?.length ? f.okcVat : null,
      okcCash: f.okcCash,
      okcCard: f.okcCard,
      okcMealCard: f.okcMealCard,
      okcOther: f.okcOther,
    },
    errors,
  };
}

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
  photoBlock,
  posPrompt,
  description,
  prevZ,
  day,
  audience,
  forceDetails,
  modpos,
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
  photoBlock: ReactNode;
  posPrompt: ReactNode;
  description: string;
  /** Önceki yazarkasa Z'si (yalnız gün ve numara; kümülatif personele gitmez, D17) */
  prevZ: { date: string; zNo: string } | null;
  day: string;
  /** Kim bakıyor: yönetici karşılaştırma satırlarının hepsini görür */
  audience: "staff" | "admin";
  /** Yönetici düzenliyor: Ayrıntılar açık gelir */
  forceDetails: boolean;
  modpos: ModposFigures | null;
}) {
  const uid = useId();
  const f = figuresOf(values);
  const any = [f.okcTotal, f.okcCash, f.okcCard, f.okcMealCard, f.okcOther, f.okcVatTotal].some((x) => x !== null) || f.lines.length > 0;
  const live = any ? okcFormChecks(f, { prevZ, day }) : null;
  const reasonOf = (k: CardKey): string | null => (k === "bankPos" ? null : (live?.fields[k as OkcField] ?? null));
  // Alan başına tek turuncu neden: fotoğrafın işareti varsa o (cash-form çizer), yoksa canlı denetimin nedeni
  const opts = (k: CardKey, hint?: ReactNode, placeholder?: string): OkcFieldOptions => {
    const reason = marked(k) ? null : reasonOf(k);
    return { hint: reason ? <span className="text-warn">{reason}</span> : hint, warn: reason !== null, placeholder };
  };

  // Ayrıntılar: fotoğraftan dolunca açılmaz; içinde turuncu alan, hata ya da yönetici düzenliyorsa açık gelir
  const orange = DETAIL_KEYS.filter((k) => marked(k) || reasonOf(k) !== null || failed(k)).length;
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [seenOrange, setSeenOrange] = useState(orange);
  if (orange !== seenOrange) {
    setSeenOrange(orange);
    // Yeni bir turuncu gelince kişinin kapattığı kutu yeniden açılır
    if (orange > seenOrange) setChosen(null);
  }
  const open = chosen ?? (orange > 0 || forceDetails);
  const showRate1 = Boolean(values.okcT1.trim() || values.okcV1.trim() || marked("okcT1") || marked("okcV1"));

  // Kart satırı ve (yöneticide) öteki karşılaştırmalar; kendi içindeki denetim özet satırında
  const lines =
    modpos && (any || values.bankPos.trim())
      ? okcReconcile({ ...modpos, bankPos: amountOf(values.bankPos), ...f, okcVat: f.okcVat }, audience).filter((l) => l.key !== "okc-self")
      : [];

  return (
    <Card>
      <CardHeader icon={<ScrollText />} title="Banka POS Z raporu (yazarkasa)" description={description} />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        {photoBlock}
        {field("okcTotal", "Günlük toplam", opts("okcTotal", "NET SATIŞ ya da TOPLAM satırı; en büyük rakam değil", "isteğe bağlı"))}
        {textField("okcZNo", "Z no", opts("okcZNo", "Z NO / Z SAYAÇ (fiş no değil)"))}
        {field("okcCash", "Nakit", opts("okcCash", undefined, "isteğe bağlı"))}
        {field("okcCard", "Kredi kartı", opts("okcCard", "K.KARTI satırı; altındaki banka satırları değil", "isteğe bağlı"))}
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
              {RATES.filter((r) => r !== 1 || showRate1).map((rate) => (
                <div key={rate} className="grid grid-cols-2 gap-3">
                  {field(tKey(rate), `%${rate} toplam`, opts(tKey(rate), undefined, "isteğe bağlı"))}
                  {field(vKey(rate), `%${rate} KDV`, opts(vKey(rate), undefined, "isteğe bağlı"))}
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
            {live?.summary ? <Note tone="warn">{live.summary}</Note> : null}
            {audience === "admin" && live?.summary
              ? live.admin.slice(0, 3).map((t) => (
                  <Note key={t} tone="info">
                    {t}
                  </Note>
                ))
              : null}
            {lines.map((l) => (
              <Note key={l.key} tone={l.tone}>
                {l.text}
              </Note>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Note({ tone, children }: { tone: "good" | "info" | "warn"; children: ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-5", tone === "warn" ? "bg-warn-soft text-warn" : tone === "good" ? "bg-lime/25 text-good-ink" : "bg-info-soft text-info")}>
      {tone === "warn" ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
