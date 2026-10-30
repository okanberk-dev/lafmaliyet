import { Notice, NoticeGroup, NoticeLink } from "@/components/ui/notice";
import { JOBS_HREF } from "@/lib/job-health";
import { loadSystemAlerts } from "@/server/jobs/alerts";

/**
 * Genel bakış'ın en üstünde kırmızı şerit, yalnız ciddi sistem sorunlarında (sabah işi çalışmadı / hata verdi / yarıda
 * kesildi, Paraşüt işi hata verdi, CRON_SECRET yok; yalnız canlıda). Kendi Suspense'inde yüklenir: panoyu bekletmez,
 * okunamazsa hiçbir şey göstermez. Daha hafif uyarılar (Paraşüt işi çalışmadı, bir adım hata verdi) yalnız zilde.
 */
export async function SystemBanner() {
  const items = (await loadSystemAlerts().catch(() => [])).filter((a) => a.level === "danger");
  if (!items.length) return null;
  // Sayfayla gelen uyarı: role="note" (alert değil; docs/planlar/ux-sade.md §4.5). Kırmızı ve veri riski: katlanmaz
  const action = <NoticeLink href={JOBS_HREF}>Günlük işler</NoticeLink>;
  if (items.length === 1) return <Notice tone="bad" risk="veri" title={items[0].title} text={items[0].body} action={action} />;
  return <NoticeGroup label="Sistem uyarıları" items={items.map((i) => ({ key: i.id, tone: "bad" as const, risk: "veri" as const, title: i.title, text: i.body, action }))} />;
}
