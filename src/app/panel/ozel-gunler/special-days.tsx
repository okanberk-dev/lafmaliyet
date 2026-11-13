"use client";

import { CalendarHeart, CalendarPlus } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { toastUnreachable, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { STAFF_EFFECTS, STAFF_SPECIAL_KINDS } from "@/lib/closed-days";
import { rangeTR, shortRangeTR, type SpecialKind } from "@/lib/takvim";
import { SPECIAL_KIND_LABEL, SPECIAL_PAST_DAYS } from "@/lib/ozel-gun";
import { EFFECT_OPTIONS, specialTail } from "@/lib/ozel-gun";
import { cn } from "@/lib/utils";
import type { SpecialDayInput, SpecialDayValues } from "@/server/actions/special-days";
import type { ActionResult } from "@/server/actions/util";

/** Sayfaya giden özel gün (tahminin çekirdeğinden) */
export interface SpecialDayItem {
  id: number;
  kind: SpecialKind;
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: number;
  note: string | null;
  /** Personelin satırında ekleyenin adı ("Ahmet ekledi") */
  addedBy?: string | null;
  /** Kapalı günün şubesi (boş: işletme geneli) */
  branchId?: string | null;
  /** Birden çok fiziksel şube açıkken kapalı günün şubesi ekranda ("Tuzla", "Bütün şubeler") */
  branch?: string | null;
}

/** Kapalı gün için seçilebilen şube (birden çok fiziksel şube açıkken) */
export interface SpecialDayBranch {
  id: string;
  name: string;
}

/**
 * Pencerenin eylemleri (sayfa enjekte eder): yöneticide src/server/actions/special-days.ts, personelde
 * src/server/actions/special-days-staff.ts. Silme önceki değerleri dönerse bildirimde "Geri al" çıkar.
 */
export interface SpecialDayActions {
  saveAction: (input: SpecialDayInput & { id?: number }) => Promise<ActionResult<unknown>>;
  deleteAction: (id: number) => Promise<ActionResult<SpecialDayValues | null>>;
}

type Effect = SpecialDayValues["effect"];
interface Draft {
  id?: number;
  kind: SpecialKind;
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: Effect;
  note: string;
  /** Kapalı günün şubesi (boş: bütün şubeler) */
  branchId: string | null;
}

const KINDS: SpecialKind[] = ["derbi", "avm", "kampanya", "kapali", "diger"];
const EFFECTS = EFFECT_OPTIONS.map((o) => o.value as Effect);
/** Kayıtlı etkiyi formun seçeneğine (kapalıda −1: formda gösterilmez) */
const effectOf = (v: number): Effect => EFFECTS.find((e) => Math.abs(e - v) < 1e-9) ?? 0;

interface Ctx {
  openNew: (date?: string) => void;
  openEdit: (item: SpecialDayItem) => void;
}
const SpecialDayContext = createContext<Ctx | null>(null);

export function useSpecialDay(): Ctx {
  const ctx = useContext(SpecialDayContext);
  if (!ctx) throw new Error("SpecialDayProvider yok");
  return ctx;
}

/**
 * Özel gün penceresini sayfanın her yerinden açar (başlıktaki "Özel gün ekle", günün "Bu güne özel gün ekle"si,
 * listedeki satır). Pencere bir yere gitmez: kayıttan sonra sayfa sunucu eylemiyle yenilenir.
 */
export function SpecialDayProvider({
  today,
  minDate,
  maxDate,
  mode = "admin",
  branches = [],
  saveAction,
  deleteAction,
  children,
}: {
  today: string;
  minDate: string;
  maxDate: string;
  mode?: "admin" | "staff";
  /** Yönetici, birden çok fiziksel şube açıkken: kapalı günün şubesi seçilir (boş: bütün şubeler) */
  branches?: SpecialDayBranch[];
  children: ReactNode;
} & SpecialDayActions) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // Personel yarından itibaren girer (minDate yarın)
  const openNew = useCallback(
    (date?: string) => setDraft({ kind: "derbi", title: "", dateFrom: date ?? (mode === "staff" ? minDate : today), dateTo: "", effect: 0.15, note: "", branchId: null }),
    [today, minDate, mode],
  );
  const openEdit = useCallback(
    (d: SpecialDayItem) =>
      setDraft({
        id: d.id,
        kind: d.kind,
        title: d.title,
        dateFrom: d.dateFrom,
        dateTo: d.dateTo === d.dateFrom ? "" : d.dateTo,
        effect: effectOf(d.effect),
        note: d.note ?? "",
        branchId: d.branchId ?? null,
      }),
    [],
  );
  const value = useMemo(() => ({ openNew, openEdit }), [openNew, openEdit]);
  return (
    <SpecialDayContext.Provider value={value}>
      {children}
      {draft ? (
        <SpecialDayDialog
          key={draft.id ?? `yeni-${draft.dateFrom}`}
          draft={draft}
          minDate={minDate}
          maxDate={maxDate}
          mode={mode}
          branches={branches}
          saveAction={saveAction}
          deleteAction={deleteAction}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </SpecialDayContext.Provider>
  );
}

function SpecialDayDialog({
  draft,
  minDate,
  maxDate,
  mode,
  branches,
  saveAction,
  deleteAction,
  onClose,
}: { draft: Draft; minDate: string; maxDate: string; mode: "admin" | "staff"; branches: SpecialDayBranch[]; onClose: () => void } & SpecialDayActions) {
  const staff = mode === "staff";
  const kinds = staff ? (STAFF_SPECIAL_KINDS as readonly SpecialKind[]) : KINDS;
  const effects = staff ? EFFECT_OPTIONS.filter((o) => (STAFF_EFFECTS as readonly number[]).includes(o.value)) : EFFECT_OPTIONS;
  const [v, setV] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useActionTransition();
  const editing = draft.id !== undefined;
  const alertRef = useRef<HTMLDivElement>(null);
  // Telefonda form pencerenin içinde kayar: sunucunun reddi (aynı adla kayıt, eski gün) Kaydet'in arkasında kalmasın
  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => {
    setV((x) => ({ ...x, [k]: value }));
    setError(null);
  };

  function save() {
    if (!v.title.trim()) return setError("Ad gerekli");
    if (!v.dateFrom) return setError("Başlangıç gününü seçin");
    start(async () => {
      const r = await saveAction({
        id: v.id,
        kind: v.kind,
        title: v.title,
        dateFrom: v.dateFrom,
        dateTo: v.dateTo || null,
        effect: v.kind === "kapali" ? 0 : v.effect,
        note: v.note,
        ...(v.kind === "kapali" ? { branchId: v.branchId } : {}),
      });
      if (!r.ok) return void setError(r.error);
      onClose();
      toast.success(editing ? "Özel gün güncellendi" : `Özel gün eklendi: ${rangeTR(v.dateFrom, v.dateTo || v.dateFrom)} · ${v.title.trim()}`);
    });
  }

  function remove() {
    if (!v.id) return;
    const id = v.id;
    start(async () => {
      const r = await deleteAction(id);
      if (!r.ok) return void setError(r.error);
      onClose();
      const prev = r.data;
      if (!prev) return void toast.success("Özel gün silindi");
      toast.success("Özel gün silindi", {
        duration: 10_000,
        action: {
          label: "Geri al",
          onClick: async () => {
            try {
              const x = await saveAction({ ...prev, dateTo: prev.dateTo });
              if (x.ok) toast.success("Özel gün geri alındı");
              else toast.error(x.error);
            } catch (e) {
              toastUnreachable(e);
            }
          },
        },
      });
    });
  }

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      title={editing ? "Özel günü düzenle" : "Özel gün ekle"}
      description={
        staff
          ? "Tahmin ve tatlı sayısı bu günlere göre ayarlanır. Yarından 60 gün ileriye, en çok 3 gün; ad bütün ekibe görünür."
          : `Yaklaşan günleri işaretleyin; son ${SPECIAL_PAST_DAYS} gün içindeki geçmiş bir günü de yazabilirsiniz.`
      }
      footerStart={
        editing ? (
          <Button variant="ghost" className="text-bad hover:text-bad" onClick={remove} disabled={pending}>
            Sil
          </Button>
        ) : null
      }
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Ne var?" htmlFor="ozel-tur">
          <Select id="ozel-tur" value={v.kind} onChange={(e) => set("kind", e.target.value as SpecialKind)} className="pointer-coarse:h-12">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {SPECIAL_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ad" htmlFor="ozel-ad" hint={staff ? undefined : "Ad personele görünür; müşteri adı ya da tutar yazmayın."}>
          <Input
            id="ozel-ad"
            value={v.title}
            maxLength={60}
            placeholder={v.kind === "kapali" ? "Tadilat" : "Fenerbahçe – Galatasaray maçı"}
            onChange={(e) => set("title", e.target.value)}
            className="pointer-coarse:h-12"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Başlangıç" htmlFor="ozel-bas">
            {/* Düzenlenen kaydın başlangıcı sınırdan eskiyse (bitişi son 60 günde) Enter'la kayıt tarayıcıda takılmasın */}
            <Input id="ozel-bas" type="date" value={v.dateFrom} min={draft.dateFrom && draft.dateFrom < minDate ? draft.dateFrom : minDate} max={maxDate} onChange={(e) => set("dateFrom", e.target.value)} className="pointer-coarse:h-12" />
          </Field>
          <Field label="Bitiş" htmlFor="ozel-bit" hint="Boşsa aynı gün">
            <Input id="ozel-bit" type="date" value={v.dateTo} min={v.dateFrom || minDate} max={maxDate} onChange={(e) => set("dateTo", e.target.value)} className="pointer-coarse:h-12" />
          </Field>
        </div>
        {v.kind === "kapali" && !staff && branches.length > 1 ? (
          <Field label="Şube" htmlFor="ozel-sube" hint="Yalnız bir şube kapalıysa onu seçin; öteki şubenin kasası açık sayılır.">
            <Select id="ozel-sube" value={v.branchId ?? ""} onChange={(e) => set("branchId", e.target.value || null)} className="pointer-coarse:h-12">
              <option value="">Bütün şubeler</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {v.kind === "kapali" ? (
          <p className="rounded-xl bg-panel px-3 py-2.5 text-[13px] text-ink-mute">Kapalı günün tahmini 0; kişi ve tatlı önerisi çıkmaz.</p>
        ) : (
          <Field label="Satışa etkisi" htmlFor="ozel-etki">
            <Select id="ozel-etki" value={String(v.effect)} onChange={(e) => set("effect", Number(e.target.value) as Effect)} className="pointer-coarse:h-12">
              {effects.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Not" htmlFor="ozel-not" hint="İsteğe bağlı">
          <Textarea id="ozel-not" value={v.note} maxLength={200} rows={2} onChange={(e) => set("note", e.target.value)} />
        </Field>
        {error ? (
          <Notice ref={alertRef} tone="bad" size="sm" live="assertive" className="scroll-my-3" title={error} />
        ) : null}
        {/* Enter ile gönderim (düğmeler pencerenin altbilgisinde) */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** Başlıktaki "Özel gün ekle" */
export function AddSpecialDayHeaderButton() {
  const { openNew } = useSpecialDay();
  return (
    <Button onClick={() => openNew()}>
      <CalendarPlus size={16} aria-hidden="true" />
      Özel gün ekle
    </Button>
  );
}

/** Günün ayrıntısındaki "Bu güne özel gün ekle" */
export function AddSpecialDayButton({ date }: { date: string }) {
  const { openNew } = useSpecialDay();
  return (
    <Button variant="ghost" size="sm" className="-ml-2 px-2 text-ink-soft" onClick={() => openNew(date)}>
      <CalendarPlus size={15} aria-hidden="true" />
      Bu güne özel gün ekle
    </Button>
  );
}

function Row({ item, past }: { item: SpecialDayItem; past?: boolean }) {
  // Personelin satırı "Ahmet ekledi" (yöneticinin listesinde)
  const { openEdit } = useSpecialDay();
  return (
    <li>
      <button
        type="button"
        onClick={() => openEdit(item)}
        className={cn(
          "flex min-h-11 w-full cursor-pointer flex-col items-start rounded-xl px-3 py-2 text-left transition-colors hover:bg-ink/[0.04] focus-visible:bg-ink/[0.06] focus-visible:outline-none",
          past && "opacity-70",
        )}
        aria-label={`${item.title}, ${shortRangeTR(item.dateFrom, item.dateTo)}: düzenle`}
      >
        <span className="text-sm font-medium break-words text-ink">{item.title}</span>
        <span className="text-[13px] text-ink-mute">
          {shortRangeTR(item.dateFrom, item.dateTo)} · {specialTail(item)}
          {item.branch ? ` · ${item.branch}` : ""}
          {item.addedBy ? ` · ${item.addedBy} ekledi` : ""}
        </span>
      </button>
    </li>
  );
}

/** Kart "Özel günler": bütün yaklaşanlar ve son 60 günde bitenler; satıra dokununca düzenlenir */
export function SpecialDaysCard({ upcoming, past }: { upcoming: SpecialDayItem[]; past: SpecialDayItem[] }) {
  const { openNew } = useSpecialDay();
  return (
    <Card id="ozel-gunler" className="scroll-mt-24">
      <CardHeader
        icon={<CalendarHeart />}
        title="Özel günler"
        description="Derbi, AVM etkinliği, kampanya ya da kapalı gün: takvim notu olarak işaretlenir."
        actions={<AddSpecialDayHeaderButton />}
      />
      <CardContent className="space-y-3">
        {upcoming.length ? (
          <ul className="-mx-1 rounded-2xl bg-surface p-1 ring-1 ring-line">
            {upcoming.map((d) => (
              <Row key={d.id} item={d} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-mute">{past.length ? "Yaklaşan özel gün yok." : "Henüz özel gün yok. Maç, AVM etkinliği ya da kampanya olacaksa ekleyin."}</p>
        )}
        {past.length ? (
          <div>
            <p className="mb-1 text-[13px] font-medium text-ink-mute">Geçmiş (son {SPECIAL_PAST_DAYS} gün)</p>
            <ul className="-mx-1">
              {past.map((d) => (
                <Row key={d.id} item={d} past />
              ))}
            </ul>
          </div>
        ) : null}
        <Button variant="secondary" size="sm" onClick={() => openNew()}>
          <CalendarPlus size={15} aria-hidden="true" />
          Ekle
        </Button>
      </CardContent>
    </Card>
  );
}
