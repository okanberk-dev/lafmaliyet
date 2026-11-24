// Hareketli arayüz parçaları, bölüm 2 (rare-ui'den uyarlandı): bildirim zili (ui/notification-bell.tsx), bildirim
// kartının ikon karosu (ui/toast-icon.tsx, toaster.tsx, globals.css) ve parola kutusu (ui/password-input.tsx). Saf
// hesaplar, sunucu HTML'i (parola DOM'a yazılmaz) ve kullanıldıkları yerler.
// Çalıştırma: npx tsx --test tests/zil-bildirim-sifre.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { generatePassword } from "../src/app/panel/kullanicilar/access";
import { badgeText } from "../src/components/panel/nav";
import { badgeOf, bellLabel, ringVelocity } from "../src/components/ui/notification-bell-core";
import { morphGlyphs, passwordLevel, STRENGTH_LEVELS, toggleLabel } from "../src/components/ui/password-input-core";
import { TONE_LABEL, TONE_TILE } from "../src/components/ui/notice";
import { TOAST_PREFIX, TOAST_TILE } from "../src/components/ui/toast-icon";
import { passwordProblem } from "../src/lib/password-rules";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

async function html(load: () => Promise<unknown>, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  return renderToStaticMarkup(createElement((await load()) as never, props as never));
}

/** rare-ui'nin sabit renkleri ve izleri: uyarlanan dosyalarda geçmez */
const RARE_UI = /#FC4C01|#F4F4F9|#262626|#868593|#9B9AA7|#FF3B30|#FF453A|#34C759|#30D158|#FF9500|#007AFF|#1C1C1E|#2C2C2E|figma-squircle|@radix-ui\/react-slot|asChild/i;

// ---------------------------------------------------------------- Zil

test("zil rozeti: 0 / geçersiz değerde yok, 9'dan fazlası 9+ (alt menünün rozetiyle aynı)", () => {
  for (const n of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(badgeOf(n), null, String(n));
  assert.equal(badgeOf(null), null);
  assert.deepEqual(badgeOf(1), { value: 1, plus: false });
  assert.deepEqual(badgeOf(9), { value: 9, plus: false });
  assert.deepEqual(badgeOf(10), { value: 9, plus: true });
  assert.deepEqual(badgeOf(3.7), { value: 3, plus: false });
  for (let n = -1; n <= 120; n++) {
    const b = badgeOf(n);
    assert.equal(b ? `${b.value}${b.plus ? "+" : ""}` : null, badgeText(n), String(n));
  }
});

test("zil etiketi Türkçe: 'Bildirimler, N okunmamış'", () => {
  assert.equal(bellLabel(0), "Bildirimler");
  assert.equal(bellLabel(null), "Bildirimler");
  assert.equal(bellLabel(3), "Bildirimler, 3 okunmamış");
  assert.equal(bellLabel(12), "Bildirimler, 12 okunmamış");
});

test("zil yalnız sayı artınca sallanır: ilk okuma, azalma ve aynı kalma sessiz; hız sınırlı", () => {
  assert.equal(ringVelocity(null, 4), null, "ilk okuma (sayfa açılışı) çalmaz");
  assert.equal(ringVelocity(4, null), null);
  assert.equal(ringVelocity(4, 4), null);
  assert.equal(ringVelocity(4, 2), null);
  const one = ringVelocity(0, 1)!;
  const many = ringVelocity(0, 5)!;
  const flood = ringVelocity(0, 50)!;
  assert.ok(one !== null && Math.abs(one) > 0);
  assert.ok(Math.abs(many) > Math.abs(one), "çok bildirim daha güçlü");
  assert.equal(Math.abs(flood), Math.abs(many), "beşten sonrası aynı güçte");
  assert.ok(Math.abs(ringVelocity(0, 5, 850)!) <= 900, "en çok 900°/s");
  assert.ok(ringVelocity(1, 2, 200)! > 0, "sallanan zil aynı yöne itilir");
});

test("zil sunucu HTML'i: düğme 44 px, rozet süs (aria-hidden), etiket dışarıdan verilebilir, sayı yokken rozet yok", async () => {
  const load = async () => (await import("../src/components/ui/notification-bell")).NotificationBell;
  const three = await html(load, { count: 3 });
  assert.match(three, /^<button type="button" data-slot="notification-bell" aria-label="Bildirimler, 3 okunmamış"/);
  assert.match(three, /class="[^"]*\bsize-11\b/);
  const badge = three.match(/<span[^>]*data-slot="notification-bell-badge"[^>]*>/)?.[0] ?? "";
  assert.match(badge, /aria-hidden="true"/);
  assert.match(three, /<svg[^>]*aria-hidden="true"/);
  const loading = await html(load, { count: null, "aria-label": "Bildirimler yükleniyor" });
  assert.match(loading, /aria-label="Bildirimler yükleniyor"/);
  assert.doesNotMatch(loading, /notification-bell-badge/);
  assert.doesNotMatch(await html(load, { count: 0 }), /notification-bell-badge/);
});

test("zil panelin menüsünde: tetik NotificationBell, sayı okunana kadar null, menü / sayım / etiket aynı", () => {
  const menu = read("src/components/panel/notifications.tsx");
  assert.match(menu, /import \{ NotificationBell \} from "@\/components\/ui\/notification-bell";/);
  assert.match(menu, /<NotificationBell\s+ref=\{triggerRef\}\s+count=\{items === null \? null : unread\}\s+onClick=\{toggle\}/);
  assert.match(menu, /aria-haspopup="true"\s+aria-expanded=\{open\}\s+aria-controls=\{open \? menuId : undefined\}/);
  assert.match(menu, /aria-label=\{items === null \? \(failure \? "Bildirimler okunamadı" : "Bildirimler yükleniyor"\) : unread > 0 \? `Bildirimler, \$\{unread\} okunmamış` : "Bildirimler"\}/);
  assert.doesNotMatch(menu, /\bBell\b[,\s]/, "lucide Bell yerine zil bileşeni");
  const bell = read("src/components/ui/notification-bell.tsx");
  assert.doesNotMatch(bell, RARE_UI);
  assert.doesNotMatch(bell, /Notifications|unread"/, "İngilizce etiket yok");
  assert.match(bell, /useCalmMotion\(\)/);
  assert.match(bell, /<AnimatedCounter value=\{badge\.value\}/, "rozetin rakamı kayan sayaçla döner");
  // Sesler ve kaynaklar değişmedi: zil yalnız görünüm
  assert.doesNotMatch(bell, /Audio|sound|fetch\(/);
});

// ---------------------------------------------------------------- Bildirim kartı

test("bildirim karosu: renkler uyarıların tablosundan, ekran okuyucu öneki uyarılarla aynı, bilgi mavi değil", () => {
  assert.equal(TOAST_TILE.success, TONE_TILE.good);
  assert.equal(TOAST_TILE.error, TONE_TILE.bad);
  assert.equal(TOAST_TILE.warning, TONE_TILE.warn);
  assert.equal(TOAST_TILE.info, TONE_TILE.neutral);
  assert.doesNotMatch(TOAST_TILE.info, /info|blue|sky/);
  assert.deepEqual(TOAST_PREFIX, { success: TONE_LABEL.good, error: TONE_LABEL.bad, warning: TONE_LABEL.warn, info: TONE_LABEL.neutral, loading: null });
});

test("bildirim karosu sunucuda / ilk çizimde: süs karo, çizilecek işaret, dönen halka; önek ekran okuyucuya", async () => {
  const load = async () => (await import("../src/components/ui/toast-icon")).ToastIcon;
  const ok = await html(load, { type: "success" });
  assert.match(ok, /^<span class="sr-only">Tamam: <\/span><span aria-hidden="true" data-slot="toast-icon" data-type="success"/);
  assert.match(ok, /class="[^"]*\bsize-9\b[^"]*rounded-\[11px\]/);
  assert.match(ok, /<path d="M6 12.5l4 4 8-9" pathLength="1" data-draw=""/);
  const err = await html(load, { type: "error" });
  assert.equal(err.match(/data-draw=""/g)?.length, 2, "✕ iki çizgi");
  const spin = await html(load, { type: "loading" });
  assert.doesNotMatch(spin, /sr-only/);
  assert.match(spin, /data-spin=""/);
});

test("bildirim kartı: her toast.* çağrısı karoyu sonner'ın icons'ıyla alır; kapat düğmesi Türkçe; eski köşe sınıfı yok", () => {
  const toaster = read("src/components/ui/toaster.tsx");
  assert.match(toaster, /import \{ TOAST_ICONS \} from "\.\/toast-icon";/);
  assert.match(toaster, /icons=\{TOAST_ICONS\}/);
  assert.match(toaster, /closeButtonAriaLabel: "Bildirimi kapat"/);
  assert.match(toaster, /"position" \| "offset" \| "mobileOffset" \| "icons"/, "karo dışarıdan ezilmez");
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /<TopLayerToaster closeButton \/>/);
  // Çağıranlar sonner'dan doğrudan toast kullanmaya devam eder (API değişmedi)
  assert.match(read("src/app/panel/hesap/password-form.tsx"), /import \{ toast \} from "sonner";/);
  for (const f of ["src/components/ui/toast-icon.tsx", "src/components/ui/toaster.tsx"]) assert.doesNotMatch(read(f), RARE_UI, f);
  assert.doesNotMatch(read("package.json"), /figma-squircle|@radix-ui\/react-slot/);
});

test("bildirim kartının biçimi: 21 px köşe (karo 11 + dolgu 10), panelin gölgesi, hareket azaltmada işaret çizili ve duruk", () => {
  const css = read("src/app/globals.css");
  const card = css.slice(css.indexOf("/* ── Bildirim kartı"), css.indexOf("/* ── Bildirim balonları"));
  assert.ok(card.length > 0);
  assert.match(card, /\[data-sonner-toast\]\[data-styled="true"\] \{\s*gap: 12px;\s*padding: 10px 14px 10px 10px;\s*border-radius: 21px;\s*box-shadow: var\(--shadow-lift\);/);
  assert.match(card, /\[data-icon\] \{\s*width: 36px;\s*height: 36px;/);
  assert.match(card, /\[data-description\] \{[^}]*color: var\(--color-ink-mute\);/);
  assert.match(card, /@keyframes laf-toast-draw \{\s*to \{\s*stroke-dashoffset: 0;/);
  assert.match(card, /\[data-laf-spun\] \[data-slot="toast-icon"\]:not\(\[data-type="loading"\]\) \{\s*animation: laf-toast-bump/);
  assert.match(card, /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-slot="toast-icon"\],\s*\[data-slot="toast-icon"\] \* \{\s*animation: none !important;\s*\}\s*\[data-slot="toast-icon"\] \[data-draw\] \{\s*stroke-dashoffset: 0;/);
  assert.doesNotMatch(card, /#[0-9a-f]{3,8}\b/i, "renkler belirteçten");
  // Dokunmatikte eylem düğmesi 44 px kuralı yerinde (bu bloktan sonra gelir, onu ezer)
  assert.ok(css.indexOf("@media (pointer: coarse) {\n  [data-sonner-toaster]") > css.indexOf("/* ── Bildirim kartı"));
});

// ---------------------------------------------------------------- Parola kutusu

test("parola gücü: boş 0; panelin kuralına takılan Zayıf; çeşit ve uzunlukla Orta / İyi / Güçlü", () => {
  assert.deepEqual(
    STRENGTH_LEVELS.map((l) => l.label),
    ["Zayıf", "Orta", "İyi", "Güçlü"],
  );
  assert.equal(passwordLevel(""), 0);
  for (const weak of ["1234", "password1", "12345678", "Parola2024", "laffogato99", "aaaaaaaa"]) assert.equal(passwordLevel(weak), 1, weak);
  assert.equal(passwordLevel("okanberk-2024!", "okanberk@ornek.com"), 1, "e-postayı içeren");
  assert.equal(passwordLevel("kahvemakinesi"), 2);
  assert.equal(passwordLevel("Kahvemakinesi"), 3);
  assert.equal(passwordLevel("aB3$xY9!"), 3);
  assert.equal(passwordLevel("Kahve.Makinesi7"), 4);
  assert.equal(passwordLevel("Çiçekşöğüt-ılgaz"), 4, "Türkçe büyük / küçük harf, işaret, 16 karakter");
  assert.equal(passwordLevel("çiçekşöğüt-ılgaz"), 3);
  for (let i = 0; i < 20; i++) assert.equal(passwordLevel(generatePassword()), 4, "'Güçlü parola oluştur' güçlü sayılır");
  // Sunucunun reddettiği parola hiçbir zaman Zayıf'tan yukarı çıkmaz; kabul ettiği hiçbir zaman Zayıf değil
  for (const p of ["Galatasaray1905", "şifre2024", "qwertyui", "Abcdefgh", "kahve-latte-42", "Mavi.Deniz.7", "x".repeat(201)]) {
    assert.equal(passwordLevel(p) === 1, passwordProblem(p) !== null, p);
  }
});

test("geçiş katmanı: gizlerken gerçek karakter hiç yok, yalnız nokta; gösterirken her karakter kendi yerinde", () => {
  assert.deepEqual(morphGlyphs("Ab1", "hide"), [{ char: null }, { char: null }, { char: null }]);
  assert.deepEqual(morphGlyphs("Ab1", "show"), [{ char: "A" }, { char: "b" }, { char: "1" }]);
  assert.equal(morphGlyphs("şü☕️x", "hide").length, Array.from("şü☕️x").length);
  assert.equal(toggleLabel(false), "Parolayı göster");
  assert.equal(toggleLabel(true), "Parolayı gizle");
});

const SECRET = "Gizli-Kahve-42x";

test("parola kutusunun sunucu HTML'i: değer hiçbir yerde yok (value özniteliği de yok), alan password, göz düğmesi Türkçe", async () => {
  const load = async () => (await import("../src/components/ui/password-input")).PasswordInput;
  const hidden = await html(load, { id: "pw-n", name: "next", autoComplete: "new-password", value: SECRET, onChange: () => {} });
  assert.ok(!hidden.includes(SECRET));
  for (const part of SECRET.split("-")) assert.ok(!hidden.includes(part), part);
  assert.doesNotMatch(hidden, /<input[^>]*\svalue=/, "React value özniteliği yazmaz");
  const field = hidden.match(/<input [^>]*>/)?.[0] ?? "";
  for (const attr of ['id="pw-n"', 'name="next"', 'autoComplete="new-password"', 'type="password"', 'spellCheck="false"']) assert.ok(field.includes(attr), attr);
  assert.match(hidden, /<button type="button" data-slot="password-input-toggle" aria-label="Parolayı göster" aria-pressed="false" aria-controls="pw-n"/);
  assert.match(hidden, /data-slot="password-input-toggle"[^>]*class="[^"]*\bw-11\b/, "göz düğmesi 44 px geniş");
  assert.doesNotMatch(hidden, /password-strength/, "giriş alanında parola gücü yok");

  const shown = await html(load, { id: "x", value: SECRET, visible: true, onChange: () => {} });
  assert.match(shown, /type="text"/);
  assert.match(shown, /aria-label="Parolayı gizle" aria-pressed="true"/);
  assert.ok(!shown.includes(SECRET), "görünürken de değer yalnız alanın özelliğinde, HTML'de değil");

  const withMeter = await html(load, { id: "sp-new", value: "kahvemakinesi", strength: { email: "a@b.co" }, "aria-describedby": "pw-hint", onChange: () => {} });
  assert.match(withMeter, /data-slot="password-strength" data-level="2"/);
  assert.match(withMeter, /Parola gücü/);
  assert.match(withMeter, /<span class="sr-only">Parola gücü: <\/span>Orta/);
  const meterId = withMeter.match(/<div id="([^"]+)" data-slot="password-strength"/)?.[1];
  assert.ok(meterId);
  assert.ok(withMeter.includes(`aria-describedby="pw-hint ${meterId}"`), "ipucu ve parola gücü alana bağlı");

  const noToggle = await html(load, { id: "sp-repeat", toggle: false });
  assert.doesNotMatch(noToggle, /password-input-toggle/);
});

test("geçiş katmanı HTML'i: gizlerken yalnız noktalar (karakter yok), gösterirken karakterler", async () => {
  const load = async () => (await import("../src/components/ui/password-input")).PasswordMorph;
  const box = { left: 12, top: 4, width: 200, height: 28, fontFamily: "monospace", fontSize: "16px", fontWeight: "400", letterSpacing: "0px", color: "rgb(0,0,0)", scroll: 0 };
  const hide = await html(load, { to: "hide", glyphs: morphGlyphs(SECRET, "hide"), box });
  assert.equal(hide.match(/data-slot="password-morph-dot"/g)?.length, SECRET.length);
  assert.doesNotMatch(hide, /password-morph-char/);
  for (const c of new Set(SECRET.replace(/-/g, ""))) assert.ok(!hide.replace(/<[^>]*>/g, "").includes(c), c);
  assert.match(hide, /^<span aria-hidden="true" data-slot="password-morph"/);
  const show = await html(load, { to: "show", glyphs: morphGlyphs("Ab", "show"), box });
  assert.equal(show.match(/data-slot="password-morph-char"/g)?.length, 2);
});

test("parola kutusu kaynak: alana value / defaultValue verilmez, rare-ui izi yok, sakin hareket", () => {
  const src = read("src/components/ui/password-input.tsx");
  const input = src.slice(src.indexOf("        <input\n"), src.indexOf("/>", src.indexOf("        <input\n")));
  assert.ok(input.length > 0);
  assert.doesNotMatch(input, /\bvalue=|defaultValue/);
  assert.match(src, /if \(!el \|\| calm \|\| !el\.value\) return setMorph\(null\);/, "hareket azaltmada geçiş katmanı yok");
  assert.match(src, /useCalmMotion\(\)/);
  assert.doesNotMatch(src, RARE_UI);
  assert.doesNotMatch(src, /Show password|Password strength|Weak|Strong/);
});

/** Panelin bütün kaynakları (.tsx) */
function sources(dir = "src"): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(`${dir}/${e.name}`) : e.name.endsWith(".tsx") ? [`${dir}/${e.name}`] : [],
  );
}

test("her parola alanı parola kutusunu kullanır; ad / kimlik / autocomplete aynı; parola gücü yalnız yeni parolada", () => {
  // AkmanOS galerisinin kullanılmayan giriş kartı (components/akmanos/login-card) kütüphane kopyası, sayfada yok
  const raw = sources().filter((f) => f !== "src/components/ui/password-input.tsx" && !f.startsWith("src/components/akmanos/"));
  const plain = raw.filter((f) => /type=(?:"password"|\{[^}]*"password"[^}]*\})/.test(read(f)));
  assert.deepEqual(plain, [], "elle yazılmış parola alanı kalmadı");

  const uses: [string, string, RegExp][] = [
    ["src/app/giris/login-form.tsx", "login-password", /<FloatingPasswordField\s+ref=\{passwordRef\}\s+id="login-password"\s+label="\* Parola"\s+name="password"\s+autoComplete="current-password"/],
    ["src/app/baglan/consent-form.tsx", "password", /<FloatingPasswordField\s+id="password"\s+label="Parolanız"\s+name="password"\s+autoComplete="current-password"/],
    ["src/app/davet/set-password-form.tsx", "sp-new", /<PasswordInput\s+id="sp-new"\s+plain\s+name="password"\s+autoComplete="new-password"/],
    ["src/app/davet/set-password-form.tsx", "sp-repeat", /<PasswordInput\s+id="sp-repeat"\s+plain\s+name="repeat"\s+autoComplete="new-password"/],
    ["src/app/panel/hesap/password-form.tsx", "pw-c", /<PasswordInput id="pw-c" name="current" autoComplete="current-password" required \/>/],
    ["src/app/panel/hesap/password-form.tsx", "pw-n", /<PasswordInput\s+id="pw-n"\s+name="next"\s+autoComplete="new-password"/],
    ["src/app/panel/hesap/password-form.tsx", "pw-r", /<PasswordInput\s+id="pw-r"\s+name="repeat"\s+autoComplete="new-password"/],
    ["src/app/panel/hesap/password-form.tsx", "pr-p", /<PasswordInput id="pr-p" [^\n]*autoComplete="current-password"/],
    ["src/components/panel/confirm-password-dialog.tsx", "confirm-pw", /<PasswordInput id="confirm-pw" autoComplete="current-password"/],
    ["src/app/panel/kullanicilar/password-field.tsx", "{id}", /<PasswordInput\s+id=\{id\}\s+autoComplete="new-password"/],
  ];
  for (const [f, id, re] of uses) assert.match(read(f), re, `${f} ${id}`);

  // `strength` alan bloğunda yalnız autoComplete="new-password" ile birlikte
  for (const f of raw) {
    const src = read(f);
    for (const m of src.matchAll(/<(?:PasswordInput|FloatingPasswordField)\b[\s\S]*?\/>/g)) {
      if (/\bstrength\b/.test(m[0])) assert.match(m[0], /autoComplete="new-password"/, `${f}: ${m[0].slice(0, 80)}`);
    }
  }
  const meters = raw.flatMap((f) => [...read(f).matchAll(/<(?:PasswordInput|FloatingPasswordField)\b[\s\S]*?\/>/g)].filter((m) => /\bstrength\b/.test(m[0])).map(() => f));
  assert.deepEqual(meters.sort(), ["src/app/davet/set-password-form.tsx", "src/app/panel/hesap/password-form.tsx", "src/app/panel/kullanicilar/password-field.tsx"]);
  // Parola gücü sunucunun kuralını (passwordProblem(parola, e-posta)) e-postayla birlikte uygular: e-postayı içeren
  // parola, e-postasız "Güçlü" olsa da "Zayıf"
  assert.equal(passwordLevel("AyseKaya2026!"), 4);
  assert.equal(passwordLevel("AyseKaya2026!", "ayse.kaya@ornek.com"), 1);
  assert.match(read("src/app/panel/kullanicilar/password-field.tsx"), /strength=\{\{ email \}\}/);
  const users = read("src/app/panel/kullanicilar/users-client.tsx");
  const fields = [...users.matchAll(/<PasswordField\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(fields.length, 2, "kullanıcı ekle ve düzenle");
  for (const f of fields) assert.match(f, /\bemail=\{email\}/, f.slice(0, 80));
  // Giriş ve onay alanlarında parola gücü yok
  assert.doesNotMatch(read("src/app/giris/login-form.tsx"), /strength/);
  assert.doesNotMatch(read("src/components/panel/confirm-password-dialog.tsx"), /strength/);
});
