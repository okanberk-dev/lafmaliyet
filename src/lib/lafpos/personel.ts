import { shiftMonth } from "@/lib/reminders";

import { checkModposDaysRequest, type ModposDaysCheck } from "./modpos-gunler";
import { isLafposBranch, isLafposDay, LAFPOS_BRANCH_ID } from "./switch";

/*
 * LafPOS personel bağlantısının lafmaliyet tarafı (LM-4b, 24 Kasım 2026; CONTRACT §3, sahibin kararı 2: "ladmin'de
 * hesapları var; doğru hesabı bağladığından emin ol"; docs/LAFPOS.md › Personel bağlantısı). Saf kurallar: imzalı liste
 * ucu (src/server/lafpos/personel.ts), gün sonunun 200 yanıtı (src/server/lafpos/status.ts handlePosDay) ve yemek kartının
 * günü (src/lib/calc/engine.ts) aynı işlevleri çağırır. Testleri tests/personel-lafpos.test.ts ve
 * tests/personel-lafpos-db.test.ts.
 *
 * - LafPOS kullanıcısı maaş satırına (`staff.id`, kimliği `s:<id>`) yalnız LafPOS'ta elle ve onayla bağlanır; lafmaliyet
 *   her gelen kimliği kendi satırına göre doğrular (bilinmeyen ya da başka şubenin kimliği sayılmaz).
 * - KVKK: gün sonu gövdesine ad gitmez, yalnız personel kimliği; ad yalnız lafmaliyet → LafPOS yönünde, seçicinin listesinde.
 */

/** lafmaliyet personel kimliği: maaş satırının numarası (`s:<staff.id>`; LafPOS server/sync/lafmaliyet-personel.ts aynısı) */
export const STAFF_REF = /^s:[1-9]\d{0,8}$/;
/** Bir gövdede ya da yanıt listesinde en çok bu kadar kimlik (LafPOS'un yanıt okuyucusu da 500'de keser) */
export const STAFF_REFS_MAX = 500;

export const staffRefOf = (id: number) => `s:${id}`;

/**
 * Satır o ayda maaş hesabında mı (src/lib/calc/engine.ts inRange'in aynısı; motor bu dosyayı çağırdığından buraya
 * alınmadı): boş başlangıç / bitiş sınırsızdır
 */
const inRange = (r: { startMonth: string | null; endMonth: string | null }, month: string) => (!r.startMonth || r.startMonth <= month) && (!r.endMonth || r.endMonth >= month);
/** Kimliğin satır numarası (bozuksa null) */
export function staffIdOfRef(ref: string): number | null {
  return STAFF_REF.test(ref) ? Number(ref.slice(2)) : null;
}

/** Kimlikler tekil, sayı sırasıyla (LafPOS'un gönderdiği sıra; karşılaştırma ve saklama bunu bekler) */
export function sortStaffRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}

// ---------------------------------------------------------------- GET /api/panel/pos/personel

/** Listenin okuduğu maaş satırı sütunları (maaş, ek, yemek kartı, e-posta okunmaz) */
export interface PosStaffRow {
  id: number;
  name: string;
  branchId: string;
  startMonth: string | null;
  endMonth: string | null;
  /** Bağlı panel hesabı (staff.user_id; LM-4) */
  userId: number | null;
  /** Hesabı olmayan Vardiya kişisi ("n:<ad>") */
  personRef: string | null;
}

export interface PosStaffItem {
  ref: string;
  name: string;
  /** Bu ay maaş hesabında (aralıkta) mı; geçen ay biten satır `false` (LafPOS ona bağlamaz) */
  active: boolean;
  /** Satıra bağlı lafmaliyet giriş hesabının görünen adı (users.name); bağlı değilse null */
  account: string | null;
}

/** LafPOS'un listeyi okurken kabul ettiği en uzun ad */
const NAME_MAX = 120;
const nameOf = (v: string) => v.trim().slice(0, NAME_MAX);

/**
 * Şubenin LafPOS'a verilen personel listesi: şubenin bu ay ya da geçen ay aralıkta olan maaş satırları. Biten satır ile
 * "Devam ettir"in açtığı yeni satır aynı hesaba (ya da aynı Vardiya adına) bağlı olabilir (aralıkları ayrık;
 * src/lib/staff-link.ts): o kişi için tek öğe verilir, bu ayın satırı, yoksa en yeni satır (docs/VARDIYA.md › LM-4b notu).
 * Bağlantısız satırlar ayrı öğedir (ad kimliği söylemez). Ada göre sıralı (Türkçe), sonra numara.
 */
export function posStaffItems(input: { rows: readonly PosStaffRow[]; accounts: ReadonlyMap<number, string>; sube: string; month: string }): PosStaffItem[] {
  const prev = shiftMonth(input.month, -1);
  const inList = input.rows.filter((r) => r.branchId === input.sube && (inRange(r, input.month) || inRange(r, prev)));
  const keyOf = (r: PosStaffRow) => (r.userId !== null ? `u:${r.userId}` : (r.personRef ?? `id:${r.id}`));
  /** Aynı kişide hangisi kalır: bu ayın satırı, sonra en yeni başlangıç, sonra en büyük numara */
  const better = (a: PosStaffRow, b: PosStaffRow) => {
    const aNow = inRange(a, input.month);
    if (aNow !== inRange(b, input.month)) return aNow;
    const as = a.startMonth ?? "";
    const bs = b.startMonth ?? "";
    return as !== bs ? as > bs : a.id > b.id;
  };
  const chosen = new Map<string, PosStaffRow>();
  for (const r of inList) {
    const k = keyOf(r);
    const had = chosen.get(k);
    if (!had || better(r, had)) chosen.set(k, r);
  }
  return [...chosen.values()]
    .map((r) => {
      const account = r.userId !== null ? nameOf(input.accounts.get(r.userId) ?? "") : "";
      return { ref: staffRefOf(r.id), name: nameOf(r.name) || `Personel ${r.id}`, active: inRange(r, input.month), account: account || null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr") || Number(a.ref.slice(2)) - Number(b.ref.slice(2)));
}

/**
 * İsteğin denetimi (ModPOS dönemi ucuyla aynı kural ve sıra: src/lib/lafpos/modpos-gunler.ts): anahtar (503), imza (401;
 * sorgu imzanın içinde), şube yoksa 400 `{ error: "invalid", field: "sube" }`, LAFPOS_BRANCH_ID değilse 409
 * `{ error: "wrong_branch", sube, expected }`
 */
export function checkPosStaffRequest(input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: number }): ModposDaysCheck {
  return checkModposDaysRequest(input);
}

// ---------------------------------------------------------------- gün sonu: workedStaffRefs

/** Gün sonunun 200 yanıtındaki karşılık (LafPOS Entegrasyon'da bilinmeyen ve başka şubenin kimliklerini adıyla gösterir) */
export interface WorkedStaffAnswer {
  /** Sayılan: LafPOS'un şubesinde, günün ayında aralıktaki maaş satırı */
  counted: string[];
  /** lafmaliyet'te yok (silinmiş) ya da günün ayında maaş hesabında değil (biten / başlamamış satır; yeniden bağlanmalı) */
  unknown: string[];
  /** Başka şubenin maaş satırı (LafPOS'un şubesinin günü onun hesabına girmez) */
  otherBranch: string[];
}

/**
 * Gövdedeki kimliklerin sınıfı. Satırın şubesi LAFPOS_BRANCH_ID ve aralığı günün ayını tutuyorsa sayılan; satır başka
 * şubedeyse otherBranch; yoksa ya da aralık dışındaysa unknown. Sıra gövdeninki (tekil, sayı sırasıyla)
 */
export function classifyWorkedStaff(
  refs: readonly string[],
  rows: ReadonlyMap<number, { branchId: string; startMonth: string | null; endMonth: string | null }>,
  date: string,
): WorkedStaffAnswer {
  const out: WorkedStaffAnswer = { counted: [], unknown: [], otherBranch: [] };
  const month = date.slice(0, 7);
  for (const ref of sortStaffRefs(refs).slice(0, STAFF_REFS_MAX)) {
    const id = staffIdOfRef(ref);
    const r = id === null ? undefined : rows.get(id);
    if (!r) out.unknown.push(ref);
    else if (r.branchId !== LAFPOS_BRANCH_ID) out.otherBranch.push(ref);
    else if (inRange(r, month)) out.counted.push(ref);
    else out.unknown.push(ref);
  }
  return out;
}

// ---------------------------------------------------------------- yemek kartının günü

/**
 * LafPOS'un şubesinin sayılan günleri (geçiş gününden itibaren gelen gün sonları) ve her günün çalışan kimlikleri
 * (pos_day_reports.worked_staff; gövde alanı taşımadıysa null). Veri kümesi okur (src/server/data/dataset.ts)
 */
export interface LafposWorked {
  switchDay: string;
  days: { date: string; refs: string[] | null }[];
}

/**
 * Kişinin ayda LafPOS'ta çalıştığı gün (yemek kartının günü; Maaşlar gösterir). Yalnız şu hâlde bilinir, yoksa null
 * (yemek kartı Ayarlar'daki günle: 26):
 * - kişi LafPOS'un şubesinde (öteki şubeler ModPOS'ta: hep varsayılan),
 * - ayın tamamı LafPOS dönemi (ayın 1'i geçiş gününden önce değil: geçiş ayının ModPOS günlerinde kimin çalıştığı
 *   bilinmez; Kasım 2026'da Marina 13–21 ModPOS, §6'nın 330 × 26'sı kalır),
 * - ayın en az bir sayılan LafPOS günü var ve HER biri çalışan listesini taşıyor (bir gün eksikse ay eksik sayılır).
 * Gün = ayın gün sonlarından kişinin kimliğinin (`s:<id>`) geçtiği gün. Süren ayda bugüne kadar gelen günler.
 */
export function lafposWorkedDays(worked: LafposWorked | null | undefined, staff: { id: number; branchId?: string | null }, month: string): number | null {
  if (!worked || !isLafposBranch(staff.branchId)) return null;
  if (!isLafposDay(`${month}-01`, worked.switchDay)) return null;
  const days = worked.days.filter((d) => d.date.slice(0, 7) === month && isLafposDay(d.date, worked.switchDay));
  if (!days.length || days.some((d) => d.refs === null)) return null;
  const ref = staffRefOf(staff.id);
  return days.filter((d) => d.refs!.includes(ref)).length;
}
