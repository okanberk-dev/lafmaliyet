/*
 * Panel asistanının cihazdaki sohbet geçmişi (saf; tests/asistan-gelismis.test.ts; docs/ASISTAN.md › Sohbet geçmişi).
 *
 * - Son 10 sohbet bu cihazın tarayıcısında (localStorage), KULLANICIYA ÖZEL anahtarla (`lafm.asistan.gecmis.v1.<id>`):
 *   aynı cihazda başka bir yönetici kendi listesini görür. Sunucuya gitmez, başka cihaza geçmez; çıkışta silinir
 *   (sidebar.tsx › forgetAssistantHistory).
 * - Yalnız GÖRÜNEN metin saklanır: soru, yanıtın metni (takip önerileri yok), yanıtın altındaki kısa not. Onay
 *   kartlarının yalnız ÖZETİ: başlığı ve durumu ("[Onay kartı: Latte M fiyatı 90,00 ₺ olacak — yapıldı]"; başlığı kart
 *   yazar, yeni değeri ya da kişinin adını içerebilir). Kartın kimliği, satırları (eski → yeni), uyarıları ve notu
 *   saklanmaz: geçmişten açılan sohbette kart düğmesi yoktur, onaylanamaz.
 * - Başlık ilk sorudan (tek satır, en çok 60 karakter). Sohbet başına en çok 40 mesaj, her mesaj protokolün sınırında.
 * - Sunucuya yine yalnız etkin sohbetin son turları gider (protocol.ts › historyForRequest; 20 mesaj).
 */

import { OP_STATUS_LABEL } from "./ops";
import { ASSISTANT_LIMITS, type ChatMessage } from "./protocol";

export const HISTORY_MAX = 10;
export const HISTORY_MESSAGES = 40;
export const TITLE_MAX = 60;

export const historyKey = (userId: number) => `lafm.asistan.gecmis.v1.${userId}`;

/** Saklanan mesaj: yalnız görünen metin ve kısa not */
export interface StoredMessage {
  role: "user" | "assistant";
  text: string;
  note?: string;
  failed?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  /** ISO zaman: listede sıra ve tarih */
  updatedAt: string;
  messages: StoredMessage[];
}

/** Storage'ın kullandığımız yüzü (testte sahte) */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Sohbetin başlığı: ilk sorunun tek satırı (en çok 60 karakter) */
export function conversationTitle(messages: readonly Pick<ChatMessage, "role" | "text">[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim());
  const line = (first?.text ?? "").replace(/\s+/g, " ").trim();
  return line ? clip(line, TITLE_MAX) : "Yeni sohbet";
}

/** Kartın geçmişteki özeti: başlık (kartın yazdığı; yeni değeri içerebilir) ve durum. Satırlar, uyarı, not, kimlik yok */
export function cardSummary(c: NonNullable<ChatMessage["cards"]>[number]): string {
  return `[Onay kartı: ${clip(c.card.title, 120)} — ${OP_STATUS_LABEL[c.status] ?? c.status}]`;
}

/** Ekrandaki mesajlar → saklanacak biçim (yalnız görünen metin; kartların yalnız özeti) */
export function toStored(messages: readonly ChatMessage[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of messages) {
    const cards = m.role === "assistant" ? (m.cards ?? []).map(cardSummary) : [];
    const max = m.role === "user" ? ASSISTANT_LIMITS.message : ASSISTANT_LIMITS.reply;
    const text = clip([m.text.trim(), ...cards].filter(Boolean).join("\n\n"), max);
    if (!text && !m.note) continue;
    out.push({ role: m.role, text, ...(m.note ? { note: clip(m.note, 300) } : {}), ...(m.failed ? { failed: true } : {}) });
  }
  return out.slice(-HISTORY_MESSAGES);
}

/** Saklanan sohbet → ekrandaki mesajlar (kart yok: özeti metnin içinde) */
export function fromStored(c: Conversation): ChatMessage[] {
  return c.messages.map((m) => ({ role: m.role, text: m.text, ...(m.note ? { note: m.note } : {}), ...(m.failed ? { failed: true } : {}) }));
}

/** Sohbeti listenin başına koyar (aynı kimlik bir kez), en çok 10; sorusu olmayan sohbet saklanmaz */
export function upsertConversation(list: readonly Conversation[], id: string, messages: readonly ChatMessage[], now: Date = new Date()): Conversation[] {
  const stored = toStored(messages);
  const rest = list.filter((c) => c.id !== id);
  if (!stored.some((m) => m.role === "user")) return rest.slice(0, HISTORY_MAX);
  return [{ id, title: conversationTitle(messages), updatedAt: now.toISOString(), messages: stored }, ...rest].slice(0, HISTORY_MAX);
}

export function removeConversation(list: readonly Conversation[], id: string): Conversation[] {
  return list.filter((c) => c.id !== id);
}

const isStored = (m: unknown): m is StoredMessage => {
  const v = m as Partial<StoredMessage> | null;
  return !!v && (v.role === "user" || v.role === "assistant") && typeof v.text === "string";
};

/** Depodan okunan liste: biçimi bozuk olan sohbet ve mesaj düşer, sınırlar yeniden uygulanır */
export function parseConversations(raw: string | null): Conversation[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: Conversation[] = [];
  for (const x of v) {
    const c = x as Partial<Conversation> | null;
    if (!c || typeof c.id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(c.id) || typeof c.updatedAt !== "string" || !Array.isArray(c.messages)) continue;
    const messages = c.messages.filter(isStored).map((m) => ({
      role: m.role,
      text: clip(m.text, m.role === "user" ? ASSISTANT_LIMITS.message : ASSISTANT_LIMITS.reply),
      ...(typeof m.note === "string" ? { note: clip(m.note, 300) } : {}),
      ...(m.failed === true ? { failed: true } : {}),
    }));
    if (!messages.length || out.some((o) => o.id === c.id)) continue;
    out.push({ id: c.id, title: typeof c.title === "string" && c.title.trim() ? clip(c.title.replace(/\s+/g, " ").trim(), TITLE_MAX) : conversationTitle(messages), updatedAt: c.updatedAt, messages: messages.slice(-HISTORY_MESSAGES) });
    if (out.length >= HISTORY_MAX) break;
  }
  return out;
}

export function loadHistory(store: KeyValueStore | null | undefined, userId: number): Conversation[] {
  try {
    return store ? parseConversations(store.getItem(historyKey(userId))) : [];
  } catch {
    return [];
  }
}

export function saveHistory(store: KeyValueStore | null | undefined, userId: number, list: readonly Conversation[]): void {
  try {
    if (!store) return;
    if (list.length) store.setItem(historyKey(userId), JSON.stringify(list.slice(0, HISTORY_MAX)));
    else store.removeItem(historyKey(userId));
  } catch {
    // Gizli sekme ya da dolu depo: geçmiş yalnız bu ekranda kalır
  }
}

/** Yeni sohbet kimliği (yalnız cihazdaki listede; tahmin edilemez olması gerekmez) */
export function newConversationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Çıkışta: bu kullanıcının cihazdaki asistan verisi (geçmiş listesi, etkin sohbet) silinir */
export function forgetAssistantData(userId: number, stores: readonly (KeyValueStore | null | undefined)[]): void {
  for (const store of stores) {
    try {
      store?.removeItem(historyKey(userId));
      store?.removeItem(`lafm.asistan.v1.${userId}`);
      store?.removeItem(`lafm.asistan.v1.${userId}.id`);
    } catch {
      // Depo kapalı: yapacak bir şey yok
    }
  }
}
