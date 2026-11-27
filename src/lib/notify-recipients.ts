/**
 * Bildirim alıcıları ve hesaplar (denetim E-52, E-53; docs/BILDIRIMLER.md › Alıcılar ve hesaplar): kasa raporu
 * e-postasının alıcıları, sabah e-postasının (bekçi uyarısı ve deneme de) bildirim adresleri ve muhasebeci paketinin
 * alıcıları (docs/MUHASEBE-PAKETI.md) tutar, ödeme ve maliyet taşır. Bir adres paneldeki bir hesaba aitse e-postayı
 * yalnız etkin bir yöneticinin ya da muhasebecinin hesabıysa alır: personel ve müdür hesabının ya da pasif hesabın
 * adresi gönderim anında düşer, hesabı olmayan adres (muhasebeci, sahibin kişisel adresi) kalır. Müdür
 * (docs/ROLLER.md): kasa raporunu panelde şubesinin rakamlarıyla görür; ama listeler şubeler arasında ortak olabilir
 * ("Tuzla ile aynı"), kasa e-postası karaoke ön ödemesini, sabah e-postası işletmenin ödemelerini ve maliyetini, paket
 * bütün şubelerin faturalarını, alış fiyatlarını, maaş ve kira harcamalarını taşır: tutucu seçenek, müdür hesabına
 * e-posta gitmez. Muhasebeci hesabı bugün hesabı olmayan muhasebeci adresi gibi alır (salt okunur rolü kasa raporlarını
 * rakamlarıyla, faturaları ve ödemeleri zaten görür). Kaydederken de denetlenir (adres eklemek, kasa ve paket
 * alıcıları); ama gönderim ona güvenmez: kayıttan sonra personele indirilen ya da pasif yapılan hesap da düşer, yönetici
 * zilde ve listede görür. Saf: sunucu, ekranlar ve testler paylaşır.
 */

import type { Role } from "./constants";
import { PACKAGE_HREF } from "./muhasebe/paket-ayar";

/** Adres neden e-posta almaz: personel ya da müdür hesabının ya da pasif bir hesabın adresi */
export type BlockReason = "staff" | "manager" | "inactive";

export interface DroppedRecipient {
  email: string;
  reason: BlockReason;
}

/** Ödeme ve maliyet taşıyan listeler: kasa raporu alıcıları, sabah e-postasının bildirim adresleri, paketin alıcıları */
export type RecipientList = "cash" | "digest" | "package";

export const RECIPIENT_LISTS: readonly RecipientList[] = ["cash", "digest", "package"];

export const RECIPIENT_LIST_LABEL: Record<RecipientList, string> = {
  cash: "kasa raporu alıcıları",
  digest: "sabah e-postasının bildirim adresleri",
  package: "muhasebeci paketinin alıcıları",
};

/** Hesabın e-posta alması engelleniyor mu; engelliyse nedeni (hesap yoksa null: adres e-postayı alır) */
export function blockReasonOf(account: { role: Role; active: boolean } | null | undefined): BlockReason | null {
  if (!account) return null;
  if (account.role === "staff") return "staff";
  if (account.role === "manager") return "manager";
  // Varsayılan kapalı: tanınmayan rol de almaz
  if (account.role !== "admin" && account.role !== "accountant") return "staff";
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

const REASON_SHORT: Record<BlockReason, string> = { staff: "personel hesabı", manager: "müdür hesabı", inactive: "pasif hesap" };

/** Listedeki satırın notu: "Personel hesabının adresi · e-posta gitmez" */
export const BLOCK_ROW_TEXT: Record<BlockReason, string> = {
  staff: "Personel hesabının adresi · e-posta gitmez",
  manager: "Müdür hesabının adresi · e-posta gitmez",
  inactive: "Pasif bir hesabın adresi · e-posta gitmez",
};

/** "ayse@ornek.com (personel hesabı), eski@ornek.com (pasif hesap)" */
export function droppedListText(dropped: readonly DroppedRecipient[]): string {
  return dropped.map((d) => `${d.email} (${REASON_SHORT[d.reason]})`).join(", ");
}

/** Gönderim günlüğünün eki: " · 1 adres atlandı (personel, müdür ya da pasif hesap)"; düşen yoksa boş */
export function droppedLogSuffix(dropped: readonly unknown[]): string {
  return dropped.length ? ` · ${dropped.length} adres atlandı (personel, müdür ya da pasif hesap)` : "";
}

/** Listeye neden konmadığı */
const WHY: Record<RecipientList, string> = {
  cash: "kasa e-postasında karaoke ön ödemesi var",
  digest: "sabah e-postasında ödemeler, fatura tutarları ve maliyet rakamları var",
  package: "muhasebeci paketinde bütün şubelerin faturaları, alış fiyatları, maaş ve kira harcamaları ve sabit giderleri var",
};

/** Müdürün adresinde ret metninin sonu: kasa raporunu panelde şubesinin rakamlarıyla görür; paketi hiç görmez */
const MANAGER_NOTE: Record<RecipientList, string> = {
  cash: "Müdür kasa raporunu panelde görür; yöneticinin ya da muhasebecinin adresini girin.",
  digest: "Müdür kasa raporunu panelde görür; yöneticinin ya da muhasebecinin adresini girin.",
  package: "Yöneticinin ya da muhasebecinin adresini girin.",
};

/**
 * Yöneticinin listeye yazdığı adres bir hesabın ve o hesap e-postayı almıyor (Kasa › Rapor alıcıları; Hatırlatıcılar ›
 * Bildirim adresleri; Ayarlar › Muhasebeci paketi)
 */
export function recipientRefusal(list: RecipientList, d: DroppedRecipient): string {
  if (d.reason === "staff") return `${d.email} bir personel hesabının adresi; ${WHY[list]}. Yöneticinin ya da muhasebecinin adresini girin.`;
  if (d.reason === "manager") return `${d.email} bir müdür hesabının adresi; ${WHY[list]}. ${MANAGER_NOTE[list]}`;
  return `${d.email} pasif bir hesabın adresi; pasif hesaba e-posta gitmez. Hesabı Kullanıcılar'dan silerseniz adres alıcı olabilir.`;
}

/**
 * Personel ve müdür Hesabım'da giriş e-postasını bir bildirim listesindeki adrese çeviremez (E-52): o adres gönderimde
 * düşerdi, kasa ya da sabah e-postası ya da muhasebeci paketi sahibine uyarısız gitmezdi. Başka bir hesabın adresine
 * de aynı metinle: personel adres deneyerek kimin listede olduğunu öğrenemesin (yöneticiye nedeni ayrı yazılır)
 */
export const PROFILE_LIST_REFUSAL = "Bu adres giriş e-postanız olamaz; başka bir adres yazın ya da yöneticiye sorun.";

/**
 * Personel ve müdür, adresi bir bildirim listesindeyken (muhasebeci paketinin alıcıları da) giriş e-postasını
 * değiştiremez: gönderim adresi hesaba bakarak düşürür, hesabı kalmayan eski adres muhasebecininki gibi yeniden e-posta
 * alırdı (kasa farkı, ödemeler, kâr; paket: bütün şubelerin faturaları, maaş ve kira) ve zil susardı
 */
export const PROFILE_OWN_LIST_REFUSAL = "Giriş e-postanız bildirim listesinde; değiştirmek için yöneticiye yazın.";

/** "kasa raporu alıcıları" / "… ve sabah e-postasının bildirim adresleri" / "…, … ve muhasebeci paketinin alıcıları" */
export function listsText(lists: readonly RecipientList[]): string {
  const labels = lists.map((l) => RECIPIENT_LIST_LABEL[l]);
  return labels.length > 2 ? `${labels.slice(0, -1).join(", ")} ve ${labels[labels.length - 1]}` : labels.join(" ve ");
}

/**
 * Kullanıcılar: kaydedilen hesap e-posta almıyor (personel, müdür ya da pasif) ve adresi bir listede. Gönderim onu
 * zaten düşürür; yönetici listeyi temizlesin diye söylenir
 */
export function userListNotice(user: { name: string; email: string }, reason: BlockReason, lists: readonly RecipientList[]): string {
  const who = reason === "staff" ? "personel hesabına" : reason === "manager" ? "müdür hesabına" : "pasif hesaba";
  return `${user.name} (${user.email}) ${listsText(lists)} arasında; ${who} bu e-posta gitmez. Gerekmiyorsa listeden kaldırın.`;
}

/**
 * Kullanıcılar: e-posta almayan (personel, müdür ya da pasif) hesabın eski adresi bir listede ve artık hiçbir hesaba ait
 * değil (giriş e-postası değişti ya da hesap silindi). Gönderim onu hesabı olmayan adres sayar, e-posta gider; yönetici
 * istemiyorsa listeden kaldırsın diye söylenir
 */
export function oldAddressNotice(user: { name: string; email: string }, lists: readonly RecipientList[], why: "rename" | "delete"): string {
  const what = why === "rename" ? `${user.name} hesabının eski adresi ${user.email}` : `${user.name} (${user.email})`;
  const because = why === "rename" ? "adres artık hiçbir hesaba ait değil" : "hesap silindiği için adres hiçbir hesaba ait değil";
  return `${what} ${listsText(lists)} arasında; ${because}, bu adrese e-posta gider. Gerekmiyorsa listeden kaldırın.`;
}

/** Listenin bütün adresleri düştü: "Alıcıların hepsi personel, müdür ya da pasif hesaba ait: ayse@… (personel hesabı)." */
export function allDroppedSentence(subject: "Alıcıların" | "Etkin bildirim adreslerinin", dropped: readonly DroppedRecipient[]): string {
  return `${subject} hepsi personel, müdür ya da pasif hesaba ait: ${droppedListText(dropped)}.`;
}

/** Zilin satırı: listenin adı, ayarın yeri ve bağlantısı */
const BELL: Record<RecipientList, { what: string; where: string; href: string }> = {
  cash: { what: "Kasa raporu e-postası", where: "Kasa › Rapor alıcıları'ndan", href: "/panel/kasa#rapor-alicilari" },
  digest: { what: "Sabah e-postası", where: "Hatırlatıcılar › E-posta bildirimleri'nden", href: "/panel/hatirlaticilar#e-posta-bildirimleri" },
  package: { what: "Muhasebeci paketi", where: "Ayarlar › Muhasebeci paketi'nden", href: PACKAGE_HREF },
};

/** Zilin satırı: listedeki adreslerden gönderilmeyenler (yalnız yönetici) */
export function blockedBell(list: RecipientList, dropped: readonly DroppedRecipient[]): { id: string; title: string; body: string; href: string } {
  const n = dropped.length;
  const { what, where, href } = BELL[list];
  return {
    id: `alici-${list}-${dropped.map((d) => `${emailKey(d.email)}:${d.reason}`).join(",")}`,
    title: `${what} ${n === 1 ? "bir adrese" : `${n} adrese`} gitmiyor`,
    body: `${droppedListText(dropped)}: bu hesaplara ödeme ve maliyet e-postası gitmez. Adresi ${where} kaldırın ya da doğru adresi yazın.`,
    href,
  };
}

/**
 * Sabah e-postasının alıcı grupları (şube kapsamı C P1-11; docs/BILDIRIMLER.md › Sabah e-postası): adresin şubeleri boşsa
 * ya da bütün kasaları kapsıyorsa bütün şubelerin e-postası (bugünkü tek e-posta, `branchIds` boş); değilse aynı şube
 * kümesindeki adresler bir e-posta alır. Kapanmış ya da silinmiş şube yok sayılır; seçili şubelerinin hiçbiri açık
 * değilse adres hiçbir gruba girmez (kapsamı sessizce "bütün şubeler"e genişlemez; Hatırlatıcılar'daki satırı bunu
 * söyler, branchesClosed). Sıra: bütün şubeler önce, sonra kasaların sırası
 */
export function digestGroups(rows: readonly { email: string; branchIds: readonly string[] }[], tills: readonly { id: string }[]): { branchIds: string[]; emails: string[] }[] {
  const groups = new Map<string, { branchIds: string[]; emails: string[] }>();
  for (const r of rows) {
    if (branchesClosed(r.branchIds, tills)) continue;
    const ids = tills.filter((t) => r.branchIds.includes(t.id)).map((t) => t.id);
    const branchIds = ids.length === 0 || ids.length === tills.length ? [] : ids;
    const key = branchIds.join(",");
    const g = groups.get(key) ?? { branchIds, emails: [] };
    g.emails.push(r.email);
    groups.set(key, g);
  }
  const rank = (g: { branchIds: string[] }) => (g.branchIds.length ? tills.findIndex((t) => t.id === g.branchIds[0]) + 1 : 0);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

/** Adres şubeye bağlı ama seçili şubelerinin hiçbiri açık kasa değil: sabah e-postasını ve gün sonu yedeğini almaz */
export function branchesClosed(branchIds: readonly string[] | undefined, tills: readonly { id: string }[]): boolean {
  return !!branchIds?.length && !branchIds.some((id) => tills.some((t) => t.id === id));
}

/** Ödeme kalemi grubun e-postasına girer mi: bütün şubelerde hepsi; şubeye bağlı grupta şubenin ve işletme genelinin (şubesiz) */
export function digestItemInGroup(branchId: string | null, groupBranchIds: readonly string[]): boolean {
  return groupBranchIds.length === 0 || branchId === null || groupBranchIds.includes(branchId);
}
