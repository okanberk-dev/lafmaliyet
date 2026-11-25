import { posMatchKey } from "@/lib/calc/pos-paste";
import { money } from "@/lib/format";
import { dayAblativeTR } from "@/lib/reminders";

import type { PosDayZ, PosIkram, PosIptal } from "./day";
import { isLafposBranch, isLafposDay } from "./switch";

/**
 * LafPOS'un ikramları (denetim E-38; docs/LAFPOS.md › İkram, docs/ZAYI-IKRAM.md). Saf: veri kümesi, Zayi & ikram,
 * zayi eylemleri ve kasa e-postası aynı kuralı okur (tests/lafpos-ikram.test.ts).
 *
 * Kural (her gün tek kaynak): geçiş gününden itibaren ürün ikramı kasada, LafPOS'ta işaretlenir. LafPOS'un gün sonu
 * gelen günde o günün ikram satırları (ikram[]) Tutarlılık'ın kayıtlı tüketimine ve Zayi'nin özetine girer; panelde
 * o güne girilmiş ürün ikramı sayılmaz (listede "sayılmıyor" der, silinmez). Hammadde ikramı (ör. personele süt) ve
 * zayi panelde kalır. Geçiş günü boşken hiçbiri çalışmaz: LafPOS'un ikramı hiçbir hesaba ve ekrana girmez.
 *
 * LafPOS'un listesinde zayi de var: kasada "Zayi yaz" denen kalem aynı listede, nedeni "Zayi: " ile başlar (LafPOS
 * shared/comp.ts compReasonText, docs/03-ENTEGRASYON.md §4). O satır zayi sayılır, ikram değil; "Ödenmez: " (personel
 * yemeği, patron hesabı) ikramdır. Paneldeki zayi her zaman sayılır: aynı gün aynı ürün LafPOS'ta da zayi yazıldıysa
 * gün listesinde "LafPOS'ta da zayi" uyarısı çıkar (sahibin sorusu: ürün zayisi de yalnız LafPOS'tan mı gelsin).
 */

/** LafPOS'un bir ikram satırı (pos_day_reports.ikram), panel ürünüyle çözülmüş */
export interface LafposIkramLine {
  date: string;
  /** Nedeni "Zayi: " ile başlayan satır zayidir (lafposLineKind); öteki her satır (ödenmez dahil) ikram */
  kind: "zayi" | "ikram";
  /** LafPOS'taki ad (POS adı) */
  posName: string;
  /** Panel ürünü (sitenin kalemi ve boyu, sonra POS adı eşleştirmesi); bulunamazsa null: tüketime girmez */
  productId: number | null;
  /** POS adı HİZMET'e bağlı (karaoke odası gibi): ürünü yoktur, tüketime girmez ve "bağlanamayan" sayılmaz */
  isService?: boolean;
  qty: number;
  /** Menü fiyatıyla değeri, KDV dahil (LafPOS'un hesabı) */
  menuValue: number;
  /** LafPOS'ta yazılan neden (serbest metin; yalnız yöneticiye); zayide "Zayi: " ön eki atılmış */
  reason: string | null;
  /** Faz 2: LafPOS'taki türü (ödenmez ayrı; tüketimde ikram sayılır); eski LafPOS'ta nedenin ön ekinden (lafposCompKind) */
  compKind?: "ikram" | "odenmez" | "zayi";
  /** Faz 2: ödenmezin kişi türü (personel, müşteri, patron; kişinin kendisi gelmez); yoksa null */
  personKind?: "personel" | "musteri" | "patron" | null;
  /**
   * Hazırlanmış iptalden gelen zayi satırı (Faz 2; iptalWasteLines): ödenmez tutarına (Z'nin offRevenue'su) girmez, ikram
   * listesinin denetimine katılmaz, tüketime zayi olarak girer
   */
  iptal?: boolean;
  /** İptal satırında LafPOS'ta yazılan iptal nedeni (yalnız yöneticiye) */
  detail?: string | null;
}

/**
 * LafPOS satırının tüketimdeki türü: zayi ya da ikram (ödenmez dahil). Faz 2'den (23 Kasım 2026) LafPOS türü kendisi
 * gönderir (`kind`) ve o önce gelir; göndermeyen eski LafPOS'ta nedenin ön ekinden: "Zayi: Döküldü" → zayi, neden
 * "Döküldü"; "Ödenmez: Personel yemeği" ve öteki her neden ikram (neden olduğu gibi). Ön ek LafPOS'un compReasonText'i;
 * zayinin nedeninde ön ek (varsa) atılır.
 */
export function lafposLineKind(reason: string | null, kind?: PosIkram["kind"]): { kind: "zayi" | "ikram"; reason: string | null } {
  const m = reason?.match(/^zayi\s*:\s*/i);
  const zayi = kind ? kind === "zayi" : !!m;
  if (!zayi) return { kind: "ikram", reason };
  return { kind: "zayi", reason: m && reason ? reason.slice(m[0].length).trim() || null : reason };
}

/** LafPOS'taki türü (ikram, ödenmez, zayi): gönderildiyse `kind`, yoksa nedenin ön eki ("Ödenmez: ", "Zayi: ") */
export function lafposCompKind(reason: string | null, kind?: PosIkram["kind"]): "ikram" | "odenmez" | "zayi" {
  if (kind) return kind;
  if (reason && /^ödenmez\s*:/i.test(reason.toLocaleLowerCase("tr-TR"))) return "odenmez";
  return lafposLineKind(reason).kind === "zayi" ? "zayi" : "ikram";
}

/** Hazırlanmış iptalin zayi satırındaki nedeni (Zayi & ikram, kasa özeti) */
export const IPTAL_ZAYI_REASON = "İptal (hazırlanmıştı)";

/**
 * Günün iptal edilen kalemlerinden zayi satırları (Faz 2; docs/LAFPOS.md › İptaller): yalnız hazırlanmış olanlar
 * (`prepared`: bar ya da mutfak başlamıştı ya da hazırdı; kural LafPOS'un, sahibin 22.11 kararı): malzemesi harcandı,
 * satılmadı. Hazırlanmamış iptal tüketim değildir, yalnız bilgi olarak gösterilir. Kalem iadesi de (`refund`) hazırlanmışsa
 * zayidir. Ürün satırla aynı sırayla bulunur (`resolve`: sitenin kalemi ve boyu, sonra POS adı eşleştirmesi). `waste_entries`'e
 * yazılmaz: gün her gönderimde yeniden okunur, yeniden gönderim çift saymaz.
 */
export function iptalWasteLines(
  date: string,
  iptal: readonly PosIptal[],
  resolve: (l: PosIptal) => { productId: number | null; isService: boolean },
): LafposIkramLine[] {
  return iptal
    .filter((l) => l.prepared)
    .map((l) => {
      const m = resolve(l);
      return { date, kind: "zayi", compKind: "zayi", iptal: true, posName: l.posName, productId: m.productId, isService: m.isService, qty: l.qty, menuValue: l.listValue, reason: IPTAL_ZAYI_REASON, detail: l.reason };
    });
}

const PERSON_KIND_TEXT = { personel: "personel", musteri: "müşteri", patron: "patron" } as const;

/**
 * Satırın yöneticiye gösterilen nedeni (Zayi & ikram): iptalde "İptal (hazırlanmıştı): Yanlış ürün", ödenmezde kişinin türü
 * parantezde ("Ödenmez: Deneme (patron)"; kişinin kendisi gelmez), öteki satırda LafPOS'taki neden
 */
export function lafposReasonText(l: Pick<LafposIkramLine, "reason" | "iptal" | "detail" | "personKind">): string | null {
  if (l.iptal) return l.detail ? `${l.reason}: ${l.detail}` : l.reason;
  const person = l.personKind ? PERSON_KIND_TEXT[l.personKind] : null;
  if (!person) return l.reason;
  return l.reason ? `${l.reason} (${person})` : `(${person})`;
}

/**
 * Günün Z'deki ödenmez tutarıyla (offRevenue) karşılaştırılan kayıtlı değer (Onaylar'ın geç ikram kartı): LafPOS'un
 * satırı kendi menü değeriyle (ikram, ödenmez ve zayi listesi: ödenmez tutarı onu kapsar), panelin ürün ikramı menü
 * fiyatıyla. Hazırlanmış iptalin zayisi (Faz 2, `iptal`) tüketimdir ama ödenmez tutarında yoktur: sayılmaz
 */
export function recordedOffRevenue(
  entries: readonly { kind: "zayi" | "ikram"; productId: number | null; qty: number; source?: "lafpos"; menuValue?: number; iptal?: boolean }[],
  priceOf: (productId: number) => number | null,
): number {
  let total = 0;
  for (const w of entries) {
    if (w.source === "lafpos") total += w.iptal ? 0 : (w.menuValue ?? 0);
    else if (w.kind === "ikram" && w.productId !== null) total += (priceOf(w.productId) ?? 0) * w.qty;
  }
  return total;
}

/** İkram listesinin (iptal satırları hariç) türe göre menü değeri: Z'nin türe göre toplamlarıyla karşılaştırılır */
export function lafposListByKind(lines: readonly (Pick<PosIkram, "menuValue" | "reason" | "kind"> & { iptal?: boolean; compKind?: PosIkram["kind"] })[]): { ikram: number; odenmez: number; zayi: number } {
  const out = { ikram: 0, odenmez: 0, zayi: 0 };
  for (const l of lines) {
    if (l.iptal) continue;
    out[l.compKind ?? lafposCompKind(l.reason, l.kind)] += l.menuValue;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { ikram: r2(out.ikram), odenmez: r2(out.odenmez), zayi: r2(out.zayi) };
}

/**
 * Veri kümesinin LafPOS ikramı (Dataset.lafposIkram): geçiş günü, gün sonu gelen günler (geçiş gününden itibaren; o
 * günlerde paneldeki ürün ikramı sayılmaz) ve ikram satırları. Geçiş günü yoksa veri kümesinde hiç yoktur.
 */
export interface LafposIkramData {
  switchDay: string;
  days: string[];
  lines: LafposIkramLine[];
}

/**
 * Paneldeki kayıt hesaba girer mi: LafPOS'un gün sonu gelen günde (geçiş gününden itibaren) ürün ikramı girmez,
 * LafPOS'taki sayılır. Zayi ve hammadde ikramı her zaman girer. `lafposDays` LafPOS'un şubesinin gün sonu gelen
 * günleridir: kayıt yalnız o şubenin kasasınınsa düşer, ModPOS'ta kalan şubenin aynı günkü ürün ikramı sayılır
 * (denetim 21 Kasım #5). Şubesi verilmeyen kayıt Tuzla'nındır. `lafposBranch`: LafPOS'un şubesi (Dataset.lafposBranch;
 * verilmezse geri düşüş değeri)
 */
export function panelWasteCounts(
  w: { date: string; kind: "zayi" | "ikram"; productId: number | null; branchId?: string | null },
  lafposDays: ReadonlySet<string>,
  lafposBranch?: string,
): boolean {
  return !(w.kind === "ikram" && w.productId !== null && isLafposBranch(w.branchId, lafposBranch) && lafposDays.has(w.date));
}

/** Zayi & ikram'ın metinleri (ekran, eylemlerin reddi, kasa e-postası) */
export const LAFPOS_IKRAM_TEXT = {
  /** Paneldeki ürün ikramının rozeti, LafPOS'un gün sonu geldiyse */
  notCounted: "Sayılmıyor: LafPOS'taki ikram sayılıyor",
  /** LafPOS'un ikram listesinin başlığı (listede zayi satırları da var) */
  listTitle: "LafPOS'ta işaretlenen ikram ve zayi",
  /** Bu gün LafPOS'ta ikram ya da zayi yok */
  none: "LafPOS'ta bu gün ikram ya da zayi işaretlenmedi.",
  /** LafPOS günü (bugün), gün sonu henüz gelmedi */
  waiting: "LafPOS'un bu günün sonu gelmedi; ikram ve zayi gün sonuyla gelir.",
  /** Ürünü bulunamayan satır (yönetici; Ayarlar › LafPOS'ta bağlanır) */
  unmatched: "ürüne bağlı değil: tüketime girmez",
  /** HİZMET'e bağlı satır (karaoke odası gibi): tüketime girmez, bağlanacak bir şey yok */
  service: "hizmet: tüketime girmez",
  /** Paneldeki ürün zayisinin rozeti: aynı gün aynı ürün LafPOS'ta da zayi yazıldı (ikisi de sayılır) */
  maybeTwice: "LafPOS'ta da zayi yazıldı: aynı zayiyse bu kayıt silinmeli",
  /** LafPOS gününde Zayi formunun notu (ürün zayisi iki yerden girilmesin) */
  zayiNote: "Kasada LafPOS'ta “Zayi yaz” ile işaretlenen ürün gün sonuyla buraya gelir; panele ayrıca girmeyin.",
  /** Gün sonu gelmeyen geçmiş LafPOS günü: ürün ikramı panelden girilebilir */
  waitingPast: "LafPOS'un bu günün sonu gelmedi. Ürün ikramı bu güne panelden girilebilir; gün sonu sonradan gelirse LafPOS'taki sayılır.",
} as const;

/** "Ürün ikramı 10 Kasım'dan beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir." */
export function productIkramNote(switchDay: string): string {
  return `Ürün ikramı ${dayAblativeTR(switchDay)} beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir.`;
}

/**
 * Ürün ikramı bu güne panelden kapalı mı (yazma kuralı, okuma kuralıyla aynı: panelWasteCounts). LafPOS gününde gün
 * sonu geldiyse ya da gün bugünse (gün sonu bekleniyor) kapalı: LafPOS'ta işaretlenir. Gün sonu gelmeyen geçmiş LafPOS
 * gününde (kasa bilgisayarı bozuldu, gün hiç gönderilmedi) açık: o gün panelin ürün ikramı sayılır, gün sonu sonradan
 * gelirse LafPOS'unki. Geçiş günü boşken ya da gün ondan önceyse açık (bugünkü gibi).
 */
export function productIkramClosed(date: string, switchDay: string | null, day: { received: boolean; today: string }): boolean {
  return isLafposDay(date, switchDay) && (day.received || date >= day.today);
}

/**
 * Yeni kaydın reddi (zayi eylemleri, geç kayıt isteği ve onayı): ürün ikramı o güne panelden kapalıysa
 * (productIkramClosed) metin, değilse null. `where`: Zayi & ikram'da "Burada …", onayda kaydın nereye girildiği.
 */
export function productIkramRefusal(
  w: { date: string; kind: "zayi" | "ikram"; productId: number | null },
  switchDay: string | null,
  day: { received: boolean; today: string },
  where: "zayi" | "onay" = "zayi",
): string | null {
  if (w.kind !== "ikram" || w.productId === null || !productIkramClosed(w.date, switchDay, day)) return null;
  const rest = where === "zayi" ? "Burada hammadde ikramı ve zayi girilir." : "Hammadde ikramı ve zayi Zayi & ikram'da girilir.";
  return `Ürün ikramı ${dayAblativeTR(switchDay!)} beri LafPOS'ta işaretlenir, panele girilmez. ${rest}`;
}

/**
 * LafPOS'un Z'sindeki türe göre toplamlar (Faz 2; hesap sözleşmesi §5): ikram, ödenmez, zayi ve `listValue`
 * gönderildiyse satışın kendi eşitliğinin girdileri (`sale`: liste, indirim, toplam satış). Türe göre toplamları
 * göndermeyen eski LafPOS'ta null (lafposIkramCheck eski kuralla)
 */
export interface LafposZKinds {
  ikram: number;
  odenmez: number;
  zayi: number;
  sale?: { listValue: number; discounts: number; zTotal: number };
}

/** Saklı Z özetinden türe göre toplamlar (kasa e-postasının okuyucusu: src/server/data/lafpos-ikram.ts) */
export function lafposZKinds(z: Pick<PosDayZ, "ikramTotal" | "odenmezTotal" | "zayiTotal" | "listValue" | "discounts" | "zTotal">): LafposZKinds | null {
  if (z.ikramTotal === undefined || z.odenmezTotal === undefined || z.zayiTotal === undefined) return null;
  const kinds: LafposZKinds = { ikram: z.ikramTotal, odenmez: z.odenmezTotal, zayi: z.zayiTotal };
  if (z.listValue !== undefined) kinds.sale = { listValue: z.listValue, discounts: z.discounts ?? 0, zTotal: z.zTotal };
  return kinds;
}

/**
 * Kasa e-postasının ikram denetimi LafPOS gününde (yalnız yönetici): LafPOS'un Z'sindeki ödenmez tutarı ile aynı
 * günün ikram listesinin (ikram, ödenmez ve zayi satırları; LafPOS'ta ödenmez tutarı üçünü de kapsar) menü değeri.
 * LafPOS ikisini aynı adisyonlardan hesaplar; fark varsa bilgi satırı, yoksa null. Z büyükse listeye girmeyen ödenmez
 * satır, küçükse listede kalmış iptal edilen adisyonun ikramı (eski LafPOS onu da yazıyordu) açıklar. Faz 2'de Z'nin
 * kendi eşitliği de (toplam satış = liste − indirim − ikram − ödenmez; `byKind.z.sale`) denetlenir.
 */
export function lafposIkramCheck(
  offRevenue: number,
  listValue: number,
  byKind?: { z: LafposZKinds | null; list: { ikram: number; odenmez: number; zayi: number } } | null,
): string | null {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Faz 2: LafPOS'un Z'si türe göre toplamları da yollar (hesap sözleşmesi §5): tür tür karşılaştırılır, LafPOS'un kendi
  // toplamları ödenmez tutarını tutmuyorsa o da söylenir. Yollamayan eski LafPOS'ta tek karşılaştırma (aşağıda)
  if (byKind?.z) {
    const z = byKind.z;
    const out: string[] = [];
    // Z'nin kendi eşitliği (sözleşme §5): bir satır listeden ya da satıştan düştüyse burada görünür
    if (z.sale) {
      const { listValue: list, discounts, zTotal } = z.sale;
      const expected = r2(list - discounts - z.ikram - z.odenmez);
      const gap = r2(zTotal - expected);
      if (Math.abs(gap) >= 1) {
        out.push(
          `LafPOS'un Z'si kendi içinde tutmuyor: liste ${money(list)} − indirim ${money(discounts)} − ikram ${money(z.ikram)} − ödenmez ${money(z.odenmez)} = ${money(expected)}, toplam satış ${money(zTotal)} (${money(Math.abs(gap))} ${gap > 0 ? "fazla" : "az"}).`,
        );
      }
    }
    const own = r2(offRevenue - (z.ikram + z.odenmez + z.zayi));
    if (Math.abs(own) >= 1) out.push(`LafPOS'un ödenmez tutarı (Z) türlerin toplamından (${money(r2(z.ikram + z.odenmez + z.zayi))}) ${money(Math.abs(own))} ${own > 0 ? "fazla" : "az"}.`);
    const NAMES = { ikram: ["ikram", "ikramdan"], odenmez: ["ödenmez", "ödenmezden"], zayi: ["zayi", "zayiden"] } as const;
    for (const k of ["ikram", "odenmez", "zayi"] as const) {
      const diff = r2(z[k] - byKind.list[k]);
      if (Math.abs(diff) < 1) continue;
      const head = `LafPOS'un ${NAMES[k][0]} toplamı (Z) ikram listesindeki ${NAMES[k][1]} ${money(Math.abs(diff))}`;
      out.push(
        diff > 0
          ? `${head} fazla: LafPOS'ta ${NAMES[k][0]} işaretlenen ama listeye girmeyen satır olabilir.`
          : `${head} az: iptal edilen adisyonun satırı listede kalmış olabilir.`,
      );
    }
    return out.length ? out.join(" ") : null;
  }
  const diff = r2(offRevenue - listValue);
  if (Math.abs(diff) < 1) return null;
  const head = `LafPOS'un ödenmez tutarı (Z) ikram ve zayi listesinden ${money(Math.abs(diff))}`;
  return diff > 0
    ? `${head} fazla: LafPOS'ta ödenmez işaretlenen ama listeye girmeyen satır olabilir.`
    : `${head} az: iptal edilen adisyonun ikramı listede kalmış olabilir.`;
}

/**
 * İkramın ürüne bağlanamayan adları, satış listesinde gösterilenler ve HİZMET'e bağlı adlar hariç (en çok adet önce,
 * sonra ad)
 */
export function unmatchedIkramNames(
  lines: readonly { date: string; posName: string; productId: number | null; isService?: boolean; qty: number }[],
  shown: readonly string[],
  limit = 10,
): { items: { posName: string; qty: number; days: number }[]; count: number } {
  const skip = new Set(shown.map(posMatchKey));
  const byKey = new Map<string, { posName: string; qty: number; days: Set<string> }>();
  for (const l of lines) {
    const key = posMatchKey(l.posName);
    if (l.productId !== null || l.isService || skip.has(key)) continue;
    const cur = byKey.get(key) ?? { posName: l.posName.replace(/\s+/g, " ").trim(), qty: 0, days: new Set<string>() };
    cur.qty += l.qty;
    cur.days.add(l.date);
    byKey.set(key, cur);
  }
  const all = [...byKey.values()].map((x) => ({ posName: x.posName, qty: x.qty, days: x.days.size })).sort((a, b) => b.qty - a.qty || a.posName.localeCompare(b.posName, "tr"));
  return { items: all.slice(0, limit), count: all.length };
}
