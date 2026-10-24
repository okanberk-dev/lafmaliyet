import { CakeSlice } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { WEEKDAY_NAMES } from "@/lib/forecast/calendar";
import { monthsLabel } from "@/lib/forecast/text";
import { num } from "@/lib/format";
import type { ForecastPageData } from "@/server/forecast/load";

/** "Tatlılar" / "Tatlılar ve Pastalar" / "A, B ve C" */
function joinTR(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ve ${xs[xs.length - 1]}`;
}

/** Kart "Tatlı hazırlığı": önümüzdeki 7 günde kaç dilim / adet, bütün pasta sayısı */
export function ForecastDesserts({ data }: { data: ForecastPageData }) {
  const days = data.forecast.days;
  if (!days.length) return null;
  if (!data.mix || !data.plan) {
    // Satış yüklü ama tatlı kategorilerinde satış yoksa (kategorinin adı "Pasta", ya da yanlış seçilmiş) Satışlar'a
    // göndermek yanıltır: sorun Tahmin ayarları'nda
    const byCategory = data.dessertGap === "kategori";
    const cats = data.categories.filter((c) => c.dessert).map((c) => c.name);
    const where = cats.length > 3 ? `seçili ${cats.length} kategoride` : `${joinTR(cats)} ${cats.length > 1 ? "kategorilerinde" : "kategorisinde"}`;
    return (
      <Card>
        <CardHeader icon={<CakeSlice />} title="Tatlı hazırlığı" />
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-[1_1_16rem] text-sm text-ink-mute">
            {!byCategory
              ? "Tatlı önerisi için Satışlar'a en az bir ayın ürün satışını yükleyin."
              : cats.length
                ? `Son satış aylarında ${where} satış yok. Tatlıların kategorisini Tahmin ayarları'ndan seçin.`
                : "Adında “tatlı” geçen bir kategori yok. Tatlıların kategorisini Tahmin ayarları'ndan seçin."}
          </p>
          {byCategory ? (
            <ButtonLink href="/panel/tahmin#ayarlar" variant="ghost" size="sm">
              Tahmin ayarları
            </ButtonLink>
          ) : (
            <ButtonLink href="/panel/satislar" variant="ghost" size="sm">
              Satışlar
            </ButtonLink>
          )}
        </CardContent>
      </Card>
    );
  }
  const plan = data.plan;
  const basis = monthsLabel(data.mix.basis.months);
  const nameOf = (i: number) => (days[i].offset === 0 ? "bugün" : days[i].offset === 1 ? "yarın" : WEEKDAY_NAMES[days[i].weekday]);
  const cats = data.mix.categories;
  return (
    <Card>
      <CardHeader icon={<CakeSlice />} title="Tatlı hazırlığı" description={`Önümüzdeki 7 gün · ${basis} satışındaki payına göre`} />
      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-ink">
          Bu hafta ≈ {num(plan.weekTotal)} tatlı · bugün ≈ {num(plan.perDay[0] ?? 0)}
        </p>
        {plan.items.length ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface px-4 ring-1 ring-line">
            {plan.items.map((x) => {
              const max = Math.max(...x.perDay);
              const at = x.perDay.indexOf(max);
              const amount =
                x.item.unit === "dilim"
                  ? `≈ ${num(x.total)} dilim${x.wholes !== null ? ` · ${num(x.wholes, 1)} bütün (${num(x.item.perWhole)} dilimlik)` : ""}`
                  : `≈ ${num(x.total)} adet`;
              return (
                <li key={x.item.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words text-ink">{x.item.label}</span>
                    <span className="block text-xs text-ink-mute">
                      Bugün ≈ {num(x.perDay[0] ?? 0)}
                      {/* En çok çıkan gün bugünden fazlaysa (bugünse tekrar yazılmaz) */}
                      {at > 0 && max > (x.perDay[0] ?? 0) ? ` · en çok ${nameOf(at)} (${num(max)})` : ""}
                    </span>
                  </span>
                  <span className="text-sm whitespace-nowrap text-ink-soft tabular">{amount}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
      <CardFooter className="text-xs">
        <span className="min-w-0">
          Her 10.000 ₺ satışta {num(plan.per10k, 1)} tatlı ({basis}). ModPOS&apos;un günlük ürün satışı gelince her gün kendi oranıyla hesaplanacak. Hesapta yalnız{" "}
          {joinTR(cats)} {cats.length > 1 ? "kategorileri" : "kategorisi"} var; Tahmin ayarları&apos;ndan değişir. Satışı olmayan yeni tatlılar hesapta yok.
        </span>
      </CardFooter>
    </Card>
  );
}
