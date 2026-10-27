/**
 * Komisyon kanalları (saf; sunucu ve tarayıcı birlikte kullanır; tests/komisyon.test.ts): yemek kartı şirketleri ve
 * sipariş platformları, faturadaki adın hangi kanala ait olduğu ve fatura kalemlerinin sınıfı. Yalnız kategorisi
 * Komisyon olan faturalar kanala bağlanır (src/lib/commission/report.ts): Migros'un market faturası "Hammadde" olduğu
 * için gevşek önekler ("migros", "getir") güvenlidir. Paraşüt'ün kategori kuralı (src/server/parasut/mapping.ts
 * COMMISSION_SUPPLIERS, pickCategory) değişmez; yeni bir marka = CHANNELS'a bir satır ve bir test. Ayrıntı:
 * docs/KOMISYON.md.
 */

export type ChannelKind = "meal" | "platform";

export const CHANNEL_KEYS = ["pluxee", "multinet", "edenred", "setcard", "metropol", "yemeksepeti", "trendyol", "getir", "migros"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export interface ChannelDef {
  key: ChannelKey;
  label: string;
  kind: ChannelKind;
  /** Adın sadeleştirilmiş ve boşluksuz hâlinin başı (fold → boşluksuz) */
  prefixes: readonly string[];
  /** Sadeleştirilmiş adda bunlardan biri varsa kanal sayılmaz ("Metropol İstanbul AVM" kira faturası) */
  exclude?: RegExp;
}

/** Kayıt: önce yemek kartları, sonra platformlar (ekranın ve Kanallar kartının sırası) */
export const CHANNELS: readonly ChannelDef[] = [
  { key: "pluxee", label: "Pluxee", kind: "meal", prefixes: ["pluxee", "sodexo"] },
  { key: "multinet", label: "Multinet", kind: "meal", prefixes: ["multinet"] },
  { key: "edenred", label: "Edenred", kind: "meal", prefixes: ["edenred", "ticketrestaurant"] },
  { key: "setcard", label: "Setcard", kind: "meal", prefixes: ["setcard", "setkart"] },
  // Paraşüt'ün kuralıyla aynı fikir (pickCategory): mekân ya da kira sözcüğü geçen "Metropol" yemek kartı değildir
  { key: "metropol", label: "Metropol", kind: "meal", prefixes: ["metropol"], exclude: /\b(avm|kira|alisveris|merkezi|plaza|residence|otel)\b/ },
  { key: "yemeksepeti", label: "Yemeksepeti", kind: "platform", prefixes: ["yemeksepeti"] },
  // DSM Grup: Trendyol'un ticari unvanı (yalnız Komisyon faturalarına bakıldığı için başka bir faturayı çekmez)
  { key: "trendyol", label: "Trendyol Go", kind: "platform", prefixes: ["trendyol", "dsmgrup"] },
  { key: "getir", label: "Getir", kind: "platform", prefixes: ["getir"] },
  { key: "migros", label: "Migros Yemek", kind: "platform", prefixes: ["migrosyemek", "migros"] },
];

const BY_KEY = new Map(CHANNELS.map((c) => [c.key, c] as const));

export function channelDef(key: ChannelKey): ChannelDef {
  return BY_KEY.get(key)!;
}

export function isChannelKey(v: string): v is ChannelKey {
  return BY_KEY.has(v as ChannelKey);
}

/** Türkçe küçük harf, ı → i, aksanlar silinir, harf ve rakam dışı boşluk olur, boşluklar teke iner */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Adların ilki hangi kanala bağlanıyorsa o (faturadaki ad, sonra tedarikçi kartının adı ve diğer adları); hiçbiri
 * bağlanmıyorsa null. Ad sadeleştirilip boşlukları atılınca kanalın öneklerinden biriyle başlamalı: "Yemek Sepeti" ve
 * "YEMEKSEPETİ ELEKTRONİK İLETİŞİM A.Ş." ikisi de Yemeksepeti.
 */
export function channelOf(names: readonly (string | null | undefined)[]): ChannelKey | null {
  for (const name of names) {
    if (!name) continue;
    const f = fold(name);
    const compact = f.replace(/ /g, "");
    if (!compact) continue;
    const hit = CHANNELS.find((c) => c.prefixes.some((p) => compact.startsWith(p)) && !c.exclude?.test(f));
    if (hit) return hit.key;
  }
  return null;
}

/**
 * LafPOS'taki ödeme türünün kanal yazısı (pos_day_reports.payments[].channel; docs/LAFPOS.md) → komisyon kanalı:
 * anahtarın kendisi ("pluxee", büyük / küçük harf farkı yok) ya da bir kanalın adı ("Sodexo", "Ticket Restaurant",
 * "Trendyol Go"); boşsa ya da tanınmıyorsa null. LafPOS ödeme türünde kanalı listeden seçtirir (aynı anahtarlar), eski
 * LafPOS serbest metin yazabilir.
 */
export function lafposChannel(raw: string | null | undefined): ChannelKey | null {
  const v = raw?.trim();
  if (!v) return null;
  const key = v.toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
  return isChannelKey(key) ? key : channelOf([v]);
}

// ---------------------------------------------------------------- Fatura kalemleri

/**
 * Kalemin sınıfı. komisyon: asıl hizmet bedeli; erken: erken ödeme / valör; yasak: yemek kartında komisyon dışı ücret
 * (yönetmelik kira, sarf malzemesi, teknik destek, bakım, depozito gibi adlarla ücreti yasaklar); asli: platformda
 * sipariş ve ödeme altyapısı ücreti (1 Nisan 2026'dan beri ayrıca alınamaz); reklam: platformda reklam / kampanya
 * (isteğe bağlı); diger: hiçbiri.
 */
export type LineClass = "komisyon" | "erken" | "yasak" | "asli" | "reklam" | "diger";

/** Ekrandaki sıra: oranın parçaları ("Komisyon %3,0 · erken ödeme %3,2") bu sırayla yazılır */
export const LINE_CLASSES: readonly LineClass[] = ["komisyon", "erken", "yasak", "asli", "reklam", "diger"];

export const LINE_LABEL: Record<LineClass, string> = {
  komisyon: "Komisyon",
  erken: "Erken ödeme",
  yasak: "Komisyon dışı ücret",
  asli: "Sipariş / ödeme altyapısı ücreti",
  reklam: "Reklam / kampanya",
  diger: "Diğer ücret",
};

const words = (list: string) => new RegExp(`\\b(?:${list})`);

// Sadeleştirilmiş metinde (fold) aranır: Türkçe harfler ASCII'ye iner ("ödeme" → "odeme")
const EARLY = [words("(?:erken|hizli|aninda|ayni gun) (?:odeme|hakedis|tahsilat)"), words("vade farki"), words("valor")];
/** Her zaman komisyon dışı (yönetmeliğin saydığı adlar ve yakınları); "kira" ama "kiraz" değil */
const BANNED_STRONG = words(
  "kira(?!z)\\w*|kiralama|cihaz\\w*|terminal\\w*|destek\\w*|bakim\\w*|depozito\\w*|teminat\\w*|barindirma|aidat\\w*|uyelik\\w*|abonelik\\w*|lisans\\w*|kurulum\\w*|sarf\\w*|isletim\\w*",
);
/** Metinde "komisyon" yoksa komisyon dışı: "POS İşlemleri Komisyonu" komisyondur, "POS kullanım bedeli" değil */
const BANNED_WEAK = words("pos\\b|yazilim\\w*|entegrasyon\\w*|islem basi|islem ucret\\w*|kart bedel\\w*|rulo");
const CORE = words("odeme altyapi\\w*|odeme islem\\w*|online odeme|sanal pos|siparis (?:iletim\\w*|alma)|islem ucret\\w*|platform kullanim\\w*");
const ADS = words("reklam\\w*|kampanya\\w*|one cikar\\w*|sponsor\\w*|banner|vitrin\\w*|promosyon\\w*|joker|kupon\\w*|indirim katilim\\w*");
const COMMISSION = words("komisyon\\w*|hizmet bedel\\w*|aracilik\\w*");

/**
 * Kalemin sınıfı (ad + açıklama). Sıra önemli, ilk eşleşen kazanır: erken ödeme, (yemek kartında) komisyon dışı ücret
 * ve reklam, (platformda) sipariş / ödeme altyapısı ve reklam, komisyon, diğer. Sözcüklere bakar: ekranda kalemin
 * kendi adı yanında durur, uyarılar "olabilir" der.
 */
export function classifyLine(text: string, kind: ChannelKind): LineClass {
  const t = fold(text);
  if (EARLY.some((re) => re.test(t))) return "erken";
  if (kind === "meal") {
    if (BANNED_STRONG.test(t) || ADS.test(t)) return "yasak";
    if (BANNED_WEAK.test(t) && !/\bkomisyon/.test(t)) return "yasak";
  } else {
    if (CORE.test(t)) return "asli";
    if (ADS.test(t)) return "reklam";
  }
  if (COMMISSION.test(t)) return "komisyon";
  return "diger";
}
