/*
 * Panel asistanının tarayıcı ↔ sunucu sözleşmesi (saf; ikisi de kullanır, tests/panel-asistani.test.ts; docs/ASISTAN.md):
 * isteğin gövdesi ve sınırları, akışın olayları (satır satır JSON) ve tarayıcıda tutulan geçmişten giden kısım.
 *
 * Geçmiş tarayıcıda durur (sessionStorage, kullanıcıya özel anahtar); sunucu hiçbir mesajı saklamaz. Her istekte yalnız
 * önceki turların GÖRÜNEN metni gider (soru ve yanıt; araç çağrısı, araç sonucu, düşünme bloğu yok). Sunucu bu metni
 * olduğu gibi Claude'a verir; içindekini doğrulamaz, yalnız biçimini ve boyunu sınar (aşağıdaki şema).
 */

import { z } from "zod";

import { cardHistoryLine, isOpCard, isOpStatus, type OpCard, type OpCardState } from "./ops";

export const ASSISTANT_LIMITS = {
  /** Kullanıcının bir mesajı (karakter) */
  message: 4000,
  /** Geçmişteki bir asistan yanıtı (karakter; daha uzunu tarayıcıda sonundan kısaltılır) */
  reply: 8000,
  /** Geçmişte en çok bu kadar mesaj (soru + yanıt; 10 tur). Daha eskisi tarayıcıda düşer */
  history: 20,
  /** İstek gövdesi (bayt) */
  bodyBytes: 256 * 1024,
} as const;

/** Yönetici başına günde en çok bu kadar soru (src/server/ai/claude.ts assistantStatus; ai_calls feature "asistan") */
export const ASSISTANT_DAILY_CAP = 60;

/**
 * Asistan bu kurulumda açık mı: ASISTAN_KAPALI=1 ise düğme çizilmez, uç 404 döner (yalnız asistanı kapatır; fotoğraftan
 * okuma açık kalır). Sunucuda okunur (panel düzeni ve uç)
 */
export function assistantEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ASISTAN_KAPALI !== "1";
}

const turn = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().trim().min(1, "Boş mesaj"),
  })
  .strict();

export type AssistantTurn = z.output<typeof turn>;

/**
 * İsteğin gövdesi: yeni soru ve önceki turlar. Geçmiş soruyla başlar, soru ve yanıt sırayla gelir, yanıtla biter
 * (yeni soru ayrı alanda). Soru en çok 4000, yanıt en çok 8000 karakter, geçmiş en çok 20 mesaj.
 */
export const assistantRequest = z
  .object({
    message: z.string().trim().min(1, "Soru boş").max(ASSISTANT_LIMITS.message, `Soru en çok ${ASSISTANT_LIMITS.message} karakter olabilir`),
    history: z.array(turn).max(ASSISTANT_LIMITS.history, `Geçmiş en çok ${ASSISTANT_LIMITS.history} mesaj olabilir`).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.history.forEach((t, i) => {
      const want = i % 2 === 0 ? "user" : "assistant";
      if (t.role !== want) ctx.addIssue({ code: "custom", path: ["history", i, "role"], message: "Geçmiş soru ve yanıt sırasıyla gelmeli" });
      const max = t.role === "user" ? ASSISTANT_LIMITS.message : ASSISTANT_LIMITS.reply;
      if (t.text.length > max) ctx.addIssue({ code: "custom", path: ["history", i, "text"], message: `Geçmişteki mesaj en çok ${max} karakter olabilir` });
    });
    if (v.history.length % 2 !== 0) ctx.addIssue({ code: "custom", path: ["history"], message: "Geçmiş bir yanıtla bitmeli" });
  });

export type AssistantRequest = z.output<typeof assistantRequest>;

// ---------------------------------------------------------------- Akış

/** Asistanın bitiş nedeni (yanıt metni o ana kadar gelenlerdir) */
export type AssistantDone =
  /** Olağan bitiş */
  | "end"
  /** Araç turu ya da süre sınırı doldu: son çağrı araçsızdı, eldeki bilgiyle yanıtladı */
  | "limit"
  /** Kesin süre doldu: yanıt yarıda kesildi */
  | "deadline"
  /** Yanıt token sınırında kesildi */
  | "max_tokens"
  /** Kullanıcı durdurdu */
  | "aborted";

/**
 * Akışın olayları (application/x-ndjson, satır başına bir JSON):
 * - `text`: yanıt metninin parçası (sırayla eklenir)
 * - `tool`: bir araç çalışıyor ("Tedarikçi özeti"); ekranda durum satırı
 * - `card`: onay kartı (sunucunun yazdığı; docs/ASISTAN-ISLEMLER.md); kullanıcı Onayla'ya basmadıkça hiçbir şey değişmez
 * - `done`: bitti; `left` bugün kalan soru hakkı
 * - `error`: hata; `message` ekranda gösterilecek Türkçe metin (yanıt metni o ana kadar gelenlerdir)
 */
export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "card"; card: OpCard }
  | { type: "done"; reason: AssistantDone; left: number | null }
  | { type: "error"; code: string; message: string; left?: number | null };

export const encodeEvent = (e: AssistantEvent): string => `${JSON.stringify(e)}\n`;

const KNOWN = new Set(["text", "tool", "card", "done", "error"]);

/** Satır satır JSON okuyucu: gelen parçaları biriktirir, tamamlanan satırların olaylarını verir (bozuk satır atlanır) */
export function eventReader(): { push(chunk: string): AssistantEvent[]; end(): AssistantEvent[] } {
  let buf = "";
  const parse = (line: string): AssistantEvent | null => {
    if (!line.trim()) return null;
    try {
      const v = JSON.parse(line) as { type?: unknown; card?: unknown };
      if (!v || typeof v !== "object" || typeof v.type !== "string" || !KNOWN.has(v.type)) return null;
      return v.type === "card" && !isOpCard(v.card) ? null : (v as AssistantEvent);
    } catch {
      return null;
    }
  };
  return {
    push(chunk) {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      return lines.map(parse).filter((e): e is AssistantEvent => e !== null);
    },
    end() {
      const rest = parse(buf);
      buf = "";
      return rest ? [rest] : [];
    },
  };
}

// ---------------------------------------------------------------- Tarayıcıdaki sohbet

/** Ekrandaki bir mesaj (sessionStorage'da durur) */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Yanıt hatayla bitti (ret, servis hatası): bu tur sonraki isteğe gitmez */
  failed?: boolean;
  /** Yanıtın altındaki küçük not ("Durduruldu", "Süre doldu") */
  note?: string;
  /** Yanıttaki onay kartları ve son durumları */
  cards?: OpCardState[];
}

/** Sayfa işlem sürerken yenilendiyse kartın iletisi (durum sunucudan yeniden okunana kadar) */
export const RESTORED_RUNNING = "Sayfa işlem sürerken yenilendi; sonuç sunucudan okunuyor. Okunamazsa ilgili ekranda denetleyin.";

/**
 * sessionStorage'dan okunan kartlar: biçimi bozuk olan düşer. İşlem sürerken ("işleniyor", "geri alınıyor") kaydedilen
 * kart o hâliyle kalmaz (düğmeler sonsuza dek kapalı kalırdı): "işleniyor" → sonucu belirsiz, "geri alınıyor" → yapıldı
 * olur ve `recheck` ile işaretlenir; kart açılınca planın gerçek durumunu sunucudan okur.
 */
export function restoreCards(v: unknown): OpCardState[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((x): OpCardState[] => {
    const c = x as Partial<OpCardState> | null;
    if (!c || !isOpCard(c.card) || !isOpStatus(c.status)) return [];
    const undoUntil = typeof c.undoUntil === "string" ? { undoUntil: c.undoUntil } : {};
    if (c.status === "running" || c.status === "undoing" || c.recheck === true) {
      const status = c.status === "running" ? "unknown" : c.status === "undoing" ? "done" : c.status;
      return [{ card: c.card, status, message: RESTORED_RUNNING, ...undoUntil, recheck: true }];
    }
    return [{ card: c.card, status: c.status, ...(typeof c.message === "string" ? { message: c.message } : {}), ...undoUntil }];
  });
  return out.length ? out : undefined;
}

/** Yanıtın geçmişe giden metni: görünen metin + kartların kısa satırı (asistan sonraki turda kartın ne olduğunu bilsin) */
export function replyText(m: Pick<ChatMessage, "text" | "cards">): string {
  const lines = (m.cards ?? []).map(cardHistoryLine);
  return [m.text.trim(), ...lines].filter(Boolean).join("\n\n");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Sonraki isteğe giden geçmiş: hatayla biten turlar (soru ve yanıtı birlikte) ve boş yanıtlar düşer, uzun yanıt
 * kısaltılır, en son 20 mesaj kalır; geçmiş her zaman soruyla başlar ve yanıtla biter (şemanın kuralı).
 */
export function historyForRequest(messages: readonly ChatMessage[], max: number = ASSISTANT_LIMITS.history): AssistantTurn[] {
  const pairs: [AssistantTurn, AssistantTurn][] = [];
  for (let i = 0; i + 1 < messages.length; i++) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q.role !== "user" || a.role !== "assistant") continue;
    i++;
    const reply = replyText(a);
    if (a.failed || !q.text.trim() || !reply) continue;
    pairs.push([
      { role: "user", text: clip(q.text.trim(), ASSISTANT_LIMITS.message) },
      { role: "assistant", text: clip(reply, ASSISTANT_LIMITS.reply) },
    ]);
  }
  return pairs.slice(-Math.floor(max / 2)).flat();
}
