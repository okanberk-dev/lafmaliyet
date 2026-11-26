"use client";

import { ArrowUp, Brain, Camera, Check, Copy, History, LoaderCircle, RefreshCw, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { PhotoStatus, usePhotoUpload } from "@/components/panel/photo-picker";
import { useMediaQuery } from "@/components/ui/use-media";
import type { OpCardState } from "@/lib/assistant/ops";
import { restoreFollowups, splitFollowups } from "@/lib/assistant/followups";
import { fromStored, loadHistory, newConversationId, removeConversation, saveHistory, upsertConversation, type Conversation, type KeyValueStore } from "@/lib/assistant/history";
import { markdownToPlain } from "@/lib/assistant/markdown";
import { pageFromLocation, suggestionsFor } from "@/lib/assistant/page-context";
import { ASSISTANT_DAILY_CAP, ASSISTANT_DEEP_WEIGHT, ASSISTANT_LIMITS, eventReader, historyForRequest, restoreCards, type AssistantDone, type AssistantEvent, type ChatMessage } from "@/lib/assistant/protocol";
import { RECEIPT_DEFAULT_MESSAGE, receiptChipText } from "@/lib/assistant/receipt";
import { businessDate } from "@/lib/cash-report";
import { photoUrl } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";

import { onAssistantOpened, setAssistantOpen, toggleAssistant, useAssistantOpen } from "./assistant-open";
import { FollowupChips } from "./followup-chips";
import { HistoryList } from "./history-list";
import { MarkdownView } from "./markdown-view";
import { OpCardView } from "./op-card";
import { VoiceButton } from "./voice-button";

/**
 * Panel asistanı (docs/ASISTAN.md): masaüstünde (lg+) sağ altta küçük yuvarlak düğme ve 400×560'lık pencere; telefon
 * ve tablette (lg altı) yüzen düğme YOK: asistan alt menünün ortasındaki "Asistan" sekmesinden açılır (bottom-nav.tsx,
 * nav.ts › bottomNavFor) ve alt menünün üstünde biten tam ekran, sade bir sayfadır. Açık / kapalı durumu
 * assistant-open.ts'te (sekme ile bu bileşen ayrı ağaçlarda). Yalnız yöneticiye çizilir (assistant-gate.tsx, sunucuda).
 *
 * - Düğmenin yeri globals.css'te (--assistant-bottom): masaüstünde köşede, hatırlatma kartı ya da kaydetme çubuğu
 *   açıkken onların üstünde; baskıda görünmez. Telefonda düğme hiç çizilmez (`!sheet`, sınıfta da `max-lg:hidden`).
 * - Sayfa bağlamı (src/lib/assistant/page-context.ts): boşken açık ekrana özel 3–4 öneri çipi; her soruda açık ekranın
 *   yolu, adresteki ?ay / ?gun ve ekranın şubesi (`branch`, kabuğun seçicisi; assistant-gate.tsx) gider: sunucu değişken
 *   bağlama tek satır yazar, araçlar o şubeyle okur (çerez sekmeler arasında ortak; ekranın şubesi esastır).
 * - Takip önerileri (src/lib/assistant/followups.ts): yanıtın sonundaki <takip> bloğu ayrılır, son yanıtın altında çip.
 * - Derin analiz anahtarı (yazı kutusunun üstünde): varsayılan kapalı, bir soruluk; efor high, 2 soru sayılır (loop.ts
 *   ASSISTANT_DEEP). Hak 2'den azsa kapalı.
 * - Sohbet geçmişi (src/lib/assistant/history.ts): son 10 sohbet cihazda (localStorage, kullanıcıya özel), yalnız
 *   görünen metin ve kartın özeti; başlıktaki Geçmiş düğmesi listeler, açar, siler. Çıkışta silinir (sidebar.tsx).
 * - Sesle soru (voice-button.tsx; telefonda, tarayıcı destekliyorsa): tanınan metin kutuya yazılır, kullanıcı gönderir.
 * - Yanıtın altında Kopyala (düz metin) ve son yanıtta Yeniden sor; masaüstünde ⌘J / Ctrl+J açar ve kapatır.
 * - Etkin sohbet bu sekmede durur (sessionStorage, kullanıcıya özel anahtar); "Yeni sohbet" yenisini açar. Sunucuya yalnız
 *   önceki turların görünen metni gider (historyForRequest); sunucu hiçbir mesajı saklamaz.
 * - Yanıt akarak gelir (satır satır JSON): metin parça parça, araç çalışırken durum satırı ("Tedarikçi özeti…"),
 *   "Durdur" isteği keser. Yanıt güvenli markdown'la çizilir (markdown-view.tsx; HTML yok).
 * - Klavye: Esc kapatır (masaüstünde odak sayfadayken de), Enter gönderir, Shift+Enter yeni satır. Masaüstünde pencere
 *   modal değildir (sayfa kullanılabilir). Telefonda alt menü görünür ve kullanılabilir kalır (sekme etkin görünür),
 *   arkadaki sayfa ve üst çubuk etkisizdir (`inert`): odak yalnız asistanla alt menü arasında gezer; aria-modal yok.
 *   Başka bir ekrana geçilince (alt menü ya da yanıttaki bağlantı) telefondaki sayfa kapanır.
 * - Açılış odağı: masaüstünde yazı alanı; telefonda başlık (klavye kullanıcı alana dokununca açılır: iOS hareketsiz
 *   focus()'ta klavye açmaz, odak yine de bottom-nav.tsx'te "klavye açık" sayılır ve alt menü gizlenirdi). Kapanınca
 *   odak açan öğeye (sekme ya da düğme) döner.
 * - Karaoke "süre doldu" şeridi (z-70) varken telefondaki sayfa şeridin altından başlar (--alarm-h, globals.css).
 * - Telefon (390 ve 360 px): sayfa görünür alana oturur (--vvh yüksekliği, --vv-top üstü; bottom-nav.tsx yazar) ve alt
 *   menünün üstünde biter (--assistant-nav: alt menü + alt güvenli alan; klavye açıkken 0, alt menü de gizlenir): ekran
 *   klavyesi açıkken giriş kutusu klavyenin hemen üstünde kalır; üstte, solda ve sağda güvenli alan (çentik).
 *   "Göz yormasın": sayfa zemininde, kenarlık ve gölge yok; soru hafif zeminli bir blok, yanıt düz metin (16 px, geniş
 *   satır aralığı, koyu temada saf beyaz yerine bir ton kısık); dokunulan her düğme en az 44 px; yazı kutusu 16 px
 *   (iOS odakta yakınlaştırmasın).
 * - İşlemler (docs/ASISTAN-ISLEMLER.md): asistan risksiz bir işi onay kartıyla önerir (`card` olayı; op-card.tsx).
 *   Kart yanıtın altında durur; Onayla'ya basılmadıkça hiçbir şey değişmez. Kartların son durumu da sekmede saklanır ve
 *   sonraki sorunun geçmişine kısa bir satır olarak gider.
 */


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
        const followups = m.role === "assistant" ? restoreFollowups(m.followups) : undefined;
        // Takip bloğu yarım kalmış bir metin (sayfa akış sürerken yenilendi) bloksuz geri gelir
        const text = m.role === "assistant" ? splitFollowups(m.text).body : m.text;
        return {
          role: m.role,
          text,
          ...(m.role === "user" && m.deep === true ? { deep: true } : {}),
          ...(m.role === "user" && typeof m.photoId === "number" && Number.isInteger(m.photoId) && m.photoId > 0 ? { photoId: m.photoId } : {}),
          ...(m.failed ? { failed: true } : {}),
          ...(typeof m.note === "string" ? { note: m.note } : {}),
          ...(cards ? { cards } : {}),
          ...(followups ? { followups } : {}),
        };
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

/** Etkin sohbetin kimliği (geçmiş listesindeki kaydı; sekmede durur) */
function loadConversationId(userId: number): string {
  try {
    const v = window.sessionStorage.getItem(`${storageKey(userId)}.id`);
    if (v && /^[a-z0-9-]{1,64}$/i.test(v)) return v;
  } catch {
    // Depo kapalı
  }
  return newConversationId();
}

/** Cihazdaki geçmişin deposu (localStorage; yoksa ya da kapalıysa null) */
function localStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Günün sınırı dolunca kapının metni (sunucudaki aiErrorText("cap", …, "asistan") ile aynı) */
const capText = (cap: number) => `Bugünkü soru sınırı doldu (${cap || ASSISTANT_DAILY_CAP}); yarın yeniden açılır.`;

/** Ekran okuyucu için bitiş duyurusu: yanıtın ilk cümlesi (markdown işaretleri atılarak, en çok 160 harf) */
function answerAnnouncement(text: string): string {
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Yanıt hazır";
  const first = (plain.match(/^.+?[.!?…](?=\s|$)/)?.[0] ?? plain).slice(0, 160);
  return `Yanıt hazır: ${first}`;
}

export function PanelAssistant({ userId, branch }: { userId: number; branch?: string }) {
  const open = useAssistantOpen();
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(userId));
  /** Etkin sohbetin geçmişteki kimliği; "Yeni sohbet" yenisini açar */
  const [convId, setConvId] = useState(() => (typeof window === "undefined" ? "" : loadConversationId(userId)));
  /** Geçmiş listesi: açılınca cihazdan okunur */
  const [view, setView] = useState<"chat" | "history">("chat");
  const [history, setHistory] = useState<Conversation[]>([]);
  /** Açılıştaki mesajlar: yalnız sonradan değişince geçmişe yazılır (açmak sırayı değiştirmesin) */
  const initialMessages = useRef(messages);
  const [input, setInput] = useState("");
  /** Derin analiz anahtarı: varsayılan kapalı, bir soru için açılır (gönderince kapanır; 2 soru sayılır) */
  const [deep, setDeep] = useState(false);
  /** Sesle sorunun kısa notu (izin yok, mikrofon yok…) */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  /**
   * Sohbete eklenen fiş fotoğrafı (docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı): yüklenip okunur, yazı kutusunun üstünde
   * durur ve kaldırılana, kartı yapılana ya da yeni sohbete kadar her soruyla gider (sunucu okumasını mesaja ekler)
   */
  const [receipt, setReceipt] = useState<{ id: number; text: string } | null>(null);
  const receiptRef = useRef(receipt);
  useEffect(() => {
    receiptRef.current = receipt;
  }, [receipt]);
  const photo = usePhotoUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [announce, setAnnounce] = useState("");
  const sheet = useMediaQuery("(width < 64rem)");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Asistanı açan öğe (telefonda alt menünün sekmesi, masaüstünde düğme): kapanınca odak ona döner */
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Akan yanıtın metni (bitişte ekran okuyucuya ilk cümlesi okunur) */
  const lastText = useRef("");
  const titleId = useId();

  useEffect(() => saveMessages(userId, messages), [userId, messages]);

  useEffect(() => {
    try {
      if (convId) window.sessionStorage.setItem(`${storageKey(userId)}.id`, convId);
    } catch {
      // Depo kapalı
    }
  }, [userId, convId]);

  // Cihazdaki geçmiş (history.ts): yanıt bitince etkin sohbet listenin başına yazılır (yalnız görünen metin, kartın özeti)
  useEffect(() => {
    if (busy || !convId || messages === initialMessages.current) return;
    const store = localStore();
    saveHistory(store, userId, upsertConversation(loadHistory(store, userId), convId, messages));
  }, [userId, convId, messages, busy]);

  // Açılınca: durum (anahtar, ayar, bugün kalan) sorulur; kapalı ya da sınırdaysa her açılışta yeniden (gece yarısı açılır)
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

  const close = useCallback(() => setAssistantOpen(false), []);

  // Açılınca (düğme ya da alt menünün sekmesi): durum sorulur (kapalı ya da sınırdaysa her açılışta yeniden; gece
  // yarısı sayfa yenilenmeden açılır)
  const gateRef = useRef(gate);
  useEffect(() => {
    gateRef.current = gate;
  }, [gate]);
  useEffect(
    () =>
      onAssistantOpened(() => {
        if (!gateRef.current || gateRef.current.state !== "on") void loadGate();
      }),
    [loadGate],
  );

  useEffect(() => {
    if (!open) {
      // Kapandı: odak sayfada kaybolmasın, açan öğeye döner (masaüstündeki düğme yeniden çizilince)
      if (!wasOpen.current) return;
      wasOpen.current = false;
      const t = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const back = openerRef.current?.isConnected ? openerRef.current : triggerRef.current;
        back?.focus();
      });
      return () => cancelAnimationFrame(t);
    }
    wasOpen.current = true;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Telefonda yazı alanına değil başlığa: klavye kendiliğinden açılmasın, onay kartı ve çipler örtülmesin
    const t = requestAnimationFrame(() => (sheet ? headingRef.current?.focus() : inputRef.current?.focus()));
    return () => cancelAnimationFrame(t);
    // Yalnız açılış ve kapanışta (genişlik değişince odak taşınmaz)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Telefonda başka bir ekrana geçilince (alt menü, yanıttaki bağlantı) sayfa kapanır; masaüstünde pencere açık kalır
  useEffect(() => {
    if (sheet) setAssistantOpen(false);
    // Yalnız adres değişince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Telefonda sayfa açıkken arkadaki içerik ve üst çubuk etkisiz: odak ve ekran okuyucu yalnız asistanla alt menüde.
  // Sonradan belirebilen yüzen katmanlar (hatırlatma kartı) ve "İçeriğe geç" bağlantısı <html data-assistant="sheet">
  // ile gizlenir (`in-data-[assistant=sheet]:hidden`; reminder-alerts.tsx, panel/layout.tsx): Tab görünmeyene gitmez
  useEffect(() => {
    if (!open || !sheet) return;
    const root = document.documentElement;
    const behind = [document.getElementById("icerik"), document.querySelector<HTMLElement>("[data-mobile-top]")].filter((el): el is HTMLElement => !!el);
    for (const el of behind) el.inert = true;
    root.dataset.assistant = "sheet";
    return () => {
      for (const el of behind) el.inert = false;
      delete root.dataset.assistant;
    };
  }, [open, sheet]);

  // Masaüstünde ⌘J / Ctrl+J asistanı açar ve kapatır (telefonda alt menünün sekmesi; klavye kısayolu yok)
  useEffect(() => {
    if (sheet) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "j" || e.defaultPrevented) return;
      e.preventDefault();
      toggleAssistant();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  // Masaüstünde pencere modal değil: odak sayfadayken de Esc kapatır (telefonda panelin kendi onKeyDown'ı)
  useEffect(() => {
    if (!open || sheet) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Açık bir menü, pencere ya da açılır liste Esc'i önce kendisi kullanır
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]')) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, sheet, close]);

  // Yeni metin gelince sona kaydır (kullanıcı yukarıda okumuyorsa). Boş sohbet (karşılama ve öneriler) baştan görünür
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!messages.length) el.scrollTop = 0;
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages, tool, open, view]);

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

  /** Bir kartın durumunu değiştirir (hangi mesajda olursa olsun); fişin kartı yapılınca fiş sohbetten kalkar */
  const patchCard = useCallback((next: OpCardState) => {
    setMessages((list) => list.map((m) => (m.cards?.some((c) => c.card.id === next.card.id) ? { ...m, cards: m.cards.map((c) => (c.card.id === next.card.id ? next : c)) } : m)));
    if (next.status === "done" && next.card.photoId && next.card.photoId === receiptRef.current?.id) setReceipt(null);
  }, []);

  /** Fiş fotoğrafı seçildi: küçültülür, yüklenir ve okunur (kasanın fiş okuması; önce ucuz model) */
  const pickReceipt = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || photo.busy) return;
    setAnnounce("Fiş fotoğrafı yükleniyor");
    const r = await photo.upload(file, { kind: "fis", day: businessDate(), read: true });
    if (!r) {
      setAnnounce("Fiş fotoğrafı eklenemedi");
      return;
    }
    const reading = r.reading?.kind === "fis" ? r.reading : null;
    setReceipt({ id: r.photo.id, text: receiptChipText(reading, r.readError) });
    setAnnounce("Fiş fotoğrafı eklendi; gönderince asistan kartı hazırlar");
  };

  /**
   * Soruyu gönderir. `base`: soruların ekleneceği konuşma (Yeniden sor'da son soru ve yanıtı çıkmış hâli; geçmiş de
   * ondan kurulur: aynı soru iki kez gitmez). `opts.deep`: anahtar yerine bu (Yeniden sor, sorunun kendi seçimi)
   */
  const send = async (text: string, base: ChatMessage[] = messages, opts: { deep?: boolean } = {}) => {
    // Fiş eklenmişse soru yazılmadan da gider ("Bu fişi kaydet."); fiş her soruyla gider (kaldırılana ya da kartı yapılana dek)
    const attached = receiptRef.current;
    const question = text.trim() || (attached ? RECEIPT_DEFAULT_MESSAGE : "");
    if (!question || busy || photo.busy || (gate && gate.state !== "on")) return;
    const history = historyForRequest(base);
    // Derin analiz yalnız bu soru için (yanlışlıkla iki kat hak harcanmasın); hak yetmiyorsa olağan soru gider
    const asDeep = (opts.deep ?? deep) && deepAllowed;
    setMessages([...base, { role: "user", text: question, ...(asDeep ? { deep: true } : {}), ...(attached ? { photoId: attached.id } : {}) }, { role: "assistant", text: "" }]);
    setInput("");
    setDeep(false);
    setBusy(true);
    setTool(null);
    setAnnounce("Asistan yanıtlıyor");
    const controller = new AbortController();
    abortRef.current = controller;
    let ended = false;
    const fail = (message: string, keepText = true) => {
      ended = true;
      patchLast((m) => {
        const body = keepText ? splitFollowups(m.text).body : "";
        return { ...m, text: body, failed: !keepText || !body.trim(), note: message };
      });
      setAnnounce(message);
    };
    lastText.current = "";
    const handle = (e: AssistantEvent) => {
      if (e.type === "text") {
        lastText.current += e.text;
        patchLast((m) => ({ ...m, text: m.text + e.text }));
      }
      else if (e.type === "tool") setTool(e.label);
      else if (e.type === "card") {
        patchLast((m) => ({ ...m, cards: [...(m.cards ?? []), { card: e.card, status: "pending" }] }));
        setAnnounce("Onay kartı hazır: kontrol edip Onayla'ya basın");
      }
      else if (e.type === "done") {
        ended = true;
        setTool(null);
        const note = DONE_NOTE[e.reason];
        // Takip önerileri yanıttan ayrılır: metin bloksuz kalır (geçmişe de böyle gider), sorular çip olur
        const split = splitFollowups(lastText.current);
        patchLast((m) => ({
          ...m,
          text: split.body,
          ...(split.followups.length ? { followups: split.followups } : {}),
          ...(note ? { note } : {}),
          ...(split.body.trim() || m.cards?.length ? {} : { failed: true, note: note ?? "Yanıt boş geldi." }),
        }));
        if (e.left !== null) setGate((g) => (g ? { ...g, left: e.left!, ...(e.left! <= 0 ? { state: "cap", message: capText(g.cap) } : {}) } : g));
        setAnnounce(answerAnnouncement(split.body));
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
        // Açık ekran: yalnız yol, adresteki ?ay / ?gun ve ekranın şubesi (page-context.ts); sunucu bağlamın sonuna tek satır
        // yazar, araçlar o şubeyle okur
        body: JSON.stringify({
          message: question,
          history,
          page: pageFromLocation(window.location.pathname, window.location.search, branch) ?? undefined,
          ...(asDeep ? { deep: true } : {}),
          ...(attached ? { photo: { id: attached.id } } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string; code?: string; left?: number } | null;
        // Fiş artık eklenemiyor (süresi doldu, başka kayda bağlandı): çipi kaldır, soru sayılmadı
        if (body?.code === "photo") setReceipt(null);
        // deep_cap: derin analize hak yetmedi, kapı açık kalır (olağan soru sorulabilir)
        if (body?.code && ["nokey", "off", "cap"].includes(body.code)) setGate({ state: body.code as Gate["state"], left: body.left ?? 0, cap: gate?.cap ?? 0, message: body.error ?? null });
        // Kalan hak güncellenir: anahtar kapanır, Yeniden sor olağan soru olarak gider
        else if (body?.code === "deep_cap" && typeof body.left === "number") setGate((g) => (g ? { ...g, left: body.left! } : g));
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
        if (!ended)
          patchLast((m) => {
            const body = splitFollowups(m.text).body;
            return { ...m, text: body, note: DONE_NOTE.aborted, ...(body.trim() ? {} : { failed: true }) };
          });
        setAnnounce("Durduruldu");
      } else fail(e instanceof Error && e.name === "TypeError" ? "Asistana ulaşılamadı. İnterneti kontrol edip yeniden deneyin." : "Yanıt alınamadı. Yeniden deneyin.");
    } finally {
      abortRef.current = null;
      setBusy(false);
      setTool(null);
    }
  };

  const stop = () => abortRef.current?.abort();

  /**
   * Yeniden sor: son soru yeniden gider (son soru ve yanıtı konuşmadan çıkar; yeni bir soru sayılır). Derin analizle
   * sorulduysa yine derin gider (hak yetmiyorsa olağan). Yanıtında onay kartı olan soruda düğme yok (canRetry): kart
   * ekrandan sessizce kalkmasın, aynı iş için ikinci kart hazırlanmasın.
   */
  const retry = () => {
    const at = messages.findLastIndex((m) => m.role === "user");
    if (at < 0 || busy) return;
    void send(messages[at].text, messages.slice(0, at), { deep: messages[at].deep === true });
  };

  /** Kopyala: yanıtın düz metni panoya (bağlantının yalnız etiketi, işaretsiz) */
  const [copied, setCopied] = useState<number | null>(null);
  const copy = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(markdownToPlain(text));
      setCopied(i);
      setAnnounce("Yanıt kopyalandı");
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 2000);
    } catch {
      setAnnounce("Kopyalanamadı");
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConvId(newConversationId());
    setView("chat");
    setInput("");
    setReceipt(null);
    photo.reset();
    inputRef.current?.focus();
  };

  const showHistory = () => {
    setHistory(loadHistory(localStore(), userId));
    setView((v) => (v === "history" ? "chat" : "history"));
  };

  const openConversation = (c: Conversation) => {
    if (busy) return;
    const restored = fromStored(c);
    // Yalnız açmak geçmişe yazmaz (sıra ve tarih değişmesin); yeni bir soru ya da yanıtla yazılır
    initialMessages.current = restored;
    setMessages(restored);
    setConvId(c.id);
    setView("chat");
  };

  const deleteConversation = (c: Conversation) => {
    const store = localStore();
    const list = removeConversation(loadHistory(store, userId), c.id);
    saveHistory(store, userId, list);
    setHistory(list);
    // Açık sohbet silindiyse ekrandan da gider (yoksa sıradaki yanıtta yeniden yazılırdı)
    if (c.id === convId) {
      abortRef.current?.abort();
      setMessages([]);
      setConvId(newConversationId());
    }
  };

  /**
   * Çipten (öneri, takip) soru: çip kaybolur, odak boşa (body) düşmesin. Masaüstünde yazı alanına; telefonda konuşma
   * listesine (klavye açılmasın, ekran okuyucu yanıtın yerinde kalsın)
   */
  const sendChip = (q: string) => {
    void send(q);
    requestAnimationFrame(() => (sheet ? listRef.current : inputRef.current)?.focus({ preventScroll: true }));
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
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
  const lowLeft = !!gate && gate.state === "on" && gate.left <= 10;
  /** Derin analize hak yetiyor mu (2 soru sayılır); kapının durumu bilinmiyorsa sunucu karar verir */
  const deepAllowed = !gate || gate.left >= ASSISTANT_DEEP_WEIGHT;
  const warning = tooLong || lowLeft;
  /** Yeniden sor yalnız son yanıtta; kapı açık, yanıt bitmiş ve yanıtta onay kartı yokken */
  const canRetry = (i: number) => i === messages.length - 1 && !blocked && !busy && !messages[i]?.cards?.length && messages.some((m) => m.role === "user");

  return (
    <>
      {/* Masaüstünün düğmesi. Telefon ve tablette hiç çizilmez: asistan alt menünün sekmesinden açılır */}
      {!open && !sheet ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setAssistantOpen(true)}
          aria-label="Panel asistanı"
          title="Panel asistanı (⌘J / Ctrl+J)"
          aria-keyshortcuts="Meta+J Control+J"
          aria-haspopup="dialog"
          className={cn(
            "no-print fixed right-6 bottom-(--assistant-bottom) z-[36] flex size-12 cursor-pointer items-center justify-center rounded-full bg-surface text-ink shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-1 ring-line-strong max-lg:hidden",
            "transition-[scale,bottom] duration-200 hover:scale-105 active:scale-95 motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40",
          )}
        >
          <Sparkles className="size-5 text-brand-500" aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={onPanelKey}
          data-scroll-lock={sheet || undefined}
          data-component="panel-assistant"
          className={cn(
            "no-print fixed z-[60] flex flex-col overflow-hidden bg-surface text-ink focus:outline-none",
            // Telefon ve tablet: tam ekran sayfa, görünür alana oturur ve alt menünün üstünde biter (--vvh, --vv-top,
            // --assistant-nav; klavye açıkken alt menü gizli, sayfa klavyenin üstünde biter); güvenli alan üstte ve
            // yanlarda (alttaki pay alt menünün içinde). Karaoke şeridi (z-70) varken onun altından başlar (--alarm-h).
            // Sayfa zemininde, kenarlık ve gölge yok
            "max-lg:inset-x-0 max-lg:top-[calc(var(--vv-top,0px)+var(--alarm-h,0px))] max-lg:bottom-auto max-lg:h-[calc(var(--vvh,100dvh)-var(--alarm-h,0px)-var(--assistant-nav,0px))]",
            "max-lg:bg-background max-lg:pt-[env(safe-area-inset-top)] max-lg:pr-[env(safe-area-inset-right)] max-lg:pl-[env(safe-area-inset-left)]",
            // Masaüstü: sağ altta 400 × 560 pencere
            "lg:right-6 lg:bottom-6 lg:h-[min(560px,calc(100dvh-3rem-var(--alarm-h,0px)))] lg:w-[400px] lg:rounded-2xl lg:shadow-[0_16px_48px_rgba(0,0,0,0.22)] lg:ring-1 lg:ring-line-strong",
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3 max-lg:gap-1 max-lg:border-b-0 max-lg:py-1.5 max-lg:pr-2 max-lg:pl-5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel max-lg:hidden">
              <Sparkles className="size-4 text-brand-500" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-[15px] leading-5 font-semibold focus:outline-none max-lg:text-[17px] max-lg:leading-6">
                Panel asistanı
              </h2>
              <p className="truncate text-[12px] leading-4 text-ink-mute max-lg:hidden">Panelin verisine bakar; onayınızla küçük işleri yapar</p>
            </div>
            <button
              type="button"
              onClick={showHistory}
              aria-label="Sohbet geçmişi"
              aria-pressed={view === "history"}
              title="Sohbet geçmişi"
              className={cn(
                "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-mute hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:size-11 pointer-coarse:size-11",
                view === "history" && "bg-panel text-ink",
              )}
            >
              <History className="size-4 max-lg:size-5" aria-hidden="true" />
            </button>
            {messages.length ? (
              <button
                type="button"
                onClick={reset}
                title="Yeni sohbet"
                className="inline-flex h-8 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-mute hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:h-11 max-lg:text-[14px] pointer-coarse:h-11"
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

          <div ref={listRef} tabIndex={-1} aria-label="Konuşma" className="min-h-0 flex-1 space-y-4 overflow-y-auto focus:outline-none overscroll-contain px-4 py-4 max-lg:space-y-7 max-lg:px-5 max-lg:pt-2 max-lg:pb-6">
            {view === "history" ? (
              <HistoryList items={history} activeId={convId} onOpen={openConversation} onDelete={deleteConversation} onBack={() => setView("chat")} disabled={busy} />
            ) : (
              <>
                {!messages.length ? (
                  <div className="space-y-4 max-lg:space-y-5">
                    {/* Telefonda kısa (göz yormasın): iki cümle; ayrıntı masaüstünde ve bilgi tabanında */}
                    <p className="text-[14px] leading-6 text-ink-soft max-lg:hidden">
                      Merhaba! LafPOS gün sonları ve günlük satışlar, kasa, vardiya, Tükendi, bekleyen işler, ciro, kâr, tedarikçi borçları, ödemeler ve panelin
                      nasıl kullanıldığı hakkında sorabilirsiniz. Tükendi, fiyat, ödendi işareti, hatırlatıcı, vardiya gibi küçük işleri onay kartıyla hazırlarım:
                      siz Onayla&apos;ya basmadan hiçbir şey değişmez. Silme, toplu ve riskli işleri yapmam; onlarda ekranın bağlantısını ve adımları veririm.
                    </p>
                    <p className="text-[16px] leading-7 text-ink-soft lg:hidden" data-welcome-short>
                      Panelin verisine bakarım. Küçük işleri onay kartıyla hazırlarım; siz Onayla&apos;ya basmadan hiçbir şey değişmez.
                    </p>
                    {!blocked ? (
                      <div className="flex flex-wrap gap-2">
                        {suggestionsFor(pathname).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => sendChip(s)}
                            disabled={busy}
                            className="min-h-9 cursor-pointer rounded-full bg-panel px-3 py-1.5 text-left text-[13px] leading-5 text-ink-soft ring-1 ring-line hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-50 max-lg:min-h-11 max-lg:px-4 max-lg:text-[15px] max-lg:ring-0 pointer-coarse:min-h-11"
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
                    // Soru: hafif zeminli düz blok (balon yok); yanıt altında düz metin
                    <p key={i} data-turn="user" className="rounded-xl bg-panel px-3.5 py-2.5 text-[14px] leading-6 break-words whitespace-pre-wrap text-ink max-lg:text-[16px] max-lg:leading-7 dark:text-ink-soft">
                      {m.photoId ? (
                        // Fiş fotoğrafı: panelin yetkili yolundan; süresi dolmuşsa (2 gün, bağlanmadıysa) gizlenir
                        // eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz
                        <img
                          src={photoUrl(m.photoId)}
                          alt="Eklenen fiş fotoğrafı"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.hidden = true;
                          }}
                          className="mb-2 block h-20 w-auto max-w-32 rounded-lg object-cover ring-1 ring-line"
                        />
                      ) : null}
                      {m.text}
                      {m.deep ? (
                        <span className="mt-1 flex items-center gap-1 text-[12px] leading-4 font-medium text-ink-mute max-lg:text-[13px]">
                          <Brain className="size-3" aria-hidden="true" /> Derin analiz
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <div key={i} data-turn="assistant" className="space-y-2">
                      {m.text ? (
                        <MarkdownView
                          // Akarken sondaki takip bloğu (ve yarım "<tak") görünmez; bitince metin zaten bloksuzdur
                          text={busy && i === messages.length - 1 ? splitFollowups(m.text, true).body : m.text}
                          onNavigate={sheet ? close : undefined}
                          className={cn("max-lg:text-[16px] max-lg:leading-7 dark:text-ink-soft", m.failed && "text-ink-mute")}
                        />
                      ) : null}
                      {m.cards?.map((c) => <OpCardView key={c.card.id} state={c} onChange={patchCard} />)}
                      {/* Kopyala (her bitmiş yanıtta) ve Yeniden sor (yalnız son yanıtta, hata ya da kesintide de; kartlı
                          yanıtta yok); sade, ikincil renk */}
                  {!(busy && i === messages.length - 1) && ((m.text && !m.failed) || canRetry(i)) ? (
                    <div className="flex items-center gap-1 text-ink-mute" data-component="answer-actions">
                      {m.text && !m.failed ? (
                        <button
                          type="button"
                          onClick={() => void copy(i, m.text)}
                          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] font-medium hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:h-11 max-lg:px-2.5 max-lg:text-[13px] pointer-coarse:h-11"
                        >
                          {copied === i ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                          {copied === i ? "Kopyalandı" : "Kopyala"}
                        </button>
                      ) : null}
                      {canRetry(i) ? (
                        <button
                          type="button"
                          onClick={retry}
                          title="Son soruyu yeniden sorar (bir soru sayılır)"
                          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] font-medium hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:h-11 max-lg:px-2.5 max-lg:text-[13px] pointer-coarse:h-11"
                        >
                          <RefreshCw className="size-3.5" aria-hidden="true" /> Yeniden sor
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {/* Takip önerileri yalnız son yanıtın altında */}
                      {i === messages.length - 1 && !busy && m.followups?.length ? <FollowupChips items={m.followups} onPick={sendChip} disabled={blocked} /> : null}
                      {m.note ? <p className={cn("text-[12.5px] leading-5 max-lg:text-[14px] max-lg:leading-6", m.failed ? "text-warn-ink dark:text-brass-300" : "text-ink-mute")}>{m.note}</p> : null}
                    </div>
                  ),
                )}

                {busy ? (
                  <div className="flex items-center gap-2 text-[13px] text-ink-mute max-lg:text-[14px]" aria-hidden="true">
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
              </>
            )}
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>

          <div className="shrink-0 border-t border-line px-3 pt-2.5 pb-3 max-lg:border-t-0 max-lg:px-4 max-lg:pt-1 max-lg:in-data-[keyboard=open]:pb-2">
            {blocked ? (
              <p className="mb-2 rounded-xl bg-panel px-3 py-2 text-[13px] leading-5 text-ink-soft max-lg:text-[15px] max-lg:leading-6">{gate?.message ?? "Asistan şu an kapalı."}</p>
            ) : null}
            {voiceNote ? (
              <p className="mb-1.5 px-1 text-[13px] leading-5 text-warn-ink max-lg:text-[14px] dark:text-brass-300" role="status">
                {voiceNote}
              </p>
            ) : null}
            {/* Fiş fotoğrafı: yüklenirken aşama, eklenince küçük resim ve okunan (her soruyla gider; Kaldır çıkarır) */}
            {photo.phase.kind !== "idle" ? <PhotoStatus phase={photo.phase} className="mb-1.5 px-1" /> : null}
            {receipt ? (
              <div className="mb-1.5 flex items-center gap-2.5 rounded-xl bg-panel px-2.5 py-2" data-receipt-chip>
                {/* eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz */}
                <img src={photoUrl(receipt.id)} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-line" />
                <div className="min-w-0 flex-1 text-[13px] leading-5 max-lg:text-[14px]">
                  <p className="font-medium text-ink">Fiş eklendi</p>
                  <p className="truncate text-ink-mute">{receipt.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  aria-label="Fiş fotoğrafını kaldır"
                  title="Kaldır (fotoğraf kayda bağlanmaz)"
                  disabled={busy}
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-mute hover:bg-panel-deep hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-40 max-lg:size-11 pointer-coarse:size-11"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {!blocked ? (
              // Telefonda klavye açıkken gizli (yazı alanına yer kalsın), anahtar açıksa görünür (unutulmasın)
              <div className={cn("mb-1.5 flex items-center gap-2 px-0.5", !deep && "max-lg:in-data-[keyboard=open]:hidden")} data-deep-row>
                {/* Derin analiz: efor high, daha çok araç turu; günlük sınıra 2 soru sayılır (docs/ASISTAN.md) */}
                <button
                  type="button"
                  onClick={() => setDeep((v) => !v)}
                  aria-pressed={deep}
                  disabled={busy || !deepAllowed}
                  title={deepAllowed ? "Derin analiz: daha ayrıntılı bakar, daha uzun sürer (en çok ~55 sn; tur sayısını çoğu zaman süre sınırlar); 2 soru sayılır" : "Derin analiz için en az 2 soru hakkı gerekir"}
                  data-deep-toggle
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium ring-1 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:cursor-default disabled:opacity-50 max-lg:h-11 max-lg:px-3.5 max-lg:text-[14px] pointer-coarse:h-11",
                    deep ? "bg-ink text-on-solid ring-ink" : "text-ink-mute ring-line hover:text-ink",
                  )}
                >
                  <Brain className="size-3.5 max-lg:size-4" aria-hidden="true" />
                  Derin analiz
                </button>
                {deep ? <span className="text-[12px] leading-4 text-ink-mute max-lg:text-[13px]">Daha uzun sürer · 2 soru sayılır</span> : null}
              </div>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              {/* Fiş ya da fatura fotoğrafı: telefonda kamera ya da galeri (tarayıcının seçicisi); okunup kart hazırlanır */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Fiş fotoğrafı ekle"
                title="Fiş fotoğrafı ekle: okunur, asistan harcama ya da kasadan çıkan kartı hazırlar"
                disabled={blocked || busy || photo.busy}
                data-receipt-button
                className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-panel text-ink-mute hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              >
                {photo.busy ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Camera className="size-5" aria-hidden="true" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickReceipt(e)} />
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
                placeholder={blocked ? "" : receipt ? "Ne yapılsın? (boş bırakırsanız kartı hazırlanır)" : "Sorunuzu yazın…"}
                aria-invalid={tooLong || undefined}
                className="field-sizing-content max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-xl bg-panel px-3.5 py-2.5 text-[16px] leading-6 text-ink placeholder:text-ink-mute focus:ring-2 focus:ring-ink/25 focus:outline-none disabled:opacity-60 max-lg:in-data-[keyboard=open]:max-h-28 lg:text-[14px]"
              />
              {/* Sesle soru: yalnız telefonda ve tarayıcı destekliyorsa (yoksa düğme hiç çizilmez); metin kutuya yazılır */}
              {sheet ? <VoiceButton value={input} onChange={setInput} onNote={setVoiceNote} disabled={blocked || busy} /> : null}
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Durdur"
                  title="Durdur"
                  className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-panel text-ink ring-1 ring-line-strong hover:bg-panel-deep focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:ring-0"
                >
                  <Square className="size-4 fill-current" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Gönder"
                  title="Gönder (Enter)"
                  disabled={blocked || (!input.trim() && !receipt) || tooLong || photo.busy}
                  className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-on-primary hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                >
                  <ArrowUp className="size-5" aria-hidden="true" />
                </button>
              )}
            </form>
            {/* Telefonda yalnız uyarı varken (sınır, uzunluk): alt satır kalabalık etmesin; klavye açıkken yazı alanına yer */}
            <p className={cn("mt-1.5 px-1 text-[11.5px] leading-4 text-ink-mute max-lg:text-[13px] max-lg:leading-5", !warning && "max-lg:hidden")}>
              {tooLong
                ? `Soru en çok ${ASSISTANT_LIMITS.message.toLocaleString("tr-TR")} karakter olabilir (${input.length.toLocaleString("tr-TR")}).`
                : lowLeft
                  ? `Bugün ${gate!.left} soru hakkı kaldı. Önemli rakamları ekranda kontrol edin.`
                  : "Claude ile çalışır; önemli rakamları ekranda kontrol edin. Shift+Enter: yeni satır."}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
