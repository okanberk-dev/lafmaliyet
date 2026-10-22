"use server";

import { z } from "zod";

import { backupFileName, PANEL_DOCUMENTS_MAX_BYTES } from "@/lib/backup/format";
import { formatBytes } from "@/lib/documents";
import { requireAdmin } from "@/server/auth/dal";
import { requirePassword } from "@/server/auth/step-up";
import { backupHandle, uploadsTotal } from "@/server/backup/state";

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
      const { bytes } = await uploadsTotal();
      if (bytes > PANEL_DOCUMENTS_MAX_BYTES) {
        throw new UserError(`Belgeler panelden indirilemeyecek kadar büyük (${formatBytes(bytes)}). Belgeli yedeği bilgisayardan alın: docs/YEDEK.md › Belgeler.`);
      }
    }
    const fileName = backupFileName(new Date());
    return { url: `/api/yedek?t=${encodeURIComponent(backupHandle(me.id, data.documents, fileName))}`, fileName };
  });
}
