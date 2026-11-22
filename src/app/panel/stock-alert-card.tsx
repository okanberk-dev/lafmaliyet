import { PackageMinus } from "lucide-react";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TONE_TILE } from "@/components/ui/notice";
import { num } from "@/lib/format";
import { STOCK_ESTIMATE_PATH } from "@/lib/stock-estimate";
import type { StockAlertData } from "@/server/data/stock-estimate";

/**
 * Genel bakış (yönetici) ve Bugün'ün (iki rol) küçük kartı: Marina'da tahmini stoğu kritik eşiğe inen malzemeler, en
 * çok dördü (docs/STOK-TAHMINI.md § 4). Yalnız Marina ya da "Tümü" seçiliyken ve kritik kalem varken çizilir
 * (loadStockAlert); Tuzla seçiliyken hiç yüklenmez. Rakamlar tahminidir; tutar yok.
 */
export function StockAlertCard({ data, className }: { data: StockAlertData; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader
        icon={<PackageMinus />}
        title="Kritik stok"
        description="Marina · tahmini; gerçek stok ay sonu sayımıdır."
        actions={
          <ButtonLink href={STOCK_ESTIMATE_PATH} variant="secondary" size="sm">
            Tahmini stok
          </ButtonLink>
        }
      />
      <CardContent className="px-3 sm:px-5">
        <ActivityList>
          {data.items.map((i) => (
            <ActivityItem key={i.ingredientId} icon={<PackageMinus />} well={TONE_TILE.warn} title={i.name} description={i.text} href={STOCK_ESTIMATE_PATH} />
          ))}
        </ActivityList>
        {data.more ? <p className="px-1 pt-2 text-[13px] text-ink-mute">ve {num(data.more)} malzeme daha</p> : null}
      </CardContent>
    </Card>
  );
}
