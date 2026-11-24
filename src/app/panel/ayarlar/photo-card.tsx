import { ScanText } from "lucide-react";

import { CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { formatBytes } from "@/lib/documents";
import { modelName } from "@/lib/photo-read/models";
import { KEEP_DAYS } from "@/lib/photo-rules";
import { aiConfigured, aiUsageSummary, loadAiSettings } from "@/server/ai/claude";
import { photoStorage, photoStorageStats } from "@/server/storage/photos";

import { PhotoReadingForm } from "./photo-settings";
import { SectionCard } from "./section-card";
import { photoReadingSummary, usdText } from "./summaries";

/** Hobby Blob deposu 1 GB; bundan sonra uyarılır */
const STORAGE_WARN_BYTES = 800 * 1024 * 1024;

/**
 * Ayarlar › Fotoğraftan okuma: Z raporu, POS fişi ve kasadan çıkan fişler Claude ile okunur (docs/FOTOGRAF.md); aynı
 * anahtar ve sınır faturadan okumayı da (fiyat onayı, ürün bağlama; docs/FATURA-OKUMA.md) açar ve kapatır. Aç / kapat,
 * günde en çok okuma, bu ayın ve bugünün okumaları, fotoğraf deposu. Anahtar yoksa (yerel, önizleme) okuma kapalıdır;
 * fotoğraf yine eklenir.
 */
export async function PhotoReadingCard() {
  const storage = photoStorage();
  const [settings, usage, stats] = await Promise.all([
    loadAiSettings(),
    aiUsageSummary(),
    photoStorageStats().catch((e) => {
      console.error("Fotoğraf deposu sayılamadı", e);
      return null;
    }),
  ]);
  const configured = aiConfigured();
  const where = storage.driver === "blob" ? "Vercel Blob (özel)" : storage.driver === "fs" ? "Yerel klasör (.data/photos)" : null;
  const months = (d: number) => Math.round(d / 30);
  const storageLine =
    stats && where
      ? `Fotoğraflar: ${stats.count} adet · ${formatBytes(stats.bytes)} · kasa ${months(KEEP_DAYS["kasa-z"])} ay, fiş ${months(KEEP_DAYS.fis)} ay saklanır · ${where}`
      : !where
        ? "Fotoğraf deposu kurulu değil (BLOB_READ_WRITE_TOKEN): fotoğraf düğmeleri görünmez."
        : null;
  return (
    <SectionCard
      id="foto"
      icon={<ScanText />}
      title="Fotoğraftan okuma"
      summary={photoReadingSummary({ configured, enabled: settings.enabled, ...usage })}
      description="Kasa raporunda Z raporu ve POS fişi, kasadan çıkan fişler fotoğraftan okunur (Claude); fiyat onayında ve Paraşüt'te ürün bağlarken faturanın paket boyu okunur (Claude Haiku). Okunanlar kaydedilmeden önce her zaman kontrol edilir."
    >
      <CardContent className="space-y-3">
        {configured ? (
          <>
            <PhotoReadingForm enabled={settings.enabled} dailyCap={settings.dailyCap} />
            <div className="space-y-1 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
              <p className="text-ink">
                <span className="text-ink-mute">Bu ay:</span> {usage.monthCalls} okuma · {usdText(usage.monthUsd)}
              </p>
              <p className="text-ink">
                <span className="text-ink-mute">Bugün:</span> {usage.today} / {settings.dailyCap}
              </p>
            </div>
          </>
        ) : (
          <Notice
            tone="neutral"
            size="sm"
            title="Fotoğraftan okuma bu ortamda kapalı"
            tech="Bu ortamda ANTHROPIC_API_KEY yok; okuma kapalı. Canlıda Vercel ortam değişkenine eklenir (docs/FOTOGRAF.md)."
          />
        )}
        <p className="text-[13px] leading-5 text-pretty text-ink-mute">
          LafPOS gününün gün sonu fotoğrafı önce {modelName(settings.photoModels.cheap)} ile okunur; okunuş eksik, tutarsız ya da LafPOS&apos;tan farklıysa bir kez{" "}
          {modelName(settings.photoModels.strong)} ile. Yapay zekâ kapalı, kurulu değil ya da sınırdaysa fotoğraf panelde kodla okunur (OCR; Anthropic&apos;e gitmez).
        </p>
        {storageLine ? <p className="text-[13px] leading-5 text-pretty text-ink-mute">{storageLine}</p> : null}
        {stats && stats.bytes >= STORAGE_WARN_BYTES ? <Notice tone="warn" size="sm" risk="veri" title="Fotoğraf deposu 1 GB sınırına yaklaşıyor" /> : null}
        {configured ? (
          <p className="text-[13px] leading-5 text-pretty text-ink-mute">
            Okumak için fotoğraf ya da faturanın PDF&apos;i Anthropic&apos;e (ABD) gider; okunan sonuç panelde saklanır. Fotoğraf ve PDF panelde de durur (PDF,
            Faturayı aç&apos;taki gibi faturanın belgesi olarak). Şahıs firmasının faturasında kişinin adı ve TC kimlik numarası olabilir: istemezseniz okumayı
            kapatın. Anthropic dolar üzerinden faturalar; tutarlar yaklaşık.
          </p>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}
