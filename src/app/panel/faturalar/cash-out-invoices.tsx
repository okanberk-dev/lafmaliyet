"use client";

import { FilePlus2, Info, Receipt, Trash2, WalletCards, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { cashOutsTotal } from "@/lib/cash-outs";
import { dateTR, money, num } from "@/lib/format";
import { photoUrl } from "@/lib/photo-rules";
import { dismissCashOutInvoices, dropCashOutInvoiceExpense, undoCashOutInvoiceExpense, writeCashOutInvoiceExpense } from "@/server/actions/cash-out-invoices";
import { restoreExpenseEntry } from "@/server/actions/expenses";

import type { CashOutDuplicateSource, CashOutInvoiceSource } from "./rules";

/** Bekleyen satır: kasa satırı ve "Aylık harcamalar'a yaz"ın önerdiği kategori */
export type PendingCashOut = CashOutInvoiceSource & { suggestedCategoryId: number | null };

const DOC_LABEL: Record<CashOutInvoiceSource["docType"], string> = { e_arsiv: "e-Arşiv", fatura: "Fatura", fis: "Fiş", yok: "Belgesiz" };
const UNDO_MS = 10_000;

/**
 * Faturalar › Kontrol bekleyen: kasadan faturalı alımlar (denetim E-42). Kasa'ya e-Arşiv ya da faturalı alışveriş
 * girildi (personel ya da "Aylık harcamalar'a da yaz"ı kapalı yönetici); Aylık harcamalar'a yazılmadı (Paraşüt'ten de
 * gelir diye), ama e-Arşiv ve kâğıt fatura Paraşüt'e ancak muhasebeci girerse düşer. Satır başına üç yol: "Faturalar'a
 * ekle" (pencere kasadan dolu, fiş belge olur), "Aylık harcamalar'a yaz" (kategoriyle, nakit) ve "Listeden çıkar"
 * (faturası başka adla var ya da kafenin gideri değil). Aynı mağazadan ±7 gün, ±1 ₺ içinde fatura gelince satır
 * kendiliğinden kalkar. Aylık harcamalar'a yazılmış satırın faturası sonradan gelirse (iki kez sayılıyor) aynı kartta
 * "Gider kaydını sil" ve "Ayrı alım" (inceleme D2); fatura o satırdan açıldıysa ("Faturalar'a ekle") yalnız "Gider kaydını
 * sil": fatura başka bir alımın olamaz. Yönetici görür; salt okunur hesap (muhasebeci, `readOnly`) satırları eylemsiz
 * görür: hangi alımın faturasının beklendiğini okur, düğme çizilmez.
 */
export function CashOutInvoicesCard({
  rows,
  duplicates = [],
  categories,
  onAddInvoice,
  readOnly = false,
}: {
  /** Salt okunur hesap: satırlar bilgi olarak, eylem düğmeleri ve kategori seçimi yok */
  readOnly?: boolean;
  rows: PendingCashOut[];
  /** Aylık harcamalar'a yazılmış, faturası sonradan gelmiş satırlar */
  duplicates?: CashOutDuplicateSource[];
  categories: { id: number; name: string }[];
  onAddInvoice: (row: PendingCashOut) => void;
}) {
  const [pending, run] = useActionTransition();
  // İşlenen satırlar sunucunun yenilemesini beklemeden gizlenir; hata olursa geri gelir
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const visible = rows.filter((r) => !hidden.has(r.id));
  const twice = duplicates.filter((r) => !hidden.has(r.id));
  if (!visible.length && !twice.length) return null;
  const total = cashOutsTotal(visible);
  const known = new Set(categories.map((c) => c.id));

  const hide = (ids: number[], on: boolean) =>
    setHidden((h) => {
      const next = new Set(h);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const nameOf = (r: Pick<CashOutInvoiceSource, "store">) => r.store?.trim() || "Yeri yazılmamış alım";

  function toExpenses(r: PendingCashOut) {
    const value = chosen[r.id] ?? (r.suggestedCategoryId && known.has(r.suggestedCategoryId) ? String(r.suggestedCategoryId) : "");
    if (!value) {
      document.getElementById(`kasa-kat-${r.id}`)?.focus();
      return void toast.error("Kategori seçin", { description: "Aylık harcamalar'da hangi kalemde sayılacağını seçin." });
    }
    const category = categories.find((c) => c.id === Number(value))?.name ?? "";
    hide([r.id], true);
    run(async () => {
      const res = await writeCashOutInvoiceExpense({ id: r.id, categoryId: Number(value) });
      if (!res.ok) {
        hide([r.id], false);
        return void toast.error(res.error);
      }
      toast.success(`${nameOf(r)} Aylık harcamalar'a yazıldı`, {
        // Faturası sonradan Paraşüt'e girilirse alım iki kez sayılır: kart onu "faturası geldi" diye gösterir (U3)
        description: `${money(r.amount)} · ${category} · nakit. Faturası sonra Paraşüt'e girilirse burada "iki kez sayılıyor" diye çıkar.`,
        duration: UNDO_MS,
        action: {
          label: "Geri al",
          onClick: () =>
            run(async () => {
              const back = await undoCashOutInvoiceExpense({ id: r.id, expenseId: res.data.expenseId });
              if (!back.ok) return void toast.error(back.error);
              hide([r.id], false);
              toast.success("Geri alındı; alım yeniden bekliyor");
            }),
        },
      });
    });
  }

  /** İki kez sayılan satır: gider kaydı silinir (alım faturayla sayılır); "Geri al" kaydı geri yazar */
  function dropExpense(r: CashOutDuplicateSource) {
    hide([r.id], true);
    run(async () => {
      const res = await dropCashOutInvoiceExpense({ id: r.id, expenseId: r.expenseId });
      if (!res.ok) {
        hide([r.id], false);
        return void toast.error(res.error);
      }
      toast.success(`${nameOf(r)}: gider kaydı silindi`, {
        description: `${money(r.amount)} artık yalnız faturayla sayılıyor (${dateTR(r.invoice.date)} · ${r.invoice.supplier}).`,
        duration: UNDO_MS,
        action: {
          label: "Geri al",
          onClick: () =>
            run(async () => {
              const back = await restoreExpenseEntry(res.data.snapshot);
              if (!back.ok) return void toast.error(back.error);
              hide([r.id], false);
              toast.success("Geri alındı; gider kaydı yeniden duruyor");
            }),
        },
      });
    });
  }

  function dismiss(r: CashOutInvoiceSource, separate = false) {
    hide([r.id], true);
    run(async () => {
      const res = await dismissCashOutInvoices({ ids: [r.id] });
      if (!res.ok) {
        hide([r.id], false);
        return void toast.error(res.error);
      }
      toast.success(`${nameOf(r)} listeden çıkarıldı`, {
        description: separate ? "Fatura başka bir alımın sayıldı; gider kaydı duruyor." : "Gelir-gidere bu satırdan bir şey yazılmadı.",
        duration: UNDO_MS,
        action: {
          label: "Geri al",
          onClick: () =>
            run(async () => {
              const back = await dismissCashOutInvoices({ ids: [r.id], undo: true });
              if (!back.ok) return void toast.error(back.error);
              hide([r.id], false);
            }),
        },
      });
    });
  }

  return (
    <Card id="kasa-faturali" className="mb-4 scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<Receipt />}
        title="Kasadan faturalı alımlar"
        description={
          visible.length ? (
            <>
              Kasa&apos;ya e-Arşiv ya da faturalı alışveriş girildi; Aylık harcamalar&apos;a yazılmadı, faturası da Faturalar&apos;da yok: gelir-gidere ve mal
              maliyetine girmedi.
              <span className="max-sm:hidden"> Aynı mağazadan ±7 gün, ±1 ₺ içinde fatura gelince satır kendiliğinden kalkar.</span>
            </>
          ) : (
            <>Aylık harcamalar&apos;a yazılmış kasa alımlarının faturası sonradan Faturalar&apos;a geldi: alım iki kez sayılıyor.</>
          )
        }
        meta={
          <>
            {visible.length ? (
              <>
                <span>
                  <span className="font-semibold text-ink tabular">{num(visible.length)}</span> alım
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-ink tabular">{money(total)}</span>
              </>
            ) : null}
            {visible.length && twice.length ? <span aria-hidden="true">·</span> : null}
            {twice.length ? (
              <span className="font-semibold text-bad">
                <span className="tabular">{num(twice.length)}</span> iki kez sayılıyor
              </span>
            ) : null}
          </>
        }
      />
      {twice.length ? (
        <section aria-labelledby="kasa-iki-kez" className="border-t border-line">
          <h3 id="kasa-iki-kez" className="bg-bad-soft/60 px-4 py-2 text-[13px] leading-5 font-semibold text-bad sm:px-5">
            Faturası geldi, Aylık harcamalar&apos;da da sayılıyor
          </h3>
          <ul className="divide-y divide-line border-t border-line">
            {twice.map((r) => (
              <li key={r.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-bad-soft text-bad ring-1 ring-line" aria-hidden="true">
                    <Receipt size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-6 font-medium text-ink">
                      <span className="min-w-0 break-words">{[nameOf(r), r.description].filter(Boolean).join(" · ")}</span>
                      <Badge tone="red">İki kez sayılıyor</Badge>
                    </p>
                    <p className="text-[13px] leading-5 text-ink-mute">
                      {[`Kasa ${dateTR(r.receiptDate ?? r.date)}`, r.tillName, r.createdByName, r.expenseCategory ? `Aylık harcamalar: ${r.expenseCategory}` : "Aylık harcamalar'da"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-[13px] leading-5 text-ink-mute">
                      {[
                        `Fatura ${dateTR(r.invoice.date)}`,
                        r.invoice.supplier,
                        r.invoice.invoiceNo ? `No ${r.invoice.invoiceNo}` : null,
                        money(r.invoice.payable),
                        r.adopted ? "bu satırdan eklendi" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold text-ink tabular">{money(r.amount)}</span>
                </div>
                {readOnly ? null : (
                  <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[3.25rem]">
                    <Button size="sm" disabled={pending} onClick={() => dropExpense(r)} className="max-sm:w-full">
                      <Trash2 size={15} /> Gider kaydını sil
                    </Button>
                    {/* Fatura bu satırdan açıldıysa ("Faturalar'a ekle") başka bir alımın olamaz: sunucu da reddeder */}
                    {r.adopted ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => dismiss(r, true)}
                        title="Fatura başka bir alımın: gider kaydı kalsın, satır listeden çıksın"
                        className="max-sm:w-full sm:ml-auto"
                      >
                        <X size={15} /> Ayrı alım
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul className={visible.length ? "divide-y divide-line border-t border-line" : "hidden"}>
        {visible.map((r) => {
          const day = r.receiptDate ?? r.date;
          const caption = `${nameOf(r)} · ${dateTR(day)}`;
          const value = chosen[r.id] ?? (r.suggestedCategoryId && known.has(r.suggestedCategoryId) ? String(r.suggestedCategoryId) : "");
          return (
            <li key={r.id} className="px-4 py-3.5 sm:px-5">
              <div className="flex items-start gap-3">
                {r.photoId ? (
                  <button
                    type="button"
                    onClick={() => setViewer({ id: r.photoId!, caption })}
                    aria-label={`${caption}: fişin fotoğrafını büyüt`}
                    className="size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-panel ring-1 ring-line hover:ring-line-strong pointer-coarse:size-11"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz */}
                    <img src={photoUrl(r.photoId)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  </button>
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-panel text-ink-mute ring-1 ring-line" aria-hidden="true">
                    <Receipt size={18} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-6 font-medium text-ink">
                    <span className="min-w-0 break-words">{[nameOf(r), r.description].filter(Boolean).join(" · ")}</span>
                    <Badge tone="amber">{DOC_LABEL[r.docType]}</Badge>
                  </p>
                  <p className="text-[13px] leading-5 text-ink-mute">
                    {[
                      r.receiptDate && r.receiptDate !== r.date ? `Fiş ${dateTR(r.receiptDate)} · kasa ${dateTR(r.date)}` : dateTR(r.date),
                      r.tillName,
                      r.createdByName,
                      r.receiptNo ? `No ${r.receiptNo}` : null,
                      r.vat ? `KDV ${money(r.vat)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-[15px] font-semibold text-ink tabular">{money(r.amount)}</span>
              </div>
              {readOnly ? null : (
                <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[3.25rem]">
                  <Button size="sm" disabled={pending} onClick={() => onAddInvoice(r)} className="max-sm:w-full">
                    <FilePlus2 size={15} /> Faturalar&apos;a ekle
                  </Button>
                  <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
                    <label htmlFor={`kasa-kat-${r.id}`} className="sr-only">
                      Aylık harcamalar kategorisi
                    </label>
                    <Select
                      id={`kasa-kat-${r.id}`}
                      value={value}
                      onChange={(e) => setChosen((c) => ({ ...c, [r.id]: e.target.value }))}
                      className="h-8 min-w-0 flex-1 text-[13px] sm:w-52 sm:flex-none"
                    >
                      <option value="">Kategori seçin</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => toExpenses(r)} className="shrink-0 text-ink">
                      <WalletCards size={15} /> <span className="max-sm:hidden">Aylık harcamalar&apos;a yaz</span>
                      <span className="sm:hidden">Harcamaya yaz</span>
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => dismiss(r)}
                    title="Faturası Faturalar'da başka adla ya da tutarla varsa, ya da kafenin gideri değilse"
                    className="max-sm:w-full sm:ml-auto"
                  >
                    <X size={15} /> Listeden çıkar
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs leading-5 text-ink-mute sm:px-5">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {readOnly ? (
          <>
            Faturası Paraşüt&apos;e düşünce (e-fatura ya da Paraşüt&apos;e girilen e-Arşiv) satır kendiliğinden kalkar: aynı mağazadan ±7 gün, ±1 ₺ içindeki
            fatura eşleşir. Öbür satırları yönetici Faturalar&apos;a ekler ya da Aylık harcamalar&apos;a yazar.
          </>
        ) : (
          <>
            Faturası Paraşüt&apos;e düşecekse (e-fatura ya da muhasebecinin girdiği e-Arşiv) beklemeniz yeter: aynı mağazadan ±7 gün, ±1 ₺ içinde fatura
            gelince satır kendiliğinden kalkar. Şirket adına kesilmiş e-Arşiv&apos;i Faturalar&apos;a ekleyin; Aylık harcamalar&apos;a yazılan alımın faturası
            sonra gelirse burada &quot;iki kez sayılıyor&quot; diye çıkar.
          </>
        )}
      </p>
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </Card>
  );
}
