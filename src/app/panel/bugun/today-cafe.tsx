import { CalendarClock, MicVocal, ShoppingBag, TimerOff } from "lucide-react";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PastelTone } from "@/components/ui/icon-tile";

import type { CafeLine } from "./logic";

/** Satırın ikonu ve karo rengi (ActivityItem: 0 yeşil, 1 turuncu, 2 mavi, 3 kırmızı, 4 mor) */
function look(line: CafeLine): { icon: React.ReactNode; tone: PastelTone } {
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
  }
}

/**
 * Bugün · "Bugün kafede": karaoke odası (süren oturum, günün rezervasyonları, sıradaki) ve açık uygulama siparişleri.
 * Statik özet: sayaç, alarm ve siparişin aşaması bar ekranında kalır; satırlar oraya götürür. Tutar yok.
 */
export function TodayCafe({ lines }: { lines: CafeLine[] }) {
  return (
    <Card>
      <CardHeader
        icon={<MicVocal />}
        title="Bugün kafede"
        actions={
          <ButtonLink href="/panel/karaoke" variant="secondary" size="sm" className="pointer-coarse:h-11">
            Bar ekranı
          </ButtonLink>
        }
      />
      <CardContent className="px-3 sm:px-5">
        <ActivityList>
          {lines.map((l) => {
            const { icon, tone } = look(l);
            return <ActivityItem key={l.key} icon={icon} tone={tone} title={l.text} href="/panel/karaoke" dot={l.tone === "warn" ? "danger" : undefined} wrap />;
          })}
        </ActivityList>
      </CardContent>
    </Card>
  );
}
