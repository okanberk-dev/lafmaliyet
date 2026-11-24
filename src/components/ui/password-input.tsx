"use client";

import { AnimatePresence, motion, type Transition } from "motion/react";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";

import { cn } from "@/lib/utils";

import { fieldControl } from "./form";
import { useCalmMotion } from "./motion";
import {
  eyePath,
  LASHES,
  LID_CLOSED,
  LID_OPEN,
  morphGlyphs,
  passwordLevel,
  STRENGTH_LEVELS,
  toggleLabel,
  TOGGLE_LABELS,
  type StrengthLevel,
} from "./password-input-core";

/**
 * Parola kutusu (rare-ui password-input'tan uyarlandı): göz düğmesi kapağını açıp kapar, göster / gizle anında
 * noktalar harflere (ya da harfler noktalara) dönüşür; yeni parola alanlarında altta parola gücü. Panel uyarlaması:
 *
 * Güvenlik (parola DOM'a yazılmaz):
 * - Alan gerçek bir <input> ve React'e `value` olarak verilmez: React denetlenen alanın değerini `value`
 *   özniteliğine de yazar (DOM'u okuyan her betik ve eklenti görür). Değer yalnız alanın kendi `value`
 *   özelliğinde durur; dışarıdan verilen değer (`value`) etkide özelliğe yazılır.
 * - rare-ui harfleri gizliyken de DOM'da (opacity 0) tutar; burada gizliyken hiç karakter çizilmez, yalnız nokta.
 *   Harfler yalnız "Parolayı göster" açıkken, geçişin kısa anında çizilir; sonra alanın kendi yazısı görünür.
 * - `name`, `id`, `autoComplete` olduğu gibi alana geçer: parola yöneticisi, otomatik doldurma, form gönderimi aynı.
 *
 * Yazarken her şey tarayıcının kendi alanı (imleç, seçim, yapıştırma, Türkçe klavye); süslü katman yalnız geçişte.
 * Sunucu HTML'i, hidrasyon ve hareket azaltmada (`useCalmMotion`) geçiş anlıktır. Göz düğmesi 44 px (dokunmatik),
 * "Parolayı göster" / "Parolayı gizle", `aria-pressed`. Parola gücü (`strength`) yalnız yeni parola alanında:
 * "Parola gücü" + Zayıf / Orta / İyi / Güçlü (panelin `passwordProblem` kuralıyla uyumlu), yeri baştan ayrılır
 * (yazınca altındaki öğeler kaymaz).
 */

const INSTANT: Transition = { duration: 0 };
const LID: Transition = { type: "spring", stiffness: 500, damping: 34 };
const BAR: Transition = { type: "spring", stiffness: 520, damping: 32 };
const ROLL: Transition = { type: "spring", stiffness: 520, damping: 32 };
const SWAP = 0.18;
// geçişte harfler soldan sağa dalga gibi; uzun parolada toplam süre sınırlı
const STAGGER = 0.012;
const MAX_STAGGER = 0.15;
const MORPH_MS = Math.round((SWAP + MAX_STAGGER) * 1000) + 40;

type MorphBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  letterSpacing: string;
  color: string;
  scroll: number;
};

type Morph = { key: number; to: "show" | "hide"; glyphs: { char: string | null }[]; box: MorphBox };

/** Alanın yazı kutusu (dolgu ve kenarlık içi), yazı tipi ve kaydırması: geçiş katmanı tam üstüne oturur */
function measure(el: HTMLInputElement): MorphBox {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const left = px(cs.paddingLeft) + px(cs.borderLeftWidth);
  const right = px(cs.paddingRight) + px(cs.borderRightWidth);
  const top = px(cs.paddingTop) + px(cs.borderTopWidth);
  const bottom = px(cs.paddingBottom) + px(cs.borderBottomWidth);
  return {
    left: el.offsetLeft + left,
    top: el.offsetTop + top,
    width: Math.max(0, el.offsetWidth - left - right),
    height: Math.max(0, el.offsetHeight - top - bottom),
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
    color: cs.color,
    scroll: el.scrollLeft,
  };
}

/**
 * Geçiş katmanı: her karakterin yerinde bir nokta; gösterirken nokta küçülüp söner, harf belirir. Gizlerken
 * (`to: "hide"`) yalnız noktalar büyüyerek gelir, harf çizilmez.
 */
export function PasswordMorph({ to, glyphs, box }: Omit<Morph, "key">) {
  const advance = `calc(1ch + ${box.letterSpacing})`;
  return (
    <span
      aria-hidden="true"
      data-slot="password-morph"
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, fontFamily: box.fontFamily, fontSize: box.fontSize, fontWeight: box.fontWeight, color: box.color }}
    >
      <span className="absolute inset-y-0 left-0 flex items-center whitespace-pre" style={{ transform: `translateX(${-box.scroll}px)` }}>
        {glyphs.map((g, i) => {
          const delay = Math.min(i * STAGGER, MAX_STAGGER);
          return (
            <span key={i} className="relative grid h-full shrink-0 place-items-center" style={{ width: advance }}>
              <motion.span
                data-slot="password-morph-dot"
                className="absolute size-[0.34em] rounded-full bg-current"
                initial={to === "show" ? { scale: 1, opacity: 1 } : { scale: 0.3, opacity: 0 }}
                animate={to === "show" ? { scale: 0.3, opacity: 0 } : { scale: 1, opacity: 1 }}
                transition={{ duration: SWAP, delay, ease: "easeOut" }}
              />
              {g.char !== null ? (
                <motion.span
                  data-slot="password-morph-char"
                  className="whitespace-pre"
                  initial={{ opacity: 0, scale: 0.6, y: "0.2em" }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: SWAP, delay, ease: [0.22, 1, 0.36, 1] }}
                >
                  {g.char}
                </motion.span>
              ) : null}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Gözün kapağı açılır (parola görünür) ya da kapanıp kirpikleri iner (gizli) */
function Eye({ open, calm }: { open: boolean; calm: boolean }) {
  const clipId = useId();
  const lid = { d: eyePath(open ? LID_OPEN : LID_CLOSED) };
  const transition = calm ? INSTANT : LID;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="size-5 overflow-visible">
      <clipPath id={clipId}>
        <motion.path initial={false} animate={lid} transition={transition} />
      </clipPath>
      <circle cx={12} cy={12} r={3} clipPath={`url(#${clipId})`} />
      <motion.path initial={false} animate={lid} transition={transition} />
      {LASHES.map((d) => (
        <motion.path
          key={d}
          d={d}
          initial={false}
          animate={{ pathLength: open ? 0 : 1, opacity: open ? 0 : 1 }}
          transition={calm ? INSTANT : { duration: 0.2, delay: open ? 0 : 0.08 }}
        />
      ))}
    </svg>
  );
}

function StrengthMeter({ id, level, calm }: { id: string; level: StrengthLevel; calm: boolean }) {
  const entry = level > 0 ? STRENGTH_LEVELS[level - 1] : null;
  return (
    <div id={id} data-slot="password-strength" data-level={level} className="flex flex-col gap-1.5 pt-1">
      <div className="flex gap-1" aria-hidden="true">
        {STRENGTH_LEVELS.map((step, i) => (
          <span key={step.label} className="h-1 flex-1 overflow-hidden rounded-full bg-panel-deep">
            <motion.span
              initial={false}
              animate={{ scaleX: i < level ? 1 : 0 }}
              transition={calm ? INSTANT : { ...BAR, delay: i * 0.04 }}
              className={cn("block h-full origin-left rounded-full transition-colors", entry?.bar)}
            />
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs leading-4">
        <span className="text-ink-mute" aria-hidden="true">
          Parola gücü
        </span>
        <span aria-live="polite" className="relative flex h-4 justify-end overflow-hidden font-medium text-ink-soft">
          <AnimatePresence initial={false} mode="popLayout">
            {entry ? (
              <motion.span
                key={level}
                initial={calm ? false : { y: "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={calm ? { opacity: 0, transition: INSTANT } : { y: "-100%", opacity: 0 }}
                transition={calm ? INSTANT : ROLL}
              >
                <span className="sr-only">Parola gücü: </span>
                {entry.label}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>
      </div>
    </div>
  );
}

export type PasswordInputProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "ref"> & {
  ref?: Ref<HTMLInputElement | null>;
  /** Dışarıdan tutulan değer (yazıldıkça `onChange`); alanın özelliğine yazılır, özniteliğine yazılmaz */
  value?: string;
  /** Göster / gizle dışarıdan (ör. iki alan tek düğmeyle) */
  visible?: boolean;
  defaultVisible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  /** Göz düğmesi (false: başka alanın düğmesi yönetir) */
  toggle?: boolean;
  toggleLabels?: { show: string; hide: string };
  toggleClassName?: string;
  /** Parola gücü: yalnız yeni parola alanında; e-posta verilirse parolada geçmesi de "Zayıf" sayılır */
  strength?: boolean | { email?: string | null };
  /** Panelin alan görünümü (Input) yerine yalnız `className` (giriş kartı) */
  plain?: boolean;
  /** Alanın hemen ardından (kardeş) çizilir: içerideki etiket (peer) için */
  after?: ReactNode;
  wrapperClassName?: string;
};

export function PasswordInput({
  ref,
  value,
  visible,
  defaultVisible = false,
  onVisibleChange,
  toggle = true,
  toggleLabels = TOGGLE_LABELS,
  toggleClassName,
  strength = false,
  plain = false,
  after,
  wrapperClassName,
  className,
  id,
  disabled,
  onChange,
  "aria-describedby": describedBy,
  ...props
}: PasswordInputProps) {
  const calm = useCalmMotion();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement, []);
  const meterId = useId();

  const [ownVisible, setOwnVisible] = useState(defaultVisible);
  const shown = visible ?? ownVisible;
  const [typed, setTyped] = useState("");
  const text = value ?? typed;
  const [morph, setMorph] = useState<Morph | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const mounted = useRef(false);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // Dışarıdan verilen değer alanın özelliğine (özniteliğe değil); aynıysa dokunulmaz, imleç yerinde kalır. İlk
  // bağlanışta alan sayfa yüklenirken doldurulduysa (otomatik doldurma, hidrasyondan önce yazılan) silinmez, değer
  // dışarıya bildirilir
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || value === undefined) return;
    if (!mounted.current && value === "" && el.value !== "") {
      onChangeRef.current?.({ target: el, currentTarget: el } as unknown as ChangeEvent<HTMLInputElement>);
    } else if (el.value !== value) el.value = value;
  }, [value]);
  useEffect(() => {
    mounted.current = true;
  }, []);

  // Tür değişince (password ↔ text) bazı tarayıcılar seçimi sıfırlar: geri konur
  useLayoutEffect(() => {
    const el = input.current;
    const saved = selection.current;
    selection.current = null;
    if (el && saved && document.activeElement === el) el.setSelectionRange(saved.start, saved.end);
  }, [shown]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Düğmeyle görünürlük değişimi: geçiş katmanı yalnız hareket serbestken ve alan doluyken (dışarıdan değişen anlık) */
  function startMorph(next: boolean) {
    const el = input.current;
    window.clearTimeout(timer.current);
    if (!el || calm || !el.value) return setMorph(null);
    const to = next ? "show" : "hide";
    setMorph({ key: Date.now(), to, glyphs: morphGlyphs(el.value, to), box: measure(el) });
    timer.current = window.setTimeout(() => setMorph(null), MORPH_MS);
  }

  function flip() {
    const el = input.current;
    if (el && document.activeElement === el) selection.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
    const next = !shown;
    startMorph(next);
    if (visible === undefined) setOwnVisible(next);
    onVisibleChange?.(next);
  }

  function change(e: ChangeEvent<HTMLInputElement>) {
    // yazarken geçiş katmanı kalkar (eski karakterleri göstermez)
    if (morph) {
      window.clearTimeout(timer.current);
      setMorph(null);
    }
    if (value === undefined) setTyped(e.target.value);
    onChange?.(e);
  }

  const meter = strength ? (typeof strength === "object" ? strength : {}) : null;
  const level = meter ? passwordLevel(text, meter.email) : 0;
  const describedByAll = [describedBy, meter ? meterId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="password-input" data-visible={shown} className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <div className="relative">
        <input
          ref={input}
          id={id}
          {...props}
          type={shown ? "text" : "password"}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={describedByAll}
          onChange={change}
          data-morph={morph ? "" : undefined}
          className={cn(
            plain ? null : cn(fieldControl, "h-9 pointer-coarse:h-11"),
            "font-mono [&::-ms-reveal]:hidden",
            toggle && "pr-12",
            className,
            // geçiş boyunca alanın kendi yazısı saydam (katman onun yerinde), imleç görünür kalır
            morph && "text-transparent caret-ink [-webkit-text-fill-color:transparent]",
          )}
        />
        {after}
        {morph ? <PasswordMorph key={morph.key} to={morph.to} glyphs={morph.glyphs} box={morph.box} /> : null}
        {toggle ? (
          <button
            type="button"
            data-slot="password-input-toggle"
            aria-label={toggleLabel(shown, toggleLabels)}
            aria-pressed={shown}
            aria-controls={id}
            disabled={disabled}
            // odak alanda kalır (telefonda klavye kapanmaz)
            onPointerDown={(e) => e.preventDefault()}
            onClick={flip}
            className={cn(
              "absolute top-1/2 right-0 flex h-full max-h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-ink-mute outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50",
              toggleClassName,
            )}
          >
            <Eye open={shown} calm={calm} />
          </button>
        ) : null}
      </div>
      {meter ? <StrengthMeter id={meterId} level={level} calm={calm} /> : null}
    </div>
  );
}

export default PasswordInput;
