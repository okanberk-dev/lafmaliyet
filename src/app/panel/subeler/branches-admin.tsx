"use client";

import { Building2, Globe, MonitorDown, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { asilYoneticiNotu } from "@/lib/asil-yonetici";
import {
  BRANCH_KIND_LABEL,
  BRANCH_KINDS,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCE_LABEL,
  BRANCH_POS_SOURCES,
  branchSourceError,
  DEFAULT_POS_RATE,
  FIXED_BRANCH_IDS,
  posRateError,
  type BranchKind,
  type BranchPosSource,
  type BranchRow,
} from "@/lib/branches";
import { hasFeature, offFeatureLabels } from "@/lib/branch-features";
import { parseNumberTR } from "@/lib/calc/expr";
import { num } from "@/lib/format";
import { shortDateTR } from "@/lib/takvim";
import { POS_OFF_CONFIRM_PREFIX } from "@/lib/pos/tills";
import type { ActionResult } from "@/server/actions/util";

/** Kapalı özelliklerin çip metni (yoksa null; `offFeatureLabels`) */
function offFeatures(b: BranchRow): string | null {
  const off = offFeatureLabels(b);
  return off.length ? off.join(", ") : null;
}

/*
 * Şubeler ve kanallar (/panel/subeler; docs/SUBE.md). Liste + satıra dokununca "Düzenle" penceresi. Kurallar saf
 * dosyadan (src/lib/branches.ts) okunur, böylece pencere sunucuyla aynı şeyi söyler: kimlik bir daha değişmez, Tuzla ve
 * laffogato.net silinemez / kapatılamaz, online kanalın kasası olmaz. Şubenin banka POS oranı ve e-postası da burada (her
 * yönetici). Şube açmak ve kasa kurmak Şube ekleme sayfasında; kapatmak, silmek ve kasa programını (türünü) değiştirmek
 * yalnız asıl yöneticide: öteki yöneticiye o alanlar kapalı ve nedeni yazılı (sunucu aynı denetimi yapar, requireAnaAdmin).
 */

/** `posRate`: yüzde metni ("2", "1,5"); kaydederken 0,02 gibi orana çevrilir */
type Taslak = { id: string; name: string; kind: BranchKind; posSource: BranchPosSource; openedOn: string; active: boolean; posRate: string; email: string };

/** Oran → yüzde metni: 0,02 → "2", 0,015 → "1,5" */
const oranMetni = (rate: number | undefined) => num((rate ?? DEFAULT_POS_RATE) * 100, 2);
/** Yüzde metni → oran (okunamazsa NaN: hata gösterilir) */
const oranOf = (text: string) => {
  const v = parseNumberTR(text.replace(/%/g, ""));
  return v === null ? Number.NaN : Math.round(v * 100) / 10_000;
};

export interface BranchActions {
  updateAction: (input: {
    id: string;
    name: string;
    kind: BranchKind;
    posSource: BranchPosSource;
    openedOn: string | null;
    active: boolean;
    posRate?: number;
    /** Şubenin e-postası (fiziksel; boş metin siler, verilmezse eskisi kalır) */
    email?: string;
    /** Kasası AsilPOS olan şube ModPOS'a dönerken onay (sunucu posOffConfirmText ile sorar) */
    confirmPosOff?: boolean;
  }) => Promise<ActionResult<{ id: string }>>;
  deleteAction: (input: { id: string }) => Promise<ActionResult<{ id: string }>>;
}

/**
 * `settingsText`, `parasutText`: fiziksel şubenin şube ayarlarının durumu ("Kendi ayarı", "Tuzla ile aynı"; kasa raporu
 * alıcıları ve Paraşüt hesabı);
 * satırda çip ve "Ayarlar" bağlantısı (docs/SUBE.md › Şube başına ayarlar)
 */
export function BranchesAdmin({
  rows,
  settingsText = {},
  parasutText = {},
  emails = {},
  updateAction,
  deleteAction,
  anaAdmin = false,
}: {
  rows: BranchRow[];
  settingsText?: Record<string, string>;
  parasutText?: Record<string, string>;
  /** Şubelerin kayıtlı e-postası (düzenleme penceresi buradan dolar) */
  emails?: Record<string, string | null>;
  /** Asıl yönetici: şubeyi kapatır, siler, kasa programını değiştirir; Şube ekleme bağlantısı */
  anaAdmin?: boolean;
} & BranchActions) {
  const [acik, setAcik] = useState<Taslak | null>(null);
  const [silinecek, setSilinecek] = useState<BranchRow | null>(null);
  // AsilPOS'tan ModPOS'a dönüş onayı (çok şube): sunucunun sorduğu metin ve kaydedilecek taslak
  const [posOff, setPosOff] = useState<{ taslak: Taslak; text: string } | null>(null);
  const [bekliyor, basla] = useActionTransition();

  function duzenle(b: BranchRow) {
    setAcik({ id: b.id, name: b.name, kind: b.kind, posSource: b.posSource, openedOn: b.openedOn ?? "", active: b.active, posRate: oranMetni(b.posRate), email: emails[b.id] ?? "" });
  }

  function kaydet(t: Taslak, confirmPosOff = false) {
    // Online kanalın kasası yok: POS oranı ve e-posta yalnız fiziksel şubede gider
    const fiziksel = t.kind === "fiziksel";
    const gonder = {
      id: t.id,
      name: t.name.trim(),
      kind: t.kind,
      posSource: t.posSource,
      openedOn: t.openedOn || null,
      active: t.active,
      ...(fiziksel ? { posRate: oranOf(t.posRate), email: t.email.trim() } : {}),
      ...(confirmPosOff ? { confirmPosOff } : {}),
    };
    basla(async () => {
      const sonuc = await updateAction(gonder);
      if (!sonuc.ok) {
        // Kasası AsilPOS olan şube ModPOS'a dönüyor: geçiş günü silinecek, onay sorulur
        if (!confirmPosOff && sonuc.error.startsWith(POS_OFF_CONFIRM_PREFIX)) return void setPosOff({ taslak: t, text: sonuc.error.slice(POS_OFF_CONFIRM_PREFIX.length).trim() });
        toast.error(sonuc.error);
        return;
      }
      setPosOff(null);
      toast.success("Şube güncellendi");
      setAcik(null);
    });
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
          description={
            anaAdmin
              ? "Ciro, kasa ve giderler bu listeye göre ayrılır. Yeni şube ve kasa kurulumu Şube ekleme sayfasında."
              : "Ciro, kasa ve giderler bu listeye göre ayrılır. Şube açmak ve kasa kurmak yalnız asıl yöneticinin işidir."
          }
          actions={
            anaAdmin ? (
              <ButtonLink href="/panel/sube-ekleme" size="sm" variant="secondary">
                <MonitorDown className="size-4" aria-hidden="true" /> Şube ekleme
              </ButtonLink>
            ) : undefined
          }
        />
        {rows.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((b) => (
              <li key={b.id} className="flex items-center gap-2 pr-3 hover:bg-surface-soft">
                <button type="button" onClick={() => duzenle(b)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-5 text-left text-sm">
                  <span className="shrink-0 text-ink-mute">{b.kind === "online" ? <Globe className="size-4" /> : <Building2 className="size-4" />}</span>
                  <span className="min-w-0 flex-1 basis-40 font-medium text-ink">{b.name}</span>
                  <Badge tone={b.kind === "online" ? "blue" : "gray"}>{BRANCH_KIND_LABEL[b.kind]}</Badge>
                  <span className="text-[13px] text-ink-soft">{BRANCH_POS_SOURCE_LABEL[b.posSource]}</span>
                  {b.kind === "fiziksel" ? <span className="text-[13px] text-ink-mute tabular">POS %{oranMetni(b.posRate)}</span> : null}
                  {b.openedOn ? <span className="text-[13px] text-ink-mute tabular">{shortDateTR(b.openedOn)} açıldı</span> : null}
                  {b.active ? null : <Badge tone="amber">Kapalı</Badge>}
                  <code className="text-[12px] text-ink-mute">{b.id}</code>
                  {settingsText[b.id] ? <Badge tone="gray">Alıcılar: {settingsText[b.id]}</Badge> : null}
                  {parasutText[b.id] ? <Badge tone="gray">Paraşüt: {parasutText[b.id]}</Badge> : null}
                  {/* Şube özellikleri (docs/SUBE.md › Şube özellikleri): karaoke tek şubede; kapalı özellikler ayrı çipte */}
                  {hasFeature(b, "karaoke") ? <Badge tone="violet">Karaoke</Badge> : null}
                  {offFeatures(b) ? <Badge tone="gray">Kullanılmıyor: {offFeatures(b)}</Badge> : null}
                </button>
                {b.kind === "fiziksel" ? (
                  <ButtonLink href={`/panel/subeler/${encodeURIComponent(b.id)}`} variant="secondary" size="sm" className="shrink-0" aria-label={`${b.name} şube ayarları`}>
                    <Settings2 className="size-4" aria-hidden="true" /> Ayarlar
                  </ButtonLink>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Henüz şube yok"
            description={anaAdmin ? "İlk şubeyi Şube ekleme sayfasından açın." : "Şubeyi asıl yönetici açar."}
            action={anaAdmin ? <ButtonLink href="/panel/sube-ekleme">Şube ekleme</ButtonLink> : undefined}
          />
        )}
      </Card>

      {acik ? (
        <BranchDialog
          taslak={acik}
          anaAdmin={anaAdmin}
          bekliyor={bekliyor}
          onClose={() => setAcik(null)}
          onSave={kaydet}
          onDelete={anaAdmin ? () => setSilinecek(rows.find((r) => r.id === acik.id) ?? null) : undefined}
        />
      ) : null}

      <ConfirmDialog
        open={!!posOff}
        onClose={() => setPosOff(null)}
        onConfirm={() => posOff && kaydet(posOff.taslak, true)}
        pending={bekliyor}
        title="Kasa ModPOS'a dönsün mü?"
        description={posOff?.text ?? ""}
      />

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
  anaAdmin,
  bekliyor,
  onClose,
  onSave,
  onDelete,
}: {
  taslak: Taslak;
  /** Asıl yönetici: tür, kasa programı ve açık / kapalı durumu değişir, şube silinir */
  anaAdmin: boolean;
  bekliyor: boolean;
  onClose: () => void;
  onSave: (t: Taslak) => void;
  /** Yalnız asıl yöneticiye */
  onDelete?: () => void;
}) {
  const [t, setT] = useState(taslak);
  const sabit = FIXED_BRANCH_IDS.includes(t.id);
  const kaynakHata = branchSourceError(t.kind, t.posSource);
  const adHata = t.name.trim() ? null : "Şube adı gerekli";
  const oranHata = t.kind === "fiziksel" ? posRateError(oranOf(t.posRate)) : null;
  const epostaHata = t.kind === "fiziksel" && t.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email.trim()) ? "E-posta adresi geçersiz" : null;
  const hata = adHata ?? kaynakHata ?? oranHata ?? epostaHata;

  /** Tür değişince kasa kaynağı kendiliğinden uyar: online kanalın kasası olmaz */
  function turDegis(kind: BranchKind) {
    setT((o) => ({ ...o, kind, posSource: kind === "online" ? "yok" : o.posSource === "yok" ? "modpos" : o.posSource }));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t.name || taslak.name}
      description={`Kimlik: ${t.id} (değişmez)`}
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
            Kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Şube adı" htmlFor="sube-ad" error={adHata}>
          <Input id="sube-ad" value={t.name} maxLength={BRANCH_NAME_MAX} autoFocus onChange={(e) => setT((o) => ({ ...o, name: e.target.value }))} />
        </Field>
        <Field label="Tür" htmlFor="sube-tur" hint={sabit ? "Bu kaydın türü değiştirilemez." : anaAdmin ? undefined : asilYoneticiNotu("kasaProgrami")}>
          <Select id="sube-tur" value={t.kind} disabled={sabit || !anaAdmin} onChange={(e) => turDegis(e.target.value as BranchKind)}>
            {BRANCH_KINDS.map((k) => (
              <option key={k} value={k}>
                {BRANCH_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kasa kaynağı" htmlFor="sube-kasa" error={kaynakHata} hint={anaAdmin ? "Gün sonu hangi sistemden gelir." : `Gün sonu hangi sistemden gelir. ${asilYoneticiNotu("kasaProgrami")}`}>
          <Select id="sube-kasa" value={t.posSource} disabled={t.kind === "online" || !anaAdmin} onChange={(e) => setT((o) => ({ ...o, posSource: e.target.value as BranchPosSource }))}>
            {BRANCH_POS_SOURCES.map((p) => (
              <option key={p} value={p}>
                {BRANCH_POS_SOURCE_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        {t.kind === "fiziksel" ? (
          <Field
            label="Banka POS oranı (%)"
            htmlFor="sube-pos-orani"
            error={oranHata}
            hint="Bankanın kart satışından kestiği oran. Gelir-gider ve Satışlar'daki banka POS komisyonu = kart tutarı (yemek kartı hariç) × bu oran."
          >
            <NumberInput id="sube-pos-orani" value={t.posRate} onChange={(e) => setT((o) => ({ ...o, posRate: e.target.value }))} />
          </Field>
        ) : null}
        <Field label="Açılış günü" htmlFor="sube-acilis" hint="Boş bırakılırsa “başından beri” sayılır.">
          <Input id="sube-acilis" type="date" value={t.openedOn} onChange={(e) => setT((o) => ({ ...o, openedOn: e.target.value }))} />
        </Field>
        {t.kind === "fiziksel" ? (
          <Field
            label="Şubenin e-postası"
            htmlFor="sube-eposta"
            error={epostaHata}
            hint="Şubenin panel hesabı ve kasa kurulum bağlantısı bu adresle. Kaydetmek hesap açmaz, bağlantı göndermez (Şube ekleme › Bilgisayara kur)."
          >
            <Input id="sube-eposta" type="email" inputMode="email" autoComplete="off" value={t.email} onChange={(e) => setT((o) => ({ ...o, email: e.target.value }))} />
          </Field>
        ) : null}
        <Checkbox
          label="Açık"
          checked={t.active}
          disabled={sabit || !anaAdmin}
          onChange={(e) => setT((o) => ({ ...o, active: e.target.checked }))}
        />
        {!anaAdmin && !sabit ? <Notice tone="neutral" size="sm" title="Kapatmak, silmek ve kasa programını değiştirmek asıl yöneticinin işidir." /> : null}
      </div>
    </Dialog>
  );
}
