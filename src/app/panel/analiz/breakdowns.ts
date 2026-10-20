// Senaryo simülatörü kartlarının dökümü (karta dokununca açılan pencere). Saf fonksiyonlar: kaydırıcılar değiştikçe
// tarayıcıda yeniden kurulur, pencere kartın o anki rakamını gösterir. Kartlar da rakamlarını buradaki hesaplardan
// alır (zarar etmemek için gereken zam / satış, hedef kâr için günlük ciro); kart ile döküm ayrışmaz.
// Testleri tests/analiz-dokum.test.ts.

import { withRemainder, type BreakdownGroup, type BreakdownRow } from "@/lib/breakdown";
import { fixedMonthly, type Model } from "@/lib/calc/engine";
import type { applyScenario, ScenarioBase } from "@/lib/calc/insights";
import type { FixedExpense } from "@/lib/calc/types";
import { money, num, pct, tl } from "@/lib/format";

/** Senaryonun bir yanı (şu an ya da senaryo): `applyScenario`ın sonucu */
export type ScenarioSide = ReturnType<typeof applyScenario>["base"];

/** Tutar farkı: +1.200 ₺, -800 ₺ */
const signedTl = (v: number) => `${v > 0 ? "+" : ""}${tl(v)}`;
/** Alt satırın parçaları "·" ile; boş parça düşer */
const join = (...xs: (string | undefined)[]) => xs.filter(Boolean).join(" · ") || undefined;
/** Yazılı değerli bilgi satırı (tutarı 0 olsa da görünür) */
const info = (key: string, label: string, amount: number | null, display: string, sub?: string, tone?: BreakdownRow["tone"]): BreakdownRow => ({
  key,
  label,
  amount: amount !== null && Number.isFinite(amount) ? amount : 0,
  display,
  ...(sub ? { sub } : {}),
  ...(tone ? { tone } : {}),
});

/* ───────────────────────── Sabit giderlerin kalemleri (sunucu) ───────────────────────── */

/** Dönemi ayın olmayan kalemin aylığa çevrilişi (Sabit giderler sayfasıyla aynı) */
function periodText(fe: Pick<FixedExpense, "period" | "amount">, acikGun: number): string | undefined {
  if (fe.period === "gunluk") return `Günlük ${money(fe.amount)} × ${num(acikGun)} açık gün`;
  if (fe.period === "haftalik") return `Haftalık ${money(fe.amount)} × 52 ÷ 12`;
  if (fe.period === "yillik") return `Yıllık ${money(fe.amount)} ÷ 12`;
  return undefined;
}

/**
 * Senaryonun "sabit giderler"i kalem kalem: o ay çalışan personel (işveren maliyeti) ve o ay geçerli sabit gider
 * kalemleri, standart ay tutarıyla (`model.fixedStandardTotalFor` ile aynı toplam; fark olursa "Diğer").
 * Sunucuda kurulur, senaryo kartlarına hazır gelir.
 */
export function scenarioFixedItems(model: Model, month: string): BreakdownRow[] {
  const st = model.settings;
  const p = model.personnelFor(month);
  const rows: BreakdownRow[] = [
    {
      key: "personel",
      label: "Personel (işveren maliyeti)",
      sub: `${num(p.rows.length)} kişi · net maaşlar ${tl(p.net)}`,
      amount: p.total,
      href: "/panel/personel",
    },
    ...model.fixedInMonth(month).map((fe) => {
      const sub = periodText(fe, st.acikGun);
      return { key: `fixed:${fe.id}`, label: fe.name, ...(sub ? { sub } : {}), amount: fixedMonthly(fe, st), href: "/panel/giderler" };
    }),
  ];
  return withRemainder(rows, model.fixedStandardTotalFor(month), "Diğer", "fixed:other");
}

/* ───────────────────────── Kartların rakamları ───────────────────────── */

/**
 * "Zarar etmemek için" kartı: diğer her şey sabitken tek başına gereken ortalama zam ya da satış artışı (şu anki
 * ay). Zam malzemeyi ve sabit gideri değiştirmez, net satış, komisyon ve indirim fiyatla büyür; satış artışında
 * yalnızca sabit gider aynı kalır.
 */
export function breakEvenNeeds(base: ScenarioBase) {
  /** Zamla büyüyen gelir: net satış − POS komisyonu − indirimler */
  const priceBase = base.net - base.commission - base.discountsNet;
  /** Zamla değişmeyen, karşılanması gereken gider: malzeme + sabit giderler */
  const cover = base.material + base.fixed;
  /** Satıştan kalan katkı: net satış − malzeme − POS komisyonu − indirimler */
  const contribution = base.net - base.material - base.commission - base.discountsNet;
  return {
    priceBase,
    cover,
    contribution,
    price: priceBase > 0 ? cover / priceBase - 1 : null,
    volume: contribution > 0 ? base.fixed / contribution - 1 : null,
  };
}

/** Hedef aylık kârı (sabit giderlerle birlikte) karşılayan günlük ciro, KDV dahil; brüt kâr oranı eksiyse yok */
export function targetDaily(side: Pick<ScenarioSide, "grossRatio" | "fixed">, target: number, acikGun: number): number | null {
  return side.grossRatio > 0 ? (side.fixed + target) / side.grossRatio / acikGun : null;
}

/* ───────────────────────── Dökümler ───────────────────────── */

interface Sides {
  /** Şu anki ay */
  b: ScenarioSide;
  /** Senaryo (kaydırıcılarla) */
  s: ScenarioSide;
  /** Senaryoda bir değişiklik var mı: varsa kalemlerin altında şu anki değer de yazılır */
  dirty: boolean;
  /** Aylık sabit gider değişimi (₺) */
  extraFixed: number;
}

/** Brüt kâr oranı satırı: brüt kâr ÷ ciro (KDV dahil) */
function ratioRow({ b, s, dirty }: Sides): BreakdownRow {
  const ok = s.grossRatio > 0;
  return info(
    "ratio",
    "Brüt kâr oranı",
    s.grossRatio,
    pct(s.grossRatio, 1),
    join(
      `Brüt kâr ${tl(s.gross)} ÷ ciro ${tl(s.revenue)} (KDV dahil)`,
      dirty ? `şu an ${pct(b.grossRatio, 1)}` : undefined,
      ok ? undefined : "sıfır ya da eksi",
    ),
    ok ? undefined : "bad",
  );
}

/** Aylık sabit giderler satırı: senaryodaki değişim varsa şu anki tutar ve değişim alt satırda */
function fixedRow({ b, s, extraFixed }: Sides): BreakdownRow {
  return info(
    "fixed",
    "Aylık sabit giderler",
    s.fixed,
    tl(s.fixed),
    extraFixed ? `Şu an ${tl(b.fixed)}, senaryoda ${signedTl(extraFixed)}` : "Personel dahil, standart ay; kalemleri Net kâr kartında",
  );
}

/** Brüt kâr oranı sıfır ya da eksiyse aylık ciro hesaplanamaz */
const NO_RATIO = "Brüt kâr oranı sıfır ya da eksi: hesaplanamaz";

const daysRow = (acikGun: number) => info("days", "Ayda açık gün", acikGun, `${num(acikGun)} gün`, "Ayarlar'daki açık gün sayısı");

/**
 * Aylık net kâr / zarar: brüt kâr (net satış − malzeme − komisyon), indirimler ve sabit giderler kalem kalem. Satırlar
 * kartın rakamını tutar (gelir artı, giderler eksi; verilen sırayla).
 */
export function profitGroups(o: Sides & { fixedItems: BreakdownRow[]; month: string }): BreakdownGroup[] {
  const { b, s, dirty } = o;
  const was = (v: number) => (dirty ? `şu an ${tl(v)}` : undefined);
  // Sabit gider kalemleri şu anki ayın tutarıyla (senaryo onları değiştirmez), en büyüğü önce; değişim ayrı kalem
  const fixed = withRemainder(
    [...o.fixedItems].sort((x, y) => y.amount - x.amount || x.label.localeCompare(y.label, "tr")).map((r) => ({ ...r, amount: -r.amount })),
    -b.fixed,
    "Diğer",
    "fixed:other",
  );
  return [
    {
      key: "brut",
      label: "Brüt kâr",
      rows: [
        {
          key: "net",
          label: "Net satış (KDV hariç)",
          sub: join(`Ciro ${tl(s.revenue)} (KDV dahil)`, was(b.net)),
          amount: s.net,
          href: `/panel/satislar?ay=${o.month}`,
        },
        { key: "material", label: "Malzeme + ambalaj", sub: join("Reçetelere göre", was(b.material)), amount: -s.material },
        { key: "commission", label: "POS komisyonu", ...(dirty ? { sub: was(b.commission) } : {}), amount: -s.commission },
      ],
    },
    {
      key: "indirim",
      label: "İndirimler",
      rows: [{ key: "discounts", label: "Yönetici indirimleri (KDV hariç)", ...(dirty ? { sub: was(b.discountsNet) } : {}), amount: -s.discountsNet }],
    },
    {
      key: "sabit",
      label: "Sabit giderler",
      rows: [...fixed, ...(o.extraFixed ? [{ key: "extra", label: "Senaryo: sabit gider değişimi", amount: -o.extraFixed }] : [])],
    },
  ];
}

/** Başabaş günlük ciro: sabit giderler ÷ brüt kâr oranı ÷ açık gün (girdiler ve ara sonuç) */
export function breakEvenGroups(o: Sides & { acikGun: number }): BreakdownGroup[] {
  const { s } = o;
  const monthly = s.grossRatio > 0 ? s.fixed / s.grossRatio : null;
  return [
    {
      key: "hesap",
      rows: [
        fixedRow(o),
        ratioRow(o),
        info("monthly", "Başabaş aylık ciro", monthly, tl(monthly), monthly === null ? NO_RATIO : "Sabit giderler ÷ brüt kâr oranı"),
        daysRow(o.acikGun),
      ],
    },
  ];
}

/** Hedef kâr için günlük ciro: (sabit giderler + hedef kâr) ÷ brüt kâr oranı ÷ açık gün */
export function targetGroups(o: Sides & { acikGun: number; target: number; targetValid: boolean }): BreakdownGroup[] {
  const { s, target } = o;
  const need = s.fixed + target;
  const monthly = s.grossRatio > 0 ? need / s.grossRatio : null;
  return [
    {
      key: "hesap",
      rows: [
        fixedRow(o),
        o.targetValid
          ? info("target", "Hedef aylık kâr", target, tl(target))
          : info("target", "Hedef aylık kâr", target, tl(target), "Sayı okunamadı; 0 sayıldı", "warn"),
        info("need", "Karşılanacak toplam", need, tl(need), "Sabit giderler + hedef kâr"),
        ratioRow(o),
        info("monthly", "Gereken aylık ciro", monthly, tl(monthly), monthly === null ? NO_RATIO : "Karşılanacak toplam ÷ brüt kâr oranı"),
        daysRow(o.acikGun),
      ],
    },
  ];
}

/**
 * Zarar etmemek için: şu anki ayın rakamları, gereken ortalama zamın ve satış artışının hesabı. Kaydırıcılardan
 * bağımsız (şu anki ay); toplam satırı yok, iki yol ayrı ayrı.
 */
export function breakEvenNeedGroups(b: ScenarioSide): BreakdownGroup[] {
  const n = breakEvenNeeds(b);
  const amt = (key: string, label: string, v: number, sub?: string, tone?: BreakdownRow["tone"]) => info(key, label, v, tl(v), sub, tone);
  return [
    {
      key: "simdi",
      label: "Şu anki ay (KDV hariç)",
      noSubtotal: true,
      rows: [
        amt("net", "Net satış", b.net),
        amt("material", "Malzeme + ambalaj", b.material),
        amt("commission", "POS komisyonu", b.commission),
        amt("discounts", "Yönetici indirimleri", b.discountsNet),
        amt("fixed", "Sabit giderler", b.fixed, "Personel dahil, standart ay"),
        amt("profit", "Net kâr / zarar", b.profit, undefined, b.profit < 0 ? "bad" : "good"),
      ],
    },
    {
      key: "zam",
      label: "Ortalama zam",
      display: pct(n.price, 1),
      note:
        n.price === null
          ? "Zamla büyüyen gelir sıfır ya da eksi: zam zararı kapatmaz."
          : "Gereken zam = karşılanacak gider ÷ zamla büyüyen gelir − 1." +
            (n.price < 0 ? " Eksi çıktı: şu an kârdasınız, fiyatlar bu kadar inse de zarar edilmez." : ""),
      rows: [
        amt("priceBase", "Zamla büyüyen gelir", n.priceBase, "Net satış − POS komisyonu − indirimler"),
        amt("cover", "Karşılanacak gider", n.cover, "Malzeme + sabit giderler; zamla değişmez"),
      ],
    },
    {
      key: "satis",
      label: "Ya da satış artışı",
      display: pct(n.volume, 0),
      note:
        n.volume === null
          ? "Satıştan kalan katkı sıfır ya da eksi: satış artışı zararı kapatmaz."
          : "Gereken artış = sabit giderler ÷ katkı − 1." + (n.volume < 0 ? " Eksi çıktı: satışlar bu kadar düşse de zarar edilmez." : ""),
      rows: [
        amt("contribution", "Satıştan kalan katkı", n.contribution, "Net satış − malzeme − POS komisyonu − indirimler"),
        amt("fixed", "Sabit giderler", b.fixed, "Satışla değişmez"),
      ],
    },
  ];
}
