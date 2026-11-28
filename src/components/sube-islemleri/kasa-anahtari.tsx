"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { KonsolNotu } from "@/components/panel/konsol-notu";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";
import { ASILPOS_SECRET_MIN } from "@/lib/asilpos/secret-rules";
import { dayMonthYearTR } from "@/lib/asilpos/switch";
import { isStepUpError } from "@/lib/step-up";
import { saveAsilposSecret } from "@/server/actions/branch-settings";
import type { SecretState } from "@/server/branch-settings";

/*
 * Şubenin kasa anahtarı (docs/SUBE.md › Şube başına ayarlar, docs/ASILPOS.md › Şubeler): iki yerde aynı bileşen. Yönetim
 * konsolunda Şubeler ve kasalar › şube (/yonetim/sube/[id]) anahtar döndürülür ve silinir (saveAsilposSecret,
 * parolayla; yalnız konsol oturumuyla geçer). ladmin'de Şubeler › şube › AsilPOS bağlantısı (/panel/subeler/[id])
 * yalnız durumu gösterir: alan ve düğmeler yerine "Bu iş Yönetim konsolunda yapılır" (docs/planlar/yonetim-konsolu.md ›
 * K-C), asıl yöneticiye konsolun şube sayfasına bağlantı (`konsolUrl`). Konsolda ladmin'e bağlantı yok, geçiş günü aynı
 * sayfada kendi kartında. `canli`: son günlerde kasadan gün sonu gelen şubede (konsol) kartta ve parola penceresinde
 * belirgin uyarı.
 */

/** Bileşenin çizildiği yer: ladmin (Şube ayarları) ya da Yönetim konsolu (Şube işlemleri) */
export type SubeIslemYeri = "ladmin" | "konsol";

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

/** Kasa kaynağı hâlâ ModPOS notu: ladmin'de Şubeler'in alanını, konsolda aynı sayfadaki kasa programını anar */
const MODPOS_NOTU = {
  ladmin: {
    title: "Kasa kaynağı Şubeler'de hâlâ ModPOS",
    deneme: "AsilPOS'un gün sonları saklanır ama hiçbir hesaba girmez (deneme). Şubeler'de kasa kaynağı AsilPOS olunca geçiş gününden itibaren sayılır.",
  },
  konsol: {
    title: "Kasa programı hâlâ ModPOS",
    deneme: "AsilPOS'un gün sonları saklanır ama hiçbir hesaba girmez (deneme). Kasa programı AsilPOS olunca geçiş gününden itibaren sayılır.",
  },
} as const;

// Teknik adlar yalnız `tech`'te (ekran gövdesinde geliştirici sözcüğü yok; tests/uyari-goc.test.ts)
const secretTech = (envName: string) => `Panelde saklanan anahtar sunucudaki ${envName}'ın önüne geçer; AsilPOS'ta LAFMALIYET_SYNC_SECRET aynı olmalı.`; // tech-metni

/** Anahtar silinince ne olur: Marina'da sunucudaki eski anahtar, öbür şubede kasa bağlantısız kalır */
const dropText = (legacy: boolean) => (legacy ? "Sunucudaki anahtar kullanılır." : "Bu şubenin kasası bağlantısız kalır: yeni anahtar kaydedin ya da kurulum kodu gönderin.");

/**
 * Şube ayarları › AsilPOS (şube ayarı SUBE_AYAR_GRUBU; docs/SUBE.md › Şube başına ayarlar): kasası AsilPOS olan ya da
 * AsilPOS kurulumu yapılmış şubede. ladmin'de geçiş günü yalnız gösterilir (değiştirmek konsolda). Konsolda geçiş günü
 * aynı sayfada kendi kartında. Anahtar panelde şifreli saklanır, AsilPOS'taki LAFMALIYET_SYNC_SECRET ile aynı olmalıdır;
 * her şubenin kasası kendi anahtarını kullanır (çok şube). Ortamdaki ASILPOS_SYNC_SECRET yalnız eski kurulumun şubesine
 * (Marina) hizmet eder, onun da saklanan anahtarı yokken (`legacy`); öbür şubede anahtar silinirse kasa bağlantısız
 * kalır. Saklanan anahtar bir daha gösterilmez; yalnız "kayıtlı" der, değiştirilir ya da silinir. "Diğer şubeyle aynı"
 * yok: anahtar şubeyi tanıtır. Değiştirmek ve silmek yalnız konsolda (`yer="konsol"`; sunucu da yalnız konsol oturumunu
 * kabul eder): ladmin'de alan ve düğmeler yok, yerinde tek cümle.
 */
export function AsilposBranchCard({
  data,
  yer = "ladmin",
  konsolUrl = null,
  canli = null,
}: {
  data: AsilposBranchData;
  yer?: SubeIslemYeri;
  /** ladmin: şubenin Yönetim konsolundaki sayfası (yalnız asıl yöneticiye; öteki yöneticiye null) */
  konsolUrl?: string | null;
  /** Canlı şubenin uyarı başlığı (canliBaslik); kartta ve parola penceresinde */
  canli?: string | null;
}) {
  const [secret, setSecret] = useState("");
  /** Parola penceresi: yeni anahtarı kaydet ya da paneldekini sil */
  const [ask, setAsk] = useState<"save" | "drop" | null>(null);
  const short = secret.trim().length > 0 && secret.trim().length < ASILPOS_SECRET_MIN;
  const canliNotu = canli ? <Notice tone="bad" size="sm" title={canli} text="Anahtar değişince kasanın bugünkü bağlantısı kopar; kasadaki anahtar da aynı anda değişmeli." /> : null;

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
        {canliNotu}
        {yer === "ladmin" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <span className="min-w-0 flex-1 basis-48 text-ink">
              <span className="text-ink-mute">Geçiş günü:</span> {data.switchDay ? dayMonthYearTR(data.switchDay) : "yok (kasa ModPOS sayılır)"}
            </span>
            <ButtonLink href={`/panel/ayarlar?sube=${encodeURIComponent(data.branchId)}#asilpos`} variant="secondary" size="sm" className="max-sm:w-full">
              Ayarlar › AsilPOS
            </ButtonLink>
          </div>
        ) : null}
        {data.sourceModpos ? (
          <Notice
            tone="neutral"
            size="sm"
            title={MODPOS_NOTU[yer].title}
            text={data.till ? "AsilPOS'un gün sonları yine bu şubeye yazılır; ModPOS föyü yalnız yedektir, geçiş gününden sonra hesaba girmez." : MODPOS_NOTU[yer].deneme}
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
        {yer === "konsol" ? (
          <Field
            label={data.stored === "saved" ? "Anahtarı değiştir" : "Anahtarı panelde sakla"}
            htmlFor="asilpos-anahtar"
            hint={`En az ${ASILPOS_SECRET_MIN} karakter; AsilPOS'taki bağlantı anahtarıyla aynı. Şifreli saklanır, bir daha gösterilmez.`}
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
              aria-invalid={short ? true : undefined}
            />
          </Field>
        ) : null}
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
        {yer === "konsol" ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAsk("save")} disabled={!secret.trim() || short} className="max-sm:w-full">
              Kaydet
            </Button>
            {data.stored !== "none" ? (
              <Button variant="secondary" onClick={() => setAsk("drop")} className="max-sm:w-full">
                Paneldeki anahtarı sil
              </Button>
            ) : null}
          </div>
        ) : (
          <KonsolNotu href={konsolUrl} konu="Anahtarı değiştirmek ya da silmek" />
        )}
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
        >
          {canliNotu}
        </ConfirmPasswordDialog>
      ) : null}
    </Card>
  );
}

/**
 * Kasası artık AsilPOS olmayan (ve kurulumu olmayan) şubede kalan, panelde saklanmış AsilPOS anahtarı: kullanılmaz ama
 * kasa kaynağı AsilPOS'a dönerse yine geçerli olurdu. Konsolda yalnız silinir (parolayla); öbür şubelerin anahtarları
 * değişmez. ladmin'de düğme yerine "Bu iş Yönetim konsolunda yapılır"
 */
export function AsilposOldSecretCard({ branchId, yer = "ladmin", konsolUrl = null }: { branchId: string; yer?: SubeIslemYeri; konsolUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Card id="asilpos" className="scroll-mt-20">
      <CardHeader icon={<KeyRound />} title="Eski AsilPOS anahtarı" description="Bu şubenin kasası artık AsilPOS değil, ama panelde saklanan AsilPOS anahtarı duruyor. Kullanılmıyor; silebilirsiniz." />
      <div className="space-y-2 px-5 pb-5">
        {yer === "konsol" ? (
          <Button variant="secondary" onClick={() => setOpen(true)} className="max-sm:w-full">
            Paneldeki eski AsilPOS anahtarını sil
          </Button>
        ) : (
          <KonsolNotu href={konsolUrl} konu="Eski anahtarı silmek" />
        )}
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
