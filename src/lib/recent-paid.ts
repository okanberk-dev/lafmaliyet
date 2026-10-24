// Son ödenenler: "Ödendi" işaretlenen fatura ve hatırlatıcılar ve tedarikçiye girilen cari ödemeler 30 gün boyunca
// Ödemeler sayfasından geri alınabilir (bildirimdeki 8 saniyelik "Geri al" kaçırılınca da). Liste integration_state'te
// durur, yeni tablo yok; bu dosya listenin saf kurallarıdır (tests/recent-paid.test.ts).

import type { CariMethod } from "./cari/balance";

export const RECENT_PAID_DAYS = 30;
export const RECENT_PAID_MAX = 30;

/** Hatırlatıcının "Ödendi"den önceki hâli (restoreReminder ile aynı alanlar) */
export interface ReminderSnapshot {
  dueDate: string;
  anchorDate: string;
  active: boolean;
  lastDoneAt: string | null;
  /** Tutar (Ödendi'de silinen KDV tutarı geri alınınca geri yazılır); eski kayıtlarda yok */
  amount?: number | null;
  /** Not (ertelemenin yazdığı "Ertelendi · asıl tarih" geri alınınca döner); eski kayıtlarda yok */
  note?: string | null;
}

export interface RecentPaid {
  /** Fatura, hatırlatıcı ya da cari ödeme kaydı (kimlik ödemenin kimliği; geri alınınca ödeme silinir) */
  kind: "invoice" | "reminder" | "cari";
  id: number;
  title: string;
  amount: number | null;
  /** Ödenen dönem (hatırlatıcı) ya da faturanın vadesi / tarihi */
  dueDate: string | null;
  /** İşaretlendiği an (ISO) */
  at: string;
  /** Hatırlatıcı: ödenmeden önceki hâli */
  prev?: ReminderSnapshot;
  /** Hatırlatıcı: ödendikten sonraki sıradaki tarih (tek seferlikte null, hatırlatıcı kapanır) */
  next?: string | null;
  /** Fatura: ödenmeden önceki ödeme talebi günü (geri alınca "talep edildi" geri gelir) */
  requestedAt?: string | null;
  /** Fatura: ✓'nin hesaptaki cari ödemesinden yazdığı dağıtımlar (geri alınca önce bunlar silinir) */
  allocationIds?: number[];
  /** Cari ödeme: şekli ve sayıldığı kalem sayısı ("Hesaba ödeme · Sütaş · 10.000,00 ₺ · Havale / EFT · 2 kalem") */
  method?: CariMethod;
  items?: number;
  /** Cari ödeme: kaydedildiği andaki son düzenlenme anı (ISO; veritabanının saati). Değiştiyse geri alınmaz */
  stamp?: string;
}

/** Hatırlatıcının şimdiki hâli (geri alınabilir mi diye bakılan alanlar) */
export interface ReminderState {
  id: number;
  dueDate: string;
  anchorDate: string;
  active: boolean;
}

export const recentPaidKey = (e: Pick<RecentPaid, "kind" | "id">) => `${e.kind}:${e.id}`;

const time = (e: RecentPaid) => new Date(e.at).getTime();

/** integration_state'ten okunan değer: biçimi bozuk satırlar atılır (elle yazılmış ya da eski sürümden kalma) */
export function parseRecentPaid(v: unknown): RecentPaid[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e): e is RecentPaid =>
      typeof e === "object" &&
      e !== null &&
      (e.kind === "invoice" || e.kind === "reminder" || e.kind === "cari") &&
      Number.isInteger(e.id) &&
      typeof e.title === "string" &&
      typeof e.at === "string",
  );
}

/** 30 günden eskiler ve en yeni 30'dan fazlası atılır; liste en yeni önce sıralanır (eşzamanlı yazımda sıra kayabilir) */
export function pruneRecentPaid(list: RecentPaid[], now: string): RecentPaid[] {
  const cutoff = new Date(now).getTime() - RECENT_PAID_DAYS * 86_400_000;
  return list
    .filter((e) => time(e) >= cutoff)
    .sort((a, b) => time(b) - time(a))
    .slice(0, RECENT_PAID_MAX);
}

/** Yeni kayıtlar başa eklenir; aynı kalemin eski kaydı (ve yeni kayıtlar içindeki tekrarı) düşer */
export function addRecentPaid(list: RecentPaid[], added: RecentPaid[], now: string): RecentPaid[] {
  const seen = new Set<string>();
  const out: RecentPaid[] = [];
  for (const e of [...added, ...list]) {
    const k = recentPaidKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return pruneRecentPaid(out, now);
}

export function removeRecentPaid(list: RecentPaid[], kind: RecentPaid["kind"], ids: number[]): RecentPaid[] {
  const drop = new Set(ids.map((id) => recentPaidKey({ kind, id })));
  return list.filter((e) => !drop.has(recentPaidKey(e)));
}

/**
 * Hatırlatıcı "Ödendi"den sonra değişmediyse geri alınabilir: tekrar edende hâlâ aynı sıradaki tarihte, tek
 * seferlikte hâlâ kapalı ve aynı tarihte; ikisinde de tekrarların günü (anchorDate) aynı. Arada yeniden ödendiyse,
 * ertelendiyse, açılıp kapandıysa ya da tarihi düzenlendiyse eski hâl yazılmaz (yeni bilgiyi ezmesin).
 */
export function reminderUnchanged(e: RecentPaid, cur: Omit<ReminderState, "id">): boolean {
  if (!e.prev || cur.anchorDate !== e.prev.anchorDate) return false;
  return e.next ? cur.active === e.prev.active && cur.dueDate === e.next : !cur.active && cur.dueDate === e.prev.dueDate;
}

/**
 * Hatırlatıcı geri yüklenince (bildirimdeki "Geri al") kaydı artık geri alınamıyorsa düşer: "Ödendi"nin geri
 * alınması kaydı siler, "Ertele"nin geri alınması ise hatırlatıcıyı ödendikten sonraki hâline döndürür, kayıt kalır.
 */
export function dropChangedReminder(list: RecentPaid[], cur: ReminderState): RecentPaid[] {
  return list.filter((e) => e.kind !== "reminder" || e.id !== cur.id || reminderUnchanged(e, cur));
}

/**
 * Ekranda gösterilenler: geri alınabilir olanlar. Silinmiş ya da ödendikten sonra değişmiş hatırlatıcı, yeniden
 * ödenmemiş olan fatura ve silinmiş ya da kaydedildikten sonra düzenlenmiş cari ödeme gizlenir; kayıt silinmez
 * (ertelemenin geri alınmasıyla yeniden geçerli olabilir). `payments`: listedeki cari ödemelerin son düzenlenme anı.
 */
export function liveRecentPaid(list: RecentPaid[], reminders: ReminderState[], unpaidInvoiceIds: Iterable<number>, payments: ReadonlyMap<number, string> = new Map()): RecentPaid[] {
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const unpaid = new Set(unpaidInvoiceIds);
  return list.filter((e) => {
    switch (e.kind) {
      case "invoice":
        return !unpaid.has(e.id);
      case "reminder": {
        const cur = byId.get(e.id);
        return cur !== undefined && reminderUnchanged(e, cur);
      }
      case "cari": {
        const updated = payments.get(e.id);
        return updated !== undefined && paymentUnchanged(e, updated);
      }
    }
  });
}

/**
 * Cari ödeme kaydedildikten sonra düzenlenmediyse geri alınabilir: son düzenlenme anı kayıttakiyle aynı (`stamp`; yoksa
 * kaydın anından yeni değil)
 */
export function paymentUnchanged(e: Pick<RecentPaid, "at" | "stamp">, updatedAt: string): boolean {
  const t = new Date(updatedAt).getTime();
  return e.stamp ? t === new Date(e.stamp).getTime() : t <= new Date(e.at).getTime();
}
