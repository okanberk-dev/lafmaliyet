"use client";

import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { markUrlWritten } from "./keep-scroll";
import { initialQueryText, markQueryTextWritten, syncQueryText, typeQueryText } from "./query-text";

/**
 * Süzgeç araçları. Durum adres çubuğunda tutulur (?ara=sut&durum=odenmedi): sayfa yenilenince ve bağlantı
 * paylaşılınca korunur. Yazma `history.replaceState` ile yapılır; sunucuya istek gitmez, geçmiş kirlenmez
 * (Next useSearchParams bunu izler).
 *
 * Dikkat: süzgeç adrese yazıldıktan sonra çağrılan bir sunucu eylemi, yenilemede sayfayı başa kaydırırdı (Next son
 * sunucu çiziminin arama metnini yeni adresle karşılaştırır). Yazma `markUrlWritten()` ile bildirilir; o sayfadaki
 * eylemler kaydırma konumunu kendiliğinden korur (keep-scroll.ts). Eylemden sonra bilerek kaydıran sayfa önce
 * `releaseScroll()` çağırır.
 */

export { keepScroll, markUrlWritten, releaseScroll, useSettleScroll } from "./keep-scroll";

function writeParam(key: string, value: string, fallback: string) {
  const url = new URL(window.location.href);
  if (!value || value === fallback) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  if (url.href === window.location.href) return;
  window.history.replaceState(null, "", url);
  markUrlWritten();
}

/** Tek bir süzgeç değeri (seçim, sekme, sıralama…). Varsayılan değer adreste yazılmaz. */
// NoInfer: tür verilmezse `string` olur ("" varsayılanı T'yi "" türüne kilitlemesin)
export function useQueryState<T extends string = string>(key: string, fallback: NoInfer<T>): [T, (value: T) => void] {
  const params = useSearchParams();
  const value = (params.get(key) as T | null) ?? fallback;
  const set = useCallback((v: T) => writeParam(key, v, fallback), [key, fallback]);
  return [value, set];
}

/**
 * Arama metni: yazarken hemen süzülür, adrese 250 ms sonra yazılır (imleç kaymaz, yazılan geri ezilmez).
 *
 * Adres dışarıdan değişirse (geri tuşu, "Temizle", başka sayfadan dönüş) kutu da güncellenir. Kendi yazdığımız
 * değerin adrese yansıması kutuyu ezmez (o sırada kullanıcı yazmayı sürdürüyor olabilir); bu yansıma bir kez
 * tüketilir. Next 16 (cacheComponents) önceki sayfayı gizli tutar: ürün kartı açıkken gizli liste kartın adresini
 * görür (arama yok, kutu boşalır), "← Ürünler" ile dönünce ?ara=mocha yeniden okunur ve kutu dolar.
 * Eşitleme kuralları query-text.ts'te (saf fonksiyonlar, testli).
 */
export function useQueryText(key = "ara"): [string, (value: string) => void] {
  const params = useSearchParams();
  const fromUrl = params.get(key) ?? "";
  const [state, setState] = useState(() => initialQueryText(fromUrl));
  const synced = syncQueryText(state, fromUrl);
  // Çizim sırasında durum güncellemesi (React'in önerdiği "önceki değeri izle" kalıbı): adres değiştiyse hemen
  if (synced !== state) setState(synced);
  const text = synced.text;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const set = useCallback(
    (v: string) => {
      setState((s) => typeQueryText(s, v));
      if (timer.current) clearTimeout(timer.current);
      const path = window.location.pathname;
      timer.current = setTimeout(() => {
        // Bu arada başka sayfaya geçildiyse o sayfanın adresine yazılmaz
        if (window.location.pathname !== path) return;
        const w = v.trim() ? v : "";
        if ((new URL(window.location.href).searchParams.get(key) ?? "") === w) return;
        setState((s) => markQueryTextWritten(s, w));
        writeParam(key, w, "");
      }, 250);
    },
    [key],
  );
  return [text, set];
}

/** Bir anda birden fazla süzgeci sıfırlar */
export function clearQuery(keys: string[]) {
  const url = new URL(window.location.href);
  for (const k of keys) url.searchParams.delete(k);
  if (url.href === window.location.href) return;
  window.history.replaceState(null, "", url);
  markUrlWritten();
}

/** Türkçe büyük/küçük harf ve aksan duyarsız arama için normalleştirme ("Süt" ~ "sut") */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Sorgunun her sözcüğü metinde geçiyorsa eşleşir ("sut 1l" → "Sütaş Süt 1 L"… değil, "Süt 1L" evet) */
export function matches(haystack: string, query: string): boolean {
  const q = fold(query).trim();
  if (!q) return true;
  const h = fold(haystack);
  return q.split(/\s+/).every((w) => h.includes(w));
}

/**
 * Arama kutusu: büyüteç, temizle (×) düğmesi, Esc ile temizleme, "/" ile odaklanma (bir alanda yazmıyorken).
 */
export function SearchField({
  value,
  onChange,
  placeholder = "Ara",
  label,
  className,
  inputClassName,
  shortcut = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Ekran okuyucu etiketi (yoksa placeholder) */
  label?: string;
  className?: string;
  /** Alanın kendisine ek sınıf (ör. yükseklik) */
  inputClassName?: string;
  /** "/" kısayolu (sayfada tek arama kutusu varken) */
  shortcut?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-quiet" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-9 w-full rounded-xl bg-surface pr-10 pl-9 sm:pr-16 text-base text-ink ring-1 ring-line-strong outline-none ring-inset placeholder:text-ink-quiet focus:ring-2 focus:ring-ink/60 sm:text-sm pointer-coarse:h-11 pointer-coarse:pr-11 pointer-coarse:text-base [&::-webkit-search-cancel-button]:hidden",
          inputClassName,
        )}
      />
      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 pointer-coarse:right-0">
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            // Dokunmatikte alanın yüksekliği kadar (44px) dokunma alanı
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-ink-quiet hover:bg-ink/[0.05] hover:text-ink pointer-coarse:size-11 pointer-coarse:rounded-xl"
            aria-label="Aramayı temizle"
          >
            <X size={14} />
          </button>
        ) : shortcut ? (
          <kbd className="hidden rounded-md bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-mute ring-1 ring-line ring-inset sm:block" aria-hidden="true">
            /
          </kbd>
        ) : null}
      </div>
    </div>
  );
}

/** Aç/kapa süzgeç çipi ("Yalnız ödenmemiş", "Paraşüt'ten") */
export function FilterChip({
  active,
  onToggle,
  children,
  count,
  className,
}: {
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Bu süzgece uyan kayıt sayısı (isteğe bağlı) */
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap ring-1 transition-colors ring-inset pointer-coarse:h-11",
        active ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-soft ring-line-strong hover:text-ink hover:ring-ink/30",
        className,
      )}
    >
      {children}
      {count !== undefined ? <span className={cn("tabular", active ? "text-on-solid/70" : "text-ink-quiet")}>{count}</span> : null}
    </button>
  );
}

/**
 * Süzgeç satırı: solda arama ve süzgeçler, etkin süzgeç varsa "Temizle", sağda "12 / 40 kayıt" (ekran okuyucuya
 * duyurulur). Telefonda alt alta sarılır, yatay taşma olmaz.
 */
export function FilterBar({
  children,
  active,
  onClear,
  shown,
  total,
  unit = "kayıt",
  className,
}: {
  children: ReactNode;
  /** Varsayılandan farklı süzgeç var mı */
  active: boolean;
  onClear: () => void;
  shown?: number;
  total?: number;
  unit?: string;
  className?: string;
}) {
  return (
    <div role="search" className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {active ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-ink-mute hover:bg-ink/[0.05] hover:text-ink pointer-coarse:h-11"
        >
          <X size={14} aria-hidden /> Temizle
        </button>
      ) : null}
      {total !== undefined ? (
        <p className="ml-auto text-[13px] whitespace-nowrap text-ink-mute tabular" aria-live="polite">
          {shown !== undefined && shown !== total ? (
            <>
              <span className="font-semibold text-ink">{shown}</span> / {total} {unit}
            </>
          ) : (
            <>
              {total} {unit}
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
