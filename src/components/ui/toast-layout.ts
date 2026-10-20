/**
 * Bildirim balonlarının (sonner) yeri: saf fonksiyon (tests/toast-layout.test.ts).
 *
 * - Telefonda panelde (sm altı, alt menü varken) altta, alt menünün hemen üstünde: "Geri al" başparmağın
 *   yetiştiği yerde durur.
 * - Bir modal pencere açıkken üstte, ekranın kenarına yakın: telefonda alttan açılan sayfanın başlığını, tutamacını
 *   ve Kapat ✕ düğmesini örtmez (pencere ekranın en çok %92'si; üstte kalan şeride sığar).
 * - Ekran klavyesi açıkken ya da altta yüzen bir çubuk (kaydetme çubuğu, sayım çubuğu) varken üstte, üst çubuğun
 *   altında: klavyenin arkasında kalmaz, çubuğun düğmelerini örtmez.
 * - Tablette (lg altı) üst çubuğun (56px) altında, masaüstünde üstte 24px.
 */

export interface ToastScene {
  /** sm altı (640px) */
  phone: boolean;
  /** lg altı (1024px): telefon ve tablet kabuğunda üst çubuk görünür */
  belowLg: boolean;
  /** Panel kabuğu (alt menü ve üst çubuk) sayfada mı */
  shell: boolean;
  /** Açık modal pencere (<dialog>) var mı */
  modal: boolean;
  /** Ekran klavyesi açık mı (bottom-nav.tsx, html[data-keyboard]) */
  keyboard: boolean;
  /** Altta yüzen çubuk ([data-floating-bar], [data-bottom-bar]) var mı */
  bottomBar: boolean;
}

export interface ToastLayout {
  position: "top-center" | "bottom-center";
  offset: { top?: string; bottom?: string; left: string; right: string };
}

const SIDE = "16px";
/** Alt menü 64px + ana ekran çubuğu, üstünde 12px boşluk */
export const ABOVE_NAV_OFFSET = "calc(4rem + env(safe-area-inset-bottom, 0px) + 12px)";
/** Telefon ve tablette üst çubuk 56px, altında 8px */
export const BELOW_TOPBAR_OFFSET = "calc(64px + env(safe-area-inset-top, 0px))";
/** Modal pencere açıkken: ekranın üst kenarı */
export const SCREEN_EDGE_OFFSET = "calc(8px + env(safe-area-inset-top, 0px))";

export function toastLayout(s: ToastScene): ToastLayout {
  if (s.modal) {
    return { position: "top-center", offset: { top: s.phone ? SCREEN_EDGE_OFFSET : "16px", left: SIDE, right: SIDE } };
  }
  if (s.shell && s.phone && !s.keyboard && !s.bottomBar) {
    return { position: "bottom-center", offset: { bottom: ABOVE_NAV_OFFSET, left: SIDE, right: SIDE } };
  }
  if (s.shell && s.belowLg) {
    return { position: "top-center", offset: { top: BELOW_TOPBAR_OFFSET, left: SIDE, right: SIDE } };
  }
  return { position: "top-center", offset: { top: s.phone ? SIDE : "24px", left: SIDE, right: SIDE } };
}
