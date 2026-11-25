import { CakeSlice, CalendarClock, CircleSlash, MicVocal, ShoppingBag, TimerOff, TrendingUp, UsersRound } from "lucide-react";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PastelTone } from "@/components/ui/icon-tile";

import type { CafeLine } from "./logic";

/** Satırın ikonu ve karo rengi (ActivityItem: 0 yeşil, 1 turuncu, 2 mavi, 3 kırmızı, 4 mor) */
function look(line: CafeLine): { icon: React.ReactNode; tone: PastelTone } {
  // Satış tahmininin satırları (personel): yoğun gün turuncu, değilse mavi
  if (line.key === "yogunluk") return { icon: <TrendingUp />, tone: line.tone === "warn" ? 1 : 2 };
  if (line.key === "tatli") return { icon: <CakeSlice />, tone: 4 };
  if (line.tone === "warn") return { icon: <TimerOff />, tone: 3 };
  switch (line.key) {
    case "oda":
      return { icon: <MicVocal />, tone: 0 };
    case "karaoke":
      return { icon: <MicVocal />, tone: 4 };
    case "siradaki":
      return { icon: <CalendarClock />, tone: 2 };
    case "siparis":
      return { icon: <ShoppingBag />, tone: 1 };
    case "tukendi":
      return { icon: <CircleSlash />, tone: 3 };
    // Bugünün vardiyası (docs/VARDIYA.md): Vardiya ekranına götürür
    case "vardiya":
      return { icon: <UsersRound />, tone: 2 };
  }
}

/**
 * Bugün · "Bugün kafede": personelde önce satış tahmininin yoğunluğu ve tatlı sayısı (tutarsız), karaoke odası (süren
 * oturum, günün rezervasyonları, sıradaki), açık uygulama siparişleri ve tükenen ürünler.
 * Statik özet: sayaç, alarm ve siparişin aşaması bar ekranında kalır; satırlar oraya (ya da satırın kendi adresine,
 * ör. Tükenenler) götürür. Tutar yok. Karaoke seçili şubede kullanılmıyorsa (şube özelliği) bar ekranı Siparişler
 * (`barHref`).
 */
export function TodayCafe({ lines, barHref = "/panel/karaoke" }: { lines: CafeLine[]; barHref?: string }) {
  return (
    <Card>
      <CardHeader
        icon={<MicVocal />}
        title="Bugün kafede"
        actions={
          <ButtonLink href={barHref} variant="secondary" size="sm" className="pointer-coarse:h-11">
            Bar ekranı
          </ButtonLink>
        }
      />
      <CardContent className="px-3 sm:px-5">
        <ActivityList>
          {lines.map((l) => {
            const { icon, tone } = look(l);
            // Tahmin satırlarının ekranı (Satış tahmini) personele kapalı: satırın kendi adresi yoksa bağlantısız (yoğunluk
            // satırı personelin Özel günler'ine gider), uyarı noktasız
            const forecast = l.key === "yogunluk" || l.key === "tatli";
            return (
              <ActivityItem
                key={l.key}
                icon={icon}
                tone={tone}
                title={l.text}
                href={l.href ?? (forecast ? undefined : barHref)}
                dot={l.tone === "warn" && !forecast ? "danger" : undefined}
                wrap
              />
            );
          })}
        </ActivityList>
      </CardContent>
    </Card>
  );
}
