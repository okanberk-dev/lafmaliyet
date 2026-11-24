"use client";

import { Store } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { matches, SearchField, useQueryText } from "@/components/ui/filters";
import { Checkbox, Field, Input, NumberInput } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { money, num } from "@/lib/format";
import { effectiveLocalValue, effectiveText, parseEffectiveLocal } from "@/lib/prices/branch";
import type { SiteBranchPrice } from "@/lib/site-menu/schema";
import { fromMinor } from "@/lib/site-menu/slot";
import { cancelBranchPriceRow, setBranchPrice } from "@/server/actions/prices";
import type { BranchPriceContext, BranchPriceItem, BranchTarget } from "@/server/data/branch-prices";

import { priceText } from "../price-text";

/** "205 ₺ / 225 ₺"; tek boyda yalnız M */
const pair = (p: { M: number; L: number }) => `${money(p.M)}${p.L > 0 ? ` / ${money(p.L)}` : ""}`;

/** Satırın fiyatı: "205 ₺ / 225 ₺", "taban L" ya da "tabana döner" */
function rowText(r: SiteBranchPrice, hasL: boolean): string {
  if (r.priceMinor === null) return "tabana döner";
  return `${money(fromMinor(r.priceMinor))}${hasL ? ` / ${r.priceMinorL > 0 ? money(fromMinor(r.priceMinorL)) : "taban L"}` : ""}`;
}

/**
 * Fiyatlar › Şube fiyatı (docs/FIYATLAR.md › Şube fiyatı): seçilen şubenin kalemleri, tabanı (sitenin fiyatı, Tuzla),
 * şubede şu an geçerli fiyatı ve planlanan değişiklikleri. "Değiştir" bir kalemin şube fiyatını bir andan itibaren
 * yazar (varsayılan sonraki iş günü 05:00); anı gelmemiş satır "İptal" ile geri alınır. Site şube fiyatını
 * duyurmadıysa yalnız okunur.
 */
export function BranchPrices({ ctx, branch, items, now }: { ctx: BranchPriceContext; branch: BranchTarget; items: BranchPriceItem[]; now: string }) {
  const [q, setQ] = useQueryText("ara");
  const [editing, setEditing] = useState<BranchPriceItem | null>(null);
  const [pending, start] = useActionTransition();
  const nowMs = Date.parse(now);
  const shown = useMemo(() => items.filter((i) => matches(`${i.name} ${i.category} ${i.id}`, q)), [items, q]);
  const canWrite = ctx.configured && ctx.writes;
  const planned = items.reduce((n, i) => n + i.rows.filter((r) => Date.parse(r.effectiveFrom) > nowMs).length, 0);

  function cancel(i: BranchPriceItem, r: SiteBranchPrice) {
    start(async () => {
      const res = await cancelBranchPriceRow({ branch: branch.id, siteMenuId: i.id, effectiveFrom: r.effectiveFrom });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${i.name}: ${effectiveText(r.effectiveFrom)} fiyatı iptal edildi`);
    });
  }

  return (
    <div className="space-y-4">
      {!ctx.configured ? (
        <Notice tone="warn" title="Site bağlantısı kurulmamış" text="Şube fiyatı sitede tutulur; site bağlantısı olmadan okunmaz ve yazılmaz." tech="KARAOKE_SYNC_SECRET tanımlı değil" />
      ) : !ctx.writes ? (
        <Notice
          tone="neutral"
          title="Site şube fiyatını henüz kabul etmiyor"
          text="laffogato.net şube fiyatını duyurunca (menü eşitlemesinde) burada değiştirebilirsiniz. Şimdilik yalnız okunur."
        />
      ) : null}
      <Card>
        <CardHeader
          icon={<Store />}
          title={`${branch.name} fiyatları`}
          description="Taban sitenin fiyatıdır (Tuzla ve kendi fiyatı olmayan her şube). Şube fiyatı bir andan itibaren geçerli olur; LafPOS o anda fiyatı siteden alır."
          meta={<span className="tabular">{planned ? `${num(planned)} planlanan değişiklik` : `${num(items.length)} kalem`}</span>}
        />
        <div className="px-5 pb-3">
          <SearchField value={q} onChange={setQ} placeholder="Kalem ara" label="Kalem ya da kategori ara" className="max-w-sm max-sm:[&_input]:h-11" />
        </div>
        {!ctx.rowsAt && ctx.configured ? <p className="px-5 pb-3 text-xs text-ink-mute">Şube satırları henüz alınmadı; Ürünler › Site menüsü&apos;nden &quot;Siteyle eşitle&quot;.</p> : null}
        {shown.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Kalem</TH>
                  <TH numeric>Taban</TH>
                  <TH numeric>{branch.name} (şimdi)</TH>
                  <TH>Planlanan</TH>
                  <TH className="w-0" />
                </tr>
              </THead>
              <tbody>
                {shown.map((i) => {
                  const future = i.rows.filter((r) => Date.parse(r.effectiveFrom) > nowMs);
                  const own = i.current.from !== null;
                  return (
                    <TR key={i.id}>
                      <TD>
                        <span className="block font-medium break-words">{i.name}</span>
                        <span className="block text-xs text-ink-mute">{i.category}</span>
                      </TD>
                      <TD numeric className="text-ink-soft">
                        {pair(i.base)}
                      </TD>
                      <TD numeric>
                        <span className="font-semibold">{pair(i.current)}</span>
                        {own ? <span className="block text-xs text-ink-mute">{effectiveText(i.current.from!)}&apos;ten</span> : <span className="block text-xs text-ink-mute">taban</span>}
                      </TD>
                      <TD>
                        {future.length ? (
                          <ul className="space-y-1">
                            {future.map((r) => (
                              <li key={r.effectiveFrom} className="flex flex-wrap items-center gap-2 text-sm">
                                <Badge tone="blue">{effectiveText(r.effectiveFrom)}</Badge>
                                <span className="tabular">{rowText(r, i.base.L > 0)}</span>
                                {canWrite ? (
                                  <Button size="sm" variant="ghost" onClick={() => cancel(i, r)} disabled={pending} aria-label={`${i.name} ${effectiveText(r.effectiveFrom)} fiyatını iptal et`}>
                                    İptal
                                  </Button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-ink-mute">—</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        {canWrite ? (
                          <Button size="sm" variant="secondary" onClick={() => setEditing(i)} className="pointer-coarse:h-11">
                            Değiştir
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Kalem yok" description={items.length ? "Aramayı kısaltın." : "Sitenin menüsü henüz alınmadı."} />
        )}
      </Card>
      {editing ? <EditDialog key={editing.id} item={editing} branch={branch} defaultEffective={ctx.defaultEffective} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** Bir kalemin şube fiyatı: M, L (kalem iki boyluysa), Geçerlilik; ya da tabana dön */
function EditDialog({ item, branch, defaultEffective, onClose }: { item: BranchPriceItem; branch: BranchTarget; defaultEffective: string; onClose: () => void }) {
  const hasL = item.base.L > 0;
  const [m, setM] = useState(priceText(item.current.M));
  const [l, setL] = useState(hasL ? priceText(item.current.L) : "");
  const [when, setWhen] = useState(effectiveLocalValue(defaultEffective));
  const [toBase, setToBase] = useState(false);
  const [pending, start] = useActionTransition();
  const mValue = parseNumberTR(m);
  const lValue = hasL ? parseNumberTR(l) : null;
  const effective = parseEffectiveLocal(when);
  const mError = !toBase && !(mValue !== null && mValue > 0) ? "Fiyat 0'dan büyük olmalı" : null;
  const lError = !toBase && hasL && !(lValue !== null && lValue > 0) ? "Fiyat 0'dan büyük olmalı" : null;

  function save() {
    if (!effective.ok || mError || lError) return;
    start(async () => {
      const res = await setBranchPrice({
        branch: branch.id,
        siteMenuId: item.id,
        effectiveFrom: effective.iso,
        ...(toBase ? { base: true } : { M: mValue!, ...(hasL ? { L: lValue! } : {}) }),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${item.name}: ${branch.name}'da ${effectiveText(effective.iso)}'ten ${pair(res.data.after)}`);
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${item.name} · ${branch.name}`}
      description={`Taban ${pair(item.base)} · şimdi ${pair(item.current)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending || !effective.ok || !!mError || !!lError}>
            {pending ? "Siteye yazılıyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!toBase ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={hasL ? "M fiyatı" : "Fiyat"} htmlFor="sube-m" error={mError}>
              <NumberInput id="sube-m" inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} className="h-11 sm:h-10" />
            </Field>
            {hasL ? (
              <Field label="L fiyatı" htmlFor="sube-l" error={lError}>
                <NumberInput id="sube-l" inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} className="h-11 sm:h-10" />
              </Field>
            ) : null}
          </div>
        ) : null}
        <Field label="Geçerlilik" htmlFor="sube-gecerlilik" error={effective.ok ? null : effective.error} hint="Varsayılan sonraki iş günü 05:00 (İstanbul). Bu andan önce satılanlar eski fiyatıyla kalır.">
          <Input id="sube-gecerlilik" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-11 sm:h-10" />
        </Field>
        <Checkbox label="Taban fiyata dön (şubenin kendi fiyatı biter)" checked={toBase} onChange={(e) => setToBase(e.target.checked)} />
      </div>
    </Dialog>
  );
}
