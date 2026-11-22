// Karaoke sayacının silinmesi ve oturumun bitirilmesi (denetim E-15, E-65; docs/KARAOKE.md › Sayacı silmek, bitirmek,
// geri açmak): saf kurallar (src/lib/karaoke/timer-requests.ts) ve kaynak denetimleri. Personel ilk 10 dakikada
// doğrudan, sonra istekle siler; yönetici doğrudan; sitenin rezervasyonu silinmez. Geri aç iptal edilmiş ve süresi
// dolmuş oturumu reddeder. İşlem geçmişi metinleri ve istek başlığı adsız ve tutarsız (başlık). Eylemler kendi oturum
// ve rol denetimini yapar; çekirdek her yazımı işlem geçmişine aynı işlemde yazar ve önce sayacı kilitler. Bar ekranı,
// zil, Bugün ve Onaylar isteği görür. Veritabanı tarafı: tests/karaoke-istek-db.test.ts.
// Çalıştırma: npx tsx --test tests/karaoke-istek.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  deletedLogDetail,
  deleteRequestRefusal,
  endedLogDetail,
  KARAOKE_DELETE_FREE_MINUTES,
  KARAOKE_REQUEST_TEXT,
  karaokeDeleteMode,
  karaokeDeleteTitle,
  KaraokeDeletePayload,
  reopenLogDetail,
  reopenRefusal,
  sessionName,
  sessionWhen,
  staffKaraokeResult,
} from "../src/lib/karaoke/timer-requests";
import { WITHDRAW_LOG } from "../src/lib/staff-requests";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const START = tr("2026-10-24T21:00");
const at = (minutes: number) => START.getTime() + minutes * 60_000;

test("silme kipi: personel ilk 10 dakikada doğrudan, sonra istek; yönetici her zaman doğrudan; sitenin rezervasyonu hiç", () => {
  assert.equal(KARAOKE_DELETE_FREE_MINUTES, 10);
  const timer = { source: "panel" as const, startsAt: START.toISOString() };
  assert.equal(karaokeDeleteMode(timer, "staff", at(0)), "direct");
  assert.equal(karaokeDeleteMode(timer, "staff", at(5)), "direct");
  assert.equal(karaokeDeleteMode(timer, "staff", at(9.99)), "direct");
  // Sınır: tam 10. dakikada istek
  assert.equal(karaokeDeleteMode(timer, "staff", at(10)), "request");
  assert.equal(karaokeDeleteMode(timer, "staff", at(11)), "request");
  assert.equal(karaokeDeleteMode(timer, "staff", at(180)), "request");
  assert.equal(karaokeDeleteMode(timer, "admin", at(180)), "direct");
  // Date de olur (çekirdek satırla çağırır)
  assert.equal(karaokeDeleteMode({ source: "panel", startsAt: START }, "staff", at(11)), "request");
  for (const role of ["staff", "admin"] as const) assert.equal(karaokeDeleteMode({ source: "site", startsAt: START.toISOString() }, role, at(1)), "none");
  // İsteğe gidebilir mi: yalnız süresinden sonraki sayaç
  assert.equal(deleteRequestRefusal("request"), null);
  assert.equal(deleteRequestRefusal("direct"), KARAOKE_REQUEST_TEXT.useDirect);
  assert.equal(deleteRequestRefusal("none"), KARAOKE_REQUEST_TEXT.siteOnly);
  assert.match(KARAOKE_REQUEST_TEXT.askOnly, /10 dakika geçti; silinmesi yöneticinin onayıyla/);
});

test("geri aç: iptal edilmiş, iade edilen, ödemesi düşen ve süresi dolmuş oturum açılmaz", () => {
  const s = { status: "confirmed", paymentStatus: "paid", endsAt: new Date(at(120)), extraMinutes: 0 };
  assert.equal(reopenRefusal(s, at(30)), null);
  assert.equal(reopenRefusal({ ...s, status: "cancelled" }, at(30)), KARAOKE_REQUEST_TEXT.cancelledReopen);
  assert.equal(reopenRefusal({ ...s, paymentStatus: "refunded" }, at(30)), KARAOKE_REQUEST_TEXT.cancelledReopen);
  assert.equal(reopenRefusal({ ...s, paymentStatus: "expired" }, at(30)), KARAOKE_REQUEST_TEXT.cancelledReopen);
  assert.equal(reopenRefusal(s, at(120)), KARAOKE_REQUEST_TEXT.pastReopen, "tam bitişte");
  assert.equal(reopenRefusal(s, at(121)), KARAOKE_REQUEST_TEXT.pastReopen);
  // Uzatma bitişi öteler; metin olarak da olur (ekranın DTO'su)
  assert.equal(reopenRefusal({ ...s, extraMinutes: 15 }, at(130)), null);
  assert.equal(reopenRefusal({ ...s, endsAt: new Date(at(120)).toISOString() }, at(30)), null);
});

test("işlem geçmişi metinleri: oturum, planlanan bitiş ve ne olduğu; geri açta kim bitirmişti", () => {
  const row = { customerName: "Selin", source: "site" as const, startsAt: START, endsAt: new Date(at(120)), extraMinutes: 0 };
  assert.equal(endedLogDetail(row, new Date(at(30))), "Selin · 24 Eki 21:00–23:00 · bitirildi 21:30 (1 saat 30 dk erken)");
  assert.equal(endedLogDetail({ ...row, extraMinutes: 15 }, new Date(at(130))), "Selin · 24 Eki 21:00–23:15 · bitirildi 23:10 (5 dk erken)");
  assert.equal(endedLogDetail(row, new Date(at(127))), "Selin · 24 Eki 21:00–23:00 · süre dolunca haber verildi 23:07");
  assert.equal(endedLogDetail(row, new Date(at(-10))), "Selin · 24 Eki 21:00–23:00 · başlamadan bitirildi 20:50");
  // Adsız sayaç ve rezervasyon
  assert.equal(endedLogDetail({ ...row, customerName: null, source: "panel" }, new Date(at(30))).split(" · ")[0], "Rezervasyonsuz oturum");
  assert.equal(sessionName({ customerName: null, source: "site" }), "İsimsiz rezervasyon");
  assert.equal(reopenLogDetail({ ...row, endedAt: new Date(at(30)), endedBy: "Ayşe" }), "Selin · 24 Eki 21:00–23:00 · Ayşe bitirmişti (21:30)");
  assert.equal(reopenLogDetail({ ...row, endedAt: null, endedBy: null }), "Selin · 24 Eki 21:00–23:00 · bitirilmemişti");
  assert.equal(deletedLogDetail({ ...row, source: "panel", createdBy: "Ayşe" }), "Selin · 24 Eki 21:00–23:00 · Ayşe açmıştı");
  assert.equal(deletedLogDetail({ ...row, source: "panel", createdBy: null }), "Selin · 24 Eki 21:00–23:00");
  // Geri çekmenin izi kardeşleriyle aynı kalıpta ("… silme isteği kapandı"; inceleme K3)
  assert.equal(WITHDRAW_LOG["karaoke-sil"], "Karaoke sayacı silme isteği geri çekildi");
  // Gece yarısını geçen oturum Türkiye günüyle
  assert.equal(sessionWhen({ startsAt: tr("2026-10-24T23:30").toISOString(), endsAt: tr("2026-10-25T01:00").toISOString(), extraMinutes: 30 }), "24 Eki 23:30–01:30");
});

test("istek başlığı ve yükü adsız ve tutarsız; personelin zil metni", () => {
  const p = KaraokeDeletePayload.parse({
    sessionId: 7,
    startsAt: START.toISOString(),
    endsAt: new Date(at(120)).toISOString(),
    extraMinutes: 30,
    guests: 4,
    endedAt: null,
    endedBy: null,
    createdBy: "Ayşe",
  });
  assert.equal(karaokeDeleteTitle(p), "Karaoke sayacı silme · 24 Eki 21:00–23:30");
  assert.doesNotMatch(karaokeDeleteTitle(p), /₺|—/);
  // Etiket (misafirin adı olabilir) yüke yazılmaz: şema onu tanımaz
  assert.ok(!("customerName" in KaraokeDeletePayload.shape));
  assert.ok(!("totalMinor" in KaraokeDeletePayload.shape));
  assert.deepEqual(staffKaraokeResult({ status: "approved", when: "24 Eki 21:00–23:00", note: null }), {
    title: "Silme onaylandı: karaoke sayacı 24 Eki 21:00–23:00",
    body: "Sayaç listeden çıktı",
  });
  assert.deepEqual(staffKaraokeResult({ status: "rejected", when: "24 Eki 21:00–23:00", note: "Oda kullanıldı" }), {
    title: "Silme reddedildi: karaoke sayacı 24 Eki 21:00–23:00",
    body: "Not: Oda kullanıldı",
  });
  assert.deepEqual(staffKaraokeResult({ status: "rejected", when: "24 Eki 21:00–23:00", note: null }).body, "Yönetici not yazmadı");
  assert.deepEqual(staffKaraokeResult({ status: "superseded", when: "24 Eki 21:00–23:00", note: "Sayaç silindi" }), {
    title: "İstek kapandı: karaoke sayacı 24 Eki 21:00–23:00",
    body: "Sayaç silindi",
  });
});

test("eylemler: her dışa açık işlev önce oturumu, karar yöneticiyi denetler; personel istek açar, yönetici açamaz", () => {
  const src = read("src/server/actions/karaoke.ts");
  assert.ok(src.startsWith('"use server";'));
  const exported = [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, [
    "startKaraokeTimer",
    "extendKaraokeSession",
    "endKaraokeSession",
    "reopenKaraokeSession",
    "deleteKaraokeTimer",
    "requestKaraokeTimerDelete",
    "reviewKaraokeDeleteRequest",
    // Elle rezervasyon ve saati kapatma (22 Kasım 2026): iki rol de ekler; kaldırmanın rol kuralı deskRemoveRefusal'da
    "addDeskKaraoke",
    "removeDeskKaraoke",
    "syncKaraokeNow",
  ]);
  assert.doesNotMatch(src, /^export (const|function|let|class|\{) /m, "yardımcı dışa verilmez");
  for (const fn of exported) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const start = "return attempt(async () => {";
    const first = body.slice(body.indexOf(start) + start.length).trim().split("\n")[0];
    assert.equal(first, fn === "reviewKaraokeDeleteRequest" ? "const me = await requireAdmin();" : "const me = await requireUser();", fn);
  }
  const request = src.slice(src.indexOf("export async function requestKaraokeTimerDelete"));
  assert.match(request, /if \(me\.role === "admin"\) throw new UserError\("Yönetici doğrudan siler; istek gerekmez"\);/);
  // Bitirme, geri açma ve silme çekirdekten (işlem geçmişi aynı işlemde)
  for (const call of ["endKaraokeCore(getDb(), me, sid)", "reopenKaraokeCore(getDb(), me, sid)", "removeKaraokeTimerCore(getDb(), me, sid)", "proposeKaraokeDelete(getDb(), me, data)", "reviewKaraokeDeleteCore(getDb(), me, data)"])
    assert.ok(src.includes(call), call);
  assert.doesNotMatch(src, /\.delete\(s\.karaokeSessions\)/, "sayaç eylemde doğrudan silinmez");
  // Bitmiş oturumu uzatmak onu yeniden açar: kim bitirmişti uzatmanın izine yazılır
  assert.match(src, /bitirmişti \(\$\{trClock\(row\.endedAt\.getTime\(\)\)\.time\}\), yeniden açıldı/);
});

test("çekirdek: sayaç kilitlenir, sonra istek; her yazım işlem geçmişine aynı işlemde ve karaoke sayacını artırır", () => {
  const core = read("src/server/karaoke/timer.ts");
  assert.doesNotMatch(core, /"use server"/);
  assert.doesNotMatch(core, /getDb\(/, "veritabanını parametre alır");
  for (const fn of ["endKaraokeCore", "reopenKaraokeCore", "removeKaraokeTimerCore", "proposeKaraokeDelete", "reviewKaraokeDeleteCore"]) {
    const start = core.indexOf(`export async function ${fn}`);
    const next = core.indexOf("export ", start + 10);
    const body = core.slice(start, next < 0 ? undefined : next);
    assert.match(body, /db\.transaction\(async \(tx\) =>/, fn);
    assert.match(body, /await logIn\(tx, me, "/, `${fn}: işlem geçmişi işlemin içinde`);
    assert.match(body, /await bumpKaraokeVersion\(tx\);/, `${fn}: açık sekmeler yeni hâli alır`);
  }
  // İstek açılırken önce sayaç kilitlenir (FOR UPDATE), sonra istek
  const propose = core.slice(core.indexOf("export async function proposeKaraokeDelete"));
  assert.ok(propose.indexOf("await lockSession(tx, input.id)") < propose.indexOf("await createOrUpdateRequest("));
  assert.match(core, /\.where\(eq\(s\.karaokeSessions\.id, id\)\)\.for\("update"\)/);
  // Onayda sayaç, sonra istek (peekForReview → kilit → lockForReview peeked ile)
  const review = core.slice(core.indexOf("export async function reviewKaraokeDeleteCore"));
  const peek = review.indexOf("await peekForReview(tx, me, input.id)");
  const lock = review.indexOf("await lockSession(tx, p.sessionId)");
  const req = review.indexOf("await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now)");
  assert.ok(peek > 0 && peek < lock && lock < req, "kilit sırası");
  // Doğrudan silme ve onay bekleyen istekleri kapatır
  assert.match(core, /supersede\(tx, \{ kinds: \["karaoke-sil"\], subject: `karaoke:\$\{sessionId\}`, exceptId \}, KARAOKE_REQUEST_TEXT\.deleted, now\)/);
  // Geri aç: kimin bitirdiği temizlenmeden önce okunur
  const reopen = core.slice(core.indexOf("export async function reopenKaraokeCore"), core.indexOf("async function closeDeleteRequests"));
  assert.ok(reopen.indexOf("reopenRefusal(row, now.getTime())") < reopen.indexOf("endedAt: null, endedBy: null"));
  assert.ok(reopen.indexOf("endedAt: null, endedBy: null") < reopen.indexOf("reopenLogDetail(row)"), "önceki satırla yazılır");
});

test("bağlantılar: bar ekranı, canlı uç, geri çekme, zil, Bugün, Onaylar ve personel Yardım'ı isteği görür", () => {
  const live = read("src/app/api/canli/route.ts");
  assert.match(live, /pendingKaraokeAsks\(\),/);
  assert.match(live, /      deleteAsks,\n/);
  assert.match(read("src/lib/live.ts"), /deleteAsks\?: KaraokeDeleteAsk\[\];/);
  // Geri çekme bar ekranının satırını da değiştirir: iz ve karaoke sayacı (ETag) geri çekmeyle aynı işlemde (inceleme D1)
  const action = read("src/server/actions/staff-requests.ts");
  assert.match(action, /const \{ row, traced \} = await withdrawRequestCore\(getDb\(\), me, rid\);\n    if \(!traced\) await logActivity\(me, WITHDRAW_LOG\[row\.kind\], row\.title\);/);
  assert.doesNotMatch(action, /bumpKaraokeVersion|withdrawOwn/, "eylem işlem dışında yazmaz");
  const timer = read("src/server/karaoke/timer.ts");
  const withdraw = timer.slice(timer.indexOf("export async function withdrawRequestCore"));
  assert.match(withdraw, /return db\.transaction\(async \(tx\) => \{\n    const row = await withdrawOwn\(tx, me, id, now\);/);
  assert.match(withdraw, /await logIn\(tx, me, WITHDRAW_LOG\["karaoke-sil"\], row\.title\);\n    await bumpKaraokeVersion\(tx\);/);
  // Bar ekranının okuyucusu yük ve neden okumaz
  const reads = read("src/server/data/karaoke-requests.ts");
  const asks = reads.slice(reads.indexOf("export async function pendingKaraokeAsks"), reads.indexOf("export interface MyKaraokeRequest"));
  assert.doesNotMatch(asks, /payload|message/);
  // Ekran: kural sunucuyla aynı; istekte neden zorunlu, istemci anahtarı; isteyene İsteği geri çek; yönetici Onaylar'a
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /const deleteMode = karaokeDeleteMode\(s, admin \? "admin" : "staff", now\);/);
  assert.match(board, /requestKaraokeTimerDelete\(\{ id: s\.id, message: reason\.trim\(\), clientKey: key \}\)/);
  assert.match(board, /withdrawStaffRequest\(requestId\)/);
  // Satırda "Geri aç"ın yanında durur: tek kelimeyle ayrışmaz, telefonda karışmaz (inceleme K1)
  assert.equal(KARAOKE_REQUEST_TEXT.withdraw, "İsteği geri çek");
  assert.match(board, /<RotateCcw size=\{14\} \/> Geri aç/);
  assert.match(board, /<Undo2 size=\{14\} \/> \{KARAOKE_REQUEST_TEXT\.withdraw\}/);
  assert.match(board, /href=\{`\/panel\/onaylar#istek-\$\{a\.requestId\}`\}/);
  assert.match(board, /if \(!res\.data\.deleted\) return void \(toast\.info\(KARAOKE_REQUEST_TEXT\.askOnly\), openAsk\(\)\);/);
  assert.match(board, /p === "done" && s\.endedAt && !reopenRefusal\(s, now\)/);
  // Zil: yönetici tek satır ilk karta, personel sonuç; Bugün türü sayar; Onaylar'da bölüm
  const bell = read("src/server/bell/ops.ts");
  assert.match(bell, /karaoke sayacı silme isteği onay bekliyor/);
  assert.match(bell, /href: k\.firstId \? `\/panel\/onaylar#istek-\$\{k\.firstId\}` : "\/panel\/onaylar"/);
  assert.match(bell, /karaokeRequestNotifications\(user, now\)\.catch\(\(\) => \[\]\)/);
  assert.match(read("src/app/panel/bugun/logic.ts"), /const OPS_KINDS: StaffRequestKind\[\] = \["zayi-gec", "zayi-sil", "karaoke-sil"\];/);
  assert.match(read("src/app/panel/onaylar/karaoke-cards.tsx"), /reviewKaraokeDeleteRequest\(\{ id: card\.id, seenVersion: card\.version, decision, note: note\.trim\(\) \|\| null \}\)/);
  // İşlem geçmişinde karaoke kendi türünde ("Karaoke oturumu …" hesabın oturumu sayılmaz)
  const log = read("src/app/panel/ayarlar/settings-client.tsx");
  assert.ok(log.indexOf('{ kind: "karaoke", label: "Karaoke", keys: ["karaoke"]') > 0);
  assert.ok(log.indexOf('{ kind: "karaoke"') < log.indexOf('{ kind: "kullanici"'), "kullanıcıdan önce");
  // Personel Yardım'ı
  assert.match(read("src/app/panel/yardim/personel/content.tsx"), /Yanlış açılan sayacı ilk \{KARAOKE_DELETE_FREE_MINUTES\} dakikada/);
});
