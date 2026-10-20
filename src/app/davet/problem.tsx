import { CircleAlert } from "lucide-react";
import Link from "next/link";

import type { TokenStatus } from "@/server/auth/tokens";

export type ProblemStatus = Exclude<TokenStatus, "ok"> | "invalid";

const TEXT: Record<ProblemStatus, { title: string; body: string }> = {
  invalid: {
    title: "Bağlantı geçersiz",
    body: "Bağlantı eksik ya da hatalı kopyalanmış olabilir. Mesajdaki bağlantının tamamını açın ya da yöneticinizden yenisini isteyin.",
  },
  used: {
    title: "Bu bağlantı zaten kullanıldı",
    body: "Parolanız belirlenmiş. Giriş sayfasından e-postanız ve parolanızla girin; hatırlamıyorsanız orada “Parolamı unuttum”a basın.",
  },
  expired: {
    title: "Bağlantının süresi doldu",
    body: "Bağlantılar güvenlik için kısa süre geçerlidir; yerine yenisi oluşturulmuş da olabilir. Yöneticinizden yeni bağlantı isteyin ya da giriş sayfasında “Parolamı unuttum”u kullanın.",
  },
  blocked: {
    title: "Çok fazla deneme yapıldı",
    body: "Güvenlik için bu bağlantı kapatıldı. Yöneticinizden yeni bir bağlantı isteyin.",
  },
  inactive: {
    title: "Hesap şu an pasif",
    body: "Bu hesapla giriş yapılamıyor. Yöneticinize başvurun.",
  },
};

/** Kullanılamayan bağlantı: neden ve ne yapılacağı, giriş sayfasına düğme */
export function TokenProblem({ status }: { status: ProblemStatus }) {
  const t = TEXT[status];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl bg-chart-metric-bg px-4 py-3.5">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t.title}</h2>
          <p className="mt-1 text-sm leading-6 text-chart-muted">{t.body}</p>
        </div>
      </div>
      <Link
        href="/giris"
        className="flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[15px] font-semibold text-background focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Giriş sayfasına git
      </Link>
    </div>
  );
}
