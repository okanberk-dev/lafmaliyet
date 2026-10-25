// Personelin mal siparişi taslağı (plan docs/planlar/personel-yetki.md §2.4; src/lib/reorder/draft.ts): personelin
// görünümü beyaz listeden (fiyat, tutar, hedef, mesaj yok), süre (D+2 05:00), yöneticinin dört işareti, temiz taslak,
// mesajdaki onay numarası, Bugün satırı; kaynak denetimleri: eylemlerin rolleri, sayfa verisinde bağlantı ve mesaj yok,
// gönderim sunucunun kopyasıyla, yöneticinin doğrudan gönderimi işlem ve kilitle, push metinlerinde tutar yok; son
// gönderim anı, sipariş birimi karşılaştırması, geri alanın zil metni, açık sayfada "haber ver", düzenlenen kartın toplu
// onaya girmemesi, öndeki sekmede onay bildirimi, saatin eki.
// Çalıştırma: npx tsx --test tests/mal-siparisi-taslak.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// logic.ts önce yüklenir (rows-ops.ts ile döngüsel; satır listeleri logic.ts'te kurulur)
import { clip, type DayFacts } from "../src/app/panel/bugun/logic";
import { draftRow } from "../src/app/panel/bugun/rows-ops";
import {
  draftCardEdited,
  draftClean,
  draftDeadline,
  draftEdited,
  draftFlags,
  DRAFT_NUDGE_MS,
  draftNudge,
  draftSubmittedAt,
  draftTitle,
  expectedOnHand,
  firstCountAt,
  isDraftExpired,
  nudgeText,
  sameOrderUnit,
  staffDraftView,
  undoneBellBody,
  type DraftLineT,
} from "../src/lib/reorder/draft";
import { refreshesScreen } from "../src/lib/live-poll";
import { clockSuffixTR } from "../src/lib/reminders";
import { orderMessage } from "../src/lib/reorder/message";

import { assertNoCostKeys, assertNoLira, stripComments } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const line = (o: Partial<DraftLineT> = {}): DraftLineT => ({
  ingredientId: 1,
  name: "Süt",
  orderName: "SÜT 1 L",
  qty: 2,
  unit: "koli",
  unitSize: 12_000,
  countUnit: "LT",
  suggested: 2,
  onHand: 6,
  prevCount: 12,
  prevCountDay: "2026-10-20",
  expectedOnHand: 8,
  countedAt: "2026-10-26T06:30:00.000Z",
  ...o,
});

test("staffDraftView: beyaz liste; fiyatlı yükten tutar, hedef, beklenen ve mesaj geçmez", () => {
  const row = {
    id: 42,
    status: "approved" as const,
    version: 2,
    payload: {
      supplierKey: "kaldi",
      supplierCardId: 3,
      supplier: "Kaldi",
      supplierNote: "Perşembe",
      notified: true,
      pushedAt: null,
      // Yükte olmaması gereken alanlar (eski ya da bozuk kayıt): görünüme girmez
      estimate: 4250,
      lines: [{ ...line(), expectedUnitPrice: 35, packPrice: 420, cost: 12, par: 26 }],
    },
    result: { approvedLines: [{ ingredientId: 1, qty: 3 }], supplierNote: "Perşembe", message: "Merhaba … ₺", edited: true, payable: 1 },
    requestedBy: 5,
    requestedByName: "Ayşe",
    createdAt: new Date("2026-10-26T06:42:00Z"),
    reviewedByName: "Ali",
    reviewedAt: new Date("2026-10-26T07:05:00Z"),
    reviewNote: "Tamam",
    resultId: null,
    expiresAt: new Date("2026-10-28T02:00:00Z"),
  };
  const v = staffDraftView(row, { id: 5 }, new Date("2026-10-26T08:00:00Z"))!;
  const json = JSON.stringify(v);
  assert.doesNotMatch(json, /price|cost|estimate|payable|tutar|₺|message|href|par"|expected/i);
  assertNoCostKeys(json, "staffDraftView");
  assert.equal(v.mine, true);
  assert.equal(v.edited, true);
  assert.deepEqual(v.approvedLines, [{ ingredientId: 1, orderName: "SÜT 1 L", qty: 3, unit: "koli" }]);
  assert.deepEqual(Object.keys(v.lines[0]).sort(), ["countUnit", "ingredientId", "name", "onHand", "orderName", "qty", "suggested", "unit"]);
  // Süresi geçen canlı taslak "expired" okunur
  assert.equal(staffDraftView(row, { id: 9 }, new Date("2026-10-28T02:00:00Z"))!.status, "expired");
  assert.equal(staffDraftView(row, { id: 9 }, new Date("2026-10-28T02:00:00Z"))!.mine, false);
  // Bozuk yük görünmez
  assert.equal(staffDraftView({ ...row, payload: { lines: [] } }, { id: 5 }, new Date()), null);
});

test("süre: 26 Ekim 23:00'te (TR) onaylanan taslak 2026-10-28T02:00Z'ye kadar canlı; iş günü 05:00'te döner", () => {
  const at = new Date("2026-10-26T23:00:00+03:00");
  const end = draftDeadline(at);
  assert.equal(end.toISOString(), "2026-10-28T02:00:00.000Z");
  const row = { status: "approved", expiresAt: end };
  assert.equal(isDraftExpired(row, new Date("2026-10-28T01:59:59Z")), false);
  assert.equal(isDraftExpired(row, new Date("2026-10-28T02:00:00Z")), true);
  // 27 Ekim 04:30 TR hâlâ 26'nın iş günü
  assert.equal(draftDeadline(new Date("2026-10-27T04:30:00+03:00")).toISOString(), "2026-10-28T02:00:00.000Z");
  assert.equal(draftDeadline(new Date("2026-10-27T05:00:00+03:00")).toISOString(), "2026-10-29T02:00:00.000Z");
  // Son durumlar dolmaz; süresiz dolmaz
  assert.equal(isDraftExpired({ status: "done", expiresAt: end }, new Date("2026-11-01T00:00:00Z")), false);
  assert.equal(isDraftExpired({ status: "pending", expiresAt: null }, new Date("2030-01-01T00:00:00Z")), false);
});

test("işaretler: öneriden fazla, öneri yoktu, sayım beklenenden düşük, sayım taslaktan hemen önce değişti", () => {
  const draftAt = new Date("2026-10-26T06:45:00.000Z");
  const ctx = { draftAt, firstCountAt: "2026-10-26T06:00:00.000Z" };
  const keys = (l: DraftLineT, c = ctx) => draftFlags(l, c).map((f) => f.key);
  assert.deepEqual(keys(line({ countedAt: "2026-10-26T06:05:00.000Z" })), []);
  assert.deepEqual(keys(line({ qty: 3, countedAt: "2026-10-26T06:05:00.000Z" })), ["fazla"]);
  assert.deepEqual(keys(line({ suggested: null, countedAt: "2026-10-26T06:05:00.000Z" })), ["oneri-yok"]);
  assert.deepEqual(keys(line({ suggested: 0, countedAt: "2026-10-26T06:05:00.000Z" })), ["oneri-yok"]);
  // Önerisi olup 0'a indirilen satır işaret almaz
  assert.deepEqual(keys(line({ qty: 0, countedAt: "2026-10-26T06:05:00.000Z" })), []);
  // Eldeki 3, beklenen 8: yarısından az
  assert.deepEqual(keys(line({ onHand: 3, countedAt: "2026-10-26T06:05:00.000Z" })), ["dusuk-sayim"]);
  assert.deepEqual(keys(line({ onHand: 4, countedAt: "2026-10-26T06:05:00.000Z" })), []);
  // Günün sayımından 41 dk sonra ve taslaktan 4 dk önce
  const late = draftFlags(line({ countedAt: "2026-10-26T06:41:00.000Z" }), ctx);
  assert.deepEqual(late, [{ key: "gec-sayim", text: "Sayım taslaktan 4 dk önce değişti" }]);
  // Hepsi aynı oturumda sayıldıysa (ilk sayım da 06:41) işaret yok
  assert.deepEqual(keys(line({ countedAt: "2026-10-26T06:41:00.000Z" }), { draftAt, firstCountAt: "2026-10-26T06:30:00.000Z" }), []);
  assert.equal(firstCountAt([line({ countedAt: "2026-10-26T06:41:00.000Z" }), line({ countedAt: "2026-10-26T06:00:00.000Z" }), line({ countedAt: null })]), "2026-10-26T06:00:00.000Z");
});

test("temiz taslak, düzenleme, başlık, beklenen eldeki ve yöneticiye haber metni", () => {
  const at = new Date("2026-10-26T09:00:00Z");
  assert.equal(draftClean({ lines: [line(), line({ ingredientId: 2, qty: 1, suggested: 1 })] }, at), true);
  assert.equal(draftClean({ lines: [line({ qty: 3 })] }, at), false);
  assert.equal(draftClean({ lines: [line({ suggested: null })] }, at), false);
  assert.equal(draftClean({ lines: [line({ onHand: 1 })] }, at), false);
  assert.equal(draftEdited([line()], [{ ingredientId: 1, qty: 2 }]), false);
  assert.equal(draftEdited([line()], [{ ingredientId: 1, qty: 3 }]), true);
  assert.equal(draftEdited([line(), line({ ingredientId: 2 })], [{ ingredientId: 1, qty: 2 }]), true);
  assert.equal(draftTitle("Kaldi", [{ qty: 2 }, { qty: 0 }, { qty: 1 }]), "Kaldi · 2 kalem");
  assert.equal(expectedOnHand(12, 1, 6), 6);
  assert.equal(expectedOnHand(2, 1, 6), 0);
  assert.equal(expectedOnHand(null, 1, 6), null);
  assert.equal(expectedOnHand(12, null, 6), null);
  assert.equal(
    nudgeText("Kaldi", 5, "https://ladmin.laffogato.net/panel/onaylar#istek-12"),
    "Mal siparişi taslağı onay bekliyor: Kaldi (5 kalem). https://ladmin.laffogato.net/panel/onaylar#istek-12",
  );
});

test("mesaj: onay numarası 'Teşekkürler.'den önce; fiyat yok; ref yoksa eski metin aynı", () => {
  const lines = [{ orderName: "SÜT 1 L", qty: 2, unit: "koli" }];
  const plain = orderMessage({ signature: "L'Affogato", lines, note: "Perşembe" });
  assert.equal(plain, "Merhaba, *L'Affogato* siparişimiz:\n\n• SÜT 1 L: 2 koli\n\nNot: Perşembe\nTeşekkürler.");
  const ref = orderMessage({ signature: "L'Affogato", lines, note: "Perşembe", ref: 42 });
  assert.equal(ref, "Merhaba, *L'Affogato* siparişimiz:\n\n• SÜT 1 L: 2 koli\n\nNot: Perşembe\nOnay no: #42\nTeşekkürler.");
  assert.doesNotMatch(ref, /₺|TL|fiyat/i);
});

test("Bugün (personel): onaylanan sipariş bekliyor, eylem Gönder; yöneticide ve taslak yokken satır yok", () => {
  const base = { now: new Date("2026-10-26T09:00:00Z") } as unknown as DayFacts;
  const c = {} as Parameters<typeof draftRow>[1];
  const staff = draftRow({ ...base, role: "staff", ops: { drafts: [{ id: 3, supplier: "Kaldi" }] } } as DayFacts, c);
  assert.ok(staff && !Array.isArray(staff));
  assert.equal(staff.key, "mal-taslak");
  assert.equal(staff.title, "Onaylanan sipariş bekliyor: Kaldi");
  assert.equal(staff.action, "Gönder");
  assert.equal(staff.href, "/panel/hizli-sayim/siparis");
  const two = draftRow({ ...base, role: "staff", ops: { drafts: [{ id: 3, supplier: "Kaldi" }, { id: 4, supplier: "Sütaş" }] } } as DayFacts, c);
  assert.ok(two && !Array.isArray(two));
  assert.equal(two.title, `Onaylanan sipariş bekliyor: ${clip("Kaldi, Sütaş", 60)}`);
  assert.equal(two.badge, "2 tedarikçi");
  assert.equal(draftRow({ ...base, role: "admin", ops: { drafts: [{ id: 3, supplier: "Kaldi" }] } } as DayFacts, c), null);
  assert.equal(draftRow({ ...base, role: "staff", ops: { drafts: [] } } as DayFacts, c), null);
  assert.equal(draftRow({ ...base, role: "staff" } as DayFacts, c), null);
});

// ---------------------------------------------------------------- Kaynak denetimleri

/** Bir fonksiyonun gövdesi (sonraki üst düzey tanıma kadar) */
function bodyOf(src: string, name: string): string {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} yok`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\n(export )?(const|interface|type) /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("eylemler: beş uç ve rolleri; yardımcı dışa açık değil; gönderimin şemasında mesaj yok", () => {
  const src = read("src/server/actions/order-drafts.ts");
  assert.match(src, /^"use server";/);
  const exported = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ["approveCleanDrafts", "reviewOrderDraft", "sendApprovedDraft", "submitOrderDraft", "undoDraftSend"]);
  assert.doesNotMatch(src, /^export (const|function|let) /m);
  const role: Record<string, string> = {
    submitOrderDraft: "requireUser",
    reviewOrderDraft: "requireAdmin",
    approveCleanDrafts: "requireAdmin",
    sendApprovedDraft: "requireUser",
    undoDraftSend: "requireUser",
  };
  for (const name of exported) assert.match(bodyOf(src, name).slice(0, 200), new RegExp(`const me = await ${role[name]}\\(\\);`), name);
  // Gönderim yalnız kimlik alır ve yalnız siparişin kimliğini ve bağlantıyı döner
  const send = bodyOf(src, "sendApprovedDraft");
  assert.match(send, /z\.object\(\{ id: zId \}\)\.parse\(input\)/);
  assert.match(send, /return \{ orderId: out\.orderId, href: out\.href \};/);
  assert.doesNotMatch(send, /message/);
  // Personelin taslağı: yalnız kalem kimliği, miktar ve not (tedarikçi, birim, mesaj, numara sunucuda)
  const submit = src.slice(src.indexOf("const submitSchema"), src.indexOf("export async function submitOrderDraft"));
  assert.doesNotMatch(submit, /message|phone|unit|orderName|price/);
  assert.match(bodyOf(src, "submitOrderDraft"), /return \{ id: out\.row\.id, notified: out\.notified \};/);
});

test("çekirdek: gönderim sunucunun kopyasıyla (orderSnapshot) ve `taslak:<id>` ile; beş yazım aynı kilitte; onayda mesaj ve onay no", () => {
  const core = read("src/server/order-drafts/core.ts");
  assert.doesNotMatch(core, /^"use server"/m);
  assert.match(bodyOf(core, "sendDraftCore"), /deps\.snapshot\(/);
  assert.match(bodyOf(core, "sendDraftCore"), /const requestId = `taslak:\$\{row\.id\}`;/);
  assert.match(bodyOf(core, "sendDraftCore"), /onConflictDoNothing\(\{ target: o\.requestId \}\)/);
  assert.match(bodyOf(core, "sendDraftCore"), /link\.target !== "numara"/);
  for (const fn of ["submitDraftCore", "reviewDraftCore", "sendDraftCore", "undoDraftSendCore"]) assert.match(bodyOf(core, fn), /await lockSupplier\(tx, /, fn);
  assert.match(bodyOf(core, "reviewDraftCore"), /orderMessage\(\{[\s\S]*ref: input\.id/);
  // Yöneticinin personele notu mesaja girmez
  assert.doesNotMatch(bodyOf(core, "reviewDraftCore").slice(bodyOf(core, "reviewDraftCore").indexOf("orderMessage(")).slice(0, 300), /note: note|input\.note/);
  assert.match(read("src/server/data/order-drafts.ts"), /snapshot: \(key, wanted\) => orderSnapshot\(key, wanted\)/);
});

test("yöneticinin doğrudan gönderimi: işlem, aynı kilit ve canlı taslağı kapatma; 23505 kullanıcı mesajı; uçlar değişmedi", () => {
  const src = read("src/server/actions/reorder.ts");
  const body = bodyOf(src, "recordOrderSent");
  assert.match(body, /db\.transaction\(async \(tx\) => \{\s+await lockSupplier\(tx, data\.supplierKey\);/);
  assert.match(body, /supersedeLiveDraft\(tx, data\.supplierKey, me, now\)/);
  assert.match(body, /"23505"/);
});

test("personelin sayfası: sayfa verisinde bağlantı, mesaj, numara ve fiyat yok; ₺ yok; yönetici Mal siparişi'ne", () => {
  const data = read("src/server/data/order-drafts.ts");
  const sheet = bodyOf(data, "loadDraftSheet");
  assertNoCostKeys(sheet, "loadDraftSheet");
  assert.doesNotMatch(stripComments(sheet), /\bhref\b|message|expectedUnitPrice|packPrice|estimate|\.phone\b(?!\))/);
  const types = data.slice(data.indexOf("export interface DraftSheetLine"), data.indexOf("/** Bir tedarikçinin son taslakları"));
  assert.doesNotMatch(stripComments(types).replace(/"no-phone"/g, ""), /href|message|phone|price|par\b|perDay/);
  const page = read("src/app/panel/hizli-sayim/siparis/page.tsx");
  assert.match(page, /const user = await requireUser\(\);\s+if \(user\.role === "admin"\) redirect\("\/panel\/mal-siparisi"\);/);
  assert.doesNotMatch(page, /loadModel|loadReorderData|tl\(|money\(/);
  for (const f of ["src/app/panel/hizli-sayim/siparis/draft-sheet.tsx", "src/app/panel/hizli-sayim/siparis/page.tsx", "src/lib/reorder/draft.ts"]) {
    assertNoCostKeys(read(f), f);
    assertNoLira(stripComments(read(f)), f);
  }
  const client = stripComments(read("src/app/panel/hizli-sayim/siparis/draft-sheet.tsx"));
  assert.doesNotMatch(client, /tl\(|money\(|Metni kopyala|copyText/);
  // WhatsApp yalnız gönderim yanıtından (önce kayıt)
  assert.match(client, /const res = await sendApprovedDraft\(\{ id \}\);[\s\S]{0,140}window\.location\.assign\(res\.data\.href\)/);
});

test("Bugün ve zil: personelin olgusu modelsiz; zil iki rolde; push metinlerinde tutar yok", () => {
  const ops = read("src/server/data/today-ops.ts");
  assert.match(ops, /safe\(staffApprovedDrafts\(now\)\)/);
  const light = bodyOf(read("src/server/data/order-drafts.ts"), "staffApprovedDrafts");
  assert.doesNotMatch(light, /loadModel|loadReorderData|payable|price/);
  assert.match(read("src/server/bell/ops.ts"), /draftNotifications\(user, now\)\.catch\(\(\) => \[\]\)/);
  for (const f of ["src/server/order-drafts/notify.ts", "src/server/actions/order-drafts.ts"]) assertNoLira(stripComments(read(f)), f);
  assert.match(read("src/server/order-drafts/notify.ts"), /sendPush\("approvals", \{ kind: "approvals", [^}]*tag: `istek-\$\{id\}` \}/);
});

test("son gönderim anı: yükteki submittedAt, eski yükte satırın açıldığı an; işaretler ona göre", () => {
  const created = new Date("2026-10-26T05:05:00.000Z");
  assert.equal(draftSubmittedAt({ createdAt: created }, { submittedAt: null }).getTime(), created.getTime());
  assert.equal(draftSubmittedAt({ createdAt: created }, { submittedAt: "2026-10-26T05:41:00.000Z" }).toISOString(), "2026-10-26T05:41:00.000Z");
  assert.equal(draftSubmittedAt({ createdAt: created }, { submittedAt: "bozuk" }).getTime(), created.getTime());
  // 08:00'de sayıldı, 08:05'te açıldı; Süt 08:40'ta yeniden sayıldı, 08:41'de güncellendi
  const lines = [line({ ingredientId: 1, countedAt: "2026-10-26T05:40:00.000Z" }), line({ ingredientId: 2, countedAt: "2026-10-26T05:00:00.000Z" })];
  assert.equal(draftClean({ lines }, created), true);
  assert.equal(draftClean({ lines }, new Date("2026-10-26T05:41:00.000Z")), false);
});

test("sipariş birimi: ad, birim ve 1 birimin içeriği aynı olmalı", () => {
  const a = { orderName: "SÜT 1 L", unit: "koli", unitSize: 12_000 };
  assert.equal(sameOrderUnit(a, { ...a }), true);
  assert.equal(sameOrderUnit(a, { ...a, unit: "LT" }), false);
  assert.equal(sameOrderUnit(a, { ...a, unitSize: 6000 }), false);
  assert.equal(sameOrderUnit(a, { ...a, orderName: "SÜT 1 L TAM YAĞLI" }), false);
});

test("zil: geri alınan gönderimde geri alan; hazırlayandan farklıysa ikisi", () => {
  assert.equal(undoneBellBody({ requestedByName: "Ayşe", undoneByName: "Selin" }), "Selin gönderimi geri aldı (Ayşe hazırlamıştı); tedarikçiye iptal yazılmalı.");
  assert.equal(undoneBellBody({ requestedByName: "Ayşe", undoneByName: "Ayşe" }), "Ayşe gönderimi geri aldı; tedarikçiye iptal yazılmalı.");
  assert.equal(undoneBellBody({ requestedByName: "Ayşe", undoneByName: null }), "Ayşe gönderimi geri aldı; tedarikçiye iptal yazılmalı.");
  const bell = read("src/server/bell/ops.ts");
  assert.match(bell, /body: undoneBellBody\(r\)/);
  assert.match(read("src/server/data/order-drafts.ts"), /leftJoin\(so, eq\(so\.id, r\.resultId\)\)/);
});

test("'Yöneticiye haber ver': yöneticiye ulaşılamadıysa hemen, yoksa 30 dakika sonra; açık sayfada saatle", () => {
  const view = { mine: true, notified: true, createdAt: "2026-10-26T06:00:00.000Z" };
  const t = Date.parse(view.createdAt);
  assert.equal(draftNudge(view, t + DRAFT_NUDGE_MS - 1), false);
  assert.equal(draftNudge(view, t + DRAFT_NUDGE_MS), true);
  // Saat henüz yok (ilk çizim)
  assert.equal(draftNudge(view, 0), false);
  assert.equal(draftNudge({ ...view, notified: false }, 0), true);
  assert.equal(draftNudge({ ...view, mine: false }, t + DRAFT_NUDGE_MS), false);
  const sheet = read("src/app/panel/hizli-sayim/siparis/draft-sheet.tsx");
  assert.match(sheet, /useClock\(60_000\)/);
  assert.match(sheet, /card\.nudge \|\| draftNudge\(draft, clock\)/);
  assert.match(read("src/server/data/order-drafts.ts"), /draftNudge\(view, now\.getTime\(\)\)/);
});

test("İşaretsizleri onayla: açılıp değiştirilen kart (miktar ya da not) toplu onaya girmez; hiçbiri onaylanmazsa uyarı", () => {
  const card = { lines: [{ ingredientId: 1, qty: 4 }, { ingredientId: 2, qty: 1 }], supplierNote: "Perşembe" };
  assert.equal(draftCardEdited(card, { 1: 4, 2: 1 }, "Perşembe"), false);
  assert.equal(draftCardEdited(card, { 1: 4, 2: 1 }, "  Perşembe "), false);
  assert.equal(draftCardEdited(card, { 1: 2, 2: 1 }, "Perşembe"), true);
  assert.equal(draftCardEdited(card, { 1: 4, 2: 1 }, "Cuma"), true);
  assert.equal(draftCardEdited({ ...card, supplierNote: null }, { 1: 4, 2: 1 }, ""), false);
  const ui = read("src/app/panel/onaylar/draft-cards.tsx");
  assert.match(ui, /cards\.filter\(\(c\) => c\.clean && !edited\.has\(c\.id\)\)/);
  assert.match(ui, /if \(!res\.data\.approved\) return void toast\.warning\(/);
  assert.match(ui, /onEdited\(card\.id, draftCardEdited\(card, next, supplierNote\)\)/);
});

test("onay bildirimi öndeki sekmede: bildirim, zil ve Onaylar / taslak sayfası yenilenir", () => {
  assert.equal(refreshesScreen("/panel/onaylar", "approvals"), true);
  assert.equal(refreshesScreen("/panel/hizli-sayim/siparis", "approvals"), true);
  assert.equal(refreshesScreen("/panel/bugun", "approvals"), true);
  assert.equal(refreshesScreen("/panel/onaylar", "karaoke"), false);
  assert.equal(refreshesScreen("/panel/hizli-sayim", "approvals"), false);
  assert.equal(refreshesScreen("/panel/karaoke", undefined), true);
  const center = read("src/components/panel/live/alert-center.tsx");
  const branch = center.slice(center.indexOf('if (msg.kind === "approvals")'), center.indexOf("void refreshLive().then(() => refreshScreen(msg.kind))"));
  assert.ok(branch.length > 0, "approvals dalı yok");
  assert.match(branch, /refreshScreen\(msg\.kind\)/);
  assert.match(branch, /dispatchEvent\(new Event\(ALERTS_REFRESH_EVENT\)\)/);
  assert.match(branch, /toast\.info\(msg\.title/);
  assert.match(read("src/components/panel/sidebar.tsx"), /addEventListener\(ALERTS_REFRESH_EVENT, refreshAlerts\)/);
});

test("saatin eki okunuşa göre: 09:42'de, 09:40'ta, 20:00'den; taslak ve ret metninde sabit 'te yok", () => {
  assert.equal(clockSuffixTR("09:42"), "09:42'de");
  assert.equal(clockSuffixTR("09:43"), "09:43'te");
  assert.equal(clockSuffixTR("09:40"), "09:40'ta");
  assert.equal(clockSuffixTR("09:30"), "09:30'da");
  assert.equal(clockSuffixTR("09:50"), "09:50'de");
  assert.equal(clockSuffixTR("09:46"), "09:46'da");
  assert.equal(clockSuffixTR("10:00"), "10:00'da");
  assert.equal(clockSuffixTR("05:00"), "05:00'te");
  assert.equal(clockSuffixTR("00:00"), "00:00'da");
  assert.equal(clockSuffixTR("20:00", "abl"), "20:00'den");
  assert.equal(clockSuffixTR("05:00", "abl"), "05:00'ten");
  assert.equal(clockSuffixTR("24 Eki 10:05"), "24 Eki 10:05'te");
  assert.equal(clockSuffixTR("dün"), "dün");
  assert.doesNotMatch(read("src/app/panel/hizli-sayim/siparis/draft-sheet.tsx"), /&apos;te sipariş gönderildi/);
  assert.doesNotMatch(read("src/server/order-drafts/core.ts"), /'te sipariş gönderildi/);
});
