"use client";

import { LoaderCircle, PackageX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useClock } from "@/components/panel/live/clock";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/form";
import type { Role } from "@/lib/constants";
import { num } from "@/lib/format";
import { SOLD_OUT_TEXT, STAFF_TOGGLE_LIMIT, soldOutMeta, soldOutWhen, type SoldOutEntry } from "@/lib/site-menu/sold-out";
import { holdSoldOut, setSoldOut } from "@/server/actions/menu-status";

import { siteNameDiffers, soldOutHits } from "./sold-out-search";

/** Başarılı bir dokunuştan sonra satırın düğmesi bu kadar kapalı kalır (çift dokunuş açıp kapatmasın) */
const ROW_LOCK_MS = 1_500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bar ekranının "Tükenenler" kartı (dalga 10 §2.1; docs/SITE-MENU.md › Personel: Tükendi / Satışa aç). Biten ürün
 * sitede, uygulamada ve QR menüde "Tükendi" yapılır (M ve L birlikte), gelince "Satışa aç". Kartta yalnız bu kartla
 * kapatılıp kaydı hâlâ geçerli ürünler durur; "Tükendi işaretle" penceresi yalnız kapatır. Personel yöneticinin
 * kapattığını açamaz; yönetici her kapalıyı açar ve "Kapalı tut" ile kaydı düşürür. Onay sorulmaz; fiyat yok.
 */
export function SoldOutCard({ role, entries, serverNow }: { role: Role; entries: SoldOutEntry[]; serverNow: number }) {
  const admin = role === "admin";
  const clock = useClock(60_000);
  const now = new Date(clock || serverNow);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [, run] = useActionTransition();
  const lastToggle = useRef(new Map<string, number>());
  const ref = useRef<HTMLElement>(null);
  const onCard = entries.filter((e) => e.state === "card");

  // Bugün'den #tukenenler ile gelinince: kart yerleşince görünür alana
  useEffect(() => {
    if (window.location.hash === "#tukenenler") ref.current?.scrollIntoView({ block: "start" });
  }, []);

  function lockRow(id: string) {
    setLocked((s) => new Set(s).add(id));
    setTimeout(
      () =>
        setLocked((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        }),
      ROW_LOCK_MS,
    );
  }

  /** Tek dokunuş: Tükendi (soldOut) ya da Satışa aç; sonuç bildirimle, Tükendi'nin "Geri al"ıyla */
  function toggle(entry: Pick<SoldOutEntry, "id" | "name">, soldOut: boolean) {
    if (busy || locked.has(entry.id)) return;
    setBusy(entry.id);
    run(async () => {
      try {
        // Aynı kalemde iki işlem arasında sunucunun beklediği süre (Geri al hemen basılırsa)
        const wait = (lastToggle.current.get(entry.id) ?? 0) + STAFF_TOGGLE_LIMIT.perItemMs + 100 - Date.now();
        if (wait > 0) await sleep(wait);
        const res = await setSoldOut({ siteMenuId: entry.id, soldOut });
        if (!res.ok) {
          toast.error(res.error, { id: `tukendi-${entry.id}` });
          return;
        }
        lastToggle.current.set(entry.id, Date.now());
        lockRow(entry.id);
        if (!res.data.changed) toast(res.data.message, { id: `tukendi-${entry.id}` });
        else if (soldOut) {
          toast.success(res.data.message, {
            id: `tukendi-${entry.id}`,
            description: SOLD_OUT_TEXT.everywhere,
            action: { label: "Geri al", onClick: () => toggle(entry, false) },
          });
        } else toast.success(res.data.message, { id: `tukendi-${entry.id}` });
      } finally {
        setBusy(null);
      }
    });
  }

  function hold(entry: SoldOutEntry) {
    if (busy) return;
    setBusy(entry.id);
    run(async () => {
      try {
        const res = await holdSoldOut({ siteMenuId: entry.id });
        if (!res.ok) toast.error(res.error, { id: `tukendi-${entry.id}` });
        else toast.success(res.data.message, { id: `tukendi-${entry.id}` });
      } finally {
        setBusy(null);
      }
    });
  }

  const button = (
    <Button variant="secondary" size="sm" className="pointer-coarse:h-11" onClick={() => setOpen(true)}>
      Tükendi işaretle
    </Button>
  );

  return (
    <Card id="tukenenler" ref={ref} className="scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">
            <PackageX aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base leading-6 font-semibold tracking-tight text-ink">
              Tükenenler
              {onCard.length ? <Badge tone="amber">{num(onCard.length)}</Badge> : null}
            </h2>
            {onCard.length ? null : <p className="text-[13px] leading-5 text-ink-mute">Biten ürün yok.</p>}
          </div>
        </div>
        {button}
      </div>
      {onCard.length ? (
        <ul className="mx-5 mb-5 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line" aria-label="Tükenen ürünler">
          {onCard.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{e.name}</p>
                <p className="truncate text-[13px] text-ink-mute">{soldOutMeta(e, now)}</p>
              </div>
              {admin ? (
                <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => hold(e)}>
                  Kapalı tut
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" className="min-h-11" disabled={busy !== null || locked.has(e.id)} onClick={() => toggle(e, false)}>
                {busy === e.id ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}
                Satışa aç
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <SoldOutDialog open={open} onClose={() => setOpen(false)} entries={entries} admin={admin} now={now} busy={busy} locked={locked} onToggle={toggle} />
    </Card>
  );
}

/** Durum rozeti: satışta, kartla kapatıldı, yöneticinin kapattığı, sonra sitede değişti */
function stateBadge(e: SoldOutEntry, now: Date) {
  if (e.state === "on") return <Badge tone="green">Satışta</Badge>;
  if (e.state === "card" && e.marker) return <Badge tone="amber">{`Tükendi · ${e.marker.by} ${soldOutWhen(e.marker.at, now)}`}</Badge>;
  if (e.state === "drifted" && e.marker) return <Badge className="whitespace-normal">{`${e.marker.by} tükendi yaptı; sonra sitede değişti · yönetici açar`}</Badge>;
  return <Badge>Kapalı · yönetici açar</Badge>;
}

/**
 * "Tükendi işaretle" penceresi: ürünler sitenin kategorilerine göre, arama panel ve sitedeki adda. Yalnız kapatır;
 * açma kartın gövdesinden. Yönetici kayıtsız kapalıyı da buradan açar.
 */
function SoldOutDialog({
  open,
  onClose,
  entries,
  admin,
  now,
  busy,
  locked,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  entries: SoldOutEntry[];
  admin: boolean;
  now: Date;
  busy: string | null;
  locked: ReadonlySet<string>;
  onToggle: (e: SoldOutEntry, soldOut: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const hits = soldOutHits(entries, query);
    const map = new Map<string, SoldOutEntry[]>();
    for (const e of hits) map.set(e.category || "Diğer", [...(map.get(e.category || "Diğer") ?? []), e]);
    return [...map];
  }, [entries, query]);

  return (
    <Dialog open={open} onClose={onClose} title="Tükendi işaretle" description={SOLD_OUT_TEXT.sizesTogether} size="lg">
      <div className="space-y-4">
        <SearchInput placeholder="Ürün ara" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Ürün ara" />
        {groups.length ? (
          groups.map(([category, list]) => (
            <section key={category} aria-label={category}>
              <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-ink-mute uppercase">{category}</h3>
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {list.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {e.name}
                        {e.sizes.length > 1 ? <span className="ml-1.5 text-[13px] font-normal text-ink-mute">{e.sizes.join(" · ")}</span> : null}
                      </p>
                      {siteNameDiffers(e) ? <p className="truncate text-[13px] text-ink-mute">sitede: {e.siteName}</p> : null}
                      <div className="mt-1">{stateBadge(e, now)}</div>
                    </div>
                    {e.state === "on" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null || locked.has(e.id)}
                        onClick={() => onToggle(e, true)}
                      >
                        {busy === e.id ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}
                        Tükendi
                      </Button>
                    ) : admin && e.state !== "card" && e.reopenable ? (
                      <Button variant="ghost" size="sm" disabled={busy !== null || locked.has(e.id)} onClick={() => onToggle(e, false)}>
                        Satışa aç
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute ring-1 ring-line">{query ? "Bu adla ürün yok." : "Siteye bağlı ürün yok."}</p>
        )}
      </div>
    </Dialog>
  );
}
