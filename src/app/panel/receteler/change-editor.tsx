"use client";

import { ArrowDown, ArrowUp, Plus, StickyNote, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import type { Settings } from "@/lib/calc/types";
import { DEFAULT_SETTINGS, SIZE_LABELS } from "@/lib/constants";
import { num } from "@/lib/format";
import { diffRecipe, sameRecipe, type RecipeSnapshot } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import { proposeRecipeChanges, withdrawRecipeChange } from "@/server/actions/recipe-requests";

import { catOrder } from "../hammaddeler/categories";
import { qtyText, resolveQty } from "../urunler/logic";

export interface ProposeKit {
  ingredients: { id: number; name: string; unit: string; category: string; active: boolean; packaging: boolean }[];
  /** Formüllerde kullanılan ölçüler (ShotCift = 18 gr …); yalnızca bunlar gönderilir */
  params: { name: string; key: string; label: string; unit: string; value: number }[];
}

export interface EditorVariant {
  id: number;
  size: "M" | "L" | "Tek";
  /** Onaylı (bugünkü) reçete */
  current: RecipeSnapshot;
  /** Kişinin bekleyen önerisi (varsa pencere ondan başlar) */
  myPending: { id: number; after: RecipeSnapshot } | null;
}

interface Row {
  key: number;
  ingredientId: number | null;
  input: string;
  note: string;
  noteOpen: boolean;
}

let seq = 1;
const toRows = (snap: RecipeSnapshot): Row[] =>
  snap.items.map((l) => ({ key: seq++, ingredientId: l.ingredientId, input: qtyText(l.qty, l.qtyExpr), note: l.note ?? "", noteOpen: Boolean(l.note) }));

/**
 * Personelin reçete değişiklik önerisi: boy boy malzeme, miktar (sayı ya da 2*ShotCift gibi formül), satır notu ve
 * hazırlama notu. Fiyat ve maliyet burada yoktur. "Onaya gönder" yalnız gerçekten değişen boyları yollar; yönetici
 * onaylayınca reçete değişir. Bekleyen önerisi olan boy ondan başlar; bugünkü hâline geri getirilirse öneri geri çekilir.
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
  const settings = useMemo(() => {
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const p of kit.params) out[p.key] = p.value;
    return out as unknown as Settings;
  }, [kit.params]);
  const ingById = useMemo(() => new Map(kit.ingredients.map((i) => [i.id, i])), [kit.ingredients]);
  const grouped = useMemo(() => {
    const m = new Map<string, ProposeKit["ingredients"]>();
    for (const i of kit.ingredients) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()]
      .sort(([a], [b]) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr"))
      .map(([cat, list]) => [cat, [...list].sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
  }, [kit.ingredients]);

  const [active, setActive] = useState(String(variants[0].id));
  const [state, setState] = useState(() =>
    Object.fromEntries(variants.map((v) => [v.id, { rows: toRows(v.myPending?.after ?? v.current), note: (v.myPending?.after ?? v.current).note ?? "" }])),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  /** Satırlardan kaydedilecek reçete; okunamayan satır varsa hata */
  function build(v: EditorVariant): { snap: RecipeSnapshot; error: string | null } {
    const st = state[v.id];
    let error: string | null = null;
    const items = st.rows.map((r, i) => {
      const ing = r.ingredientId ? ingById.get(r.ingredientId) : undefined;
      const q = resolveQty(r.input, settings);
      if (!error && !ing) error = `${SIZE_LABELS[v.size]}: ${i + 1}. satırda malzeme seçin`;
      if (!error && q.error) error = `${SIZE_LABELS[v.size]} · ${ing?.name ?? `${i + 1}. satır`}: ${q.error}`;
      return { ingredientId: ing?.id ?? 0, name: ing?.name ?? "?", unit: ing?.unit ?? "", qty: q.qty, qtyExpr: q.expr, note: r.note.trim() || null };
    });
    return { snap: { note: st.note.trim() || null, items }, error };
  }

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
  const setRows = (fn: (rows: Row[]) => Row[]) => setState((s) => ({ ...s, [v.id]: { ...s[v.id], rows: fn(s[v.id].rows) } }));
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (idx: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = idx + d;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

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

        <ul className="space-y-2" aria-label={`${SIZE_LABELS[v.size]} malzemeleri`}>
          {rows.map((r, idx) => {
            const ing = r.ingredientId ? ingById.get(r.ingredientId) : undefined;
            const q = resolveQty(r.input, settings);
            const hintId = `onr-${v.id}-${r.key}`;
            return (
              <li key={r.key} className="rounded-2xl bg-panel p-2.5 ring-1 ring-line">
                <div className="flex items-start gap-2">
                  <Select
                    value={r.ingredientId ?? ""}
                    onChange={(e) => update(r.key, { ingredientId: e.target.value ? Number(e.target.value) : null })}
                    aria-label={`${idx + 1}. satır malzemesi`}
                    data-warn={!r.ingredientId ? "true" : undefined}
                    className="min-w-0 flex-1 font-medium"
                  >
                    <option value="">Malzeme seçin…</option>
                    {grouped.map(([cat, list]) => (
                      <optgroup key={cat} label={cat}>
                        {list.map((i) => (
                          <option key={i.id} value={i.id} disabled={!i.active && i.id !== r.ingredientId}>
                            {i.name}
                            {i.active ? "" : " (pasif)"}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <IconButton
                    label={`${ing?.name ?? `${idx + 1}. satır`} satırını çıkar`}
                    tone="danger"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="size-9"
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={r.input}
                      onChange={(e) => update(r.key, { input: e.target.value })}
                      inputMode={/[a-zA-Z*]/.test(r.input) ? "text" : "decimal"}
                      autoComplete="off"
                      aria-label={`${ing?.name ?? `${idx + 1}. satır`} miktarı`}
                      aria-invalid={q.error ? true : undefined}
                      aria-describedby={hintId}
                      placeholder="0"
                      className="w-32 text-right tabular"
                    />
                    <span className="min-w-8 text-[13px] text-ink-mute">{ing?.unit ?? ""}</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <IconButton label="Yukarı taşı" disabled={idx === 0} onClick={() => move(idx, -1)}>
                      <ArrowUp size={15} />
                    </IconButton>
                    <IconButton label="Aşağı taşı" disabled={idx === rows.length - 1} onClick={() => move(idx, 1)}>
                      <ArrowDown size={15} />
                    </IconButton>
                    <IconButton label={r.noteOpen ? "Satır notunu gizle" : "Satır notu ekle"} onClick={() => update(r.key, { noteOpen: !r.noteOpen })} className={cn(r.note && "text-ink")}>
                      <StickyNote size={15} />
                    </IconButton>
                  </div>
                </div>
                <p id={hintId} className={cn("mt-1 text-xs", q.error ? "text-bad" : "text-ink-mute")}>
                  {q.error ?? (q.expr ? `= ${num(q.qty, 3)} ${ing?.unit ?? ""}` : q.echo ? `${q.echo} olarak okundu` : "")}
                </p>
                {r.noteOpen ? (
                  <Input
                    value={r.note}
                    onChange={(e) => update(r.key, { note: e.target.value })}
                    maxLength={300}
                    placeholder="Satır notu (ör. sıcak sütle)"
                    aria-label={`${ing?.name ?? `${idx + 1}. satır`} notu`}
                    className="mt-2"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setRows((rs) => [...rs, { key: seq++, ingredientId: null, input: "", note: "", noteOpen: false }])}>
            <Plus size={15} /> Malzeme ekle
          </Button>
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
        </div>

        <Field label="Hazırlama notu" htmlFor={`onr-not-${v.id}`} hint="Reçete kartının altında yazar (ör. “M = solo, L = doppio”).">
          <Textarea
            id={`onr-not-${v.id}`}
            value={state[v.id].note}
            onChange={(e) => setState((s) => ({ ...s, [v.id]: { ...s[v.id], note: e.target.value } }))}
            maxLength={1000}
            rows={2}
          />
        </Field>

        <details className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] text-ink-mute">
          <summary className="cursor-pointer font-medium text-ink-soft">Formüller (ShotCift, Pompa…)</summary>
          <p className="mt-1.5">Miktara sayı ya da formül yazılabilir: “2*ShotCift”, “Pompa*3”. Ölçüler Ayarlar&apos;dan gelir:</p>
          <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {kit.params.map((p) => (
              <li key={p.name}>
                <code className="font-mono text-info">{p.name}</code> = {num(p.value, 2)} {p.unit} · {p.label}
              </li>
            ))}
          </ul>
        </details>

        <Field label="Yöneticiye not (isteğe bağlı)" htmlFor="onr-mesaj" hint="Neden değişmeli? Ör. “bardak taşıyor”, “müşteriler az tatlı buluyor”.">
          <Textarea id="onr-mesaj" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}
