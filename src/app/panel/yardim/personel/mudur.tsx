import { Banknote, CalendarClock, ClipboardCheck, FileSpreadsheet, Inbox, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Müdürün Yardım'ı (docs/ROLLER.md › Müdür): personelin Yardım'ına EK bir kart, yalnız müdür hesabında çizilir
 * (personel/page.tsx). Personelin içeriği (content.tsx) değişmez; orada para sözcüğü yasak, burada müdürün ekranları
 * kendi adlarıyla anlatılır. Ekran ya da yetenek değişince (src/lib/roles.ts) bu liste de güncellenir
 * (tests/roller.test.ts her bağlantının müdüre açık olduğunu denetler).
 */
export const MANAGER_HELP: { title: string; href: string; icon: LucideIcon; body: ReactNode }[] = [
  {
    title: "Kasa raporu: rakamlarıyla ve onaysız düzeltme",
    href: "/panel/kasa",
    icon: Banknote,
    body: (
      <>
        Şubenizin raporlarını fark, devir ve beklenen nakitle görürsünüz. Geçmiş günü onaysız düzeltir, siler, kilitli ya da eski güne yazar, raporsuz günü
        &ldquo;kafe kapalıydı&rdquo; diye işaretlersiniz. Kasadan çıkanda personelin kategorilerini seçersiniz; maaş, kira gibi satırların tutarı görünür,
        kategorisi yöneticinindir.
      </>
    ),
  },
  {
    title: "Onaylar: şubenizin istekleri",
    href: "/panel/onaylar",
    icon: Inbox,
    body: (
      <>
        Personelin kasa (düzeltme, silme, geç rapor, kasadan çıkan, fotoğraf kaldırma, kafe kapalıydı) ve zayi / ikram isteklerini onaylar ya da
        reddedersiniz. Yalnız kendi şubenizinkiler gelir; reçete önerileri ve karaoke istekleri yöneticinin.
      </>
    ),
  },
  {
    title: "Vardiya planını yazmak",
    href: "/panel/vardiya",
    icon: CalendarClock,
    body: <>Şubenizin haftasını yazar ve PDF&apos;ini alırsınız. Öteki şubenin planı açılmaz.</>,
  },
  {
    title: "Teslim defteri",
    href: "/panel/kasa/teslim",
    icon: ClipboardCheck,
    body: <>Şubenizin ay içindeki kasa teslimleri ve teslim alan kişi.</>,
  },
  {
    title: "İşçilik / ciro",
    href: "/panel/raporlar/iscilik",
    icon: FileSpreadsheet,
    body: (
      <>
        Şubenizin haftalık ve aylık işçilik oranı. Kişi başı ücret ve günlük döküm görünmez; Bugün ekranında şubenizin günü (ciro, kasa farkı, geçen hafta) de
        sizde.
      </>
    ),
  },
  {
    title: "Hesabınız",
    href: "/panel/hesap",
    icon: ShieldCheck,
    body: (
      <>
        Müdür hesabı şubenize kilitlidir: öteki şubeleri, maaşları, vergiyi, Paraşüt&apos;ü, ayarları ve kullanıcıları görmezsiniz. İki adımlı doğrulamayı
        Hesabım&apos;dan açarsınız: isteğe bağlıdır, zorunluluk açıksa kurmadan paneli kullanamazsınız; yeni bir cihazdan girişiniz size bildirilir. Kasa ve
        sabah e-postaları müdür hesabının adresine gitmez; raporları panelde görürsünüz.
      </>
    ),
  },
];

/** Müdürün ek kartının satırları (personelin Yardım'ında, en üstte) */
export function ManagerHelpList() {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {MANAGER_HELP.map((m) => (
        <li key={m.href}>
          <Link href={m.href} className="flex items-start gap-3 px-5 py-3 hover:bg-panel/60 pointer-coarse:py-4">
            <m.icon size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-mute" />
            <span className="min-w-0">
              <span className="block font-medium text-ink">{m.title}</span>
              <span className="block text-sm text-pretty text-ink-mute">{m.body}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
