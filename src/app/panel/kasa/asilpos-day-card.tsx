import { Store } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { AsilposDayDetail } from "@/lib/asilpos/gun-ayrinti";

/**
 * Yöneticinin Kasa gün görünümünde AsilPOS gününün ayrıntısı (Faz 2, 23 Kasım 2026; src/lib/asilpos/gun-ayrinti.ts):
 * yazarkasadan geçmeyen ödemeler, ödeme iptalleri, iptal edilen kalemler (hazırlanmış zayi, hazırlanmamış bilgi), yazarkasa
 * Z no, KDV dökümü, gönderim sırası ve düzeltmenin nedeni. Eski AsilPOS'un gününde (bölüm yok) kart görünmez. Pavo'nun hata
 * kodu Pavo kartında. Sunucu bileşeni.
 */
export function AsilposDayCard({ detail }: { detail: AsilposDayDetail & { sends: number } }) {
  if (!detail.sections.length && !detail.correction) return null;
  const sends = detail.sends > 1 ? `${detail.sends} kez gönderildi; panelde son gönderim` : null;
  return (
    <Card>
      <CardHeader icon={<Store />} title="AsilPOS gün sonu ayrıntısı" description="Yazarkasadan geçmeyen ödemeler, iptaller, yazarkasa Z no ve KDV" />
      <div className="space-y-3 px-5 pb-5 text-sm">
        {detail.correction ? <Notice tone="warn" title={detail.correction} text={sends ?? undefined} /> : sends ? <p className="text-ink-mute">{sends}</p> : null}
        {detail.sections.map((sec) => (
          <section key={sec.title} aria-label={sec.title}>
            <h3 className="text-xs font-medium text-ink-mute">{sec.title}</h3>
            <ul className="divide-y divide-line">
              {sec.rows.map(([label, value]) => (
                <li key={label} className="flex items-baseline justify-between gap-4 py-1.5">
                  <span className="min-w-0 break-words text-ink">{label}</span>
                  <span className="shrink-0 text-right text-ink tabular">{value}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {detail.refunds.length ? (
          <section aria-label="Ödeme iptalleri">
            <h3 className="text-xs font-medium text-ink-mute">İptal edilen ödemeler</h3>
            <ul className="divide-y divide-line">
              {detail.refunds.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-1.5">
                  <span className="min-w-0 break-words text-ink-soft">
                    {r.name}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </span>
                  <span className="shrink-0 text-right text-ink tabular">{r.amount}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
