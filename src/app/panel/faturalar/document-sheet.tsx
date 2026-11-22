"use client";

import { Camera, Download, ExternalLink, FileText, FileWarning, ImageIcon, LoaderCircle, Paperclip, RotateCw, Share2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { keepScroll } from "@/components/ui/filters";
import { SHEET_BTN } from "@/components/ui/mobile-filters";
import { useIsPhone } from "@/components/ui/use-media";
import { formatBytes } from "@/lib/documents";
import { dateTimeTR, dateTR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteInvoiceDocument } from "@/server/actions/invoices";
import type { DocumentMeta } from "@/server/documents";

import { documentKind, documentUrl, isParasutDocument, uploadPlan, type DocumentKind } from "./document-rules";
import { canShareFile, loadDocument, prepareDocument, uploadDocument, type LoadedDocument } from "./document-upload";
import { splitSupplier, type InvoiceRow } from "./rules";

// ---------------------------------------------------------------- Yükleme (sayfa ve fatura penceresi ortak)

export type UploadPhase = { kind: "idle" } | { kind: "preparing" } | { kind: "uploading"; size: number } | { kind: "error"; message: string };

/** Seçilen dosyayı hazırlar (gerekirse küçültür) ve faturaya yükler; aşama ekranda gösterilir */
export function useDocumentUpload() {
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const busy = phase.kind === "preparing" || phase.kind === "uploading";

  async function upload(invoiceId: number, file: File): Promise<DocumentMeta | null> {
    if (uploadPlan(file).action === "compress") setPhase({ kind: "preparing" });
    const prepared = await prepareDocument(file);
    if (!prepared.ok) {
      setPhase({ kind: "error", message: prepared.error });
      return null;
    }
    return send(invoiceId, prepared.file);
  }

  /** Önceden hazırlanmış dosyayı yükler (yeni faturada kayıttan sonra) */
  async function send(invoiceId: number, file: File): Promise<DocumentMeta | null> {
    setPhase({ kind: "uploading", size: file.size });
    const res = await uploadDocument(invoiceId, file);
    if (!res.ok) {
      setPhase({ kind: "error", message: res.error });
      return null;
    }
    setPhase({ kind: "idle" });
    return res.document;
  }

  return { phase, busy, upload, send, setPhase };
}

/** Yükleme aşaması: küçültülüyor / yükleniyor (ekran okuyucuya duyurulur) ve hata */
export function UploadStatus({ phase, className }: { phase: UploadPhase; className?: string }) {
  if (phase.kind === "error") {
    return (
      <p role="alert" className={cn("text-[13px] leading-5 text-bad", className)}>
        {phase.message}
      </p>
    );
  }
  return (
    <p aria-live="polite" className={cn("flex items-center gap-2 text-[13px] text-ink-mute empty:hidden", className)}>
      {phase.kind === "preparing" ? (
        <>
          <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" /> Fotoğraf küçültülüyor…
        </>
      ) : phase.kind === "uploading" ? (
        <>
          <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" /> Yükleniyor… {formatBytes(phase.size)}
        </>
      ) : null}
    </p>
  );
}

/**
 * "Fotoğraf çek" (dokunmatik ekranda; arka kamera açılır) ve "Belge ekle" (PDF ya da fotoğraf seçilir). Dosya
 * seçilince `onPick` çağrılır; aynı dosya yeniden seçilebilsin diye alan boşaltılır.
 */
export function DocumentPicker({ onPick, disabled, className }: { onPick: (file: File) => void; disabled?: boolean; className?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPick(file);
  };
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button variant="secondary" disabled={disabled} onClick={() => cameraRef.current?.click()} className="flex-1 text-ink pointer-fine:hidden max-sm:min-h-12">
        <Camera size={16} aria-hidden="true" /> Fotoğraf çek
      </Button>
      <Button variant="secondary" disabled={disabled} onClick={() => fileRef.current?.click()} className="flex-1 text-ink max-sm:min-h-12">
        <Paperclip size={16} aria-hidden="true" /> Belge ekle
      </Button>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={pick} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </div>
  );
}

// ---------------------------------------------------------------- Belge sayfası

/** Sayfada gösterilen belge: Paraşüt'ün asıl belgesi ya da saklanan bir dosya */
interface Entry {
  key: string;
  url: string;
  /** Belirli dosya; null = faturanın asıl belgesi (Paraşüt e-fatura PDF'i) */
  docId: number | null;
  label: string;
  sub: string;
  kind: DocumentKind | null;
  deletable: boolean;
}

type Loaded = { url: string; attempt: number; doc: LoadedDocument; objectUrl: string | null };

/** Önizleme alanının boyu: masaüstünde PDF okunacak kadar yüksek, telefonda içeriğe göre */
const PREVIEW_BOX = "rounded-2xl bg-panel ring-1 ring-line sm:h-[min(62vh,40rem)]";

/**
 * Faturanın belgesi (telefonda alttan açılan sayfa). PDF masaüstünde sayfanın içinde, telefonda büyük "PDF'i aç"
 * düğmesiyle yeni sekmede (iOS PDF'i kendisi gösterir); fotoğraf satır içinde. İndir, Paylaş, Yeni sekmede aç;
 * yüklenen dosyalar listesi (silinebilir) ve "Fotoğraf çek" / "Belge ekle".
 *
 * Belge bir kez indirilir (fetch): yanıt JSON hatasıysa metni gösterilir; başarılıysa önizleme bu kopyadan
 * (blob adresi) çizilir. Sunucu her yanıtta X-Frame-Options: DENY gönderdiği için /api adresi çerçeve içinde
 * açılamazdı; aynı kopya "Paylaş"ta dosya olarak da kullanılır.
 */
export function DocumentSheet({ invoice, documents, onClose }: { invoice: InvoiceRow; documents: DocumentMeta[]; onClose: () => void }) {
  const phone = useIsPhone();
  const router = useRouter();
  const base = splitSupplier(invoice.supplier).base;
  const linked = isParasutDocument(invoice);

  // Bu açılışta eklenen / silinen dosyalar, sunucunun yenilenen listesi gelene kadar burada tutulur
  const [added, setAdded] = useState<DocumentMeta[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const docs = useMemo(() => {
    const known = new Set(documents.map((d) => d.id));
    return [...added.filter((d) => !known.has(d.id)), ...documents].filter((d) => !removed.includes(d.id));
  }, [documents, added, removed]);
  const parasutDoc = docs.find((d) => d.source === "parasut") ?? null;

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    if (linked) {
      out.push({
        key: "main",
        url: documentUrl(invoice.id),
        docId: null,
        label: invoice.eInvoiceId ? "E-fatura PDF'i" : "Paraşüt belgesi",
        sub: parasutDoc ? `Paraşüt · ${formatBytes(parasutDoc.size)}` : "Paraşüt'ten alınır",
        kind: parasutDoc ? documentKind(parasutDoc.mime) : invoice.eInvoiceId ? "pdf" : null,
        deletable: false,
      });
    }
    const stored = docs.filter((d) => !(linked && d.source === "parasut"));
    const wordOf = (d: DocumentMeta) => (d.source === "parasut" ? "Paraşüt belgesi" : documentKind(d.mime) === "pdf" ? "PDF" : "Fotoğraf");
    for (const d of stored) {
      const kind = documentKind(d.mime);
      const word = wordOf(d);
      // Aynı türden birden çok dosya numaralanır: en eskisi 1 (liste yeniden eskiye)
      const same = stored.filter((x) => wordOf(x) === word);
      const n = same.length > 1 ? same.length - same.indexOf(d) : null;
      out.push({
        key: `d${d.id}`,
        url: documentUrl(invoice.id, { docId: d.id }),
        docId: d.id,
        label: n ? `${word} ${n}` : word,
        sub: [formatBytes(d.size), dateTimeTR(d.createdAt), d.source === "upload" ? d.uploadedBy : null].filter(Boolean).join(" · "),
        kind,
        deletable: d.source === "upload",
      });
    }
    return out;
  }, [docs, linked, invoice.id, invoice.eInvoiceId, parasutDoc]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const current = entries.find((e) => e.key === selectedKey) ?? entries[0] ?? null;
  const url = current?.url ?? null;
  const isMain = current?.docId === null;

  // Seçili belge indirilir; yeniden denemede `attempt` artar
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const fallbackName = `fatura-${invoice.id}`;
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    loadDocument(url, fallbackName, { signal: ctrl.signal, fresh: isMain }).then(
      (doc) => {
        if (ctrl.signal.aborted) return;
        setLoaded({ url, attempt, doc, objectUrl: doc.ok ? URL.createObjectURL(doc.blob) : null });
      },
      () => {
        if (ctrl.signal.aborted) return;
        setLoaded({ url, attempt, doc: { ok: false, status: 0, error: "Belge yarıda kesildi; yeniden deneyin.", retryable: true }, objectUrl: null });
      },
    );
    return () => ctrl.abort();
  }, [url, attempt, fallbackName, isMain]);
  // Önceki kopya bellekten bırakılır
  const objectUrl = loaded?.objectUrl ?? null;
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );
  const view = loaded && loaded.url === url && loaded.attempt === attempt ? loaded : null;
  const ready = view?.doc.ok ? view.doc : null;
  const kind = ready ? documentKind(ready.mime) : null;
  const shareFile = useMemo(() => (ready ? new File([ready.blob], ready.fileName, { type: ready.mime }) : null), [ready]);
  const shareable = shareFile ? canShareFile(shareFile) : false;

  function share() {
    if (!shareFile) return;
    // Dokunuşun hemen içinde çağrılır (iOS, beklemeden sonra paylaşım menüsünü açmaz)
    navigator.share({ files: [shareFile], title: `${base} faturası` }).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error("Paylaşılamadı; dosyayı indirip paylaşın.");
    });
  }

  const refreshList = () => {
    keepScroll();
    startTransition(() => router.refresh());
  };

  const up = useDocumentUpload();
  async function onPick(file: File) {
    const doc = await up.upload(invoice.id, file);
    if (!doc) return;
    setAdded((a) => [doc, ...a]);
    setSelectedKey(`d${doc.id}`);
    toast.success("Belge eklendi", { description: `${documentKind(doc.mime) === "pdf" ? "PDF" : "Fotoğraf"} · ${formatBytes(doc.size)}` });
    refreshList();
  }

  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [deletePending, startDelete] = useActionTransition();
  function confirmDelete() {
    const target = deleting;
    if (!target?.docId) return;
    const id = target.docId;
    keepScroll();
    startDelete(async () => {
      // Sunucu eylemi listeyi kendisi yeniler (refresh)
      const res = await deleteInvoiceDocument(id);
      if (!res.ok) return void toast.error(res.error);
      setRemoved((r) => [...r, id]);
      setDeleting(null);
      // Asıl belge (adres değişmez) silinen dosyayı gösteriyor olabilir: Paraşüt belgesi yoksa son yükleme döner
      setAttempt((a) => a + 1);
      toast.success("Belge silindi", { description: target.label });
    });
  }

  const loadingText = current?.key === "main" && !parasutDoc ? "Belge Paraşüt'ten alınıyor… İlk açılış birkaç saniye sürebilir." : "Belge açılıyor…";

  let preview: ReactNode;
  if (!current) {
    preview = (
      <div className={cn(PREVIEW_BOX, "flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center")}>
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-ink-mute ring-1 ring-line-strong" aria-hidden="true">
          <Paperclip size={22} />
        </span>
        <p className="text-[15px] font-medium text-ink">Bu faturanın belgesi yok</p>
        <p className="max-w-xs text-sm text-pretty text-ink-mute">Kâğıt faturanın fotoğrafını çekin ya da PDF&apos;ini ekleyin; burada saklanır, istediğinizde açıp paylaşırsınız.</p>
      </div>
    );
  } else if (!view) {
    preview = (
      <div className={cn(PREVIEW_BOX, "flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center")} aria-busy="true">
        <LoaderCircle size={24} className="animate-spin text-ink-mute" aria-hidden="true" />
        <p className="max-w-xs text-sm text-pretty text-ink-mute" role="status">
          {loadingText}
        </p>
      </div>
    );
  } else if (!view.doc.ok) {
    const failed = view.doc;
    preview = (
      <div className={cn(PREVIEW_BOX, "flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center")}>
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-warn ring-1 ring-line-strong" aria-hidden="true">
          <FileWarning size={22} />
        </span>
        <p role="alert" className="max-w-sm text-sm text-pretty text-ink-soft">
          {failed.error}
        </p>
        {failed.retryable ? (
          <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCw size={14} aria-hidden="true" /> Yeniden dene
          </Button>
        ) : null}
      </div>
    );
  } else if (kind === "image" && view.objectUrl) {
    preview = (
      <a href={current.url} target="_blank" rel="noopener" className={cn(PREVIEW_BOX, "flex items-center justify-center overflow-hidden p-2")} title="Yeni sekmede büyüt">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob adresi, next/image gereksiz */}
        <img src={view.objectUrl} alt={`${base} faturasının fotoğrafı`} className="max-h-[50dvh] w-auto max-w-full rounded-xl object-contain sm:max-h-full" />
      </a>
    );
  } else if (kind === "pdf" && phone) {
    preview = (
      <a
        href={current.url}
        target="_blank"
        rel="noopener"
        className={cn(PREVIEW_BOX, "flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center transition-transform active:scale-[0.99]")}
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-surface text-ink ring-1 ring-line-strong" aria-hidden="true">
          <FileText size={26} />
        </span>
        <span className="text-[17px] font-semibold text-ink">PDF&apos;i aç</span>
        <span className="max-w-full truncate text-xs text-ink-mute">
          {view.doc.fileName} · {formatBytes(view.doc.blob.size)}
        </span>
      </a>
    );
  } else if (kind === "pdf" && view.objectUrl) {
    preview = <iframe src={view.objectUrl} title={`Belge önizlemesi: ${view.doc.fileName}`} className={cn(PREVIEW_BOX, "block h-[60dvh] w-full bg-surface")} />;
  } else {
    preview = (
      <div className={cn(PREVIEW_BOX, "flex min-h-52 flex-col items-center justify-center gap-2 p-6 text-center")}>
        <p className="text-sm text-ink-soft">Bu dosya burada gösterilemiyor; indirip açın.</p>
        <p className="text-xs text-ink-mute">{view.doc.fileName}</p>
      </div>
    );
  }

  const footer = ready && current ? (
    <>
      {phone && kind === "pdf" ? null : (
        <a href={current.url} target="_blank" rel="noopener" className={buttonClass("ghost", "md", SHEET_BTN)}>
          <ExternalLink size={16} aria-hidden="true" /> Yeni sekmede aç
        </a>
      )}
      {shareable ? (
        <Button variant="secondary" onClick={share} className={cn("text-ink", SHEET_BTN)}>
          <Share2 size={16} aria-hidden="true" /> Paylaş
        </Button>
      ) : null}
      <a href={documentUrl(invoice.id, { docId: current.docId, download: true })} download={ready.fileName} className={buttonClass("primary", "md", SHEET_BTN)}>
        <Download size={16} aria-hidden="true" /> İndir
      </a>
    </>
  ) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Belge"
      description={[base, dateTR(invoice.date), invoice.invoiceNo ? `No ${invoice.invoiceNo}` : null].filter(Boolean).join(" · ")}
      footer={footer}
    >
      <div className="grid gap-4 pb-2 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">{preview}</div>
        <div className="min-w-0 space-y-4">
          {entries.length ? (
            <section aria-labelledby="belge-dosyalar">
              <h3 id="belge-dosyalar" className="mb-1.5 text-[13px] font-medium text-ink-soft">
                Dosyalar <span className="text-ink-mute tabular">{entries.length}</span>
              </h3>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
                {entries.map((e) => {
                  const on = e.key === current?.key;
                  return (
                    <li key={e.key} className={cn("flex items-center gap-1 pr-1.5 transition-colors", on ? "bg-panel" : "hover:bg-panel/50")}>
                      <button
                        type="button"
                        onClick={() => setSelectedKey(e.key)}
                        aria-pressed={on}
                        className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-2 pl-3 text-left"
                      >
                        <span
                          className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-line-strong ring-inset", on ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-mute")}
                          aria-hidden="true"
                        >
                          {e.kind === "image" ? <ImageIcon size={15} /> : <FileText size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{e.label}</span>
                          <span className="block truncate text-xs text-ink-mute tabular">{e.sub}</span>
                        </span>
                      </button>
                      {e.deletable ? (
                        <IconButton label={`${e.label} dosyasını sil`} tone="danger" onClick={() => setDeleting(e)}>
                          <Trash2 size={15} />
                        </IconButton>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="belge-ekle" className="space-y-2">
            <h3 id="belge-ekle" className="text-[13px] font-medium text-ink-soft">
              {docs.length || ready ? "Başka dosya ekle" : "Belge ekle"}
            </h3>
            <DocumentPicker onPick={(f) => void onPick(f)} disabled={up.busy} />
            <UploadStatus phase={up.phase} />
            <p className="text-xs leading-5 text-ink-mute">PDF ya da fotoğraf, en çok 4 MB. Büyük fotoğraflar yüklenmeden önce küçültülür.</p>
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => (deletePending ? undefined : setDeleting(null))}
        onConfirm={confirmDelete}
        pending={deletePending}
        title="Dosya silinsin mi?"
        confirmLabel="Dosyayı sil"
        description={deleting ? `${deleting.label} (${deleting.sub}) kalıcı olarak silinir; geri alınamaz.` : null}
      />
    </Dialog>
  );
}
