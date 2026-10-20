// Son ödenenler: "Ödendi" işaretlenen fatura ve hatırlatıcılar 30 gün boyunca Ödemeler sayfasından geri alınabilir
// (bildirimdeki 8 saniyelik "Geri al" kaçırılınca da). Liste integration_state'te durur, yeni tablo yok; bu dosya
// listenin saf kurallarıdır (tests/recent-paid.test.ts).

export const RECENT_PAID_DAYS = 30;
export const RECENT_PAID_MAX = 30;

/** Hatırlatıcının "Ödendi"den önceki hâli (restoreReminder ile aynı alanlar) */
export interface ReminderSnapshot {
  dueDate: string;
  anchorDate: string;
  active: boolean;
  lastDoneAt: string | null;
}

export interface RecentPaid {
  kind: "invoice" | "reminder";
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
      typeof e === "object" && e !== null && (e.kind === "invoice" || e.kind === "reminder") && Number.isInteger(e.id) && typeof e.title === "string" && typeof e.at === "string",
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
 * Ekranda gösterilenler: geri alınabilir olanlar. Silinmiş ya da ödendikten sonra değişmiş hatırlatıcı ve yeniden
 * ödenmemiş olan fatura gizlenir; kayıt silinmez (ertelemenin geri alınmasıyla yeniden geçerli olabilir).
 */
export function liveRecentPaid(list: RecentPaid[], reminders: ReminderState[], unpaidInvoiceIds: Iterable<number>): RecentPaid[] {
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const unpaid = new Set(unpaidInvoiceIds);
  return list.filter((e) => {
    if (e.kind === "invoice") return !unpaid.has(e.id);
    const cur = byId.get(e.id);
    return cur !== undefined && reminderUnchanged(e, cur);
  });
}
