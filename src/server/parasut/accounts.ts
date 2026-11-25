import "server-only";

import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { ALL_BRANCHES } from "@/lib/branches";
import { accountOfBranch, DEFAULT_PARASUT_ACCOUNT, invoiceBranchOf, parasutAccounts, type ParasutAccountInfo } from "@/lib/parasut/accounts";
import { missingSettings } from "@/lib/parasut/settings";
import { UserError } from "@/server/actions/util";
import { settingLinks } from "@/server/branch-settings";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";

import { forgetParasutToken } from "./client";
import { hasParasutInvoices, loadInvoiceScope, loadParasutSettings } from "./config";
import { forgetParasutConnect } from "./connect";
import { parasutAccountKeys } from "./keys";

/*
 * Şube başına Paraşüt hesapları (docs/PARASUT.md › Şube başına Paraşüt hesabı; saf kurallar src/lib/parasut/accounts.ts).
 * Hesap = kendi Paraşüt ayarı olan şube; "Diğer şubeyle aynı" (branch_settings › parasut) bağlı şubeler bağlandığı
 * şubenin hesabını kullanır. Eşitleme her farklı hesap için bir kez çalışır (aynı firma iki kez çekilmez); bir hesabın
 * eşitlemesi yalnız kendi faturalarını görür, günceller ve kaldırır.
 */

type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Açık şubelerin kullandığı hesaplar (varsayılan hesap her zaman listede) */
export async function loadParasutAccounts(db: Reader = getDb()): Promise<ParasutAccountInfo[]> {
  const [rows, branches] = await Promise.all([settingLinks(PARASUT_GROUP.id, db), listBranches(db as DB)]);
  return parasutAccounts(rows, branches);
}

/** Şubenin kullandığı hesap (online kanal, bilinmeyen ya da null: varsayılan hesap) */
export async function parasutAccountOf(branchId: string | null, db: Reader = getDb()): Promise<string> {
  const [rows, branches] = await Promise.all([settingLinks(PARASUT_GROUP.id, db), listBranches(db as DB)]);
  return accountOfBranch(branchId, rows, branches);
}

/** Panelin seçili şubesinin hesabı ("Tümü": varsayılan hesap) */
export async function parasutAccountForScope(): Promise<string> {
  const scope = await currentBranchScope();
  return parasutAccountOf(scope === ALL_BRANCHES ? null : scope);
}

/** Hesap geçerli mi (açık şubelerin kullandığı hesaplardan biri ya da varsayılan) */
export async function isParasutAccount(account: string, db: Reader = getDb()): Promise<boolean> {
  return (await loadParasutAccounts(db)).some((a) => a.id === account);
}

/** Eylemlerin hesabı: verilmezse seçili şubeninki; verilen hesap geçerli değilse ret */
export async function parasutAccountInput(raw: unknown): Promise<string> {
  if (raw === undefined || raw === null || raw === "") return parasutAccountForScope();
  if (typeof raw !== "string" || !(await isParasutAccount(raw))) throw new UserError("Paraşüt hesabı bulunamadı; sayfayı yenileyin");
  return raw;
}

/** Zorunlu ayarları tamam olan hesaplar (eşitlenecekler), şube sırasıyla */
export async function configuredParasutAccounts(db: Reader = getDb()): Promise<ParasutAccountInfo[]> {
  const accounts = await loadParasutAccounts(db);
  const ok = await Promise.all(accounts.map(async (a) => missingSettings((await loadParasutSettings(a.id, db)).resolved).length === 0));
  return accounts.filter((_, i) => ok[i]);
}

/** En az bir hesabın ayarları tamam mı (cron işleri, tedarikçi sayfası) */
export async function anyParasutConfigured(): Promise<boolean> {
  return (await configuredParasutAccounts()).length > 0;
}

/** Hesaptan yeni açılan faturanın şubesi (invoiceBranchOf: ayrı hesap → o şube, ortak hesap → null: tedarikçinin varsayılanı ya da şubesi seçilmemiş) */
export async function accountInvoiceBranch(account: string, db: Reader = getDb()): Promise<string | null> {
  const info = (await loadParasutAccounts(db)).find((a) => a.id === account);
  if (!info) return null;
  return invoiceBranchOf(info, await loadInvoiceScope(account, db));
}

/**
 * Hesabın gördüğü faturalar: kendi hesabındakiler ve Paraşüt'e bağlanmamış elle/Excel kayıtları (eşitleme onlarla
 * eşleşip bağlayabilir). Hesabı boş ama Paraşüt kimliği olan eski kayıt varsayılan hesabındır (göç 0083 hepsine yazdı;
 * testlerin ve yedekten dönen eski kayıtların hesabı boş olabilir): öbür hesaplar onu görmez, kaldıramaz
 */
export function invoiceAccountWhere(account: string): SQL {
  if (account === DEFAULT_PARASUT_ACCOUNT) return or(eq(s.invoices.parasutAccount, account), isNull(s.invoices.parasutAccount))!;
  return or(eq(s.invoices.parasutAccount, account), and(isNull(s.invoices.parasutAccount), isNull(s.invoices.externalId), isNull(s.invoices.eInvoiceId)))!;
}

/** Faturanın hesabı (boşsa ve Paraşüt kimliği varsa varsayılan hesap) */
export const invoiceAccountOf = (row: { parasutAccount: string | null }): string => row.parasutAccount ?? DEFAULT_PARASUT_ACCOUNT;

/**
 * Şube "Diğer şubeyle aynı" yapılmadan önce (setBranchSettingLink, aynı işlemde): şubenin kendi hesabı varsa ve o
 * hesaptan fatura geldiyse ret (faturalar sahipsiz kalır, eşitlemesi durur; firma değiştirmekle aynı kural). Fatura
 * yoksa hesabın ayarları, oturumu, yarım bağlanma isteği ve eşitleme durumu silinir: sır başka şubeye taşınmaz, bağ
 * kapatılınca şube yine boş bir hesapla başlar
 */
export async function beforeParasutLink(tx: Tx, branchId: string) {
  if (branchId === DEFAULT_PARASUT_ACCOUNT) return; // varsayılan şube bağlanamaz (settingLinkError reddeder)
  if (await hasParasutInvoices(branchId, tx)) {
    throw new UserError("Bu şubenin kendi Paraşüt hesabından fatura geldi; başka şubenin hesabına bağlanamaz (faturalar sahipsiz kalırdı). Yazılımcıya başvurun.");
  }
  const [running] = await tx
    .select({ id: s.parasutSyncRuns.id })
    .from(s.parasutSyncRuns)
    .where(and(eq(s.parasutSyncRuns.status, "running"), eq(s.parasutSyncRuns.account, branchId), sql`${s.parasutSyncRuns.startedAt} > now() - interval '2 minutes'`))
    .limit(1);
  if (running) throw new UserError("Bu şubenin Paraşüt eşitlemesi sürüyor; bitince yeniden deneyin.");
  await forgetParasutToken(branchId, tx);
  await forgetParasutConnect(branchId, tx);
  await tx.delete(s.integrationState).where(inArray(s.integrationState.key, parasutAccountKeys(branchId)));
}
