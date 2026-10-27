"use client";

import { Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { useActionTransition } from "@/components/ui/action-error";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { monthLabel, num } from "@/lib/format";
import { LAFPOS_RESEND_HINT } from "@/lib/lafpos/status";
import { dayMonthYearTR, LAFPOS_SWITCH_EFFECTS, switchAffectedMonths, switchDayProblem } from "@/lib/lafpos/switch";
import { isStepUpError } from "@/lib/step-up";
import { deleteLafposDay, saveLafposSwitchDay } from "@/server/actions/lafpos";
import { matchLafposName } from "@/server/actions/sales";

import { ProductPicker, type ProductOption } from "../satislar/product-picker";

/**
 * Ayarlar › LafPOS (kasa) › LafPOS'a geçiş günü. Kaydetmeden önce onay penceresi: bu günden itibaren ne değişir
 * (LAFPOS_SWITCH_EFFECTS, kodun bugün yaptığı) ve hangi ayların günleri kaynak değiştirir (switchAffectedMonths).
 * Boşaltmak da aynı pencereden: kasa yeniden ModPOS sayılır. Hiçbir kayıt silinmez.
 */
export function LafposSwitchDayForm({ value, today, min, max, linked }: { value: string | null; today: string; min: string; max: string; linked: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(value ?? "");
  // Kayıttan ya da başka bir sekmedeki değişiklikten sonra sunucudan yeni değer gelir: el değmemiş alan yenisini alır
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    if (draft === (synced ?? "")) setDraft(value ?? "");
  }
  const [confirm, setConfirm] = useState<string | null | undefined>(undefined);
  const [pending, start] = useActionTransition();
  const next = draft || null;
  const dirty = next !== value;
  const problem = next ? switchDayProblem(next, today) : null;

  const save = (day: string | null) =>
    start(async () => {
      const res = await saveLafposSwitchDay(day);
      if (!res.ok) return void toast.error(res.error);
      setConfirm(undefined);
      toast.success(res.data.change ?? "Değişiklik yok");
      router.refresh();
    });

  const months = confirm !== undefined ? switchAffectedMonths(value, confirm, today) : [];
  return (
    <div className="space-y-3">
      <Field
        label="LafPOS'a geçiş günü"
        htmlFor="lafpos-gecis"
        error={problem}
        hint="Kasada LafPOS'u kullanmaya başladığınız ilk iş günü. Boş bırakın: her şey bugünkü gibi ModPOS'a göre çalışır. Tercihen ayın 1'i (ModPOS'un o ayki listesi bölünmez)."
      >
        <Input
          id="lafpos-gecis"
          type="date"
          value={draft}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={problem ? true : undefined}
          className="h-11 max-w-56 max-sm:max-w-none"
        />
      </Field>
      <div className="flex flex-wrap gap-2 max-sm:flex-col">
        {dirty ? (
          <>
            <Button onClick={() => setConfirm(next)} disabled={pending || problem !== null} className="max-sm:h-11 max-sm:w-full">
              {next ? "Geçiş gününü kaydet" : "Geçiş gününü kaldır"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(value ?? "")} disabled={pending} className="max-sm:h-11 max-sm:w-full">
              Vazgeç
            </Button>
          </>
        ) : value ? (
          <Button variant="secondary" onClick={() => setConfirm(null)} disabled={pending} className="max-sm:h-11 max-sm:w-full">
            Geçiş gününü kaldır
          </Button>
        ) : null}
      </div>
      <Dialog
        open={confirm !== undefined}
        onClose={() => setConfirm(undefined)}
        size="sm"
        title={confirm ? `Geçiş günü ${dayMonthYearTR(confirm)}` : "Geçiş gününü kaldır"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(undefined)} disabled={pending} data-autofocus className="max-sm:h-11 max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button onClick={() => save(confirm ?? null)} disabled={pending} className="max-sm:h-11">
              {pending ? "Kaydediliyor…" : confirm ? "Kaydet" : "Kaldır"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2 text-sm text-ink-soft">
          {confirm ? (
            <>
              <p>Bu günden itibaren kasanın kaynağı LafPOS olur:</p>
              <ul className="list-disc space-y-1 pl-5">
                {LAFPOS_SWITCH_EFFECTS.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {!linked ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">Bağlantı henüz kurulmadı: anahtar girilene kadar LafPOS günleri gelemez.</p> : null}
            </>
          ) : (
            <p>Kasa yeniden ModPOS sayılır; LafPOS&apos;tan gelen bütün günler deneme olur ve hiçbir hesaba girmez.</p>
          )}
          <p className="text-[13px] text-ink-mute">
            {months.length
              ? `Kaynağı değişen günlerin ayları: ${months.map(monthLabel).join(", ")}.`
              : "Geçmiş hiçbir gün değişmiyor (gün ileride)."}{" "}
            Hiçbir kayıt silinmez; tarihi sonra değiştirebilir ya da boşaltabilirsiniz.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * Bir günün LafPOS kaydını sil (409 z_conflict'in çözümü ya da deneme gününün temizliği): yöneticinin parolasıyla.
 * LafPOS reddedilen ya da silinen günü kendisi yeniden göndermez: yenisi LafPOS'ta Kasa › Geçmiş günler › o günün Z
 * raporu › Gönder ile gelir (LAFPOS_RESEND_HINT). `label` verilirse metinli düğme, yoksa satır sonunda çöp kutusu.
 */
export function LafposDayDelete({ date, zNo, lines, label }: { date: string; zNo: number; lines: number; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const title = `${dayMonthYearTR(date)} LafPOS kaydını sil`;
  return (
    <>
      {label ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="max-sm:w-full">
          <Trash2 size={14} aria-hidden="true" /> {label}
        </Button>
      ) : (
        <IconButton tone="danger" label={title} onClick={() => setOpen(true)}>
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      )}
      {open ? (
        <ConfirmPasswordDialog
          title={title}
          description={`Günün özeti (Z ${zNo}) ve ${lines} satış satırı silinir; geri alınamaz. ${LAFPOS_RESEND_HINT}`}
          confirmLabel="Sil"
          danger
          onClose={() => setOpen(false)}
          onConfirm={async (password) => {
            const res = await deleteLafposDay({ date, zNo }, { password });
            if (!res.ok) {
              // Parola hataları pencerede kalır; öteki hatalar (gün yeniden gönderildi) bildirimle
              if (isStepUpError(res.error)) return res.error;
              setOpen(false);
              toast.error(res.error);
              router.refresh();
              return null;
            }
            setOpen(false);
            toast.success(`${dayMonthYearTR(date)} silindi (Z ${res.data.zNo}, ${res.data.lines} satır)`);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Ürüne bağlanamayan POS adları (Ayarlar › LafPOS kartı; denetim E-33): her ad menüdeki bir ürüne ya da HİZMET'e
 * bağlanır. Ad Satışlar'ın POS adı hafızasına yazılır ve bu adla gelmiş bütün ürünsüz LafPOS satırları (deneme günleri
 * dahil) yeniden gönderim olmadan bağlanır; sonraki gün sonları da tanır. Geçiş günü boşken LafPOS adları yalnız bu
 * kartta görünür (sahibin kararı), bağlama yalnız eşleştirmeyi yazar, hiçbir hesabı değiştirmez.
 */
export function LafposUnmatchedList({ items, more, products }: { items: { posName: string; qty: number; days: number }[]; more: number; products: ProductOption[] }) {
  const router = useRouter();
  const [picking, setPicking] = useState<{ posName: string; qty: number } | null>(null);
  const [pending, start] = useActionTransition();
  const pick = (posName: string, v: { productId: number | null; isService: boolean }) =>
    start(async () => {
      setPicking(null);
      const res = await matchLafposName({ month: null, posName, productId: v.productId, isService: v.isService });
      if (!res.ok) return void toast.error(res.error);
      toast.success(v.isService ? "HİZMET olarak işaretlendi" : "Bağlandı", {
        description: `“${posName}”: ${num(res.data.others)} LafPOS satırı bağlandı; sonraki gün sonlarında otomatik tanınacak.`,
      });
      router.refresh();
    });
  return (
    <>
      <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
        {items.map((u) => (
          <li key={u.posName} className="flex items-center gap-3 px-4 py-2 text-sm">
            <p className="min-w-0 flex-1">
              <span className="font-medium break-words text-ink">{u.posName}</span>
              <span className="block text-[13px] text-ink-mute tabular">
                {num(u.qty)} adet · {num(u.days)} gün
              </span>
            </p>
            <Button size="sm" variant="secondary" onClick={() => setPicking(u)} disabled={pending} className="shrink-0 pointer-coarse:h-11">
              <Link2 size={14} aria-hidden="true" /> Bağla
            </Button>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="text-[13px] text-ink-mute">ve {num(more)} ad daha (en çok satılan 10 ad gösteriliyor)</p> : null}
      {picking ? (
        <ProductPicker
          key={picking.posName}
          onClose={() => setPicking(null)}
          products={products}
          title={`${picking.posName} (${num(picking.qty)} adet, LafPOS)`}
          currentId={null}
          isService={false}
          onPick={(v) => pick(picking.posName, v)}
        />
      ) : null}
    </>
  );
}
