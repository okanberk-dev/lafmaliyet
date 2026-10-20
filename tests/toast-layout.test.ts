// Bildirim balonlarının yeri (components/ui/toast-layout.ts): telefonda alt menünün üstünde, pencere açıkken
// ekranın üst kenarında, tablette üst çubuğun altında.
// Çalıştırma: npx tsx --test tests/toast-layout.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { ABOVE_NAV_OFFSET, BELOW_TOPBAR_OFFSET, SCREEN_EDGE_OFFSET, toastLayout, type ToastScene } from "../src/components/ui/toast-layout";

const phone: ToastScene = { phone: true, belowLg: true, shell: true, modal: false, keyboard: false, bottomBar: false };
const tablet: ToastScene = { ...phone, phone: false };
const desktop: ToastScene = { ...phone, phone: false, belowLg: false };

test("Telefonda panelde altta, alt menünün üstünde ('Geri al' başparmağın yetiştiği yerde)", () => {
  const l = toastLayout(phone);
  assert.equal(l.position, "bottom-center");
  assert.equal(l.offset.bottom, ABOVE_NAV_OFFSET);
});

test("Pencere (alttan açılan sayfa) açıkken üstte, ekranın kenarında: sayfanın başlığını örtmez", () => {
  const l = toastLayout({ ...phone, modal: true });
  assert.equal(l.position, "top-center");
  assert.equal(l.offset.top, SCREEN_EDGE_OFFSET);
  // Masaüstünde pencere ortada; bildirim üstte 16px
  assert.equal(toastLayout({ ...desktop, modal: true }).offset.top, "16px");
});

test("Klavye açıkken ya da altta yüzen çubuk varken üst çubuğun altında", () => {
  for (const s of [{ ...phone, keyboard: true }, { ...phone, bottomBar: true }]) {
    const l = toastLayout(s);
    assert.equal(l.position, "top-center");
    assert.equal(l.offset.top, BELOW_TOPBAR_OFFSET);
  }
});

test("Tablette (600–1023px dahil) üst çubuğu örtmez; masaüstünde üstte 24px", () => {
  assert.deepEqual(toastLayout(tablet), { position: "top-center", offset: { top: BELOW_TOPBAR_OFFSET, left: "16px", right: "16px" } });
  assert.equal(toastLayout(desktop).offset.top, "24px");
});

test("Panel dışındaki sayfalarda (giriş, QR menü) telefonda üstte", () => {
  const l = toastLayout({ ...phone, shell: false });
  assert.equal(l.position, "top-center");
  assert.equal(l.offset.top, "16px");
});
