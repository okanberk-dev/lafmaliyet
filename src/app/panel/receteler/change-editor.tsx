"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { SIZE_LABELS } from "@/lib/constants";
import { diffRecipe, sameRecipe, type RecipeSnapshot } from "@/lib/recipe-change";
import { proposeRecipeChanges, withdrawRecipeChange } from "@/server/actions/recipe-requests";

import { buildSnapshot, FormulaHelp, RecipeLinesEditor, toRows, useRecipeKit, type LineRow, type ProposeKit } from "./recipe-lines";

export type { ProposeKit };

export interface EditorVariant {
  id: number;
  size: "M" | "L" | "Tek";
  /** Onaylı (bugünkü) reçete */
  current: RecipeSnapshot;
  /** Kişinin bekleyen önerisi (varsa pencere ondan başlar) */
  myPending: { id: number; after: RecipeSnapshot } | null;
}

/**
 * Personelin reçete değişiklik önerisi: boy boy malzeme, miktar (sayı ya da 2*ShotCift gibi formül), satır notu ve
 * hazırlama notu. Fiyat ve maliyet burada yoktur. "Onaya gönder" yalnız gerçekten değişen boyları yollar; yönetici
 * onaylayınca reçete değişir. Bekleyen önerisi olan boy ondan başlar; bugünkü hâline geri getirilirse öneri geri çekilir.
 * Malzeme satırlarının düzenleyicisi yeni ürün önerisiyle ortak (recipe-lines.tsx).
 */
export function ChangeEditor({
  productName,
  variants,
  kit,
  onClose,
}: {
  productName: string;
  variants: EditorVariant[];
  kit: ProposeKit;
  onClose: () => void;
}) {
  const recipeKit = useRecipeKit(kit);

  const [active, setActive] = useState(String(variants[0].id));
  const [state, setState] = useState(() =>
    Object.fromEntries(variants.map((v) => [v.id, { rows: toRows(v.myPending?.after ?? v.current), note: (v.myPending?.after ?? v.current).note ?? "" }])),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  /** Satırlardan kaydedilecek reçete; okunamayan satır varsa hata */
  const build = (v: EditorVariant) => buildSnapshot(state[v.id].rows, state[v.id].note, recipeKit, SIZE_LABELS[v.size]);

  const plans = variants.map((v) => {
    const { snap, error } = build(v);
    const start = v.myPending?.after ?? v.current;
    const differsFromCurrent = !sameRecipe(v.current, snap);
    const edited = !sameRecipe(start, snap);
    return { v, snap, error, differsFromCurrent, edited, diff: diffRecipe(v.current, snap) };
  });
  const toSend = plans.filter((p) => p.differsFromCurrent && (p.edited || !p.v.myPending));
  const toWithdraw = plans.filter((p) => p.v.myPending && !p.differsFromCurrent);
  const dirty = plans.some((p) => p.edited) || message.trim() !== "";
  const nothing = !toSend.length && !toWithdraw.length;

  const v = variants.find((x) => String(x.id) === active) ?? variants[0];
  const plan = plans.find((p) => p.v.id === v.id)!;
  const rows = state[v.id].rows;
  const setRows = (fn: (rows: LineRow[]) => LineRow[]) => setState((s) => ({ ...s, [v.id]: { ...s[v.id], rows: fn(s[v.id].rows) } }));

  const requestClose = () => {
    if (busy) return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  async function submit() {
    const bad = toSend.find((p) => p.error);
    if (bad) {
      setActive(String(bad.v.id));
      return void toast.error(bad.error);
    }
    setBusy(true);
    try {
      if (toSend.length) {
        const res = await proposeRecipeChanges({
          message: message.trim() || null,
          changes: toSend.map((p) => ({
            productId: p.v.id,
            note: p.snap.note,
            items: p.snap.items.map((i) => ({ ingredientId: i.ingredientId, qty: i.qty, qtyExpr: i.qtyExpr, note: i.note })),
          })),
        });
        if (!res.ok) return void toast.error(res.error);
      }
      for (const p of toWithdraw) {
        const res = await withdrawRecipeChange(p.v.myPending!.id);
        if (!res.ok) return void toast.error(res.error);
      }
      const sizes = (list: typeof plans) => list.map((p) => SIZE_LABELS[p.v.size]).join(", ");
      if (toSend.length) {
        toast.success(`${productName} önerisi yöneticiye gönderildi`, {
          description: `${variants.length > 1 ? `${sizes(toSend)}: ` : ""}onaylanınca reçete değişir. Sonucu bu sayfadaki “Önerilerim”de görürsünüz.`,
        });
      } else {
        toast.success(`${productName} önerisi geri çekildi`, { description: "Reçete bugünkü hâliyle kaldı." });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const sizeOptions = variants.map((x) => {
    const p = plans.find((pl) => pl.v.id === x.id)!;
    return {
      value: String(x.id),
      label: (
        <>
          {SIZE_LABELS[x.size]}
          {p.differsFromCurrent ? <span className="size-1.5 rounded-full bg-warn" aria-label="değişti" /> : null}
        </>
      ),
    };
  });

  return (
    <Dialog
      open
      onClose={requestClose}
      size="lg"
      title={`${productName} · değişiklik öner`}
      description="Yönetici onaylayınca reçete değişir; o zamana kadar herkes bugünkü reçeteyi görür."
      footer={
        askDiscard ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-soft">Yaptığınız değişiklikler gönderilmedi.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setAskDiscard(false)}>
                Düzenlemeye dön
              </Button>
              <Button variant="danger" onClick={onClose}>
                Göndermeden kapat
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button variant="ghost" onClick={requestClose} className="max-sm:h-11">
              Vazgeç
            </Button>
            <Button onClick={() => void submit()} disabled={busy || nothing} className="max-sm:h-11 max-sm:flex-1">
              {busy ? "Gönderiliyor…" : toSend.length ? "Onaya gönder" : toWithdraw.length ? "Öneriyi geri çek" : "Değişiklik yok"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 pb-2">
        {variants.length > 1 ? <Segmented label="Boy" value={active} onChange={setActive} options={sizeOptions} /> : null}
        {v.myPending ? (
          <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
            {SIZE_LABELS[v.size]} için bekleyen bir öneriniz var; pencere ondan başladı. Gönderirseniz öneri güncellenir, bugünkü reçeteye geri getirirseniz geri çekilir.
          </p>
        ) : null}

        <RecipeLinesEditor rows={rows} onChange={setRows} kit={recipeKit} idPrefix={`onr-${v.id}`} label={SIZE_LABELS[v.size]}>
          {plan.edited ? (
            <Button
              variant="ghost"
              onClick={() =>
                setState((s) => ({ ...s, [v.id]: { rows: toRows(v.myPending?.after ?? v.current), note: (v.myPending?.after ?? v.current).note ?? "" } }))
              }
            >
              <Undo2 size={15} /> Bu boydaki değişiklikleri geri al
            </Button>
          ) : null}
          {plan.differsFromCurrent ? (
            <Badge tone="amber" dot className="ml-auto">
              {[plan.diff.changed ? `${plan.diff.changed} değişti` : "", plan.diff.added ? `${plan.diff.added} eklendi` : "", plan.diff.removed ? `${plan.diff.removed} çıkarıldı` : "", plan.diff.note.changed ? "not değişti" : ""]
                .filter(Boolean)
                .join(" · ") || "sıra değişti"}
            </Badge>
          ) : null}
        </RecipeLinesEditor>

        <Field label="Hazırlama notu" htmlFor={`onr-not-${v.id}`} hint="Reçete kartının altında yazar (ör. “M = solo, L = doppio”).">
          <Textarea
            id={`onr-not-${v.id}`}
            value={state[v.id].note}
            onChange={(e) => setState((s) => ({ ...s, [v.id]: { ...s[v.id], note: e.target.value } }))}
            maxLength={1000}
            rows={2}
          />
        </Field>

        <FormulaHelp params={kit.params} />

        <Field label="Yöneticiye not (isteğe bağlı)" htmlFor="onr-mesaj" hint="Neden değişmeli? Ör. “bardak taşıyor”, “müşteriler az tatlı buluyor”.">
          <Textarea id="onr-mesaj" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
