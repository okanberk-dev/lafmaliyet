"use client";

import { MonitorDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { BRANCH_ID_MAX, BRANCH_NAME_MAX, BRANCH_POS_SOURCE_LABEL, branchIdError, DEFAULT_POS_RATE, suggestBranchId, type BranchPosSource, type BranchRow } from "@/lib/branches";
import { KURULUM_DURUM_ETIKET } from "@/lib/asilpos/kurulum";
import type { KurulumView } from "@/server/asilpos/kurulum";

import { KurulumDialog, type BranchActions, type InstallAction, type KurulumSonuc } from "./branches-admin";

/*
 * AsilPOS kasası kur (docs/ASILPOS.md › Şube kurulumu; yalnız ana yönetici): kasanın bağlanacağı şube listeden seçilir
 * ya da aynı pencerede yeni şube eklenir; şubenin e-postasına kurulum bağlantısı (ve şube hesabı yoksa davet) gider.
 * Seçilen şube kasanın şube kimliği olur: kasa ilk açılışta ladmin'den bu şubeyi alır.
 */

const YENI = "__yeni__";

type Taslak = { branch: string; email: string; name: string; id: string; posSource: BranchPosSource; openedOn: string };

export function AsilposInstallCard({
  rows,
  installs,
  emails,
  createAction,
  installAction,
}: {
  rows: BranchRow[];
  installs: Record<string, KurulumView | null>;
  /** Şubelerin kayıtlı e-postası (seçilince alan dolar) */
  emails: Record<string, string | null>;
  createAction: BranchActions["createAction"];
  installAction: InstallAction;
}) {
  const subeler = rows.filter((b) => b.kind === "fiziksel" && b.active);
  const [acik, setAcik] = useState<Taslak | null>(null);
  const [sonuc, setSonuc] = useState<{ name: string; kurulum: KurulumSonuc } | null>(null);
  const [bekliyor, basla] = useActionTransition();

  function ac(branch?: string) {
    const b = branch ?? subeler[0]?.id ?? YENI;
    setAcik({ branch: b, email: (b !== YENI && emails[b]) || "", name: "", id: "", posSource: "asilpos", openedOn: "" });
  }

  function gonder(t: Taslak) {
    basla(async () => {
      if (t.branch === YENI) {
        const r = await createAction({ id: t.id.trim(), name: t.name.trim(), kind: "fiziksel", posSource: t.posSource, openedOn: t.openedOn || null, posRate: DEFAULT_POS_RATE, email: t.email.trim() });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setAcik(null);
        toast.success("Şube eklendi");
        if (r.data.kurulum) setSonuc({ name: t.name.trim(), kurulum: r.data.kurulum });
        return;
      }
      const r = await installAction({ id: t.branch, email: t.email.trim() });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setAcik(null);
      setSonuc({ name: subeler.find((b) => b.id === t.branch)?.name ?? t.branch, kurulum: r.data });
    });
  }

  return (
    <>
      <Card>
        <CardHeader
          icon={<MonitorDown />}
          title="AsilPOS kasası kur"
          description="Kasanın bağlanacağı şubeyi seçin ya da yeni şube ekleyin; kurulum bağlantısı şubenin e-postasına gider, kasa kurulunca şubeye kendiliğinden bağlanır."
          actions={
            <Button size="sm" onClick={() => ac()}>
              <MonitorDown className="size-4" /> Kasa kur
            </Button>
          }
        />
        {subeler.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {subeler.map((b) => {
              const k = installs[b.id];
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 pr-3 pl-5 text-sm">
                  <span className="min-w-0 flex-1 basis-32 font-medium text-ink">{b.name}</span>
                  <span className="text-[13px] text-ink-soft">{BRANCH_POS_SOURCE_LABEL[b.posSource]}</span>
                  {k ? <Badge tone={k.durum === "kuruldu" ? "green" : k.durum === "bekliyor" ? "blue" : "gray"}>{KURULUM_DURUM_ETIKET[k.durum]}</Badge> : <Badge tone="gray">Kurulum yok</Badge>}
                  <Button size="sm" variant="secondary" onClick={() => ac(b.id)}>
                    {k?.durum === "kuruldu" ? "Yeniden kur" : "Bağlantı gönder"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      {acik ? <KurDialog taslak={acik} subeler={subeler} emails={emails} bekliyor={bekliyor} onClose={() => setAcik(null)} onSave={gonder} /> : null}
      {sonuc ? <KurulumDialog name={sonuc.name} kurulum={sonuc.kurulum} onClose={() => setSonuc(null)} /> : null}
    </>
  );
}

function KurDialog({
  taslak,
  subeler,
  emails,
  bekliyor,
  onClose,
  onSave,
}: {
  taslak: Taslak;
  subeler: BranchRow[];
  emails: Record<string, string | null>;
  bekliyor: boolean;
  onClose: () => void;
  onSave: (t: Taslak) => void;
}) {
  const [t, setT] = useState(taslak);
  const yeni = t.branch === YENI;
  const epostaHata = t.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email.trim()) ? "E-posta adresi geçersiz" : null;
  const adHata = yeni && !t.name.trim() ? "Şube adı gerekli" : null;
  const idHata = yeni ? branchIdError(t.id) : null;
  const hata = (t.email.trim() ? null : "Şubenin e-postasını yazın") ?? epostaHata ?? adHata ?? idHata;

  return (
    <Dialog
      open
      onClose={onClose}
      title="AsilPOS kasası kur"
      description="Kurulum bağlantısı 14 gün geçerli, tek kurulumluktur; yenisi eskisini iptal eder."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button onClick={() => onSave(t)} disabled={bekliyor || !!hata}>
            {yeni ? "Şubeyi ekle ve gönder" : "Bağlantıyı gönder"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Kasa hangi şubeye bağlanacak" htmlFor="kur-sube" hint="Seçilen şube kasanın şubesi olur: satış, gün sonu ve uzaktan yönetim bu şubeye gider.">
          <Select
            id="kur-sube"
            value={t.branch}
            onChange={(e) => {
              const branch = e.target.value;
              setT((o) => ({ ...o, branch, email: branch !== YENI ? (emails[branch] ?? o.email) : o.email }));
            }}
          >
            {subeler.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value={YENI}>+ Yeni şube ekle</option>
          </Select>
        </Field>
        {yeni ? (
          <div className="space-y-4 rounded-2xl border border-line p-4">
            <Field label="Şube adı" htmlFor="kur-ad" error={adHata}>
              <Input
                id="kur-ad"
                value={t.name}
                maxLength={BRANCH_NAME_MAX}
                onChange={(e) => {
                  const name = e.target.value;
                  setT((o) => ({ ...o, name, id: !o.id || o.id === suggestBranchId(o.name) ? suggestBranchId(name) : o.id }));
                }}
              />
            </Field>
            <Field label="Kimlik" htmlFor="kur-id" error={t.id ? idHata : null} hint="Kayıtlarda geçer, sonradan değişmez. Küçük harf, rakam ve tire.">
              <Input id="kur-id" value={t.id} maxLength={BRANCH_ID_MAX} onChange={(e) => setT((o) => ({ ...o, id: e.target.value }))} />
            </Field>
            <Field
              label="Kasa kaynağı"
              htmlFor="kur-kaynak"
              hint="AsilPOS bugün yalnız bir şubenin gün sonunu alır; o şube başkasıysa ModPOS seçin: kasa yine kurulur ve çalışır, gün sonu panele çoklu AsilPOS gelince girer."
            >
              <Select id="kur-kaynak" value={t.posSource} onChange={(e) => setT((o) => ({ ...o, posSource: e.target.value as BranchPosSource }))}>
                <option value="asilpos">{BRANCH_POS_SOURCE_LABEL.asilpos}</option>
                <option value="modpos">{BRANCH_POS_SOURCE_LABEL.modpos}</option>
              </Select>
            </Field>
            <Field label="Açılış günü" htmlFor="kur-acilis" hint="Boş bırakılabilir.">
              <Input id="kur-acilis" type="date" value={t.openedOn} onChange={(e) => setT((o) => ({ ...o, openedOn: e.target.value }))} />
            </Field>
          </div>
        ) : null}
        <Field label="Şubenin e-postası" htmlFor="kur-eposta" error={epostaHata} hint="Kurulum bağlantısı buraya gider; şubenin panel hesabı yoksa bu adresle açılır.">
          <Input id="kur-eposta" type="email" inputMode="email" autoComplete="off" value={t.email} onChange={(e) => setT((o) => ({ ...o, email: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  );
}
