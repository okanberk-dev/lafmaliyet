/**
 * İşlem geçmişinde kişi (saf; Ayarlar › İşlem geçmişi ve Hesabım'daki ad değişikliği; tests/giris-cihaz.test.ts).
 * Kayıttaki ad, işlemin yapıldığı andaki addır ve serbest metindir: kişi Hesabım'dan kendi adını değiştirebilir.
 * Kayıt hesabı da tutar (activity_log.user_id); ad tek başına yanıltabiliyorsa hesabın e-postası yanında yazılır.
 */

/** Adların aynı sayılması: baştaki ve sondaki boşluk, çoklu boşluk ve büyük-küçük harf (Türkçe) gözetilmez */
const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");

export function sameName(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

export interface LogAccount {
  id: number;
  name: string;
  email: string;
}

/**
 * Kaydın kişisi: ad, gerekiyorsa e-posta ve süzgeçteki etiket. E-posta şu durumlarda görünür: hesap sonradan adını
 * değiştirmiş ya da bugün başka bir hesap da bu adı taşıyor (biri kendine sahibinin adını verirse kayıtları sahibininki
 * gibi görünmesin). Hesabı olmayan kayıt (eski kayıt, sistem, site) yalnız adıyla.
 */
export function logPerson(stored: string | null, account: LogAccount | null, accounts: readonly LogAccount[]): { name: string; email: string | null; label: string } {
  const name = stored?.trim() || "Sistem";
  const ambiguous = account !== null && (!sameName(account.name, name) || accounts.some((a) => a.id !== account.id && sameName(a.name, name)));
  const email = ambiguous ? account.email : null;
  return { name, email, label: email ? `${name} (${email})` : name };
}

/** Kişinin kendine verebileceği ad: başka bir hesabın adı olamaz (işlem geçmişinde onun gibi görünmesin) */
export function nameTakenBy(name: string, me: number, accounts: readonly Pick<LogAccount, "id" | "name">[]): boolean {
  return accounts.some((a) => a.id !== me && sameName(a.name, name));
}
