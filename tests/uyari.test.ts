// Ortak uyarı bileşeni (docs/planlar/ux-sade.md §4, §12): katlama planı, tek ikon ve kuyu tablosu, ekran okuyucu
// önekleri ve rol kuralı, uyarı kutusunun mürekkebi, düzenler (canlı bölge, telefonda eylem + Ayrıntı satırı, dokunma
// alanları), ayın uyarılarının görünen önemi (alertTone), Genel bakış'ın başındaki ödeme satırı (overdueNotice) ve
// ses yuvasının satırı (soundRow).
// Çalıştırma: npx tsx --test tests/uyari.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { alertTone } from "../src/app/panel/alert-tone";
import { overdueNotice } from "../src/app/panel/dashboard-tasks";
import { foldPlan, TONE_ICON, TONE_LABEL, TONE_TILE } from "../src/components/ui/notice";
import { money } from "../src/lib/format";
import { soundRow } from "../src/lib/live-poll";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ---------------------------------------------------------------- foldPlan

test("foldPlan: bad ve riskli warn hiç katlanmaz; ötekilerden ilk 2 görünür, kalanı katlanır", () => {
  const plan = foldPlan([
    { key: "n1", tone: "neutral" },
    { key: "w1", tone: "warn" },
    { key: "b1", tone: "bad" },
    { key: "w2", tone: "warn", risk: "para" },
    { key: "g1", tone: "good" },
    { key: "w3", tone: "warn" },
    { key: "b2", tone: "bad", risk: "veri" },
  ]);
  // Sıra bad > warn > neutral > good, aynı tonda yazıldığı sıra; bad ve riskli warn sayılmadan görünür
  assert.deepEqual(plan.shown, ["b1", "b2", "w1", "w2", "w3"]);
  assert.deepEqual(plan.folded, ["n1", "g1"]);
});

test("foldPlan: max değişince sınır değişir; riskli uyarı max'a sayılmaz; boş liste", () => {
  const items = [
    { key: "w1", tone: "warn" as const, risk: "hukuk" as const },
    { key: "w2", tone: "warn" as const },
    { key: "n1", tone: "neutral" as const },
    { key: "n2", tone: "neutral" as const },
  ];
  assert.deepEqual(foldPlan(items), { shown: ["w1", "w2", "n1"], folded: ["n2"] });
  assert.deepEqual(foldPlan(items, 1), { shown: ["w1", "w2"], folded: ["n1", "n2"] });
  assert.deepEqual(foldPlan(items, 0), { shown: ["w1"], folded: ["w2", "n1", "n2"] });
  // Hepsi bad: hiçbiri katlanmaz
  assert.deepEqual(foldPlan([{ key: "a", tone: "bad" }, { key: "b", tone: "bad" }, { key: "c", tone: "bad" }], 1), { shown: ["a", "b", "c"], folded: [] });
  assert.deepEqual(foldPlan([]), { shown: [], folded: [] });
});

// ---------------------------------------------------------------- Tek kaynak

test("TONE_ICON / TONE_TILE tek kaynak: zil, Dikkat kartı ve iş listesi onu içe aktarır, kendi uyarı ikonu eşlemesi yok", () => {
  assert.deepEqual(Object.keys(TONE_ICON).sort(), ["bad", "good", "neutral", "warn"]);
  assert.deepEqual(TONE_LABEL, { bad: "Önemli", warn: "Dikkat", neutral: "Bilgi", good: "Tamam" });
  assert.equal(TONE_TILE.bad, "bg-bad-soft text-bad-ink");
  assert.equal(TONE_TILE.warn, "bg-warn-soft text-warn-ink");
  assert.equal(TONE_TILE.neutral, "bg-note text-ink-mute");
  for (const f of ["src/components/panel/notifications.tsx", "src/app/panel/dashboard-alerts.tsx", "src/app/panel/task-style.tsx"]) {
    const src = read(f);
    assert.match(src, /import \{[^}]*\bTONE_ICON\b[^}]*\} from "@\/components\/ui\/notice";/, f);
    // Uyarı ikonu (üçgen / daire ünlem) bu dosyalarda adıyla geçmez: ikon tablodan gelir
    assert.doesNotMatch(src, /\b(TriangleAlert|AlertTriangle|CircleAlert|AlertCircle)\b/, f);
  }
  // "Dikkat edilmesi gerekenler" kartının ikonu uyarı ikonu değil (uyarı ikonu yalnız uyarıda)
  assert.match(read("src/app/panel/dashboard-alerts.tsx"), /icon=\{<ListChecks \/>\}/);
  // İş listesi: "Yapılacak" gri, sorunun ikonu uyarılarınki
  const task = read("src/app/panel/task-style.tsx");
  assert.match(task, /well: "bg-note text-ink-soft"/);
  assert.match(task, /TASK_BAR[\s\S]*todo: "bg-ink\/40"/);
});

test("notice.tsx: ekran okuyucu öneki, rol kuralı, kutunun mürekkebi bad-ink / warn-ink", () => {
  const src = read("src/components/ui/notice.tsx");
  assert.doesNotMatch(src, /^"use client"/m);
  // Renk tek başına anlam taşımaz: başlığın başında sr-only önek
  assert.match(src, /<span className="sr-only">\{TONE_LABEL\[tone\]\}: <\/span>/);
  // live yoksa note, polite → status, assertive → alert
  assert.match(src, /const role = live === "assertive" \? "alert" : live === "polite" \? "status" : "note";/);
  assert.match(src, /text-bad-ink/);
  assert.match(src, /text-warn-ink/);
  // Açık zeminde AA'nın altında kalan text-bad / text-warn metin rengi yok
  assert.doesNotMatch(src, /(?<![\w:-])text-(bad|warn)(?![\w-])/);
  // Yeni jetonlar tanımlı
  const css = read("src/app/globals.css");
  assert.match(css, /--color-bad-ink: #b91c1c;/);
  assert.match(css, /--color-warn-ink: #9a3412;/);
  assert.match(css, /--color-note: rgb\(23 23 23 \/ 0\.045\);/);
  // Ölçüm ve bekçi için kökte veri öznitelikleri
  assert.match(src, /data-notice=\{tone\} data-risk=\{risk\}/);
});

// ---------------------------------------------------------------- alertTone

test("alertTone: üç doğrudan eşleme ve üç düzeltme (hesap değişmez, görünüm katmanı)", () => {
  assert.equal(alertTone({ level: "danger", title: "Kasa eksiği" }), "bad");
  assert.equal(alertTone({ level: "warning", title: "Fatura gecikti" }), "warn");
  assert.equal(alertTone({ level: "info", title: "Yeni ay başladı" }), "neutral");
  // Süresi olmayan öneri kırmızı değil
  assert.equal(alertTone({ level: "danger", title: "3 ürünün kârı düşük" }), "warn");
  // Ay sonu rakamını bozan eksik veri bilgi değil
  assert.equal(alertTone({ level: "info", title: "Su ve buz maliyeti hesaplanmadı" }), "warn");
  assert.equal(alertTone({ level: "info", title: "Geçen ayın stok sayımı yok" }), "warn");
  // Benzeri ama aynı olmayan başlık düzeltilmez
  assert.equal(alertTone({ level: "info", title: "Bu ayın stok sayımı yok" }), "neutral");
  // insights.ts'in başlıkları bu düzeltmelerle eşleşir (metin değişirse düzeltme sessizce düşmesin)
  const insights = read("src/lib/calc/insights.ts");
  assert.match(insights, /ürünün kârı düşük`/);
  assert.match(insights, /"Su ve buz maliyeti/);
  assert.match(insights, /"Geçen ayın stok sayımı yok"/);
});

// ---------------------------------------------------------------- overdueNotice

test("overdueNotice: gecikme kırmızı tek satır (para), okunamayan liste nötr, yalnız yaklaşan ödeme satırsız", () => {
  const base = { overdue: 0, overdueTotal: 0, soon: 0, soonTotal: 0, unpaidInvoices: 0, unpaidTotal: 0 };
  assert.deepEqual(overdueNotice({ ...base, overdue: 2, overdueTotal: 11_517, soon: 1, soonTotal: 2_000 }), {
    tone: "bad",
    risk: "para",
    title: `2 ödeme gecikti · ${money(11_517)}`,
  });
  assert.deepEqual(overdueNotice(null), { tone: "neutral", title: "Ödeme listesi şu an okunamadı" });
  assert.equal(overdueNotice({ ...base, soon: 3, soonTotal: 4_500 }), null);
  assert.equal(overdueNotice(base), null);
  // Genel bakış ay listesinden ödeme işini çıkarır, satırı sayfanın başına koyar (K22)
  const page = read("src/app/panel/page.tsx");
  assert.match(page, /overdueNotice\(/);
  assert.match(page, /<NoticeLink href="\/panel\/hatirlaticilar">Ödemelere bak<\/NoticeLink>/);
});

// ---------------------------------------------------------------- Düzenler (sunucuda çizilen HTML)

/** Konumdaki açılış etiketinin (div) kapanışına kadar olan HTML */
function element(html: string, start: number): string {
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<(\/?)div\b[^>]*>/g)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, start + m.index + m[0].length);
  }
  return html.slice(start);
}

async function renderNotice(props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { Notice } = await import("../src/components/ui/notice");
  return renderToStaticMarkup(createElement(Notice, props as never));
}

test("canlı uyarıda Ayrıntı canlı bölgenin dışında: açıp kapamak uyarıyı yeniden okutmaz (inceleme B2-A11Y-5)", async () => {
  const { createElement } = await import("react");
  const { NoticeLink } = await import("../src/components/ui/notice");
  const cases = [
    // Eylemsiz (eskiden bütün kutu tek <details>, rol onun kökündeydi)
    { tone: "warn", live: "polite", title: "Tedarikçiye 2 iade panele girmedi", children: "liste" },
    { tone: "bad", live: "assertive", defaultOpen: true, title: "Listede toplam satırı var", text: "Silin.", children: "liste" },
    // Eylemli
    { tone: "warn", live: "polite", title: "3 kasa alımı bekliyor", text: "Ne yapılacak", action: createElement(NoticeLink, { href: "/panel/faturalar", children: "Git" }), children: "neden" },
  ];
  for (const props of cases) {
    const html = await renderNotice(props);
    const role = props.live === "assertive" ? "alert" : "status";
    const at = html.indexOf(`<div role="${role}"`);
    assert.ok(at > 0, `${props.title}: canlı bölge kökün içinde (kök rol taşımaz)`);
    assert.doesNotMatch(html.slice(0, at), /role=/, "kökte rol yok");
    const region = element(html, at);
    assert.match(region, new RegExp(props.title), "başlık bölgede");
    if (props.text) assert.match(region, new RegExp(props.text), "text bölgede");
    assert.doesNotMatch(region, /<details|<summary|Ayrıntı|href=/, "Ayrıntı ve eylem bölgenin dışında");
    assert.match(html, /<details/);
  }
  // Ayrıntısız canlı uyarı ve canlı olmayan uyarı: rol kökte (değişmedi)
  assert.match(await renderNotice({ tone: "bad", live: "assertive", title: "Kaydedilmedi" }), /^<div role="alert" data-notice="bad"/);
  assert.match(await renderNotice({ tone: "neutral", title: "Bilgi", children: "neden" }), /^<div role="note" data-notice="neutral"/);
  // Sunucuda sayfayla gelen uyarılar canlı değil (§4.5): Tahmin bandı ve karaoke'nin bağlantı kutusu
  assert.doesNotMatch(read("src/app/panel/tahmin/page.tsx"), /<Notice tone="neutral" live=/);
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /<Notice\s+tone="neutral"\s+title="Site bağlantısı kurulmadı/);
  assert.match(board, /<Notice tone="neutral" title="Site bağlı değil/);
});

test("telefonda eylem ve Ayrıntı aynı satırda, eylemin dokunma alanı önde; başlık ve eylem ortalı (inceleme B2-V5, V6, V8)", async () => {
  const { createElement } = await import("react");
  const { NoticeLink } = await import("../src/components/ui/notice");
  const action = createElement(NoticeLink, { href: "/panel/vergi/kurallar#sorular", children: "Muhasebeciye sor" });
  const both = await renderNotice({ tone: "warn", risk: "para", title: "SGK oranı farklı", action, children: "neden" });
  // Eylem telefonda Ayrıntı'nın sağına (order-1), Ayrıntı satırı telefonda dar, açılınca tam genişlik (özet yerinde)
  assert.match(both, /class="no-print relative z-\[1\] ml-auto shrink-0 self-center max-sm:order-1"/);
  assert.match(both, /<details class="group\/n min-w-0 basis-full pl-6 max-sm:basis-auto max-sm:self-center max-sm:open:basis-full"/);
  // Başlık bloğu telefonda tam satır: Ayrıntı başlığın yanına çıkmaz
  assert.match(both, /flex-1 basis-54 self-center max-sm:basis-full/);
  // Yalnız eylem: eylem başlığın yanına sığmazsa ikon hizasına iner; başlık ve eylem ortalı (44 px düğmenin yanında
  // başlık tepede kalmaz)
  const only = await renderNotice({ tone: "neutral", size: "sm", title: "Sesli uyarılar kapalı", action });
  assert.match(only, /class="no-print relative z-\[1\] ml-auto shrink-0 self-center max-sm:ml-6"/);
  assert.match(only, /<div class="flex min-w-0 items-start gap-2 flex-1 basis-54 self-center">/);
  assert.doesNotMatch(only, /max-sm:order-1|<details/);
  // Dokunma alanları: bağlantı satır yüksekliğinde (20 px) + 12 px kenar = 44; Teknik ayrıntı 16 + 2 × 14 = 44
  assert.match(both, /<a class="relative inline-flex min-h-5 items-center font-medium/);
  const tech = await renderNotice({ tone: "neutral", title: "Bağlantı yok", tech: "ANAHTAR" });
  assert.match(tech, /<summary class="relative inline-flex[^"]*text-xs text-ink-soft[^"]*after:-inset-y-3\.5/);
  // 12 px Teknik ayrıntı metni nötr kutunun panel üstündeki zemininde text-ink-mute ile 4,4:1 (AA altı)
  assert.doesNotMatch(read("src/components/ui/notice.tsx").slice(read("src/components/ui/notice.tsx").indexOf("export function NoticeTech")).split("/** Ayrıntı'nın gövdesi")[0], /text-ink-mute/);
});

// ---------------------------------------------------------------- Ses yuvası

test("soundRow: satır ilk dokunuşta kalkmaz, sayfa değişene kadar \"açık\" kalır (inceleme B2-V1, A11Y-1)", () => {
  const base = { needsSound: true, audioReady: false, pathname: "/panel", shownOn: null };
  // Ses kilitli, gerek var: "kapalı" satırı, çizildiği sayfa saklanır
  const a = soundRow(base);
  assert.deepEqual(a, { row: "locked", shownOn: "/panel" });
  // İlk dokunuş (pointerdown) sesi açtı: satır aynı yerde "açık" (içerik kaymaz, tıklama hedefine düşer)
  const b = soundRow({ ...base, needsSound: false, audioReady: true, shownOn: a.shownOn });
  assert.deepEqual(b, { row: "open", shownOn: "/panel" });
  // Aynı sayfada sonraki çizimler de "açık"
  assert.deepEqual(soundRow({ ...base, needsSound: false, audioReady: true, shownOn: b.shownOn }), { row: "open", shownOn: "/panel" });
  // Sayfa değişince kalkar; geri dönülünce de çizilmez (saklanan sayfa sıfırlandı)
  const c = soundRow({ ...base, needsSound: false, audioReady: true, pathname: "/panel/kasa", shownOn: b.shownOn });
  assert.deepEqual(c, { row: null, shownOn: null });
  assert.deepEqual(soundRow({ ...base, needsSound: false, audioReady: true, shownOn: c.shownOn }), { row: null, shownOn: null });
  // Ses yeniden kilitlendi (sekme askıya alındı): aynı yerde yeniden "kapalı"
  assert.deepEqual(soundRow({ ...base, shownOn: "/panel" }), { row: "locked", shownOn: "/panel" });
  // Gerek kalmadı ama ses açılmadı (hatırlatıcının vakti geçti, ses ayarı kapatıldı): kalkar
  assert.deepEqual(soundRow({ ...base, needsSound: false, shownOn: "/panel" }), { row: null, shownOn: null });
  // Bileşen satırı needsSound'a değil bu karara bağlar; "açık" satırı düğmenin görünmez eşiyle aynı yükseklikte
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /const sound = soundRow\(\{ needsSound, audioReady: audio === "ready", pathname, shownOn: soundShownOn \}\);/);
  assert.match(center, /\{sound\.row && soundSlot\s*\?/);
  assert.match(center, /title="Sesli uyarılar açık"/);
  assert.match(center, /<span aria-hidden="true" className="invisible">\s*<Button size="xs" variant="secondary" tabIndex=\{-1\}>/);
  assert.doesNotMatch(center, /\{needsSound && soundSlot/);
});
