"use client";

import { CheckCheck, Copy, RotateCcw, Store } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/misc";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { money, num } from "@/lib/format";
import type { KasaName } from "@/lib/asilpos/kasa";
import { PRICE_SOURCE_LABEL } from "@/lib/prices/history";
import { agoLabel, groupByCategory, posChangedText, posChecklistText, staleForText, type MyPosMark, type StaffPosItem } from "@/lib/prices/pos";
import { todayTR } from "@/lib/reminders";
import { markPosDone, undoPosMarks } from "@/server/actions/pos-marks";
import type { PosChecklistItem } from "@/server/data/prices";

const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;
/** "Latte Medium" (bildirim) */
const longName = (i: { name: string; size: string }) => `${i.name} ${sizeLabel(i.size)}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/**
 * Kasaya işle listesi (docs/FIYATLAR.md), iki yüzde:
 * - yönetici (Ürünler › Fiyatlar › Kasaya işle): kaynak ve değiştiren kişiyle, "Hepsini işaretle";
 * - personel (`staff: true`, Kasadaki fiyatlar; dalga 10 §2.2): kaynak, kişi ve not yok, tek tek işaretler, son 30
 *   dakikada işaretledikleri listenin üstünde ("Son işaretledikleriniz", Geri al).
 * İşaretlenen satır hemen gizlenir; bildirimdeki "Geri al" işareti geri alır (istemciden fiyat gitmez, yalnız işaretin
 * kimliği). Liste düz metin olarak kopyalanıp WhatsApp'a yapıştırılabilir (posChecklistText).
 * `kasa` bugünün kasası (src/lib/asilpos/kasa.ts; verilmezse ModPOS): AsilPOS gününde listede yalnız siteye bağlı olmayan
 * ürünler var, AsilPOS öbürlerinin fiyatını siteden alır; metinler bunu söyler (denetim E-39).
 * `branchId` listenin kasası (şube kapsamı A3): işaret yalnız o şubenin kasasından düşer (markPosDone). `branchName`
 * yalnız "Tümü"de birden çok kasa yan yanayken başlığa girer ("Marina · Kasaya işle").
 */
export function PosChecklist(
  props: ({ staff?: false; items: PosChecklistItem[] } | { staff: true; items: StaffPosItem[]; mine: MyPosMark[] }) & {
    kasa?: KasaName;
    branchId?: string;
    branchName?: string | null;
  },
) {
  const { items } = props;
  const staff = props.staff === true;
  const asilpos = props.kasa === "AsilPOS";
  // İşaretlenenler hemen gizlenir (sunucu yanıtını beklemeden); kasanın geri kalış anıyla tutulur: aynı ürün sonra
  // yeniden listeye girerse (yeni bir fiyat) yine görünür
  const [done, setDone] = useState<ReadonlyMap<number, string>>(() => new Map());
  // Personel: bu oturumda işaretlenenler (sunucu yenilenene kadar) ve geri alınanlar
  const [added, setAdded] = useState<MyPosMark[]>([]);
  const [undone, setUndone] = useState<ReadonlySet<number>>(() => new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [pending, start] = useActionTransition();
  const visible = useMemo<(PosChecklistItem | StaffPosItem)[]>(() => items.filter((i) => done.get(i.productId) !== i.since), [items, done]);
  const groups = groupByCategory(visible);
  const mine = useMemo(() => {
    if (!props.staff) return [];
    const byId = new Map([...props.mine, ...added].map((m) => [m.markId, m]));
    return [...byId.values()].filter((m) => !undone.has(m.markId)).sort((a, b) => b.markedAt.localeCompare(a.markedAt));
  }, [props, added, undone]);

  const forget = (ids: number[]) =>
    setDone((m) => {
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });

  /** İşaretleri geri alır; alınamayanların nedeni bildirilir */
  function undo(marks: { markId: number; productId: number }[]) {
    forget(marks.map((m) => m.productId));
    setUndone((s) => new Set([...s, ...marks.map((m) => m.markId)]));
    const restore = () => setUndone((s) => new Set([...s].filter((id) => !marks.some((m) => m.markId === id))));
    start(async () => {
      // Eylem atarsa (ağ kesildi, panel güncellendi) işaret yerinde kalır: "Son işaretledikleriniz"e döner, yeniden geri
      // alınabilir; hata yine useActionTransition'ın bildirimiyle çıkar (denetim 21 Kasım #34)
      let u: Awaited<ReturnType<typeof undoPosMarks>>;
      try {
        u = await undoPosMarks(marks.map((m) => m.markId));
      } catch (e) {
        restore();
        throw e;
      }
      if (!u.ok) {
        restore();
        return void toast.error(u.error);
      }
      if (u.data.refused.length) toast.warning(`${num(u.data.refused.length)} işaret geri alınamadı`, { description: u.data.refused[0].reason });
      else toast.success(u.data.undone === 1 ? "İşaret geri alındı; fiyat listeye döndü" : `${num(u.data.undone)} işaret geri alındı`);
    });
  }

  function mark(list: (PosChecklistItem | StaffPosItem)[]) {
    if (!list.length) return;
    const ids = list.map((i) => i.productId);
    setDone((m) => new Map([...m, ...list.map((i) => [i.productId, i.since] as const)]));
    start(async () => {
      // Görülen fiyatla: bu arada fiyatı yeniden değişen işaretlenmez, listeye bugünkü fiyatıyla döner. Eylem atarsa
      // (ağ kesildi, panel güncellendi) hiçbir şey işaretlenmedi: gizlenen satırlar listeye döner, yeniden denenir; hata
      // yine useActionTransition'ın bildirimiyle çıkar (denetim 21 Kasım #34). İstek sunucuya ulaştıysa yeniden
      // işaretlemek "zaten işaretlenmiş" der.
      let r: Awaited<ReturnType<typeof markPosDone>>;
      try {
        r = await markPosDone(list.map((i) => ({ productId: i.productId, price: i.price })), props.branchId);
      } catch (e) {
        forget(ids);
        throw e;
      }
      if (!r.ok) {
        forget(ids);
        return void toast.error(r.error);
      }
      const changed = posChangedText(r.data.changed);
      if (changed) {
        forget(r.data.changed.map((x) => x.productId));
        toast.warning(changed.title, { description: changed.description, duration: 12_000 });
      }
      if (r.data.already.length) {
        const first = list.find((i) => i.productId === r.data.already[0]);
        toast.info(r.data.already.length === 1 && first ? `${longName(first)} zaten işaretlenmiş` : `${num(r.data.already.length)} fiyat zaten işaretlenmiş`);
      }
      const d = r.data.done;
      if (!d.length) return;
      const named = d.map((x) => {
        const item = list.find((i) => i.productId === x.productId);
        return { ...x, long: item ? longName(item) : x.label, name: item?.name ?? x.label, size: item?.size ?? "" };
      });
      if (staff) setAdded((a) => [...a, ...named.map((x) => ({ markId: x.markId, productId: x.productId, name: x.name, size: x.size, price: x.price, markedAt: new Date().toISOString() }))]);
      toast.success(named.length === 1 ? `${named[0].long} kasada ${money(named[0].price)} olarak işaretlendi` : `${num(named.length)} fiyat kasada işaretlendi`, {
        duration: 10_000,
        action: { label: "Geri al", onClick: () => undo(named) },
      });
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(posChecklistText(visible, todayTR(), props.kasa));
      toast.success("Liste kopyalandı; WhatsApp'a yapıştırabilirsiniz");
    } catch {
      toast.error("Kopyalanamadı: tarayıcı panoya yazmaya izin vermedi");
    }
  }

  const oldest = visible.reduce<string | null>((a, i) => (a === null || i.since < a ? i.since : a), null);

  const list = (
    <Card>
      <CardHeader
        icon={<Store />}
        title={`${props.branchName ? `${props.branchName} · ` : ""}${staff ? (asilpos ? "AsilPOS'taki fiyatlar" : "ModPOS'ta değişecek fiyatlar") : "Kasaya işle"}`}
        description={
          staff
            ? asilpos
              ? undefined
              : "Kasada değiştirdiğiniz fiyatı işaretleyin; işaretlenen listeden düşer."
            : asilpos
              ? (
                  <>
                    AsilPOS siteye bağlı ürünlerin fiyatını siteden kendisi alır; burada yalnız siteye bağlı olmayan ve fiyatı AsilPOS başladıktan sonra değişen
                    ürünler çıkar. AsilPOS ürünü siteden alıyorsa (orada fiyatı değiştirilemez){" "}
                    <Link href="/panel/urunler/site" className="font-medium text-ink underline underline-offset-2">
                      Ürünler › Site menüsü
                    </Link>
                    &apos;nde bağlayın ya da fiyatı sitede değiştirin; AsilPOS&apos;ta yerel ürünse orada elle değiştirip işaretleyin. AsilPOS&apos;ta fiyatı
                    yönetici değiştirir, personele bu iş düşmez.
                  </>
                )
              : "Panelde ya da sitede değişen fiyatlar ModPOS'a kendiliğinden geçmez. Kasada değiştirdikçe işaretleyin; işaretlenen listeden düşer. Personel de Bugün'den işaretler; yanlış işareti aşağıdan geri alın."
        }
        meta={
          visible.length ? (
            <span className="tabular">
              {num(visible.length)} fiyat{oldest ? ` · en eskisi ${agoLabel(oldest).toLocaleLowerCase("tr-TR")}` : ""}
            </span>
          ) : null
        }
        actions={
          visible.length ? (
            <>
              <Button variant="secondary" onClick={copy}>
                <Copy size={16} aria-hidden="true" /> Metni kopyala
              </Button>
              {staff ? null : (
                <Button variant="secondary" onClick={() => setConfirmAll(true)} disabled={pending}>
                  <CheckCheck size={16} aria-hidden="true" /> Hepsini işaretle
                </Button>
              )}
            </>
          ) : null
        }
      />
      {visible.length ? (
        <CardContent className="space-y-5">
          {groups.map((g) => (
            <section key={g.category} aria-label={g.category}>
              <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-ink-soft">
                {g.category} <span className="font-normal text-ink-quiet tabular">{num(g.items.length)}</span>
              </h3>
              <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface">
                {g.items.map((i) => (
                  <li key={i.productId}>
                    <label className="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-panel/40">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => mark([i])}
                        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-ink"
                        aria-label={`${i.name} ${i.size}: kasada ${money(i.price)} yapıldı`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="min-w-0 font-medium break-words text-ink">
                            {i.name} · {sizeLabel(i.size)}
                          </span>
                          <span className="shrink-0 whitespace-nowrap tabular">
                            <s className="text-ink-mute">{money(i.stalePrice)}</s> → <span className="font-semibold text-ink">{money(i.price)}</span>
                          </span>
                        </span>
                        <span className="mt-0.5 block font-mono text-xs leading-5 break-words text-ink-mute">
                          {"source" in i ? (
                            <>
                              {i.posNames.length ? `Kasada: ${i.posNames.join(" · ")}` : "Kasada adı bilinmiyor (satış raporunda eşleşmemiş)"}
                              {i.changedAt ? ` · ${agoLabel(i.changedAt).toLocaleLowerCase("tr-TR")}` : ""}
                              {i.source ? ` · ${PRICE_SOURCE_LABEL[i.source]}` : ""}
                            </>
                          ) : (
                            `${i.posNames.length ? `Kasada: ${i.posNames.join(" · ")}` : "Kasada adı bilinmiyor"} · ${staleForText(i.since)}`
                          )}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      ) : (
        <EmptyState
          icon={<CheckCheck />}
          title={asilpos && staff ? "Burada işaretlenecek bir şey yok" : "Kasa güncel"}
          description={
            asilpos
              ? staff
                ? "Kasada yanlış bir satış fiyatı görürseniz yöneticinize haber verin."
                : "AsilPOS siteye bağlı ürünlerin fiyatını siteden alır. Siteye bağlı olmayan bir ürünün fiyatı panelde değişince burada listelenir."
              : staff
                ? "Panelde değişen bütün fiyatlar kasada da değişti."
                : "Panelde ya da sitede değişen bütün fiyatlar kasada da değiştirildi. Yeni bir fiyat değişince burada listelenir."
          }
        />
      )}
      {staff ? null : (
        <ConfirmDialog
          open={confirmAll}
          onClose={() => setConfirmAll(false)}
          onConfirm={() => {
            setConfirmAll(false);
            mark(visible);
          }}
          tone="primary"
          confirmLabel="İşaretle"
          title={`${num(visible.length)} fiyatın hepsi ${props.branchName ? `${props.branchName} kasasında` : "kasada"} değişti mi?`}
          description="İşaretlenen fiyatlar listeden düşer; bildirimdeki Geri al ile ya da Son işaretlenenler'den geri alabilirsiniz."
        />
      )}
    </Card>
  );

  if (!staff || !mine.length) return list;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={<RotateCcw />} title="Son işaretledikleriniz" description="30 dakika içinde geri alabilirsiniz; sonrası için yöneticiye yazın." />
        <CardContent>
          <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface">
            {mine.map((m) => (
              <li key={m.markId} className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 break-words">
                  <span className="font-medium text-ink">
                    {m.name} · {sizeLabel(m.size)}
                  </span>{" "}
                  → <span className="font-semibold tabular">{money(m.price)}</span> <span className="text-ink-mute tabular">· {clock(m.markedAt)}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => undo([m])} disabled={pending}>
                  Geri al
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {list}
    </div>
  );
}
