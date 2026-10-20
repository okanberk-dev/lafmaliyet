"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { BounceSidebarNav } from "@/components/akmanos/bounce-sidebar";
import { SegmentedLinks } from "@/components/ui/segmented";

import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";

const IDS: readonly string[] = SETTINGS_SECTIONS.map((s) => s.id);
const isSection = (id: string): id is SettingsSectionId => IDS.includes(id);

/**
 * Ayar bölümleri arasında gezinme. Geniş ekranda (xl) solda yapışkan AkmanOS "Bounce Sidebar": seçili
 * bölümün yanına nokta yaylı bir kavisle zıplar. Tablette içeriğin üstünde yapışkan, yatay kayan bölümlü şerit.
 * Telefonda şerit yok: bölümler kendi başlıklarıyla açılıp kapanan akordeon (section-card.tsx). Görünen bölüm IntersectionObserver ile izlenir; tıklanınca bölüme yumuşakça kayılır ve
 * kayma sürerken ara bölümler vurguyu oynatmasın diye izleme kısa süre bekletilir.
 *
 * Parça (fragment) döndürür: geniş ekranda ızgaranın ilk sütunu `aside`, şerit o boyutta gizlidir.
 */
export function SettingsNav() {
  const reduce = useCalmMotion();
  const [active, setActive] = useState<SettingsSectionId>(SETTINGS_SECTIONS[0].id);
  const locked = useRef(false);
  const lockToken = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);

  // Başka ekrandan ya da yer iminden #bölüm ile gelince bölüme kaydırmayı bölüm kartı yapar (section-card.tsx,
  // pin-scroll.ts): kartlar Suspense'ten sonra gelir, telefonda bölüm önce açılmalıdır

  // Görünen bölümü izle: üst çubuğun hemen altından ekranın ortasına kadarki bantta kalan ilk bölüm etkin
  useEffect(() => {
    const els = IDS.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const inBand = new Set<string>();
    // Sayfa kaydırılamayacak kadar kısaysa en üstte "en altta" sayılmasın
    const atBottom = () => window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const pick = () => {
      if (locked.current) return;
      // Sayfanın sonundaki kısa bölümler banda hiç girmeyebilir: en alta inilince sonuncusu seçilir
      if (atBottom()) return setActive(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id);
      const first = IDS.find((id) => inBand.has(id));
      if (first && isSection(first)) setActive(first);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    const onScroll = () => {
      if (!locked.current && atBottom()) pick();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Dar ekranda etkin parçayı şeridin ortasına kaydır
  useEffect(() => {
    const nav = rowRef.current?.querySelector("nav");
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    const n = nav.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    nav.scrollTo({ left: nav.scrollLeft + l.left - n.left - (n.width - l.width) / 2, behavior: reduce ? "auto" : "smooth" });
  }, [active, reduce]);

  function go(id: SettingsSectionId) {
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    const token = ++lockToken.current;
    locked.current = true;
    const release = () => {
      if (lockToken.current === token) locked.current = false;
    };
    window.addEventListener("scrollend", release, { once: true });
    window.setTimeout(release, 1200);
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
  }

  // Bağlantılar gerçek #çapa olarak kalır (yeni sekmede açma, kopyalama); düz tıklamada yumuşak kaydırma yapılır
  function onClickCapture(e: MouseEvent<HTMLElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    const id = a?.getAttribute("href")?.slice(1) ?? "";
    if (!isSection(id)) return;
    e.preventDefault();
    go(id);
  }

  return (
    <>
      <div
        ref={rowRef}
        onClickCapture={onClickCapture}
        className="no-print sticky top-(--mobile-top-h) z-20 -mx-4 mb-4 border-b border-line bg-background/90 px-4 py-2 backdrop-blur-md max-sm:hidden sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:hidden"
      >
        <SegmentedLinks
          label="Ayar bölümleri"
          value={active}
          options={SETTINGS_SECTIONS.map((s) => ({
            value: s.id,
            href: `#${s.id}`,
            label: (
              <>
                <s.icon size={14} aria-hidden="true" />
                {s.label}
              </>
            ),
          }))}
        />
      </div>

      <aside onClickCapture={onClickCapture} className="no-print hidden xl:block">
        <div className="sticky top-8 rounded-3xl bg-panel p-3">
          <p className="px-3 pt-1 pb-2.5 text-[13px] font-medium text-ink-mute">Bölümler</p>
          <BounceSidebarNav
            ariaLabel="Ayar bölümleri"
            value={active}
            onValueChange={(v) => isSection(v) && setActive(v)}
            items={SETTINGS_SECTIONS.map((s) => ({
              id: s.id,
              href: `#${s.id}`,
              label: s.label,
              icon: <s.icon size={16} strokeWidth={1.75} />,
            }))}
          />
        </div>
      </aside>
    </>
  );
}
