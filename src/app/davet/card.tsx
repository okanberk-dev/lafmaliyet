import type { ReactNode } from "react";

import { AuthHeading, authCard } from "@/app/giris/auth-ui";

/** Giriş kartıyla aynı görünüm: yeşil zeminde beyaz kart, kalın başlık */
export function InviteCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className={authCard}>
      <AuthHeading title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}
