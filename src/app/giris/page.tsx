import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Giriş",
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      {/* AkmanOS önizleme sahnesi gibi: beyaz zeminde ince nokta ızgarası */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgb(0_0_0/0.06)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div className="relative w-full max-w-[400px]">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
