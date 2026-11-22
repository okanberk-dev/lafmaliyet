// Karaoke: elle rezervasyon ve saati kapatma (22 Kasım 2026; docs/KARAOKE.md › Elle rezervasyon ve saati kapatma) ve
// karaoke sayacının saatinde kendiliğinden başlayıp bitişte ötmesi ("Kendiliğinden karaoke rez saatinde başlamıyordu").
// Sitenin yanıtının eşlenmesi, elle satır ve kapatılan saat işaretleri (eski sitede türetme), ay özeti ve doluluktan
// çıkma, çakışma sözü, personelin 10 dakikalık kaldırma kuralı, sayacın ve alarmın yolu (elle rezervasyon çalar,
// kapatılan saat hiç), geç öğrenilen başlangıç, cihazın varsayılanı.
// Çalıştırma: npx tsx --test tests/karaoke-elle.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { karaokeToday } from "../src/app/panel/bugun/logic";
import { defaultPrefs } from "../src/components/panel/live/prefs";
import {
  blockReason,
  deskAddedToast,
  deskCancelBody,
  deskCreateBody,
  deskDays,
  deskFetchFailure,
  deskInputSchema,
  deskInstants,
  deskLengths,
  deskLogLine,
  deskMessageFor,
  deskNow,
  deskRemoveRefusal,
  deskReply,
  deskStartHours,
  deskWhen,
  deskWhenProblem,
  DESK_TEXT,
} from "../src/lib/karaoke/desk";
import { historyValues } from "../src/lib/karaoke/history";
import { monthStats } from "../src/lib/karaoke/month";
import { occSessionsOf, type OccRow } from "../src/lib/karaoke/occupancy";
import { holdsRoom, overlapConflict, overlapMessage, overlapText, siteOverlaps, type OverlapSession } from "../src/lib/karaoke/overlap";
import {
  alarmPlan,
  deskKindOfChannel,
  isLive,
  isPlayable,
  LATE_START_MS,
  phase,
  type KaraokeSessionDTO,
} from "../src/lib/karaoke/session";
import { parseSiteResponse, readDeskFlags, sessionChannel } from "../src/lib/karaoke/site";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const at = (iso: string) => Date.parse(iso);

/** Sitenin GET satırı (saatler UTC; İstanbul = UTC+3) */
const row = (over: Record<string, unknown> = {}) => ({
  id: "krk-00042",
  date: "2026-11-28",
  startHour: 20,
  hours: 2,
  startsAt: "2026-11-28T17:00:00.000Z",
  endsAt: "2026-11-28T19:00:00.000Z",
  guests: 6,
  status: "confirmed",
  paymentStatus: "none",
  firstName: "Ayşe",
  note: "",
  totalMinor: 240_000,
  channel: "",
  createdAt: "2026-11-22T10:00:00.000Z",
  updatedAt: "2026-11-22T10:00:00.000Z",
  refundMinor: null,
  ...over,
});
const blockRow = (over: Record<string, unknown> = {}) =>
  row({ id: "krk-00043", startHour: 14, hours: 3, startsAt: "2026-11-28T11:00:00.000Z", endsAt: "2026-11-28T14:00:00.000Z", guests: 1, firstName: "Kapalı", note: "Kapalı: özel etkinlik", totalMinor: 0, desk: true, block: true, ...over });
const snapshot = (reservations: unknown[]) => ({ now: "2026-11-22T10:00:01.000Z", from: "2026-11-21", to: "2026-02-19", complete: true, reservations });

/** Panelin oturumu (ekran biçimi) */
const session = (over: Partial<KaraokeSessionDTO> = {}): KaraokeSessionDTO => ({
  id: 1,
  source: "site",
  externalId: "krk-00042",
  date: "2026-11-28",
  startsAt: "2026-11-28T17:00:00.000Z", // 20:00
  endsAt: "2026-11-28T19:00:00.000Z", // 22:00
  extraMinutes: 0,
  endedAt: null,
  endedBy: null,
  guests: 6,
  customerName: "Ayşe",
  note: null,
  status: "confirmed",
  paymentStatus: "none",
  totalMinor: 240_000,
  refund: null,
  refundMinor: null,
  lastEvent: null,
  lastEventAt: null,
  createdBy: null,
  desk: "booking",
  bookedAt: "2026-11-22T10:00:00.000Z",
  ...over,
});
const block = (over: Partial<KaraokeSessionDTO> = {}) =>
  session({
    id: 2,
    externalId: "krk-00043",
    startsAt: "2026-11-28T11:00:00.000Z", // 14:00
    endsAt: "2026-11-28T14:00:00.000Z", // 17:00
    guests: 1,
    customerName: "Kapalı",
    note: "Kapalı: özel etkinlik",
    totalMinor: 0,
    desk: "block",
    ...over,
  });

// ---------------------------------------------------------------- Sitenin yanıtı ve işaretler

test("GET satırı: desk ve block okunur; eski sitede block türetilir, desk yoksa elle satır yok; kanal sütunu", () => {
  const snap = parseSiteResponse(snapshot([row({ desk: true, block: false }), blockRow(), row({ id: "krk-00044" })]));
  assert.equal(snap.skipped, 0);
  const [booking, closed, web] = snap.reservations;
  assert.deepEqual([booking.desk, booking.block], [true, false]);
  assert.deepEqual([closed.desk, closed.block], [true, true]);
  assert.deepEqual([web.desk, web.block], [false, false], "işaret göndermeyen site: elle satır değil");
  assert.equal(sessionChannel(booking), "desk");
  assert.equal(sessionChannel(closed), "desk-block");
  assert.equal(sessionChannel({ ...web, channel: "web" }), "web");
  assert.equal(sessionChannel(web), null);
  // `block` göndermeyen (desk'i gönderen) eski site: elle, ücretsiz ve notu "Kapalı" ile başlayan satır kapatılan saattir
  assert.equal(readDeskFlags({ desk: true, totalMinor: 0, note: "Kapalı" }).block, true);
  assert.equal(readDeskFlags({ desk: true, totalMinor: 0, note: "Kapalı: bakım" }).block, true);
  assert.equal(readDeskFlags({ desk: true, totalMinor: 120_000, note: "Kapalı" }).block, false, "ücretli satır rezervasyondur");
  assert.equal(readDeskFlags({ desk: true, totalMinor: 0, note: "doğum günü" }).block, false);
  assert.equal(readDeskFlags({ desk: false, block: true, totalMinor: 0, note: "Kapalı" }).block, false, "elle olmayan satır kapatma sayılmaz");
  assert.equal(readDeskFlags({ totalMinor: 0, note: "Kapalı" }).desk, false);
  const legacy = parseSiteResponse(snapshot([blockRow({ block: undefined })])).reservations[0];
  assert.equal(legacy.block, true, "türetme okunuşta");
  // Bozuk işaret satırı düşürmez, yok sayılır
  const odd = parseSiteResponse(snapshot([row({ desk: "evet", block: 1 })]));
  assert.equal(odd.skipped, 0);
  assert.deepEqual([odd.reservations[0].desk, odd.reservations[0].block], [false, false]);
  // Kanaldan türe (DTO'nun desk'i)
  assert.equal(deskKindOfChannel("desk"), "booking");
  assert.equal(deskKindOfChannel("desk-block"), "block");
  assert.equal(deskKindOfChannel("web"), null);
  assert.equal(deskKindOfChannel(null), null);
});

test("eşitleme ve geçmiş: kanal elle satırı tutar (migration yok); kapatılan saat zil çalmaz; DTO türü verir", () => {
  const sync = read("src/server/karaoke/sync.ts");
  assert.match(sync, /channel: sessionChannel\(r\),/);
  assert.match(sync, /const notify = event !== null && !firstSync && Date\.parse\(r\.endsAt\) > now\.getTime\(\) && !r\.block;/);
  const board = read("src/server/karaoke/board.ts");
  assert.match(board, /desk: r\.source === "site" \? deskKindOfChannel\(r\.channel\) : null,/);
  assert.match(board, /bookedAt: r\.bookedAt\?\.toISOString\(\) \?\? null,/);
  // Geçmişten alma da aynı kanal (ad ve not yazılmaz; türü kanalda kalır)
  const closed = parseSiteResponse(snapshot([blockRow()])).reservations[0];
  const values = historyValues(closed);
  assert.equal(values.channel, "desk-block");
  assert.equal("note" in values, false);
  assert.equal(historyValues(parseSiteResponse(snapshot([row({ desk: true })])).reservations[0]).channel, "desk");
  assert.match(read("src/lib/karaoke/history.ts"), /channel: sessionChannel\(r\),/);
});

test("sitenin POST yanıtı: 201 satır, alanlı 400 sitenin mesajıyla, 409'lar, 404 ayrımı, imza, kurulum ve zaman aşımı", () => {
  const ok = deskReply("create", 201, { reservation: row({ desk: true, block: false }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.reservation?.id, "krk-00042");
  assert.deepEqual(deskReply("create", 201, null), { ok: true, reservation: null }, "gövde okunamasa da yazıldı");
  assert.deepEqual(deskReply("cancel", 200, { ok: true }), { ok: true, reservation: null });
  const field = deskReply("create", 400, { error: "invalid", field: "guests", message: "Kişi sayısı 1 ile 10 arasında olmalı." });
  assert.deepEqual(field, { ok: false, code: "invalid", field: "guests", message: "Kişi sayısı 1 ile 10 arasında olmalı.", setup: false, uncertain: false });
  assert.equal(!field.ok && field.field, "guests");
  for (const f of ["date", "startHour", "hours", "name", "email"] as const) {
    const r = deskReply("create", 400, { error: "invalid", field: f, message: "x" });
    assert.equal(!r.ok && r.field, f);
  }
  // Formun dışındaki alan pencerenin başında
  const actor = deskReply("create", 400, { error: "invalid", field: "actor" });
  assert.equal(!actor.ok && actor.field, null);
  assert.match(!actor.ok ? actor.message : "", /Hesabım/);
  const body = deskReply("create", 400, { error: "invalid", field: "body" });
  assert.equal(!body.ok && body.setup, true);
  const taken = deskReply("create", 409, { error: "slot_taken", field: "startHour", message: "Bu saatlerin bir kısmı dolu. Takvime bakıp başka bir saat seç." });
  assert.deepEqual(!taken.ok && [taken.code, taken.field, taken.message], ["slot_taken", "startHour", "Bu saatlerin bir kısmı dolu. Takvime bakıp başka bir saat seç."]);
  const many = deskReply("create", 409, { error: "too_many", field: "email", message: "Bu e-postanın zaten iki açık rezervasyonu var." });
  assert.equal(!many.ok && many.field, "email");
  const notDesk = deskReply("cancel", 409, { error: "not_desk" });
  assert.match(!notDesk.ok ? notDesk.message : "", /sitenin panelinden/);
  assert.equal(!deskReply("cancel", 409, { error: "already_cancelled" }).ok, true);
  assert.equal((deskReply("cancel", 409, { error: "already_cancelled" }) as { code: string }).code, "already_cancelled");
  assert.match((deskReply("create", 409, { error: "wrong_branch" }) as { message: string }).message, /Tuzla/);
  assert.match((deskReply("cancel", 404, { error: "not_found" }) as { message: string }).message, /bulunamadı/);
  const noRoute = deskReply("create", 404, null);
  assert.equal(!noRoute.ok && noRoute.setup, true, "JSON olmayan 404: sitede uç yok");
  assert.match(!noRoute.ok ? noRoute.message : "", /güncel değil/);
  const unsigned = deskReply("create", 401, { error: "unauthorized" });
  assert.equal(!unsigned.ok && unsigned.setup, true);
  assert.match(!unsigned.ok ? unsigned.message : "", /KARAOKE_SYNC_SECRET/);
  assert.equal((deskReply("create", 403, { error: "forbidden" }) as { setup: boolean }).setup, true);
  assert.equal((deskReply("create", 413, { error: "too_large" }) as { field: string }).field, "note");
  const db = deskReply("create", 503, { error: "unavailable" });
  assert.deepEqual(!db.ok && [db.setup, /yeniden deneyin/.test(db.message)], [false, true]);
  assert.equal((deskReply("create", 503, { error: "not_configured" }) as { setup: boolean }).setup, true);
  // Zaman aşımında site yazmış olabilir
  const late = deskFetchFailure("timeout", "create");
  assert.deepEqual(!late.ok && [late.uncertain, late.field], [true, null]);
  assert.match(!late.ok ? late.message : "", /yazılmış olabilir/);
  assert.equal((deskFetchFailure("network", "cancel") as { uncertain: boolean }).uncertain, false);
  // Kurulum ayrıntısı yalnız yöneticiye; sitenin kullanıcı mesajı herkese
  if (!unsigned.ok) {
    assert.match(deskMessageFor("admin", unsigned, "create"), /KARAOKE_SYNC_SECRET/);
    assert.equal(deskMessageFor("staff", unsigned, "create"), "Site bağlantısında sorun var; satır eklenmedi. Yöneticiye haber verin.");
  }
  if (!taken.ok) assert.equal(deskMessageFor("staff", taken, "create"), taken.message);
});

test("sitenin gövdesi: rezervasyonda alanlar, kapatmada telefon / e-posta / ad boş; actor kişinin adı", () => {
  const booking = deskInputSchema.parse({ kind: "booking", date: "2026-11-28", startHour: 20, hours: 2, guests: 6, name: " Ayşe ", phone: "0532 (111) 22 33", email: "AYSE@ornek.com", note: "doğum günü" });
  assert.deepEqual(JSON.parse(deskCreateBody(booking, "Mehmet")), {
    action: "create",
    kind: "booking",
    date: "2026-11-28",
    startHour: 20,
    hours: 2,
    guests: 6,
    name: "Ayşe",
    phone: "0532 111 22 33",
    email: "ayse@ornek.com",
    note: "doğum günü",
    actor: "Mehmet",
  });
  const closed = deskInputSchema.parse({ kind: "block", date: "2026-11-28", startHour: 14, hours: 3, name: "x", phone: "1", email: "a@b.co", note: "özel etkinlik" });
  const b = JSON.parse(deskCreateBody(closed, "  "));
  assert.deepEqual([b.kind, b.guests, b.name, b.phone, b.email, b.note, b.actor], ["block", 1, "", "", "", "özel etkinlik", "ladmin"]);
  assert.deepEqual(JSON.parse(deskCancelBody("krk-00042", "Ayşe")), { action: "cancel", id: "krk-00042", actor: "Ayşe" });
  // Rezervasyonda ad ve kişi zorunlu, e-posta biçimli; kapatmada değil
  assert.equal(deskInputSchema.safeParse({ kind: "booking", date: "2026-11-28", startHour: 20, hours: 2, guests: 6, name: "" }).success, false);
  assert.equal(deskInputSchema.safeParse({ kind: "booking", date: "2026-11-28", startHour: 20, hours: 2, name: "Ali" }).success, false);
  assert.equal(deskInputSchema.safeParse({ kind: "booking", date: "2026-11-28", startHour: 20, hours: 2, guests: 2, name: "Ali", email: "yok" }).success, false);
  assert.equal(deskInputSchema.safeParse({ kind: "block", date: "2026-11-28", startHour: 12, hours: 12 }).success, true);
  assert.equal(deskInputSchema.safeParse({ kind: "block", date: "2026-11-28", startHour: 23, hours: 2 }).success, false, "bitiş 24:00'ı geçmez");
  assert.equal(deskInputSchema.safeParse({ kind: "block", date: "2026-02-30", startHour: 12, hours: 1 }).success, false);
  // Panelin ve sitenin olay kaydında telefon ve e-posta yok
  const line = deskLogLine("create", "booking", { when: "28 Kas 20:00–22:00", name: "Ayşe", guests: 6, note: null, email: true });
  assert.deepEqual(line, { action: "Karaoke elle rezervasyon eklendi", detail: "Ayşe · 6 kişi · 28 Kas 20:00–22:00 · misafire onay e-postası" });
  assert.deepEqual(deskLogLine("create", "block", { when: "28 Kas 14:00–17:00", name: null, guests: 1, note: "Kapalı: özel etkinlik" }), {
    action: "Karaoke saatleri kapatıldı",
    detail: "28 Kas 14:00–17:00 · özel etkinlik",
  });
  assert.equal(deskLogLine("cancel", "block", { when: "28 Kas 14:00–17:00", name: null, guests: 1, note: "Kapalı" }).action, "Kapatılan karaoke saatleri açıldı");
  const actions = read("src/server/actions/karaoke.ts");
  const add = actions.slice(actions.indexOf("export async function addDeskKaraoke"), actions.indexOf("export async function removeDeskKaraoke"));
  assert.doesNotMatch(add, /logActivity\([^)]*(phone|email)\b/);
  assert.match(add, /createDeskBooking\(data, me\.name\)/);
  const server = read("src/server/karaoke/desk.ts");
  assert.doesNotMatch(server, /console\.\w+\([^)]*body/, "gövde (telefon, e-posta) günlüğe yazılmaz");
});

test("gün ve saat: bugünden 60 gün; bugün bitmiş saat yok, başlamış ama süren saat var; kapanışı geçmez", () => {
  const now = deskNow(at("2026-11-22T17:20:00.000Z")); // 20:20 İstanbul
  assert.deepEqual(now, { today: "2026-11-22", minutes: 20 * 60 + 20 });
  const days = deskDays(now.today);
  assert.equal(days.length, 61);
  assert.equal(days.at(-1), "2027-01-21");
  assert.deepEqual(deskStartHours({ open: 12, close: 24 }, "2026-11-22", now), [20, 21, 22, 23], "20:00 başladı ama sürüyor");
  assert.deepEqual(deskStartHours({ open: 12, close: 24 }, "2026-11-23", now), [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepEqual(deskStartHours({ open: 14, close: 26 }, "2026-11-23", now).at(-1), 23, "gece yarısını geçen oda saatinde de en geç 23:00");
  assert.deepEqual(deskLengths({ close: 24 }, 20), [1, 2, 3, 4]);
  assert.deepEqual(deskLengths({ close: 26 }, 22), [1, 2]);
  assert.equal(deskWhenProblem({ date: "2026-11-21", startHour: 20, hours: 2 }, now)?.field, "date");
  assert.equal(deskWhenProblem({ date: "2027-01-22", startHour: 20, hours: 2 }, now)?.field, "date");
  assert.equal(deskWhenProblem({ date: "2026-11-22", startHour: 19, hours: 1 }, now)?.message, "Bu saatler bugün geçti");
  assert.equal(deskWhenProblem({ date: "2026-11-22", startHour: 20, hours: 1 }, now), null);
  assert.deepEqual(deskInstants("2026-11-28", 23, 1), { start: at("2026-11-28T20:00:00.000Z"), end: at("2026-11-28T21:00:00.000Z") });
  assert.equal(deskWhen("2026-11-28", 23, 1), "28 Kas 23:00–00:00");
  assert.equal(blockReason("Kapalı: özel etkinlik"), "özel etkinlik");
  assert.equal(blockReason("Kapalı"), null);
  assert.equal(blockReason(null), null);
});

// ---------------------------------------------------------------- Kaldırma

test("kaldırma: yönetici her zaman; personel yazıldıktan sonraki ilk 10 dakikada; sitenin rezervasyonu ve kaldırılmış satır hiç", () => {
  const booked = at("2026-11-22T10:00:00.000Z");
  const s = session();
  assert.equal(deskRemoveRefusal(s, "admin", booked + 3 * 3_600_000), null);
  assert.equal(deskRemoveRefusal(s, "staff", booked + 9 * 60_000), null);
  assert.equal(deskRemoveRefusal(s, "staff", booked + 10 * 60_000), DESK_TEXT.staffLate);
  assert.match(DESK_TEXT.staffLate, /ilk 10 dakikada/);
  assert.equal(deskRemoveRefusal(block(), "staff", booked + 60_000), null, "kapatılan saat de");
  assert.equal(deskRemoveRefusal(session({ bookedAt: null }), "staff", booked), DESK_TEXT.staffLate, "anı bilinmeyen satır yöneticiye kalır");
  assert.equal(deskRemoveRefusal(session({ desk: null }), "admin", booked), DESK_TEXT.notDesk);
  assert.equal(deskRemoveRefusal(session({ status: "cancelled" }), "admin", booked), DESK_TEXT.already);
  assert.equal(deskRemoveRefusal({ desk: "booking", status: "confirmed", bookedAt: new Date(booked) }, "staff", booked + 60_000), null, "sunucu Date verir");
  // Sunucu eylemi aynı kuralla ve kaldırılmış satırı (409 already_cancelled) başarı sayar
  const actions = read("src/server/actions/karaoke.ts");
  const remove = actions.slice(actions.indexOf("export async function removeDeskKaraoke"));
  assert.match(remove, /const refusal = deskRemoveRefusal\(dto, me\.role, Date\.now\(\)\);\s+if \(refusal\) throw new UserError\(refusal\);/);
  assert.match(remove, /out\.reply\.code === "already_cancelled"/);
  // Ekran düğmeyi aynı kuralla gösterir
  assert.match(read("src/app/panel/karaoke/karaoke-board.tsx"), /deskRemoveRefusal\(s, env\.role, now\) === null/);
});

// ---------------------------------------------------------------- Sayılar

test("ay özeti: elle rezervasyon sayılır (kasada ödenecek ciro), kapatılan saat hiçbir sayıya girmez", () => {
  const web = session({ id: 3, desk: null, paymentStatus: "paid", totalMinor: 120_000, startsAt: "2026-11-27T17:00:00.000Z", endsAt: "2026-11-27T18:00:00.000Z" });
  const stats = monthStats([session(), block(), block({ id: 4, status: "cancelled" }), web]);
  assert.equal(stats.reservations, 2);
  assert.equal(stats.hours, 3);
  assert.equal(stats.revenueMinor, 360_000);
  assert.equal(stats.cancelled, 0, "kaldırılan kapatma iptal değil");
  assert.equal(isLive(block()), false);
  assert.equal(isLive(session()), true);
});

test("doluluk ve haftalık özet: kapatılan saat yükleyicide ve hesapta ayıklanır; kapalı gün kanıtı da değildir", () => {
  const base: OccRow = {
    id: 1,
    source: "site",
    startsAt: new Date("2026-11-20T11:00:00.000Z"),
    endsAt: new Date("2026-11-20T14:00:00.000Z"),
    extraMinutes: 0,
    endedAt: null,
    guests: 1,
    status: "confirmed",
    paymentStatus: "none",
    totalMinor: 0,
    bookedAt: null,
    cancelledAt: null,
    lastEvent: null,
    lastEventAt: null,
  };
  const rows: OccRow[] = [
    { ...base, channel: "desk-block" },
    { ...base, id: 2, channel: "desk", totalMinor: 240_000, guests: 6 },
    { ...base, id: 3, channel: "web" },
    { ...base, id: 4 },
  ];
  assert.deepEqual(occSessionsOf(rows).map((r) => r.id), [2, 3, 4]);
  const loader = read("src/server/karaoke/occupancy.ts");
  assert.match(loader, /is distinct from \$\{DESK_BLOCK_CHANNEL\}/);
  assert.match(loader, /return occSessionsOf\(rows\);/);
  // Haftalık özet doluluğu aynı yükleyiciden okur
  assert.match(read("src/server/weekly/collect.ts"), /loadOccupancySessions\(/);
  assert.match(read("src/server/closed-days.ts"), /sql`\$\{s\.karaokeSessions\.channel\} is distinct from \$\{DESK_BLOCK_CHANNEL\}`/);
});

test("Bugün: kapatılan saat rezervasyon sayılmaz, odayı 'dolu' göstermez; elle rezervasyon sayılır ve süren oturumdur", () => {
  const now = at("2026-11-28T17:30:00.000Z"); // 20:30
  const k = karaokeToday([session(), block({ startsAt: "2026-11-28T17:00:00.000Z", endsAt: "2026-11-28T19:00:00.000Z" })], "2026-11-28", now);
  assert.equal(k.reservations, 1);
  assert.equal(k.active?.until, "22:00");
  const onlyBlock = karaokeToday([block({ startsAt: "2026-11-28T17:00:00.000Z", endsAt: "2026-11-28T19:00:00.000Z" })], "2026-11-28", now);
  assert.deepEqual([onlyBlock.reservations, onlyBlock.active, onlyBlock.next], [0, null, null]);
});

// ---------------------------------------------------------------- Çakışma

test("çakışma: kapatılan saat odayı tutar, kendi sözüyle; rezervasyonla birlikte iki cümle; başlık", () => {
  const now = at("2026-11-28T10:00:00.000Z"); // 13:00
  const closed: OverlapSession = block();
  assert.equal(holdsRoom(closed), true);
  assert.deepEqual(siteOverlaps({ start: at("2026-11-28T12:00:00.000Z"), end: at("2026-11-28T13:00:00.000Z") }, [closed]), [closed]);
  assert.equal(overlapText([closed], now), "Bu saatler kapatıldı: 14:00–17:00 (özel etkinlik).");
  assert.equal(overlapText([block({ note: "Kapalı" })], now), "Bu saatler kapatıldı: 14:00–17:00.");
  assert.equal(overlapMessage([closed], "start", now), "Bu saatler kapatıldı: 14:00–17:00 (özel etkinlik). Yine de başlatılsın mı?");
  assert.equal(overlapMessage([closed], "extend", at("2026-11-27T10:00:00.000Z")), "Bu saatler kapatıldı: Yarın 14:00–17:00 (özel etkinlik). Yine de uzatılsın mı?");
  const both = overlapConflict([closed, session()], "start", now);
  assert.equal(both?.message, "Bu saatte sitede Ayşe adına 20:00–22:00 rezervasyon var. Bu saatler kapatıldı: 14:00–17:00 (özel etkinlik). Yine de başlatılsın mı?");
  assert.equal(both?.title, "Sitede rezervasyon var");
  assert.equal(overlapConflict([closed], "start", now)?.title, "Bu saatler kapalı");
  assert.equal(overlapConflict([session()], "start", now)?.title, "Sitede rezervasyon var");
  // Kaldırılan kapatma tutmaz
  assert.equal(holdsRoom(block({ status: "cancelled" })), false);
  // Ekranlar başlığı sunucunun çakışmasından alır
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /title=\{ask\?\.title \?\? "Sitede rezervasyon var"\}/);
  assert.match(board, /title=\{clash\?\.title \?\? "Sitede rezervasyon var"\}/);
  assert.match(read("src/components/panel/live/alert-center.tsx"), /title=\{clash\?\.title \?\? "Sitede rezervasyon var"\}/);
  // Kapatılan saat uzatılmaz, bitirilmez (bitti işareti odayı boş gösterirdi)
  assert.match(read("src/server/actions/karaoke.ts"), /if \(row\.channel === DESK_BLOCK_CHANNEL\) throw new UserError\(BLOCK_NOT_SESSION\);/);
  assert.match(read("src/server/karaoke/timer.ts"), /is distinct from \$\{DESK_BLOCK_CHANNEL\}/);
});

// ---------------------------------------------------------------- Sayaç ve alarm

test("elle rezervasyon sayacın yolundan geçer: oynar, saatinde başlar, uyarır, bitişte süre doldu; düğmeye basmadan", () => {
  const s = session();
  assert.equal(isPlayable(s), true, "onaylı, ödemesi köşkte");
  assert.equal(isPlayable(session({ status: "requested" })), true);
  assert.equal(phase(s, at("2026-11-28T16:59:00Z")), "upcoming");
  assert.equal(phase(s, at("2026-11-28T17:00:00Z")), "active");
  assert.equal(phase(s, at("2026-11-28T19:00:00Z")), "overtime", "bitişte süre doldu: şerit ve alarm (Haber verdim'e kadar)");
  assert.equal(phase({ ...s, endedAt: "2026-11-28T19:02:00Z" }, at("2026-11-28T19:03:00Z")), "done", "Haber verdim");
  const plan = alarmPlan([s], at("2026-11-28T16:00:00Z"), 10);
  assert.deepEqual(
    plan.map((a) => [a.kind, new Date(a.at).toISOString(), a.late ?? false]),
    [
      ["start", "2026-11-28T17:00:00.000Z", false],
      ["warn", "2026-11-28T18:50:00.000Z", false],
      ["end", "2026-11-28T19:00:00.000Z", false],
    ],
  );
});

test("kapatılan saat hiçbir zaman sayaç değildir: evresi 'closed', plan yok, süre dolmaz", () => {
  const b = block();
  assert.equal(isPlayable(b), false);
  for (const iso of ["2026-11-28T10:00:00Z", "2026-11-28T11:00:00Z", "2026-11-28T13:59:00Z", "2026-11-28T14:00:00Z", "2026-11-28T18:00:00Z"]) assert.equal(phase(b, at(iso)), "closed", iso);
  assert.equal(phase(block({ status: "cancelled" }), at("2026-11-28T12:00:00Z")), "cancelled");
  assert.deepEqual(alarmPlan([b], at("2026-11-28T10:00:00Z"), 10), []);
  assert.deepEqual(alarmPlan([b], at("2026-11-28T11:05:00Z"), 10), [], "geç başlangıç da yok");
  // Uyarı motoru: süre doldu yalnız 'overtime' evresinden (kapatılan saat hiç); olay ziline girmez
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /sessions\.filter\(\(s\) => phase\(s, now\) === "overtime"\)/);
  assert.match(center, /if \(isBlock\(s\) \|\| \(s\.lastEvent === "created" && s\.externalId && ADDED_HERE\.has\(s\.externalId\)\)\) continue;/);
});

test("geç öğrenilen başlangıç: son 15 dakikada başlamış ve süren oturum bir kez duyurulur; bitmiş, süresi dolmuş, eski hiç", () => {
  const s = session();
  const start = at("2026-11-28T17:00:00Z");
  // Rezervasyon cihaza 5 dakika geç ulaştı (o saate elle eklendi, sekme arkadaydı): hemen, aynı anahtarla
  const late = alarmPlan([s], start + 5 * 60_000, 10);
  assert.deepEqual(late[0], { key: `1:start:${start}`, at: start + 5 * 60_000, kind: "start", sessionId: 1, late: true });
  assert.deepEqual(late.map((a) => a.kind), ["start", "warn", "end"]);
  assert.equal(LATE_START_MS, 15 * 60_000);
  assert.equal(alarmPlan([s], start + 15 * 60_000, 10)[0].kind, "start", "15. dakikada hâlâ");
  assert.deepEqual(alarmPlan([s], start + 16 * 60_000, 10).map((a) => a.kind), ["warn", "end"], "15 dakikadan eski başlangıç çalmaz");
  // Zamanında kurulan başlangıç (bir dakikaya kadar) aynı anahtarla: iki kez çalmaz
  assert.equal(alarmPlan([s], start + 30_000, 10)[0].key, late[0].key);
  // Kısa oturum bitmiş (süresi dolmuş): başlangıç duyurulmaz, alarmı evresinden çalar
  const short = session({ endsAt: "2026-11-28T17:04:00.000Z" });
  assert.deepEqual(alarmPlan([short], start + 5 * 60_000, 0).map((a) => a.kind), ["end"]);
  assert.equal(phase(short, start + 5 * 60_000), "overtime");
  // Bitirilmiş oturum: hiçbir şey
  assert.deepEqual(alarmPlan([{ ...s, endedAt: "2026-11-28T17:02:00Z" }], start + 5 * 60_000, 10), []);
  // Uyarı motoru: geç tetiklenen başlangıç oturum bitmişse duyurulmaz; plan dakikada bir yenilenir (12 saatten ilerisi de)
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /if \(liveNow\(\) >= sessionEnd\(s\)\) return;/);
  assert.match(center, /const REPLAN_MS = 60_000;/);
  assert.match(center, /prefs\.warnMinutes, prefs\.sound, fire, planTick\]\);/);
});

test("cihazın varsayılanı: karaoke uyarıları iki rolde açık; kapalıysa ekran söyler ve 'Aç' ile açar", () => {
  assert.equal(defaultPrefs("admin").karaokeAlarms, true);
  assert.equal(defaultPrefs("staff").karaokeAlarms, true);
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /const alarmsOff = !prefs\.karaokeAlarms && \(pathname === KARAOKE_PATH \|\| karaokeNear\);/);
  assert.match(center, /title="Bu cihazda karaoke uyarıları kapalı"\s+text="Saat gelince ses ve alarm çalmaz\."/);
  assert.match(center, /onClick=\{\(\) => updatePrefs\(role, \{ karaokeAlarms: true \}\)\}/);
  // Sesli uyarıların kilidi aynı yuvada ayrı satır olarak kalır
  assert.match(center, /const sound = soundRow\(\{ needsSound, audioReady: audio === "ready", pathname, shownOn: soundShownOn \}\);/);
});

test("ekran: elle ekle iki rolde, satırda 'Elle' rozeti, kapatılan saat 'Kapalı · saat', bildirim sayacın kendiliğinden başlayacağını söyler", () => {
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /<CalendarPlus size=\{14\} aria-hidden="true" \/> Elle ekle/);
  assert.match(board, /\{s\.desk === "booking" \? <Badge tone="gray">Elle<\/Badge> : null\}/);
  assert.match(board, /Kapalı · <span className="tabular">\{timeRange\(start, end\)\}<\/span>/);
  assert.deepEqual(deskAddedToast("booking", "28 Kas 20:00–22:00", false), {
    title: "Rezervasyon eklendi · 28 Kas 20:00–22:00",
    description: "Saati gelince sayaç kendiliğinden başlar, süre dolunca alarm çalar. Ödeme köşkte alınır.",
  });
  assert.match(deskAddedToast("booking", "x", true).description, /onay e-postası/);
  assert.equal(deskAddedToast("block", "28 Kas 14:00–17:00", false).title, "Saatler kapatıldı · 28 Kas 14:00–17:00");
  // Personel tutar görmez (sunucu göndermez; ekran ayrıca yöneticiye koşullu çizer)
  assert.match(board, /\{admin && s\.totalMinor \?/);
});
