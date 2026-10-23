"use client";

import { Check, ChevronDown, Plus, SearchX } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { matches } from "@/components/ui/filters";
import { fieldControl, SearchInput } from "@/components/ui/form";
import { cleanName, COUNT_ITEM_NAME_MIN, nameKey } from "@/lib/count-item";
import { cn } from "@/lib/utils";
import { addProposalIngredient } from "@/server/actions/recipe-requests";

import { CountItemFields, useCountItemForm } from "../sayim/add-item";

import type { ProposeKit, RecipeKit } from "./recipe-lines";

type Ingredient = ProposeKit["ingredients"][number];

/**
 * Reçete önerisindeki malzeme seçimi (Yeni ürün öner ve Değişiklik öner): alan gibi görünen düğme, dokununca arama
 * kutulu liste açılır (malzemeler kategori kategori). Aranan malzeme listede yoksa “Listede yok: “…” ekle” ile
 * formdan çıkmadan "Yeni malzeme" açılır: Stok sayımı › Listeye ekle'nin alanları ve kuralı (sunucuda aynı çekirdek),
 * eklenen malzeme bu satıra seçilir. Pasif malzeme yeni satıra seçilemez, satırda duruyorsa kalır. Fiyat ve maliyet
 * gösterilmez.
 */
export function IngredientPicker({
  value,
  onChange,
  kit,
  label,
  className,
}: {
  value: number | null;
  onChange: (id: number) => void;
  kit: RecipeKit;
  /** Ekran okuyucu etiketi ("1. satır malzemesi") */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = value ? kit.ingById.get(value) : undefined;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={chosen ? `${label}: ${chosen.name}` : label}
        data-warn={!chosen ? "true" : undefined}
        onClick={() => setOpen(true)}
        className={cn(fieldControl, "flex h-9 cursor-pointer items-center gap-2 text-left pointer-coarse:h-11", className)}
      >
        <span className={cn("min-w-0 flex-1 truncate", chosen ? "font-medium text-ink" : "text-ink-quiet")}>
          {chosen ? `${chosen.name}${chosen.active ? "" : " (pasif)"}` : "Malzeme seçin…"}
        </span>
        <ChevronDown size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
      </button>
      {open ? (
        <PickerDialog
          kit={kit}
          value={value}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Arama kutusu ve listedeki seçenekler arasında ok tuşlarıyla gezinme */
function moveFocus(list: HTMLElement | null, from: Element | null, dir: 1 | -1): HTMLElement | null {
  const items = [...(list?.querySelectorAll<HTMLElement>("[data-option]:not(:disabled)") ?? [])];
  if (!items.length) return null;
  const at = from ? items.indexOf(from as HTMLElement) : -1;
  const next = at < 0 ? (dir > 0 ? items[0] : items.at(-1)) : items[at + dir];
  next?.focus();
  return next ?? null;
}

function PickerDialog({ kit, value, onPick, onClose }: { kit: RecipeKit; value: number | null; onPick: (id: number) => void; onClose: () => void }) {
  const formId = useId();
  const searchId = useId();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "new">("list");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const query = cleanName(q);
  const visible = useMemo(
    () => kit.grouped.map(([cat, list]) => [cat, list.filter((i) => matches(`${i.name} ${cat}`, q))] as const).filter(([, list]) => list.length),
    [kit.grouped, q],
  );
  const firstMatch = visible.flatMap(([, list]) => list).find((i) => i.active || i.id === value);
  // Aynı ad listede varsa (Türkçe büyük/küçük harf farkı gözetmeden) "ekle" çıkmaz: o malzeme listededir
  const exact = query ? kit.ingredients.some((i) => nameKey(i.name) === nameKey(query)) : false;
  const canAdd = kit.newIngredient !== null && query.length >= COUNT_ITEM_NAME_MIN && !exact;

  function pick(i: Ingredient) {
    if (!i.active && i.id !== value) return;
    onPick(i.id);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(listRef.current, null, 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (firstMatch) pick(firstMatch);
      else if (canAdd) setView("new");
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const moved = moveFocus(listRef.current, document.activeElement, e.key === "ArrowDown" ? 1 : -1);
    // İlk seçenekten yukarı: arama kutusuna döner
    if (!moved && e.key === "ArrowUp") document.getElementById(searchId)?.focus();
  }

  const addButton = (prominent: boolean) =>
    canAdd ? (
      <Button data-option variant={prominent ? "primary" : "ghost"} onClick={() => setView("new")} className={cn("w-full justify-start text-left", prominent && "justify-center")}>
        <Plus size={16} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 break-words">Listede yok: “{query}” ekle</span>
      </Button>
    ) : null;

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={view === "new" ? "Yeni malzeme" : "Malzeme seç"}
      description={view === "new" ? "Listede olmayan malzeme hemen açılır ve stok sayımı listesine de girer." : undefined}
      footer={
        view === "new" ? (
          <>
            <Button variant="ghost" onClick={() => setView("list")} disabled={busy} className="max-sm:h-11">
              Geri
            </Button>
            <Button type="submit" form={formId} disabled={busy} className="max-sm:h-11 max-sm:flex-1">
              {busy ? "Ekleniyor…" : "Ekle ve seç"}
            </Button>
          </>
        ) : undefined
      }
    >
      {view === "new" && kit.newIngredient ? (
        <NewIngredientForm
          formId={formId}
          kit={kit}
          newIngredient={kit.newIngredient}
          initialName={query}
          busy={busy}
          setBusy={setBusy}
          onPick={(i, created) => {
            kit.addIngredient(i);
            onPick(i.id);
            if (created) toast.success(`“${i.name}” eklendi ve seçildi`, { description: "Stok sayımı listesine de eklendi." });
          }}
        />
      ) : (
        <div className="pb-2" onKeyDown={onListKey} ref={listRef}>
          {/* Arama kutusu liste kayarken üstte kalır (pencerenin üst boşluğuna taşar, altından kayan satır görünmez) */}
          <div className="sticky top-0 z-10 -mx-1 -mt-3 bg-surface px-1 pt-3 pb-2">
            <SearchInput
              id={searchId}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Malzeme ara"
              aria-label="Malzeme ara"
              autoComplete="off"
              enterKeyHint="search"
              data-autofocus="always"
            />
          </div>
          {visible.length ? (
            <div className="space-y-2">
              {visible.map(([cat, list]) => (
                <section key={cat} aria-label={cat}>
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-mute">{cat}</p>
                  <ul>
                    {list.map((i) => {
                      const selected = i.id === value;
                      return (
                        <li key={i.id}>
                          <button
                            type="button"
                            data-option
                            disabled={!i.active && !selected}
                            aria-current={selected ? "true" : undefined}
                            onClick={() => pick(i)}
                            className={cn(
                              "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-ink hover:bg-panel focus-visible:bg-panel focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-quiet disabled:hover:bg-transparent pointer-coarse:min-h-11 pointer-coarse:text-base",
                              selected && "bg-panel font-medium",
                            )}
                          >
                            <span className="min-w-0 flex-1 break-words">
                              {i.name}
                              {i.active ? "" : " (pasif)"}
                            </span>
                            <span className="shrink-0 text-xs text-ink-mute">{i.unit}</span>
                            {selected ? <Check size={15} className="shrink-0 text-ink" aria-hidden="true" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {canAdd ? <div className="border-t border-line pt-2">{addButton(false)}</div> : null}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
              <SearchX size={22} className="text-ink-quiet" aria-hidden="true" />
              <p className="text-sm text-ink-soft">{query ? `“${query}” listede bulunamadı.` : "Listede malzeme yok."}</p>
              {canAdd ? <div className="w-full max-w-sm">{addButton(true)}</div> : null}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * "Yeni malzeme": Listeye ekle'nin alanları; grup boş başlar (reçetede hangi sayım grubunda durduğu bilinmez). Aynı ad
 * listede varsa eklenmez, "Onu seç" ile var olan seçilir. Sunucu aynı adı başka biri az önce eklediyse de onu döndürür.
 */
function NewIngredientForm({
  formId,
  kit,
  newIngredient,
  initialName,
  busy,
  setBusy,
  onPick,
}: {
  formId: string;
  kit: RecipeKit;
  newIngredient: NonNullable<RecipeKit["newIngredient"]>;
  initialName: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** `created`: yeni açıldı (yoksa var olan seçildi) */
  onPick: (i: Ingredient, created: boolean) => void;
}) {
  const form = useCountItemForm({ groups: newIngredient.groups, defaultGroup: null, initialName, requireGroup: true, formId });
  // Sunucunun bulduğu aynı adlı malzeme (sayfa açıldıktan sonra başkası eklediyse)
  const [found, setFound] = useState<Ingredient | null>(null);
  const key = nameKey(form.name);
  const same = key ? (kit.ingredients.find((i) => nameKey(i.name) === key) ?? (found && nameKey(found.name) === key ? found : undefined)) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (same) return form.focusName();
    const values = form.validate();
    if (!values) return;
    setBusy(true);
    form.setError(null);
    try {
      const res = await addProposalIngredient({ month: newIngredient.month, ...values });
      if (!res.ok) return form.setError(res.error);
      if (res.data.existing) return setFound(res.data.ingredient);
      onPick(res.data.ingredient, true);
    } catch {
      form.setError("Eklenemedi: bağlantı yok gibi. Bağlantı gelince yeniden deneyin.");
    } finally {
      setBusy(false);
    }
  }

  const notice = same ? (
    same.active ? (
      <>
        “{same.name}” listede var.{" "}
        <button type="button" onClick={() => onPick(same, false)} className="cursor-pointer font-semibold text-ink underline underline-offset-2 pointer-coarse:py-2">
          Onu seç
        </button>
      </>
    ) : (
      `“${same.name}” pasif; yönetici Hammaddeler'den yeniden açabilir.`
    )
  ) : undefined;

  return (
    <form id={formId} onSubmit={submit} className="space-y-4 pb-3" noValidate>
      <CountItemFields form={form} nameNotice={notice} priceHint="Bilmiyorsanız boş bırakın; yönetici girer." />
    </form>
  );
}
