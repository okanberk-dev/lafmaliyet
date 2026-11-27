import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { AuthShell } from "@/app/giris/auth-shell";
import { AuthHeading, authCard, authLink } from "@/app/giris/auth-ui";
import { consentLines, MAX_ACTIVE_GRANTS, mcpEnabled } from "@/lib/mcp/oauth";
import { STAFF_HOME } from "@/lib/roles";
import { twoFactorSetupHref } from "@/lib/admin-security";
import { awaitingTwoFactorSetup, getCurrentUser } from "@/server/auth/dal";
import { expiredLoginQuery, LEGACY_COOKIES, readCookie, SESSION_COOKIE } from "@/server/auth/session";
import { getDb, schema as s } from "@/server/db";
import { openRequest } from "@/server/mcp/base";
import { activeGrantCount } from "@/server/mcp/store";

import { ConsentForm, DenyButton } from "./consent-form";

/*
 * Claude bağlantısının onay ekranı (docs/CLAUDE-BAGLANTISI.md): /oauth/authorize mühürlenmiş isteği buraya getirir.
 * Giriş sayfasıyla aynı görünüm. Oturum yoksa girişe (dönüşte buraya), personelse "yalnız yönetici", 10 bağlantı
 * doluysa "çok fazla"; yöneticiye isteğin nereden geldiği, Claude'un neler yapabileceği ve parola alanı. Adresteki
 * istek başka siteye gitmesin diye sayfa yönlendiren (referrer) bilgisi göndermez.
 */
export const metadata: Metadata = {
  title: "Claude bağlantısı",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ConnectPage({ searchParams }: PageProps<"/baglan">) {
  return (
    <AuthShell>
      {/* İstek ve oturum okunana kadar kartın yeri tutulur (giriş sayfasındaki gibi) */}
      <Suspense fallback={<div aria-busy="true" aria-label="Yükleniyor" className="h-[560px] w-full animate-pulse rounded-2xl bg-white/15" />}>
        <ConnectContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: ReactNode; children?: ReactNode }) {
  return (
    <div className={authCard}>
      <AuthHeading title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

async function ConnectContent({ searchParams }: { searchParams: PageProps<"/baglan">["searchParams"] }) {
  // İstek süresi şimdiye göre denetlenir: sayfa her istekte çizilir, önceden hazırlanmaz
  await connection();
  if (!mcpEnabled(process.env)) notFound();
  const { istek } = await searchParams;
  const raw = (Array.isArray(istek) ? istek[0] : istek) ?? "";
  const req = openRequest(raw);
  if (!req) {
    return (
      <Card title="Bağlantı isteği geçersiz" subtitle="Bu isteğin süresi doldu ya da bağlantı bozuk. Claude'a dönüp bağlayıcının yanındaki “Bağlan”a yeniden dokunun.">
        <Link href="/panel" className={`inline-flex min-h-11 items-center text-[15px] ${authLink}`}>
          Panele git
        </Link>
      </Card>
    );
  }

  const me = await getCurrentUser();
  if (!me) {
    // İki adımlıyı kurmamış yönetici, müdür ya da muhasebeci (zorunluluk açıkken; src/lib/admin-security.ts): oturumu geçerli, önce kurulum, sonra bu ekran
    if (await awaitingTwoFactorSetup()) redirect(twoFactorSetupHref(`/baglan?istek=${encodeURIComponent(raw)}`));
    // Girişten sonra bu ekrana dönülür (safeNext /baglan?… kabul eder). Çerez duruyor ama geçersizse (parola değişti,
    // oturumlar kapatıldı, çıkış yapıldı) "oturum bitti" ve çerezin özeti: proxy yalnız bu çerezi siler, giriş açılır
    const stale = readCookie(await cookies(), SESSION_COOKIE, LEGACY_COOKIES.session.name);
    const next = encodeURIComponent(`/baglan?istek=${encodeURIComponent(raw)}`);
    redirect(`/giris?${stale ? `${await expiredLoginQuery(stale)}&` : ""}next=${next}`);
  }

  if (me.role !== "admin") {
    return (
      <Card title="Bu bağlantıyı yalnız yönetici kurabilir" subtitle="Claude'dan panele soru sormak için yönetici hesabıyla giriş yapın.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href={STAFF_HOME} className={`inline-flex min-h-11 items-center self-start text-[15px] ${authLink}`}>
            Panele dön
          </Link>
          <DenyButton istek={raw} label="Reddet ve Claude'a dön" />
        </div>
      </Card>
    );
  }

  const db = getDb();
  const [[security], active] = await Promise.all([
    db.select({ totpEnabled: s.users.totpEnabled }).from(s.users).where(eq(s.users.id, me.id)).limit(1),
    activeGrantCount(db, me.id, new Date()),
  ]);
  if (active >= MAX_ACTIVE_GRANTS) {
    return (
      <Card title="Çok fazla bağlı uygulama" subtitle="Hesabım › Bağlı uygulamalar'dan kullanmadıklarınızı kaldırıp yeniden deneyin.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/panel/hesap#bagli-uygulamalar" className={`inline-flex min-h-11 items-center self-start text-[15px] ${authLink}`}>
            Hesabım&apos;a git
          </Link>
          <DenyButton istek={raw} label="Reddet ve Claude'a dön" />
        </div>
      </Card>
    );
  }

  const text = consentLines({
    host: req.host,
    clientName: req.clientName,
    loopback: req.loopback,
    userName: me.name,
    email: me.email,
    totpEnabled: Boolean(security?.totpEnabled),
  });
  return <ConsentForm istek={raw} text={text} />;
}
