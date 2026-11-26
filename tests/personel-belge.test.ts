// Personel belgeleri (docs/PERSONEL-BELGE.md): src/lib/staff-docs.ts. Geçerliliğin durumu (bitiş günü dahil geçerli),
// hatırlatmalar (30 gün kala ve bitince, her aşama bir kez; yenilenen ve ayrılan kişinin belgesi yok), zil satırları,
// sabah e-postasının kutusu, form ve dosya denetimi; ekranlar, menü ve yetki (yalnız yönetici).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { navTreeFor, sectionTabsFor, mobileTitleFor, NAV_GROUPS } from "../src/components/panel/nav";
import { canOpen } from "../src/lib/roles";
import {
  docAlerts,
  docBellRows,
  docDigestBox,
  docFileProblem,
  docInputProblem,
  docLogKey,
  docStage,
  docStatusText,
  docTitle,
  freshDocAlerts,
  missingKinds,
  staffDocFileName,
  staffDocUrl,
  staffLeft,
  supersededIds,
  type DocFact,
} from "../src/lib/staff-docs";

const TODAY = "2026-11-26";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const fact = (o: Partial<DocFact> & { id: number }): DocFact => ({ staffId: 1, staffName: "Ayşe", kind: "saglik", validUntil: null, ...o });

test("durum: bitiş günü dahil geçerli; 30 gün ve daha azı yakında, ertesi gün bitti; bitişsiz süresiz", () => {
  assert.equal(docStage(null, TODAY), "none");
  assert.equal(docStage("2026-12-27", TODAY), "ok");
  assert.equal(docStage("2026-12-26", TODAY), "soon", "tam 30 gün kala");
  assert.equal(docStage(TODAY, TODAY), "soon", "bugün bitiyor: hâlâ geçerli");
  assert.equal(docStage("2026-11-25", TODAY), "expired");
  assert.equal(docStatusText(null, TODAY), "Süresiz");
  assert.equal(docStatusText("2027-03-12", TODAY), "12.03.2027 tarihine kadar");
  assert.equal(docStatusText("2026-12-08", TODAY), "12 gün kaldı");
  assert.equal(docStatusText("2026-11-27", TODAY), "Yarın bitiyor");
  assert.equal(docStatusText(TODAY, TODAY), "Bugün bitiyor");
  assert.equal(docStatusText("2026-11-25", TODAY), "Dün bitti");
  assert.equal(docStatusText("2026-11-21", TODAY), "5 gün önce bitti");
});

test("belgenin adı: türün adı, ek ad, Diğer'de yazılan ad", () => {
  assert.equal(docTitle({ kind: "saglik" }), "Sağlık raporu");
  assert.equal(docTitle({ kind: "saglik", label: "portör" }), "Sağlık raporu · portör");
  assert.equal(docTitle({ kind: "diger", label: "İş sözleşmesi" }), "İş sözleşmesi");
  assert.equal(docTitle({ kind: "diger" }), "Diğer belge");
  assert.equal(docTitle({ kind: "bilinmeyen", label: null }), "Belge");
});

test("yenilenen belge: aynı kişinin aynı türden daha geç biteni varsa eskisi hatırlatılmaz; süresiz yenisi de yeniler", () => {
  const docs = [
    fact({ id: 1, validUntil: "2026-11-20" }),
    fact({ id: 2, validUntil: "2027-11-20" }),
    fact({ id: 3, kind: "hijyen", validUntil: "2026-12-01" }),
    fact({ id: 4, kind: "hijyen", validUntil: null }),
    // Diğer'de ad farklıysa ayrı belge; aynı ad (büyük-küçük harf, aksan) aynı belge
    fact({ id: 5, kind: "diger", label: "İkametgâh", validUntil: "2026-11-01" }),
    fact({ id: 6, kind: "diger", label: "ikametgah", validUntil: "2026-12-10" }),
    fact({ id: 7, kind: "diger", label: "Sözleşme", validUntil: "2026-11-02" }),
    // Başka kişinin aynı türü ayrı
    fact({ id: 8, staffId: 2, staffName: "Mehmet", validUntil: "2026-11-24" }),
  ];
  assert.deepEqual([...supersededIds(docs)].sort((a, b) => a - b), [1, 3, 5]);
  const alerts = docAlerts(docs, TODAY);
  assert.deepEqual(
    alerts.map((a) => [a.id, a.stage]),
    [
      [7, "expired"],
      [8, "expired"],
      [6, "soon"],
    ],
    "bitenler önce (en eski bitiş başta), sonra yaklaşan",
  );
  // Eşit bitişte sonra eklenen geçer
  assert.deepEqual([...supersededIds([fact({ id: 10, validUntil: "2027-01-01" }), fact({ id: 11, validUntil: "2027-01-01" })])], [10]);
});

test("ayrılan ya da pasif kişinin belgesi hatırlatılmaz; bu ay ayrılan hâlâ çalışıyor sayılır", () => {
  assert.equal(staffLeft("2026-10", TODAY), true);
  assert.equal(staffLeft("2026-11", TODAY), false);
  assert.equal(staffLeft(null, TODAY), false);
  assert.equal(staffLeft(null, TODAY, false), true);
  const docs = [fact({ id: 1, validUntil: "2026-11-01", staffEndMonth: "2026-10" }), fact({ id: 2, staffId: 3, validUntil: "2026-11-01", staffActive: false }), fact({ id: 3, staffId: 4, validUntil: "2026-11-01", staffEndMonth: "2026-11" })];
  assert.deepEqual(
    docAlerts(docs, TODAY).map((a) => a.id),
    [3],
  );
});

test("hatırlatma anahtarı bitiş gününü taşır: yenilenip tarihi değişen belge yeniden hatırlatılır, aynı aşama bir kez", () => {
  assert.equal(docLogKey(5, "2026-12-10", "soon"), "belge:5:2026-12-10:30");
  assert.equal(docLogKey(5, "2026-12-10", "expired"), "belge:5:2026-12-10:bitti");
  const alerts = docAlerts([fact({ id: 5, validUntil: "2026-12-10" }), fact({ id: 6, staffId: 2, staffName: "Ali", validUntil: "2026-11-01" })], TODAY);
  assert.deepEqual(
    alerts.map((a) => a.key),
    ["belge:6:2026-11-01:bitti", "belge:5:2026-12-10:30"],
  );
  assert.deepEqual(
    freshDocAlerts(alerts, new Set(["belge:5:2026-12-10:30"])).map((a) => a.id),
    [6],
  );
  // Ertesi gün belge bitti: yeni aşama, yeni anahtar
  assert.equal(docAlerts([fact({ id: 5, validUntil: "2026-12-10" })], "2026-12-11")[0].key, "belge:5:2026-12-10:bitti");
});

test("zil: bitenler ve yaklaşanlar ayrı satır, en çok üç ad; kimlik belgelerden ve bitişlerden", () => {
  const alerts = docAlerts(
    [
      fact({ id: 1, validUntil: "2026-11-20" }),
      fact({ id: 2, staffId: 2, staffName: "Ali", kind: "hijyen", validUntil: "2026-11-10" }),
      fact({ id: 3, staffId: 3, staffName: "Can", kind: "hijyen", validUntil: "2026-11-15" }),
      fact({ id: 4, staffId: 4, staffName: "Deniz", kind: "hijyen", validUntil: "2026-11-18" }),
      fact({ id: 5, staffId: 5, staffName: "Ece", validUntil: "2026-12-01" }),
    ],
    TODAY,
  );
  const rows = docBellRows(alerts, TODAY);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "warning");
  assert.equal(rows[0].title, "4 personel belgesinin süresi doldu");
  assert.match(rows[0].body, /^Ali · Hijyen eğitimi \(16 gün önce bitti\), Can · .*, Deniz · .* ve 1 belge daha\.$/);
  assert.equal(rows[0].id, "belge-bitti-2.2026-11-10_3.2026-11-15_4.2026-11-18_1.2026-11-20");
  assert.equal(rows[0].href, "/panel/personel/belgeler");
  assert.equal(rows[1].kind, "info");
  assert.equal(rows[1].title, "1 personel belgesi 30 gün içinde bitiyor");
  assert.equal(rows[1].body, "Ece · Sağlık raporu (5 gün kaldı).");
  assert.deepEqual(docBellRows([], TODAY), []);
});

test("sabah e-postasının kutusu: konu parçası, kırmızı biten ve turuncu yaklaşan satırlar, en çok 8 satır", () => {
  assert.equal(docDigestBox([], TODAY), null);
  const many = docAlerts(
    Array.from({ length: 10 }, (_, i) => fact({ id: i + 1, staffId: i + 1, staffName: `Kişi ${i + 1}`, validUntil: i < 2 ? "2026-11-20" : "2026-12-05" })),
    TODAY,
  );
  const box = docDigestBox(many, TODAY)!;
  assert.ok(box, "kutu olmalı");
  assert.equal(box.title, "Personel belgeleri");
  assert.equal(box.subjectPart, "2 personel belgesinin süresi doldu · 8 personel belgesi 30 gün içinde bitiyor");
  assert.equal(box.headline, "2 personel belgesinin süresi doldu · 8 personel belgesi 30 gün içinde bitiyor");
  assert.equal(box.href, "/panel/personel/belgeler");
  assert.equal(box.lines.length, 9);
  assert.deepEqual(box.lines[0], { strong: "Kişi 1 · Sağlık raporu", text: "6 gün önce bitti (bitiş 20.11.2026)", tone: "bad" });
  assert.equal(box.lines[2].tone, "warn");
  assert.deepEqual(box.lines[8], { text: "ve 2 belge daha", tone: "muted" });
  assert.equal(docDigestBox(docAlerts([fact({ id: 1, validUntil: "2026-12-01" })], TODAY), TODAY)!.subjectPart, "1 personel belgesi 30 gün içinde bitiyor");
});

test("form: tür, Diğer'de ad, takvimde olan tarihler, bitiş düzenlenmeden önce değil", () => {
  assert.equal(docInputProblem({ kind: "saglik", issuedOn: "2026-01-10", validUntil: "2027-01-10" }), null);
  assert.equal(docInputProblem({ kind: "x" }), "Belge türü seçin");
  assert.equal(docInputProblem({ kind: "diger", label: "  " }), "Belgenin adını yazın");
  assert.equal(docInputProblem({ kind: "saglik", label: "a".repeat(81) }), "Belgenin adı çok uzun");
  assert.equal(docInputProblem({ kind: "saglik", validUntil: "2026-02-30" }), "Geçerlilik bitişi geçersiz");
  assert.equal(docInputProblem({ kind: "saglik", issuedOn: "2026-13-01" }), "Düzenlenme tarihi geçersiz");
  assert.equal(docInputProblem({ kind: "saglik", issuedOn: "2026-05-01", validUntil: "2026-04-30" }), "Geçerlilik bitişi düzenlenme tarihinden önce olamaz");
  assert.equal(docInputProblem({ kind: "sgk", issuedOn: "2026-05-01", validUntil: null }), null, "SGK bildirgesi süresiz");
});

test("dosya: boş değil, en çok 4 MB, içerikten okunan tür PDF ya da fotoğraf", () => {
  assert.equal(docFileProblem(1000, "application/pdf"), null);
  assert.equal(docFileProblem(1000, "image/jpeg"), null);
  assert.equal(docFileProblem(0, "image/jpeg"), "Dosya boş; yeniden seçin");
  assert.match(docFileProblem(4 * 1024 * 1024 + 1, "application/pdf")!, /4 MB/);
  assert.match(docFileProblem(1000, null)!, /Yalnız PDF, JPG, PNG ya da WebP/);
});

test("eksik belge: hijyen, sağlık raporu ve SGK; indirilen dosyanın adı ASCII ve adresi panelin yolu", () => {
  assert.deepEqual(missingKinds([{ kind: "saglik" }, { kind: "diger" }]), ["hijyen", "sgk"]);
  assert.deepEqual(missingKinds([{ kind: "saglik" }, { kind: "hijyen" }, { kind: "sgk" }]), []);
  assert.equal(staffDocFileName({ staffName: "Ayşe Yılmaz", kind: "saglik", validUntil: "2027-03-12" }, "application/pdf"), "Ayse-Yilmaz_Saglik-raporu_2027-03-12.pdf");
  assert.equal(staffDocFileName({ staffName: "Çağrı", kind: "sgk" }, "image/jpeg"), "Cagri_SGK-ise-giris.jpg");
  assert.equal(staffDocUrl(7), "/api/personel/belge/7");
  assert.equal(staffDocUrl(7, true), "/api/personel/belge/7?indir=1");
});

test("ekranlar yalnız yöneticinin: Giderler & maaşlar sekmeleri, ⌘K, telefon başlığı; personel açamaz", () => {
  assert.deepEqual(
    sectionTabsFor("giderler", "admin").map((t) => t.label),
    ["Sabit giderler", "Aylık harcamalar", "Maaşlar", "Belgeler", "Avanslar"],
  );
  for (const href of ["/panel/personel/belgeler", "/panel/personel/avans"]) {
    assert.equal(canOpen("staff", href), false, `${href} personele kapalı`);
    assert.ok(canOpen("admin", href), `${href} yöneticiye açık`);
    assert.ok(!JSON.stringify(navTreeFor("staff")).includes(href), `${href} personelin menüsünde yok`);
  }
  const palette = NAV_GROUPS.flatMap((g) => g.items);
  assert.equal(palette.find((i) => i.href === "/panel/personel/belgeler")?.label, "Personel belgeleri");
  assert.equal(palette.find((i) => i.href === "/panel/personel/avans")?.label, "Personel avansları");
  assert.equal(mobileTitleFor("/panel/personel/belgeler"), "Belgeler");
  assert.equal(mobileTitleFor("/panel/personel/avans"), "Avanslar");
  // Sayfa ve eylemler yöneticiyi ister; dosya yolu da (personel 403)
  assert.match(read("src/app/panel/personel/belgeler/page.tsx"), /await requireAdmin\(\);/);
  assert.match(read("src/app/panel/personel/avans/page.tsx"), /await requireAdmin\(\);/);
  const actions = read("src/server/actions/staff-docs.ts");
  assert.equal(actions.match(/export async function /g)?.length, actions.match(/const me = await requireAdmin\(\);/g)?.length, "her eylem requireAdmin");
  assert.match(read("src/app/api/personel/belge/[id]/route.ts"), /if \(me\.role !== "admin"\) return Response\.json\(\{ error: "Bu işlem için yönetici girişi gerekli" \}, \{ status: 403 \}\);/);
  assert.match(read("src/app/api/personel/belge/[id]/route.ts"), /"Cache-Control": "private, no-store"/);
});

test("zil ve sabah e-postası bağlı: yönetici dalında belge satırları, e-postada staffDocs kutusu", () => {
  const bell = read("src/server/actions/notifications.ts");
  const staffReturn = bell.indexOf('if (user.role !== "admin") return');
  assert.ok(bell.indexOf('safe("belge", staffDocNotifications())') > staffReturn, "yalnız yönetici dalında");
  assert.match(read("src/server/notify/digest-extras.ts"), /\{ key: "staffDocs", news: true, load: \(today, ctx\) => loadDocDigest\(getDb\(\), today, ctx\.scope \?\? ALL_BRANCHES\) \}/);
});
