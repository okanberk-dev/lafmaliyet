"use client";

import { Building2, Copy, Globe, Plus, Send, Settings2 } from "lucide-react";
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
import {
  BRANCH_ID_MAX,
  BRANCH_KIND_LABEL,
  BRANCH_KINDS,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCE_LABEL,
  BRANCH_POS_SOURCES,
  branchIdError,
  branchSourceError,
  DEFAULT_POS_RATE,
  FIXED_BRANCH_IDS,
  posRateError,
  suggestBranchId,
  type BranchKind,
  type BranchPosSource,
  type BranchRow,
} from "@/lib/branches";
import { hasFeature, offFeatureLabels } from "@/lib/branch-features";
import { parseNumberTR } from "@/lib/calc/expr";
import { num } from "@/lib/format";
import { shortDateTR } from "@/lib/takvim";
import { KURULUM_DURUM_ETIKET } from "@/lib/asilpos/kurulum";
import { POS_OFF_CONFIRM_PREFIX } from "@/lib/pos/tills";
import type { ActionResult } from "@/server/actions/util";
import type { KurulumView } from "@/server/asilpos/kurulum";

/** Kapalı özelliklerin çip metni (yoksa null; `offFeatureLabels`) */
function offFeatures(b: BranchRow): string | null {
  const off = offFeatureLabels(b);
  return off.length ? off.join(", ") : null;
}

/*
 * Şubeler ve kanallar (/panel/subeler; docs/SUBE.md). Liste + tek pencere: "Şube ekle" ve satıra dokununca
 * "Düzenle". Kurallar saf dosyadan (src/lib/branches.ts) okunur, böylece pencere sunucuyla aynı şeyi söyler:
 * kimlik bir daha değişmez, Tuzla ve laffogato.net silinemez / kapatılamaz, online kanalın kasası olmaz. Şubenin banka
 * POS oranı da burada (yüzde olarak yazılır, %2 varsayılan): banka POS komisyonu şube şube kart × bu oran.
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
  createAction: (input: {
    id: string;
    name: string;
    kind: BranchKind;
    posSource: BranchPosSource;
    openedOn: string | null;
    posRate?: number;
    email?: string;
  }) => Promise<ActionResult<{ id: string; kurulum: KurulumSonuc | null }>>;
  updateAction: (input: {
    id: string;
    name: string;
    kind: BranchKind;
    posSource: BranchPosSource;
    openedOn: string | null;
    active: boolean;
    posRate?: number;
    /** Kasası AsilPOS olan şube ModPOS'a dönerken onay (sunucu posOffConfirmText ile sorar) */
    confirmPosOff?: boolean;
  }) => Promise<ActionResult<{ id: string }>>;
  deleteAction: (input: { id: string }) => Promise<ActionResult<{ id: string }>>;
}

const BOS: Taslak = { id: "", name: "", kind: "fiziksel", posSource: "modpos", openedOn: "", active: true, posRate: oranMetni(DEFAULT_POS_RATE), email: "" };

/** Şube kurulumunun sonucu (docs/ASILPOS.md › Şube kurulumu): bağlantı ekranda da gösterilir, e-posta gitmezse elle iletilir */
export type KurulumSonuc = { link: string; mailError: string | null; account: "acildi" | "vardi" };
export type InstallAction = (input: { id: string; email?: string }) => Promise<ActionResult<KurulumSonuc>>;

/**
 * `settingsText`, `parasutText`: fiziksel şubenin şube ayarlarının durumu ("Kendi ayarı", "Tuzla ile aynı"; kasa raporu
 * alıcıları ve Paraşüt hesabı);
 * satırda çip ve "Ayarlar" bağlantısı (docs/SUBE.md › Şube başına ayarlar)
 */
export function BranchesAdmin({
  rows,
  settingsText = {},
  parasutText = {},
  createAction,
  updateAction,
  deleteAction,
  canCreate = false,
  installs = {},
  installAction,
}: {
  rows: BranchRow[];
  settingsText?: Record<string, string>;
  parasutText?: Record<string, string>;
  /** Ana yönetici: şube ekler ve AsilPOS kurulum bağlantısı gönderir */
  canCreate?: boolean;
  /** Fiziksel şubenin son kurulum bağlantısı (yalnız ana yöneticiye) */
  installs?: Record<string, KurulumView | null>;
  installAction?: InstallAction;
} & BranchActions) {
  const [acik, setAcik] = useState<Taslak | null>(null);
  const [sonuc, setSonuc] = useState<{ name: string; kurulum: KurulumSonuc } | null>(null);
  const [yeni, setYeni] = useState(false);
  const [silinecek, setSilinecek] = useState<BranchRow | null>(null);
  // AsilPOS'tan ModPOS'a dönüş onayı (çok şube): sunucunun sorduğu metin ve kaydedilecek taslak
  const [posOff, setPosOff] = useState<{ taslak: Taslak; text: string } | null>(null);
  const [bekliyor, basla] = useActionTransition();

  function duzenle(b: BranchRow) {
    setYeni(false);
    setAcik({ id: b.id, name: b.name, kind: b.kind, posSource: b.posSource, openedOn: b.openedOn ?? "", active: b.active, posRate: oranMetni(b.posRate), email: installs[b.id]?.email ?? "" });
  }

  function ekle() {
    setYeni(true);
    setAcik({ ...BOS });
  }

  function kaydet(t: Taslak, confirmPosOff = false) {
    // Online kanalın kasası yok: POS oranı yalnız fiziksel şubede gider
    const gonder = { name: t.name.trim(), kind: t.kind, posSource: t.posSource, openedOn: t.openedOn || null, ...(t.kind === "fiziksel" ? { posRate: oranOf(t.posRate) } : {}) };
    basla(async () => {
      const sonuc = yeni
        ? await createAction({ ...gonder, id: t.id.trim(), ...(t.kind === "fiziksel" && t.email.trim() ? { email: t.email.trim() } : {}) })
        : await updateAction({ ...gonder, id: t.id, active: t.active, ...(confirmPosOff ? { confirmPosOff } : {}) });
      if (!sonuc.ok) {
        // Kasası AsilPOS olan şube ModPOS'a dönüyor: geçiş günü silinecek, onay sorulur
        if (!yeni && !confirmPosOff && sonuc.error.startsWith(POS_OFF_CONFIRM_PREFIX)) return void setPosOff({ taslak: t, text: sonuc.error.slice(POS_OFF_CONFIRM_PREFIX.length).trim() });
        toast.error(sonuc.error);
        return;
      }
      setPosOff(null);
      toast.success(yeni ? "Şube eklendi" : "Şube güncellendi");
      setAcik(null);
      const kurulum = yeni ? (sonuc.data as { kurulum?: KurulumSonuc | null }).kurulum : null;
      if (kurulum) setSonuc({ name: t.name.trim(), kurulum });
    }, yeni ? { maybeSaved: true } : undefined);
  }

  function kurulumGonder(t: Taslak) {
    if (!installAction) return;
    basla(async () => {
      const r = await installAction({ id: t.id, ...(t.email.trim() ? { email: t.email.trim() } : {}) });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setAcik(null);
      setSonuc({ name: t.name, kurulum: r.data });
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
          description="Ciro, kasa ve giderler bu listeye göre ayrılır. Menü ve reçeteler ortaktır."
          actions={
            canCreate ? (
              <Button onClick={ekle} size="sm">
                <Plus className="size-4" /> Şube ekle
              </Button>
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
                  {installs[b.id] ? <Badge tone={installs[b.id]!.durum === "kuruldu" ? "green" : installs[b.id]!.durum === "bekliyor" ? "blue" : "gray"}>AsilPOS: {KURULUM_DURUM_ETIKET[installs[b.id]!.durum]}</Badge> : null}
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
          <EmptyState title="Henüz şube yok" description={canCreate ? "İlk şubeyi ekleyin." : "Şubeyi ana yönetici ekler."} action={canCreate ? <Button onClick={ekle}>Şube ekle</Button> : undefined} />
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
          kurulum={canCreate ? { view: installs[acik.id] ?? null, onSend: installAction ? kurulumGonder : undefined } : undefined}
        />
      ) : null}

      {sonuc ? <KurulumDialog name={sonuc.name} kurulum={sonuc.kurulum} onClose={() => setSonuc(null)} /> : null}

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
  yeni,
  rows,
  bekliyor,
  onClose,
  onSave,
  onDelete,
  kurulum,
}: {
  taslak: Taslak;
  yeni: boolean;
  rows: BranchRow[];
  bekliyor: boolean;
  onClose: () => void;
  onSave: (t: Taslak) => void;
  onDelete?: () => void;
  /** Ana yöneticiye: şubenin e-postası ve AsilPOS kurulumu (yoksa alan çizilmez) */
  kurulum?: { view: KurulumView | null; onSend?: (t: Taslak) => void };
}) {
  const [t, setT] = useState(taslak);
  const sabit = FIXED_BRANCH_IDS.includes(t.id);
  const idHata = yeni ? branchIdError(t.id) : null;
  const kaynakHata = branchSourceError(t.kind, t.posSource);
  const adHata = t.name.trim() ? null : "Şube adı gerekli";
  const oranHata = t.kind === "fiziksel" ? posRateError(oranOf(t.posRate)) : null;
  const hata = adHata ?? idHata ?? kaynakHata ?? oranHata;

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
        {yeni ? null : (
          <Checkbox
            label="Açık"
            checked={t.active}
            disabled={sabit}
            onChange={(e) => setT((o) => ({ ...o, active: e.target.checked }))}
          />
        )}
        {kurulum && t.kind === "fiziksel" ? (
          <div className="space-y-3 border-t border-line pt-4">
            <Field
              label="Şubenin e-postası"
              htmlFor="sube-eposta"
              hint={
                yeni
                  ? "Yazılırsa şubenin panel hesabı açılır ve AsilPOS kurulum bağlantısı bu adrese gider. Boş bırakılabilir."
                  : "Kurulum bağlantısı ve şubenin panel hesabı bu adresle."
              }
            >
              <Input id="sube-eposta" type="email" inputMode="email" autoComplete="off" value={t.email} onChange={(e) => setT((o) => ({ ...o, email: e.target.value }))} />
            </Field>
            {!yeni && kurulum.view ? (
              <p className="text-[13px] text-ink-soft">
                AsilPOS: {KURULUM_DURUM_ETIKET[kurulum.view.durum]}
                {kurulum.view.usedAt ? ` · ${shortDateTR(kurulum.view.usedAt.slice(0, 10))}` : ""}
              </p>
            ) : null}
            {!yeni && kurulum.onSend ? (
              <Button variant="secondary" size="sm" onClick={() => kurulum.onSend!(t)} disabled={bekliyor || !t.email.trim()}>
                <Send className="size-4" /> AsilPOS kurulum bağlantısı gönder
              </Button>
            ) : null}
          </div>
        ) : null}
        {rows.length && yeni ? <p className="text-xs text-ink-mute">Şu anki şubeler: {rows.map((r) => r.name).join(" · ")}</p> : null}
      </div>
    </Dialog>
  );
}

/** Şube kurulumunun sonucu: bağlantı (kopyalanır), e-posta gittiyse adresi, gitmediyse nedeni */
export function KurulumDialog({ name, kurulum, onClose }: { name: string; kurulum: KurulumSonuc; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${name}: AsilPOS kurulumu`}
      description={kurulum.mailError ? `E-posta gitmedi (${kurulum.mailError}). Bağlantıyı şubeye kendiniz iletin.` : "Kurulum bağlantısı ve panel hesabı şubenin e-postasına gönderildi."}
      footer={<Button onClick={onClose}>Tamam</Button>}
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink-soft">
          Bağlantı kasa bilgisayarında açılır; inen dosya AsilPOS&apos;u kurar ve kasa şubeye kendiliğinden bağlanır. Tek kurulumluktur, 14 gün geçerlidir.
          {kurulum.account === "acildi" ? " Şubenin panel hesabı açıldı (davet e-postayla)." : ""}
        </p>
        <code className="block break-all rounded-lg bg-surface-soft p-3 text-[12px] text-ink">{kurulum.link}</code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(kurulum.link).then(() => toast.success("Bağlantı kopyalandı"), () => toast.error("Kopyalanamadı"));
          }}
        >
          <Copy className="size-4" /> Bağlantıyı kopyala
        </Button>
      </div>
    </Dialog>
  );
}
