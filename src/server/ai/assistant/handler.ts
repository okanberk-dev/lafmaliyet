/**
 * Panel asistanının ucu, bağımlılıkları dışarıdan verilerek (saf: oturum, veritabanı ve Claude istemcisi `deps`'ten;
 * tests/panel-asistani.test.ts sahteleriyle sınar). Gerçek bağımlılıklar src/server/ai/assistant/service.ts'te, yol
 * src/app/api/asistan/route.ts'te.
 *
 * Sıra (POST): açık mı (ASISTAN_KAPALI) → aynı köken (tarayıcı POST'ta Origin'i hep yollar) → oturum (401) → yalnız
 * yönetici (403; personel düğmeyi hiç görmez) → gövde (en çok 256 KB, şema: soru ≤ 4000, geçmiş ≤ 20 mesaj, açık ekran; 400) →
 * kapı (anahtar, Ayarlar › Fotoğraftan okuma, yönetici başına günlük sınır; 503 / 429) → ai_calls'a "running" satırı →
 * akış. Akış satır satır JSON'dur (src/lib/assistant/protocol.ts); bitince satır maliyetle kapanır. Sorunun ve yanıtın
 * METNİ hiçbir yere yazılmaz; sunucu günlüğüne yalnız hata kodu ve Anthropic'in istek kimliği düşer.
 *
 * İşlem araçları (docs/ASISTAN-ISLEMLER.md) bu uçta yalnız onay kartı hazırlar (`card` olayı): hiçbir eylem burada
 * çağrılmaz (eylemler refresh() çağırır, Route Handler'da hata fırlatır). Yazım kartın Onayla düğmesinin sunucu
 * eyleminde.
 */

import { errorTag } from "@/lib/assistant/error-tag";
import { pageContextLine, type AssistantPage } from "@/lib/assistant/page-context";
import { ASSISTANT_LIMITS, assistantRequest, encodeEvent, type AssistantEvent } from "@/lib/assistant/protocol";

import type { AiErrorCode } from "../run";
import { ASSISTANT_DEEP, assistantErrorText, runAssistant, type AssistantClient, type AssistantOutcome, type AssistantTiming } from "./loop";
import type { OpToolContext } from "./op-tools";
import { SYSTEM_PROMPT } from "./prompt";
import type { AssistantTool, ToolContext } from "./tool-adapter";

export type AssistantState = "on" | "nokey" | "off" | "cap";

export interface AssistantStatus {
  state: AssistantState;
  usedToday: number;
  cap: number;
}

export interface AssistantUser {
  id: number;
  role: "admin" | "staff";
}

/** Bir isteğin kurulumu: istemci, araçlar, araç bağlamı, değişken bağlam metni ve okumaların şube kapsamı */
export interface AssistantSetup {
  client: AssistantClient;
  tools: readonly AssistantTool[];
  toolCtx: ToolContext;
  context: string;
  /** Araçların okuması bu sarmalayıcının içinde çalışır (seçili şube; withBranchScope) */
  scoped<T>(fn: () => Promise<T>): Promise<T>;
}

export interface AssistantDeps {
  /** ASISTAN_KAPALI=1 değilse true */
  enabled(): boolean;
  sameOrigin(request: Request): boolean;
  user(): Promise<AssistantUser | null>;
  status(userId: number): Promise<AssistantStatus>;
  /**
   * ai_calls'a "running" satırı; kimliği. Sayım ve ekleme atomik: günlük sınır dolduysa (derin analizde 2 hak
   * kalmadıysa) satır açılmaz, null
   */
  start(userId: number, opts: { deep: boolean }): Promise<number | null>;
  /** Satırı sonuçla kapatır (maliyet, token, süre; metin yok) */
  finish(callId: number, outcome: AssistantOutcome, ms: number): Promise<void>;
  /** İsteğin kurulumu; `page` açık ekran (şubesi okumaların kapsamıdır: service.ts) */
  setup(page?: AssistantPage): Promise<AssistantSetup>;
  /**
   * Sohbete eklenen fiş fotoğrafının veri bloğu (src/server/assistant-ops/receipt.ts chatReceiptBlock): fotoğraf bu
   * kullanıcının, fiş türünde ve bağlanmamışsa okunan değerler; değilse kullanıcıya gösterilecek metin (soru sayılmaz)
   */
  receipt?(userId: number, photoId: number): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  timing?: Partial<AssistantTiming>;
  onToolError?: (tool: string, e: unknown) => void;
}

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Döngü dışında beklenmeyen hata (kayıt kapansın diye) */
const UNEXPECTED: AssistantOutcome = {
  done: null,
  error: { code: "connection", detail: "Beklenmeyen hata", status: null },
  cost: { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, fallback: false, priceKnown: true },
  servedModel: null,
  stopReason: null,
  requestId: null,
  apiCalls: 0,
  toolCalls: 0,
};

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });

const notFound = () => json(404, { error: "Bulunamadı" });

/** Kapının durumu → hata yanıtı (açıksa null) */
function gateRefusal(s: AssistantStatus): Response | null {
  if (s.state === "on") return null;
  const code = s.state as AiErrorCode;
  return json(s.state === "cap" ? 429 : 503, { error: assistantErrorText(code, s.cap), code: s.state, left: Math.max(0, s.cap - s.usedToday) });
}

/** Derin analize hak yetmiyor (2 soru sayılır): olağan soru yine sorulabilir; kapının durumu değişmez */
function deepRefusal(s: AssistantStatus): Response {
  const left = Math.max(0, s.cap - s.usedToday);
  return json(429, { error: `Derin analiz ${ASSISTANT_DEEP.weight} soru sayılır; bugün ${left} soru hakkı kaldı. Derin analizi kapatıp sorun.`, code: "deep_cap", left });
}

/** Kimlik ve rol: yanıt (hata) ya da yönetici */
async function admin(deps: AssistantDeps): Promise<Response | AssistantUser> {
  const user = await deps.user();
  if (!user) return json(401, { error: "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın." });
  if (user.role !== "admin") return json(403, { error: "Panel asistanı yalnız yöneticiler içindir." });
  return user;
}

/** GET: panelin açılışında asistanın durumu (yalnız yönetici) */
export async function handleAssistantGet(deps: AssistantDeps): Promise<Response> {
  if (!deps.enabled()) return notFound();
  const me = await admin(deps);
  if (me instanceof Response) return me;
  const s = await deps.status(me.id);
  return json(200, { state: s.state, left: Math.max(0, s.cap - s.usedToday), cap: s.cap, message: s.state === "on" ? null : assistantErrorText(s.state as AiErrorCode, s.cap) });
}

/** Gövde: en çok ASSISTANT_LIMITS.bodyBytes bayt (büyük gövde belleğe alınmaz) */
async function readBody(request: Request): Promise<unknown | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > ASSISTANT_LIMITS.bodyBytes) return null;
  const text = await request.text().catch(() => null);
  if (text === null || Buffer.byteLength(text) > ASSISTANT_LIMITS.bodyBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** POST: soru → akış */
export async function handleAssistantPost(request: Request, deps: AssistantDeps): Promise<Response> {
  if (!deps.enabled()) return notFound();
  if (!deps.sameOrigin(request)) return json(403, { error: "Geçersiz istek" });
  const me = await admin(deps);
  if (me instanceof Response) return me;
  const raw = await readBody(request);
  if (raw === null) return json(400, { error: "Geçersiz istek" });
  const parsed = assistantRequest.safeParse(raw);
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" });
  const status = await deps.status(me.id);
  const refused = gateRefusal(status);
  if (refused) return refused;
  // Derin analiz günlük sınıra 2 soru sayılır: tek hak kaldıysa yalnız olağan soru sorulabilir (kapı kapanmaz)
  const { deep } = parsed.data;
  const weight = deep ? ASSISTANT_DEEP.weight : 1;
  if (deep && status.cap - status.usedToday < weight) return deepRefusal(status);
  // Fiş fotoğrafı (docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı): soru sayılmadan önce denetlenir; okunan değerler mesajın
  // sonuna veri bloğu olarak eklenir (geçmişe gitmez: tarayıcı fotoğrafı sohbette tuttukça her istekte yeniden gelir)
  let attachment = "";
  if (parsed.data.photo) {
    const r = deps.receipt ? await deps.receipt(me.id, parsed.data.photo.id) : { ok: false as const, error: "Fiş fotoğrafı bu kurulumda eklenemiyor." };
    if (!r.ok) return json(400, { error: r.error, code: "photo" });
    attachment = r.text;
  }

  const setup = await deps.setup(parsed.data.page);
  const callId = await deps.start(me.id, { deep });
  // Kapıdan sonra aynı anda gelen başka bir soru sınırı doldurduysa (sayım ve ekleme start'ta atomik)
  if (callId === null) {
    if (deep) {
      const now = await deps.status(me.id);
      if (now.state === "on") return deepRefusal(now);
    }
    return gateRefusal({ state: "cap", usedToday: status.cap, cap: status.cap })!;
  }
  // Bu soru sayıldı: bugün kalan hak
  const left = Math.max(0, status.cap - status.usedToday - weight);
  const stop = new AbortController();
  const onClientAbort = () => stop.abort();
  request.signal?.addEventListener("abort", onClientAbort, { once: true });
  const encoder = new TextEncoder();
  const t0 = Date.now();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)));
        } catch {
          // Tarayıcı bağlantıyı kapattı
        }
      };
      let outcome: AssistantOutcome | null = null;
      // İşlem araçlarının bağlamı: soran yönetici, kartı akışa koyan işlev, bu yanıtın kart sayacı (yanıtta en çok bir kart)
      const toolCtx: OpToolContext = { ...setup.toolCtx, user: { id: me.id, role: me.role }, emitCard: (card) => send({ type: "card", card }), cards: { count: 0 } };
      try {
        outcome = await setup.scoped(() =>
          runAssistant(setup.client, {
            system: SYSTEM_PROMPT,
            // Değişken blok (önbellek işaretinden sonra): tarih, şube ve açık ekranın tek satırı
            context: [setup.context, pageContextLine(parsed.data.page)].filter(Boolean).join("\n"),
            tools: setup.tools,
            toolCtx,
            history: parsed.data.history,
            message: attachment ? `${parsed.data.message}\n\n${attachment}` : parsed.data.message,
            deep,
            emit: send,
            signal: stop.signal,
            timing: deps.timing,
            onToolError: deps.onToolError,
          }),
        );
        if (outcome.error) send({ type: "error", code: outcome.error.code, message: assistantErrorText(outcome.error.code), left });
        else send({ type: "done", reason: outcome.done ?? "end", left });
      } catch (e) {
        console.error("[asistan] beklenmeyen hata", errorTag(e));
        send({ type: "error", code: "error", message: "Beklenmeyen bir hata oldu. Yeniden deneyin.", left });
      } finally {
        request.signal?.removeEventListener("abort", onClientAbort);
        try {
          // Beklenmeyen hatada da satır "running" kalmaz
          await deps.finish(callId, outcome ?? UNEXPECTED, Date.now() - t0);
        } catch (e) {
          console.error("[asistan] kayıt kapanmadı", callId, errorTag(e));
        }
        try {
          controller.close();
        } catch {
          // zaten kapalı
        }
      }
    },
    cancel() {
      stop.abort();
    },
  });

  return new Response(body, {
    headers: { ...NO_STORE, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" },
  });
}
