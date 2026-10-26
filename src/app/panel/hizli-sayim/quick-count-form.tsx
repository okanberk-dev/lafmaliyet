"use client";

import { ClipboardPen, PackageCheck, Save } from "lucide-react";
import Link from "next/link";
import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { STALE_TEXT } from "@/components/ui/action-error";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingBar } from "@/components/ui/floating-bar";
import { NumberInput } from "@/components/ui/form";
import { useLeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState } from "@/components/ui/misc";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, num } from "@/lib/format";
import { countQty } from "@/lib/reorder/levels";
import { qtyLabel } from "@/lib/reorder/message";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { markOrderReceived, saveQuickCounts } from "@/server/actions/reorder";
import type { QuickCountItem, QuickCountSheet } from "@/server/data/reorder";

import { countDraftJson, countText, draftConflicts, mergeCounts, parseCount, parseCountDraft, unusualCount } from "../sayim/logic";

/** "09:42" (Türkiye) */
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** Enter ile sıradaki kutuya (telefonda klavyenin "İleri" tuşu); sonuncuda klavye kapanır (Stok sayımı ile aynı) */
function focusNext(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input[data-qc-input]")];
  const next = inputs[inputs.indexOf(e.currentTarget) + 1];
  if (!next) return e.currentTarget.blur();
  next.focus({ preventScroll: true });
  next.select();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  next.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

const noopSubscribe = () => () => {};
function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

const savedValues = (items: QuickCountItem[]) => Object.fromEntries(items.map((i) => [i.id, i.today ? countText(i.today.qty) : ""])) as Record<number, string>;

/** Kutudaki miktar, kaydedileceği gibi 3 basamağa yuvarlı (kayıttan sonra kutu kayıtla tutsun) */
const readBox = (raw: string, unit: string) => countQty(parseCount(raw, unit, parseNumberTR));

/**
 * Hızlı sayım formu (docs/MAL-SIPARISI.md): kalemler sayım gruplarında (Stok sayımı'nın raf sırası), kutu sayım
 * biriminde. Önce gelen siparişler "Geldi" işaretlenir (işaretlenmezse sipariş listesinde ikinci kez sayılır). Kayıt
 * yalnız değişen kalemleri gönderir; boşaltılan kutu bugünkü sayımı siler. Fiyat ya da tutar yok (personel de açar).
 */
export function QuickCountForm({ sheet, admin, me = null }: { sheet: QuickCountSheet; admin: boolean; me?: string | null }) {
  const router = useRouter();
  const all = sheet.groups.flatMap((g) => g.items);
  const [values, setValues] = useState(() => savedValues(all));
  /** Bu kişi yazarken başkasının da kaydettiği kalemler (kaydederse onunkinin yerine geçer) */
  const [conflicts, setConflicts] = useState<ReadonlySet<number>>(() => new Set());
  // Sunucudan yeni sayım gelince (kendi kaydı, başkasının kaydı) dokunulmayan kutular yeni değeri alır
  const [synced, setSynced] = useState(sheet);
  if (synced !== sheet) {
    const byId = (s: QuickCountSheet) => new Map(s.groups.flatMap((g) => g.items.map((i) => [i.id, i.today?.qty ?? null] as const)));
    const merged = mergeCounts(values, byId(synced), byId(sheet), (id, raw) => readBox(raw, all.find((i) => i.id === id)?.countUnit ?? ""));
    setSynced(sheet);
    setValues(merged.values);
    setConflicts(new Set(merged.conflicts));
  }
  const [busy, setBusy] = useState(false);
  /** Kayıt başarılı, sunucudan yenilenmiş veri bekleniyor: bu arada kaydetme çubuğu yeniden görünmesin */
  const [syncingFor, setSyncingFor] = useState<QuickCountSheet | null>(null);
  /** "Geldi" denen siparişler (sunucu yanıtı gelene kadar listeden kalkar) */
  const [arrived, setArrived] = useState<ReadonlySet<number>>(() => new Set());

  const qtyOf = (i: QuickCountItem) => readBox(values[i.id] ?? "", i.countUnit);
  const savedQty = (i: QuickCountItem) => i.today?.qty ?? null;
  const invalid = all.filter((i) => (values[i.id] ?? "").trim() !== "" && (qtyOf(i) === null || (qtyOf(i) ?? 0) < 0));
  const changed = all.filter((i) => !invalid.includes(i) && qtyOf(i) !== savedQty(i));
  const dirty = syncingFor !== sheet && (changed.length > 0 || invalid.length > 0);
  const counted = all.filter((i) => qtyOf(i) !== null).length;
  const due = sheet.due.filter((o) => !arrived.has(o.id));

  // Kaydedilmemiş sayım bu cihazda taslak olarak durur (Stok sayımı gibi): başka sayfaya geçilir, sekme düşer ya da
  // telefon görüşmesi araya girerse yazılanlar kaybolmaz; sayfa yeniden açılınca geri yüklemesi önerilir. Kayıt ya da
  // formun temizlenmesi bu açılışta yazılan taslağı siler. Kirliyken çıkış önce sorulur. Taslak her kalemin o anki
  // kayıtlı miktarını da yazar: geri yüklerken arada başkasının kaydettiği kalem işaretlenir, sessizce ezilmez.
  const draftKey = `laf:hizli-sayim:${sheet.day}`;
  const draftItems = changed.concat(invalid);
  const draftJson = dirty
    ? countDraftJson({
        values: Object.fromEntries(draftItems.map((i) => [String(i.id), values[i.id] ?? ""])),
        prefilled: [],
        extras: null,
        by: me,
        base: Object.fromEntries(draftItems.map((i) => [String(i.id), savedQty(i)])),
      })
    : "";
  const wroteDraft = useRef(false);
  useEffect(() => {
    try {
      if (draftJson) {
        window.localStorage.setItem(draftKey, draftJson);
        wroteDraft.current = true;
      } else if (wroteDraft.current) {
        window.localStorage.removeItem(draftKey);
        wroteDraft.current = false;
      }
    } catch {
      // Gizli pencere ya da dolu depolama: taslaksız devam
    }
  }, [draftJson, draftKey]);
  const [draftGone, setDraftGone] = useState(false);
  const openingDraft = useRef<{ key: string; json: string | null } | null>(null);
  const storedDraft = useSyncExternalStore(
    noopSubscribe,
    () => {
      if (openingDraft.current?.key !== draftKey) openingDraft.current = { key: draftKey, json: readDraft(draftKey) };
      return openingDraft.current.json;
    },
    () => null,
  );
  const draft = parseCountDraft(storedDraft && !dirty && !draftGone ? storedDraft : null);
  const draftEntries = Object.entries(draft.values).filter(([id, raw]) => all.some((i) => i.id === Number(id)) && (values[Number(id)] ?? "") !== raw);
  const forgetDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // yok sayılır
    }
    wroteDraft.current = false;
    setDraftGone(true);
  };
  function restoreDraft() {
    setValues((v) => ({ ...v, ...Object.fromEntries(draftEntries.map(([id, raw]) => [Number(id), raw])) }));
    // Taslaktan sonra başkasının kaydettiği kalemler işaretlenir (kaydederse onunkinin yerine geçer)
    const stale = draftConflicts(
      draft,
      draftEntries.map(([id]) => Number(id)),
      (id) => all.find((i) => i.id === id)?.today?.qty ?? null,
    );
    if (stale.length) setConflicts((c) => new Set([...c, ...stale]));
    toast.success("Taslak geri yüklendi", {
      description: stale.length ? `${num(stale.length)} kalemi taslaktan sonra başkası da kaydetti; işaretli kalemlere bakıp kaydedin.` : "Kontrol edip kaydedin.",
    });
  }
  const [leaveHref, setLeaveHref] = useLeaveGuard(dirty);

  async function save() {
    if (busy) return;
    if (invalid.length) return void toast.error(`${invalid[0].name}: miktarı sayıyla yazın (ör. 2,5)`);
    if (!changed.length) return;
    setBusy(true);
    try {
      const res = await saveQuickCounts(changed.map((i) => ({ ingredientId: i.id, qty: qtyOf(i), base: savedQty(i) })));
      if (!res.ok) return void toast.error(res.error);
      forgetDraft();
      setSyncingFor(sheet);
      const { saved, removed } = res.data;
      const title = saved ? `${num(saved)} kalem kaydedildi` : `Bugünkü ${num(removed)} sayım silindi`;
      if (admin) toast.success(title, { action: { label: "Sipariş listesi", onClick: () => router.push("/panel/mal-siparisi") } });
      else toast.success(title, { action: { label: "Sipariş taslağı", onClick: () => router.push("/panel/hizli-sayim/siparis") } });
    } catch (e) {
      unstable_rethrow(e);
      // Panel yeniden yayınlandı, sayfa eski: yeniden denemek hep düşer, yenilemek gerekir (taslak bu cihazda durur)
      if (unstable_isUnrecognizedActionError(e))
        return void toast.error(STALE_TEXT, {
          description: "Yazdıklarınız bu cihazda duruyor; yenileyince “Geri yükle”ye basın.",
          duration: 30_000,
          action: { label: "Yenile", onClick: () => window.location.reload() },
        });
      // Ağ kesildi ya da sunucu o an yanıt vermedi: yazılanlar kutularda duruyor (Stok sayımı ile aynı)
      toast.error("Kaydedilemedi: bağlantı yok gibi", {
        description: "Yazdıklarınız ekranda duruyor. Bağlantı gelince yeniden deneyin.",
        duration: 15_000,
        action: { label: "Tekrar dene", onClick: () => void saveRef.current() },
      });
    } finally {
      setBusy(false);
    }
  }
  // "Tekrar dene" o anki kutularla kaydetsin
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  async function markArrived(o: QuickCountSheet["due"][number]) {
    setArrived((s) => new Set(s).add(o.id));
    const unhide = () =>
      setArrived((s) => {
        const next = new Set(s);
        next.delete(o.id);
        return next;
      });
    // Bağlantı yoksa satır geri gelir: mal "geldi" sanılıp sipariş listesinde yanlış sayılmasın
    const res = await markOrderReceived({ id: o.id, received: true }).catch(() => null);
    if (!res?.ok) {
      unhide();
      return void toast.error(res ? res.error : "Kaydedilemedi: bağlantı yok gibi", res ? undefined : { description: "Bağlantı gelince yeniden “Geldi”ye dokunun." });
    }
    const undo = async () => {
      const r = await markOrderReceived({ id: o.id, received: false }).catch(() => null);
      if (!r) return void toast.error("Geri alınamadı: bağlantı yok gibi", { duration: 15_000, action: { label: "Tekrar dene", onClick: () => void undo() } });
      if (!r.ok) return void toast.error(r.error);
      unhide();
      toast.success("Geldi işareti kaldırıldı");
    };
    toast.success(`${o.supplier} siparişi geldi`, { duration: 10_000, action: { label: "Geri al", onClick: () => void undo() } });
  }

  if (!sheet.total) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardPen />}
          title="Sayılacak kalem seçilmemiş"
          description={admin ? "Sipariş önerisi için 10–15 kritik kalem seçin." : "Yönetici kalemleri seçince burada görünür."}
          action={
            admin ? (
              <ButtonLink href="/panel/mal-siparisi/kalemler" variant="primary">
                Kalemleri seç
              </ButtonLink>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {draftEntries.length ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">
          <span className="min-w-0 flex-1">
            {draft.by && draft.by !== me ? `${draft.by} bu cihazda` : "Bu cihazda"} kaydedilmemiş {num(draftEntries.length)} kalemlik hızlı sayım var (sayfadan
            çıkılmış ya da bağlantı gitmiş olabilir).
          </span>
          <Button size="sm" onClick={restoreDraft}>
            Geri yükle
          </Button>
          <Button size="sm" variant="ghost" onClick={forgetDraft}>
            Sil
          </Button>
        </div>
      ) : null}
      {/* Durum şeridi: sayım günü, son sayım, ayın son günü (telefonda alt alta: ayraç satır sonunda kalmasın) */}
      <div className="flex flex-col items-start gap-y-1.5 text-sm text-ink-mute sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3" role="status">
        {sheet.countDay ? <Badge tone="amber">Bugün sayım günü</Badge> : <span>Sıradaki sayım: {longDateTR(sheet.nextCountDay)}</span>}
        <span aria-hidden="true" className="hidden text-ink-quiet sm:inline">
          ·
        </span>
        <span>{sheet.last ? `Son sayım: ${longDateTR(sheet.last.day)} · ${sheet.last.by}` : "Henüz hızlı sayım yok"}</span>
        {sheet.monthEnd ? (
          <span className="basis-full">
            Bugün ay sonu: Stok sayımı bu sayımın yerine geçer.{" "}
            <Link href={`/panel/sayim?ay=${sheet.day.slice(0, 7)}`} className="font-medium text-ink underline-offset-2 hover:underline">
              Stok sayımı →
            </Link>
          </span>
        ) : null}
      </div>

      {due.length ? (
        <Card>
          <CardHeader icon={<PackageCheck />} title="Gelen mal var mı?" description="Sayımdan önce gelenleri işaretleyin; işaretlenmezse sipariş listesinde ikinci kez sayılır." />
          <ul className="divide-y divide-line border-t border-line">
            {due.map((o) => {
              const shown = o.lines.slice(0, 3).map((l) => `${l.orderName} ${qtyLabel(l.qty, l.unit)}`);
              const more = o.lines.length - shown.length;
              return (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold break-words text-ink">
                      {o.supplier} · {dateTR(o.sentDay)} siparişi
                      {o.expectedOn > sheet.day ? <span className="font-normal text-ink-mute"> · {dateTR(o.expectedOn)} bekleniyor</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs break-words text-ink-mute">
                      {shown.join(", ")}
                      {more > 0 ? ` ve ${num(more)} kalem daha` : ""}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => void markArrived(o)} className="text-ink">
                    Geldi
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {sheet.groups.map((g) => {
        const done = g.items.filter((i) => qtyOf(i) !== null).length;
        return (
          <Card key={g.name}>
            <CardHeader title={g.name} meta={`${num(done)} / ${num(g.items.length)}`} className="pb-3" />
            <ul className="divide-y divide-line border-t border-line">
              {g.items.map((i) => {
                const v = qtyOf(i);
                const bad = invalid.includes(i);
                const unusual = v !== savedQty(i) ? unusualCount(v, i.last?.qty ?? null) : null;
                return (
                  <li key={i.id} className={cn("px-5 py-3", conflicts.has(i.id) && "bg-warn-soft/50")}>
                    <div className="flex items-center gap-3">
                      <label htmlFor={`qc-${i.id}`} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block text-sm font-medium break-words text-ink">{i.name}</span>
                        {i.packageDesc ? <span className="block text-xs break-words text-ink-mute">{i.packageDesc}</span> : null}
                      </label>
                      <div className="relative w-28 shrink-0">
                        <NumberInput
                          id={`qc-${i.id}`}
                          data-qc-input=""
                          enterKeyHint="next"
                          value={values[i.id] ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setValues((x) => ({ ...x, [i.id]: raw }));
                            if (conflicts.has(i.id)) setConflicts((c) => new Set([...c].filter((y) => y !== i.id)));
                          }}
                          onKeyDown={focusNext}
                          aria-invalid={bad || undefined}
                          aria-describedby={`qc-${i.id}-hint`}
                          className="pr-14"
                        />
                        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">{i.countUnit}</span>
                      </div>
                    </div>
                    <div id={`qc-${i.id}-hint`} className="mt-1 space-y-0.5 text-xs">
                      <p className="text-ink-mute tabular">{i.last ? `Geçen: ${countText(i.last.qty)} ${i.countUnit} · ${dateTR(i.last.day)}` : "Daha önce sayılmadı"}</p>
                      {i.today ? (
                        <p className="text-good-ink">
                          Bugün kaydedildi · {i.today.by} {hhmm(i.today.at)}
                        </p>
                      ) : null}
                      {bad ? <p className="text-bad">Miktarı sayıyla yazın (ör. 2,5).</p> : null}
                      {unusual ? (
                        <p className="text-warn">{unusual === "high" ? "Geçen sayımın 5 katından fazla: doğru mu?" : "Geçen sayımın beşte birinden az: doğru mu?"}</p>
                      ) : null}
                      {conflicts.has(i.id) ? <p className="text-warn">Bu arada başkası kaydetti; yazdığınızı kontrol edip yeniden kaydedin.</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      <FloatingBar open={dirty}>
        <p className="min-w-0 flex-1 text-sm text-ink-soft tabular">
          {num(counted)} / {num(all.length)} kalem
          {invalid.length ? <span className="text-bad"> · {num(invalid.length)} kutu okunamadı</span> : null}
        </p>
        <Button onClick={() => void save()} disabled={busy}>
          <Save size={16} aria-hidden="true" /> {busy ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </FloatingBar>
      <ConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (href) router.push(href);
        }}
        title="Kaydedilmemiş sayım var"
        confirmLabel="Kaydetmeden geç"
        description="Hızlı sayımda yazdığınız miktarlar henüz kaydedilmedi. Kalmak için Vazgeç'e basıp Kaydet'i kullanın; geçerseniz yazdıklarınız bu cihazda taslak olarak durur."
      />
    </div>
  );
}
