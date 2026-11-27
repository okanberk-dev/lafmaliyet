import { eq } from "drizzle-orm";
import { Download, KeyRound, MonitorDown, PlugZap, Store, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { twoFactorRequiredFor } from "@/lib/admin-security";
import {
  ALWAYS_COMPANY_WIDE,
  BRANCH_VIEW_TITLE,
  branchViewCardState,
  type BranchViewPrefs,
  defaultView,
  lockedViewLine,
  VIEW_AREAS,
  viewAreasFor,
} from "@/lib/branch-view";
import { ROLES } from "@/lib/constants";
import { KURULUM_DURUM_ETIKET } from "@/lib/asilpos/kurulum";
import { installForAccount } from "@/server/asilpos/kurulum";
import { type CurrentUser, requireUser } from "@/server/auth/dal";
import { staffBranchLock, userBranchView } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { loadMyConnections } from "@/server/mcp/connections";

import { BranchViewCard, type BranchViewRow } from "./branch-view-card";
import { ConnectionsCard } from "./connections";
import { AccountAvatar, PasswordForm, ProfileForm } from "./password-form";
import { sessionsNote } from "./session-note";
import { SessionsCard } from "./sessions";
import { TwoFactorCard } from "./two-factor";

export const metadata: Metadata = { title: "Hesabım" };

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title="Hesabım" path="/panel/hesap" description="Bilgileriniz, giriş parolanız ve iki adımlı doğrulama." />
      <Suspense fallback={<AccountSkeleton />}>
        <Account />
      </Suspense>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor" className="space-y-4">
      <Skeleton className="h-[320px] rounded-3xl" />
      <Skeleton className="h-[280px] rounded-3xl" />
    </div>
  );
}

/**
 * Hesabım › Şube görünümü kartının verisi (docs/SUBE.md › Şube ayrımı; kural `branchViewCardState`): tek şube açıkken
 * ve para ekranı olmayan rolde yok, şubesine kilitli hesapta tek satır, öteki hesapta rolün ekranlarının satırları
 */
async function loadBranchView(user: CurrentUser): Promise<{ kind: "kilitli"; line: string } | { kind: "kart"; rows: BranchViewRow[]; prefs: BranchViewPrefs } | null> {
  const [branches, lock, prefs] = await Promise.all([listBranches(), staffBranchLock(), userBranchView()]);
  const locked = lock !== null || user.role === "manager";
  const state = branchViewCardState({ role: user.role, locked, activeBranches: branches.filter((b) => b.active).length });
  if (state === "yok") return null;
  if (state === "kilitli") {
    const name = branches.find((b) => b.id === (lock ?? user.branchId))?.name;
    return name ? { kind: "kilitli", line: lockedViewLine(name) } : null;
  }
  const rows = viewAreasFor(user.role).map((area): BranchViewRow => {
    const { label, help, modes, firmOnly } = VIEW_AREAS[area];
    return { area, label, help, modes, firmOnly, fallback: defaultView(area, user.role) };
  });
  return { kind: "kart", rows, prefs };
}

async function Account() {
  const user = await requireUser();
  // Bağlı uygulamalar (Claude bağlantısı) yalnız yöneticide; okunamazsa sayfanın geri kalanı yine açılır
  const [[security], connections] = await Promise.all([
    getDb().select({ totpEnabled: s.users.totpEnabled, recoveryCodes: s.users.recoveryCodes }).from(s.users).where(eq(s.users.id, user.id)).limit(1),
    user.role === "admin"
      ? loadMyConnections(user.id).catch((e) => {
          console.error("Bağlı uygulamalar okunamadı", e);
          return null;
        })
      : null,
  ]);
  // AsilPOS kurulumu (docs/ASILPOS.md › Şube kurulumu): şubenin son bağlantısı yalnız şubenin kendi hesabına (bağlantının
  // gittiği adres, şubeye kilitli personel). Şubenin öbür personeli, müdür, muhasebeci ve yönetici görmez: bağlantıdaki
  // kod kasanın eşitleme anahtarını verir (installForAccount)
  const install = await installForAccount(getDb(), user).catch(() => null);
  // Şube görünümü okunamazsa kart çizilmez; sayfanın geri kalanı açılır
  const branchView = await loadBranchView(user).catch((e) => {
    console.error("Şube görünümü okunamadı", e);
    return null;
  });
  // Parola, iki adımlı ve oturumları kapatma Claude bağlantısını da kapatır: pencereler bunu söyler (YO-08)
  const claude = Boolean(connections?.rows.length);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col items-center px-5 pt-8 pb-6 text-center">
          <AccountAvatar name={user.name} />
          {/* Uzun ad ve e-posta telefonda kesilmez, alt satıra geçer */}
          <p className="mt-4 max-w-full text-lg leading-7 font-semibold tracking-tight text-balance break-words text-ink">
            <span className="sr-only">Ad: </span>
            {user.name}
          </p>
          <p className="max-w-full text-sm break-all text-ink-mute">
            <span className="sr-only">E-posta: </span>
            {user.email}
          </p>
          <Badge tone={user.role === "admin" ? "solid" : "gray"} className="mt-3">
            <span className="sr-only">Rol: </span>
            {ROLES[user.role]}
          </Badge>
        </div>
        <div className="border-t border-line">
          <CardHeader icon={<UserRound />} title="Hesap bilgileri" description="Giriş yaparken bu e-postayı kullanırsınız." />
          <CardContent>
            <ProfileForm name={user.name} email={user.email} />
          </CardContent>
        </div>
      </Card>
      {install ? (
        <Card id="asilpos" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
          <CardHeader
            icon={<MonitorDown />}
            title="AsilPOS kurulumu"
            description="Şubenizin kasa bilgisayarına AsilPOS'u bu bağlantıyla kurun; kasa şubeye, gün sonuna ve uzaktan yönetime kendiliğinden bağlanır."
          />
          <CardContent className="space-y-3 text-sm">
            <Badge tone={install.durum === "kuruldu" ? "green" : install.durum === "bekliyor" ? "blue" : "gray"}>{KURULUM_DURUM_ETIKET[install.durum]}</Badge>
            {install.link ? (
              <>
                <p className="text-ink-soft">Bağlantıyı kasa bilgisayarında açın, inen dosyaya (AsilPOS-Kur) çift tıklayın ve Windows izin sorunca Evet deyin. Tek kurulumluktur.</p>
                <ButtonLink href={install.link} prefetch={false}>
                  <Download className="size-4" aria-hidden="true" /> AsilPOS&apos;u indir
                </ButtonLink>
              </>
            ) : (
              <p className="text-ink-soft">
                {install.durum === "kuruldu" ? "Kasa kuruldu ve şubeye bağlandı." : "Bağlantı artık geçerli değil; yenisi için yöneticiye yazın."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {branchView ? (
        // Çipin "Hesabım › Şube görünümü" bağlantısı buraya getirir
        <Card id="sube-gorunumu" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
          {branchView.kind === "kart" ? (
            <BranchViewCard rows={branchView.rows} prefs={branchView.prefs} always={ALWAYS_COMPANY_WIDE} />
          ) : (
            <CardHeader icon={<Store />} title={BRANCH_VIEW_TITLE} description={branchView.line} />
          )}
        </Card>
      ) : null}
      <Card>
        <CardHeader
          icon={<KeyRound />}
          title="Parola değiştir"
          description={`En az 8 karakter; kolay tahmin edilen parolalar (12345678, kafenin adı, e-postanız) kabul edilmez. ${sessionsNote(claude, "Değişince")}`}
        />
        <CardContent>
          <PasswordForm email={user.email} />
        </CardContent>
      </Card>
      <Card>
        <TwoFactorCard enabled={Boolean(security?.totpEnabled)} recoveryLeft={security?.recoveryCodes?.length ?? 0} claude={claude} required={twoFactorRequiredFor(user.role)} />
      </Card>
      {/* Yeni cihaz uyarısı (zil, e-posta) buraya getirir */}
      <Card id="oturumlar" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
        <SessionsCard claude={claude} />
      </Card>
      {user.role === "admin" ? (
        <Card id="bagli-uygulamalar" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
          {connections ? (
            <ConnectionsCard rows={connections.rows} calls={connections.calls} mcpUrl={connections.mcpUrl} />
          ) : (
            <>
              <CardHeader icon={<PlugZap />} title="Bağlı uygulamalar" />
              <CardContent>
                <Notice tone="bad" size="sm" title="Bağlı uygulamalar okunamadı; sayfayı yenileyin" />
              </CardContent>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
