"use client";

import { Banknote, Lock, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { usePhotoUpload } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cashOutLabel, cashOutsTotal } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import { photoCaption, photoUrl, type ReadingState } from "@/lib/photo-rules";
import { longDateTR } from "@/lib/reminders";
import { dismissCashOut } from "@/server/actions/cari";
import type { KasaCariHint } from "@/server/data/cari";
import type { CashOutCategory, CashOutView } from "@/server/data/cash-outs";

import { CashOutDialog, type CashOutDialogMode } from "./cash-out-dialog";

const time = (iso: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Personelin, yöneticinin tedarikçi ödemesine bağladığı satırda gördüğü sabit mesaj (tutar ve tedarikçi yok) */
const LOCKED_TEXT = "Bu satır yöneticinin kaydına bağlı; düzeltmek için yöneticiye haber verin.";

/** Satırın ikinci satırı: "14:32 · Ayşe · Nakit malzeme alımı" (harcamaya yazılmadıysa nedeni) */
function rowSub(o: CashOutView): string {
  const tail =
    o.kind === "teslim"
      ? null
      : (o.categoryName ?? (o.expenseEntryId !== null ? "harcamalara yazıldı" : o.docType === "fatura" || o.docType === "e_arsiv" ? "fatura" : "harcamalara eklenmedi"));
  return [time(o.createdAt), o.createdByName, tail].filter(Boolean).join(" · ");
}

/**
 * Gün içinde kasadan çıkanlar: market fişi, buz, tamirci, gün ortası teslim. "Fiş ekle" kamerayı ya da galeriyi açar;
 * fotoğraf yüklenip okunurken pencere açılır ve okunanlar boş alanlara dolar. Akşam raporunun "Gün içinde kasadan
 * çıkan" tutarı bunların toplamından gelir. Satıra dokununca düzeltilir (gün personele açıksa). Fişin fotoğrafını
 * göremeyen (personel, kapanmış gün) küçük resim yerine fiş simgesini görür; satır açılmaz.
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
  supplierNames = [],
  hints = {},
}: {
  date: string;
  today: boolean;
  lines: CashOutView[];
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
  /** Tedarikçilerin adları (pencerenin "Teslim · ödeme" ipucu; yalnız adlar) */
  supplierNames?: string[];
  /** Yalnız yönetici: satırların cari bağı ve önerisi (ödemeye bağlı, Hesaba işle, Ödemeye çevir) */
  hints?: Record<number, KasaCariHint>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Her açılış yeni bir pencere (önceki taslak kalmasın); `shown` açık pencerenin anahtarı (kapalıysa null)
  const opened = useRef(0);
  const shown = useRef<number | null>(null);
  const up = usePhotoUpload();
  const [dialog, setDialog] = useState<{ key: number; mode: CashOutDialogMode } | null>(null);
  const [uploaded, setUploaded] = useState<PhotoUploadResponse | null>(null);
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const total = cashOutsTotal(lines);
  const read = reading === "on";
  const [hintBusy, runHint] = useActionTransition();
  const keepApart = (id: number, label: string) =>
    runHint(async () => {
      const r = await dismissCashOut({ cashOutId: id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Ayrı alım olarak işaretlendi", { description: label });
    });

  const open = (mode: CashOutDialogMode) => {
    // Süren yükleme sıfırlanmaz: "Fiş ekle" o bitene kadar kapalı kalır
    if (!up.busy) up.reset();
    setUploaded(null);
    opened.current += 1;
    shown.current = opened.current;
    setDialog({ key: opened.current, mode });
    return opened.current;
  };
  const close = () => {
    shown.current = null;
    setDialog(null);
  };

  // Yükleme ya da yeniden okuma yalnız onu başlatan pencereye yazılır: pencere kapandıysa ya da yenisi açıldıysa geç
  // gelen yanıt atlanır (iki fişin fotoğrafı ve rakamları karışmasın; fotoğraf bağlanmadığı için 2 günde silinir)
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const key = open({ mode: "photo" });
    const res = await up.upload(file, { kind: "fis", day: date, read });
    if (res && shown.current === key) setUploaded(res);
  }

  async function retry(photoId: number) {
    const key = shown.current;
    const res = await up.reread(photoId, "fis", date);
    if (res && key !== null && shown.current === key) setUploaded(res);
  }

  return (
    <Card>
      <CardHeader
        icon={<Receipt />}
        title="Gün içinde kasadan çıkanlar"
        description={storage && read ? `${longDateTR(date)} · fişin fotoğrafını çekin; tutar ve KDV kendiliğinden dolar` : `${longDateTR(date)} · market, buz, tamir… kasadan ödenenleri ekleyin`}
        meta={lines.length ? <span className="font-semibold text-ink tabular">{money(total)}</span> : undefined}
      />
      {lines.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {lines.map((o) => {
            const label = cashOutLabel(o);
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
                </span>
                {o.locked ? <Lock size={14} className="shrink-0 text-ink-mute" aria-label="Yöneticinin kaydına bağlı" /> : null}
                <span className="shrink-0 text-sm font-medium text-ink tabular">{money(o.amount)}</span>
              </>
            );
            const hint = hints[o.id];
            return (
              <li key={o.id}>
                {canEdit && o.locked ? (
                  <button type="button" onClick={() => toast.info(LOCKED_TEXT)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-panel/60 pointer-coarse:min-h-11">
                    {body}
                  </button>
                ) : canEdit ? (
                  <button type="button" onClick={() => open({ mode: "edit", line: o })} className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-panel/60 pointer-coarse:min-h-11">
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
                {hint ? <CariHintRow hint={hint} id={o.id} busy={hintBusy} onApart={() => keepApart(o.id, `${cashOutLabel(o)} · ${money(o.amount)}`)} /> : null}
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
      {canEdit ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          {storage ? (
            <>
              <Button onClick={() => fileRef.current?.click()} disabled={up.busy} className="flex-1 max-sm:min-h-12 sm:flex-none">
                <Receipt size={16} aria-hidden="true" /> Fiş ekle
              </Button>
              <Button variant="secondary" onClick={() => open({ mode: "plain" })} className="flex-1 max-sm:min-h-12 sm:flex-none">
                <Plus size={16} aria-hidden="true" /> Fişsiz ekle
              </Button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} />
            </>
          ) : (
            <Button onClick={() => open({ mode: "plain" })} className="flex-1 max-sm:min-h-12 sm:flex-none">
              <Plus size={16} aria-hidden="true" /> Kasadan çıkan ekle
            </Button>
          )}
        </div>
      ) : null}
      {dialog ? (
        <CashOutDialog
          key={dialog.key}
          open
          mode={dialog.mode}
          date={date}
          categories={categories}
          admin={admin}
          me={me}
          phase={dialog.mode.mode === "photo" ? up.phase : { kind: "idle" }}
          uploaded={dialog.mode.mode === "photo" ? uploaded : null}
          onRetry={(id) => void retry(id)}
          onClose={close}
          supplierNames={supplierNames}
        />
      ) : null}
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </Card>
  );
}

/**
 * Yöneticinin satır ipucu (docs/KASA-RAPORU.md, §6.8): ödemeye bağlı satır tedarikçinin sayfasına götürür; işlenmemiş
 * Teslim "Hesaba işle", ödeme olabilecek fişsiz alışveriş "Ödemeye çevir" ya da "Ayrı alım" der. Pencereler
 * tedarikçinin sayfasında açılır.
 */
function CariHintRow({ hint, id, busy, onApart }: { hint: KasaCariHint; id: number; busy: boolean; onApart: () => void }) {
  const link = "font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:inline-block pointer-coarse:py-2.5";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 pb-2.5 pl-[4.5rem] text-[13px] leading-5 text-info">
      <Banknote size={14} className="shrink-0" aria-hidden="true" />
      {hint.kind === "linked" ? (
        hint.href ? (
          <Link href={hint.href} className={link}>
            {hint.name} ödemesi
          </Link>
        ) : (
          <span>{hint.name} ödemesi</span>
        )
      ) : hint.kind === "teslim" ? (
        <>
          <span>Tedarikçiye ödeme mi ({hint.name})?</span>
          {hint.href ? (
            <Link href={`${hint.href}?kasa=${id}`} className={link}>
              Hesaba işle
            </Link>
          ) : null}
        </>
      ) : (
        <>
          <span>Tedarikçi ödemesi miydi ({hint.name})?</span>
          {hint.href ? (
            <Link href={`${hint.href}?kasa=${id}`} className={link}>
              Ödemeye çevir
            </Link>
          ) : null}
          <button type="button" onClick={onApart} disabled={busy} className={`${link} cursor-pointer disabled:opacity-50`}>
            Ayrı alım
          </button>
        </>
      )}
    </div>
  );
}
