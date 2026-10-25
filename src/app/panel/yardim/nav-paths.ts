// Yardım sayfasının menü yolları ve Excel karşılıkları: kenar çubuğu ağacından (nav.ts) türer, el yazısı ad yok.
// Saf işlevler; testleri tests/yardim.test.ts.

import { NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor, SECTION_TABS } from "@/components/panel/nav";

const NAV_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER];

/** Bölüm sekmeleri (ilk sekme menü öğesinin kendi adresi) */
const TAB_LISTS: readonly (readonly { href: string; label: string }[])[] = Object.values(SECTION_TABS);

/**
 * Bir ekranın kenar çubuğundaki yolu, ör. "/panel/satislar" → ["Satış & gider", "Satışlar"]. Menüde ayrı öğesi
 * olmayan sekme menü öğesinin altında: "/panel/harcamalar" → ["Satış & gider", "Giderler & personel", "Aylık harcamalar"].
 */
export function pathOf(href: string): string[] {
  for (const n of NAV_TREE) {
    if (n.href === href) return [n.label];
    const c = n.children?.find((ch) => ch.href === href);
    if (c) return [n.label, c.label];
  }
  for (const tabs of TAB_LISTS) {
    const i = tabs.findIndex((t) => t.href === href);
    // i > 0: ilk sekme zaten menü öğesinin adresi (yukarıda bulunur), özyineleme döngüye girmez
    if (i > 0) {
      const parent = pathOf(tabs[0].href);
      return parent.length ? [...parent, tabs[i].label] : [];
    }
  }
  return [];
}

const fold = (s: string) => s.toLocaleLowerCase("tr-TR");

/**
 * Ekranın Excel karşılığı. Sekmeli ekranlarda menü öğesinin Excel adı ("Sabit Giderler + Personel") parçalara
 * bölünür, her sekme adıyla başlayan parçayı alır (Tutarlılık → "Tutarlılık Kontrolü"); parçası olmayan sekme
 * (Aylık harcamalar) yenidir. Sıra ya da sekme sayısı eşleşmeyi bozmaz.
 */
export function excelFor(href: string): string | undefined {
  for (const tabs of TAB_LISTS) {
    const tab = tabs.find((t) => t.href === href);
    if (!tab) continue;
    const parts = NAV_ITEMS.find((n) => n.href === tabs[0].href)?.excel?.split(" + ") ?? [];
    return parts.find((p) => fold(p).startsWith(fold(tab.label)));
  }
  return NAV_ITEMS.find((n) => n.href === href)?.excel;
}

/** Aynı menü öğesinin altındaki sekmeler (Giderler & personel → Sabit giderler, Aylık harcamalar, Personel) */
export const tabsOf = (href: string) => TAB_LISTS.find((tabs) => tabs[0].href === href);

// ---------------------------------------------------------------- Personelin menü yolları (personel Yardım'ı)

/**
 * Personelin menüsünde ayrı öğesi olmayan ekranları: hangi ekrandan açıldıkları ve oradaki adları. Kasadaki fiyatlar
 * Bugün'deki satırdan (ve zilden), Geçmiş Kontrol listeleri'nin sekmesinden, Sipariş taslağı Hızlı sayım'ın üst
 * bilgisinden açılır. Hesabım profil menüsündedir (kenar çubuğunun altında adınıza dokununca).
 */
const STAFF_SUBPAGES: readonly { href: string; via: string; label: string }[] = [
  { href: "/panel/kasa/fiyatlar", via: "/panel/bugun", label: "Kasadaki fiyatlar" },
  { href: "/panel/kontrol/gecmis", via: "/panel/kontrol", label: "Geçmiş" },
  { href: "/panel/hizli-sayim/siparis", via: "/panel/hizli-sayim", label: "Sipariş taslağı" },
];

/**
 * Bir ekranın personelin kenar çubuğundaki yolu, ör. "/panel/hizli-sayim" → ["Stok", "Hızlı sayım"]. Personelin
 * ağacından (navTreeFor("staff"); tek alt sayfası kalan grup doğrudan o sayfa: Reçete defteri üst düzeyde) kurulur;
 * yöneticinin adları ve ekranları hiç girmez. Adresin ?sorgu ve #çapa kısmı atılır. Personelin açamadığı ya da
 * menüde bulunmayan ekran için boş dizi (personel Yardım'ının testi her yolun dolu olduğunu denetler).
 */
export function staffPathOf(href: string): string[] {
  const path = href.replace(/[?#].*$/, "");
  if (path === "/panel/hesap") return ["Hesabım"];
  for (const n of navTreeFor("staff")) {
    if (n.href === path) return [n.label];
    const c = n.children?.find((ch) => ch.href === path);
    if (c) return [n.label, c.label];
  }
  const sub = STAFF_SUBPAGES.find((s) => s.href === path);
  if (sub) {
    const parent = staffPathOf(sub.via);
    return parent.length ? [...parent, sub.label] : [];
  }
  return [];
}
