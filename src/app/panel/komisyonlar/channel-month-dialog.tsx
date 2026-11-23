"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { parseNumberTR } from "@/lib/calc/expr";
import type { ChannelKey, ChannelKind } from "@/lib/commission/channels";
import type { ChannelMonthChange } from "@/lib/commission/report";
import { MONTH_NAMES } from "@/lib/constants";
import { money, monthLabel, num } from "@/lib/format";
import { addDays, todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { saveChannelMonth, type ChannelMonthInput } from "@/server/actions/commission";

/** Pencerenin bildiği: kanal ve ay, kayıtlı işaret, faturaların KDV dahil toplamı ve Z'den gelen satış (grupta tek kanalsa) */
export interface ChannelMonthData {
  channel: ChannelKey;
  label: string;
  kind: ChannelKind;
  month: string;
  receivedOn: string | null;
  received: number | null;
  sales: number | null;
  note: string | null;
  /** Ayın faturalarının KDV dahil toplamı (beklenen = satış − bu) */
  payable: number;
  /** Faturası var mı (yoksa beklenen hesaplanmaz) */
  invoiced: boolean;
  /** Satış yazılmazsa kullanılan Z toplamı (yalnız grupta tek kanal varsa) */
  /** Satış boş bırakılırsa kullanılacak: LafPOS'un ödemeleri ya da (grupta tek kanalken) Z toplamı */
  autoSales: { amount: number; source: "lafpos" | "tek"; foy?: number } | null;
}

/** "Geldi": hakedişi işaretle; "duzenle": kayıtlı işareti değiştir; "satis": yalnız satışı yaz (alan odaklanır) */
export type DialogMode = "geldi" | "duzenle" | "satis";

const shortName = (d: Pick<ChannelMonthData, "label" | "month">) => `${d.label} ${MONTH_NAMES[Number(d.month.slice(5, 7)) - 1]}`;

/** Kaydın bildirimi: "Pluxee Ekim hakedişi işaretlendi" … */
function changeText(d: ChannelMonthData, change: ChannelMonthChange): string {
  const name = shortName(d);
  switch (change) {
    case "geldi":
      return `${name} hakedişi işaretlendi`;
    case "kaldirildi":
      return `${name}: hakediş işareti kaldırıldı`;
    case "satis":
      return `${name} satışı kaydedildi`;
    case "satis-silindi":
      return `${name}: yazılan satış silindi`;
    case "not":
      return `${name} notu kaydedildi`;
    default:
      return `${name}: değişiklik yok`;
  }
}

/**
 * Kart ve Bekleyen hakedişler satırındaki düğme: "Hakediş geldi", "Düzenle" ya da "Satışı yaz". Kaydet'e (ya da
 * Vazgeç'e) basınca önce pencere kapanır, sonra kaydedilir; pencere hiçbir yere gitmez (sayfa sunucu eylemiyle
 * yenilenir). Bildirimdeki "Geri al" önceki değerlerle aynı eylemi çağırır.
 */
export function PayoutButton({
  data,
  mode,
  label,
  variant = "primary",
  size = "sm",
  className,
}: {
  data: ChannelMonthData;
  mode: DialogMode;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useActionTransition();

  function save(input: ChannelMonthInput) {
    setOpen(false);
    start(async () => {
      const r = await saveChannelMonth(input);
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      if (r.data.change === "yok") return;
      const previous = r.data.previous;
      toast.success(changeText(data, r.data.change), {
        duration: 10_000,
        action: {
          label: "Geri al",
          onClick: () =>
            void tryAction(() => saveChannelMonth(previous)).then((x) => x && (x.ok ? toast.success(`${shortName(data)}: geri alındı`) : toast.error(x.error))),
        },
      });
    });
  }

  return (
    <>
      <Button variant={variant} size={size} className={className} disabled={pending} onClick={() => setOpen(true)}>
        {pending ? "Kaydediliyor…" : label}
      </Button>
      {open ? <ChannelMonthDialog data={data} mode={mode} onClose={() => setOpen(false)} onSave={save} /> : null}
    </>
  );
}

/** Alanın ilk metni: küsuratlıysa iki ondalık ("5.722,40"), değilse tam ("6.200") */
const amountText = (v: number | null) => (v === null ? "" : Number.isInteger(Math.round(v * 100) / 100) ? num(v, 0) : num(v, 2, 2));

function ChannelMonthDialog({ data, mode, onClose, onSave }: { data: ChannelMonthData; mode: DialogMode; onClose: () => void; onSave: (input: ChannelMonthInput) => void }) {
  const formId = useId();
  // Pencere açılınca bugün (Türkiye): gün en geç yarın olabilir (hakediş gece yarısından sonra işaretlenebilir)
  const [today] = useState(() => todayTR());
  const received = data.receivedOn !== null && data.received !== null;
  // "Hakediş geldi"den Geldi; Düzenle ve Satışı yaz kayıtlı durumla açılır
  const [arrived, setArrived] = useState<"geldi" | "gelmedi">(mode === "geldi" || received ? "geldi" : "gelmedi");
  const [on, setOn] = useState(data.receivedOn ?? today);
  const [salesText, setSalesText] = useState(amountText(data.sales));
  const [note, setNote] = useState(data.note ?? "");
  const [tried, setTried] = useState(false);

  const salesValue = salesText.trim() ? parseNumberTR(salesText) : null;
  const salesError = salesText.trim() && salesValue === null ? "Satışı sayı olarak yazın, ör. 9.300" : salesValue !== null && salesValue < 0 ? "Satış eksi olamaz" : null;
  // Beklenen, penceredeki satışla canlı: yazılan satış, yoksa LafPOS'un ödemeleri ya da Z'deki toplam (grupta tek kanalsa)
  const effectiveSales = salesValue !== null && salesValue >= 0 ? salesValue : salesText.trim() ? null : (data.autoSales?.amount ?? null);
  const expected = data.invoiced && effectiveSales !== null ? Math.round((effectiveSales - data.payable) * 100) / 100 : null;
  const [amountTextValue, setAmount] = useState(() => (received ? amountText(data.received) : expected !== null && expected > 0 ? amountText(expected) : ""));
  const amount = amountTextValue.trim() ? parseNumberTR(amountTextValue) : null;

  const first = `${data.month}-01`;
  const last = addDays(today, 1);
  const dayError = arrived === "geldi" && tried && !on ? "Günü seçin" : arrived === "geldi" && on && (on < first || on > last) ? "Gün ayın başından önce ya da yarından sonra olamaz" : null;
  const amountError = arrived === "geldi" && tried && (amount === null || amount <= 0) ? "Gelen tutarı yazın" : null;

  const formula = expected !== null && effectiveSales !== null ? `satış ${money(effectiveSales)} − faturalar ${money(data.payable)}` : null;
  const amountHint = [
    "Banka hesabınıza geçen tutar.",
    data.kind === "platform" ? "Bu ayın satışları için gelen havalelerin toplamı." : null,
    expected !== null && expected > 0 ? `Beklenen: ${money(expected)} (${formula}).` : "Beklenen tutar bilinmiyor; bankadaki tutarı yazın.",
  ]
    .filter(Boolean)
    .join(" ");
  const salesHint = `Kanalın kendi ekranındaki (ekstre, hakediş raporu) satış, KDV dahil. ${
    data.autoSales === null
      ? "Boş bırakırsanız satış bilinmez."
      : data.autoSales.source === "lafpos"
        ? data.autoSales.foy
          ? `Boş bırakırsanız LafPOS ödemeleri ve ModPOS föyündeki markalı ödemeler kullanılır: ${money(data.autoSales.amount)} (föyden ${money(data.autoSales.foy)}).`
          : `Boş bırakırsanız LafPOS'taki ödemeler kullanılır: ${money(data.autoSales.amount)}.`
        : `Boş bırakırsanız Z'deki toplam kullanılır: ${money(data.autoSales.amount)}.`
  }`;

  function submit() {
    setTried(true);
    if (salesError) return;
    if (arrived === "geldi" && (!on || on < first || on > last || amount === null || amount <= 0)) return;
    onSave({
      channel: data.channel,
      month: data.month,
      received: arrived === "geldi" ? { on, amount: amount! } : null,
      sales: salesValue,
      note: note.trim() || null,
    });
  }

  // Telefonda 48 px alanlar
  const big = "pointer-coarse:h-12 pointer-coarse:text-lg";
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${data.label} · ${monthLabel(data.month)}`}
      description="Bankaya gelen hakedişi yazın. Banka hesabı panele bağlı değil; geldiğini siz işaretlersiniz."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label="Hakediş"
          stretch
          value={arrived}
          onChange={setArrived}
          options={[
            { value: "geldi", label: "Geldi" },
            { value: "gelmedi", label: "Henüz gelmedi" },
          ]}
        />
        {arrived === "geldi" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Geldiği gün" htmlFor={`${formId}-gun`} error={dayError}>
              <Input
                id={`${formId}-gun`}
                type="date"
                value={on}
                min={first}
                max={last}
                onChange={(e) => setOn(e.target.value)}
                aria-invalid={dayError ? true : undefined}
                className={big}
              />
            </Field>
            <Field label="Gelen tutar (₺)" htmlFor={`${formId}-tutar`} error={amountError}>
              <NumberInput
                id={`${formId}-tutar`}
                value={amountTextValue}
                onChange={(e) => setAmount(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="0"
                enterKeyHint="done"
                aria-invalid={amountError ? true : undefined}
                data-autofocus={mode === "geldi" ? true : undefined}
                className={big}
              />
            </Field>
            <p className={cn("-mt-2 text-xs text-ink-mute sm:col-span-2", amountError && "sr-only")}>{amountHint}</p>
          </div>
        ) : null}
        <Field label="Bu ayki satış (isteğe bağlı)" htmlFor={`${formId}-satis`} error={salesError} hint={salesHint}>
          <NumberInput
            id={`${formId}-satis`}
            value={salesText}
            onChange={(e) => setSalesText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder={data.autoSales !== null ? num(data.autoSales.amount, 2) : "Ekstredeki satış"}
            enterKeyHint="done"
            aria-invalid={salesError ? true : undefined}
            data-autofocus={mode === "satis" ? "always" : undefined}
            className={big}
          />
        </Field>
        <Field label="Not" htmlFor={`${formId}-not`}>
          <Input id={`${formId}-not`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" className={big} />
        </Field>
      </form>
    </Dialog>
  );
}
