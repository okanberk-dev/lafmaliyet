// Karaoke e-postaları (22 Kasım 2026; docs/KARAOKE.md › Hatırlatma e-postası, Personel e-postaları):
// - misafire, elle eklenen rezervasyondan bir gün önce tek hatırlatma (src/lib/karaoke/reminder.ts, şablonu
//   src/server/notify/karaoke-reminder-template.ts);
// - personele, rezervasyon günü sabah o günün listesi ve her rezervasyondan 3 saat önce o rezervasyon; ödemesi alınmamış
//   rezervasyon kırmızıyla öne çıkar (src/lib/karaoke/staff-mail.ts, şablonu src/server/notify/karaoke-staff-template.ts).
// Saf kurallar ve şablonlar burada; gerçek Postgres'le gönderim tests/karaoke-hatirlatma-db.test.ts'te.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TABLE_RULES } from "../src/lib/backup/format";
import { deskAddedToast, deskLogLine } from "../src/lib/karaoke/desk";
import {
  guestFrom,
  REMINDER_LEAD_MS,
  REMINDER_MIN_LEAD_MS,
  REMINDER_ORPHAN_MS,
  REMINDER_SKIP,
  reminderBadge,
  reminderDay,
  reminderDueAt,
  reminderHint,
  reminderLogKey,
  reminderPlanned,
  reminderPollDue,
  reminderStep,
  sessionReminder,
} from "../src/lib/karaoke/reminder";
import {
  expectsGuests,
  morningSessions,
  soonSessions,
  staffMailRecipients,
  staffMorningKey,
  staffMorningWindow,
  staffPay,
  staffSoonKey,
  type StaffMailSession,
} from "../src/lib/karaoke/staff-mail";
import { calendarLink, greetingName, renderKaraokeReminder } from "../src/server/notify/karaoke-reminder-template";
import { COLLECT_FIRST, renderStaffMorning, renderStaffSoon } from "../src/server/notify/karaoke-staff-template";

const H = 3_600_000;
/** Türkiye saatiyle an: tr("2026-11-24", 20) = 24 Kasım 20:00 (UTC+3) */
const tr = (date: string, hour: number, minute = 0) => Date.parse(`${date}T00:00:00Z`) - 3 * H + hour * H + minute * 60_000;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------- Misafir: kural

test("hatırlatma yalnız rezervasyona bir günden fazla varsa kurulur; rezervasyondan tam 24 saat önce gider", () => {
  const start = tr("2026-11-24", 20);
  assert.equal(reminderPlanned(start, tr("2026-11-22", 18)), true);
  assert.equal(reminderPlanned(start, start - REMINDER_LEAD_MS - 1), true);
  // Tam 24 saat ve daha yakını: sitenin onay e-postası zaten son bir günde gitti
  assert.equal(reminderPlanned(start, start - REMINDER_LEAD_MS), false);
  assert.equal(reminderPlanned(start, tr("2026-11-24", 10)), false);
  assert.equal(reminderDueAt(start), tr("2026-11-23", 20));
});

test("bekleyen hatırlatma: zamanı gelmeden bekler, gelince gönderir, iptalde / geç kalınca / rezervasyon yoksa vazgeçer", () => {
  const start = tr("2026-11-24", 20);
  const r = { createdAt: tr("2026-11-20", 15) };
  const session = { status: "confirmed" as const, startsAt: start, desk: "booking" as const };
  assert.deepEqual(reminderStep(r, session, tr("2026-11-23", 19, 59)), { action: "wait" });
  assert.deepEqual(reminderStep(r, session, tr("2026-11-23", 20)), { action: "send" });
  // Tetikleyici saatlerce gecikti: yine gider (söz gönderildiği güne göre "Bugün" olur)
  assert.deepEqual(reminderStep(r, session, tr("2026-11-24", 11)), { action: "send" });
  // Rezervasyona 2 saatten az kaldı: geç hatırlatma gönderilmez
  assert.deepEqual(reminderStep(r, session, start - REMINDER_MIN_LEAD_MS), { action: "skip", detail: REMINDER_SKIP.late });
  assert.deepEqual(reminderStep(r, session, start + H), { action: "skip", detail: REMINDER_SKIP.late });
  // Sitede iptal edildi (zamanı gelmeden de): adres hemen silinsin diye beklenmez
  assert.deepEqual(reminderStep(r, { ...session, status: "cancelled" }, tr("2026-11-21", 9)), { action: "skip", detail: REMINDER_SKIP.cancelled });
  assert.deepEqual(reminderStep(r, { ...session, desk: "block" }, tr("2026-11-21", 9)), { action: "skip", detail: REMINDER_SKIP.block });
  // Saati sitede ileri alınan rezervasyon yeni saate göre bekler
  assert.deepEqual(reminderStep(r, { ...session, startsAt: tr("2026-11-26", 20) }, tr("2026-11-23", 20)), { action: "wait" });
  // Kopyada yok: bir gün beklenir (henüz eşitlenmemiş olabilir), sonra vazgeçilir (sitede silinmiş)
  assert.deepEqual(reminderStep(r, null, r.createdAt + REMINDER_ORPHAN_MS), { action: "wait" });
  assert.deepEqual(reminderStep(r, null, r.createdAt + REMINDER_ORPHAN_MS + 1), { action: "skip", detail: REMINDER_SKIP.gone });
});

test("e-postanın sözü gönderildiği güne göre: yarın, bugün (geç gönderim), ileri bir gün", () => {
  assert.equal(reminderDay("2026-11-24", tr("2026-11-23", 20)), "tomorrow");
  assert.equal(reminderDay("2026-11-24", tr("2026-11-24", 0, 5)), "today");
  assert.equal(reminderDay("2026-11-27", tr("2026-11-23", 20)), "later");
  // Gece yarısından hemen önce (Türkiye): 23:59'da yarın, 00:00'da bugün
  assert.equal(reminderDay("2026-11-24", tr("2026-11-23", 23, 59)), "tomorrow");
});

test("misafire gönderen: adres panelin ayarından, görünen ad L'Affogato", () => {
  assert.equal(guestFrom("L'Affogato Panel <bildirim@laffogato.net>"), "L'Affogato <bildirim@laffogato.net>");
  assert.equal(guestFrom("bildirim@laffogato.net"), "L'Affogato <bildirim@laffogato.net>");
  assert.equal(guestFrom("  \"Kafe\" <a.b@ornek.com.tr>  "), "L'Affogato <a.b@ornek.com.tr>");
  // Okunamayan ayar olduğu gibi kalır (Resend kendi hatasını söyler)
  assert.equal(guestFrom("bozuk"), "bozuk");
});

test("ekran metinleri: ipucu, bildirim, rozet ve işlem geçmişi hatırlatmayı söyler; adres hiçbirinde yok", () => {
  const start = tr("2026-11-24", 20);
  assert.match(reminderHint(start, tr("2026-11-22", 12)), /bir gün önce de hatırlatma e-postası gider/);
  assert.match(reminderHint(start, tr("2026-11-24", 12)), /bir günden az kaldığı için ayrıca hatırlatma gitmez/);
  assert.match(deskAddedToast("booking", "24 Kas 20:00–22:00", true, true).description, /onay e-postası gider; rezervasyondan bir gün önce hatırlatma e-postası da gönderilir\.$/);
  assert.match(deskAddedToast("booking", "24 Kas 20:00–22:00", true, false).description, /Misafire onay e-postası gider\.$/);
  assert.doesNotMatch(deskAddedToast("booking", "24 Kas 20:00–22:00", false).description, /e-posta/);
  assert.doesNotMatch(deskAddedToast("block", "24 Kas 20:00–22:00", true, true).description, /e-posta/);
  const line = deskLogLine("create", "booking", { when: "24 Kas 20:00–22:00", name: "Ayşe Yılmaz", guests: 6, note: null, email: true, reminder: true });
  assert.equal(line.detail, "Ayşe · 6 kişi · 24 Kas 20:00–22:00 · misafire onay e-postası ve bir gün kala hatırlatma");
  assert.equal(deskLogLine("create", "booking", { when: "x", name: "Ayşe", guests: 2, note: null, email: true }).detail, "Ayşe · 2 kişi · x · misafire onay e-postası");
  // Rozet: bekleyen "Yarın 20:00", zamanı geçmiş ama gitmemiş "sırada", gitmiş "gönderildi"
  const now = tr("2026-11-22", 12);
  assert.equal(reminderBadge({ state: "pending", at: new Date(tr("2026-11-23", 20)).toISOString() }, now), "Hatırlatma e-postası · Yarın 20:00");
  assert.equal(reminderBadge({ state: "pending", at: new Date(now - 60_000).toISOString() }, now), "Hatırlatma e-postası sırada");
  assert.equal(reminderBadge({ state: "sent", at: new Date(now).toISOString() }, now), "Hatırlatma e-postası gönderildi");
  // Satırın verisi: iptal edilen rezervasyonda rozet yok; vazgeçilen / gönderilemeyen hatırlatmada da
  const doneAt = new Date(now);
  assert.deepEqual(sessionReminder("pending", null, start, "confirmed"), { state: "pending", at: new Date(tr("2026-11-23", 20)).toISOString() });
  assert.deepEqual(sessionReminder("sent", doneAt, start, "confirmed"), { state: "sent", at: doneAt.toISOString() });
  assert.equal(sessionReminder("pending", null, start, "cancelled"), null);
  assert.equal(sessionReminder("skipped", doneAt, start, "confirmed"), null);
  assert.equal(sessionReminder(null, null, start, "confirmed"), null);
  assert.equal(reminderLogKey("abc"), "karaoke-hatirlatma:abc");
  assert.equal(reminderPollDue(10 * 60_000, 6 * 60_000), false);
  assert.equal(reminderPollDue(11 * 60_000, 6 * 60_000), true);
});

// ---------------------------------------------------------------- Misafir: e-posta

const guestInput = {
  firstName: "ayşe yılmaz",
  date: "2026-11-24",
  startsAt: tr("2026-11-24", 20),
  endsAt: tr("2026-11-24", 22),
  guests: 6,
  paid: false,
  nowMs: tr("2026-11-23", 20),
  siteUrl: "https://laffogato.net/",
};

test("misafir e-postası: yarın sözü, gün ve saat, kişi, ödeme kafede, takvim bağlantısı; tutar ve tanıtım yok", () => {
  const m = renderKaraokeReminder(guestInput);
  assert.equal(m.subject, "Yarın karaoke: 20:00–22:00 · L'Affogato");
  assert.match(m.html, /Yarın görüşüyoruz, Ayşe!/);
  assert.match(m.html, />YARIN</);
  assert.match(m.html, /20:00&nbsp;–&nbsp;22:00/);
  assert.match(m.html, /24 Kasım Salı/);
  assert.match(m.html, /2 saat · 6 kişi/);
  assert.match(m.html, /Ödeme kafede/);
  assert.match(m.html, /Takvime ekle/);
  assert.match(m.html, /href="https:\/\/laffogato\.net"/);
  // Tutar yok (ücret kasada); tek resim sitenin L'Af işareti (alt metniyle); bağlantılar: takvim, yol tarifi, telefon, site
  assert.doesNotMatch(m.html, /₺|TL\b/);
  assert.equal(m.html.match(/<img /g)?.length, 1);
  assert.match(m.html, /src="https:\/\/laffogato\.net\/email\/laf-mark-white\.png" width="54" height="44" alt="L'Affogato"/);
  assert.equal(m.html.match(/<a /g)?.length, 4);
  assert.match(m.html, /Postane Mah\. Atatürk Cad\. No: 28/);
  assert.match(m.html, /href="tel:\+905364290919"/);
  assert.match(m.html, /tanıtım iletisi değildir/);
  assert.match(m.text, /^Yarın görüşüyoruz, Ayşe!/);
  assert.match(m.text, /Rezervasyonunuz: 24 Kasım Salı, 20:00–22:00 \(2 saat · 6 kişi\)/);
  assert.match(m.text, /Takvime ekle: https:\/\/calendar\.google\.com\//);
});

test("misafir e-postası: geç gönderimde 'Bugün', ileri günde tarih; adsız ve ödenmiş rezervasyon; ad HTML'e kaçışla girer", () => {
  const today = renderKaraokeReminder({ ...guestInput, nowMs: tr("2026-11-24", 11) });
  assert.equal(today.subject, "Bugün karaoke: 20:00–22:00 · L'Affogato");
  assert.match(today.html, /Bugün görüşüyoruz, Ayşe!/);
  const later = renderKaraokeReminder({ ...guestInput, nowMs: tr("2026-11-21", 11), firstName: null, guests: null, paid: true });
  assert.equal(later.subject, "Karaoke rezervasyonunuz: 24 Kasım Salı 20:00–22:00 · L'Affogato");
  assert.match(later.html, /Karaoke gününüz yaklaşıyor!/);
  assert.match(later.html, /Ödemeniz alındı/);
  assert.doesNotMatch(later.html, /Ödeme kafede/);
  assert.doesNotMatch(later.html, /kişi/);
  const evil = renderKaraokeReminder({ ...guestInput, firstName: '<script>alert("x")</script>' });
  assert.doesNotMatch(evil.html, /<script>/);
  assert.match(evil.html, /&lt;script&gt;/);
});

test("selam yalnız ilk adla; takvim bağlantısı UTC saatleriyle", () => {
  assert.equal(greetingName("ayşe yılmaz"), "Ayşe");
  assert.equal(greetingName("  İREM "), "İREM");
  assert.equal(greetingName("ışıl"), "Işıl");
  assert.equal(greetingName(""), null);
  assert.equal(greetingName(null), null);
  const url = new URL(calendarLink(tr("2026-11-24", 20), tr("2026-11-24", 22)));
  assert.equal(url.searchParams.get("dates"), "20261124T170000Z/20261124T190000Z");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.match(url.searchParams.get("location") ?? "", /^L'Affogato, Postane Mah\./);
});

// ---------------------------------------------------------------- Personel: kural

function session(o: Partial<StaffMailSession> & { id: number; date: string; hour: number }): StaffMailSession {
  const startsAt = tr(o.date, o.hour);
  return {
    source: "site",
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 2 * H).toISOString(),
    extraMinutes: 0,
    endedAt: null,
    guests: 4,
    customerName: "Deniz",
    note: null,
    status: "confirmed",
    paymentStatus: "paid",
    desk: null,
    ...o,
  };
}

test("personel: beklenen rezervasyon ve ödeme; elle eklenen ve kasada ödenecek 'alınacak', sitede ödenen 'ödendi'", () => {
  const paid = session({ id: 1, date: "2026-11-24", hour: 20 });
  const desk = session({ id: 2, date: "2026-11-24", hour: 14, paymentStatus: "none", desk: "booking" });
  const asked = session({ id: 3, date: "2026-11-24", hour: 16, status: "requested", paymentStatus: "none" });
  assert.equal(staffPay(paid), "paid");
  assert.equal(staffPay(desk), "collect");
  assert.equal(staffPay(asked), "collect");
  for (const s of [paid, desk, asked]) assert.equal(expectsGuests(s), true);
  // İptal, ödeme sayfasındaki tutma, iade, süresi dolan ödeme, bitirilmiş oturum, kapatılan saat ve panel sayacı beklenmez
  assert.equal(expectsGuests({ ...paid, status: "cancelled" }), false);
  assert.equal(expectsGuests({ ...paid, status: "requested", paymentStatus: "pending" }), false);
  assert.equal(expectsGuests({ ...paid, paymentStatus: "refunded" }), false);
  assert.equal(expectsGuests({ ...paid, paymentStatus: "expired" }), false);
  assert.equal(expectsGuests({ ...paid, endedAt: new Date().toISOString() }), false);
  assert.equal(expectsGuests({ ...desk, desk: "block" }), false);
  assert.equal(expectsGuests({ ...paid, source: "panel" }), false);
});

test("personel: sabah listesi 08:00–12:00 arasında, bugünün başlamamış rezervasyonları; 3 saat kala penceresi (30 dk – 3 sa)", () => {
  assert.equal(staffMorningWindow(tr("2026-11-24", 7, 59)), false);
  assert.equal(staffMorningWindow(tr("2026-11-24", 8)), true);
  assert.equal(staffMorningWindow(tr("2026-11-24", 11, 59)), true);
  assert.equal(staffMorningWindow(tr("2026-11-24", 12)), false);
  const list = [
    session({ id: 1, date: "2026-11-24", hour: 20 }),
    session({ id: 2, date: "2026-11-24", hour: 14, paymentStatus: "none", desk: "booking" }),
    session({ id: 3, date: "2026-11-25", hour: 13 }),
    session({ id: 4, date: "2026-11-24", hour: 16, status: "cancelled" }),
    session({ id: 5, date: "2026-11-24", hour: 8 }),
  ];
  const now = tr("2026-11-24", 8, 30);
  // Saat sırasıyla; yarınki, iptal edilen ve başlamış olan yok
  assert.deepEqual(morningSessions(list, now).map((s) => s.id), [2, 1]);
  // 11:00'de: 14:00 tam 3 saat sonra (girer); 20:00 girmez
  assert.deepEqual(soonSessions(list, tr("2026-11-24", 11)).map((s) => s.id), [2]);
  assert.deepEqual(soonSessions(list, tr("2026-11-24", 10, 59)).map((s) => s.id), []);
  // 30 dakikadan az kaldıysa artık gitmez
  assert.deepEqual(soonSessions(list, tr("2026-11-24", 13, 29)).map((s) => s.id), [2]);
  assert.deepEqual(soonSessions(list, tr("2026-11-24", 13, 30)).map((s) => s.id), []);
  assert.equal(staffMorningKey("2026-11-24"), "karaoke-personel-sabah:2026-11-24");
  // Saat değişirse anahtar değişir: yeni saatin 3 saat öncesinde yeniden haber verilir
  assert.notEqual(staffSoonKey(list[1]), staffSoonKey({ ...list[1], startsAt: new Date(tr("2026-11-24", 15)).toISOString() }));
});

test("personel: o gün vardiyada olanlara; plan yoksa şubenin bütün personeline (yönetici yalnız vardiyadaysa)", () => {
  const users = [
    { id: 1, email: "yonetici@x.test", role: "admin" as const, branchId: null },
    { id: 2, email: "ayse@x.test", role: "staff" as const, branchId: "tuzla" },
    { id: 3, email: "mehmet@x.test", role: "staff" as const, branchId: null },
    { id: 4, email: "marina@x.test", role: "staff" as const, branchId: "marina" },
    { id: 5, email: " ", role: "staff" as const, branchId: "tuzla" },
  ];
  // Plan yok: Tuzla'nın personeli ve şubesi boş personel; yönetici ve Marina'nın personeli değil
  assert.deepEqual(staffMailRecipients(users, [], "tuzla").map((u) => u.id), [2, 3]);
  // Plan var: yalnız o gün çalışanlar (vardiyaya yazılan yönetici dahil)
  assert.deepEqual(staffMailRecipients(users, [1, 3], "tuzla").map((u) => u.id), [1, 3]);
  // Plandakilerin e-postası yoksa (ya da hesabı pasifse: listede yok) herkese düşer
  assert.deepEqual(staffMailRecipients(users, [5, 99], "tuzla").map((u) => u.id), [2, 3]);
});

// ---------------------------------------------------------------- Personel: e-posta

test("personel sabah e-postası: ödeme alınacak rezervasyon en üstte kırmızı kutuda, 'önden alın'; konuda ad ve tutar yok", () => {
  const list = [
    session({ id: 2, date: "2026-11-24", hour: 14, paymentStatus: "none", desk: "booking", customerName: "Ayşe", note: "doğum günü" }),
    session({ id: 1, date: "2026-11-24", hour: 20 }),
  ];
  const m = renderStaffMorning(list, "2026-11-24");
  assert.equal(m.subject, "Bugün 2 karaoke rezervasyonu · 1 rezervasyonda ÖDEME ALINACAK");
  assert.match(m.html, /ÖDEME ALINACAK: 1 rezervasyon/);
  assert.ok(m.html.includes(COLLECT_FIRST), "önden alın cümlesi yok");
  assert.match(COLLECT_FIRST, /ÖNCE/);
  // Kırmızı kutu başlıktan önce (göze ilk o çarpsın)
  assert.ok(m.html.indexOf("ÖDEME ALINACAK") < m.html.indexOf("Bugün 2 karaoke rezervasyonu var"));
  assert.match(m.html, /14:00–16:00/);
  assert.match(m.html, /Ayşe · 4 kişi/);
  assert.match(m.html, /elle eklendi/);
  assert.match(m.html, /Not: doğum günü/);
  assert.match(m.html, /Ödendi \(sitede\)/);
  assert.match(m.html, /\/panel\/karaoke"/);
  // Konu ve ön izleme kilit ekranında görünür: misafirin adı yok. Tutar hiçbir yerde yok
  const preheader = /<div style="display:none[^>]*>([^<]*)<\/div>/.exec(m.html)?.[1] ?? "";
  assert.doesNotMatch(`${m.subject} ${preheader}`, /Ayşe|Deniz|doğum/);
  assert.doesNotMatch(`${m.html} ${m.text}`, /₺|TL\b/);
  assert.match(m.text, /ÖDEME ALINACAK: 1 rezervasyon\. Ücreti misafir odaya girmeden ÖNCE, kasada alın\./);
  // Hepsi ödenmişse kırmızı kutu yok
  const paid = renderStaffMorning([list[1]], "2026-11-24");
  assert.equal(paid.subject, "Bugün karaoke: 20:00–22:00 · ödendi");
  assert.doesNotMatch(paid.html, /ÖDEME ALIN/);
  assert.equal(renderStaffMorning([list[0]], "2026-11-24").subject, "Bugün karaoke: 14:00–16:00 · ÖDEME ALINACAK");
  assert.equal(renderStaffMorning([list[0], { ...list[0], id: 9 }], "2026-11-24").subject, "Bugün 2 karaoke rezervasyonu · hepsinde ÖDEME ALINACAK");
});

test("personel '3 saat kala' e-postası: ödeme alınmadıysa konu ve kırmızı kutu söyler; gecikirse kalan gerçek süre", () => {
  const desk = session({ id: 2, date: "2026-11-24", hour: 20, paymentStatus: "none", desk: "booking", customerName: "Ayşe" });
  const m = renderStaffSoon(desk, tr("2026-11-24", 17));
  assert.equal(m.subject, "Karaoke 20:00 (3 saat sonra) · ÖDEME ALINACAK");
  assert.match(m.html, />ÖDEME ALINMADI</);
  assert.ok(m.html.includes(COLLECT_FIRST));
  assert.ok(m.html.indexOf("ÖDEME ALINMADI") < m.html.indexOf("Karaoke 3 saat sonra başlıyor"));
  assert.match(m.html, /Ayşe · 4 kişi/);
  assert.doesNotMatch(m.subject, /Ayşe/);
  assert.doesNotMatch(`${m.html} ${m.text}`, /₺|TL\b/);
  // Saatlik iş geç çalıştı: "1 saat 20 dk sonra"
  assert.equal(renderStaffSoon(desk, tr("2026-11-24", 18, 41)).subject, "Karaoke 20:00 (1 saat 20 dk sonra) · ÖDEME ALINACAK");
  const paid = renderStaffSoon(session({ id: 1, date: "2026-11-24", hour: 20 }), tr("2026-11-24", 17));
  assert.equal(paid.subject, "Karaoke 20:00 (3 saat sonra) · ödendi");
  assert.doesNotMatch(paid.html, /ÖDEME ALINMADI/);
  // Onay bekleyen talep de ödenmemiştir
  assert.match(renderStaffSoon({ ...desk, desk: null, status: "requested" }, tr("2026-11-24", 17)).html, /ÖDEME ALINMADI · onay bekliyor/);
});

// ---------------------------------------------------------------- Bağlantılar (kaynak)

test("adres yalnız şifreli sütunda: yedeğe girmez, günlüğe ve işlem geçmişine yazılmaz, ekrana gitmez", () => {
  assert.ok(TABLE_RULES.karaoke_reminders?.skip, "karaoke_reminders yedeğe giriyor");
  const server = read("src/server/karaoke/reminders.ts");
  assert.match(server, /seal\(o\.email, "karaoke-reminder"\)/);
  assert.match(server, /open\(claimed\.emailSealed, "karaoke-reminder"\)/);
  // Kapanan hatırlatmada adres silinir
  assert.match(server, /emailSealed: null, claimedAt: null, doneAt: new Date\(\)/);
  // Günlük satırları adresi yazmaz
  for (const m of server.matchAll(/console\.\w+\(([^;]*)\);/g)) assert.doesNotMatch(m[1], /\bemail\b|\bto\b/, `günlükte adres: ${m[0]}`);
  assert.match(server, /recipients: REMINDER_LOG_RECIPIENT/);
  // Liste okuması yalnız durumu ve anı seçer
  const board = read("src/server/karaoke/board.ts");
  assert.match(board, /reminderStatus: s\.karaokeReminders\.status, reminderDoneAt: s\.karaokeReminders\.doneAt/);
  assert.doesNotMatch(board, /emailSealed/);
  const actions = read("src/server/actions/karaoke.ts");
  // Kaldırılan rezervasyonun hatırlatması ve adresi hemen silinir; işlem geçmişine adres girmez
  assert.match(actions, /await cancelKaraokeReminder\(row\.externalId\)/);
  assert.doesNotMatch(actions, /logActivity\([^)]*email\b(?!,)/);
});

test("tetikleyiciler: canlı yoklama (5 dakikada bir), saatlik iş ve sabah işi aynı işi çağırır", () => {
  const canli = read("src/app/api/canli/route.ts");
  assert.match(canli, /if \(linked && claimKaraokeMailPoll\(\)\) \{\s*after\(async \(\) => \{/);
  assert.match(read("src/app/api/cron/kontrol/route.ts"), /runKaraokeMails\(new Date\(\), start \+ 55_000\)/);
  assert.match(read("src/server/karaoke/history.ts"), /if \(opts\.mailDeadlineAt !== undefined\) await runKaraokeMails\(new Date\(\), opts\.mailDeadlineAt\);/);
  const staff = read("src/server/karaoke/staff-mail.ts");
  // İkisi de kendi hatasını yakalar: biri bozulsa öteki çalışır
  assert.equal(staff.match(/\.catch\(\(e: Error\) => \{/g)?.length, 2);
  // Personel e-postası Ayarlar'daki e-posta anahtarına uyar; misafirinki rezervasyona bağlıdır, uymaz
  assert.match(staff, /if \(!settings\.emailEnabled\) return none\("e-posta hatırlatmaları kapalı"\)/);
  assert.doesNotMatch(read("src/server/karaoke/reminders.ts"), /emailEnabled/);
});

test("bar ekranı: ödemesi alınmamış rezervasyon yeşil değil sarı; süren oturumda 'ücret alınmadıysa şimdi alın'", () => {
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /\{ tone: "green", text: "Ödendi" \} : \{ tone: "amber", text: "Onaylı · kasada ödenecek" \}/);
  assert.match(board, /Ödemesi kasada: ücret alınmadıysa şimdi alın/);
  assert.match(board, /reminderBadge\(s\.reminder, now\)/);
  assert.match(read("src/app/panel/karaoke/desk-dialog.tsx"), /hint=\{reminderHint\(start, nowMs\)\}/);
});
