// Kasa açılışı (docs/ASILPOS.md › Kasa açılışı): saf kurallar (src/lib/asilpos/kasa-acilis.ts), kasa durumunun açık
// kaydı (src/lib/asilpos/kasa-durumu.ts), e-postalar ve kaynak taraması: uçlar ortak giriş korumalarını kullanır, bağla
// kurulu şubede anahtara hiç dokunmaz, korunan eylemler asıl yöneticide, var olan uçların sözleşmesi aynı.
// Veritabanında davranış: tests/kasa-acilis-db.test.ts.
// Çalıştırma: npx tsx --test tests/kasa-acilis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { baglandiMail, serbestMail } from "../src/lib/asilpos/kasa-acilis-mail";
import {
  ACILIS_YOLLARI,
  acilisSubesi,
  acilistaListelenir,
  BELIRTEC_DAKIKA,
  buKasaMi,
  doluSatirlar,
  ILK_PERSONEL_ROLLERI,
  ilkPersonelDurumu,
  ilkPersonelHatasi,
  ilkPersonelKaydi,
  ilkPersonelTemizle,
  kasaBilgisi,
  kasaKaydi,
  kodKasaBilgisi,
  KURULU_NEDEN,
  ORNEK_PINLER,
  pinHatasi,
  SERBEST_ONAY,
  zatenKuruluMesaji,
  type IlkPersonelKaydi,
} from "../src/lib/asilpos/kasa-acilis";
import { kasaDurumu, type KasaKaniti } from "../src/lib/asilpos/kasa-durumu";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const fnBody = (file: string, name: string) => {
  const src = read(file);
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${file} › ${name} yok`);
  const end = src.indexOf("\nexport ", start + 10);
  return src.slice(start, end < 0 ? undefined : end);
};
const NOW = new Date("2026-11-28T12:00:00Z");
const ANAHTAR = "M".repeat(392);

test("kasa alanı: kimlik zorunlu ve biçimli; sürüm ve açık anahtar isteğe bağlı, bozuksa yok sayılır", () => {
  assert.deepEqual(kasaBilgisi({ kimlik: "0123456789abcdef01234567", surum: "1.4.2", acikAnahtar: ANAHTAR }), { kimlik: "0123456789abcdef01234567", surum: "1.4.2", acikAnahtar: ANAHTAR });
  assert.deepEqual(kasaBilgisi({ kimlik: "01JD3Z8Q7X5K2M4N6P8R0T2V4W" }), { kimlik: "01JD3Z8Q7X5K2M4N6P8R0T2V4W", surum: null, acikAnahtar: null });
  for (const bad of [null, "x", [], {}, { kimlik: "kisa" }, { kimlik: "boşluk var 123" }, { kimlik: "a".repeat(65) }]) assert.equal(kasaBilgisi(bad), null, JSON.stringify(bad));
  assert.deepEqual(kasaBilgisi({ kimlik: "kasa-00000001", surum: "1 2", acikAnahtar: "kısa" }), { kimlik: "kasa-00000001", surum: null, acikAnahtar: null });
  // Kurulum kodu: eski kasa yalnız kod ve sürüm (null da olabilir) gönderir
  assert.deepEqual(kodKasaBilgisi({ kod: "x", surum: "1.0.0" }), { kimlik: null, surum: "1.0.0", acikAnahtar: null });
  assert.deepEqual(kodKasaBilgisi({ kod: "x", surum: null }), { kimlik: null, surum: null, acikAnahtar: null });
  assert.deepEqual(kodKasaBilgisi(null), { kimlik: null, surum: null, acikAnahtar: null });
  assert.deepEqual(kodKasaBilgisi({ kod: "x", kimlik: "kasa-00000001", acikAnahtar: ANAHTAR }), { kimlik: "kasa-00000001", surum: null, acikAnahtar: ANAHTAR });
});

test("kasa kaydı ve durum: açık kayıt ölçütün yerine geçer; kayıtsız Marina kurulu, eski deneme günlü Tuzla boş", () => {
  const base: KasaKaniti = { anahtar: true, kodKullanildi: false, bekleyen: null, sonGun: null };
  const gun = (gunOnce: number) => ({ date: "2026-11-27", receivedAt: new Date(NOW.getTime() - gunOnce * 86_400_000).toISOString() });
  assert.equal(kasaDurumu({ ...base, sonGun: gun(1) }, NOW).durum, "kurulu", "Marina: kayıt yok, yakın gün");
  assert.equal(kasaDurumu({ ...base, sonGun: gun(60) }, NOW).durum, "yok", "Tuzla: tek eski deneme günü");
  assert.deepEqual(kasaDurumu({ ...base, anahtar: false, kayit: { durum: "kurulu" } }, NOW), { durum: "kurulu", sonGun: null, bekleyen: null });
  assert.deepEqual(kasaDurumu({ ...base, kodKullanildi: true, sonGun: gun(1), kayit: { durum: "bos" } }, NOW), { durum: "yok" }, "serbest bırakılmış");
  assert.deepEqual(kasaDurumu({ ...base, kayit: { durum: "bos" }, bekleyen: "2026-12-10T00:00:00.000Z" }, NOW), { durum: "bekliyor", sonGecerlilik: "2026-12-10T00:00:00.000Z" });
  assert.equal(kasaDurumu({ ...base, kodKullanildi: true, kayit: null }, NOW).durum, "kurulu", "kayıt yoksa eski ölçüt");
  assert.deepEqual(kasaKaydi({ durum: "kurulu", kimlik: "k", surum: null, at: "a", by: "b", yol: "acilis" }), { durum: "kurulu", kimlik: "k", surum: null, at: "a", by: "b", yol: "acilis" });
  for (const bad of [null, { durum: "x", yol: "kod" }, { durum: "kurulu", yol: "devral" }]) assert.equal(kasaKaydi(bad), null);
});

test("şube listesi: açık + fiziksel + (hazırlanmış ya da AsilPOS); kurulu ve bu kasa değilse seçilemez", () => {
  const b = (o: Partial<{ active: boolean; kind: string; posSource: string }>) => ({ active: true, kind: "fiziksel", posSource: "asilpos", ...o });
  assert.equal(acilistaListelenir(b({}), false), true);
  assert.equal(acilistaListelenir(b({ posSource: "modpos" }), false), false, "hazırlanmamış ModPOS şubesi görünmez");
  assert.equal(acilistaListelenir(b({ posSource: "modpos" }), true), true, "Bilgisayara kur denmiş");
  assert.equal(acilistaListelenir(b({ active: false }), true), false);
  assert.equal(acilistaListelenir(b({ kind: "online", posSource: "yok" }), true), false);
  const kurulu = { durum: "kurulu" as const, sonGun: "2026-11-27", bekleyen: null };
  assert.deepEqual(acilisSubesi({ id: "marina", name: "Marina" }, kurulu, false), { id: "marina", ad: "Marina", kasa: { durum: "kurulu", sonGun: "2026-11-27" }, buKasa: false, secilebilir: false, neden: KURULU_NEDEN });
  assert.deepEqual(acilisSubesi({ id: "marina", name: "Marina" }, kurulu, true), { id: "marina", ad: "Marina", kasa: { durum: "kurulu", sonGun: "2026-11-27" }, buKasa: true, secilebilir: true });
  assert.deepEqual(acilisSubesi({ id: "tuzla", name: "Tuzla" }, { durum: "bekliyor", sonGecerlilik: "x" }, false), { id: "tuzla", ad: "Tuzla", kasa: { durum: "bos", sonGun: null }, buKasa: false, secilebilir: true });
  assert.equal(KURULU_NEDEN, "Kurulu: değiştirmek için ladmin");
  const kayit = { durum: "kurulu" as const, kimlik: "kasa-a", surum: null, at: "", by: "", yol: "acilis" as const };
  assert.equal(buKasaMi({ kayit, kimlik: "kasa-a", imzaSubesi: null, subeId: "tuzla" }), true);
  assert.equal(buKasaMi({ kayit, kimlik: "kasa-b", imzaSubesi: null, subeId: "tuzla" }), false);
  assert.equal(buKasaMi({ kayit, kimlik: "kasa-b", imzaSubesi: "tuzla", subeId: "tuzla" }), true, "şubenin anahtarıyla imzalı");
  assert.equal(buKasaMi({ kayit, kimlik: "kasa-b", imzaSubesi: "marina", subeId: "tuzla" }), false);
  assert.equal(buKasaMi({ kayit: { ...kayit, durum: "bos" }, kimlik: "kasa-a", imzaSubesi: null, subeId: "tuzla" }), false, "serbest bırakılmış kaydın kimliği sayılmaz");
  assert.equal(buKasaMi({ kayit: { ...kayit, kimlik: null }, kimlik: "kasa-a", imzaSubesi: null, subeId: "tuzla" }), false);
});

test("PIN: 4-6 rakam; kasanın örnek PIN'leri ve tek rakamın tekrarı reddedilir; hata metni PIN'i içermez", () => {
  // AsilPOS server/db/seed.ts DEMO_USERS (deneme modunun giriş ekranındaki örnek PIN'ler)
  assert.deepEqual([...ORNEK_PINLER], ["1897", "2468", "1111", "2222", "3333"]);
  for (const ok of ["4829", "48291", "482915"]) assert.equal(pinHatasi(ok), null, ok);
  for (const bad of ["482", "4829150", "48a9", " 4829", ...ORNEK_PINLER, "4444", "55555", "000000"]) {
    const h = pinHatasi(bad);
    assert.ok(h, bad);
    if (bad.trim().length >= 4) assert.ok(!h.includes(bad.trim()), `${bad}: metinde PIN yok`);
  }
});

test("ilk personel: her satır boş ya da ad + PIN; roller tek; PIN'ler farklı; boş bölüm geçerli (gönderilmez)", () => {
  assert.deepEqual(
    ILK_PERSONEL_ROLLERI.map((r) => [r.rol, r.etiket]),
    [
      ["patron", "Patron"],
      ["mudur", "Müdür"],
      ["kasiyer", "Barista"],
    ],
  );
  const rows = [
    { rol: "patron" as const, ad: " Ayşe ", pin: "482915" },
    { rol: "mudur" as const, ad: "", pin: "" },
    { rol: "kasiyer" as const, ad: "Zeynep", pin: "5927" },
  ];
  assert.deepEqual(doluSatirlar(rows), [
    { rol: "patron", ad: "Ayşe", pin: "482915" },
    { rol: "kasiyer", ad: "Zeynep", pin: "5927" },
  ]);
  assert.equal(ilkPersonelHatasi(doluSatirlar(rows)), null);
  assert.deepEqual(doluSatirlar(rows.map((r) => ({ ...r, ad: "", pin: "" }))), []);
  assert.equal(ilkPersonelHatasi([]), "En az bir kişinin adını ve PIN'ini yazın");
  assert.equal(ilkPersonelHatasi([{ rol: "patron", ad: "", pin: "482915" }]), "Patron: ad gerekli");
  assert.equal(ilkPersonelHatasi([{ rol: "mudur", ad: "Ali", pin: "" }]), "Müdür: PIN 4-6 rakam olmalı");
  assert.equal(ilkPersonelHatasi([{ rol: "kasiyer", ad: "Ali", pin: "1111" }]), "Barista: Bu PIN kasanın deneme dönemindeki örnek PIN'i, herkes biliyor: başka bir PIN seçin");
  assert.equal(
    ilkPersonelHatasi([
      { rol: "patron", ad: "A", pin: "482915" },
      { rol: "mudur", ad: "B", pin: "482915" },
    ]),
    "Üç PIN birbirinden farklı olmalı",
  );
  assert.equal(
    ilkPersonelHatasi([
      { rol: "patron", ad: "A", pin: "482915" },
      { rol: "patron", ad: "B", pin: "731864" },
    ]),
    "Patron iki kez yazılmış",
  );
  assert.equal(ilkPersonelHatasi([{ rol: "garson", ad: "A", pin: "482915" }]), "Rol tanınmadı");
});

test("ilk personel kaydı: tembel temizlik (gönderimden 24 saat sonra mühür, hiç gönderilmeyen 30 gün sonra kayıt); durum PIN'siz", () => {
  const k: IlkPersonelKaydi = { v: 1, muhur: "m", at: "2026-11-01T00:00:00.000Z", by: "Asıl", roller: ["patron"] };
  assert.deepEqual(ilkPersonelTemizle(k, new Date("2026-11-30T23:59:00Z")), { kayit: k, degisti: false });
  assert.deepEqual(ilkPersonelTemizle(k, new Date("2026-12-01T00:00:00Z")), { kayit: null, degisti: true });
  const sent = { ...k, gonderildi: "2026-11-28T10:00:00.000Z" };
  assert.deepEqual(ilkPersonelTemizle(sent, new Date("2026-11-29T09:59:00Z")), { kayit: sent, degisti: false });
  const cleaned = ilkPersonelTemizle(sent, new Date("2026-11-29T10:00:00Z"));
  assert.deepEqual(cleaned, { kayit: { v: 1, at: k.at, by: "Asıl", roller: ["patron"], gonderildi: sent.gonderildi }, degisti: true });
  assert.equal(ilkPersonelDurumu(null), "yok");
  assert.equal(ilkPersonelDurumu(k), "ayarli");
  assert.equal(ilkPersonelDurumu(sent), "gonderildi");
  assert.equal(ilkPersonelDurumu(cleaned.kayit), "gonderildi");
  assert.equal(ilkPersonelDurumu({ v: 1, at: k.at, by: "", teslim: "2026-11-28T11:00:00.000Z" }), "teslim");
  assert.equal(ilkPersonelKaydi({ v: 2, at: "x" }), null);
  assert.deepEqual(ilkPersonelKaydi({ v: 1, at: "x", muhur: "m", roller: ["patron", "garson"], pin: "482915" }), { v: 1, at: "x", by: "", muhur: "m", roller: ["patron"] }, "bilinmeyen alan düşer");
});

test("metinler: onay cümlesi, 409 cümlesi, e-postalar sır içermez; uzun tire yok", () => {
  assert.equal(SERBEST_ONAY, "Bu şubenin kasası ladmin bağlantısını kaybeder; yeni bilgisayar şubeyi kasada seçebilir.");
  assert.match(zatenKuruluMesaji("Marina"), /^Marina şubesinde kurulu bir kasa var\. .*Kasayı serbest bırak\.$/);
  const m = baglandiMail({ sube: "Tuzla <x>", kim: "asil@ornek.com", zaman: "28 Kasım 2026 14:05", kasa: "kasa-a" });
  assert.equal(m.subject, "Tuzla <x> kasası yeni bir bilgisayara bağlandı");
  assert.ok(m.html.includes("Tuzla &lt;x&gt;") && !m.html.includes("<x>"), "kaçışlı");
  assert.ok(m.text.includes("Kasayı") || m.text.includes("serbest bırakın"));
  assert.equal(serbestMail({ sube: "Tuzla", kim: "asil@ornek.com", zaman: "z" }).subject, "Tuzla kasası serbest bırakıldı");
  assert.equal(BELIRTEC_DAKIKA, 15);
  assert.deepEqual(ACILIS_YOLLARI, { giris: "/api/asilpos/acilis/giris", bagla: "/api/asilpos/acilis/bagla", teslim: "/api/asilpos/acilis/teslim" });
});

test("kaynak: giriş panelin korumalarını (ortak modül) kullanır, çerez ve oturum yok; belirteç oturum değil", () => {
  const acilis = read("src/server/asilpos/acilis.ts");
  assert.match(acilis, /from "@\/server\/auth\/giris-korumalari"/);
  const giris = fnBody("src/server/asilpos/acilis.ts", "acilisGiris");
  for (const s of ["loginIp.hit(input.ip)", "ghostAttempt(eposta, parola)", "charge(user.id, null)", "verifyPassword(parola, user.passwordHash)", "secondFactorOk(user, kod", "padTo(started)"]) assert.ok(giris.includes(s), s);
  assert.ok(giris.indexOf("verifyPassword(") < giris.indexOf("isAnaAdmin(user)"), "403 parola doğrulandıktan sonra");
  assert.ok(giris.indexOf("verifyPassword(") < giris.indexOf("ikiAdim: true"), "parola yanlışken iki adımlı söylenmez");
  for (const no of ["startSession", "cookies(", "rememberDevice", "lastLoginAt"]) assert.ok(!acilis.includes(no), `${no} yok`);
  // Panelin girişi aynı modülden (davranış aynı; tests/giris-cihaz.test.ts)
  assert.match(read("src/server/actions/auth.ts"), /from "@\/server\/auth\/giris-korumalari"/);
  const korumalar = read("src/server/auth/giris-korumalari.ts");
  assert.ok(korumalar.startsWith('import "server-only";'));
  assert.doesNotMatch(korumalar, /^\s*["']use server["'];?\s*$/m);
  // Belirteç: amaç, süre, oturum sürümü; oturum ve iki adım çerezinin yerine geçmez
  const session = read("src/server/auth/session.ts");
  assert.match(session, /typ: ACILIS_AMACI/);
  assert.match(session, /if \(payload\.typ !== undefined && payload\.typ !== "session"\) return null;/);
});

test("kaynak: bağla kurulu şubede anahtara dokunmadan 409 döner; devral okunmaz; anahtar çözümüne dokunulmadı", () => {
  const bagla = fnBody("src/server/asilpos/acilis.ts", "acilisBagla");
  const ret = bagla.indexOf('"zaten_kurulu"');
  assert.ok(ret > 0 && ret < bagla.indexOf("ensurePosKey("), "409 anahtardan önce");
  assert.ok(!read("src/server/asilpos/acilis.ts").includes("b?.devral") && !bagla.includes(".devral"), "devral alanı okunmaz");
  assert.ok(bagla.includes("kurulumBaglantilari({ panelUrl: appUrl(), syncSecret: key })"), "yanıt kurulum koduyla aynı yardımcıdan");
  // Var olan uçlar: kurulum kodu aynı işleyici, yanıt türü aynı (ek alan yalnız isteğe bağlı personel)
  const kurulum = read("src/server/asilpos/kurulum.ts");
  assert.match(kurulum, /\| \{ status: 404 \| 410; body: \{ ok: false; error: string \} \};/);
  assert.match(kurulum, /\.\.\.\(personel \? \{ personel \} : \{\}\)/);
  const branch = read("src/server/asilpos/branch.ts");
  for (const s of ["acilis", "kasa-durumu", "ilk-personel"]) assert.ok(!branch.includes(s), `branch.ts ${s}'e bakmaz`);
  // Rotalar: üç uç ortak işleyiciden; proxy kapsamaz
  for (const [uc, fn] of [
    ["giris", "girisPOST"],
    ["bagla", "baglaPOST"],
    ["teslim", "teslimPOST"],
  ]) {
    assert.match(read(`src/app/api/asilpos/acilis/${uc}/route.ts`), new RegExp(`^export \\{ ${fn} as POST \\} from "@/server/asilpos/acilis-route";$`, "m"));
  }
  assert.ok(!read("src/proxy.ts").includes("/api/asilpos"));
  // Teslim şube anahtarıyla imzalı: şube imzadan, gövdeden değil
  const route = read("src/server/asilpos/acilis-route.ts");
  assert.match(route, /const caller = await posRequestCaller\(request, body\.text\);/);
  assert.match(route, /return json\(await acilisTeslim\(caller\.branchId, getDb\(\)\)\);/);
});

test("kaynak: ilk personel mühürlü, yedek dışı; serbest bırakma asıl yönetici, ad ve parola; hazırlık Bilgisayara kur'da", () => {
  const ilk = read("src/server/asilpos/ilk-personel.ts");
  assert.match(ilk, /seal\(JSON\.stringify\(sirali\), ILK_PERSONEL_AMACI\)/);
  assert.match(ilk, /padding: constants\.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256"/);
  assert.match(read("src/server/secret-box.ts"), /export type SealPurpose = [^;]*"asilpos-ilk-personel"/);
  assert.ok(read("src/lib/backup/format.ts").includes('"asilpos.ilk-personel:"'));
  const release = fnBody("src/server/actions/branches.ts", "releaseBranchTill");
  assert.match(release, /requireAnaAdmin\("kasaSerbest"\)/);
  assert.ok(release.indexOf("requireStepUp(") < release.indexOf("releaseTill("), "parola yazımdan önce");
  assert.ok(release.indexOf("şubenin adını tam yazın") < release.indexOf("requireStepUp("));
  assert.match(fnBody("src/server/actions/branches.ts", "saveBranchStaff"), /requireAnaAdmin\("ilkPersonel"\)/);
  const actions = read("src/server/actions/branches.ts");
  assert.match(actions, /await writeHazirlik\(db, b\.id, me\.name\);/);
  // İşlem geçmişine PIN ve ad yazılmaz: yalnız roller
  assert.match(actions, /const rollerMetni = \(list: readonly IlkPersonel\[\]\) => list\.map\(\(p\) => rolEtiketi\(p\.rol\)\)\.join\(", "\);/);
  const client = read("src/app/panel/sube-ekleme/sube-ekleme-client.tsx");
  for (const s of ["İlk personeli ayarla", "Kasayı serbest bırak", "SERBEST_ONAY", "İlk personel (isteğe bağlı)"]) assert.ok(client.includes(s), s);
  assert.match(client, /d\.durum === "kurulu" \? \(\s*<Button size="sm" variant="ghost" onClick=\{\(\) => setBirak\(b\)\}/, "düğme yalnız kurulu kasada");
});
