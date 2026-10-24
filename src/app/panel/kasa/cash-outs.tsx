"use client";

import { CalendarPlus, ImagePlus, Info, Plus, Receipt, Undo2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { usePhotoUpload } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CASH_OUT_REQUEST_TEXT, CASH_OUT_OP_LABEL } from "@/lib/cash-out-requests";
import { cashOutLabel, cashOutShortLabel, cashOutsTotal } from "@/lib/cash-outs";
import { shortDayTR } from "@/lib/cash-requests";
import { money } from "@/lib/format";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import { photoCaption, photoUrl, type ReadingState } from "@/lib/photo-rules";
import { genitive } from "@/lib/recipe-change";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { attachCashOutReceipt } from "@/server/actions/cash-out-requests";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";
import type { OwnCashOutRequest } from "@/server/data/cash-out-requests";
import type { CashOutCategory, CashOutDTO } from "@/server/data/cash-outs";

import { CashOutDialog, type CashOutDialogMode, type CashOutRequestMode } from "./cash-out-dialog";

const time = (iso: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Satırın ikinci satırı: "14:32 · Ayşe · Nakit malzeme alımı" (harcamaya yazılmadıysa nedeni) */
function rowSub(o: CashOutDTO): string {
  const tail =
    o.kind === "teslim"
      ? null
      : (o.categoryName ?? (o.expenseEntryId !== null ? "harcamalara yazıldı" : o.docType === "fatura" || o.docType === "e_arsiv" ? "fatura" : "harcamalara eklenmedi"));
  return [time(o.createdAt), o.createdByName, tail].filter(Boolean).join(" · ");
}

/** Personelin bu günün satırlarına açılmış bekleyen istekleri (kasa sayfası) */
export interface DayCashOutRequests {
  own: OwnCashOutRequest[];
  others: { cashOutId: number; requestedByName: string }[];
}

/**
 * Gün içinde kasadan çıkanlar: market fişi, buz, tamirci, gün ortası teslim. "Fiş ekle" kamerayı ya da galeriyi açar;
 * fotoğraf yüklenip okunurken pencere açılır ve okunanlar boş alanlara dolar. Akşam raporunun "Gün içinde kasadan
 * çıkan" tutarı bunların toplamından gelir. Satıra dokununca düzeltilir. Personel için kapanmış günde (ertesi günün
 * raporu girildi) ekleme ve düzeltme, açık günde yöneticinin kategorisindeki satırın değişikliği yöneticinin onayına
 * gider (pencere istek kipinde); fotoğrafsız alışveriş satırına fiş onaysız eklenir; dünden eski 6 güne "Eski bir güne
 * ekle" ile istek açılır. Fişin fotoğrafını göremeyen (personel, kapanmış gün) küçük resim yerine fiş simgesini görür.
 */
export function CashOutsCard({
  date,
  today,
  lines,
  categories,
  canEdit,
  showPhotos,
  admin,
  me,
  storage,
  reading,
  reported = null,
  locked = false,
  requests = null,
  oldDays = [],
}: {
  date: string;
  today: boolean;
  lines: CashOutDTO[];
  categories: CashOutCategory[];
  canEdit: boolean;
  /** Fiş fotoğraflarını görebilir mi: yönetici ya da personelin hâlâ düzenleyebildiği gün (/api/foto'nun kuralı) */
  showPhotos: boolean;
  admin: boolean;
  me: string;
  storage: boolean;
  reading: ReadingState;
  /** O günün raporunda fişsiz yazılan "Gün içinde çıkan" (varsa): kart "para çıkmadı" demesin */
  reported?: { amount: number; note: string | null } | null;
  /** Personel: gün kapandı (ertesi günün raporu girildi); ekleme ve düzeltme istekle */
  locked?: boolean;
  /** Personel: bu günün bekleyen istekleri */
  requests?: DayCashOutRequests | null;
  /** Personel: "Eski bir güne ekle"nin günleri (D−2 … D−7) */
  oldDays?: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  // Her açılış yeni bir pencere (önceki taslak kalmasın); `shown` açık pencerenin anahtarı (kapalıysa null)
  const opened = useRef(0);
  const shown = useRef<number | null>(null);
  const up = usePhotoUpload();
  const receiptUp = usePhotoUpload();
  const [dialog, setDialog] = useState<{ key: number; mode: CashOutDialogMode; day: string; request: CashOutRequestMode | null } | null>(null);
  const [uploaded, setUploaded] = useState<PhotoUploadResponse | null>(null);
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  // "Eski bir güne ekle": seçilen gün (önce gün, sonra kamera ya da form)
  const [oldOpen, setOldOpen] = useState(false);
  const [oldDay, setOldDay] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<CashOutDTO | null>(null);
  const [pending, start] = useActionTransition();
  const total = cashOutsTotal(lines);
  const read = reading === "on";
  const staffCats = new Set(categories.map((c) => c.id));
  // Yöneticinin kategorisindeki satır (personelin listesinde olmayan kategori): personelin değişikliği istekle
  const adminLine = (o: CashOutDTO) => !admin && o.expenseEntryId !== null && o.categoryId !== null && !staffCats.has(o.categoryId);
  const ownOn = (id: number) => requests?.own.find((r) => r.cashOutId === id) ?? null;
  const otherOn = (id: number) => requests?.others.find((r) => r.cashOutId === id) ?? null;
  const ownAdds = requests?.own.filter((r) => r.view.op === "ekle") ?? [];
  // Personel bu güne dokunabiliyor (açık gün) ya da istek açabiliyor (kilitli dün)
  const staffActs = !admin && (canEdit || locked);

  const open = (mode: CashOutDialogMode, day: string, request: CashOutRequestMode | null) => {
    // Süren yükleme sıfırlanmaz: "Fiş ekle" o bitene kadar kapalı kalır
    if (!up.busy) up.reset();
    setUploaded(null);
    opened.current += 1;
    shown.current = opened.current;
    setDialog({ key: opened.current, mode, day, request });
    return opened.current;
  };
  const close = () => {
    shown.current = null;
    setDialog(null);
  };

  /** Eklemenin kipi: açık günde doğrudan, kapanmış ya da eski günde istek */
  const addRequest = (day: string): CashOutRequestMode | null => (admin ? null : day !== date ? { reason: "old" } : locked ? { reason: "locked" } : null);

  // Yükleme ya da yeniden okuma yalnız onu başlatan pencereye yazılır: pencere kapandıysa ya da yenisi açıldıysa geç
  // gelen yanıt atlanır (iki fişin fotoğrafı ve rakamları karışmasın; fotoğraf bağlanmadığı için 2 günde silinir)
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const day = oldDay ?? date;
    const key = open({ mode: "photo" }, day, addRequest(day));
    const res = await up.upload(file, { kind: "fis", day, read });
    if (res && shown.current === key) setUploaded(res);
  }

  async function retry(photoId: number) {
    const key = shown.current;
    const res = await up.reread(photoId, "fis", dialog?.day ?? date);
    if (res && key !== null && shown.current === key) setUploaded(res);
  }

  // Fotoğrafsız alışveriş satırına fiş (onaysız; yalnız kanıt): fotoğraf okunmaz, tutar ve kategori değişmez
  async function onReceipt(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = receiptFor;
    if (!file || !target) return;
    const res = await receiptUp.upload(file, { kind: "fis", day: target.date, read: false });
    // Hata (boyut, bağlantı) satırın altında yazar
    if (!res) return;
    start(async () => {
      const r = await attachCashOutReceipt({ cashOutId: target.id, photoId: res.photo.id });
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      toast.success(`Fiş eklendi: ${cashOutShortLabel(target)} · ${money(target.amount)}`, { description: "Tutar ve kategori değişmedi." });
      setReceiptFor(null);
    });
  }

  function withdraw(id: number) {
    start(async () => {
      const r = await withdrawStaffRequest(id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("İstek geri çekildi");
    });
  }

  const addButtons = (day: string, stacked: boolean) =>
    storage ? (
      <>
        <Button onClick={() => fileRef.current?.click()} disabled={up.busy} className={cn("flex-1 max-sm:min-h-12", stacked ? "w-full" : "sm:flex-none")}>
          <Receipt size={16} aria-hidden="true" /> Fiş ekle
        </Button>
        <Button variant="secondary" onClick={() => open({ mode: "plain" }, day, addRequest(day))} className={cn("flex-1 max-sm:min-h-12", stacked ? "w-full" : "sm:flex-none")}>
          <Plus size={16} aria-hidden="true" /> Fişsiz ekle
        </Button>
      </>
    ) : (
      <Button onClick={() => open({ mode: "plain" }, day, addRequest(day))} className={cn("flex-1 max-sm:min-h-12", stacked ? "w-full" : "sm:flex-none")}>
        <Plus size={16} aria-hidden="true" /> Kasadan çıkan ekle
      </Button>
    );

  return (
    <Card>
      <CardHeader
        icon={<Receipt />}
        title="Gün içinde kasadan çıkanlar"
        description={storage && read ? `${longDateTR(date)} · fişin fotoğrafını çekin; tutar ve KDV kendiliğinden dolar` : `${longDateTR(date)} · market, buz, tamir… kasadan ödenenleri ekleyin`}
        meta={lines.length ? <span className="font-semibold text-ink tabular">{money(total)}</span> : undefined}
      />
      {!admin && locked ? (
        <p className="flex items-start gap-2 border-t border-line bg-panel px-5 py-2.5 text-[13px] leading-5 text-ink-mute">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {CASH_OUT_REQUEST_TEXT.lockedDay}
        </p>
      ) : null}
      {lines.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {lines.map((o) => {
            const label = cashOutLabel(o);
            const mine = ownOn(o.id);
            const other = otherOn(o.id);
            const viaRequest = !admin && (locked || adminLine(o));
            const body = (
              <>
                {o.photoId && showPhotos ? (
                  // eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz
                  <img src={photoUrl(o.photoId)} alt="" loading="lazy" decoding="async" className="size-10 shrink-0 rounded-lg bg-panel object-cover ring-1 ring-line" />
                ) : (
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-mute ring-1 ring-line">
                    <Receipt size={16} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{label}</span>
                  <span className="block truncate text-xs text-ink-mute">{rowSub(o)}</span>
                  {mine ? (
                    <Badge tone="amber" className="mt-1">
                      {mine.view.op === "sil" ? "Silme isteğiniz bekliyor" : "Düzeltme isteğiniz bekliyor"}
                    </Badge>
                  ) : other ? (
                    <Badge tone="gray" className="mt-1">
                      {genitive(other.requestedByName)} isteği bekliyor
                    </Badge>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-medium text-ink tabular">{money(o.amount)}</span>
              </>
            );
            // Fotoğrafsız alışveriş satırına fiş (onaysız): personelin gördüğü günde
            const receiptButton =
              staffActs && storage && o.kind === "harcama" && o.photoId === null ? (
                <div className="px-5 pb-2.5 pl-[4.25rem]">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || receiptUp.busy}
                    onClick={() => {
                      setReceiptFor(o);
                      receiptRef.current?.click();
                    }}
                    className="pointer-coarse:min-h-11"
                  >
                    <ImagePlus size={14} aria-hidden="true" /> {receiptUp.busy && receiptFor?.id === o.id ? "Yükleniyor…" : "Fiş fotoğrafı ekle"}
                  </Button>
                  {receiptUp.phase.kind === "error" && receiptFor?.id === o.id ? <p className="mt-1 text-[13px] leading-5 text-bad">{receiptUp.phase.message}</p> : null}
                </div>
              ) : null;
            return (
              <li key={o.id}>
                {canEdit || (staffActs && viaRequest) ? (
                  <button
                    type="button"
                    onClick={() => open({ mode: "edit", line: o }, o.date, viaRequest ? { reason: locked ? "locked" : "admin", pendingOp: mine?.view.op ?? null } : null)}
                    className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-panel/60 pointer-coarse:min-h-11"
                  >
                    {body}
                  </button>
                ) : o.photoId && showPhotos ? (
                  <button
                    type="button"
                    onClick={() => setViewer({ id: o.photoId!, caption: photoCaption("fis", o.createdAt, o.createdByName) })}
                    className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-panel/60 pointer-coarse:min-h-11"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-5 py-2.5">{body}</div>
                )}
                {receiptButton}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-line px-5 py-4 text-sm text-ink-mute">
          {reported && reported.amount > 0
            ? `Fişi eklenmiş çıkış yok; raporda ${money(reported.amount)}${reported.note ? ` (${reported.note})` : ""} yazılı.`
            : today
              ? "Bugün kasadan para çıkmadı."
              : "Bu gün kasadan para çıkmadı."}
        </p>
      )}
      {ownAdds.length ? (
        <ul className="divide-y divide-line border-t border-line" aria-label="Onay bekleyen eklemeler">
          {ownAdds.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 text-sm opacity-80">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-ink">{r.view.line ? `${cashOutLabel(r.view.line)} · ${money(r.view.line.amount)}` : CASH_OUT_OP_LABEL[r.view.op]}</span>
                <span className="block text-xs text-ink-mute">
                  Onay bekliyor · {CASH_OUT_OP_LABEL[r.view.op]}
                  {r.view.line?.photo ? " · fişli" : ""}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => withdraw(r.id)} disabled={pending} className="pointer-coarse:min-h-11">
                <Undo2 size={14} aria-hidden="true" /> Geri çek
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit || (staffActs && locked) ? (
        <div className={cn("flex gap-2 border-t border-line px-5 py-4", !admin && locked ? "flex-col" : "flex-wrap")}>{addButtons(date, !admin && locked)}</div>
      ) : null}
      {!admin && oldDays.length ? (
        <div className="space-y-2.5 border-t border-line px-5 py-3">
          {!oldOpen ? (
            <Button variant="ghost" size="sm" onClick={() => setOldOpen(true)} className="-ml-2 px-2 text-ink-soft pointer-coarse:min-h-11">
              <CalendarPlus size={15} aria-hidden="true" /> Eski bir güne ekle
            </Button>
          ) : (
            <>
              <p className="text-[13px] leading-5 text-ink-mute">Hangi güne? Yönetici onaylayınca o günün kasasına işlenir.</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Eski gün">
                {oldDays.map((d) => (
                  <Button key={d} size="sm" variant={oldDay === d ? "primary" : "secondary"} onClick={() => setOldDay(d)} aria-pressed={oldDay === d} className="pointer-coarse:min-h-11">
                    {shortDayTR(d)}
                  </Button>
                ))}
              </div>
              {oldDay ? <div className="flex flex-col gap-2 sm:flex-row">{addButtons(oldDay, true)}</div> : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOldOpen(false);
                  setOldDay(null);
                }}
                className="-ml-2 px-2 text-ink-mute"
              >
                Vazgeç
              </Button>
            </>
          )}
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} />
      <input ref={receiptRef} type="file" accept="image/*" hidden onChange={(e) => void onReceipt(e)} />
      {dialog ? (
        <CashOutDialog
          key={dialog.key}
          open
          mode={dialog.mode}
          date={dialog.day}
          categories={categories}
          admin={admin}
          me={me}
          request={dialog.request}
          phase={dialog.mode.mode === "photo" ? up.phase : { kind: "idle" }}
          uploaded={dialog.mode.mode === "photo" ? uploaded : null}
          onRetry={(id) => void retry(id)}
          onClose={close}
        />
      ) : null}
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </Card>
  );
}
