import { dateTR, num, tl } from "@/lib/format";
import { daysLeftLabel, type UpcomingItem } from "@/lib/reminders";

/** Zilin Ödemeler grubunda en çok kaç satır (sığmayanlar tek özet satırında) */
export const BELL_PAYMENT_LIMIT = 8;

/** Zilin ödeme satırı (src/server/actions/notifications.ts PanelNotification ile aynı şekil) */
export interface PaymentBellRow {
  id: string;
  kind: "danger" | "warning" | "info";
  title: string;
  body: string;
  timeLabel: string;
  unread: boolean;
  href: string;
  group: "odeme";
  covers?: string[];
  /** Özet satırının içine aldığı gecikmiş ödeme sayısı (alt menünün Ödemeler rozeti bunu sayar; src/components/panel/nav.ts overdueCount) */
  overdue?: number;
}

type Item = Pick<UpcomingItem, "ref" | "title" | "amount" | "dueDate" | "detail" | "hint" | "daysLeft" | "status">;

const idOf = (i: Item) => `odeme-${i.ref}-${i.dueDate}`;

function row(i: Item): PaymentBellRow {
  return {
    id: idOf(i),
    kind: i.status === "overdue" ? "danger" : i.status === "today" ? "warning" : "info",
    title: `${i.title}${i.amount !== null ? ` · ${tl(i.amount)}` : ""}`,
    body: [`Son ödeme ${dateTR(i.dueDate)}`, i.detail, i.hint?.text].filter(Boolean).join(" · "),
    timeLabel: daysLeftLabel(i.daysLeft),
    unread: i.status !== "soon",
    href: "/panel/hatirlaticilar",
    group: "odeme",
  };
}

/**
 * Zamanı gelen ödemelerin zil satırları (bulgu 96): "sonra" olmayanlar vadeye göre. Sığmazsa (8'den fazla) ilk 7'si
 * tek tek, kalanı tek bir "N ödeme daha" satırında: kaçının gecikmiş, bugün ve yakında olduğunu ve ilk üçünün adını
 * söyler, okununca içindekiler de okunmuş sayılır (`covers`), içindeki gecikmiş sayısını taşır (`overdue`) ki alt
 * menünün rozeti gerçek gecikmiş sayısını göstersin (önceden 8'de takılıyor, "9+" hiç çıkmıyordu). Kimlik gizlenenlerin
 * en geç vadelisinden: yeni bir ödeme sığmayınca özet yeniden okunmamış olur.
 */
export function paymentBellRows(items: readonly Item[], limit = BELL_PAYMENT_LIMIT): PaymentBellRow[] {
  const due = items.filter((i) => i.status !== "later");
  if (due.length <= limit) return due.map(row);
  const shown = due.slice(0, Math.max(0, limit - 1));
  const hidden = due.slice(shown.length);
  const late = hidden.filter((i) => i.status === "overdue").length;
  const today = hidden.filter((i) => i.status === "today").length;
  const soon = hidden.length - late - today;
  const counts = [late ? `${num(late)} gecikmiş` : null, today ? `${num(today)} bugün` : null, soon ? `${num(soon)} yakında` : null].filter(Boolean);
  const names = hidden.slice(0, 3).map((i) => i.title);
  const more = hidden.length - names.length;
  const last = hidden[hidden.length - 1];
  return [
    ...shown.map(row),
    {
      id: `odeme-diger-${last.ref}-${last.dueDate}`,
      kind: late ? "danger" : today ? "warning" : "info",
      title: `${num(hidden.length)} ödeme daha`,
      body: `${counts.join(", ")}: ${names.join(", ")}${more > 0 ? ` ve ${num(more)} ödeme daha` : ""}. Hepsi Ödemeler'de.`,
      timeLabel: "",
      unread: late + today > 0,
      href: "/panel/hatirlaticilar",
      group: "odeme",
      covers: hidden.map(idOf),
      ...(late ? { overdue: late } : {}),
    },
  ];
}
