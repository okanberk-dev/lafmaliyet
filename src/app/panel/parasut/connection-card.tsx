"use client";

import { Check, ChevronDown, Copy, PlugZap, Save, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";
import { dateTimeTR, locativeTR } from "@/lib/format";
import { COMPANY_LOCKED_TEXT, sourceText, type ParasutSettingsView, type SettingSource } from "@/lib/parasut/settings";
import { todayTR } from "@/lib/reminders";
import { ToggleRow } from "@/components/ui/toggle-row";
import { disconnectParasut, saveParasutSettings, setParasutInvoiceScope } from "@/server/actions/parasut";

import { useCopied } from "../kullanicilar/password-field";

/** Alanın yanında değerin nereden geldiği */
const SOURCE_TONE: Record<"panel" | "env" | "none", Tone> = { panel: "green", env: "gray", none: "amber" };
function SourceBadge({ source }: { source: SettingSource }) {
  return <Badge tone={SOURCE_TONE[source ?? "none"]}>{sourceText(source)}</Badge>;
}

/**
 * Paraşüt › Bağlantı: hesabın durumu (bağlı / bağlı değil / yenilenmeli), bağla ya da yeniden bağla, oturumu sıfırla;
 * bağlantı ayarlarının formu (client_id, client_secret, firma numarası, ilk eşitleme başlangıcı; her alanda değerin
 * nereden geldiği), DevHub'a kaydedilecek dönüş adresi ve kısa "Nasıl alınır?". client_secret ekrana hiç gelmez:
 * yalnız kayıtlı olup olmadığı görünür, boş bırakılırsa kayıtlı olan kalır (src/lib/parasut/settings.ts).
 *
 * Şube başına Paraşüt hesabı (docs/PARASUT.md): kart ekranın gösterdiği hesabındır (`account`); bağlama, sıfırlama ve
 * kayıt o hesaba gider. Ayrı hesapta (yalnız sahibi şube kullanıyor) "Faturalar … şubesinin" seçimi de burada.
 */
export function ConnectionCard({
  configured,
  connection,
  redirectUri,
  settings,
  cronSet,
  busy,
  hasSynced,
  className,
  account,
  accountName = null,
  invoiceScope = null,
  linkedFrom = null,
}: {
  /**
   * Seçili şube bu hesabı başka şubeden kullanıyor ("Tuzla ile aynı"): kart salt okunur durum ve hesabın sahibi şubede
   * düzenleme bağlantısı; ayar formu ve oturum düğmeleri çizilmez (bağlı şubenin görünümünden Tuzla'nın ayarı değişmesin)
   */
  linkedFrom?: { branchName: string; ownerName: string; href: string } | null;
  /** Kartın Paraşüt hesabı (sahibi şube); verilmezse sunucu seçili şubeninkini kullanır */
  account?: string;
  /** Birden çok kasa açıkken hesabın adı (başlıkta) */
  accountName?: string | null;
  /** Ayrı hesabın faturalarının şubesi seçimi (yalnız sahibi şube kullanıyorsa) */
  invoiceScope?: { value: "branch" | "shared"; branchName: string } | null;
  configured: boolean;
  connection: { connected: boolean; refreshedAt: string | null; stale: boolean };
  /** DevHub'a kaydedilmesi gereken dönüş adresi (PARASUT_REDIRECT_URI yanlışsa null) */
  redirectUri: string | null;
  settings: ParasutSettingsView;
  cronSet: boolean;
  /** Sayfadaki başka bir Paraşüt işi (eşitleme, kalem okuma) sürüyor */
  busy: boolean;
  /** Eşitleme imleci var: firma değişince sıfırlanacağı söylenir */
  hasSynced: boolean;
  className?: string;
}) {
  const [resetting, startReset] = useActionTransition();
  const [scoping, startScope] = useActionTransition();
  const connectHref = account ? `/panel/parasut/baglan?hesap=${encodeURIComponent(account)}` : "/panel/parasut/baglan";
  const [confirmReset, setConfirmReset] = useState(false);
  const { copied, copy } = useCopied();

  const status = connection.connected
    ? connection.stale
      ? { tone: "amber" as const, label: "Yenilenmeli", text: "Yetki uzun süre yenilenmedi (Paraşüt 30 gün tanır); eşitleme durduysa yeniden bağlayın." }
      : {
          tone: "green" as const,
          label: "Bağlı",
          text: connection.refreshedAt ? `Yetki en son ${dateTimeTR(connection.refreshedAt)} yenilendi; her eşitlemede kendiliğinden yenilenir.` : "Hesap bağlı.",
        }
    : configured
      ? { tone: "amber" as const, label: "Bağlı değil", text: "Paraşüt'ün giriş ve onay ekranından bir kez geçin; yetki burada şifreli saklanır." }
      : { tone: "gray" as const, label: "Bağlı değil", text: "Önce aşağıdaki ayarları girip kaydedin." };

  if (linkedFrom) {
    return (
      <Card className={className}>
        <CardHeader
          icon={<PlugZap />}
          title={`Bağlantı · ${linkedFrom.ownerName}`}
          description={`${linkedFrom.branchName}, ${linkedFrom.ownerName} şubesinin Paraşüt hesabını kullanıyor. Bağlantı ve ayarlar ${linkedFrom.ownerName} seçiliyken düzenlenir.`}
        />
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            <span className="min-w-0 flex-1 basis-56 text-[13px] leading-5 text-pretty text-ink-mute">{status.text}</span>
            <a href={linkedFrom.href} className={buttonClass("secondary", "md", "max-sm:w-full")}>
              {locativeTR(linkedFrom.ownerName)} düzenle
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader
        icon={<PlugZap />}
        title={accountName ? `Bağlantı · ${accountName}` : "Bağlantı"}
        description={accountName ? `${accountName} şubesinin Paraşüt hesabı: DevHub'daki uygulamanın bilgileri ve hesabın yetkisi.` : "DevHub'daki uygulamanın bilgileri ve Paraşüt hesabının yetkisi."}
      />
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <span className="min-w-0 flex-1 basis-56 text-[13px] leading-5 text-pretty text-ink-mute">{status.text}</span>
          <span className="flex flex-wrap gap-2 max-sm:w-full">
            {configured ? (
              /* Tam sayfa gidiş: rota Paraşüt'ün onay ekranına 302 verir (Next yönlendirmesi değil, önden yüklenmez) */
              <a href={connectHref} className={buttonClass(connection.connected ? "secondary" : "primary", "md", "max-sm:flex-1")}>
                <PlugZap size={16} aria-hidden="true" /> {connection.connected ? "Yeniden bağla" : "Paraşüt hesabını bağla"}
              </a>
            ) : (
              <Button disabled title="Önce ayarları kaydedin" className="max-sm:flex-1">
                <PlugZap size={16} aria-hidden="true" /> Paraşüt hesabını bağla
              </Button>
            )}
            <Button variant="ghost" disabled={busy || resetting} onClick={() => setConfirmReset(true)} className="max-sm:flex-1">
              <Unplug size={16} aria-hidden="true" /> Oturumu sıfırla
            </Button>
          </span>
        </div>

        {!cronSet ? (
          <Notice tone="warn" size="sm" title="Her sabahki otomatik eşitleme kapalı" text="CRON_SECRET tanımlı değil; faturalar yalnız “Şimdi eşitle” ile gelir." />
        ) : null}
        {invoiceScope ? (
          <ToggleRow
            title={`Faturalar ${invoiceScope.branchName} şubesinin`}
            description={
              invoiceScope.value === "branch"
                ? `Bu hesaptan gelen yeni faturalar ${invoiceScope.branchName} şubesine yazılır. Kapalıyken işletme geneli kalır.`
                : "Bu hesaptan gelen yeni faturalar işletme geneli kalır (şubeye yazılmaz). Var olan faturaların şubesi değişmez."
            }
            label={`Faturalar ${invoiceScope.branchName} şubesinin`}
            checked={invoiceScope.value === "branch"}
            disabled={scoping}
            onChange={(v) =>
              startScope(async () => {
                const r = await setParasutInvoiceScope(v ? "branch" : "shared", account);
                if (!r.ok) return void toast.error(r.error);
                toast.success(v ? `Yeni faturalar ${invoiceScope.branchName} şubesinin` : "Yeni faturalar işletme geneli");
              })
            }
          />
        ) : null}
        {settings.secretUnreadable ? (
          <Notice tone="warn" size="sm" title="Kayıtlı Client Secret okunamadı" text="Sunucunun anahtarı (AUTH_SECRET) değişmiş olabilir; Client Secret'ı yeniden girip kaydedin." />
        ) : null}

        {/* Kayıttan sonra sayfa yenilenince form yeni değerlerle baştan kurulur */}
        <SettingsForm
          key={[settings.clientId.value, settings.clientSecret.source, settings.companyId.value, settings.syncFrom.value, settings.companyLocked].join("|")}
          settings={settings}
          connected={connection.connected}
          hasSynced={hasSynced}
          account={account}
        />

        <div className="space-y-1.5 border-t border-line-strong pt-4">
          <p className="text-[13px] font-medium text-ink-soft">DevHub&apos;a kaydedilecek dönüş adresi (Redirect URL)</p>
          {redirectUri ? (
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded-xl bg-surface px-3 py-2 text-[13px] break-all text-ink ring-1 ring-line">{redirectUri}</code>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                aria-label="Dönüş adresini https:// olmadan kopyala"
                onClick={() => copy("donus", redirectUri.replace(/^https:\/\//, ""), "Adres kopyalandı")}
              >
                {copied === "donus" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} Kopyala
              </Button>
            </div>
          ) : (
            <p className="text-sm text-bad">PARASUT_REDIRECT_URI geçerli bir https adresi değil.</p>
          )}
          <p className="text-xs leading-5 text-ink-mute">DevHub&apos;daki kutunun başında https:// sabit yazar; Kopyala adresi https:// olmadan kopyalar.</p>
        </div>

        <details className="group rounded-2xl bg-surface ring-1 ring-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
            <span className="flex-1">Nasıl alınır?</span>
            <ChevronDown size={16} className="shrink-0 text-ink-mute transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ol className="list-decimal space-y-2 px-4 pb-4 pl-9 text-[13px] leading-5 text-pretty text-ink-soft">
            <li>
              Paraşüt <b>DevHub</b>&apos;a Paraşüt hesabınızla girip <i>“Paraşüt Kullanıcısıyım”</i> ile başvurun. <i>“Paraşüt bağlantısı nereden yapılacak?”</i>{" "}
              sorusunda <b>Bir sunucudan</b> seçili kalsın, Redirect URL&apos;ye yukarıdaki adresi yapıştırın. Verilen client_id ve client_secret&apos;ı buraya girip
              kaydedin.
            </li>
            <li>
              Paraşüt&apos;te bağlantıyı kuracak kullanıcıya <b>Uygulama Entegrasyonları</b> iznini açın (Ayarlar › Kullanıcılar › Düzenle); kapalıysa Paraşüt
              “yetkiniz yok” der.
            </li>
            <li>
              <b>Paraşüt hesabını bağla</b>&apos;ya basıp Paraşüt&apos;ün onay ekranından geçin. Panel Paraşüt parolanızı görmez; yetkiyi Paraşüt&apos;ten dilediğiniz
              zaman durdurabilirsiniz.
            </li>
          </ol>
        </details>
      </CardContent>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        tone="primary"
        confirmLabel="Oturumu sıfırla"
        title="Paraşüt oturumu sıfırlansın mı?"
        description="Kayıtlı Paraşüt yetkisi ve eşitleme imleci silinir. Sonra “Paraşüt hesabını bağla” ile yeniden bağlamanız gerekir ve faturalar başlangıç tarihinden itibaren tekrar okunur; mevcut faturalar çoğalmaz, bağlantılar ve kurallar kalır."
        pending={resetting}
        onConfirm={() =>
          startReset(async () => {
            const r = await disconnectParasut(account);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Oturum sıfırlandı");
            setConfirmReset(false);
          })
        }
      />
    </Card>
  );
}

/** Bağlantı ayarlarının formu; istemci ya da firma değişecekse önce sonucu sorar */
function SettingsForm({ settings, connected, hasSynced, account }: { settings: ParasutSettingsView; connected: boolean; hasSynced: boolean; account?: string }) {
  const [saving, startSave] = useActionTransition();
  const [clientId, setClientId] = useState(settings.clientId.value ?? "");
  const [secret, setSecret] = useState("");
  const [companyId, setCompanyId] = useState(settings.companyId.value ?? "");
  const [syncFrom, setSyncFrom] = useState(settings.syncFrom.value ?? "");
  const [confirm, setConfirm] = useState<string[] | null>(null);

  const clientChanged = clientId.trim() !== (settings.clientId.value ?? "") || secret.trim() !== "";
  const companyChanged = companyId.trim() !== (settings.companyId.value ?? "");

  const save = () =>
    startSave(async () => {
      const r = await saveParasutSettings({ clientId, clientSecret: secret, companyId, syncFrom }, account);
      setConfirm(null);
      if (!r.ok) return void toast.error(r.error);
      if (!r.data.saved) return void toast("Değişiklik yok", { description: "Değerler zaten kayıtlıydı." });
      setSecret("");
      toast.success("Paraşüt ayarları kaydedildi", {
        description: r.data.forgotSession
          ? "Kayıtlı yetki silindi: “Paraşüt hesabını bağla” ile yeniden bağlayın."
          : r.data.resetCursor
            ? "Eşitleme imleci sıfırlandı; faturalar yeni firmadan okunur."
            : undefined,
      });
    });

  const submit = () => {
    // Sonucu olan değişiklikler önce sorulur: bağlı hesabın yetkisi silinir, eşitleme imleci sıfırlanır
    const effects = [
      clientChanged && connected
        ? "Client ID ya da Client Secret değişince kayıtlı Paraşüt yetkisi silinir: kaydettikten sonra “Paraşüt hesabını bağla” ile yeniden bağlayın, o zamana kadar eşitleme çalışmaz."
        : null,
      companyChanged && settings.companyId.value && hasSynced
        ? "Firma numarası değişince eşitleme imleci sıfırlanır: faturalar yeni firmadan ilk eşitleme başlangıcından itibaren okunur."
        : null,
    ].filter((x): x is string => Boolean(x));
    if (effects.length) setConfirm(effects);
    else save();
  };

  return (
    <>
      <form
        className="space-y-3 border-t border-line-strong pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client ID" htmlFor="ps-client-id" aside={<SourceBadge source={settings.clientId.source} />}>
            <Input id="ps-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} placeholder="DevHub'daki client_id" />
          </Field>
          <Field
            label="Client Secret"
            htmlFor="ps-client-secret"
            aside={<SourceBadge source={settings.clientSecret.source} />}
            hint={settings.clientSecret.source ? "Gösterilmez; boş bırakırsanız kayıtlı olan kalır." : "DevHub'daki client_secret; şifreli saklanır, gösterilmez."}
          >
            <PasswordInput
              id="ps-client-secret"
              toggleLabels={{ show: "Anahtarı göster", hide: "Anahtarı gizle" }}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={settings.clientSecret.source ? "•••••••• (kayıtlı)" : "DevHub'daki client_secret"}
            />
          </Field>
          <Field
            label="Firma numarası"
            htmlFor="ps-company"
            aside={<SourceBadge source={settings.companyId.source} />}
            hint={settings.companyLocked ? COMPANY_LOCKED_TEXT : "Paraşüt'e girince adres çubuğundaki sayı: uygulama.parasut.com/123456/…"}
          >
            <Input
              id="ps-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              readOnly={settings.companyLocked}
              aria-readonly={settings.companyLocked || undefined}
              className={settings.companyLocked ? "bg-panel text-ink-mute" : undefined}
              placeholder="123456"
            />
          </Field>
          <Field
            label="İlk eşitleme başlangıcı"
            htmlFor="ps-sync-from"
            aside={<SourceBadge source={settings.syncFrom.source} />}
            hint="İsteğe bağlı; yalnız ilk eşitlemede kullanılır, boşsa bu yılın başı."
          >
            {/* Bugün Türkiye saatiyle (UTC gece 00–03 arasında bugünü seçtirmezdi) */}
            <Input id="ps-sync-from" type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} max={todayTR()} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="max-sm:w-full">
            <Save size={16} aria-hidden="true" /> {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        tone="primary"
        confirmLabel="Kaydet"
        title="Paraşüt ayarları kaydedilsin mi?"
        description={confirm?.join(" ") ?? ""}
        pending={saving}
        onConfirm={save}
      />
    </>
  );
}
