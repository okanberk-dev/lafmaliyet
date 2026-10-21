"use client";

import { Globe, Link2, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { matches } from "@/components/ui/filters";
import { SearchInput } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/misc";
import { tl } from "@/lib/format";
import { CONFIDENCE_LABEL, suggestLinks } from "@/lib/site-menu/names";
import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { defaultSlot, fromMinor, isSingleSize, slotLabel, slotPriceMinor, toMinor, visibilityFromSite, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { cn } from "@/lib/utils";
import { linkProductToSite, loadSiteMenuChoices, type SiteMenuChoices } from "@/server/actions/site-menu";

export interface SiteLinkProduct {
  id: number;
  name: string;
  size: string;
  price: number;
  active: boolean;
  showOnMenu: boolean;
}

/** Bağlantıdan sonra ürünün yazılan satış değerleri (kart alanlarını günceller) */
export interface LinkedValues {
  price: number;
  active: boolean;
  showOnMenu: boolean;
}

const money = (minor: number) => tl(fromMinor(minor), minor % 100 ? 2 : 0);

/** Kalemin fiyatları: "195 ₺ / 210 ₺" ya da "115 ₺ (tek boy)" */
function prices(item: SiteMenuItem): string {
  return isSingleSize(item) ? `${money(item.priceMinor)} · tek boy` : `M ${money(item.priceMinor)} · L ${money(item.priceMinorL)}`;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: SiteMenuChoices };

/**
 * Ürünü laffogato.net menüsündeki bir kalemin bir fiyatına bağlama penceresi. Liste açılınca siteden imzalı alınır
 * (o anki fiyat ve durum); aranır, kalem ve fiyat (M / L, tek boyda tek fiyat) seçilir. Bağlanınca ürün sitenin
 * fiyatını ve menü durumunu alır: pencere bunu önceden gösterir. Yalnız açıkken çizilir (her açılışta liste yeniden
 * alınır): `{open ? <SiteLinkDialog … /> : null}`.
 */
export function SiteLinkDialog({
  open,
  onClose,
  product,
  current,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  product: SiteLinkProduct;
  /** Ürünün şimdiki bağlantısı (değiştirirken) */
  current: { siteMenuId: string; slot: SiteMenuSlot } | null;
  onLinked?: (values: LinkedValues) => void;
}) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<SiteMenuSlot>("M");
  const [busy, setBusy] = useState(false);
  const choices = load.status === "ok" ? load.data : null;

  /** Sitenin listesi geldi: önce şimdiki bağlantı, yoksa ada göre öneri seçili gelir (bağlamak yine elle) */
  function receive(res: Awaited<ReturnType<typeof loadSiteMenuChoices>>) {
    if (!res.ok) return setLoad({ status: "error", message: res.error });
    setLoad({ status: "ok", data: res.data });
    const others = res.data.links.filter((l) => l.productId !== product.id);
    const pick = current ? { siteMenuId: current.siteMenuId, slot: current.slot } : (suggestLinks([product], res.data.items, others)[0] ?? null);
    if (pick && res.data.items.some((i) => i.id === pick.siteMenuId)) {
      setSelected(pick.siteMenuId);
      setSlot(pick.slot);
    }
  }

  // Açılışta sitenin o anki listesi (pencere yalnız açıkken çizilir)
  const onReceive = useEffectEvent(receive);
  useEffect(() => {
    let alive = true;
    void loadSiteMenuChoices().then((res) => {
      if (alive) onReceive(res);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Liste gelince seçili kalem (şimdiki bağlantı ya da öneri) görünür olsun
  useEffect(() => {
    if (load.status !== "ok") return;
    // Yalnız listenin kendisi kayar (pencere ve sayfa yerinde kalır); liste konumlu (relative), offsetTop ona göre
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    if (list && el) list.scrollTop = Math.max(0, el.offsetTop - (list.clientHeight - el.offsetHeight) / 2);
  }, [load.status]);

  function retry() {
    setLoad({ status: "loading" });
    void loadSiteMenuChoices().then(receive);
  }

  const items = useMemo(() => choices?.items ?? [], [choices]);
  const holders = useMemo(() => {
    const m = new Map<string, { productId: number; label: string }>();
    for (const l of choices?.links ?? []) m.set(`${l.siteMenuId}:${l.slot}`, { productId: l.productId, label: l.label });
    return m;
  }, [choices]);
  const groups = useMemo(() => {
    const out: { label: string; items: SiteMenuItem[] }[] = [];
    for (const item of items) {
      if (!matches(`${item.name} ${item.categoryLabel} ${item.id}`, query)) continue;
      const g = out.find((x) => x.label === item.categoryLabel);
      if (g) g.items.push(item);
      else out.push({ label: item.categoryLabel || "Diğer", items: [item] });
    }
    return out;
  }, [items, query]);

  const item = items.find((i) => i.id === selected) ?? null;
  const effectiveSlot: SiteMenuSlot = item && isSingleSize(item) ? "M" : slot;
  const holder = item ? holders.get(`${item.id}:${effectiveSlot}`) : undefined;
  const takenByOther = holder && holder.productId !== product.id ? holder : null;
  const sameAsCurrent = !!current && !!item && current.siteMenuId === item.id && current.slot === effectiveSlot;
  const priceMinor = item ? slotPriceMinor(item, effectiveSlot) : null;
  const after = item ? visibilityFromSite(item.isActive, product) : null;

  function choose(it: SiteMenuItem) {
    setSelected(it.id);
    setSlot(defaultSlot(product.size, it));
  }

  async function submit() {
    if (!item || busy || takenByOther || sameAsCurrent) return;
    setBusy(true);
    const res = await linkProductToSite({ productId: product.id, siteMenuId: item.id, slot: effectiveSlot });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    const d = res.data;
    const changes = [
      Math.round(d.before.price * 100) !== Math.round(d.after.price * 100) ? `fiyat ${tl(d.before.price, 2)} → ${tl(d.after.price, 2)}` : null,
      d.before.showOnMenu !== d.after.showOnMenu || d.before.active !== d.after.active ? (item.isActive ? "menüye açıldı (sitede Satışta)" : "QR menüden kalktı (sitede Tükendi)") : null,
    ].filter(Boolean);
    toast.success(`${product.name} ${product.size} → ${item.name} (${slotLabel(effectiveSlot, item)})`, {
      description: changes.length ? `Sitenin değeri geçerli: ${changes.join(", ")}.` : "Fiyat ve menü durumu zaten aynıydı.",
    });
    onLinked?.(d.after);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={current ? "Site bağlantısını değiştir" : "Siteye bağla"}
      description={`${product.name} · ${product.size}: laffogato.net menüsündeki kalemi ve fiyatı seçin. Bağlanınca ürün sitenin fiyatını ve menü durumunu alır.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={!item || busy || !!takenByOther || sameAsCurrent || priceMinor === null}>
            <Link2 size={16} aria-hidden="true" /> {busy ? "Bağlanıyor…" : "Bağla"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {load.status === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad" role="alert">
            <span className="min-w-0">{load.message}</span>
            <Button size="sm" variant="secondary" onClick={retry}>
              <RefreshCw size={14} aria-hidden="true" /> Tekrar dene
            </Button>
          </div>
        ) : null}
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sitedeki kalemi ara (ad, kategori)"
          aria-label="Sitedeki kalemi ara"
          aria-controls={listId}
        />
        <div ref={listRef} id={listId} role="radiogroup" aria-label="Sitedeki kalemler" className="scroll-thin relative max-h-[42dvh] space-y-3 overflow-y-auto rounded-2xl bg-panel p-2">
          {load.status === "loading" ? (
            Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 bg-surface/70" />)
          ) : groups.length ? (
            groups.map((g) => (
              <div key={g.label}>
                <p className="px-2 pt-1 pb-1.5 text-xs font-semibold text-ink-mute">{g.label}</p>
                <ul className="space-y-1">
                  {g.items.map((it) => {
                    const on = it.id === selected;
                    const linkedTo = (["M", "L"] as const).flatMap((sl) => {
                      const h = holders.get(`${it.id}:${sl}`);
                      return h ? [`${isSingleSize(it) ? "" : `${sl}: `}${h.productId === product.id ? "bu ürün" : h.label}`] : [];
                    });
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => choose(it)}
                          className={cn(
                            "flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                            on ? "bg-surface ring-2 ring-ink/70" : "hover:bg-surface/70",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-ink">{it.name}</span>
                            <span className="block text-xs text-ink-mute tabular">{prices(it)}</span>
                          </span>
                          {!it.isActive ? <Badge tone="amber">Tükendi</Badge> : null}
                          {linkedTo.length ? (
                            <span className="w-full text-xs text-ink-mute sm:w-auto" title="Bu kaleme bağlı panel ürünleri">
                              Bağlı: {linkedTo.join(", ")}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          ) : choices ? (
            <p className="px-2 py-6 text-center text-sm text-ink-mute">{query.trim() ? `“${query.trim()}” sitede yok.` : "Sitenin menüsünde kalem yok."}</p>
          ) : null}
        </div>

        {item ? (
          <div className="space-y-3 rounded-2xl bg-surface p-4 ring-1 ring-line-strong">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Globe size={15} aria-hidden="true" /> {item.name}
              {!isSingleSize(item) ? null : <span className="font-normal text-ink-mute">· tek boy</span>}
            </p>
            {!isSingleSize(item) ? (
              <Segmented<SiteMenuSlot>
                label="Bağlanacak fiyat"
                value={effectiveSlot}
                onChange={setSlot}
                options={(["M", "L"] as const).map((sl) => ({ value: sl, label: `${sl} fiyatı · ${money(slotPriceMinor(item, sl) ?? 0)}` }))}
              />
            ) : null}
            {takenByOther ? (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn" role="status">
                Bu fiyat zaten {takenByOther.label} ürününe bağlı. Önce o ürünün bağlantısını kaldırın ya da başka bir fiyat seçin.
              </p>
            ) : sameAsCurrent ? (
              <p className="text-[13px] text-ink-mute">Ürün zaten bu fiyata bağlı.</p>
            ) : priceMinor !== null && after ? (
              <p className="text-[13px] leading-5 text-ink-soft">
                Bağlanınca: fiyat{" "}
                {toMinor(product.price) === priceMinor ? (
                  <>aynı kalır ({money(priceMinor)})</>
                ) : (
                  <span className="font-medium tabular">
                    {tl(product.price, 2)} → {money(priceMinor)}
                  </span>
                )}
                {" · "}
                {item.isActive ? "sitede Satışta: menüde aktif ve QR menüde görünür" : "sitede Tükendi: QR menüden kalkar"}
                {after.active !== product.active || after.showOnMenu !== product.showOnMenu ? " (değişecek)" : ""}. Bundan sonra fiyat ve menü durumu
                panelde değişince önce siteye yazılır.
              </p>
            ) : null}
          </div>
        ) : choices && !current ? (
          <p className="text-[13px] text-ink-mute">
            Listeden bir kalem seçin.{" "}
            {(() => {
              const s = suggestLinks([product], items, (choices.links ?? []).filter((l) => l.productId !== product.id))[0];
              return s ? `Öneri: ${s.siteName} (${CONFIDENCE_LABEL[s.confidence].toLocaleLowerCase("tr-TR")}).` : null;
            })()}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
