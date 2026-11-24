"use client";

import { Fragment, useId, useState } from "react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";

import { LafTile } from "@/components/brand";
import { useCalmMotion } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

/**
 * Sohbet görünümlü sık sorulanlar (rare-ui faq'tan uyarlandı): soru solda balon; dokununca cevap sağda, L'Af
 * karosunun yanında balon olarak gelir, alttaki sorular yaylı kayar. Panel uyarlaması:
 * - Renkler panelin belirteçlerinden: kapalı soru beyaz kuyu (surface), açık soru siyah (panelin etkin durumu), cevap
 *   L'Affogato yeşilinin açığı (brand-100). Koyu temada belirteçler kendiliğinden döner.
 * - Sunucu HTML'inde her soru düğme olarak var (sayfa içi arama, çapa); kapalı cevap DOM'da yok.
 * - Sunucu HTML'i ve hidrasyon hareketsiz (`useCalmMotion`); hareket azaltma tercihinde balonlar zıplamaz, kaymaz.
 * - Klavye: ↑ ↓ sorular arasında (sonda başa döner), Home / End ilk ve son soru; Enter / boşluk açar, kapatır.
 * - Dokunma alanı en az 44 px. Odak halkası panelin ortak halkası (globals.css); balonun köşeleri satır içi stilde,
 *   çünkü ortak halka kuralı katmansız ve köşe yarıçapını sınıfın önünde ezerdi.
 */

const SEND: Transition = { type: "spring", visualDuration: 0.42, bounce: 0.24 };
const SHIFT: Transition = { type: "spring", visualDuration: 0.4, bounce: 0.1 };
const LEAVE: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] };
const INSTANT: Transition = { duration: 0 };

// sorunun kuyruğu sol altta, cevabınki sağ altta (L'Af karosuna doğru)
const QUESTION_RADIUS = "18px 18px 18px 6px";
const ANSWER_RADIUS = "18px 18px 6px 18px";

const QUESTION = '[data-slot="faq-question"]';

/** Klavyeyle gidilecek sorunun sırası; gezinme tuşu değilse ya da soru yoksa null */
export function stepTo(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const next =
    key === "ArrowDown" ? index + 1 : key === "ArrowUp" ? index - 1 : key === "Home" ? 0 : key === "End" ? last : null;
  return next === null ? null : (next + count) % count;
}

/** Çapadaki soru (#claude) hangi grupta: o grubun açık sorusu olarak; bilinmeyen ya da bozuk çapada null */
export function openFor(groups: readonly { title: string; items: readonly { id: string }[] }[], hash: string): Record<string, string> | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (!id) return null;
  const group = groups.find((g) => g.items.some((i) => i.id === id));
  return group ? { [group.title]: id } : null;
}

export type FaqChatItem = {
  id: string;
  question: string;
  answer: ReactNode;
  /** Sorunun başındaki küçük konu ikonu (lucide glifi) */
  icon?: ReactNode;
};

type BubbleProps = {
  item: FaqChatItem;
  ids: { question: string; answer: string };
  open: boolean;
  openId: string | null;
  calm: boolean;
  anchors: boolean;
};

function Question({ item, ids, open, openId, calm, anchors, onToggle }: BubbleProps & { onToggle: () => void }) {
  return (
    <motion.button
      id={ids.question}
      type="button"
      data-slot="faq-question"
      aria-expanded={open}
      aria-controls={open ? ids.answer : undefined}
      onClick={onToggle}
      // her balon bir cevap açılınca yeniden ölçülür: alttakiler kayar
      layout={calm ? false : "position"}
      layoutDependency={openId}
      transition={calm ? INSTANT : SHIFT}
      style={{ borderRadius: QUESTION_RADIUS }}
      className={cn(
        "flex min-h-11 max-w-[88%] cursor-pointer items-start gap-2.5 self-start px-3.5 py-2.5 text-left text-sm leading-5 font-medium text-pretty transition-[background-color,color,box-shadow,scale] duration-200 active:scale-[0.98] sm:max-w-[80%]",
        anchors && "scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-4",
        open ? "bg-ink text-on-solid shadow-soft" : "bg-surface text-ink shadow-soft ring-1 ring-line hover:ring-line-strong",
      )}
    >
      {item.icon != null && (
        <span aria-hidden="true" className={cn("mt-0.5 shrink-0 [&>svg]:size-4", open ? "text-on-solid/70" : "text-ink-mute")}>
          {item.icon}
        </span>
      )}
      <span className="min-w-0">{item.question}</span>
    </motion.button>
  );
}

function Answer({ item, ids, open, openId, calm }: BubbleProps) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {open && (
        <motion.div
          key="cevap"
          data-slot="faq-answer"
          layout={calm ? false : "position"}
          layoutDependency={openId}
          initial={{ opacity: 0, scale: 0.65, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, transition: calm ? INSTANT : LEAVE }}
          transition={calm ? INSTANT : SEND}
          // balon L'Af karosunun köşesinden büyür
          style={{ originX: 1, originY: 1 }}
          className="flex items-end justify-end gap-2"
        >
          <div
            id={ids.answer}
            role="region"
            aria-labelledby={ids.question}
            style={{ borderRadius: ANSWER_RADIUS }}
            className="max-w-[88%] min-w-0 bg-brand-100 px-4 py-3 text-sm leading-6 text-pretty text-ink-soft sm:max-w-[80%]"
          >
            {item.answer}
          </div>
          <span aria-hidden="true" data-slot="faq-avatar" className="mb-0.5 shrink-0">
            <LafTile className="size-7 rounded-full shadow-soft" />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type FaqChatProps = Omit<ComponentProps<"div">, "defaultValue" | "onKeyDown"> & {
  items: FaqChatItem[];
  /** Açık sorunun kimliği; verilirse dışarıdan yönetilir */
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  /** Sorunun kimliği sayfada çapa olur (/panel/yardim#claude); sayfada aynı kimlik bir kez geçmeli */
  anchors?: boolean;
};

export function FaqChat({ items, value, defaultValue = null, onValueChange, anchors = false, className, ...props }: FaqChatProps) {
  const calm = useCalmMotion();
  const uid = useId();
  const [own, setOwn] = useState(defaultValue);
  const openId = value === undefined ? own : value;

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(QUESTION)) return;
    const questions = [...event.currentTarget.querySelectorAll<HTMLElement>(QUESTION)];
    const next = stepTo(event.key, questions.indexOf(target), questions.length);
    if (next === null) return;
    event.preventDefault();
    questions[next]?.focus();
  };

  return (
    <div data-slot="faq-chat" onKeyDown={onKeyDown} className={cn("relative flex w-full flex-col gap-2", className)} {...props}>
      {items.map((item) => {
        const bubble: BubbleProps = {
          item,
          ids: { question: anchors ? item.id : `${uid}-${item.id}-soru`, answer: `${uid}-${item.id}-cevap` },
          open: openId === item.id,
          openId,
          calm,
          anchors,
        };
        return (
          <Fragment key={item.id}>
            <Question {...bubble} onToggle={() => toggle(item.id)} />
            <Answer {...bubble} />
          </Fragment>
        );
      })}
    </div>
  );
}

export default FaqChat;
