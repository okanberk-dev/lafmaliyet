import { redirect } from "next/navigation";

import { Notice } from "@/components/ui/notice";
import { isAnaAdmin, KONSOLDA_YAPILIR } from "@/lib/asil-yonetici";
import { panelden, YONETIM_YOLU } from "@/lib/yonetim-host";
import { requireAdmin } from "@/server/auth/dal";

/**
 * /panel/sube-ekleme'nin içeriği (page.tsx; ayrı dosyada ki veritabanlı test doğrudan çağırabilsin): yalnız yönetici
 * (başka rol kendi ana ekranına). Asıl yönetici Yönetim konsolunun Şubeler ve kasalar sayfasına yönlenir (adres
 * yonetim-host.ts kurucusundan: YONETIM_URL varsa konsolun adresi, yoksa aynı adresteki /yonetim); öteki yönetici tek
 * cümle görür
 */
export async function SubeEklemeIcerik() {
  const me = await requireAdmin();
  if (isAnaAdmin(me)) redirect(panelden(YONETIM_YOLU));
  return <Notice tone="neutral" title={KONSOLDA_YAPILIR} />;
}
