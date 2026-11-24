// Ortak onay kuyruğu (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §3): saf kurallar (src/lib/staff-requests.ts)
// ve kaynak denetimleri. Karar reddi (durum, kendi isteği, süre, sürüm), zil kimliğinin 10 dakikada bir yenilenmesi,
// süre dolması, sınırlar, türlerin etiketleri ve şemayla aynılığı; çekirdek "use server" değil, genel eylem dosyasının
// tek eylemi kendi oturumunu denetler, /panel/onaylar'ın her bölümü requireAdmin ile başlar; sabah e-postasının
// "Onay bekleyenler" satırlarında tutar yok.
// Çalıştırma: npx tsx --test tests/onay-kuyrugu.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { staffRequests } from "../src/server/db/schema";
import {
  approvalsDigestLines,
  isExpired,
  KIND_COUNT_LABEL,
  KIND_GROUP,
  KIND_LABEL,
  limitRefusal,
  LIMITS,
  nextBump,
  REQUEST_TEXT,
  requestCountsText,
  requestDayStart,
  RETIRED_REQUEST_KINDS,
  reviewRefusal,
  STAFF_APPROVAL_KINDS,
  STAFF_REQUEST_KINDS,
  STAFF_REQUEST_STATUSES,
  STATUS_LABEL,
  waitedText,
  WITHDRAW_LOG,
} from "../src/lib/staff-requests";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const NOW = tr("2026-10-24T10:00");

const row = (o: Partial<Parameters<typeof reviewRefusal>[0]> = {}) => ({ status: "pending" as const, version: 2, requestedBy: 7, expiresAt: null, ...o });
const admin = { id: 1, role: "admin" as const };

test("türler ve durumlar şemayla aynı; her türün etiketi, sayı ifadesi, grubu ve personel Yardım'ı satırı var", () => {
  assert.deepEqual([...STAFF_REQUEST_KINDS], [...staffRequests.kind.enumValues]);
  assert.deepEqual([...STAFF_REQUEST_STATUSES], [...staffRequests.status.enumValues]);
  for (const k of STAFF_REQUEST_KINDS) {
    assert.ok(KIND_LABEL[k], k);
    assert.ok(KIND_COUNT_LABEL[k], k);
    assert.ok(KIND_GROUP[k], k);
    assert.match(WITHDRAW_LOG[k], / geri çekildi$/, k);
    // Kaldırılan tür (mal siparişi taslağı, 26 Eki 2026) Yardım'da yok; ötekiler var
    const retired = (RETIRED_REQUEST_KINDS as readonly string[]).includes(k);
    assert.equal(
      STAFF_APPROVAL_KINDS.some((a) => a.kind === k),
      !retired,
      `${k}: personel Yardım'ı`,
    );
  }
  for (const s of STAFF_REQUEST_STATUSES) assert.ok(STATUS_LABEL[s], s);
  assert.equal(KIND_LABEL["kasa-duzeltme"], "Kasa düzeltmesi");
  // Eski satırlar için etiket kalır; tür şemanın enumunda (eski satırlar okunabilsin)
  assert.deepEqual([...RETIRED_REQUEST_KINDS], ["mal-taslak"]);
  assert.equal(KIND_LABEL["mal-taslak"], "Mal siparişi taslağı");
  // Yardım'ın satırları: dokuz canlı tür, reçete değişikliği ve yeni ürün önerisi
  assert.equal(STAFF_APPROVAL_KINDS.length, STAFF_REQUEST_KINDS.length - RETIRED_REQUEST_KINDS.length + 2);
  assert.ok(STAFF_APPROVAL_KINDS.some((a) => a.kind === "recete"));
  assert.ok(STAFF_APPROVAL_KINDS.some((a) => a.kind === "yeni-urun"));
  assert.equal(STAFF_APPROVAL_KINDS.find((a) => a.kind === "kasa-gec")?.text, "Unutulan eski günün kasa raporu (14 gün)");
  // Tutar yok, uzun tire yok
  for (const a of STAFF_APPROVAL_KINDS) assert.doesNotMatch(a.text, /₺|—/);
});

test("karar reddi: karara bağlanmış, kendi isteği, süresi dolmuş, sürümü değişmiş; hepsi tutarsa onaylanır", () => {
  assert.equal(reviewRefusal(row(), admin, 2, NOW), null);
  assert.equal(reviewRefusal(row({ status: "approved" }), admin, 2, NOW), REQUEST_TEXT.decided);
  assert.equal(REQUEST_TEXT.decided, "Bu istek zaten karara bağlanmış; sayfayı yenileyin");
  assert.equal(reviewRefusal(row({ requestedBy: 1 }), admin, 2, NOW), "Kendi isteğinizi onaylayamazsınız");
  assert.equal(reviewRefusal(row(), admin, 1, NOW), "İstek siz bakarken değişti; yeniden bakın");
  assert.equal(reviewRefusal(row({ expiresAt: tr("2026-10-24T09:59") }), admin, 2, NOW), "Süresi doldu");
  // Sınırda: süre tam şimdi dolar
  assert.equal(reviewRefusal(row({ expiresAt: NOW }), admin, 2, NOW), "Süresi doldu");
  assert.equal(reviewRefusal(row({ expiresAt: tr("2026-10-24T10:01") }), admin, 2, NOW), null);
  // Sıra: karara bağlanmış önce; kendi isteği sürüm farkından önce
  assert.equal(reviewRefusal(row({ status: "withdrawn", requestedBy: 1 }), admin, 1, NOW), REQUEST_TEXT.decided);
  assert.equal(reviewRefusal(row({ requestedBy: 1 }), admin, 1, NOW), "Kendi isteğinizi onaylayamazsınız");
  // İsteyen hesabı silinmişse (requestedBy null) kimse "kendisi" değildir
  assert.equal(reviewRefusal(row({ requestedBy: null }), admin, 2, NOW), null);
});

test("zil kimliği: istek güncellenince en çok 10 dakikada bir yenilenir", () => {
  const prev = tr("2026-10-24T09:55");
  assert.equal(nextBump(prev, NOW).getTime(), prev.getTime());
  assert.equal(nextBump(tr("2026-10-24T09:50"), NOW).getTime(), NOW.getTime());
  assert.equal(nextBump(tr("2026-10-24T09:00"), NOW).getTime(), NOW.getTime());
  assert.equal(LIMITS.bumpMs, 10 * 60_000);
});

test("süre dolması: süresi olmayan dolmaz; süre anı geçince ya da tam o an dolar", () => {
  assert.equal(isExpired({ expiresAt: null }, NOW), false);
  assert.equal(isExpired({ expiresAt: tr("2026-10-24T10:01") }, NOW), false);
  assert.equal(isExpired({ expiresAt: NOW }, NOW), true);
  assert.equal(isExpired({ expiresAt: tr("2026-10-23T10:00") }, NOW), true);
});

test("sınırlar: tür grubu başına açık istek (kasa 10, geç kasa 5, zayi 20, mal 10, karaoke 5), iş günü başına 30, konu başına günde 3", () => {
  assert.deepEqual(LIMITS.open, { kasa: 10, "kasa-gec": 5, zayi: 20, mal: 10, karaoke: 5 });
  assert.equal(LIMITS.perDay, 30);
  assert.equal(LIMITS.perSubjectDay, 3);
  assert.equal(KIND_GROUP["kasa-duzeltme"], "kasa");
  assert.equal(KIND_GROUP["kasa-cikan"], "kasa");
  assert.equal(KIND_GROUP["foto-kaldir"], "kasa");
  assert.equal(KIND_GROUP["kapali-gun"], "kasa");
  assert.equal(KIND_GROUP["kasa-gec"], "kasa-gec");
  assert.equal(KIND_GROUP["zayi-gec"], "zayi");
  assert.equal(KIND_GROUP["zayi-sil"], "zayi");
  assert.equal(KIND_GROUP["mal-taslak"], "mal");
  assert.equal(KIND_GROUP["karaoke-sil"], "karaoke");
  const ok = { open: 0, today: 0, subjectToday: 0 };
  assert.equal(limitRefusal("karaoke-sil", { ...ok, open: 4 }), null);
  assert.match(limitRefusal("karaoke-sil", { ...ok, open: 5 }) ?? "", /^Onay bekleyen 5 isteğiniz var/);
  assert.equal(limitRefusal("kasa-duzeltme", ok), null);
  assert.equal(limitRefusal("kasa-duzeltme", { ...ok, open: 9 }), null);
  assert.match(limitRefusal("kasa-duzeltme", { ...ok, open: 10 }) ?? "", /^Onay bekleyen 10 isteğiniz var/);
  assert.equal(limitRefusal("zayi-gec", { ...ok, open: 19 }), null);
  assert.match(limitRefusal("zayi-gec", { ...ok, open: 20 }) ?? "", /^Onay bekleyen 20 isteğiniz var/);
  assert.match(limitRefusal("kasa-gec", { ...ok, open: 5 }) ?? "", /^Onay bekleyen 5 isteğiniz var/);
  assert.equal(limitRefusal("kasa-gec", { ...ok, open: 4 }), null);
  assert.equal(limitRefusal("zayi-gec", { ...ok, today: 29 }), null);
  assert.equal(limitRefusal("zayi-gec", { ...ok, today: 30 }), "Bugün en çok 30 istek açılabilir; yarın yeniden deneyin");
  assert.equal(limitRefusal("zayi-sil", { ...ok, subjectToday: 2 }), null);
  assert.equal(limitRefusal("zayi-sil", { ...ok, subjectToday: 3 }), "Bu konuda bugün en çok 3 istek açılabilir; yöneticiye yazın");
});

test("iş günü 05:00'te döner (oluşturma sınırı iş gününe göre sayılır)", () => {
  assert.equal(requestDayStart(tr("2026-10-24T10:00")).toISOString(), tr("2026-10-24T05:00").toISOString());
  assert.equal(requestDayStart(tr("2026-10-24T04:59")).toISOString(), tr("2026-10-23T05:00").toISOString());
  assert.equal(requestDayStart(tr("2026-10-24T05:00")).toISOString(), tr("2026-10-24T05:00").toISOString());
});

test("bekleyen sayılar tek satırda: türün sırasıyla, sayı ve ad (tutar yok); bekleme süresi", () => {
  assert.equal(
    requestCountsText([
      { kind: "zayi-sil", count: 1 },
      { kind: "kasa-duzeltme", count: 1 },
      { kind: "zayi-gec", count: 3 },
    ]),
    "1 kasa düzeltmesi · 3 geç zayi / ikram · 1 zayi silme isteği",
  );
  // Kaldırılan tür (eski mal siparişi taslağı) yazılmaz
  assert.equal(requestCountsText([{ kind: "mal-taslak", count: 2 }]), "");
  assert.equal(requestCountsText([]), "");
  assert.equal(requestCountsText([{ kind: "kasa-gec", count: 0 }]), "");
  assert.equal(waitedText(tr("2026-10-24T08:00"), NOW), "bugünden beri");
  assert.equal(waitedText(tr("2026-10-23T22:00"), NOW), "dünden beri");
  assert.equal(waitedText(tr("2026-10-22T09:00"), NOW), "2 gündür");
});

test("sabah e-postası: 'N istek onay bekliyor (en eskisi …)' ve satır başına başlık ile isteyenin adı; tutar yok", () => {
  assert.deepEqual(approvalsDigestLines([], NOW), []);
  const lines = approvalsDigestLines(
    [
      { title: "22 Ekim kasa düzeltmesi", requestedByName: "Mehmet", createdAt: tr("2026-10-22T09:00") },
      { title: "Kaldi · 5 kalem", requestedByName: "Ayşe", createdAt: tr("2026-10-24T08:00") },
    ],
    NOW,
  );
  assert.deepEqual(lines[0], { strong: "2 istek onay bekliyor", text: "En eskisi 2 gündür bekliyor." });
  assert.deepEqual(lines.slice(1), [{ text: "22 Ekim kasa düzeltmesi (Mehmet)" }, { text: "Kaldi · 5 kalem (Ayşe)" }]);
  // En çok 8 satır, kalanlar sayıyla
  const many = Array.from({ length: 11 }, (_, i) => ({ title: `İstek ${i + 1}`, requestedByName: "Ayşe", createdAt: NOW }));
  const out = approvalsDigestLines(many, NOW);
  assert.equal(out.length, 1 + 8 + 1);
  assert.deepEqual(out.at(-1), { text: "ve 3 istek daha", tone: "muted" });
  assert.doesNotMatch(JSON.stringify(out), /₺/);
});

// ---------------------------------------------------------------- Kaynak denetimleri

test("çekirdek sunucu eylemi değil; veritabanını parametre alır (testli, server-only yok)", () => {
  const core = read("src/server/staff-requests/core.ts");
  assert.doesNotMatch(core, /"use server"/);
  assert.doesNotMatch(core, /import "server-only"/);
  assert.doesNotMatch(core, /getDb\(/);
  // Kişinin istekleri tek sırada: danışma kilidi; bekleyen satır FOR UPDATE ile okunur
  assert.match(core, /pg_advisory_xact_lock\(hashtext\(\$\{`personel-istek:\$\{me\.id\}`\}\)\)/);
  assert.match(core, /\.for\("update"\)/);
  // Yönetici istek açmaz
  assert.match(core, /if \(me\.role === "admin"\) throw new UserError\(REQUEST_TEXT\.adminDirect\)/);
  // Geri çekme koşullu: yalnız kendi bekleyen isteği
  const withdraw = core.slice(core.indexOf("export async function withdrawOwn"), core.indexOf("export async function supersede"));
  assert.match(withdraw, /eq\(s\.staffRequests\.status, "pending"\), eq\(s\.staffRequests\.requestedBy, me\.id\)/);
});

test("kilit sırası: her karar istek satırından önce konu nesnesini kilitler (peekForReview, kilit, lockForReview peeked ile)", () => {
  // İsteği açan yollar konu nesnesini kilitleyip createOrUpdateRequest'e geçer; karar ters sırayla kilitlerse personelin
  // güncellemesiyle aynı anda verilen onay 40P01'e düşer (veritabanı testleri: tests/helpers/lock-race.ts)
  const walk = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const callers = walk("src/server").filter((f) => !f.endsWith("staff-requests/core.ts") && /lockForReview\(/.test(read(f)));
  assert.deepEqual(callers.sort(), [
    "src/server/cash-outs/requests.ts",
    "src/server/cash/requests.ts",
    "src/server/closed-day-requests.ts",
    "src/server/karaoke/timer.ts",
    "src/server/waste/core.ts",
  ]);
  for (const f of callers) {
    const src = read(f);
    const calls = [...src.matchAll(/await lockForReview\(tx, me, \{([^}]*)\}/g)];
    assert.ok(calls.length > 0, f);
    for (const c of calls) {
      assert.match(c[1], /\bpeeked\b/, `${f}: lockForReview peeked olmadan`);
      // Aynı işlevde, kilitten önce kilitsiz okuma (peekForReview ya da taslağın peek'i)
      const before = src.slice(0, c.index);
      const fnStart = before.lastIndexOf("export async function");
      assert.match(before.slice(fnStart), /await (peekForReview|peek)\(/, `${f}: kilitten önce okuma yok`);
    }
  }
});

test("genel eylem dosyası: tek eylem (withdrawStaffRequest), önce oturum; başka hiçbir şey dışa açık değil", () => {
  const src = read("src/server/actions/staff-requests.ts");
  assert.ok(src.startsWith('"use server";'));
  const exported = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["withdrawStaffRequest"]);
  assert.doesNotMatch(src, /^export (const|function|let|class|\{) /m);
  assert.match(src, /export async function withdrawStaffRequest\(id: number\) \{\s+return attempt\(async \(\) => \{\s+const me = await requireUser\(\);/);
  assert.match(src, /refresh\(\);/);
  // Dönen değerde istek satırı yok (yalnız null)
  assert.match(src, /return null;/);
});

test("/panel/onaylar: adı Onaylar; bölümler sırasıyla kendi Suspense'inde, her biri requireAdmin ile başlar", () => {
  const page = read("src/app/panel/onaylar/page.tsx");
  assert.match(page, /title: "Onaylar"/);
  assert.match(page, /title="Onaylar"/);
  assert.match(
    page,
    /Personelin onay isteyen önerileri ve istekleri: kasa, zayi ve ikram, karaoke, reçete\. Reddederseniz notunuz personele görünür; tutar yazmayın\./,
  );
  const order = ["<KasaRequests />", "<OpsRequests />", "<KaraokeRequests />", "<ApprovalsContent />", "<RecentDecisions />"].map((tag) => page.indexOf(tag));
  for (const [i, at] of order.entries()) assert.ok(at > 0, `bölüm ${i + 1} yok`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "bölüm sırası");
  // Beş bölüm ve tek şube seçiliyken "öbür şubelerde N istek daha" notu (şube kapsamı C P1-1)
  assert.equal(page.match(/<Suspense /g)?.length, 6);
  assert.ok(page.indexOf("<OtherBranchRequests />") < order[0], "şube notu bölümlerden önce");
  assert.match(page.slice(page.indexOf("async function ApprovalsContent")), /^async function ApprovalsContent\(\) \{\s+await requireAdmin\(\);/);
  for (const [file, fn] of [
    ["src/app/panel/onaylar/kasa-section.tsx", "KasaRequests"],
    ["src/app/panel/onaylar/ops-section.tsx", "OpsRequests"],
    ["src/app/panel/onaylar/karaoke-section.tsx", "KaraokeRequests"],
    ["src/app/panel/onaylar/recent-decisions.tsx", "RecentDecisions"],
  ] as const) {
    const src = read(file);
    assert.match(src, new RegExp(`export async function ${fn}\\(\\) \\{\\s+await requireAdmin\\(\\);`), file);
  }
  // Maliyet modeli istek başına bir kez (bölümler aynı modeli paylaşır)
  assert.match(page, /loadModelOnce\(\)/);
  assert.match(read("src/server/data/model-once.ts"), /export const loadModelOnce = cache\(loadModel\)/);
  // Reçetenin son kararları ayrı başlıkta
  assert.match(read("src/app/panel/onaylar/review-list.tsx"), /title="Reçete: son kararlar"/);
});

test("reçete onayı ekranda görülen sürümle: öneri güncellenince sürüm artar, onay seenVersion ister", () => {
  const actions = read("src/server/actions/recipe-requests.ts");
  assert.match(actions, /seenVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(actions, /if \(req\.version !== data\.seenVersion\) throw new UserError\("Öneri siz bakarken değişti; yeniden bakın"\)/);
  assert.match(actions, /version: sql`\$\{s\.recipeChangeRequests\.version\} \+ 1`/);
  const list = read("src/app/panel/onaylar/review-list.tsx");
  assert.match(list, /reviewRecipeChange\(\{ id: item\.id, seenVersion: item\.version, decision: "approve", force \}\)/);
  assert.match(list, /reviewRecipeChange\(\{ id: item\.id, seenVersion: item\.version, decision: "reject"/);
});

test("push: onay bildirimleri ayrı konu (varsayılan açık, yalnız açık aboneliklere); cihazdaki anahtar ancak gönderen varken", () => {
  const send = read("src/server/push/send.ts");
  assert.match(send, /kind: "karaoke" \| "orders" \| "reminders" \| "approvals" \| "test";/);
  assert.match(send, /topic: "karaoke" \| "orders" \| "reminders" \| "approvals" \| "test",/);
  assert.match(send, /if \(topic === "approvals"\) conditions\.push\(eq\(s\.pushSubscriptions\.approvals, true\)\);/);
  const actions = read("src/server/actions/push.ts");
  assert.match(actions, /approvals: z\.boolean\(\)\.optional\(\)/);
  assert.match(actions, /approvals: row\.approvals \}/);
  const device = read("src/components/panel/live/device-alerts.tsx");
  // Anahtar bildirim vaat eder: yalnız "approvals" konusuna gerçekten gönderen bir yol varken görünür (bu dalgada yok;
  // gönderen dalga 10b'de). Tesisat kalır: öteki konular değişince değer korunur
  const walk = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const senders = walk("src").filter((f) => /sendPush\(\s*"approvals"/.test(read(f)));
  if (senders.length) assert.match(device, /title="Onay bildirimleri"/, senders.join(", "));
  else assert.doesNotMatch(device, /title="Onay bildirimleri"|changeTopic\("approvals"/);
  assert.match(device, /approvals: topics\?\.approvals \?\? true, \[key\]: value/);
  assert.equal(staffRequests.kind.enumValues.length, 10);
});

test("sabah e-postası: Onay bekleyenler kutusu haberdir (konu, başlık, düğme Onaylar'a); yoksa e-posta kutusuz hâliyle aynı", async () => {
  const { renderDigest } = await import("../src/server/notify/digest-template");
  const now = tr("2026-10-24T08:30");
  const lines = approvalsDigestLines([{ title: "22 Ekim kasa düzeltmesi", requestedByName: "Mehmet", createdAt: tr("2026-10-22T09:00") }], now);
  const box = { title: "Onay bekleyenler", lines, href: "/panel/onaylar", link: "Onaylar'da aç", subjectPart: "1 istek onay bekliyor", headline: "1 personel isteği onay bekliyor" };
  const out = renderDigest([], "2026-10-24", null, null, null, { approvals: box });
  assert.equal(out.subject, "Sabah özeti: 1 istek onay bekliyor");
  assert.match(out.html, /1 personel isteği onay bekliyor/);
  assert.match(out.html, /22 Ekim kasa düzeltmesi \(Mehmet\)/);
  assert.match(out.html, /\/panel\/onaylar/);
  assert.match(out.text, /Onaylar'da aç: .*\/panel\/onaylar/);
  assert.doesNotMatch(`${out.html}${out.text}`, /₺/);
  // Kutu yoksa (null) kutusuz e-postanın aynısı
  assert.deepEqual(renderDigest([], "2026-10-24", null, null, null, { approvals: null }), renderDigest([], "2026-10-24", null, null, null, {}));
  // Kaynak listede, haber olarak; yükleyici yalnız başlık ve ad yazar (yük okumaz)
  const extras = read("src/server/notify/digest-extras.ts");
  assert.match(extras, /\{ key: "approvals", news: true, load: \(\) => loadApprovalsDigest\(\) \}/);
  const digest = read("src/server/staff-requests/digest.ts");
  assert.match(digest, /pendingRequests\(getDb\(\), \{ now \}\)/);
  assert.doesNotMatch(digest, /payload/);
});

test("sabah işi: süresi dolan istekler adımı (yalnız bir istek kapanınca ya da hatada yazılır); db:reset bekleyenleri geri çeker", async () => {
  const { requestsStep, stepTexts, dailyOutcome } = await import("../src/lib/job-health");
  assert.equal(requestsStep({ expired: 0 }), undefined);
  assert.deepEqual(requestsStep({ expired: 3 }), { code: "ok" });
  assert.deepEqual(requestsStep({ error: "süre doldu" }), { code: "error", error: "süre doldu" });
  assert.deepEqual(stepTexts({ requests: "ok" }), ["Süresi dolan personel istekleri kapandı"]);
  const ok = { code: "ok" };
  const base = { sync: { code: "today" }, digest: { code: "sent" }, reminders: ok, karaoke: ok, menu: ok, sales: ok };
  const bad = dailyOutcome({ ...base, requests: { code: "error", error: "bağlantı" } });
  assert.equal(bad.status, "partial");
  assert.equal(bad.message, "Personel istekleri: bağlantı");
  const route = read("src/app/api/cron/gunluk/route.ts");
  assert.match(route, /expireStaffRequests\(getDb\(\), new Date\(\)\)/);
  assert.match(route, /\.\.\.\(requestsResult \? \{ requests: requestsResult \} : \{\}\)/);
  const seed = read("scripts/seed.ts");
  assert.match(seed, /const reset = \{ reviewNote: "Veritabanı sıfırlandı", updatedAt: now \};/);
  assert.match(seed, /\.set\(\{ \.\.\.reset, status: "withdrawn" \}\)\.where\(eq\(s\.staffRequests\.status, "pending"\)\)/);
});

test("sızıntı denetimi yardımcısı: yasak anahtarları anahtar olarak bulur; sözcük, yorum ve bayrak anahtar sayılmaz", async () => {
  const { assertNoCostKeys, costKeysIn } = await import("./helpers/leak-scan");
  assert.deepEqual(costKeysIn(`{ "cost": 12, "name": "Latte" }`), ["cost"]);
  assert.deepEqual(costKeysIn(`select({ id: s.products.id, unitCost: x, priceMinor: y })`), ["unitCost", "priceMinor"]);
  assert.deepEqual(costKeysIn(`{"karaokeAmount":1500,"salary" : 3}`), ["karaokeAmount", "salary"]);
  assert.deepEqual(costKeysIn(`{ isEstimate: true, title: "maliyet yok", costly: 1, recost: 2 }`), []);
  assert.deepEqual(costKeysIn(`// cost: yalnız yorum\n/* margin: blok */ const a = { name: 1 };`), []);
  assert.throws(() => assertNoCostKeys(`{ margin: 0.3 }`, "örnek"), /örnek: personele maliyet/);
  assertNoCostKeys(`{ name: "Latte", price: 205 }`);
});

test("personele giden Adım 0 yüzeyleri: kendi istekleri, geri çekme yanıtı, Bugün'ün operasyon dalı ve e-posta satırları tutarsız", async () => {
  const { assertNoCostKeys, assertNoLira } = await import("./helpers/leak-scan");
  const core = read("src/server/staff-requests/core.ts");
  const own = core.slice(core.indexOf("export async function ownRequests"));
  assertNoCostKeys(own, "ownRequests");
  assert.doesNotMatch(own, /payload/);
  assertNoCostKeys(read("src/server/actions/staff-requests.ts"), "withdrawStaffRequest");
  const ops = read("src/server/data/today-ops.ts");
  assertNoCostKeys(ops.slice(0, ops.indexOf("posPendingSummary().then")), "today-ops personel dalı");
  assertNoCostKeys(read("src/app/panel/bugun/rows-ops.ts"), "rows-ops");
  const lines = approvalsDigestLines([{ title: "Kaldi · 5 kalem", requestedByName: "Ayşe", createdAt: NOW }], NOW);
  assertNoCostKeys(JSON.stringify(lines), "e-posta satırları");
  assertNoLira(JSON.stringify(lines), "e-posta satırları");
});
