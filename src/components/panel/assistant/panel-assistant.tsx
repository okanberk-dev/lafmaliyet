"use client";

import { ArrowUp, LoaderCircle, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { useHideOnScrollDown } from "@/components/ui/fab";
import { useMediaQuery } from "@/components/ui/use-media";
import type { OpCardState } from "@/lib/assistant/ops";
import { ASSISTANT_LIMITS, eventReader, historyForRequest, restoreCards, type AssistantDone, type AssistantEvent, type ChatMessage } from "@/lib/assistant/protocol";
import { cn } from "@/lib/utils";

import { MarkdownView } from "./markdown-view";
import { OpCardView } from "./op-card";

/**
 * Panel asistanı (docs/ASISTAN.md): sağ altta küçük yuvarlak düğme, tıklayınca masaüstünde 400×560'lık pencere,
 * telefon ve tablette (lg altı) tam ekran sayfa. Yalnız yöneticiye çizilir (assistant-gate.tsx, sunucuda).
 *
 * - Düğmenin yeri globals.css'te (--assistant-bottom): telefonda alt menünün, varsa sayfanın yüzen ekleme düğmesinin
 *   (Fab) ve kaydetme çubuğunun üstünde; masaüstünde köşede, hatırlatma kartı açıkken kartın üstünde. Telefonda aşağı
 *   kaydırırken Fab gibi gizlenir, ekran klavyesi açıkken ve baskıda görünmez.
 * - Sohbet bu sekmede durur (sessionStorage, kullanıcıya özel anahtar); "Yeni sohbet" siler. Sunucuya her soruda yalnız
 *   önceki turların görünen metni gider (historyForRequest); sunucu hiçbir mesajı saklamaz.
 * - Yanıt akarak gelir (satır satır JSON): metin parça parça, araç çalışırken durum satırı ("Tedarikçi özeti…"),
 *   "Durdur" isteği keser. Yanıt güvenli markdown'la çizilir (markdown-view.tsx; HTML yok).
 * - Klavye: Esc kapatır, Tab pencerenin içinde döner, Enter gönderir, Shift+Enter yeni satır.
 * - Telefon (390 ve 360 px): tam ekran alt sayfa, görünür alana oturur (--vvh yüksekliği, --vv-top üstü; bottom-nav.tsx
 *   yazar): ekran klavyesi açıkken giriş kutusu klavyenin hemen üstünde kalır, alttaki güvenli alan payı klavye
 *   kapalıyken eklenir; üstte, solda ve sağda güvenli alan (çentik). Alt menü ve sayfanın yüzen düğmesi (Fab) sayfanın
 *   altında kalır (z-60). Dokunulan her düğme en az 44 px; yazı kutusu 16 px (iOS odakta yakınlaştırmasın).
 * - İşlemler (docs/ASISTAN-ISLEMLER.md): asistan risksiz bir işi onay kartıyla önerir (`card` olayı; op-card.tsx).
 *   Kart yanıtın altında durur; Onayla'ya basılmadıkça hiçbir şey değişmez. Kartların son durumu da sekmede saklanır ve
 *   sonraki sorunun geçmişine kısa bir satır olarak gider.
 */

/** Örnek sorular (çipler): LafPOS ve operasyon önce, sonra maliyet ve ödemeler */
const SAMPLES = [
  "Dünkü gün sonu nasıldı?",
  "Dün en çok ne sattı?",
  "Bugün kim çalışıyor?",
  "Ne bitmek üzere?",
  "Bu ay nasıl gidiyor?",
  "En çok kime borcumuz var?",
  "Hangi ürünler hammaddeye bağlanmayı bekliyor?",
];

/** Sekmede en çok bu kadar mesaj saklanır (sunucuya yalnız son 20'si gider) */
const KEEP = 40;

const DONE_NOTE: Partial<Record<AssistantDone, string>> = {
  limit: "Araç ya da süre sınırına ulaşıldı; yanıt eldeki bilgiyle.",
  deadline: "Süre doldu; yanıt yarıda kesildi. Soruyu daraltıp yeniden sorun.",
  max_tokens: "Yanıt uzun olduğu için kesildi.",
  aborted: "Durduruldu.",
};

interface Gate {
  state: "on" | "nokey" | "off" | "cap";
  left: number;
  cap: number;
  message: string | null;
}

const storageKey = (userId: number) => `lafm.asistan.v1.${userId}`;

function loadMessages(userId: number): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(v)) return [];
    return v
      .filter((m): m is ChatMessage => !!m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .map((m) => {
        const cards = m.role === "assistant" ? restoreCards(m.cards) : undefined;
        return { role: m.role, text: m.text, ...(m.failed ? { failed: true } : {}), ...(typeof m.note === "string" ? { note: m.note } : {}), ...(cards ? { cards } : {}) };
      });
  } catch {
    return [];
  }
}

function saveMessages(userId: number, messages: ChatMessage[]) {
  try {
    if (messages.length) window.sessionStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-KEEP)));
    else window.sessionStorage.removeItem(storageKey(userId));
  } catch {
    // Gizli sekme ya da dolu depo: sohbet yalnız bu ekranda kalır
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PanelAssistant({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(userId));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [announce, setAnnounce] = useState("");
  const hidden = useHideOnScrollDown();
  const sheet = useMediaQuery("(width < 64rem)");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleId = useId();

  useEffect(() => saveMessages(userId, messages), [userId, messages]);

  // Açılınca: durum (anahtar, ayar, bugün kalan) bir kez sorulur, yazı alanına odaklanılır
  const loadGate = useCallback(async () => {
    try {
      const res = await fetch("/api/asistan", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (Partial<Gate> & { error?: string }) | null;
      if (res.ok && body?.state) setGate({ state: body.state, left: body.left ?? 0, cap: body.cap ?? 0, message: body.message ?? null });
      else setGate({ state: "off", left: 0, cap: 0, message: body?.error ?? "Asistan şu an açılamadı." });
    } catch {
      setGate(null);
    }
  }, []);

  const show = () => {
    setOpen(true);
    if (!gate) void loadGate();
  };

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  // Yeni metin gelince sona kaydır (kullanıcı yukarıda okumuyorsa)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages, tool, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Telefonda klavye açılınca (görünür alan küçülür) son mesaj giriş kutusunun üstünde görünür kalsın
  useEffect(() => {
    if (!open || !sheet) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const el = listRef.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [open, sheet]);

  /** Son (asistanın) mesajını değiştirir */
  const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((list) => {
      if (!list.length || list[list.length - 1].role !== "assistant") return list;
      return [...list.slice(0, -1), fn(list[list.length - 1])];
    });

  /** Bir kartın durumunu değiştirir (hangi mesajda olursa olsun) */
  const patchCard = useCallback(
    (next: OpCardState) =>
      setMessages((list) => list.map((m) => (m.cards?.some((c) => c.card.id === next.card.id) ? { ...m, cards: m.cards.map((c) => (c.card.id === next.card.id ? next : c)) } : m))),
    [],
  );

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy || (gate && gate.state !== "on")) return;
    const history = historyForRequest(messages);
    setMessages((list) => [...list, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setInput("");
    setBusy(true);
    setTool(null);
    setAnnounce("Asistan yanıtlıyor");
    const controller = new AbortController();
    abortRef.current = controller;
    let ended = false;
    const fail = (message: string, keepText = true) => {
      ended = true;
      patchLast((m) => ({ ...m, text: keepText ? m.text : "", failed: !keepText || !m.text.trim(), note: message }));
      setAnnounce(message);
    };
    const handle = (e: AssistantEvent) => {
      if (e.type === "text") patchLast((m) => ({ ...m, text: m.text + e.text }));
      else if (e.type === "tool") setTool(e.label);
      else if (e.type === "card") {
        patchLast((m) => ({ ...m, cards: [...(m.cards ?? []), { card: e.card, status: "pending" }] }));
        setAnnounce("Onay kartı hazır: kontrol edip Onayla'ya basın");
      }
      else if (e.type === "done") {
        ended = true;
        setTool(null);
        const note = DONE_NOTE[e.reason];
        patchLast((m) => ({ ...m, ...(note ? { note } : {}), ...(m.text.trim() || m.cards?.length ? {} : { failed: true, note: note ?? "Yanıt boş geldi." }) }));
        if (e.left !== null) setGate((g) => (g ? { ...g, left: e.left!, state: e.left! <= 0 ? "cap" : g.state } : g));
        setAnnounce("Yanıt hazır");
      } else if (e.type === "error") {
        setTool(null);
        // Ret: yarım gelen metin atılır (yanıtın yerine yalnız açıklama)
        fail(e.message, e.code !== "refusal");
        if (typeof e.left === "number") setGate((g) => (g ? { ...g, left: e.left! } : g));
      }
    };
    try {
      const res = await fetch("/api/asistan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string; code?: string; left?: number } | null;
        if (body?.code && ["nokey", "off", "cap"].includes(body.code)) setGate({ state: body.code as Gate["state"], left: body.left ?? 0, cap: gate?.cap ?? 0, message: body.error ?? null });
        fail(body?.error ?? "Asistana ulaşılamadı. Yeniden deneyin.", false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const events = eventReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(decoder.decode(value, { stream: true })).forEach(handle);
      }
      events.end().forEach(handle);
      if (!ended) fail("Bağlantı yarıda kesildi. Yeniden deneyin.");
    } catch (e) {
      if (controller.signal.aborted) {
        if (!ended) patchLast((m) => ({ ...m, note: DONE_NOTE.aborted, ...(m.text.trim() ? {} : { failed: true }) }));
        setAnnounce("Durduruldu");
      } else fail(e instanceof Error && e.name === "TypeError" ? "Asistana ulaşılamadı. İnterneti kontrol edip yeniden deneyin." : "Yanıt alınamadı. Yeniden deneyin.");
    } finally {
      abortRef.current = null;
      setBusy(false);
      setTool(null);
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const blocked = gate !== null && gate.state !== "on";
  const last = messages[messages.length - 1];
  const waiting = busy && last?.role === "assistant" && !last.text;
  const tooLong = input.length > ASSISTANT_LIMITS.message;

  return (
    <>
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={show}
          aria-label="Panel asistanı"
          title="Panel asistanı"
          aria-haspopup="dialog"
          data-hidden={hidden || undefined}
          className={cn(
            "no-print fixed right-4 bottom-(--assistant-bottom) z-[36] flex size-12 cursor-pointer items-center justify-center rounded-full bg-surface text-ink shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-1 ring-line-strong lg:right-6 in-data-[keyboard=open]:hidden",
            "transition-[translate,scale,opacity,bottom] duration-200 hover:scale-105 active:scale-95 motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40",
            "max-lg:data-hidden:pointer-events-none max-lg:data-hidden:translate-y-[calc(100%+1rem)] max-lg:data-hidden:opacity-0",
          )}
        >
          <Sparkles className="size-5 text-brand-500" aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={onPanelKey}
          data-scroll-lock={sheet || undefined}
          data-component="panel-assistant"
          className={cn(
            "no-print fixed z-[60] flex flex-col overflow-hidden bg-surface text-ink",
            // Telefon ve tablet: tam ekran sayfa, görünür alana oturur (klavye açıkken klavyenin üstünde biter: --vvh,
            // --vv-top); güvenli alan üstte, yanlarda ve klavye kapalıyken altta
            "max-lg:inset-x-0 max-lg:top-(--vv-top,0px) max-lg:bottom-auto max-lg:h-(--vvh,100dvh)",
            "max-lg:pt-[env(safe-area-inset-top)] max-lg:pr-[env(safe-area-inset-right)] max-lg:pb-[env(safe-area-inset-bottom)] max-lg:pl-[env(safe-area-inset-left)] max-lg:in-data-[keyboard=open]:pb-0",
            // Masaüstü: sağ altta 400 × 560 pencere
            "lg:right-6 lg:bottom-6 lg:h-[min(560px,calc(100dvh-3rem))] lg:w-[400px] lg:rounded-2xl lg:shadow-[0_16px_48px_rgba(0,0,0,0.22)] lg:ring-1 lg:ring-line-strong",
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3 max-lg:gap-2 max-lg:py-2 max-lg:pr-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel">
              <Sparkles className="size-4 text-brand-500" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[15px] leading-5 font-semibold">
                Panel asistanı
              </h2>
              <p className="truncate text-[12px] leading-4 text-ink-mute">Panelin verisine bakar; onayınızla küçük işleri yapar</p>
            </div>
            {messages.length ? (
              <button
                type="button"
                onClick={reset}
                title="Yeni sohbet"
                className="inline-flex h-8 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-mute hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:h-11 pointer-coarse:h-11"
              >
                <RotateCcw className="size-3.5 max-lg:size-4" aria-hidden="true" />
                {/* Dar telefonda (360 px) yalnız simge: başlık sığsın */}
                <span className="max-[400px]:sr-only">Yeni sohbet</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={close}
              aria-label="Kapat"
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-mute hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:size-11 pointer-coarse:size-11"
            >
              <X className="size-4 max-lg:size-5" aria-hidden="true" />
            </button>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            {!messages.length ? (
              <div className="space-y-4">
                <p className="text-[14px] leading-6 text-ink-soft">
                  Merhaba! LafPOS gün sonları ve günlük satışlar, kasa, vardiya, Tükendi, bekleyen işler, ciro, kâr, tedarikçi borçları, ödemeler ve panelin
                  nasıl kullanıldığı hakkında sorabilirsiniz. Tükendi, fiyat, ödendi işareti, hatırlatıcı, vardiya gibi küçük işleri onay kartıyla hazırlarım:
                  siz Onayla&apos;ya basmadan hiçbir şey değişmez. Silme, toplu ve riskli işleri yapmam; onlarda ekranın bağlantısını ve adımları veririm.
                </p>
                {!blocked ? (
                  <div className="flex flex-wrap gap-2">
                    {SAMPLES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        disabled={busy}
                        className="min-h-9 cursor-pointer rounded-full bg-panel px-3 py-1.5 text-left text-[13px] leading-5 text-ink-soft ring-1 ring-line hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-50 max-lg:min-h-11 max-lg:px-3.5 max-lg:text-[14px] pointer-coarse:min-h-11"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-panel px-3.5 py-2 text-[14px] leading-6 break-words whitespace-pre-wrap text-ink">{m.text}</p>
                </div>
              ) : (
                <div key={i} className="space-y-1.5">
                  {m.text ? <MarkdownView text={m.text} onNavigate={sheet ? close : undefined} className={cn(m.failed && "text-ink-mute")} /> : null}
                  {m.cards?.map((c) => <OpCardView key={c.card.id} state={c} onChange={patchCard} />)}
                  {m.note ? <p className={cn("text-[12.5px] leading-5", m.failed ? "text-warn-ink dark:text-brass-300" : "text-ink-mute")}>{m.note}</p> : null}
                </div>
              ),
            )}

            {busy ? (
              <div className="flex items-center gap-2 text-[13px] text-ink-mute" aria-hidden="true">
                {tool ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                    <span>{tool} hazırlanıyor…</span>
                  </>
                ) : waiting ? (
                  <span className="flex gap-1" title="Yazıyor">
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-quiet motion-reduce:animate-none" />
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-quiet [animation-delay:120ms] motion-reduce:animate-none" />
                    <span className="size-1.5 animate-bounce rounded-full bg-ink-quiet [animation-delay:240ms] motion-reduce:animate-none" />
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>

          <div className="shrink-0 border-t border-line px-3 pt-2.5 pb-3 max-lg:in-data-[keyboard=open]:pb-2">
            {blocked ? (
              <p className="mb-2 rounded-xl bg-panel px-3 py-2 text-[13px] leading-5 text-ink-soft">{gate?.message ?? "Asistan şu an kapalı."}</p>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <label htmlFor={`${titleId}-soru`} className="sr-only">
                Sorunuz
              </label>
              <textarea
                id={`${titleId}-soru`}
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKey}
                rows={1}
                maxLength={ASSISTANT_LIMITS.message + 200}
                disabled={blocked}
                placeholder={blocked ? "" : "Sorunuzu yazın…"}
                aria-invalid={tooLong || undefined}
                className="field-sizing-content max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-xl bg-panel px-3.5 py-2.5 text-[16px] leading-6 text-ink placeholder:text-ink-mute focus:ring-2 focus:ring-ink/25 focus:outline-none disabled:opacity-60 max-lg:in-data-[keyboard=open]:max-h-28 lg:text-[14px]"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Durdur"
                  title="Durdur"
                  className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-panel text-ink ring-1 ring-line-strong hover:bg-panel-deep focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
                >
                  <Square className="size-4 fill-current" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Gönder"
                  title="Gönder (Enter)"
                  disabled={blocked || !input.trim() || tooLong}
                  className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-on-primary hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                >
                  <ArrowUp className="size-5" aria-hidden="true" />
                </button>
              )}
            </form>
            {/* Klavye açıkken telefonda gizli: yazı alanına yer kalsın (sınır uyarısı yine görünür) */}
            <p className={cn("mt-1.5 px-1 text-[11.5px] leading-4 text-ink-mute", !tooLong && "max-lg:in-data-[keyboard=open]:hidden")}>
              {tooLong
                ? `Soru en çok ${ASSISTANT_LIMITS.message.toLocaleString("tr-TR")} karakter olabilir (${input.length.toLocaleString("tr-TR")}).`
                : gate && gate.state === "on" && gate.left <= 10
                  ? `Bugün ${gate.left} soru hakkı kaldı. Önemli rakamları ekranda kontrol edin.`
                  : "Claude ile çalışır; önemli rakamları ekranda kontrol edin. Shift+Enter: yeni satır."}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
