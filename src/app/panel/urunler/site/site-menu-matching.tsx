"use client";

import { ArrowRight, Globe, Link2, ListChecks, Plug, RefreshCw, Store, Unlink } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/form";
import { EmptyState, KeyValue } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { dateTimeTR, num, tl } from "@/lib/format";
import { CONFIDENCE_LABEL, type LinkSuggestion, type SiteGap } from "@/lib/site-menu/names";
import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor, linkStatus, slotLabel, slotPriceMinor, toMinor, visibilityFromSite, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { cn } from "@/lib/utils";
import { linkSuggestedProducts, syncSiteMenuNow, unlinkProductFromSite } from "@/server/actions/site-menu";
import type { MenuSyncState } from "@/server/site-menu/sync";

import { productHref } from "../logic";
import { SiteLinkDialog } from "../site-link-dialog";

export interface MatchProduct {
  id: number;
  name: string;
  size: string;
  category: string;
  price: number;
  active: boolean;
  showOnMenu: boolean;
  link: { siteMenuId: string; slot: SiteMenuSlot } | null;
}

type Tab = "oneriler" | "bagli" | "bagsiz" | "site";

const money = (minor: number) => tl(fromMinor(minor), minor % 100 ? 2 : 0);
/** Liste satırı: ürün · sitedeki kalem · durum · eylemler (telefonda alt alta) */
const ROW = "grid gap-x-4 gap-y-1.5 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center";
const panelMoney = (v: number) => tl(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);
/** Satır başındaki yuva adı büyük harfle: "Tek fiyat", "M fiyatı" */
const capSlot = (slot: SiteMenuSlot, item: SiteMenuItem) => {
  const t = slotLabel(slot, item);
  return t.charAt(0).toLocaleUpperCase("tr-TR") + t.slice(1);
};

/** Bağlanınca / bağlıyken panel satırında ne değişir: "fiyat 195 ₺ → 200 ₺ · QR menüden kalkar" */
function adoptionText(p: Pick<MatchProduct, "price" | "active" | "showOnMenu">, item: SiteMenuItem, slot: SiteMenuSlot): string | null {
  const minor = slotPriceMinor(item, slot);
  const v = visibilityFromSite(item.isActive, p);
  const parts = [
    minor !== null && minor !== toMinor(p.price) ? `fiyat ${panelMoney(p.price)} → ${money(minor)}` : null,
    v.showOnMenu !== p.showOnMenu || v.active !== p.active ? (item.isActive ? "menüye açılır (sitede Satışta)" : "QR menüden kalkar (sitede Tükendi)") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Site menüsü eşleştirme ekranı: bağlantının durumu ve "Siteyle eşitle", ada göre öneriler (seçilip toplu bağlanır;
 * hiçbiri kendiliğinden uygulanmaz), bağlı ürünler (kopuk ve sitede olmayanlar işaretli), bağlı olmayan panel
 * ürünleri ve panelde bağlısı olmayan site kalemleri. Kalemin adı, fiyatı ve durumu son çekmedeki listeden.
 */
export function SiteMenuMatching({
  configured,
  state,
  snapshotAt,
  items,
  products,
  suggestions,
  gaps,
}: {
  configured: boolean;
  state: MenuSyncState;
  snapshotAt: string | null;
  items: SiteMenuItem[];
  products: MatchProduct[];
  suggestions: LinkSuggestion[];
  gaps: SiteGap[];
}) {
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const suggestionOf = useMemo(() => new Map(suggestions.map((s) => [s.productId, s])), [suggestions]);
  const linked = products.filter((p) => p.link);
  const unlinkedNoSuggestion = products.filter((p) => !p.link && !suggestionOf.has(p.id));
  const problems = linked.filter((p) => snapshotAt && linkStatus(itemById.get(p.link!.siteMenuId), p.link!.slot) !== "ok");
  const [tab, setTab] = useState<Tab>(suggestions.length ? "oneriler" : "bagli");
  // Aynı ad ve eski ad önerileri seçili gelir (aktif ürünlerde); benzer adlar elle seçilir. Bağlamak yine düğmeyle
  const [chosen, setChosen] = useState<ReadonlySet<number>>(
    () => new Set(suggestions.filter((s) => s.confidence !== "similar" && productById.get(s.productId)?.active).map((s) => s.productId)),
  );
  const [pending, start] = useActionTransition();
  const [dialogFor, setDialogFor] = useState<MatchProduct | null>(null);
  const [unlinkFor, setUnlinkFor] = useState<MatchProduct | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = suggestions.filter((s) => chosen.has(s.productId));

  function syncNow() {
    start(async () => {
      const res = await syncSiteMenuNow();
      if (!res.ok) return void toast.error(res.error);
      const r = res.data;
      toast.success("laffogato.net menüsüyle eşitlendi", {
        description:
          r.status === "ok"
            ? r.changed || r.unlinked
              ? `${num(r.changed)} ürün güncellendi${r.unlinked ? `, ${num(r.unlinked)} bağlantı kaldırıldı (kalem sitede yok)` : ""}.`
              : `Değişiklik yok (${num(r.items)} kalem).`
            : "Panel zaten güncel.",
      });
    });
  }

  function linkChosen() {
    if (!selected.length) return;
    start(async () => {
      const res = await linkSuggestedProducts(selected.map((s) => ({ productId: s.productId, siteMenuId: s.siteMenuId, slot: s.slot })));
      if (!res.ok) return void toast.error(res.error);
      const { linked: n, skipped } = res.data;
      setChosen(new Set());
      if (n) {
        toast.success(`${num(n)} ürün siteye bağlandı`, {
          description: skipped.length
            ? `Bağlanamayan ${num(skipped.length)}: ${skipped.map((x) => `${x.label ?? x.productId} (${x.reason})`).join("; ")}`
            : "Her biri sitenin fiyatını ve menü durumunu aldı.",
        });
      } else {
        toast.error(`Hiçbiri bağlanamadı: ${skipped.map((x) => `${x.label ?? x.productId} (${x.reason})`).join("; ")}`);
      }
    });
  }

  async function unlink(p: MatchProduct) {
    setBusy(true);
    const res = await unlinkProductFromSite(p.id);
    setBusy(false);
    setUnlinkFor(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`${p.name} ${p.size}: site bağlantısı kaldırıldı`);
  }

  const health = !configured
    ? { tone: "gray" as const, text: "Kurulmadı" }
    : state.lastError && (!state.lastOkAt || Date.parse(state.lastPullAt ?? "") > Date.parse(state.lastOkAt))
      ? { tone: "red" as const, text: "Hata" }
      : state.lastOkAt
        ? { tone: "green" as const, text: "Bağlı" }
        : { tone: "amber" as const, text: "Henüz eşitlenmedi" };

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "oneriler", label: "Öneriler", count: suggestions.length },
    { value: "bagli", label: "Bağlı", count: linked.length },
    { value: "bagsiz", label: "Panelde bağlı değil", count: unlinkedNoSuggestion.length },
    { value: "site", label: "Yalnız sitede", count: gaps.length },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4 xl:order-2">
          <StatusCard
            configured={configured}
            state={state}
            health={health}
            linkedCount={linked.length}
            itemCount={items.length}
            onSync={syncNow}
            syncing={pending}
          />
        </div>

        <div className="min-w-0 space-y-4 xl:order-1">
          {problems.length ? (
            <Card>
              <CardHeader icon={<Plug />} title="Bağlantısında sorun olan ürünler" description="Kopuk bağlantıda fiyata ve menü durumuna dokunulmaz, fiyat da değiştirilemez; düzeltin ya da kaldırın." />
              <ul className="divide-y divide-line border-t border-line">
                {problems.map((p) => {
                  const item = itemById.get(p.link!.siteMenuId);
                  const status = linkStatus(item, p.link!.slot);
                  return (
                    <li key={p.id} className={ROW}>
                      <Link href={productHref(p.id)} className="min-w-0 font-medium text-ink hover:underline">
                        {p.name} · {p.size}
                      </Link>
                      <span className="min-w-0 text-[13px] text-ink-mute">
                        {status === "broken"
                          ? `${item?.name ?? p.link!.siteMenuId}: sitede L fiyatı yok (tek boy)`
                          : `${p.link!.siteMenuId} sitenin listesinde yok; sonraki eşitlemede bağlantı kaldırılır`}
                      </span>
                      <span>
                        <Badge tone={status === "broken" ? "red" : "amber"} dot>
                          {status === "broken" ? "Kopuk" : "Sitede yok"}
                        </Badge>
                      </span>
                      <span className="flex gap-1.5">
                        <Button size="xs" variant="secondary" onClick={() => setDialogFor(p)} disabled={!configured}>
                          <Link2 size={13} aria-hidden="true" /> Değiştir
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setUnlinkFor(p)} className="text-bad hover:bg-bad-soft hover:text-bad">
                          <Unlink size={13} aria-hidden="true" /> Kaldır
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Segmented<Tab> label="Eşleştirme görünümü" value={tab} onChange={setTab} options={tabs} />

          {!snapshotAt && configured ? (
            <p className="rounded-2xl bg-info-soft px-4 py-3 text-sm text-info" role="status">
              Sitenin menüsü henüz alınmadı. Sağdaki “Siteyle eşitle” ile listeyi alın; öneriler ve sitedeki kalemler ondan sonra görünür.
            </p>
          ) : null}

          {tab === "oneriler" ? (
            <Card>
              <CardHeader
                icon={<ListChecks />}
                title="Öneriler"
                description="Bağlı olmayan ürünler için ada göre öneri: aynı ad, sitenin eski İngilizce adı ya da benzer ad. Hiçbiri kendiliğinden bağlanmaz; seçip “Önerileri bağla”ya basın. Bağlanan ürün sitenin fiyatını ve menü durumunu alır."
                meta={<span className="tabular">{num(selected.length)} / {num(suggestions.length)} seçili</span>}
                actions={
                  suggestions.length ? (
                    <Button size="sm" onClick={linkChosen} disabled={!configured || pending || !selected.length}>
                      <Link2 size={15} aria-hidden="true" /> {pending ? "Bağlanıyor…" : `Önerileri bağla (${num(selected.length)})`}
                    </Button>
                  ) : undefined
                }
              />
              {suggestions.length ? (
                <>
                  <ul className="divide-y divide-line border-t border-line">
                    {suggestions.map((sg) => {
                      const p = productById.get(sg.productId);
                      const item = itemById.get(sg.siteMenuId);
                      if (!p || !item) return null;
                      const adopt = adoptionText(p, item, sg.slot);
                      return (
                        <li key={sg.productId} className="px-5 py-3">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              label={<span className="sr-only">{`${p.name} ${p.size} → ${item.name} bağlansın`}</span>}
                              checked={chosen.has(sg.productId)}
                              onChange={(e) =>
                                setChosen((cur) => {
                                  const next = new Set(cur);
                                  if (e.target.checked) next.add(sg.productId);
                                  else next.delete(sg.productId);
                                  return next;
                                })
                              }
                              className="mt-0.5"
                            />
                            <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                              <span className="min-w-0">
                                <Link href={productHref(p.id)} className="font-medium text-ink hover:underline">
                                  {p.name} · {p.size}
                                </Link>
                                <span className="block text-xs text-ink-mute">
                                  {p.category} · panelde {panelMoney(p.price)}
                                  {!p.active ? " · pasif" : !p.showOnMenu ? " · QR menüde gizli" : ""}
                                </span>
                              </span>
                              <ArrowRight size={15} className="hidden text-ink-quiet sm:block" aria-hidden="true" />
                              <span className="min-w-0">
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-ink">{item.name}</span>
                                  <Badge tone={sg.confidence === "similar" ? "amber" : sg.confidence === "exact" ? "green" : "blue"}>{CONFIDENCE_LABEL[sg.confidence]}</Badge>
                                </span>
                                <span className="block text-xs text-ink-mute">
                                  {capSlot(sg.slot, item)} {money(sg.sitePriceMinor)} · {item.isActive ? "Satışta" : "Tükendi"}
                                </span>
                              </span>
                            </div>
                          </div>
                          {adopt ? <p className="mt-1 pl-7 text-xs text-warn">Bağlanınca: {adopt}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                  <CardFooter>
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(suggestions.map((x) => x.productId)))}>
                        Tümünü seç
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())} disabled={!selected.length}>
                        Seçimi temizle
                      </Button>
                    </span>
                    <Button onClick={linkChosen} disabled={!configured || pending || !selected.length}>
                      <Link2 size={16} aria-hidden="true" /> {pending ? "Bağlanıyor…" : `Önerileri bağla (${num(selected.length)})`}
                    </Button>
                  </CardFooter>
                </>
              ) : (
                <EmptyState
                  icon={<ListChecks />}
                  title={snapshotAt ? "Öneri yok" : "Önce siteyle eşitleyin"}
                  description={
                    snapshotAt
                      ? "Bağlı olmayan ürünlerin adı sitedeki bir kalemle eşleşmiyor. “Panelde bağlı değil” sekmesinden elle bağlayabilirsiniz."
                      : "Öneriler sitenin menü listesinden çıkar."
                  }
                />
              )}
            </Card>
          ) : null}

          {tab === "bagli" ? (
            <Card>
              <CardHeader icon={<Globe />} title="Bağlı ürünler" description="Fiyat ve menü durumu iki yerde aynı: panelde değişince önce siteye gider, sitede değişince panele gelir." />
              {linked.length ? (
                <ul className="divide-y divide-line border-t border-line">
                  {linked.map((p) => {
                    const item = itemById.get(p.link!.siteMenuId);
                    const status = snapshotAt ? linkStatus(item, p.link!.slot) : "ok";
                    const minor = item ? slotPriceMinor(item, p.link!.slot) : null;
                    const priceDiffers = minor !== null && minor !== toMinor(p.price);
                    return (
                      <li key={p.id} className={ROW}>
                        <span className="min-w-0">
                          <Link href={productHref(p.id)} className="font-medium text-ink hover:underline">
                            {p.name} · {p.size}
                          </Link>
                          <span className="block text-xs text-ink-mute">
                            {p.category} · panelde {panelMoney(p.price)}
                            {!p.active ? " · pasif" : !p.showOnMenu ? " · QR menüde gizli" : ""}
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{item?.name ?? p.link!.siteMenuId}</span>
                          <span className="block text-xs text-ink-mute">
                            {item ? `${capSlot(p.link!.slot, item)} ${minor !== null ? money(minor) : "yok"} · ${item.isActive ? "Satışta" : "Tükendi"}` : `${p.link!.slot} fiyatı`}
                            {priceDiffers ? " · panelde farklı, sonraki eşitlemede düzelir" : ""}
                          </span>
                        </span>
                        <span>
                          <Badge tone={status === "ok" ? "blue" : status === "broken" ? "red" : "amber"} dot>
                            {status === "ok" ? "Sitede" : status === "broken" ? "Kopuk" : "Sitede yok"}
                          </Badge>
                        </span>
                        <span className="flex gap-1.5">
                          <Button size="xs" variant="secondary" onClick={() => setDialogFor(p)} disabled={!configured}>
                            <Link2 size={13} aria-hidden="true" /> Değiştir
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setUnlinkFor(p)} className="text-bad hover:bg-bad-soft hover:text-bad">
                            <Unlink size={13} aria-hidden="true" /> Kaldır
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState icon={<Globe />} title="Henüz bağlı ürün yok" description="Önerileri bağlayın ya da ürünleri tek tek bağlayın." />
              )}
            </Card>
          ) : null}

          {tab === "bagsiz" ? (
            <Card>
              <CardHeader
                icon={<Store />}
                title="Panelde bağlı olmayan ürünler"
                description="Önerisi olmayan ürünler. Yalnız panelde olanlar (Su, Damla Soda gibi) bağlı kalmaz; fiyatları ve menü durumları yalnız panelde değişir."
              />
              {unlinkedNoSuggestion.length ? (
                <ul className="divide-y divide-line border-t border-line">
                  {unlinkedNoSuggestion.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <Link href={productHref(p.id)} className="font-medium text-ink hover:underline">
                          {p.name} · {p.size}
                        </Link>
                        <span className="block text-xs text-ink-mute">
                          {p.category} · {panelMoney(p.price)}
                          {!p.active ? " · pasif" : ""}
                        </span>
                      </span>
                      <Button size="xs" variant="secondary" onClick={() => setDialogFor(p)} disabled={!configured}>
                        <Link2 size={13} aria-hidden="true" /> Bağla
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Store />} title="Hepsi bağlı ya da önerisi var" />
              )}
            </Card>
          ) : null}

          {tab === "site" ? (
            <Card>
              <CardHeader
                icon={<Globe />}
                title="Yalnız sitede olan kalemler"
                description="Panelde bağlı ürünü olmayan site kalemleri ve fiyatları. Bağlantı ürün açmaz: panelde yoksa Ürünler › Yeni ürün ile açıp bağlayın."
              />
              {gaps.length ? (
                <ul className="divide-y divide-line border-t border-line">
                  {gaps.map((g) => {
                    const covering = suggestions.filter((sg) => sg.siteMenuId === g.item.id && g.slots.includes(sg.slot));
                    return (
                      <li key={g.item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-ink">{g.item.name}</span>
                          <span className="block text-xs text-ink-mute">
                            {g.item.categoryLabel} · {g.item.id}
                          </span>
                        </span>
                        <span className="text-xs text-ink-mute tabular">
                          {g.slots.map((sl) => `${capSlot(sl, g.item)} ${money(slotPriceMinor(g.item, sl) ?? 0)}`).join(" · ")}
                        </span>
                        {!g.item.isActive ? <Badge tone="amber">Tükendi</Badge> : null}
                        {covering.length ? (
                          <span className="w-full text-xs text-info">
                            Öneride: {covering.map((c) => `${productById.get(c.productId)?.name ?? c.productId} ${productById.get(c.productId)?.size ?? ""}`).join(", ")}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState icon={<Globe />} title={snapshotAt ? "Sitedeki her kalemin panelde bağlısı var" : "Sitenin menüsü henüz alınmadı"} />
              )}
            </Card>
          ) : null}
        </div>
      </div>

      {dialogFor ? (
        <SiteLinkDialog
          open
          onClose={() => setDialogFor(null)}
          product={{ id: dialogFor.id, name: dialogFor.name, size: dialogFor.size, price: dialogFor.price, active: dialogFor.active, showOnMenu: dialogFor.showOnMenu }}
          current={dialogFor.link}
        />
      ) : null}

      <ConfirmDialog
        open={unlinkFor !== null}
        onClose={() => setUnlinkFor(null)}
        onConfirm={() => unlinkFor && void unlink(unlinkFor)}
        pending={busy}
        title="Site bağlantısı kaldırılsın mı?"
        confirmLabel="Bağlantıyı kaldır"
        description={
          unlinkFor
            ? `${unlinkFor.name} · ${unlinkFor.size} ile ${itemById.get(unlinkFor.link?.siteMenuId ?? "")?.name ?? unlinkFor.link?.siteMenuId ?? ""} arasındaki bağlantı kalkar. Fiyat ve menü durumu olduğu gibi kalır; bundan sonra iki yer ayrı değişir.`
            : undefined
        }
      />
    </div>
  );
}

/** Bağlantının durumu: son eşitleme, ping, kalem sayısı, son değişiklikler ve kaldırılan bağlantılar; "Siteyle eşitle" */
function StatusCard({
  configured,
  state,
  health,
  linkedCount,
  itemCount,
  onSync,
  syncing,
}: {
  configured: boolean;
  state: MenuSyncState;
  health: { tone: "gray" | "red" | "green" | "amber"; text: string };
  linkedCount: number;
  itemCount: number;
  onSync: () => void;
  syncing: boolean;
}) {
  return (
    <Card>
      <CardHeader
        icon={<Plug />}
        title="laffogato.net bağlantısı"
        meta={
          <Badge tone={health.tone} dot>
            {health.text}
          </Badge>
        }
        actions={
          configured ? (
            <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
              <RefreshCw size={14} className={cn(syncing && "animate-spin")} aria-hidden="true" /> Siteyle eşitle
            </Button>
          ) : undefined
        }
      />
      <CardContent className="space-y-3 text-sm">
        {configured ? (
          <>
            <div className="divide-y divide-line rounded-2xl bg-surface px-4 ring-1 ring-line">
              <KeyValue className="py-2.5" label="Son eşitleme" value={state.lastOkAt ? dateTimeTR(state.lastOkAt) : "—"} />
              <KeyValue className="py-2.5" label="Sitenin son pingi" value={state.lastPingAt ? dateTimeTR(state.lastPingAt) : "—"} />
              <KeyValue className="py-2.5" label="Sitedeki kalem" value={state.itemCount !== null ? num(state.itemCount) : itemCount ? num(itemCount) : "—"} />
              <KeyValue className="py-2.5" label="Bağlı ürün" value={num(linkedCount)} />
              <KeyValue className="py-2.5" label="Son eşitlemede değişen" value={state.changedRows !== null ? `${num(state.changedRows)} ürün` : "—"} />
            </div>
            {health.tone === "red" && state.lastError ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">{state.lastError}</p> : null}
            {state.lastChanges.length ? (
              <details className="rounded-2xl bg-surface px-4 py-2.5 ring-1 ring-line">
                <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">
                  Siteden gelen son değişiklikler{state.lastChangedAt ? ` · ${dateTimeTR(state.lastChangedAt)}` : ""}
                </summary>
                <ul className="mt-2 space-y-1 text-[13px] text-ink-mute">
                  {state.lastChanges.map((c, i) => (
                    <li key={`${c.productId}-${i}`}>
                      <span className="text-ink">{c.label}</span>: {c.text}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {state.unlinked.length ? (
              <details className="rounded-2xl bg-warn-soft px-4 py-2.5">
                <summary className="cursor-pointer text-[13px] font-medium text-warn">Sitede silindiği için bağlantısı kaldırılanlar ({num(state.unlinked.length)})</summary>
                <ul className="mt-2 space-y-1 text-[13px] text-warn">
                  {state.unlinked.map((u, i) => (
                    <li key={`${u.productId}-${u.at}-${i}`}>
                      {dateTimeTR(u.at)} · {u.label} ({u.siteMenuId}, {u.slot})
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-[13px] leading-5 text-ink-mute">
              Sitede bir kalem değişince site panele imzalı bir ping atar, panel bütün menüyü hemen çeker. Ayrıca Ürünler açılınca en çok beş dakikada
              bir ve her sabah bir kez sorulur. Fiyat panelde değişince önce siteye yazılır; kasadaki (ModPOS) fiyat elle değişir.
            </p>
          </>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-ink-soft">
            <li>
              Bağlantı karaokeyle aynı anahtarı kullanır: Vercel&apos;de iki projeye de (laffogato.net ve bu panel) aynı değerle{" "}
              <code className="rounded bg-surface px-1 font-mono text-xs ring-1 ring-line">KARAOKE_SYNC_SECRET</code> ekleyin (en az 32 karakter), ikisini
              yeniden yayınlayın.
            </li>
            <li>Bu sayfayı yenileyin, “Siteyle eşitle”ye basın; öneriler görünür.</li>
            <li>
              Anahtar yokken bağlı olmayan ürünler eskisi gibi çalışır; bağlı kalmış ürünlerin fiyatı ve menü durumu anahtar gelene kadar değiştirilemez
              (iki yer ayrışmasın) ya da bağlantıları kaldırılır. Ayrıntı: docs/SITE-MENU.md.
            </li>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
