"use client";

import { Download, ExternalLink, FileBadge, FilePlus2, Paperclip, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, Stat } from "@/components/ui/misc";
import { formatBytes } from "@/lib/documents";
import { dateTR } from "@/lib/format";
import { compressImage } from "@/lib/photo-compress";
import { DOC_KIND_HINT, DOC_KIND_LABEL, DOC_KINDS, docInputProblem, docStage, docStatusText, docTitle, MAX_DOC_BYTES, missingKinds, staffDocUrl, type DocKind } from "@/lib/staff-docs";
import { addStaffDocument, deleteStaffDocument, updateStaffDocument } from "@/server/actions/staff-docs";
import type { StaffDocRow } from "@/server/staff-docs";

/*
 * Personel belgeleri ekranı (docs/PERSONEL-BELGE.md): kişi başına kart; belgenin durumu (süresi doldu, N gün kaldı,
 * geçerli, süresiz, yenilendi), dosyası (yalnız yöneticinin yolundan açılır) ve eylemleri. Ekle / düzelt penceresi tek;
 * fotoğraf telefonda küçültülüp gider, PDF olduğu gibi (en çok 4 MB). Kurallar src/lib/staff-docs.ts'te.
 */

export interface DocsPerson {
  id: number;
  name: string;
  /** Ayrıldı (son ayı geçti ya da pasif): belgeleri hatırlatılmaz, en altta */
  left: boolean;
  /** Birden çok şube varken kişinin şubesi */
  branchName: string | null;
}

type Status = { label: string; tone: Tone };

function statusOf(d: StaffDocRow, today: string): Status {
  if (d.superseded) return { label: "Yenilendi", tone: "gray" };
  const stage = docStage(d.validUntil, today);
  const text = docStatusText(d.validUntil, today);
  if (stage === "expired") return { label: text === "Dün bitti" ? "Süresi dün doldu" : `Süresi doldu · ${text}`, tone: "red" };
  if (stage === "soon") return { label: text, tone: "amber" };
  if (stage === "ok") return { label: "Geçerli", tone: "green" };
  return { label: "Süresiz", tone: "gray" };
}

type Editing = { mode: "add"; staffId: number | null } | { mode: "edit"; doc: StaffDocRow };

export function DocsBoard({ people, docs, today, storage }: { people: DocsPerson[]; docs: StaffDocRow[]; today: string; storage: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<StaffDocRow | null>(null);
  const [pending, setPending] = useState(false);

  const byPerson = useMemo(() => {
    const m = new Map<number, StaffDocRow[]>();
    for (const d of docs) m.set(d.staffId, [...(m.get(d.staffId) ?? []), d]);
    return m;
  }, [docs]);

  const working = people.filter((p) => !p.left);
  const left = people.filter((p) => p.left && byPerson.has(p.id));
  const live = docs.filter((d) => !d.superseded && working.some((p) => p.id === d.staffId));
  const expired = live.filter((d) => docStage(d.validUntil, today) === "expired").length;
  const soon = live.filter((d) => docStage(d.validUntil, today) === "soon").length;
  const missing = working.filter((p) => missingKinds(byPerson.get(p.id) ?? []).length > 0).length;

  const remove = async () => {
    if (!removing) return;
    setPending(true);
    const r = await tryAction(() => deleteStaffDocument(removing.id));
    setPending(false);
    if (!r) return;
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Belge silindi");
    setRemoving(null);
  };

  if (!people.length) {
    return <EmptyState icon={<FileBadge />} title="Henüz çalışan yok" description="Önce Maaşlar'dan çalışanları ekleyin; belgeleri burada kişi kişi girilir." />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Süresi dolan" value={String(expired)} tone={expired ? "bad" : undefined} sub={expired ? "Yenisini ekleyin" : "Yok"} />
        <Stat label="30 gün içinde biten" value={String(soon)} sub={soon ? "Yenileme zamanı" : "Yok"} />
        <Stat label="Belgesi eksik kişi" value={String(missing)} sub="Hijyen, sağlık raporu ya da SGK girilmemiş" />
      </div>
      {!storage ? (
        <p className="rounded-xl bg-note px-4 py-3 text-[13px] leading-5 text-ink-soft">
          Belge deposu bu ortamda kurulu değil: belgeyi dosyasız (yalnız tarihleriyle) kaydedebilirsiniz; hatırlatmalar yine çalışır.
        </p>
      ) : null}

      <div className="space-y-4">
        {working.map((p) => (
          <PersonCard key={p.id} person={p} docs={byPerson.get(p.id) ?? []} today={today} onAdd={() => setEditing({ mode: "add", staffId: p.id })} onEdit={(doc) => setEditing({ mode: "edit", doc })} onRemove={setRemoving} />
        ))}
      </div>

      {left.length ? (
        <details className="rounded-3xl bg-panel">
          <summary className="cursor-pointer px-5 py-4 text-[14px] font-medium text-ink-soft">Ayrılanların belgeleri · {left.length} kişi (hatırlatılmaz)</summary>
          <div className="space-y-4 px-3 pb-3">
            {left.map((p) => (
              <PersonCard key={p.id} person={p} docs={byPerson.get(p.id) ?? []} today={today} onAdd={() => setEditing({ mode: "add", staffId: p.id })} onEdit={(doc) => setEditing({ mode: "edit", doc })} onRemove={setRemoving} />
            ))}
          </div>
        </details>
      ) : null}

      {editing ? <DocDialog editing={editing} people={people} storage={storage} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        pending={pending}
        title="Belge silinsin mi?"
        description={removing ? `${removing.staffName} · ${docTitle(removing)}${removing.hasFile ? " ve dosyası" : ""} kalıcı olarak silinir; geri alınamaz.` : null}
      />
    </div>
  );
}

function PersonCard({
  person,
  docs,
  today,
  onAdd,
  onEdit,
  onRemove,
}: {
  person: DocsPerson;
  docs: StaffDocRow[];
  today: string;
  onAdd: () => void;
  onEdit: (d: StaffDocRow) => void;
  onRemove: (d: StaffDocRow) => void;
}) {
  const missing = person.left ? [] : missingKinds(docs);
  // Güncel belgeler önce, yenilenenler sonda (geçmiş)
  const sorted = [...docs].sort((a, b) => Number(a.superseded) - Number(b.superseded) || (a.validUntil ?? "9999").localeCompare(b.validUntil ?? "9999"));
  return (
    <Card>
      <CardHeader
        title={person.name}
        meta={
          <>
            {person.branchName ? <span>{person.branchName}</span> : null}
            {person.branchName ? <span aria-hidden="true">·</span> : null}
            <span>{docs.length ? `${docs.length} belge` : "Belge yok"}</span>
            {missing.length ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-warn-ink dark:text-brass-300">Eksik: {missing.map((k) => DOC_KIND_LABEL[k]).join(", ")}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <FilePlus2 size={15} aria-hidden="true" /> Belge ekle
          </Button>
        }
      />
      {sorted.length ? (
        <CardContent className="pt-0">
          <ul className="divide-y divide-line rounded-2xl bg-surface">
            {sorted.map((d) => {
              const st = statusOf(d, today);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] leading-5 font-medium text-ink">
                      {docTitle(d)}
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-[13px] leading-5 text-ink-mute">
                      {[d.issuedOn ? `Düzenlenme ${dateTR(d.issuedOn)}` : null, d.validUntil ? `Bitiş ${dateTR(d.validUntil)}` : "Bitişi yok", d.note].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {d.hasFile ? (
                      <>
                        <a
                          href={staffDocUrl(d.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-soft hover:bg-panel hover:text-ink pointer-coarse:h-11"
                          title={d.fileName ?? undefined}
                        >
                          <ExternalLink size={14} aria-hidden="true" /> Aç
                          {d.sizeBytes ? <span className="text-ink-mute">· {formatBytes(d.sizeBytes)}</span> : null}
                        </a>
                        <a
                          href={staffDocUrl(d.id, true)}
                          aria-label={`${docTitle(d)}: indir`}
                          className="inline-flex size-8 items-center justify-center rounded-lg text-ink-mute hover:bg-panel hover:text-ink pointer-coarse:size-11"
                        >
                          <Download size={15} aria-hidden="true" />
                        </a>
                      </>
                    ) : (
                      <span className="px-2 text-[12.5px] text-ink-mute">Dosyasız</span>
                    )}
                    <IconButton label={`${docTitle(d)}: düzelt`} onClick={() => onEdit(d)}>
                      <Pencil size={15} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`${docTitle(d)}: sil`} tone="danger" onClick={() => onRemove(d)}>
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}

/** Dosyayı gönderilecek hâle getirir: fotoğraf küçültülür (açılamazsa olduğu gibi), PDF olduğu gibi */
async function prepareFile(file: File): Promise<{ blob: Blob; name: string } | { error: string }> {
  if (file.type.startsWith("image/")) {
    try {
      const blob = await compressImage(file);
      return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
    } catch {
      // Küçültülemeyen fotoğraf (HEIC gibi): sunucu türünü içerikten denetler
    }
  }
  if (file.size > MAX_DOC_BYTES) return { error: "Dosya 4 MB'tan büyük; fotoğrafı küçültüp yeniden deneyin." };
  return { blob: file, name: file.name };
}

function DocDialog({ editing, people, storage, onClose }: { editing: Editing; people: DocsPerson[]; storage: boolean; onClose: () => void }) {
  const doc = editing.mode === "edit" ? editing.doc : null;
  const [staffId, setStaffId] = useState<string>(editing.mode === "add" && editing.staffId ? String(editing.staffId) : "");
  const [kind, setKind] = useState<DocKind>((doc?.kind as DocKind) ?? "saglik");
  const [label, setLabel] = useState(doc?.label ?? "");
  const [issuedOn, setIssuedOn] = useState(doc?.issuedOn ?? "");
  const [validUntil, setValidUntil] = useState(doc?.validUntil ?? "");
  const [note, setNote] = useState(doc?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = !doc && !staffId ? "Kişi seçin" : docInputProblem({ kind, label, issuedOn: issuedOn || null, validUntil: validUntil || null });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (doc) {
        const r = await tryAction(() => updateStaffDocument(doc.id, { kind, label, issuedOn, validUntil, note }));
        if (!r) return;
        if (!r.ok) return setError(r.error);
        toast.success("Belge düzeltildi");
        onClose();
        return;
      }
      const form = new FormData();
      form.set("kisi", staffId);
      form.set("tur", kind);
      form.set("ad", label);
      form.set("duzenlenme", issuedOn);
      form.set("bitis", validUntil);
      form.set("not", note);
      if (file) {
        const ready = await prepareFile(file);
        if ("error" in ready) return setError(ready.error);
        form.set("dosya", ready.blob, ready.name);
      }
      const r = await tryAction(() => addStaffDocument(form), { maybeSaved: true });
      if (!r) return;
      if (!r.ok) return setError(r.error);
      toast.success("Belge eklendi");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const formId = "personel-belge-formu";
  return (
    <Dialog
      open
      onClose={onClose}
      title={doc ? "Belgeyi düzelt" : "Belge ekle"}
      description={doc ? `${doc.staffName} · dosya değişmez; yeni dosya için yeni belge ekleyin (eskisi "Yenilendi" olur).` : "Geçerlilik bitişini girin: 30 gün kala ve bitince hatırlatılır."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="space-y-4">
        {!doc ? (
          <Field label="Kişi" htmlFor="belge-kisi">
            <Select id="belge-kisi" value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
              <option value="">Seçin</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.left ? " (ayrıldı)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Belge türü" htmlFor="belge-tur" hint={DOC_KIND_HINT[kind]}>
          <Select id="belge-tur" value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
            {DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {DOC_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={kind === "diger" ? "Belgenin adı" : "Ek ad (isteğe bağlı)"} htmlFor="belge-ad">
          <Input id="belge-ad" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={kind === "diger" ? "ör. İş sözleşmesi" : "ör. portör muayenesi"} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Düzenlenme" htmlFor="belge-duzenlenme">
            <Input id="belge-duzenlenme" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </Field>
          <Field label="Geçerlilik bitişi" htmlFor="belge-bitis" hint="Süresizse boş bırakın">
            <Input id="belge-bitis" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
        {!doc ? (
          <Field label="Dosya (isteğe bağlı)" htmlFor="belge-dosya" hint={storage ? "PDF ya da fotoğraf, en çok 4 MB" : "Bu ortamda dosya saklanamıyor; yalnız tarihler kaydedilir"}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-[14px] text-ink-soft ring-1 ring-line-strong hover:text-ink has-[:disabled]:cursor-default has-[:disabled]:opacity-50">
              <Paperclip size={15} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${formatBytes(file.size)}` : "Dosya seçin"}</span>
              <input id="belge-dosya" type="file" accept="application/pdf,image/*" className="sr-only" disabled={!storage} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </Field>
        ) : null}
        <Field label="Not (isteğe bağlı)" htmlFor="belge-not">
          <Textarea id="belge-not" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
        </Field>
        {error ? (
          <p role="alert" className="text-[13px] leading-5 text-bad">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
