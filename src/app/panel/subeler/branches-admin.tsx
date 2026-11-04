"use client";

import { Building2, Globe, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import {
  BRANCH_ID_MAX,
  BRANCH_KIND_LABEL,
  BRANCH_KINDS,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCE_LABEL,
  BRANCH_POS_SOURCES,
  branchIdError,
  branchSourceError,
  FIXED_BRANCH_IDS,
  suggestBranchId,
  type BranchKind,
  type BranchPosSource,
  type BranchRow,
} from "@/lib/branches";
import { shortDateTR } from "@/lib/takvim";
import type { ActionResult } from "@/server/actions/util";

/*
 * Şubeler ve kanallar (/panel/subeler; docs/SUBE.md). Liste + tek pencere: "Şube ekle" ve satıra dokununca
 * "Düzenle". Kurallar saf dosyadan (src/lib/branches.ts) okunur, böylece pencere sunucuyla aynı şeyi söyler:
 * kimlik bir daha değişmez, Tuzla ve laffogato.net silinemez / kapatılamaz, online kanalın kasası olmaz.
 */

type Taslak = { id: string; name: string; kind: BranchKind; posSource: BranchPosSource; openedOn: string; active: boolean };

export interface BranchActions {
  createAction: (input: { id: string; name: string; kind: BranchKind; posSource: BranchPosSource; openedOn: string | null }) => Promise<ActionResult<{ id: string }>>;
  updateAction: (input: { id: string; name: string; kind: BranchKind; posSource: BranchPosSource; openedOn: string | null; active: boolean }) => Promise<ActionResult<{ id: string }>>;
  deleteAction: (input: { id: string }) => Promise<ActionResult<{ id: string }>>;
}

const BOS: Taslak = { id: "", name: "", kind: "fiziksel", posSource: "modpos", openedOn: "", active: true };

export function BranchesAdmin({ rows, createAction, updateAction, deleteAction }: { rows: BranchRow[] } & BranchActions) {
  const [acik, setAcik] = useState<Taslak | null>(null);
  const [yeni, setYeni] = useState(false);
  const [silinecek, setSilinecek] = useState<BranchRow | null>(null);
  const [bekliyor, basla] = useActionTransition();

  function duzenle(b: BranchRow) {
    setYeni(false);
    setAcik({ id: b.id, name: b.name, kind: b.kind, posSource: b.posSource, openedOn: b.openedOn ?? "", active: b.active });
  }

  function ekle() {
    setYeni(true);
    setAcik({ ...BOS });
  }

  function kaydet(t: Taslak) {
    const gonder = { name: t.name.trim(), kind: t.kind, posSource: t.posSource, openedOn: t.openedOn || null };
    basla(async () => {
      const sonuc = yeni
        ? await createAction({ ...gonder, id: t.id.trim() })
        : await updateAction({ ...gonder, id: t.id, active: t.active });
      if (!sonuc.ok) {
        toast.error(sonuc.error);
        return;
      }
      toast.success(yeni ? "Şube eklendi" : "Şube güncellendi");
      setAcik(null);
    }, yeni ? { maybeSaved: true } : undefined);
  }

  function sil(b: BranchRow) {
    basla(async () => {
      const sonuc = await deleteAction({ id: b.id });
      if (!sonuc.ok) {
        toast.error(sonuc.error);
        return;
      }
      toast.success("Şube silindi");
      setSilinecek(null);
      setAcik(null);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Building2 />}
          title="Şubeler ve kanallar"
          description="Ciro, kasa ve giderler bu listeye göre ayrılır. Menü ve reçeteler ortaktır."
          actions={
            <Button onClick={ekle} size="sm">
              <Plus className="size-4" /> Şube ekle
            </Button>
          }
        />
        {rows.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => duzenle(b)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left text-sm hover:bg-surface-soft">
                  <span className="shrink-0 text-ink-mute">{b.kind === "online" ? <Globe className="size-4" /> : <Building2 className="size-4" />}</span>
                  <span className="min-w-0 flex-1 basis-40 font-medium text-ink">{b.name}</span>
                  <Badge tone={b.kind === "online" ? "blue" : "gray"}>{BRANCH_KIND_LABEL[b.kind]}</Badge>
                  <span className="text-[13px] text-ink-soft">{BRANCH_POS_SOURCE_LABEL[b.posSource]}</span>
                  {b.openedOn ? <span className="text-[13px] text-ink-mute tabular">{shortDateTR(b.openedOn)} açıldı</span> : null}
                  {b.active ? null : <Badge tone="amber">Kapalı</Badge>}
                  <code className="text-[12px] text-ink-mute">{b.id}</code>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Henüz şube yok" description="İlk şubeyi ekleyin." action={<Button onClick={ekle}>Şube ekle</Button>} />
        )}
      </Card>

      {acik ? (
        <BranchDialog
          taslak={acik}
          yeni={yeni}
          rows={rows}
          bekliyor={bekliyor}
          onClose={() => setAcik(null)}
          onSave={kaydet}
          onDelete={yeni ? undefined : () => setSilinecek(rows.find((r) => r.id === acik.id) ?? null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!silinecek}
        onClose={() => setSilinecek(null)}
        onConfirm={() => silinecek && sil(silinecek)}
        pending={bekliyor}
        title={`${silinecek?.name ?? "Şube"} silinsin mi?`}
        description="Yalnız hiç kaydı olmayan şube silinir. Verisi olan şubeyi silmek yerine kapatın."
      />
    </div>
  );
}

function BranchDialog({
  taslak,
  yeni,
  rows,
  bekliyor,
  onClose,
  onSave,
  onDelete,
}: {
  taslak: Taslak;
  yeni: boolean;
  rows: BranchRow[];
  bekliyor: boolean;
  onClose: () => void;
  onSave: (t: Taslak) => void;
  onDelete?: () => void;
}) {
  const [t, setT] = useState(taslak);
  const sabit = FIXED_BRANCH_IDS.includes(t.id);
  const idHata = yeni ? branchIdError(t.id) : null;
  const kaynakHata = branchSourceError(t.kind, t.posSource);
  const adHata = t.name.trim() ? null : "Şube adı gerekli";
  const hata = adHata ?? idHata ?? kaynakHata;

  /** Tür değişince kasa kaynağı kendiliğinden uyar: online kanalın kasası olmaz */
  function turDegis(kind: BranchKind) {
    setT((o) => ({ ...o, kind, posSource: kind === "online" ? "yok" : o.posSource === "yok" ? "modpos" : o.posSource }));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={yeni ? "Şube ekle" : t.name}
      description={yeni ? "Kimlik eklendikten sonra değişmez: kayıtlar ona bağlanır." : `Kimlik: ${t.id} (değişmez)`}
      footerStart={onDelete && !sabit ? <Button variant="danger" onClick={onDelete} disabled={bekliyor}>
            Sil
          </Button> : undefined}
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button onClick={() => onSave(t)} disabled={bekliyor || !!hata}>
            {yeni ? "Ekle" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Şube adı" htmlFor="sube-ad" error={adHata}>
          <Input
            id="sube-ad"
            value={t.name}
            maxLength={BRANCH_NAME_MAX}
            autoFocus
            onChange={(e) => {
              const name = e.target.value;
              setT((o) => ({ ...o, name, id: yeni && (!o.id || o.id === suggestBranchId(o.name)) ? suggestBranchId(name) : o.id }));
            }}
          />
        </Field>
        {yeni ? (
          <Field label="Kimlik" htmlFor="sube-id" error={idHata} hint="Adreste ve kayıtlarda geçer; sonradan değişmez. Küçük harf, rakam ve tire.">
            <Input id="sube-id" value={t.id} maxLength={BRANCH_ID_MAX} onChange={(e) => setT((o) => ({ ...o, id: e.target.value }))} />
          </Field>
        ) : null}
        <Field label="Tür" htmlFor="sube-tur" hint={sabit ? "Bu kaydın türü değiştirilemez." : undefined}>
          <Select id="sube-tur" value={t.kind} disabled={sabit} onChange={(e) => turDegis(e.target.value as BranchKind)}>
            {BRANCH_KINDS.map((k) => (
              <option key={k} value={k}>
                {BRANCH_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kasa kaynağı" htmlFor="sube-kasa" error={kaynakHata} hint="Gün sonu hangi sistemden gelir.">
          <Select id="sube-kasa" value={t.posSource} disabled={t.kind === "online"} onChange={(e) => setT((o) => ({ ...o, posSource: e.target.value as BranchPosSource }))}>
            {BRANCH_POS_SOURCES.map((p) => (
              <option key={p} value={p}>
                {BRANCH_POS_SOURCE_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Açılış günü" htmlFor="sube-acilis" hint="Boş bırakılırsa “başından beri” sayılır.">
          <Input id="sube-acilis" type="date" value={t.openedOn} onChange={(e) => setT((o) => ({ ...o, openedOn: e.target.value }))} />
        </Field>
        {yeni ? null : (
          <Checkbox
            label="Açık"
            checked={t.active}
            disabled={sabit}
            onChange={(e) => setT((o) => ({ ...o, active: e.target.checked }))}
          />
        )}
        {rows.length && yeni ? <p className="text-xs text-ink-mute">Şu anki şubeler: {rows.map((r) => r.name).join(" · ")}</p> : null}
      </div>
    </Dialog>
  );
}
