import type { ReactNode } from "react";

import { InfoTip } from "@/components/ui/info-tip";

import { contextLineOf } from "./nav";

/**
 * Sayfa başlığı: üstte küçük bağlam satırı (kenar çubuğunda bu ekranı açan grubun adı), başlık, tek cümlelik açıklama,
 * sağda eylemler. `tabs` verilirse başlığın altına bölüm sekmeleri gelir.
 *
 * Bağlam satırı ağaçtan türer (docs/planlar/ux-sade.md §3.8): elle yazılmaz, menüde olmayan ad ("Günlük", "Sistem")
 * çıkmaz; üst düzey ekranda (Bugün, Kasa raporu) ve grubun adını taşıyan giriş ekranında (Vergi, KDV, SGK; Ayarlar)
 * çizilmez. Telefonda gizli: üst çubuk ekranın adını zaten yazıyor.
 * Excel karşılığı başlıkta yok; Yardım'ın "Ekranlar" tablosunda ve ⌘K'nın alt satırında.
 */
export function PageHeader({
  title,
  description,
  more,
  meta,
  actions,
  path,
  role = "admin",
  tabs,
}: {
  title: string;
  description?: ReactNode;
  /** Eski uzun açıklama ("nasıl çalışır"): açıklamanın sonunda ⓘ. Personelin ekranında yönetici kavramı içeren metin verilmez */
  more?: string;
  /** Açıklamanın altında tek satır (ör. satış kaynağı) */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Ekranın adresi: bağlam satırı rolün ağacından (contextLineOf); üst düzey ekranda çizilmez */
  path?: string;
  /** Ekranı açan rol; iki rolün açtığı sayfada kullanıcınınki, yükleme iskeletinde "staff" (ortak olan en dar bağlam) */
  role?: "admin" | "staff";
  tabs?: ReactNode;
}) {
  const group = path ? contextLineOf(path, role, title) : undefined;
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {group ? <p className="mb-1.5 text-[13px] text-ink-mute max-sm:hidden">{group}</p> : null}
          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-balance text-ink sm:text-[28px] sm:leading-9">{title}</h1>
          {description || more ? (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-mute">
              {description}
              {more ? (
                <>
                  {description ? " " : null}
                  <InfoTip text={more} label="Nasıl çalışır?" />
                </>
              ) : null}
            </p>
          ) : null}
          {meta ? <p className="mt-1 text-[13px] text-ink-mute">{meta}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="no-print mt-5">{tabs}</div> : null}
    </header>
  );
}
