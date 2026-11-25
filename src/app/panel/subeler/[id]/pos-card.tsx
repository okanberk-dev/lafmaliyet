"use client";

import { KeyRound, ReceiptTurkishLira } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SameAsToggle } from "@/components/panel/same-as-toggle";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";
import type { ModposSetting } from "@/lib/branch-settings/groups";
import { LAFPOS_SECRET_MIN } from "@/lib/lafpos/request";
import { dayMonthYearTR } from "@/lib/lafpos/switch";
import { saveLafposSecret } from "@/server/actions/branch-settings";
import type { SecretState } from "@/server/branch-settings";
import type { BranchSettingView } from "@/server/branch-settings-view";

import { ModposFallbackSwitch } from "../../ayarlar/modpos-client";

/** LafPOS kartının verisi: geçiş günü ve anahtarın yalnız durumu (anahtarın kendisi tarayıcıya hiç gelmez) */
export interface LafposBranchData {
  branchId: string;
  switchDay: string | null;
  /** Panelde saklanan anahtarın durumu */
  stored: SecretState;
  /** Kullanılan anahtar nereden ("panel", "ortam"); yoksa null */
  source: "panel" | "ortam" | null;
  /** Kullanılan anahtarın sorunu (yok, kısa, sitenin anahtarıyla aynı); null: bağlantı açık */
  problem: "missing" | "short" | "same_as_site" | null;
}

const PROBLEM_TEXT = {
  missing: "Anahtar yok: LafPOS'un gönderdiği gün sonları reddedilir",
  short: "Sunucudaki anahtar 32 karakterden kısa: bağlantı kapalı",
  same_as_site: "Sunucudaki anahtar sitenin anahtarıyla aynı: bağlantı kapalı",
} as const;

// Teknik adlar yalnız `tech`'te (ekran gövdesinde geliştirici sözcüğü yok; tests/uyari-goc.test.ts)
const SECRET_TECH = "Panelde saklanan anahtar sunucudaki LAFPOS_SYNC_SECRET'ın önüne geçer; LafPOS'ta LAFMALIYET_SYNC_SECRET aynı olmalı."; // tech-metni

/**
 * Şube ayarları › LafPOS (şube ayarı pos.lafpos; docs/SUBE.md › Şube başına ayarlar): yalnız kasası LafPOS olan şubede.
 * Geçiş günü Ayarlar › LafPOS'ta değişir (denetimleri orada); burada yalnız gösterilir. Anahtar panelde şifreli saklanabilir:
 * ortamdaki LAFPOS_SYNC_SECRET'ın önüne geçer, LafPOS'taki LAFMALIYET_SYNC_SECRET ile aynı olmalıdır. Saklanan anahtar
 * bir daha gösterilmez; yalnız "kayıtlı" der, değiştirilir ya da silinir. "Diğer şubeyle aynı" yok: LafPOS en çok bir
 * şubenin kasasıdır.
 */
export function LafposBranchCard({ data }: { data: LafposBranchData }) {
  const [secret, setSecret] = useState("");
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [pending, start] = useActionTransition();
  const short = secret.trim().length > 0 && secret.trim().length < LAFPOS_SECRET_MIN;

  function save(value: string | null) {
    start(async () => {
      const res = await saveLafposSecret({ branchId: data.branchId, secret: value });
      if (!res.ok) return void toast.error(res.error);
      setSecret("");
      setConfirmDrop(false);
      toast.success(res.data.saved ? "LafPOS anahtarı kaydedildi" : "Paneldeki LafPOS anahtarı silindi", {
        description: res.data.saved ? "LafPOS'taki bağlantı anahtarı da aynı olmalı." : "Sunucudaki anahtar kullanılır.",
      });
    });
  }

  const status =
    data.problem === null
      ? { tone: "green" as const, text: data.source === "panel" ? "Panelde kayıtlı" : "Sunucuda kayıtlı" }
      : { tone: data.problem === "missing" ? ("gray" as const) : ("amber" as const), text: data.problem === "missing" ? "Anahtar yok" : "Anahtar kullanılmıyor" };

  return (
    <Card id="lafpos" className="scroll-mt-20">
      <CardHeader icon={<KeyRound />} title="LafPOS bağlantısı" description="Bu şubenin kasası LafPOS: gün sonu, personel ve ürünler LafPOS'un imzalı istekleriyle gelir." />
      <div className="space-y-3 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <span className="min-w-0 flex-1 basis-48 text-ink">
            <span className="text-ink-mute">Geçiş günü:</span> {data.switchDay ? dayMonthYearTR(data.switchDay) : "yok (kasa ModPOS sayılır)"}
          </span>
          <ButtonLink href={`/panel/ayarlar?sube=${encodeURIComponent(data.branchId)}#lafpos`} variant="secondary" size="sm" className="max-sm:w-full">
            Ayarlar › LafPOS
          </ButtonLink>
        </div>
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
            text="Sunucunun şifreleme anahtarı değişmiş olabilir; anahtarı yeniden girin. O zamana dek sunucudaki anahtar kullanılır."
            tech="AUTH_SECRET değişti"
          />
        ) : null}
        <Field
          label={data.stored === "saved" ? "Anahtarı değiştir" : "Anahtarı panelde sakla"}
          htmlFor="lafpos-anahtar"
          hint={`En az ${LAFPOS_SECRET_MIN} karakter; LafPOS'taki bağlantı anahtarıyla aynı. Şifreli saklanır, bir daha gösterilmez.`}
          error={short ? `En az ${LAFPOS_SECRET_MIN} karakter` : undefined}
        >
          <PasswordInput
            id="lafpos-anahtar"
            toggleLabels={{ show: "Anahtarı göster", hide: "Anahtarı gizle" }}
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={short ? true : undefined}
          />
        </Field>
        <Notice tone="neutral" size="sm" title="Anahtar nereden okunur" text="Panelde saklanan anahtar sunucudakinin önüne geçer; silinirse sunucudaki kullanılır." tech={SECRET_TECH} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save(secret.trim())} disabled={pending || !secret.trim() || short} className="max-sm:w-full">
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          {data.stored !== "none" ? (
            <Button variant="secondary" onClick={() => setConfirmDrop(true)} disabled={pending} className="max-sm:w-full">
              Paneldeki anahtarı sil
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDrop}
        onClose={() => setConfirmDrop(false)}
        onConfirm={() => save(null)}
        pending={pending}
        confirmLabel="Sil"
        title="Paneldeki LafPOS anahtarı silinsin mi?"
        description="Bundan sonra sunucudaki anahtar kullanılır; o yoksa LafPOS'un istekleri reddedilir."
      />
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
      <CardHeader icon={<ReceiptTurkishLira />} title="ModPOS" description="Bu şubenin kasası ModPOS: kasa föyü her sabah ModPOS API'den çekilir." />
      <div className="space-y-3 px-5 pb-5">
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
