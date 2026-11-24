import { assistantEnabled } from "@/lib/assistant/protocol";
import { getCurrentUser } from "@/server/auth/dal";

import { PanelAssistant } from "./panel-assistant";

/**
 * Panel asistanının kapısı (sunucuda, panel düzeninde bir kez; docs/ASISTAN.md): düğme yalnız yöneticiye çizilir,
 * personelin sayfasına hiç girmez (uç da 403 döner). ASISTAN_KAPALI=1 ise kimseye çizilmez. Anahtar yoksa ya da
 * Ayarlar › Fotoğraftan okuma kapalıysa düğme yine görünür, pencere nedenini söyler (durum açılınca sorulur).
 */
export async function PanelAssistantGate() {
  if (!assistantEnabled()) return null;
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return <PanelAssistant userId={user.id} />;
}
