"use client";

import { Gift, Plus, Search, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { parseNumberTR } from "@/lib/calc/expr";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { matchesChoice, qtyText, WASTE_KIND_LABEL, WASTE_REASONS, type WasteChoice, type WasteKind } from "@/lib/waste";
import { addWasteEntry, deleteWasteEntry } from "@/server/actions/waste";
import type { WasteEntryDTO } from "@/server/data/waste";

const MAX_RESULTS = 8;

/**
 * Zayi / ikram girişi ve günün listesi. Ürün ya da hammadde aranıp seçilir (ürün adetle, hammadde sayım biriminde),
 * neden tek dokunuşla; kayıt anında listeye düşer. Personel kendi kaydını o gün siler, yönetici her kaydı.
 */
export function WasteBoard({
  date,
  choices,
  entries,
  meId,
  admin,
}: {
  date: string;
  choices: WasteChoice[];
  entries: WasteEntryDTO[];
  meId: number;
  admin: boolean;
}) {
  const [kind, setKind] = useState<WasteKind>("zayi");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<WasteChoice | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [removing, setRemoving] = useState<WasteEntryDTO | null>(null);

  const results = query.trim() ? choices.filter((c) => matchesChoice(c, query)).slice(0, MAX_RESULTS) : [];
  // Son girilen kalemler: aynı şey çoğu gün tekrar eder (bir dokunuşla seçilsin)
  const recent = [...new Map(entries.map((e) => [`${e.type}:${e.name}`, e])).values()]
    .map((e) => choices.find((c) => c.name === e.name && (c.type === e.type)))
    .filter((c): c is WasteChoice => Boolean(c))
    .slice(0, 6);

  function choose(c: WasteChoice) {
    setPicked(c);
    setQuery("");
    setQty(c.type === "product" ? "1" : "");
    window.setTimeout(() => document.getElementById("zi-miktar")?.focus(), 0);
  }

  function submit() {
    if (!picked) return void toast.error("Önce ürün ya da hammadde seçin");
    const n = parseNumberTR(qty);
    if (n === null || n <= 0) return void toast.error("Miktarı yazın (ör. 1 ya da 0,5)");
    start(async () => {
      const res = await addWasteEntry({
        date,
        kind,
        productId: picked.type === "product" ? picked.id : null,
        ingredientId: picked.type === "ingredient" ? picked.id : null,
        qty: n,
        reason,
        note: note.trim() || null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${WASTE_KIND_LABEL[kind]}: ${res.data.name} ${qtyText(n, res.data.unit)}`);
      setPicked(null);
      setQty("1");
      setNote("");
      setReason(null);
    });
  }

  function remove() {
    if (!removing) return;
    start(async () => {
      const res = await deleteWasteEntry(removing.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Kayıt silindi");
      setRemoving(null);
    });
  }

  const counts = { zayi: entries.filter((e) => e.kind === "zayi").length, ikram: entries.filter((e) => e.kind === "ikram").length };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader icon={<Gift />} title="Yeni kayıt" description={`${longDateTR(date)} · ödenmeyen ve atılan her şey`} />
        <div className="space-y-4 px-5 pb-5">
          <Segmented<WasteKind>
            label="Kayıt türü"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setReason(null);
            }}
            options={[
              { value: "zayi", label: "Zayi (atıldı, bozuldu)" },
              { value: "ikram", label: "İkram (ödenmedi)" },
            ]}
          />
          {picked ? (
            <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{picked.name}</p>
                <p className="text-xs text-ink-mute">
                  {picked.type === "product" ? "Menü ürünü · malzemesi reçeteden düşer" : `Hammadde · ${picked.group}`}
                </p>
              </div>
              <IconButton label="Başka kalem seç" onClick={() => setPicked(null)}>
                <X size={16} />
              </IconButton>
            </div>
          ) : (
            <div className="space-y-2">
              <Field label="Ürün ya da hammadde" htmlFor="zi-ara">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                  <Input
                    id="zi-ara"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && results[0]) {
                        e.preventDefault();
                        choose(results[0]);
                      }
                    }}
                    placeholder="ör. latte, süt, kruvasan"
                    className="pl-9"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </div>
              </Field>
              {results.length ? (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line" aria-label="Arama sonuçları">
                  {results.map((c) => (
                    <li key={`${c.type}:${c.id}`}>
                      <button type="button" onClick={() => choose(c)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-panel pointer-coarse:py-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.name}</span>
                        <span className="shrink-0 text-xs text-ink-mute">{c.type === "product" ? c.group : `${c.group} · ${c.unit}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="text-sm text-ink-mute">Eşleşen ürün ya da hammadde yok.</p>
              ) : recent.length ? (
                <div className="flex flex-wrap gap-2" aria-label="Son girilenler">
                  {recent.map((c) => (
                    <button
                      key={`${c.type}:${c.id}`}
                      type="button"
                      onClick={() => choose(c)}
                      className="cursor-pointer rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-soft ring-1 ring-line hover:text-ink pointer-coarse:py-2.5"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={`Miktar${picked ? ` (${picked.unit})` : ""}`} htmlFor="zi-miktar">
              <NumberInput
                id="zi-miktar"
                inputMode={picked?.type === "product" ? "numeric" : "decimal"}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                enterKeyHint="done"
              />
            </Field>
            <Field label="Not" htmlFor="zi-not" hint="isteğe bağlı">
              <Input id="zi-not" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === "ikram" ? "ör. masa 4, doğum günü" : "ör. son kullanma tarihi"} autoComplete="off" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Neden">
            {WASTE_REASONS[kind].map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(reason === r ? null : r)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition-colors pointer-coarse:py-2.5",
                  reason === r ? "bg-ink text-white ring-ink" : "bg-surface text-ink-soft ring-line hover:text-ink",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Button size="lg" className="w-full" onClick={submit} disabled={pending || !picked}>
            <Plus size={16} /> {pending ? "Kaydediliyor…" : `${WASTE_KIND_LABEL[kind]} olarak kaydet`}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={longDateTR(date)}
          description={entries.length ? `${counts.zayi} zayi · ${counts.ikram} ikram` : "Bu gün kayıt yok"}
        />
        {entries.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {entries.map((e) => {
              const canDelete = admin || e.createdBy === meId;
              return (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                  <Badge tone={e.kind === "zayi" ? "red" : "blue"}>{WASTE_KIND_LABEL[e.kind]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words text-ink">
                      {e.name} <span className="font-normal text-ink-mute tabular">· {qtyText(e.qty, e.unit)}</span>
                    </p>
                    <p className="text-xs break-words text-ink-mute">
                      {[e.reason, e.note, e.createdByName, new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(e.createdAt))]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {canDelete ? (
                    <IconButton label={`${e.name} kaydını sil`} tone="danger" onClick={() => setRemoving(e)} disabled={pending}>
                      <Trash2 size={15} />
                    </IconButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-6 text-sm text-ink-mute">Atılan ya da ikram edilen her şeyi buraya girin; ay sonu stok farkı böyle açıklanır.</p>
        )}
      </Card>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        pending={pending}
        title={removing ? `${removing.name} kaydı silinsin mi?` : "Kayıt silinsin mi?"}
        description="Yanlış girildiyse silin; stok tutarlılığından da çıkar."
        confirmLabel="Sil"
      />
    </div>
  );
}
