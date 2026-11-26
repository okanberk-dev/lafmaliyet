import { Database } from "lucide-react";

import { CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { QUOTA_ADVICE, quotaMessage, quotaPctText, quotaReached, quotaTone, quotaUsageText, QUOTA_THRESHOLDS } from "@/lib/db-quota";
import { cn } from "@/lib/utils";
import { loadDbUsage, readDbQuotaState } from "@/server/db-quota/state";

import { SectionCard } from "./section-card";

const BAR_TONE = { ok: "bg-ink", warn: "bg-warn", bad: "bg-bad" } as const;

/**
 * Ayarlar › Veritabanı (docs/YEDEK.md › Veritabanı kotası): veritabanının o anki boyutu, kotası (`DB_QUOTA_MB`,
 * varsayılan 512 MB, Neon ücretsiz planı) ve kullanım çubuğu; %70 ve %90 eşikleri çubukta işaretli. Eşik geçilince
 * sabah işi zil ve e-postayla uyarır (src/server/db-quota/check.ts); burada yalnız okunur. Sayfa yalnız yöneticiye açık.
 */
export async function DatabaseCard() {
  const [usage, state] = await Promise.all([
    loadDbUsage().catch((e) => {
      console.error("Veritabanı boyutu okunamadı", e);
      return null;
    }),
    readDbQuotaState().catch(() => null),
  ]);
  const tone = usage ? quotaTone(usage.pct) : null;
  const summary = usage ? `${quotaPctText(usage.pct)} dolu · ${quotaUsageText(usage.bytes, usage.quotaMb)}` : "Boyut okunamadı";
  const level = usage ? quotaReached(usage.pct) : 0;
  // Uyarının başlığı zil ve e-postayla aynı; kullanım hemen üstte yazdığı için gövdede yalnız ne yapılacağı
  const warn = usage && level ? quotaMessage(level, usage.bytes, usage.quotaMb) : null;
  return (
    <SectionCard
      id="veritabani"
      icon={<Database />}
      title="Veritabanı"
      summary={summary}
      summaryTone={!usage || tone === "bad" ? "bad" : tone === "warn" ? "warn" : undefined}
      description={
        <>
          Panelin bütün verisi bu veritabanında durur. Kota dolarsa panel yeni kayıt yazamaz: satış, fatura ve kasa raporu girilemez. %70 ve %90 geçilince zil ve
          e-postayla uyarılırsınız.{" "}
          <InfoTip text="Veritabanı Neon'da; ücretsiz planın kotası 0,5 GB. Boyutu sabah işi her gün ölçer, eşik başına bir kez uyarır (kullanım eşiğin altına inip yeniden geçerse yine). Plan yükseltilince geliştirici Vercel'de DB_QUOTA_MB'yi yeni kotaya göre günceller." />
        </>
      }
    >
      <CardContent className="space-y-3">
        {usage ? (
          <div className="rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-ink">
                <span className="text-ink-mute">Kullanım:</span> <span className="tabular">{quotaUsageText(usage.bytes, usage.quotaMb)}</span>
              </span>
              <span className={cn("font-medium tabular", tone === "bad" ? "text-bad-ink" : tone === "warn" ? "text-warn-ink" : "text-ink")}>{quotaPctText(usage.pct)}</span>
            </div>
            <div
              className="relative mt-2 h-2.5 rounded-full bg-panel-deep"
              role="meter"
              aria-label="Veritabanı kullanımı"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.floor(usage.pct))}
              aria-valuetext={`${quotaPctText(usage.pct)} dolu`}
            >
              <div className={cn("h-full rounded-full", BAR_TONE[tone ?? "ok"])} style={{ width: `${Math.min(100, Math.max(usage.pct, usage.pct > 0 ? 1 : 0))}%` }} />
              {QUOTA_THRESHOLDS.map((t) => (
                <span key={t} className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink-quiet" style={{ left: `${t}%` }} aria-hidden="true" />
              ))}
            </div>
            <div className="relative mt-1 h-4 text-[11px] leading-4 text-ink-mute" aria-hidden="true">
              {QUOTA_THRESHOLDS.map((t) => (
                <span key={t} className="absolute -translate-x-1/2 tabular" style={{ left: `${t}%` }}>
                  %{t}
                </span>
              ))}
            </div>
            {state?.checkedAt ? (
              <p className="mt-1 text-[13px] text-ink-mute">
                Uyarı eşikleri %70 ve %90; sabah işinin son ölçümü{" "}
                {new Date(state.checkedAt).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}.
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-ink-mute">Uyarı eşikleri %70 ve %90; sabah işi her gün ölçer.</p>
            )}
          </div>
        ) : (
          <Notice tone="bad" size="sm" title="Veritabanının boyutu okunamadı; sayfayı yenileyin" />
        )}
        {warn ? <Notice tone={level === 90 ? "bad" : "warn"} size="sm" risk="veri" title={warn.title} text={QUOTA_ADVICE} /> : null}
      </CardContent>
    </SectionCard>
  );
}
