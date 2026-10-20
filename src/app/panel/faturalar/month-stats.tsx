"use client";

import { Percent, ShoppingBasket } from "lucide-react";

import { useQueryState } from "@/components/ui/filters";
import { Stat } from "@/components/ui/misc";
import { monthLabel, tl } from "@/lib/format";

import { CountUp } from "./invoices-client";

/**
 * Aya bağlı iki kutucuk (mal alımı, komisyon). Listede ay süzgeci (?ay=) seçiliyse o ayı, değilse son ayı gösterir;
 * Genel bakış'taki "Eylül faturaları" bağlantısından gelen kişi üstte de Eylül'ü görür.
 */
export function MonthStats({
  months,
  goodsByMonth,
  commissionByMonth,
  goodsInfo,
}: {
  months: string[];
  goodsByMonth: number[];
  commissionByMonth: number[];
  goodsInfo: string;
}) {
  const [rawMonth] = useQueryState<string>("ay", "");
  const selected = months.includes(rawMonth);
  const idx = selected ? months.indexOf(rawMonth) : months.length - 1;
  const month = idx >= 0 ? months[idx] : null;
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const scope = selected ? "seçili ay" : "son ay";

  return (
    <>
      <Stat
        icon={<ShoppingBasket />}
        label={month ? `${monthLabel(month)} mal alımı` : "Mal alımı"}
        value={<CountUp value={month ? (goodsByMonth[idx] ?? 0) : 0} format="tl" />}
        sub={`Toplam ${tl(total(goodsByMonth))} · ${months.length} ay`}
        info={`${goodsInfo} Kutucuk listedeki ${scope} için.`}
      />
      <Stat
        icon={<Percent />}
        label={month ? `${monthLabel(month)} komisyon` : "Komisyon"}
        value={<CountUp value={month ? (commissionByMonth[idx] ?? 0) : 0} format="tl" />}
        sub={`Toplam ${tl(total(commissionByMonth))} · ${months.length} ay`}
        info={`Komisyon kategorisindeki faturalar (KDV hariç). Gelir-gider tablosunda komisyon giderlerine eklenir. Kutucuk listedeki ${scope} için.`}
      />
    </>
  );
}
