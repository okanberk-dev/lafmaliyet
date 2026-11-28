"use client";

import { KeyRound, ReceiptTurkishLira } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { SameAsToggle } from "@/components/panel/same-as-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";
import { asilYoneticiNotu } from "@/lib/asil-yonetici";
import type { ModposSetting } from "@/lib/branch-settings/groups";
import { ASILPOS_SECRET_MIN } from "@/lib/asilpos/secret-rules";
import { dayMonthYearTR } from "@/lib/asilpos/switch";
import { isStepUpError } from "@/lib/step-up";
import { saveAsilposSecret } from "@/server/actions/branch-settings";
import type { SecretState } from "@/server/branch-settings";
import type { BranchSettingView } from "@/server/branch-settings-view";

import { ModposFallbackSwitch } from "../../ayarlar/modpos-client";

/** AsilPOS kartının verisi: geçiş günü ve anahtarın yalnız durumu (anahtarın kendisi tarayıcıya hiç gelmez) */
export interface AsilposBranchData {
  branchId: string;
  switchDay: string | null;
  /** Panelde saklanan anahtarın durumu */
  stored: SecretState;
  /** Kullanılan anahtar nereden ("panel", "ortam"); yoksa null */
  source: "panel" | "ortam" | null;
  /** Kullanılan anahtarın sorunu (yok, kısa, sitenin anahtarıyla aynı); null: bağlantı açık */
  problem: "missing" | "short" | "same_as_site" | "same_as_other_branch" | null;
  /** Ortamda anahtarın okunduğu değişkenin adı (sahip yeni adı eklemediyse eski adı; src/lib/asilpos/env.ts posEnvName) */
  envName: string;
  /** Kütükte kasa kaynağı hâlâ ModPOS (AsilPOS'un şubesi geri düşüşle bu şube; föyün yedek çekimi sürüyor) */
  sourceModpos: boolean;
  /** Şubenin günleri sayılıyor mu (kasası AsilPOS: posTillIds); değilse yalnız kurulum yapılmış, günleri deneme */
  till: boolean;
  /**
   * Eski tek kasalı kurulumun şubesi mi (Marina, LEGACY_POS_BRANCH_ID): yalnız onda paneldeki anahtar yokken ortamdaki
   * kullanılır (src/server/asilpos/branch.ts readKeys). Öbür şubede anahtar silinirse kasa bağlantısız kalır
   */
  legacy: boolean;
}

const PROBLEM_TEXT = {
  missing: "Anahtar yok: AsilPOS'un gönderdiği gün sonları reddedilir",
  short: "Sunucudaki anahtar 32 karakterden kısa: bağlantı kapalı",
  same_as_site: "Sunucudaki anahtar sitenin anahtarıyla aynı: bağlantı kapalı",
  same_as_other_branch: "Anahtar başka bir şubenin AsilPOS anahtarıyla aynı: bağlantı kapalı, yeni anahtar kaydedin",
} as const;

// Teknik adlar yalnız `tech`'te (ekran gövdesinde geliştirici sözcüğü yok; tests/uyari-goc.test.ts)
const secretTech = (envName: string) => `Panelde saklanan anahtar sunucudaki ${envName}'ın önüne geçer; AsilPOS'ta LAFMALIYET_SYNC_SECRET aynı olmalı.`; // tech-metni

/** Anahtar silinince ne olur: Marina'da sunucudaki eski anahtar, öbür şubede kasa bağlantısız kalır */
const dropText = (legacy: boolean) => (legacy ? "Sunucudaki anahtar kullanılır." : "Bu şubenin kasası bağlantısız kalır: yeni anahtar kaydedin ya da kurulum kodu gönderin.");

/**
 * Şube ayarları › AsilPOS (şube ayarı SUBE_AYAR_GRUBU; docs/SUBE.md › Şube başına ayarlar): kasası AsilPOS olan ya da
 * AsilPOS kurulumu yapılmış şubede. Geçiş günü Ayarlar › AsilPOS'ta değişir (denetimleri orada); burada yalnız gösterilir.
 * Anahtar panelde şifreli saklanır, AsilPOS'taki LAFMALIYET_SYNC_SECRET ile aynı olmalıdır; her şubenin kasası kendi
 * anahtarını kullanır (çok şube). Ortamdaki ASILPOS_SYNC_SECRET yalnız eski kurulumun şubesine (Marina) hizmet eder,
 * onun da saklanan anahtarı yokken (`legacy`); öbür şubede anahtar silinirse kasa bağlantısız kalır. Saklanan anahtar bir
 * daha gösterilmez; yalnız "kayıtlı" der, değiştirilir ya da silinir. "Diğer şubeyle aynı" yok: anahtar şubeyi tanıtır.
 * Değiştirmek ve silmek yalnız asıl yöneticide (`anaAdmin`; sunucu aynı denetimi yapar): öteki yöneticiye alan ve
 * düğmeler kapalı, nedeni yazılı.
 */
export function AsilposBranchCard({ data, anaAdmin = false }: { data: AsilposBranchData; anaAdmin?: boolean }) {
  const [secret, setSecret] = useState("");
  /** Parola penceresi: yeni anahtarı kaydet ya da paneldekini sil */
  const [ask, setAsk] = useState<"save" | "drop" | null>(null);
  const short = secret.trim().length > 0 && secret.trim().length < ASILPOS_SECRET_MIN;

  async function save(value: string | null, password: string): Promise<string | null> {
    const res = await saveAsilposSecret({ branchId: data.branchId, secret: value }, { password });
    if (!res.ok) {
      // Parola hataları pencerede kalır; öteki hatalar bildirimle
      if (isStepUpError(res.error)) return res.error;
      setAsk(null);
      toast.error(res.error);
      return null;
    }
    setSecret("");
    setAsk(null);
    toast.success(res.data.saved ? "AsilPOS anahtarı kaydedildi" : "Paneldeki AsilPOS anahtarı silindi", {
      description: res.data.saved ? "AsilPOS'taki bağlantı anahtarı da aynı olmalı." : dropText(data.legacy),
    });
    return null;
  }

  const status =
    data.problem === null
      ? { tone: "green" as const, text: data.source === "panel" ? "Panelde kayıtlı" : "Sunucuda kayıtlı" }
      : { tone: data.problem === "missing" ? ("gray" as const) : ("amber" as const), text: data.problem === "missing" ? "Anahtar yok" : "Anahtar kullanılmıyor" };

  return (
    <Card id="asilpos" className="scroll-mt-20">
      <CardHeader icon={<KeyRound />} title="AsilPOS bağlantısı" description="Bu şubenin kasası AsilPOS: gün sonu, personel ve ürünler AsilPOS'un imzalı istekleriyle gelir." />
      <div className="space-y-3 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <span className="min-w-0 flex-1 basis-48 text-ink">
            <span className="text-ink-mute">Geçiş günü:</span> {data.switchDay ? dayMonthYearTR(data.switchDay) : "yok (kasa ModPOS sayılır)"}
          </span>
          <ButtonLink href={`/panel/ayarlar?sube=${encodeURIComponent(data.branchId)}#asilpos`} variant="secondary" size="sm" className="max-sm:w-full">
            Ayarlar › AsilPOS
          </ButtonLink>
        </div>
        {data.sourceModpos ? (
          <Notice
            tone="neutral"
            size="sm"
            title="Kasa kaynağı Şubeler'de hâlâ ModPOS"
            text={
              data.till
                ? "AsilPOS'un gün sonları yine bu şubeye yazılır; ModPOS föyü yalnız yedektir, geçiş gününden sonra hesaba girmez."
                : "AsilPOS'un gün sonları saklanır ama hiçbir hesaba girmez (deneme). Şubeler'de kasa kaynağı AsilPOS olunca geçiş gününden itibaren sayılır."
            }
          />
        ) : null}
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={status.tone} dot>
            {status.text}
          </Badge>
          {data.problem ? <span className="text-[13px] text-ink-mute">{PROBLEM_TEXT[data.problem]}</span> : null}
        </p>
        {data.stored === "unreadable" ? (
          <Notice
            tone="warn"
            size="sm"
            title="Paneldeki anahtar açılamıyor"
            text={`Sunucunun şifreleme anahtarı değişmiş olabilir; anahtarı yeniden girin. ${data.legacy ? "O zamana dek sunucudaki anahtar kullanılır." : "O zamana dek bu şubenin kasasının istekleri reddedilir."}`}
            tech="AUTH_SECRET değişti"
          />
        ) : null}
        <Field
          label={data.stored === "saved" ? "Anahtarı değiştir" : "Anahtarı panelde sakla"}
          htmlFor="asilpos-anahtar"
          hint={anaAdmin ? `En az ${ASILPOS_SECRET_MIN} karakter; AsilPOS'taki bağlantı anahtarıyla aynı. Şifreli saklanır, bir daha gösterilmez.` : asilYoneticiNotu("kasaAnahtari")}
          error={short ? `En az ${ASILPOS_SECRET_MIN} karakter` : undefined}
        >
          <PasswordInput
            id="asilpos-anahtar"
            toggleLabels={{ show: "Anahtarı göster", hide: "Anahtarı gizle" }}
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            disabled={!anaAdmin}
            aria-invalid={short ? true : undefined}
          />
        </Field>
        {data.legacy ? (
          <Notice tone="neutral" size="sm" title="Anahtar nereden okunur" text="Panelde saklanan anahtar sunucudakinin önüne geçer; silinirse sunucudaki kullanılır." tech={secretTech(data.envName)} />
        ) : (
          <Notice
            tone="neutral"
            size="sm"
            title="Anahtar nereden okunur"
            text="Yalnız burada saklanan anahtar kullanılır. Silinirse kasa bağlantısız kalır: yeni anahtar ya da kurulum kodu gerekir."
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAsk("save")} disabled={!anaAdmin || !secret.trim() || short} className="max-sm:w-full">
            Kaydet
          </Button>
          {data.stored !== "none" ? (
            <Button variant="secondary" onClick={() => setAsk("drop")} disabled={!anaAdmin} className="max-sm:w-full">
              Paneldeki anahtarı sil
            </Button>
          ) : null}
        </div>
      </div>
      {ask ? (
        <ConfirmPasswordDialog
          title={ask === "save" ? "AsilPOS anahtarı kaydedilsin mi?" : "Paneldeki AsilPOS anahtarı silinsin mi?"}
          description={
            ask === "save"
              ? "Kaydedince AsilPOS'un istekleri bu anahtarla denetlenir; AsilPOS'taki bağlantı anahtarı aynı değilse gün sonları reddedilir. Parolanızla onaylayın."
              : data.legacy
                ? "Bundan sonra sunucudaki anahtar kullanılır; o yoksa AsilPOS'un istekleri reddedilir. Parolanızla onaylayın."
                : "Bu şubenin kasasının istekleri reddedilir (bağlantısız kalır); yeni anahtar ya da kurulum kodu gerekir. Parolanızla onaylayın."
          }
          confirmLabel={ask === "save" ? "Kaydet" : "Sil"}
          danger={ask === "drop"}
          onClose={() => setAsk(null)}
          onConfirm={(password) => save(ask === "save" ? secret.trim() : null, password)}
        />
      ) : null}
    </Card>
  );
}

/**
 * Kasası artık AsilPOS olmayan (ve kurulumu olmayan) şubede kalan, panelde saklanmış AsilPOS anahtarı: kullanılmaz ama
 * kasa kaynağı AsilPOS'a dönerse yine geçerli olurdu. Burada yalnız silinir (parolayla); öbür şubelerin anahtarları değişmez
 */
export function AsilposOldSecretCard({ branchId, anaAdmin = false }: { branchId: string; anaAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Card id="asilpos" className="scroll-mt-20">
      <CardHeader icon={<KeyRound />} title="Eski AsilPOS anahtarı" description="Bu şubenin kasası artık AsilPOS değil, ama panelde saklanan AsilPOS anahtarı duruyor. Kullanılmıyor; silebilirsiniz." />
      <div className="space-y-2 px-5 pb-5">
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={!anaAdmin} className="max-sm:w-full">
          Paneldeki eski AsilPOS anahtarını sil
        </Button>
        {anaAdmin ? null : <p className="text-[13px] text-ink-mute">{asilYoneticiNotu("kasaAnahtari")}</p>}
      </div>
      {open ? (
        <ConfirmPasswordDialog
          title="Eski AsilPOS anahtarı silinsin mi?"
          description="Anahtar bu şubeden silinir; öbür şubelerin AsilPOS anahtarları değişmez. Parolanızla onaylayın."
          confirmLabel="Sil"
          danger
          onClose={() => setOpen(false)}
          onConfirm={async (password) => {
            const res = await saveAsilposSecret({ branchId, secret: null }, { password });
            if (!res.ok) {
              if (isStepUpError(res.error)) return res.error;
              setOpen(false);
              toast.error(res.error);
              return null;
            }
            setOpen(false);
            toast.success("Eski AsilPOS anahtarı silindi");
            return null;
          }}
        />
      ) : null}
    </Card>
  );
}

/** ModPOS kartının verisi: ay yedeği (şube ayarı modpos) ve anahtarın yalnız durumu (anahtar ortamda) */
export interface ModposBranchData {
  view: BranchSettingView<ModposSetting>;
  /** Şubenin anahtarının ortam adı (MODPOS_API_KEY, MODPOS_API_KEY_MARINA) */
  keyEnv: string;
  /** Anahtarın sorunu (yok, bozuk, başka şubeyle aynı); null: tanımlı */
  keyProblem: string | null;
  /** Şubenin kasası ModPOS'tan çekiliyor; false: yalnız başka şube bu şubenin ay yedeğini kullandığı için çizilir */
  ownTill: boolean;
}

/**
 * Şube ayarları › ModPOS (şube ayarı modpos; docs/MODPOS-API.md › Şubeler): yalnız kasası ModPOS olan şubede. Anahtar
 * şube başına ortamda durur (burada yalnız durumu); ay rakamına yedek şube başına, "Diğer şubeyle aynı" ile. Günlerin
 * çekimi ve durumu Ayarlar › ModPOS API'de.
 */
export function ModposBranchCard({ data }: { data: ModposBranchData }) {
  const { view } = data;
  const linked = view.link?.mode.kind === "linked";
  return (
    <Card id="modpos" className="scroll-mt-20">
      <CardHeader
        icon={<ReceiptTurkishLira />}
        title="ModPOS"
        description={
          data.ownTill
            ? "Bu şubenin kasası ModPOS: kasa föyü her sabah ModPOS API'den çekilir."
            : `Bu şubenin kasası ModPOS'tan çekilmiyor; ay yedeği ayarı ${view.link?.sharedWith.join(", ") ?? ""} için burada tutulur.`
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {data.ownTill ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 basis-48">
              <Badge tone={data.keyProblem ? "amber" : "green"} dot>
                {data.keyProblem ? "Anahtar sorunlu" : "Anahtar tanımlı"}
              </Badge>
            </span>
            <ButtonLink href={`/panel/ayarlar?sube=${encodeURIComponent(view.branchId)}#modpos`} variant="secondary" size="sm" className="max-sm:w-full">
              Ayarlar › ModPOS API
            </ButtonLink>
          </div>
        ) : null}
        {data.keyProblem ? <Notice tone="warn" size="sm" title="ModPOS anahtarı sorunlu" text="Ayrıntı ve ne yapılacağı Ayarlar › ModPOS API'de." tech={data.keyEnv} /> : null}
        <SameAsToggle link={view.link} branchId={view.branchId} branchName={view.branchName} group="modpos" what="ay yedeği" anchor="modpos" />
        {linked ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink ring-1 ring-line">
            <span className="text-ink-mute">Ay rakamına yedek:</span> {view.value.monthFallback ? "açık" : "kapalı"}
          </p>
        ) : (
          <ModposFallbackSwitch on={view.value.monthFallback} branchId={view.branchId} />
        )}
      </div>
    </Card>
  );
}
