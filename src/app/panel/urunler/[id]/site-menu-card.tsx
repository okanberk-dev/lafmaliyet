"use client";

import { Globe, Link2, Unlink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { tryAction } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KeyValue } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { dateTimeTR, tl } from "@/lib/format";
import { CONFIDENCE_LABEL, type LinkSuggestion } from "@/lib/site-menu/names";
import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor, linkStatus, slotLabel, slotPriceMinor, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { linkProductToSite, unlinkProductFromSite } from "@/server/actions/site-menu";

import { SiteLinkDialog, type LinkedValues, type SiteLinkProduct } from "../site-link-dialog";

/** Kartın sunucudan aldığı site bilgisi (son çekmedeki listeden; siteye gitmeden) */
export interface ProductSiteInfo {
  /** Anahtar tanımlı mı; değilse bağlantı kapalı, ürün yalnız panelde */
  configured: boolean;
  link: { siteMenuId: string; slot: SiteMenuSlot } | null;
  /** Bağlı kalemin son listedeki hâli (yoksa null) */
  item: SiteMenuItem | null;
  /** Son listenin alındığı an; hiç alınmadıysa null */
  snapshotAt: string | null;
  lastError: string | null;
  /** Bağlı değilse ada göre öneri */
  suggestion: LinkSuggestion | null;
}

const money = (minor: number) => tl(fromMinor(minor), minor % 100 ? 2 : 0);

/**
 * Reçete kartındaki "Site menüsü": ürün laffogato.net menüsündeki hangi kalemin hangi fiyatı, sitedeki fiyat ve
 * durum, bağlama / değiştirme / kaldırma. Bağlı üründe fiyat ve menü durumu (Menüde aktif + QR menüde göster)
 * kaydedilince önce siteye gider. Kartta kaydedilmemiş değişiklik varken bağlantı değiştirilmez (bağlanınca ürün
 * sitenin fiyatını ve durumunu alır, alanlar ona göre yenilenir).
 */
export function SiteMenuCard({
  product,
  site,
  dirty,
  onAdopted,
}: {
  product: SiteLinkProduct;
  site: ProductSiteInfo;
  dirty: boolean;
  /** Bağlanınca ürünün aldığı değerler: kart alanları bunlara getirilir */
  onAdopted: (values: LinkedValues) => void;
}) {
  const [dialog, setDialog] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const { link, item } = site;
  const status = link ? (site.snapshotAt ? linkStatus(item, link.slot) : "pending") : null;
  const priceMinor = link && item ? slotPriceMinor(item, link.slot) : null;

  async function unlink() {
    setBusy(true);
    const res = await tryAction(() => unlinkProductFromSite(product.id));
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, onay penceresi açık kalır
    if (!res) return;
    setConfirmUnlink(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${product.name} ${product.size}: site bağlantısı kaldırıldı`, { description: "Fiyatı ve menü durumu bundan sonra yalnız panelde değişir." });
  }

  async function linkSuggestion(s: LinkSuggestion) {
    setBusy(true);
    const res = await tryAction(() => linkProductToSite({ productId: product.id, siteMenuId: s.siteMenuId, slot: s.slot }));
    setBusy(false);
    if (!res) return;
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${product.name} ${product.size} → ${s.siteName}`, {
      description:
        Math.round(res.data.before.price * 100) !== Math.round(res.data.after.price * 100)
          ? `Sitenin fiyatı geçerli: ${tl(res.data.before.price, 2)} → ${tl(res.data.after.price, 2)}.`
          : "Fiyat zaten aynıydı.",
    });
    onAdopted(res.data.after);
  }

  const badge = !site.configured ? (
    <Badge tone="gray">Bağlantı kapalı</Badge>
  ) : !link ? (
    <Badge tone="gray">Bağlı değil</Badge>
  ) : status === "broken" ? (
    <Badge tone="red" dot>
      Bağlantı kopuk
    </Badge>
  ) : status === "missing" ? (
    <Badge tone="amber" dot>
      Sitede yok
    </Badge>
  ) : (
    <Badge tone="blue" dot>
      Sitede
    </Badge>
  );

  const dirtyHint = dirty ? <p className="text-[13px] text-warn">Önce karttaki değişiklikleri kaydedin ya da geri alın: bağlanınca ürün sitenin fiyatını ve durumunu alır.</p> : null;

  return (
    <Card>
      <CardHeader
        icon={<Globe />}
        title="Site menüsü"
        description="laffogato.net menüsündeki kalemi: satış fiyatı ve menü durumu iki yerde aynı kalır."
        meta={badge}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setDialog(true)} disabled={!site.configured || dirty || busy}>
            <Link2 size={15} aria-hidden="true" /> {link ? "Değiştir" : "Siteye bağla"}
          </Button>
        }
      />
      <CardContent className="space-y-3 text-sm">
        {!site.configured ? (
          <Notice
            tone={link ? "warn" : "neutral"}
            size="sm"
            title={link ? "Site bağlantısı kurulmadı: fiyat ve menü durumu şimdi değiştirilemez" : "Site bağlantısı kurulmadı: fiyat ve menü durumu yalnız panelde"}
            tech={
              <>
                İki projede de (laffogato.net ve bu panel) aynı <code>KARAOKE_SYNC_SECRET</code> gerekir.{" "}
                {link ? "Ürün sitedeki bir kaleme bağlı kaldığı için iki yer ayrışmasın diye fiyat kilitli: anahtarı ekleyin ya da bağlantıyı kaldırın." : "Ürün her şeyiyle eskisi gibi çalışır."}
              </>
            }
          />
        ) : null}

        {link ? (
          <>
            <div className="divide-y divide-line rounded-2xl bg-surface px-4 ring-1 ring-line">
              <KeyValue className="py-2.5" label="Sitedeki kalem" value={item ? item.name : <span className="text-ink-mute">{link.siteMenuId}</span>} />
              <KeyValue
                className="py-2.5"
                label={`Sitedeki ${slotLabel(link.slot, item)}`}
                value={priceMinor !== null ? money(priceMinor) : <span className="text-ink-mute">{status === "broken" ? "yok" : "—"}</span>}
              />
              <KeyValue className="py-2.5" label="Sitede" value={item ? (item.isActive ? "Satışta" : "Tükendi") : "—"} />
              <KeyValue className="py-2.5" label="Son eşitleme" value={site.snapshotAt ? dateTimeTR(site.snapshotAt) : "—"} />
            </div>
            {status === "broken" ? (
              <Notice
                tone="bad"
                size="sm"
                live="assertive"
                title={`Bağlantı kopuk: ${item?.name ?? link.siteMenuId} sitede tek boy`}
                text="Fiyat ve menü durumu değiştirilemez; bağlantıyı kaldırın ya da kalemin tek fiyatına bağlayın."
              />
            ) : status === "missing" ? (
              <Notice tone="warn" size="sm" live="polite" title={`${link.siteMenuId} sitenin son listesinde yok`} text="Sonraki eşitlemede bağlantı kaldırılır; fiyat ve durum kalır." />
            ) : (
              <p className="text-[13px] leading-5 text-ink-mute">
                Fiyat ya da menü durumu (Menüde aktif ve QR menüde göster birlikte açıkken sitede Satışta) kaydedilince önce siteye yazılır; site
                ulaşılamazsa kaydedilmez. Sitede değişince panel kendiliğinden alır.
              </p>
            )}
            {site.lastError ? <p className="text-[13px] text-bad">Son eşitleme hatası: {site.lastError}</p> : null}
            {dirtyHint}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)} disabled={busy || dirty} className="text-bad hover:bg-bad-soft hover:text-bad">
                <Unlink size={15} aria-hidden="true" /> Bağlantıyı kaldır
              </Button>
              <Link href="/panel/urunler/site" className="text-[13px] font-medium text-info hover:underline">
                Bütün eşleştirmeler →
              </Link>
            </div>
          </>
        ) : site.configured ? (
          <>
            <p className="text-[13px] leading-5 text-ink-mute">Bu ürün sitede bir kaleme bağlı değil: fiyatı ve menü durumu yalnız panelde.</p>
            {site.suggestion ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
                <p className="min-w-0 text-[13px] leading-5 text-ink-soft">
                  <span className="font-medium text-ink">Öneri:</span> {site.suggestion.siteName} · {site.suggestion.slot === "M" ? "M ya da tek" : "L"} fiyatı{" "}
                  <span className="tabular">{money(site.suggestion.sitePriceMinor)}</span>{" "}
                  <Badge tone={site.suggestion.confidence === "similar" ? "amber" : "gray"}>{CONFIDENCE_LABEL[site.suggestion.confidence]}</Badge>
                </p>
                <Button size="sm" variant="secondary" onClick={() => void linkSuggestion(site.suggestion!)} disabled={busy || dirty}>
                  <Link2 size={15} aria-hidden="true" /> Öneriyi bağla
                </Button>
              </div>
            ) : null}
            {dirtyHint}
            <Link href="/panel/urunler/site" className="text-[13px] font-medium text-info hover:underline">
              Eşleştirme ekranı →
            </Link>
          </>
        ) : null}
      </CardContent>

      {dialog ? <SiteLinkDialog open onClose={() => setDialog(false)} product={product} current={link} onLinked={onAdopted} /> : null}

      <ConfirmDialog
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        onConfirm={() => void unlink()}
        pending={busy}
        title="Site bağlantısı kaldırılsın mı?"
        confirmLabel="Bağlantıyı kaldır"
        description={`${product.name} · ${product.size} ile ${item?.name ?? link?.siteMenuId ?? ""} arasındaki bağlantı kalkar. Fiyat ve menü durumu olduğu gibi kalır; bundan sonra panelde değişince siteye gitmez, sitede değişince panele gelmez.`}
      />
    </Card>
  );
}
