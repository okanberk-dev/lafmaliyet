"use client";

import { Percent, ShoppingBasket } from "lucide-react";

import { useQueryState } from "@/components/ui/filters";
import { Stat } from "@/components/ui/misc";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import type { BreakdownGroup } from "@/lib/breakdown";
import { monthLabel, tl } from "@/lib/format";

import { CountUp } from "./invoices-client";

/**
 * Aya bağlı iki kutucuk (mal alımı, komisyon), dökümleriyle: dokununca o ayın mal kategorileri ve tedarikçileri ya
 * da komisyon faturaları açılır. Listede ay süzgeci (?ay=) seçiliyse o ayı, değilse son ayı gösterir; Genel bakış'taki
 * "Eylül faturaları" bağlantısından gelen kişi üstte de Eylül'ü görür. Döküm sunucuda ay ay kurulur.
 */
export function MonthStatCards({
  months,
  goodsByMonth,
  commissionByMonth,
  goodsInfo,
  goods,
  commission,
}: {
  months: string[];
  goodsByMonth: number[];
  commissionByMonth: number[];
  goodsInfo: string;
  goods: Record<string, BreakdownGroup[]>;
  commission: Record<string, BreakdownGroup[]>;
}) {
  const [rawMonth] = useQueryState<string>("ay", "");
  const selected = months.includes(rawMonth);
  const idx = selected ? months.indexOf(rawMonth) : months.length - 1;
  const month = idx >= 0 ? months[idx] : null;
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const scope = selected ? "seçili ay" : "son ay";
  const goodsValue = month ? (goodsByMonth[idx] ?? 0) : 0;
  const commissionValue = month ? (commissionByMonth[idx] ?? 0) : 0;

  return (
    <>
      <StatBreakdown
        title={month ? `${monthLabel(month)} mal alımı` : "Mal alımı"}
        description="Mal kategorileri, tedarikçi tedarikçi (KDV hariç, iskonto düşülmüş). Tedarikçiye dokununca faturaları listede açılır."
        groups={month ? (goods[month] ?? []) : []}
        total={goodsValue}
        empty="Bu ay mal alımı faturası yok."
      >
        <Stat
          icon={<ShoppingBasket />}
          label={month ? `${monthLabel(month)} mal alımı` : "Mal alımı"}
          value={<CountUp value={goodsValue} format="tl" />}
          sub={`Toplam ${tl(total(goodsByMonth))} · ${months.length} ay`}
          info={`${goodsInfo} Kutucuk listedeki ${scope} için.`}
        />
      </StatBreakdown>
      <StatBreakdown
        title={month ? `${monthLabel(month)} komisyon` : "Komisyon"}
        description="Komisyon faturaları, tedarikçi tedarikçi (KDV hariç). Gelir-gider'de komisyon giderlerine eklenir."
        groups={month ? (commission[month] ?? []) : []}
        total={commissionValue}
        empty="Bu ay komisyon faturası yok."
      >
        <Stat
          icon={<Percent />}
          label={month ? `${monthLabel(month)} komisyon` : "Komisyon"}
          value={<CountUp value={commissionValue} format="tl" />}
          sub={`Toplam ${tl(total(commissionByMonth))} · ${months.length} ay`}
          info={`Komisyon kategorisindeki faturalar (KDV hariç). Gelir-gider tablosunda komisyon giderlerine eklenir. Kutucuk listedeki ${scope} için.`}
        />
      </StatBreakdown>
    </>
  );
}
