import "server-only";

import { eq } from "drizzle-orm";

import { parsePayrollSettings, PAYROLL_SETTINGS_KEY, type PayrollSettings } from "@/lib/bordro/settings";
import { getDb, schema as s } from "@/server/db";

/**
 * Bordronun saklı ayarları (`integration_state` › `tax.settings`, eski Vergi ayarları; src/lib/bordro/settings.ts):
 * hesap döneminin başı, asgari ücret desteği, SGK işveren payının elle değeri. Nakit planının maaş ve SGK satırı okur.
 * Kayıt yoksa ya da bozuksa varsayılanlar
 */
export async function loadPayrollSettings(): Promise<PayrollSettings> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, PAYROLL_SETTINGS_KEY)).limit(1);
  return parsePayrollSettings(row?.value);
}
