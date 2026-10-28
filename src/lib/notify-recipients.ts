/**
 * Bildirim alıcıları ve hesaplar (denetim E-52, E-53; docs/BILDIRIMLER.md › Alıcılar ve hesaplar): kasa raporu
 * e-postasının alıcıları ve sabah e-postasının (bekçi uyarısı ve deneme de) bildirim adresleri tutar, ödeme ve maliyet
 * taşır. Bir adres paneldeki bir hesaba aitse e-postayı yalnız etkin bir yöneticinin hesabıysa alır: personel hesabının
 * ya da pasif hesabın adresi gönderim anında düşer, hesabı olmayan adres (muhasebeci, sahibin kişisel adresi) kalır.
 * Kaydederken de denetlenir (adres eklemek, kasa alıcıları); ama gönderim ona güvenmez: kayıttan sonra personele
 * indirilen ya da pasif yapılan hesap da düşer, yönetici zilde ve listede görür. Saf: sunucu, ekranlar ve testler paylaşır.
 */

/** Adres neden e-posta almaz: personel hesabının ya da pasif bir hesabın adresi */
export type BlockReason = "staff" | "inactive";

export interface DroppedRecipient {
  email: string;
  reason: BlockReason;
}

/** Ödeme ve maliyet taşıyan listeler: kasa raporu alıcıları, sabah e-postasının bildirim adresleri */
export type RecipientList = "cash" | "digest";

export const RECIPIENT_LIST_LABEL: Record<RecipientList, string> = {
  cash: "kasa raporu alıcıları",
  digest: "sabah e-postasının bildirim adresleri",
};

/** Hesabın e-posta alması engelleniyor mu; engelliyse nedeni (hesap yoksa null: adres e-postayı alır) */
export function blockReasonOf(account: { role: "admin" | "staff"; active: boolean } | null | undefined): BlockReason | null {
  if (!account) return null;
  if (account.role === "staff") return "staff";
  return account.active ? null : "inactive";
}

/** Adres karşılaştırması: büyük-küçük harf fark etmez (adresler küçük harfle saklanır; eski satırlar için de) */
export const emailKey = (email: string) => email.trim().toLocaleLowerCase("en");

/** Listeyi gidecek ve düşen adreslere ayırır (sıra korunur). `blocked`: emailKey → neden */
export function splitByBlocked(emails: readonly string[], blocked: ReadonlyMap<string, BlockReason>): { to: string[]; dropped: DroppedRecipient[] } {
  const to: string[] = [];
  const dropped: DroppedRecipient[] = [];
  for (const email of emails) {
    const reason = blocked.get(emailKey(email));
    if (reason) dropped.push({ email, reason });
    else to.push(email);
  }
  return { to, dropped };
}

const REASON_SHORT: Record<BlockReason, string> = { staff: "personel hesabı", inactive: "pasif hesap" };

/** Listedeki satırın notu: "Personel hesabının adresi · e-posta gitmez" */
export const BLOCK_ROW_TEXT: Record<BlockReason, string> = {
  staff: "Personel hesabının adresi · e-posta gitmez",
  inactive: "Pasif bir hesabın adresi · e-posta gitmez",
};

/** "ayse@ornek.com (personel hesabı), eski@ornek.com (pasif hesap)" */
export function droppedListText(dropped: readonly DroppedRecipient[]): string {
  return dropped.map((d) => `${d.email} (${REASON_SHORT[d.reason]})`).join(", ");
}

/** Gönderim günlüğünün eki: " · 1 adres atlandı (personel ya da pasif hesap)"; düşen yoksa boş */
export function droppedLogSuffix(dropped: readonly unknown[]): string {
  return dropped.length ? ` · ${dropped.length} adres atlandı (personel ya da pasif hesap)` : "";
}

/** Listeye neden konmadığı */
const WHY: Record<RecipientList, string> = {
  cash: "kasa e-postasında karaoke ön ödemesi var",
  digest: "sabah e-postasında ödemeler, fatura tutarları ve maliyet rakamları var",
};

/**
 * Yöneticinin listeye yazdığı adres bir hesabın ve o hesap e-postayı almıyor (Kasa › Rapor alıcıları; Hatırlatıcılar ›
 * Bildirim adresleri)
 */
export function recipientRefusal(list: RecipientList, d: DroppedRecipient): string {
  if (d.reason === "staff") return `${d.email} bir personel hesabının adresi; ${WHY[list]}. Yöneticinin ya da muhasebecinin adresini girin.`;
  return `${d.email} pasif bir hesabın adresi; pasif hesaba e-posta gitmez. Hesabı Kullanıcılar'dan silerseniz adres alıcı olabilir.`;
}

/**
 * Personel Hesabım'da giriş e-postasını bir bildirim listesindeki adrese çeviremez (E-52): o adres gönderimde düşerdi,
 * kasa ya da sabah e-postası sahibine uyarısız gitmezdi
 */
export const PROFILE_LIST_REFUSAL = "Bu adres bildirim listesinde; giriş e-postanız olamaz. Yöneticiye yazın.";

/** "kasa raporu alıcıları" / "… ve sabah e-postasının bildirim adresleri" */
export function listsText(lists: readonly RecipientList[]): string {
  return lists.map((l) => RECIPIENT_LIST_LABEL[l]).join(" ve ");
}

/**
 * Kullanıcılar: kaydedilen hesap e-posta almıyor (personel ya da pasif) ve adresi bir listede. Gönderim onu zaten düşürür;
 * yönetici listeyi temizlesin diye söylenir
 */
export function userListNotice(user: { name: string; email: string }, reason: BlockReason, lists: readonly RecipientList[]): string {
  const who = reason === "staff" ? "personel hesabına" : "pasif hesaba";
  return `${user.name} (${user.email}) ${listsText(lists)} arasında; ${who} bu e-posta gitmez. Gerekmiyorsa listeden kaldırın.`;
}

/** Zilin satırı: listedeki adreslerden gönderilmeyenler (yalnız yönetici) */
export function blockedBell(list: RecipientList, dropped: readonly DroppedRecipient[]): { id: string; title: string; body: string; href: string } {
  const n = dropped.length;
  const what = list === "cash" ? "Kasa raporu e-postası" : "Sabah e-postası";
  const where = list === "cash" ? "Kasa › Rapor alıcıları'ndan" : "Hatırlatıcılar › E-posta bildirimleri'nden";
  return {
    id: `alici-${list}-${dropped.map((d) => `${emailKey(d.email)}:${d.reason}`).join(",")}`,
    title: `${what} ${n === 1 ? "bir adrese" : `${n} adrese`} gitmiyor`,
    body: `${droppedListText(dropped)}: bu hesaplara ödeme ve maliyet e-postası gitmez. Adresi ${where} kaldırın ya da doğru adresi yazın.`,
    href: list === "cash" ? "/panel/kasa#rapor-alicilari" : "/panel/hatirlaticilar#e-posta-bildirimleri",
  };
}
