// 23 Ekim arayüz taramasının düzeltmeleri: eylem atınca (ağ kesildi, panel güncellendi) form hata ekranına düşmez,
// karaoke alarmı bağlantısızken takılı kalmaz, gece Bugün'ün başlığı ve sıradaki işi iş gününe bakar, ödemelerin
// toplamı ikiye ayrılır, kasa ayı kartı rapor yokken "Tutuyor" demez, Yardım'ın menü metni role göre, personel sayım
// listesinde yalnız değiştirebildiği ayları görür, komut paleti kısa sözcüğü sözcük başında arar.
// Çalıştırma: npx tsx --test tests/arayuz-duzeltmeleri.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { splitTasks, type DayTask } from "../src/app/panel/bugun/logic";
import { navTreeFor } from "../src/components/panel/nav";
import { numPossessive } from "../src/lib/format";
import { sessionName } from "../src/lib/karaoke/timer-requests";
import { okcChecks, type OkcFigures } from "../src/lib/okc-z";
import { wordHit } from "../src/lib/word-hit";

import { scanActionErrors, scanBusyAfterAwait } from "./helpers/action-guard";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
function walk(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(process.cwd(), p)).isDirectory() ? walk(p) : [p];
  });
}

test("eylem çağıran istemci dosyaları geçişi useActionTransition ile açar: atılan eylem sayfayı hata ekranına düşürmez", () => {
  const clients = walk("src").filter((f) => f.endsWith(".tsx") && read(f).startsWith('"use client"') && read(f).includes('from "@/server/actions'));
  assert.ok(clients.length > 40, String(clients.length));
  for (const f of clients) assert.doesNotMatch(read(f), /\buseTransition\(\)/, `${f}: useActionTransition kullanın (src/components/ui/action-error.ts)`);
  const helper = read("src/components/ui/action-error.ts");
  assert.match(helper, /unstable_rethrow\(e\)/);
  assert.match(helper, /unstable_isUnrecognizedActionError\(e\)/);
  assert.match(helper, /try \{\s+await fn\(\);\s+\} catch \(e\) \{\s+toastUnreachable\(e, options\);/);
});

test("eylem hatası bekçisi (E-51): istemcideki her sunucu eylemi çağrısının reddi bir yerde yakalanır", () => {
  // Ağ kesildi ya da panel yeniden yayınlandı: yakalanmayan ret düğmeyi kilitli bırakır, iyimser değişikliği sessizce
  // geri alır ya da (React'in çıplak startTransition'ında, useActionState'te) sayfayı hata ekranına düşürür.
  // Kural ve tanınan yollar tests/helpers/action-guard.ts'in başında.
  const { files, unhandled } = scanActionErrors(process.cwd());
  assert.ok(files.length > 90, String(files.length));
  assert.deepEqual(
    unhandled.map((u) => `${u.file}:${u.line} ${u.action} ← ${u.why}`),
    [],
    "Eylemi try/catch içinde bekleyin ya da tryAction / useActionTransition / catchingFormAction kullanın (src/components/ui/action-error.ts)",
  );
});

test("eylem hatası bekçisi: useActionTransition içinde eylemden sonra meşgul durumu try/finally dışında bırakılmaz", () => {
  // Başlatıcı hatayı yakalar ama ardındaki setBusy(false) hiç çalışmaz: düğme kilitli kalır (fiyat zammı kartı, onay
  // bekleyen fiyatlar, siteden satış çekme, silinen Paraşüt faturası, Claude bağlantı onayı)
  assert.deepEqual(scanBusyAfterAwait(process.cwd()), []);
});

test("eylem hatası bekçisinin kaçış yorumları sayılı ve nedenli", () => {
  const marks = walk("src")
    .filter((f) => /\.tsx?$/.test(f))
    .flatMap((f) => (read(f).match(/eylem-hatası: .*/g) ?? []).map((m) => `${f}: ${m.trim()}`));
  assert.deepEqual(marks, [
    "src/app/panel/kullanicilar/users-client.tsx: eylem-hatası: ConfirmPasswordDialog'un onConfirm'ü yakalar (pencere ve parola kalır, nedeni alanın altında)",
  ]);
  // O pencere atılan eylemi yakalar: pencere ve yazılan parola kalır, nedeni alanın altında ayrı durum satırında; parola
  // alanı yalnız eylemin döndürdüğü hatada (yanlış parola) geçersiz işaretlenir
  const dialog = read("src/components/panel/confirm-password-dialog.tsx");
  assert.match(dialog, /try \{\s+const problem = await onConfirm\(password\);\s+if \(problem\) setError\(problem\);\s+\} catch \(e\) \{\s+setNotice\(actionErrorText\(e\)\);\s+\}/);
  assert.match(dialog, /setError\(null\);\s+setNotice\(null\);/);
  assert.match(dialog, /<Field label="Parolanız" htmlFor="confirm-pw" error=\{error\}>/);
  assert.match(dialog, /aria-invalid=\{error \? true : undefined\}/);
  // ux-sade Ek A 272: not ortak uyarı bileşeninde (role="status" → live="polite")
  assert.match(dialog, /\{notice \? \(\s+<Notice[^>]*live="polite"[^>]*title=\{notice\}/);
  assert.doesNotMatch(dialog, /setError\(actionErrorText/);
});

test("eylem hatası bekçisi kendi örneklerinde yakalanmayanı bulur, yakalananı geçer", () => {
  const root = mkdtempSync(join(tmpdir(), "eylem-bekcisi-"));
  const put = (p: string, text: string) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  try {
    put(
      "src/components/ui/action-error.ts",
      `"use client";
export function useActionTransition(): [boolean, (fn: () => unknown) => void] { return [false, () => {}]; }
export async function tryAction<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
`,
    );
    put(
      "src/components/confirm.tsx",
      `"use client";
export function Confirm({ onConfirm }: { onConfirm: () => Promise<void> }) {
  async function go() {
    try {
      await onConfirm();
    } catch {}
  }
  return <button onClick={() => void go()} />;
}
export function Plain({ onConfirm }: { onConfirm: () => Promise<void> }) {
  return <button onClick={() => void onConfirm()} />;
}
`,
    );
    put("src/app/actions.ts", `"use server";\nexport async function go() {}\n`);
    // "kötü" işaretli satırlar yakalanmayan eylemler
    const demo = `"use client";
import { startTransition, useActionState } from "react";
import { Confirm, Plain } from "@/components/confirm";
import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { load, remove, save, submit } from "@/server/actions/demo";
import { go } from "./actions";

export function Demo() {
  const [, start] = useActionTransition();
  const [, act] = useActionState(submit, {}); // kötü
  async function good() {
    try {
      await save();
    } catch {}
  }
  async function bad() {
    await save(); // kötü
  }
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); });
  return (
    <form action={act}>
      <button onClick={() => void good()} />
      <button onClick={() => void bad()} />
      <button onClick={() => start(async () => { await remove(); })} />
      <button onClick={() => startTransition(async () => { await remove(); })} /> {/* kötü */}
      <button onClick={() => run(() => remove())} />
      <button onClick={() => void tryAction(() => load())} />
      <button onClick={() => void load().then(() => {})} /> {/* kötü */}
      <button onClick={() => void load().catch(() => {})} />
      <button onClick={() => void go()} /> {/* kötü */}
      <Confirm onConfirm={async () => { await save(); }} />
      <Plain onConfirm={async () => { await save(); }} /> {/* kötü */}
    </form>
  );
}
`;
    put("src/app/demo.tsx", demo);
    const bad = demo.split("\n").flatMap((l, i) => (l.includes("kötü") ? [i + 1] : []));
    const { files, unhandled } = scanActionErrors(root);
    assert.deepEqual(files, ["src/app/demo.tsx"]);
    assert.deepEqual(
      unhandled.map((u) => u.line).sort((x, y) => x - y),
      bad,
      JSON.stringify(unhandled, null, 1),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("geçişsiz eylem çağrıları da yakalanır: reçete önerileri, fatura, tedarikçi, ödeme düğmeleri", () => {
  for (const f of [
    "src/app/panel/receteler/change-editor.tsx",
    "src/app/panel/receteler/new-product-sheet.tsx",
    "src/app/panel/faturalar/invoice-dialog.tsx",
    "src/app/panel/tedarikciler/card-dialog.tsx",
    "src/app/panel/tedarikciler/[cari]/supplier-client.tsx",
    "src/app/panel/hatirlaticilar/payment-ui.tsx",
  ]) {
    assert.match(read(f), /\} catch \(e\) \{\s+(?:\/\/[^\n]*\n\s+)*toastUnreachable\(e[^)]*\);/, f);
  }
  // Fatura penceresi yanıt gelmeden aşağıdaki res.ok satırına inmez
  assert.match(read("src/app/panel/faturalar/invoice-dialog.tsx"), /toastUnreachable\(e\);\s+return;\s+\} finally \{/);
});

test("karaoke alarmı: bağlantısızken Haber verdim ve +15 dk düğmeleri kilitli kalmaz, bitiş geri alınır", () => {
  const src = read("src/components/panel/live/alert-center.tsx");
  assert.match(src, /try \{\s+const res = await endKaraokeSession\(s\.id\);[\s\S]*?\} catch \(e\) \{[\s\S]*?endedAt: s\.endedAt[\s\S]*?toastUnreachable\(e, "karaoke-alarm"\);\s+\} finally \{\s+setBusy\(null\);/);
  assert.match(src, /res = await extendKaraokeSession\(s\.id, minutes, \{ force \}\);\s+\} catch \(e\) \{\s+toastUnreachable\(e, "karaoke-alarm"\);\s+return;\s+\} finally \{\s+setBusy\(null\);/);
  // Telefonda metin sütunu daralıp satır satır kırılmaz
  assert.match(src, /<div className="min-w-0 flex-1 basis-56">/);
  // Bu cihazın başlattığı sayaçta "Karaoke başladı" ikinci kez çıkmaz
  assert.match(src, /if \(STARTED_HERE\.has\(s\.id\)\) return;/);
  assert.match(read("src/app/panel/karaoke/karaoke-board.tsx"), /startedOnThisDevice\(res\.data\.id\);/);
});

const task = (key: DayTask["key"], status: DayTask["status"], badge?: string): DayTask => ({ key, title: key, status, badge, detail: "", href: "/panel", action: "" });

test("sıradaki iş: açık kontrol listesi varken sabahtan geciken liste öne geçmez; başka sorun önce gelir", () => {
  assert.equal(splitTasks([task("liste-1", "warn", "Gecikti"), task("liste-2", "todo", "3 / 15")]).next?.key, "liste-2");
  assert.equal(splitTasks([task("liste-1", "warn", "Gecikti"), task("kasa-dun", "warn"), task("liste-2", "todo")]).next?.key, "kasa-dun");
  // Açık liste yoksa geciken liste sıradaki
  assert.equal(splitTasks([task("liste-1", "warn", "Gecikti"), task("zayi", "todo")]).next?.key, "liste-1");
  // Sorunlu (gecikmemiş) liste öne geçer
  assert.equal(splitTasks([task("liste-1", "warn", "2 sorun"), task("liste-2", "todo")]).next?.key, "liste-1");
  assert.equal(splitTasks([]).next, null);
});

test("Bugün başlığı gece 05:00'e kadar iş gününün adıyla ('… gecesi')", () => {
  const src = read("src/app/panel/bugun/page.tsx");
  assert.match(src, /const day = businessDate\(now\);\s+return day === todayTR\(now\) \? longDateTR\(day\) : `\$\{longDateTR\(day\)\} gecesi`;/);
  assert.match(src, /description=\{`\$\{dayTitle\(now\)\} · \$\{summary\.headline\}`\}/);
});

test("ödemeler kartı: gecikenlerin toplamı ayrı, 7 gün içindekiler ayrı", () => {
  const src = read("src/app/panel/dashboard-payments.tsx");
  assert.match(src, /`\$\{overdue\.length\} ödeme gecikti · \$\{money\(overdueTotal\)\}\$\{soonTotal > 0 \? ` · 7 gün içinde \$\{money\(soonTotal\)\}` : ""\}`/);
  assert.doesNotMatch(src, /ödeme gecikti · toplam/);
});

test("kasa: rapor yokken 'Rapor yok', eksik/fazla alt satırda, fişsiz çıkış kartta söylenir, hatalı alana gidilir", () => {
  const history = read("src/app/panel/kasa/cash-history.tsx");
  assert.match(history, /!totals\.reported \? "Rapor yok"/);
  assert.match(history, /sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4/);
  assert.match(read("src/app/panel/kasa/cash-outs.tsx"), /Fişi eklenmiş çıkış yok; raporda \$\{money\(reported\.amount\)\}/);
  assert.match(read("src/app/panel/kasa/page.tsx"), /reported=\{report \? \{ amount: report\.cashOut, note: report\.cashOutNote \} : null\}/);
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(form, /document\.getElementById\(fid\(first\)\)/);
  // Kimlikler form başına (useId): Onaylar'da iki "Düzeltip onayla" formu birbirinin alanına gitmez
  assert.match(form, /const uid = useId\(\);\s*const fid = \(name: string\) => `\$\{uid\}k-\$\{name\}`;/);
  assert.doesNotMatch(form, /(?:id|htmlFor)="k-|getElementById\("k-|focus\("k-|`k-\$\{/);
  assert.match(form, /`\$\{report \? "Rapor güncellendi" : "Rapor gönderildi"\} · /);
  assert.match(read("src/app/panel/kasa/cash-out-dialog.tsx"), /document\.getElementById\("co-amount"\)\?\.focus\(\)/);
});

test("Yardım'ın menü metni kenar çubuğunun ağacından: yönetici menüsünde Kasa raporu bir kez, personel listesi tekrarsız", () => {
  const src = read("src/app/panel/yardim/page.tsx");
  assert.match(src, /const MENU_LAYOUT = navTreeFor\("admin"\)/);
  assert.match(src, /const STAFF_SCREENS = \[\.\.\.navTreeFor\("staff"\)/);
  // Kasa raporu 26 Eki 2026'dan beri yöneticide de üst düzeyde (tek tıkla): ağaçta bir kez, grubun içinde ikinci kopyası yok
  const admin = navTreeFor("admin")
    .flatMap((n): { label: string }[] => n.children ?? [n])
    .map((n) => n.label);
  assert.equal(admin.filter((l) => /Kasa rapor/.test(l)).length, 1, admin.join(", "));
  const staff = navTreeFor("staff")
    .flatMap((n): { label: string }[] => n.children ?? [n])
    .map((n) => n.label);
  assert.equal(new Set(staff).size, staff.length, staff.join(", "));
  assert.equal(staff.filter((l) => /Kasa rapor/.test(l)).length, 1, staff.join(", "));
});

test("personel sayımda yalnız açabildiği ayı açar; ay adrese yazılır", () => {
  const src = read("src/app/panel/sayim/page.tsx");
  assert.match(src, /const allowed = \(m: string\) => isAdmin \|\| staffMonths\.includes\(m\);/);
  assert.match(src, /if \(!requested \|\| !allowed\(requested\)\) \{/);
  assert.match(src, /redirect\(`\/panel\/sayim\?\$\{q\}`\);/);
  assert.match(src, /isAdmin \? \[\.\.\.availableMonths\(model\), model\.currentMonth\] : staffMonths/);
});

test("komut paleti: 3 harfe kadar sözcük yalnız sözcük başında, uzun sözcük her yerde", () => {
  assert.equal(wordHit("parasut entegrasyonu", "sut"), false);
  assert.equal(wordHit("sut %2,5", "sut"), true);
  assert.equal(wordHit("laktozsuz sut", "sut"), true);
  assert.equal(wordHit("latte", "lat"), true);
  assert.equal(wordHit("kahve cekirdegi", "ahv"), false);
  assert.equal(wordHit("parasut entegrasyonu", "rasut"), true);
  assert.equal(wordHit("(c+) sos", "c+"), true);
});

test("reçete önerisi: öteki satırlardaki malzeme seçicide 'reçetede var' diye işaretli", () => {
  assert.match(read("src/app/panel/receteler/recipe-lines.tsx"), /taken=\{new Set\(rows\.flatMap\(\(x\) => \(x\.key !== r\.key && x\.ingredientId \? \[x\.ingredientId\] : \[\]\)\)\)\}/);
  assert.match(read("src/app/panel/receteler/ingredient-picker.tsx"), /taken\?\.has\(i\.id\) && !selected \? <span className="ml-1\.5 text-xs font-medium text-warn">reçetede var<\/span>/);
});

test("küçük gri metin kart zemininde AA'yı geçer; personel ortam değişkeni adı görmez", () => {
  assert.match(read("src/app/globals.css"), /--color-ink-mute: #6b6b74;/);
  const board = read("src/app/panel/siparisler/orders-board.tsx");
  assert.doesNotMatch(board, /bağlantısı kurulmadı \(KARAOKE_SYNC_SECRET\)/);
  assert.doesNotMatch(board, /toast\.error\("laffogato\.net bağlantısı kurulmamış \(KARAOKE_SYNC_SECRET\)"\)/);
  // Son çekmenin hatası (anahtar adı, imza, sitenin sürümü) yalnız yöneticinin satırında ve Yenile bildiriminde
  assert.match(board, /<StatusLines data=\{data\} now=\{now\} role=\{role\} \/>/);
  assert.match(
    board,
    /lines\.push\(\s*role === "admin"\s*\? `Son kontrol başarısız: \$\{data\.error\}\$\{since\}\. Siparişleri sitenin panelinde de kontrol edin\.`\s*: `Siparişler şu an siteden alınamıyor\$\{since\}\. Yeni sipariş burada görünmeyebilir; sorun sürerse yöneticiye haber verin\.`,?\s*\);/,
  );
  assert.match(board, /description: role === "admin" \? r\.error : "Sorun sürerse yöneticiye haber verin\."/);
  // Panel yanıt vermezse (ağ yok, 500) Yenile sessiz kalmaz (denetim SB-05); arka plandaki çekmeler bildirim göstermez
  const manual = board.slice(board.indexOf("function useManualPull"), board.indexOf("export function OrdersRefreshButton"));
  assert.match(manual, /if \(r === null\) toast\.error\("Panele ulaşılamadı; bağlantıyı kontrol edip tekrar deneyin\."\);/);
  assert.doesNotMatch(board.slice(board.indexOf("async function pullOrders"), board.indexOf("function useManualPull")), /toast\./);
  const actions = read("src/server/actions/karaoke.ts");
  const sync = actions.slice(actions.indexOf("export async function syncKaraokeNow"));
  assert.match(sync, /const me = await requireUser\(\);/);
  assert.match(sync, /throw new UserError\(me\.role === "admin" \? r\.error : "laffogato\.net'e ulaşılamadı; sorun sürerse yöneticiye haber verin\."\)/);
  assert.doesNotMatch(sync.slice(0, sync.indexOf("\n}\n")), /throw new UserError\("laffogato\.net bağlantısı kurulmamış \(KARAOKE_SYNC_SECRET\)"\)/);
});

test("karaoke şeridi (SB-03): kabuk şerit kadar iner; zil, çekmece, arama paleti ve İçeriğe geç şeridin altında kalmaz", () => {
  // Şerit sabit ve z-70; yüksekliği ölçülüp kökte --alarm-h olur, şerit kalkınca silinir
  const alerts = read("src/components/panel/live/alert-center.tsx");
  const banner = alerts.match(/<div role="alert" ref=\{reserveAlarmSpace\} className="([^"]+)"/)?.[1] ?? "";
  assert.match(banner, /\bfixed\b/);
  const bannerZ = Number(banner.match(/\bz-\[(\d+)\]/)?.[1]);
  assert.equal(bannerZ, 70);
  assert.match(alerts, /root\.style\.setProperty\("--alarm-h", `\$\{el\.offsetHeight\}px`\)/);
  assert.match(alerts, /root\.style\.removeProperty\("--alarm-h"\)/);

  const css = read("src/app/globals.css");
  const shell = css.slice(css.indexOf('[data-component="app-shell"] {'), css.indexOf("@media (width >= 64rem)"));
  assert.match(shell, /--mobile-top-h: calc\(3\.5rem \+ var\(--alarm-h\)\);/);
  assert.match(shell, /padding-top: var\(--alarm-h\);/);
  // Baskıda şerit çıkmaz (no-print); boşluğu da ilk sayfada boş bant bırakmaz
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print.slice(0, print.indexOf("\n}\n")), /\[data-component="app-shell"\] \{\s*padding-top: 0;\s*\}/);

  // Telefonun üst çubuğu şeridin altında yapışır. backdrop-blur onu içindeki fixed öğelerin kapsayıcısı yapar ve çubuk
  // zaten --alarm-h'de durur: içindeki hiçbir öğe --mobile-top-h'yi (şeridi de sayar) kullanmaz, şerit iki kez sayılırdı
  // (zilin listesi 390 px'te ekranın altından taşıyordu)
  const sidebar = read("src/components/panel/sidebar.tsx");
  const header = sidebar.slice(sidebar.indexOf('<header className="no-print sticky'), sidebar.indexOf("</header>", sidebar.indexOf('<header className="no-print sticky')));
  assert.match(header, /^<header className="no-print sticky top-\(--alarm-h\) [^"]*backdrop-blur/);
  // Zil açıkken üst çubuk sayfanın yüzen düğmelerinin (Fab, z-30) üstüne çıkar, çekmecenin perdesinin (z-40) altında kalır
  const fabZ = Number(read("src/components/ui/fab.tsx").match(/"no-print fixed [^"]*\bz-(\d+)\b/)?.[1]);
  const barZ = Number(header.match(/has-\[\[data-component=notification-dropdown\]\[data-open\]\]:z-\[(\d+)\]/)?.[1]);
  assert.ok(barZ > fabZ && barZ < 40, `${barZ} / ${fabZ}`);
  assert.match(header, /<NotificationMenu [^>]*variant="bar"/);
  assert.doesNotMatch(header, /--mobile-top-h|\bfixed\b/);
  const menu = read("src/components/panel/notifications.tsx");
  assert.doesNotMatch(menu, /--mobile-top-h/);
  // Zilin kökü üst çubukta konumlanmaz: açılan pencere (absolute) üst çubuğa göre yerleşir, çubuğun hemen altında açılır
  assert.match(menu, /className=\{cn\("relative inline-flex shrink-0 font-sans", variant === "bar" && "max-lg:static"\)\}/);
  assert.match(menu, /"absolute top-\[calc\(100%\+0\.5rem\)\] z-\[100\] flex max-h-\[/);
  const bar = menu.slice(menu.indexOf('variant === "bar" &&\n'), menu.indexOf("\n", menu.indexOf('variant === "bar" &&\n') + 22));
  assert.doesNotMatch(bar, /\bfixed\b/);
  // Yüksekliği şerit, üst çubuk ve alt menü arasına sığar
  assert.match(bar, /max-lg:max-h-\[calc\(100dvh-5rem-var\(--mobile-nav-h,0px\)-var\(--alarm-h,0px\)\)\]/);
  // Menü çekmecesi şeridin altından başlar
  assert.match(sidebar, /className="fixed top-\(--alarm-h\) bottom-0 left-0 z-50 /);

  // Masaüstünde zilin penceresi kenar çubuğundan şeridin bulunduğu yere taşar: zil açıkken kenar çubuğu şeridin üstüne çıkar
  assert.match(menu, /data-component="notification-dropdown"\s+data-open=\{open \|\| undefined\}/);
  const raised = Number(sidebar.match(/<div className="no-print fixed inset-y-0 left-0 z-30 [^"]*has-\[\[data-component=notification-dropdown\]\[data-open\]\]:z-\[(\d+)\]/)?.[1]);
  assert.ok(raised > bannerZ, String(raised));

  // Arama paleti (z-61) ve İçeriğe geç şeridin altından başlar
  const palette = read("src/components/panel/command-palette.tsx");
  const frame = palette.match(/<div className="(pointer-events-none fixed inset-0 z-\[61\][^"]*)"/)?.[1] ?? "";
  assert.match(frame, /(?:^| )pt-\[calc\(0\.75rem\+var\(--alarm-h\)\)\]/);
  assert.match(frame, /sm:pt-\[calc\(12dvh\+var\(--alarm-h\)\)\]/);
  assert.match(palette, /sm:max-h-\[min\(38rem,calc\(76dvh-var\(--alarm-h\)\)\)\]/);
  assert.match(read("src/app/panel/layout.tsx"), /focus:fixed focus:top-\[calc\(var\(--alarm-h\)\+0\.75rem\)\]/);
});

// ---------------------------------------------------------------- 13 Kasım denetimi, P10 (arayüz)

test("sayı eki (UI-06, UI-X1): okunuşun son sözcüğüne göre; yüzde, ondalık, binlik ve yuvarlanmış sayı", () => {
  const cases: [string, string][] = [
    [numPossessive(13), "13'ü"],
    [numPossessive(10), "10'u"],
    [numPossessive(6), "6'sı"],
    [numPossessive(3), "3'ü"],
    [numPossessive(12), "12'si"],
    [`%${numPossessive(30)}`, "%30'u"],
    [`%${numPossessive(40)}`, "%40'ı"],
    [`%${numPossessive(20)}`, "%20'si"],
    [`%${numPossessive(9)}`, "%9'u"],
    // Ondalıkta virgülden sonrası okunur: "yirmi virgül yetmiş beşi"
    [numPossessive(2.5, 1), "2,5'i"],
    [`%${numPossessive(20.75, 2)}`, "%20,75'i"],
    [`%${numPossessive(15.6, 2)}`, "%15,6'sı"],
    [`%${numPossessive(20.5, 0)}`, "%21'i"],
    // Ek yazılan (yuvarlanmış) sayıya göre
    [numPossessive(12.96), "13'ü"],
    [numPossessive(1_000), "1.000'i"],
    [numPossessive(2_000_000), "2.000.000'u"],
    [numPossessive(-3), "-3'ü"],
  ];
  for (const [got, want] of cases) assert.equal(got, want);
});

test("ÖKC Z'sinin K5 uyarısı (UI-X1): 'günlük toplamın %30'u', '%20'si'", () => {
  const fig = (vatTotal: number): OkcFigures => ({ zNo: "0123", receipts: 50, total: 10_000, vatTotal, groups: [], cash: 4_000, card: 6_000, mealCard: null, other: null });
  const k5 = (vat: number) => okcChecks(fig(vat), { prev: { z: null, cum: null } }).checks.find((c) => c.key === "k5")?.text ?? "";
  assert.match(k5(3_000), /^Toplam KDV günlük toplamın %30'u; %1–%17 olmalı\./);
  assert.match(k5(2_000), /günlük toplamın %20'si;/);
});

test("sabit sayı eki kalmadı (UI-06): sayı, yüzde ya da gün sayısından sonra ek okunuşa göre (numPossessive)", () => {
  // `${num(…)}'i`, `${t.listPeriod.days}'i`, `${pct(…)}'i` gibi kalıplar 13'i, %30'i, %20'i yazıyordu
  const fixed = /\$\{[^}]*(?:num\(|pct\(|pctOf\(|\.days|\.length)[^}]*\}'(?:i|ı|u|ü|si|sı|su|sü)\b/;
  const files = walk("src").filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.length > 300, String(files.length));
  for (const f of files) assert.doesNotMatch(read(f), fixed, f);
  assert.match(read("src/app/panel/page.tsx"), /gününün \$\{numPossessive\(t\.listPeriod\.days\)\}\)/);
  const breakdowns = read("src/app/panel/dashboard-breakdowns.ts");
  assert.match(breakdowns, /satışının %\$\{numPossessive\(o\.share \* 100\)\}/);
  assert.match(breakdowns, /gününün \$\{numPossessive\(t\.listPeriod\.days\)\}\)/);
  // Ek yardımcısı tek yerde: fiyat ekranları da oradan alır
  assert.doesNotMatch(read("src/lib/prices/bulk.ts"), /numPossessive/);
});

test("bildirim metinleri (UI-07): 'ödenmemişe döndü', adsız sayaç 'Rezervasyonsuz oturum'", () => {
  for (const f of walk("src").filter((x) => /\.tsx?$/.test(x))) assert.doesNotMatch(read(f), /yeniden ödenmedi/, f);
  assert.match(read("src/app/panel/hatirlaticilar/payment-ui.tsx"), /"Fatura ödenmemişe döndü"/);
  assert.match(read("src/app/panel/hatirlaticilar/recent-paid.tsx"), /title: `\$\{e\.title\} faturası ödenmemişe döndü`/);
  assert.equal(sessionName({ customerName: null, source: "panel" }), "Rezervasyonsuz oturum");
  assert.equal(sessionName({ customerName: null, source: "site" }), "İsimsiz rezervasyon");
  assert.equal(sessionName({ customerName: "Doğum günü", source: "panel" }), "Doğum günü");
  // Karaoke ekranı aynı adı kullanır: "Rezervasyonsuz oturum bitirildi", "… şimdi bitirilsin mi?"
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /const nameOf = sessionName;/);
  assert.match(board, /`\$\{nameOf\(s\)\} bitirildi`/);
});

test("çift kayıt (UI-01, UI-03): kısayollar kaydın kilidine uyar, yeni kayıt istemci anahtarıyla gider", () => {
  // Zayi: miktar alanındaki Enter düğmenin kilidini atlıyordu. Bayrak aynı karedeki ikinci olayı da tutar
  const waste = read("src/app/panel/zayi/waste-board.tsx");
  const submit = waste.slice(waste.indexOf("  function submit() {"), waste.indexOf("  function askDelete() {"));
  assert.match(submit, /^ {2}function submit\(\) \{\n(?: {4}\/\/.*\n)* {4}if \(sending\.current \|\| pending\) return;/);
  assert.match(submit, /sending\.current = true;\n {4}start\(async \(\) => \{\n {6}try \{/);
  assert.match(submit, /\} finally \{\n {8}sending\.current = false;/);
  assert.match(submit, /addWasteEntry\(\{ \.\.\.input, clientKey \}\)/);
  assert.match(waste, /onKeyDown=\{\(e\) => \{\n\s+if \(e\.key === "Enter"\) submit\(\);/);
  // Fatura: not alanındaki Ctrl+Enter ve formun Enter'ı save()'i çağırır; save kilitliyken dönmez
  const dialog = read("src/app/panel/faturalar/invoice-dialog.tsx");
  const save = dialog.slice(dialog.indexOf("  async function save("), dialog.indexOf("  function onSubmit("));
  assert.match(save, /^ {2}async function save\(again: boolean, keep = false, sameNoOk = false\) \{\n {4}if \(saving\.current\) return;/);
  assert.match(save, /saving\.current = true;\n {4}setBusy\(true\);/);
  assert.match(save, /\} finally \{\n {6}saving\.current = false;/);
  assert.match(save, /clientKey: invoice \? null : clientKey,\n {8}sameNoOk,/);
  assert.match(save, /if \(res\.data\.duplicate\) return setTwin\(\{ found: res\.data\.duplicate, again \}\);\n {4}if \(!invoice\) setClientKey\(crypto\.randomUUID\(\)\);/);
  assert.match(dialog, /confirmLabel="Yine de ekle"/);
  // Bulgu: Ayrıntı alanındaki Ctrl+Enter
  const finding = read("src/app/panel/tutarlilik/consistency-client.tsx");
  const add = finding.slice(finding.indexOf("function FindingDialog("));
  assert.match(add, /async function submit\(e\?: FormEvent\) \{\n {4}e\?\.preventDefault\(\);\n {4}if \(saving\.current\) return;/);
  assert.match(add, /saveFinding\(\{ id: item\?\.id \?\? null, section, title, detail, clientKey: item \? null : clientKey \}\)/);
});

test("çekmece (UI-04): adres değişince açıldığı yol unutulur; o sayfaya dönünce kendiliğinden açılmaz", () => {
  const sidebar = read("src/components/panel/sidebar.tsx");
  assert.match(
    sidebar,
    /const \[openFor, setOpenFor\] = useState<string \| null>\(null\);\n {2}if \(openFor !== null && openFor !== pathname\) setOpenFor\(null\);\n {2}const mobileOpen = openFor === pathname;/,
  );
});

test("kasa formu (UI-05): e-posta kapalıyken ya da gönderim kurulmamışken 'e-posta gider' demez", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(form, /const sendHint = recipients \? "gönderince yöneticiye e-posta gider" : "e-posta kapalı; gönderdikten sonra WhatsApp ile paylaşın";/);
  assert.match(form, /: `\$\{longDateTR\(date\)\} · \$\{sendHint\}`/);
  assert.doesNotMatch(form, /`\$\{longDateTR\(date\)\} · gönderince yöneticiye e-posta gider`/);
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /if \(!settings\.emailEnabled \|\| !isEmailConfigured\(\)\) return 0;/);
  assert.match(page, /const mailTo = showForm \? await cashMailTo\(settings\) : 0;/);
  assert.match(page, /<InfoTip text=\{more\(mailTo > 0\)\}/);
});

test("Yardım çapaları (UI-08): bölüm boşken de kısa 'şu an yok' satırına iner", () => {
  const holds = read("src/app/panel/hammaddeler/page.tsx");
  assert.match(holds, /<PriceHolds pending=\{holdViews\} recent=\{recentHolds\} \/>\n\s+\) : \(\n\s+<AnchorNote id=\{HOLDS_ANCHOR\}/);
  assert.match(read("src/app/panel/urunler/page.tsx"), /\/> : \(\n(?:\s+\/\/.*\n)?\s+<AnchorNote id="zamlar"/);
  const paid = read("src/app/panel/hatirlaticilar/recent-paid.tsx");
  assert.match(paid, /if \(!shown\.length\)\n\s+return \(\n\s+<>\n\s+<AnchorNote id="son-odenenler"/);
  assert.match(read("src/app/panel/hatirlaticilar/reminders-client.tsx"), /\n\s+<RecentPaidList items=\{recentPaid\} \/>\n/);
  // Yardım'ın üç bağlantısı bu kimliklere gider
  const help = read("src/app/panel/yardim/page.tsx");
  for (const href of ["/panel/hammaddeler#fiyat-onayi", "/panel/hatirlaticilar#son-odenenler", "/panel/urunler#zamlar"]) assert.ok(help.includes(`href: "${href}"`), href);
  const note = read("src/components/panel/anchor-note.tsx");
  assert.match(note, /if \(window\.location\.hash !== `#\$\{id\}`\) return;/);
});
