"use server";

import { z } from "zod";

import { isAutoBackupName } from "@/lib/backup/auto";
import { backupFileName, documentsDownloadBytes, documentsTooBigText, PANEL_DOCUMENTS_MAX_BYTES } from "@/lib/backup/format";
import { requireAdmin } from "@/server/auth/dal";
import { requirePassword } from "@/server/auth/step-up";
import { storedBackupHandle } from "@/server/backup/auto";
import { backupHandle, readLastBackup, uploadsTotal } from "@/server/backup/state";

import { attempt, UserError } from "./util";

const schema = z.object({ password: z.string().max(200, "Parola hatalı"), documents: z.boolean() });

/**
 * Ayarlar › Yedek › Yedeği indir: yöneticinin kendi parolasıyla onaylanır (yedek paneldeki bütün veriyi taşır; açık
 * kalmış bir oturumla indirilmesin). Dosyayı bu eylem değil /api/yedek verir: burada yalnız iki dakika geçerli, bu
 * kişiye özel bir indirme bağlantısı üretilir. Sayfada bir şey değişmez (refresh yok); son yedek, dosya tamamen
 * gönderilince rotada yazılır.
 */
export async function prepareBackupDownload(input: z.input<typeof schema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = schema.parse(input);
    await requirePassword(me, data.password, "Yedek");
    if (data.documents) {
      const [{ bytes }, last] = await Promise.all([uploadsTotal(), readLastBackup()]);
      const estimate = documentsDownloadBytes(bytes, last);
      if (estimate > PANEL_DOCUMENTS_MAX_BYTES) {
        throw new UserError(`${documentsTooBigText(estimate)}. Belgeli yedeği geliştiriciden isteyin.`);
      }
    }
    const fileName = backupFileName(new Date());
    return { url: `/api/yedek?t=${encodeURIComponent(backupHandle(me.id, data.documents, fileName))}`, fileName };
  });
}

const storedSchema = z.object({ password: z.string().max(200, "Parola hatalı"), name: z.string().max(120).refine(isAutoBackupName, "Yedek bulunamadı") });

/**
 * Ayarlar › Yedek › Otomatik yedekler › İndir: saklanan haftalık yedeğin indirme bağlantısı. Elle indirmeyle aynı
 * kalıp: yöneticinin kendi parolası, iki dakika geçerli ve bu kişiye özel bağlantı; dosyayı /api/yedek/kayitli verir.
 */
export async function prepareStoredBackupDownload(input: z.input<typeof storedSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = storedSchema.parse(input);
    await requirePassword(me, data.password, "Yedek", data.name);
    return { url: `/api/yedek/kayitli?t=${encodeURIComponent(storedBackupHandle(me.id, data.name))}`, fileName: data.name };
  });
}
