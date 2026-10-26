// 23 Ekim arayüz taramasının düzeltmeleri: eylem atınca (ağ kesildi, panel güncellendi) form hata ekranına düşmez,
// karaoke alarmı bağlantısızken takılı kalmaz, gece Bugün'ün başlığı ve sıradaki işi iş gününe bakar, ödemelerin
// toplamı ikiye ayrılır, kasa ayı kartı rapor yokken "Tutuyor" demez, Yardım'ın menü metni role göre, personel sayım
// listesinde yalnız değiştirebildiği ayları görür, komut paleti kısa sözcüğü sözcük başında arar.
// Çalıştırma: npx tsx --test tests/arayuz-duzeltmeleri.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { splitTasks, type DayTask } from "../src/app/panel/bugun/logic";
import { navTreeFor } from "../src/components/panel/nav";
import { wordHit } from "../src/lib/word-hit";

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
  assert.match(helper, /try \{\s+await fn\(\);\s+\} catch \(e\) \{\s+toastUnreachable\(e\);/);
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
    assert.match(read(f), /\} catch \(e\) \{\s+toastUnreachable\(e[^)]*\);/, f);
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
  const board = read("src/app/panel/karaoke/orders-board.tsx");
  assert.doesNotMatch(board, /bağlantısı kurulmadı \(KARAOKE_SYNC_SECRET\)/);
  assert.doesNotMatch(board, /toast\.error\("laffogato\.net bağlantısı kurulmamış \(KARAOKE_SYNC_SECRET\)"\)/);
  // Son çekmenin hatası (anahtar adı, imza, sitenin sürümü) yalnız yöneticinin satırında ve Yenile bildiriminde
  assert.match(board, /<StatusLines data=\{data\} now=\{now\} role=\{role\} \/>/);
  assert.match(
    board,
    /lines\.push\(\s*role === "admin"\s*\? `Son kontrol başarısız: \$\{data\.error\}\$\{since\}\. Siparişleri sitenin panelinde de kontrol edin\.`\s*: `Siparişler şu an siteden alınamıyor\$\{since\}\. Yeni sipariş burada görünmeyebilir; sorun sürerse yöneticiye haber verin\.`,?\s*\);/,
  );
  assert.match(board, /description: role === "admin" \? r\.error : "Sorun sürerse yöneticiye haber verin\."/);
  const actions = read("src/server/actions/karaoke.ts");
  const sync = actions.slice(actions.indexOf("export async function syncKaraokeNow"));
  assert.match(sync, /const me = await requireUser\(\);/);
  assert.match(sync, /throw new UserError\(me\.role === "admin" \? r\.error : "laffogato\.net'e ulaşılamadı; sorun sürerse yöneticiye haber verin\."\)/);
  assert.doesNotMatch(sync.slice(0, sync.indexOf("\n}\n")), /throw new UserError\("laffogato\.net bağlantısı kurulmamış \(KARAOKE_SYNC_SECRET\)"\)/);
});
