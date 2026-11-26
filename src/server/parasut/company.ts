import "server-only";

import { companiesOf, taxVerdict, type OtherCompany, type ParasutCompany, type TaxVerdict } from "@/lib/parasut/company";

import { configuredParasutAccounts } from "./accounts";
import { parasutConnection, ParasutClient, parasutMe } from "./client";
import { readParasutConfig, type ParasutConfig } from "./config";

/**
 * Ayrı Paraşüt firması bağlanırken "Aynı vergi numarası mı?" (docs/PARASUT.md › Şube başına Paraşüt hesabı › Aynı
 * vergi numarası; saf kurallar src/lib/parasut/company.ts). Bağlanan firmanın vergi numarası yeni belirteçle
 * (`/v4/me?include=companies`) okunur ve öbür hesapların firmalarınınkiyle karşılaştırılır:
 *
 * - Öbür hesabın firması yeni belirtecin listesinde görünüyorsa (aynı Paraşüt kullanıcısı iki firmaya da erişiyor)
 *   vergi numarası oradan; görünmüyorsa ve hesap bağlıysa kendi kayıtlı oturumuyla okunur (eşitlemenin yolu: süresi
 *   dolan belirteç kilit altında yenilenir). Bağlı olmayan ve görünmeyen hesap karşılaştırılmaz: o hesap bağlanırken
 *   bu hesapla karşılaştırılır.
 * - Okunamayan vergi numarası `unknown` olur (yönetici "farklı" diyerek bağlar); ağa takılırsa bağlanma durmaz.
 *
 * Başka hesap yoksa (tek hesaplı kurulum) Paraşüt'e istek atılmaz.
 */

/** Öbür hesabın kayıtlı oturumuyla okuma en çok bu kadar sürer (dönüş yolu yöneticiyi bekletir) */
const OTHER_READ_MS = 20_000;

/** Bağlanan firmanın ve öbür hesapların vergi numaralarından karar */
export async function connectTaxVerdict(cfg: ParasutConfig, accessToken: string): Promise<TaxVerdict> {
  const others = (await configuredParasutAccounts()).filter((a) => a.id !== cfg.account);
  if (!others.length) return { kind: "clear" };
  let visible: ParasutCompany[] = [];
  try {
    visible = companiesOf(await parasutMe(cfg, accessToken));
  } catch (e) {
    console.warn("[parasut] bağlanan firmanın vergi numarası okunamadı:", (e as Error)?.message ?? e);
  }
  const mine = visible.find((c) => c.id === cfg.companyId)?.taxNumber ?? null;
  const compared: OtherCompany[] = [];
  for (const a of others) {
    let other: ParasutConfig;
    try {
      other = await readParasutConfig(a.id);
    } catch {
      continue;
    }
    const seen = visible.find((c) => c.id === other.companyId);
    if (seen) {
      compared.push({ name: a.name, taxNumber: seen.taxNumber });
      continue;
    }
    if (!(await parasutConnection(undefined, other, a.id)).connected) continue;
    compared.push({ name: a.name, taxNumber: await savedCompanyTax(other) });
  }
  return taxVerdict(mine, compared);
}

/** Hesabın kendi kayıtlı oturumuyla firmasının vergi numarası; okunamazsa null */
async function savedCompanyTax(cfg: ParasutConfig): Promise<string | null> {
  try {
    const client = new ParasutClient(cfg);
    client.setDeadline(Date.now() + OTHER_READ_MS);
    return companiesOf(await client.get("me", { include: "companies" }, { root: true })).find((c) => c.id === cfg.companyId)?.taxNumber ?? null;
  } catch (e) {
    console.warn(`[parasut] ${cfg.account} hesabının vergi numarası okunamadı:`, (e as Error)?.message ?? e);
    return null;
  }
}
