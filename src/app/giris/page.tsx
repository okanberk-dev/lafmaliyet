import type { Metadata } from "next";
import { Suspense } from "react";

import { isEmailConfigured } from "@/server/notify/resend";

import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Giriş",
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <AuthShell>
      {/* Adres (?next, ?oturum) okunana kadar kartın yeri tutulur; sayfa boş görünmesin */}
      <Suspense fallback={<div aria-busy="true" aria-label="Yükleniyor" className="h-[388px] w-full animate-pulse rounded-3xl bg-chart-card-bg" />}>
        <LoginForm emailConfigured={isEmailConfigured()} />
      </Suspense>
    </AuthShell>
  );
}
