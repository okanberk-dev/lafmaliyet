import { DEFAULT_BRANCH_ID, type BranchRow } from "@/lib/branches";
import { settingSource, type SettingLink } from "@/lib/branch-settings/rules";

/*
 * Şube başına Paraşüt hesabının saf kuralları (docs/PARASUT.md › Şube başına Paraşüt hesabı; docs/SUBE.md › Şube başına
 * ayarlar). Veritabanına ve ağa dokunmaz; okuma ve yazma src/server/parasut/accounts.ts'te.
 *
 * Hesap = kendi Paraşüt ayarı olan şube. Hesabın kimliği o şubenin kimliğidir ("tuzla", "marina"). Şube "Diğer şubeyle
 * aynı" seçiliyse (branch_settings › parasut, bağ tek adım) bağlandığı şubenin hesabını kullanır: tek bağlantı, tek
 * eşitleme, aynı firma iki kez çekilmez. Satırı olmayan şube varsayılan şubeye (Tuzla) örtük bağlıdır; bugünkü tek
 * hesaplı kurulum hiçbir şey yapmadan sürer.
 *
 * Varsayılan şubenin hesabı **eski adları korur**: integration_state anahtarları (parasut.settings, parasut.token,
 * parasut.cursor…), ürün anahtarları (p:<kimlik>) ve kalem kimlikleri değişmez, ortam değişkenleri (PARASUT_*) yalnız
 * onun yedeğidir. Veri göçü yok, geri dönüş güvenli. Öbür hesapların anahtarları `<ad>:<hesap>` olur.
 */

/** Varsayılan hesap: varsayılan şubenin (eski tek hesap) */
export const DEFAULT_PARASUT_ACCOUNT = DEFAULT_BRANCH_ID;

/** Hesabın durum anahtarı: varsayılan hesapta eski ad, öbürlerinde `<ad>:<hesap>` */
export function parasutKey(base: string, account: string): string {
  return account === DEFAULT_PARASUT_ACCOUNT ? base : `${base}:${account}`;
}

/**
 * Paraşüt kimliklerinden türeyen panel anahtarlarının (kalem kimliği, ürün anahtarı p:…) hesap öneki: varsayılan
 * hesapta boş (eski anahtarlar aynı kalır), öbürlerinde `<hesap>:`. Paraşüt kimlikleri firmalar arasında çakışırsa
 * iki firmanın kalemi ya da ürünü birbirine karışmasın
 */
export function accountNs(account: string): string {
  return account === DEFAULT_PARASUT_ACCOUNT ? "" : `${account}:`;
}

/**
 * Yok sayılan ve silinen Paraşüt faturalarının listesindeki anahtar (parasut.ignore, parasut.deleted; tek liste):
 * varsayılan hesapta eski biçim (`123`, `ei:456`), öbürlerinde `<hesap>/<anahtar>`
 */
export function qualifyBillKey(account: string, key: string): string {
  return account === DEFAULT_PARASUT_ACCOUNT ? key : `${account}/${key}`;
}

/** Listedeki anahtarın hesabı ve Paraşüt anahtarı (önekli değilse varsayılan hesap) */
export function parseBillKey(raw: string): { account: string; key: string } {
  const i = raw.indexOf("/");
  return i > 0 ? { account: raw.slice(0, i), key: raw.slice(i + 1) } : { account: DEFAULT_PARASUT_ACCOUNT, key: raw };
}

/** Hesabın faturaları: "branch" tek şubenin hesabıysa o şubenin (varsayılan), "shared" hesabın şubesine yazılmaz (tedarikçinin varsayılanı) */
export type ParasutInvoiceScope = "branch" | "shared";

export interface ParasutAccountInfo {
  /** Hesabın kimliği (sahibi şube) */
  id: string;
  /** Sahibi şubenin adı */
  name: string;
  /** Hesabı kullanan açık şubeler (sahibi dahil; sıralı) */
  users: string[];
}

type Branch = Pick<BranchRow, "id" | "name" | "kind" | "active" | "sortOrder">;

const isTill = (b: Branch) => b.kind === "fiziksel" && b.active;

/** Şubenin kullandığı hesap: kendi ayarıysa kendisi, bağlıysa bağlandığı şube (online kanal ve bilinmeyen: varsayılan) */
export function accountOfBranch(branchId: string | null, rows: readonly SettingLink[], branches: readonly Branch[]): string {
  const b = branchId ? branches.find((x) => x.id === branchId) : null;
  if (!b || b.kind !== "fiziksel") return DEFAULT_PARASUT_ACCOUNT;
  return settingSource({ linkable: true }, b.id, rows, branches).from;
}

/**
 * Hesaplar: açık şubelerin kullandığı farklı hesaplar, şube sırasıyla. Varsayılan hesap her zaman listededir (ortamla
 * kurulmuş tek hesaplı kurulum; şubesi kapalı olsa da eşitlemesi durmaz)
 */
export function parasutAccounts(rows: readonly SettingLink[], branches: readonly Branch[]): ParasutAccountInfo[] {
  const users = new Map<string, string[]>();
  users.set(DEFAULT_PARASUT_ACCOUNT, []);
  for (const b of branches.filter(isTill)) {
    const acc = accountOfBranch(b.id, rows, branches);
    users.set(acc, [...(users.get(acc) ?? []), b.id]);
  }
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  return [...users.entries()].map(([id, u]) => ({ id, name: name(id), users: u }));
}

/**
 * Hesaptan gelen faturanın şubesi (sahibin kararı, 25 Kasım 2026): hesabı yalnız sahibi şube kullanıyorsa (ayrı
 * Paraşüt hesabı) faturaları o şubenin; şubeler aynı hesaptaysa null: fatura tedarikçinin varsayılan şubesini alır, o da
 * yoksa "Şubesi seçilmemiş" (src/lib/invoice-branch.ts newInvoiceBranch). "shared" seçilmişse ayrı hesabın faturaları da
 * böyle (Paraşüt ekranındaki seçim). Şube yalnız yeni açılan faturaya yazılır:
 * var olan faturanın şubesi eşitlemede değişmez
 */
export function invoiceBranchOf(account: Pick<ParasutAccountInfo, "id" | "users">, scope: ParasutInvoiceScope): string | null {
  if (scope === "shared") return null;
  return account.users.length === 1 && account.users[0] === account.id ? account.id : null;
}

/** Faturanın kapsam seçimi (kayıttaki değer; bozuk ya da yoksa "branch") */
export function parseInvoiceScope(raw: unknown): ParasutInvoiceScope {
  return raw === "shared" ? "shared" : "branch";
}

/**
 * İki hesap aynı firmayı çekemez: aynı firma iki kez eşitlenirse faturalar çiftlenir. Başka hesabın firma numarasıyla
 * aynıysa ret metni (yoksa null)
 */
export function companyClash(account: string, companyId: string | null, others: readonly { id: string; name: string; companyId: string | null }[]): string | null {
  if (!companyId) return null;
  const same = others.find((o) => o.id !== account && o.companyId === companyId);
  return same ? `Bu firma (${companyId}) ${same.name} şubesinin Paraşüt hesabında zaten bağlı. Aynı firma iki kez eşitlenmez; ${same.name} ile aynı hesabı kullanmak için Şube ayarları'ndan “${same.name} ile aynı”yı açın.` : null;
}
