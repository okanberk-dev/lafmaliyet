"use client";

import { Building2, Globe, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { KonsolNotu } from "@/components/panel/konsol-notu";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import {
  BRANCH_KIND_LABEL,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCE_LABEL,
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
import type { ActionResult } from "@/server/actions/util";

/** Kapalı özelliklerin çip metni (yoksa null; `offFeatureLabels`) */
function offFeatures(b: BranchRow): string | null {
  const off = offFeatureLabels(b);
  return off.length ? off.join(", ") : null;
}

/*
 * Şubeler ve kanallar (/panel/subeler; docs/SUBE.md). Liste + satıra dokununca "Düzenle" penceresi. Kurallar saf
 * dosyadan (src/lib/branches.ts) okunur, böylece pencere sunucuyla aynı şeyi söyler: kimlik bir daha değişmez, online
 * kanalın kasası olmaz. Burada her yönetici şubenin adını, açılış gününü, banka POS oranını ve e-postasını düzenler.
 * Şube açmak, kapatmak, silmek, türü ve kasa programı Yönetim konsolunda (docs/planlar/yonetim-konsolu.md › K-C): pencere
 * bunları salt okunur gösterir ve hiç göndermez (updateBranch verilmeyen alanın eskisini korur); yerlerinde "Bu iş
 * Yönetim konsolunda yapılır", asıl yöneticiye konsolun ilgili sayfasına bağlantıyla (sunucu da reddeder, requireAnaAdmin).
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

/**
 * Pencerenin gönderdiği alanlar: tür, kasa programı ve açık / kapalı hiç gitmez (Yönetim konsolunda değişir; sunucuda
 * eskisi kalır). Silme de konsolda
 */
export interface BranchActions {
  updateAction: (input: {
    id: string;
    name?: string;
    openedOn?: string | null;
    posRate?: number;
    /** Şubenin e-postası (fiziksel; boş metin siler, verilmezse eskisi kalır) */
    email?: string;
  }) => Promise<ActionResult<{ id: string }>>;
}

/**
 * Yönetim konsoluna bağlantılar (yalnız sayfayı açan asıl yöneticiye; sunucu src/lib/yonetim-host.ts › panelden ile
 * kurar): Şubeler ve kasalar ve her şubenin Şube işlemleri sayfası. Öteki yöneticiye null: yalnız cümle
 */
export interface KonsolBaglantilari {
  subeler: string;
  sube: Record<string, string>;
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
  konsol = null,
}: {
  rows: BranchRow[];
  settingsText?: Record<string, string>;
  parasutText?: Record<string, string>;
  /** Şubelerin kayıtlı e-postası (düzenleme penceresi buradan dolar) */
  emails?: Record<string, string | null>;
  /** Yönetim konsoluna bağlantılar (yalnız asıl yöneticiye) */
  konsol?: KonsolBaglantilari | null;
} & BranchActions) {
  const [acik, setAcik] = useState<Taslak | null>(null);
  const [bekliyor, basla] = useActionTransition();

  function duzenle(b: BranchRow) {
    setAcik({ id: b.id, name: b.name, kind: b.kind, posSource: b.posSource, openedOn: b.openedOn ?? "", active: b.active, posRate: oranMetni(b.posRate), email: emails[b.id] ?? "" });
  }

  /** Açık / kapalı, tür ve kasa programı gitmez: Yönetim konsolunda değişir, sunucuda eskisi kalır */
  function kaydet(t: Taslak) {
    // Online kanalın kasası yok: POS oranı ve e-posta yalnız fiziksel şubede gider
    const fiziksel = t.kind === "fiziksel";
    const gonder = {
      id: t.id,
      name: t.name.trim(),
      openedOn: t.openedOn || null,
      ...(fiziksel ? { posRate: oranOf(t.posRate), email: t.email.trim() } : {}),
    };
    basla(async () => {
      const sonuc = await updateAction(gonder);
      if (!sonuc.ok) {
        toast.error(sonuc.error);
        return;
      }
      toast.success("Şube güncellendi");
      setAcik(null);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Building2 />}
          title="Şubeler ve kanallar"
          description="Ciro, kasa ve giderler bu listeye göre ayrılır."
          meta={<KonsolNotu href={konsol?.subeler ?? null} konu="Şube açmak ve kasa kurmak" />}
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
          <EmptyState title="Henüz şube yok" action={<KonsolNotu href={konsol?.subeler ?? null} konu="Şube açmak" />} />
        )}
      </Card>

      {acik ? (
        <BranchDialog taslak={acik} konsolUrl={konsol?.sube[acik.id] ?? null} bekliyor={bekliyor} onClose={() => setAcik(null)} onSave={kaydet} />
      ) : null}
    </div>
  );
}

function BranchDialog({
  taslak,
  konsolUrl,
  bekliyor,
  onClose,
  onSave,
}: {
  taslak: Taslak;
  /** Şubenin Yönetim konsolundaki Şube işlemleri sayfası (yalnız asıl yöneticiye; öteki yöneticiye null) */
  konsolUrl: string | null;
  bekliyor: boolean;
  onClose: () => void;
  onSave: (t: Taslak) => void;
}) {
  const [t, setT] = useState(taslak);
  const sabit = FIXED_BRANCH_IDS.includes(t.id);
  const adHata = t.name.trim() ? null : "Şube adı gerekli";
  const oranHata = t.kind === "fiziksel" ? posRateError(oranOf(t.posRate)) : null;
  const epostaHata = t.kind === "fiziksel" && t.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email.trim()) ? "E-posta adresi geçersiz" : null;
  const hata = adHata ?? oranHata ?? epostaHata;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t.name || taslak.name}
      description={`Kimlik: ${t.id} (değişmez)`}
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
            hint="Şubenin panel hesabı ve kasa kurulum bağlantısı bu adresle. Kaydetmek hesap açmaz, bağlantı göndermez (kasa kurulumu Yönetim konsolunda)."
          >
            <Input id="sube-eposta" type="email" inputMode="email" autoComplete="off" value={t.email} onChange={(e) => setT((o) => ({ ...o, email: e.target.value }))} />
          </Field>
        ) : null}
        {/* Salt okunur: tür, kasa programı ve açık / kapalı Yönetim konsolunda değişir (pencere bunları göndermez) */}
        <div className="space-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-ink-mute">Tür</dt>
            <dd className="text-ink">{BRANCH_KIND_LABEL[t.kind]}</dd>
            <dt className="text-ink-mute">Kasa programı</dt>
            <dd className="text-ink">{BRANCH_POS_SOURCE_LABEL[t.posSource]}</dd>
            <dt className="text-ink-mute">Durum</dt>
            <dd className="text-ink">{t.active ? "Açık" : "Kapalı"}</dd>
          </dl>
          <KonsolNotu href={konsolUrl} konu={sabit ? "Tür ve kasa programı" : "Kapatmak, silmek, tür ve kasa programı"} />
        </div>
      </div>
    </Dialog>
  );
}
