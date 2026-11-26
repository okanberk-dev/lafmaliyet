// "Aynı vergi numarası mı?" (docs/PARASUT.md › Şube başına Paraşüt hesabı › Aynı vergi numarası): ikinci Paraşüt firması
// bağlanırken bağlanan firmanın vergi numarası öbür hesapların firmalarınınkiyle karşılaştırılır; aynıysa ya da
// karşılaştırılamadıysa yöneticiye sorulur (faturalar iki kez sayılmasın). Saf kurallar src/lib/parasut/company.ts;
// akış ve veritabanı tests/parasut-hesap-db.test.ts'te.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { companiesOf, companyTaxNumber, parseTaxQuestion, taxConfirmCopy, taxVerdict } from "../src/lib/parasut/company";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("vergi numarası: VKN 10, TCKN 11 hane; boşluk ve işaret atılır, başka uzunluk bilinmiyor", () => {
  assert.equal(companyTaxNumber("1234567890"), "1234567890");
  assert.equal(companyTaxNumber(" 123 456 7890 "), "1234567890", "boşluklu yazım");
  assert.equal(companyTaxNumber("12345678901"), "12345678901", "TCKN (şahıs şirketi)");
  assert.equal(companyTaxNumber(1234567890), "1234567890", "sayı olarak gelirse");
  assert.equal(companyTaxNumber("12345"), null, "kısa");
  assert.equal(companyTaxNumber(""), null);
  assert.equal(companyTaxNumber(null), null);
  assert.equal(companyTaxNumber(undefined), null);
  assert.equal(companyTaxNumber({ x: 1 }), null, "nesne");
});

test("/v4/me yanıtından firmalar: included › companies; ad yoksa ticari unvan, o da yoksa kimlik", () => {
  const me = {
    data: { id: "9", type: "users", attributes: { name: "Patron" } },
    included: [
      { id: "424242", type: "companies", attributes: { name: "L'Affogato Tuzla", legal_name: "Laf Gıda Ltd.", tax_number: "1111111111" } },
      { id: 535353, type: "companies", attributes: { name: " ", legal_name: "Laf Marina Ltd.", tax_number: "222 222 2222" } },
      { id: "6", type: "companies", attributes: { tax_number: "yok" } },
      { id: "7", type: "profiles", attributes: { name: "başka tür" } },
      null,
      { type: "companies", attributes: { name: "kimliksiz" } },
    ],
  };
  assert.deepEqual(companiesOf(me), [
    { id: "424242", name: "L'Affogato Tuzla", taxNumber: "1111111111" },
    { id: "535353", name: "Laf Marina Ltd.", taxNumber: "2222222222" },
    { id: "6", name: "6", taxNumber: null },
  ]);
  assert.deepEqual(companiesOf(null), []);
  assert.deepEqual(companiesOf({ data: {} }), [], "included yok");
  assert.deepEqual(companiesOf("bozuk"), []);
});

test("karar: başka hesap yoksa sorulmaz; aynı vergi numarası önce gelir; okunamayan sorulur; hepsi farklıysa bağlanır", () => {
  assert.deepEqual(taxVerdict("1111111111", []), { kind: "clear" }, "tek hesap");
  assert.deepEqual(taxVerdict(null, []), { kind: "clear" }, "tek hesapta okunamasa da sorulmaz");
  assert.deepEqual(taxVerdict("2222222222", [{ name: "Tuzla", taxNumber: "1111111111" }]), { kind: "clear" });
  assert.deepEqual(taxVerdict("1111111111", [{ name: "Tuzla", taxNumber: "1111111111" }]), { kind: "same", taxNumber: "1111111111", others: ["Tuzla"] });
  // Kesin bilinen risk okunamayandan önce
  assert.deepEqual(
    taxVerdict("1111111111", [
      { name: "Tuzla", taxNumber: null },
      { name: "Moda", taxNumber: "1111111111" },
    ]),
    { kind: "same", taxNumber: "1111111111", others: ["Moda"] },
  );
  assert.deepEqual(taxVerdict("1111111111", [{ name: "Tuzla", taxNumber: null }]), { kind: "unknown", taxNumber: "1111111111", others: ["Tuzla"] }, "öbürü okunamadı");
  assert.deepEqual(
    taxVerdict(null, [
      { name: "Tuzla", taxNumber: "1111111111" },
      { name: "Moda", taxNumber: null },
    ]),
    { kind: "unknown", taxNumber: null, others: ["Tuzla", "Moda"] },
    "bağlananınki okunamadı: hepsiyle karşılaştırılamadı",
  );
});

test("kayıttan okunan soru doğrulanır; bozuksa null", () => {
  const same = { kind: "same", taxNumber: "1111111111", others: ["Tuzla"] };
  assert.deepEqual(parseTaxQuestion(same), same);
  assert.deepEqual(parseTaxQuestion({ kind: "unknown", taxNumber: 5, others: ["Tuzla"] }), { kind: "unknown", taxNumber: null, others: ["Tuzla"] });
  for (const bad of [null, {}, { kind: "clear", others: ["Tuzla"] }, { kind: "same", others: ["Tuzla"] }, { kind: "same", taxNumber: "1", others: [] }, { kind: "unknown", others: [1] }]) {
    assert.equal(parseTaxQuestion(bad), null, JSON.stringify(bad));
  }
});

test("onay penceresinin ve işlem geçmişinin metni: kimle, hangi numara, ne yapılmalı", () => {
  const same = taxConfirmCopy({ kind: "same", taxNumber: "1111111111", others: ["Tuzla"] }, "Marina");
  assert.equal(same.title, "Aynı vergi numarası");
  assert.equal(same.confirmLabel, "Yine de bağla");
  assert.match(same.description, /Marina için bağladığınız Paraşüt firması Tuzla şubesinin Paraşüt firmasıyla aynı vergi numarasını taşıyor \(1111111111\)/);
  assert.match(same.description, /iki kez sayılır/);
  assert.match(same.description, /“Tuzla ile aynı”/, "doğru yol: şubeyi aynı hesaba bağlamak");
  assert.equal(same.log, "aynı vergi numarası uyarısı onaylandı (1111111111; Tuzla)");

  const many = taxConfirmCopy({ kind: "same", taxNumber: "1111111111", others: ["Tuzla", "Moda", "Kadıköy"] }, "Marina");
  assert.match(many.description, /Tuzla, Moda ve Kadıköy şubelerinin Paraşüt firmalarıyla/);

  const unknownOther = taxConfirmCopy({ kind: "unknown", taxNumber: "2222222222", others: ["Tuzla"] }, "Marina");
  assert.equal(unknownOther.title, "Aynı vergi numarası mı?");
  assert.equal(unknownOther.confirmLabel, "Farklı, bağla");
  assert.match(unknownOther.description, /Tuzla şubesinin Paraşüt firmasının vergi numarası okunamadı; Marina için bağladığınız firmanınki 2222222222/);
  const unknownMine = taxConfirmCopy({ kind: "unknown", taxNumber: null, others: ["Tuzla"] }, "Marina");
  assert.match(unknownMine.description, /Marina için bağladığınız Paraşüt firmasının vergi numarası okunamadı; Tuzla şubesinin Paraşüt firmasıyla karşılaştırılamadı/);
  assert.match(unknownMine.log, /yönetici farklı olduğunu onayladı/);
});

test("kaynak: belirteç onaysız yazılmaz; soru yalnız başlatan yöneticiye; onay tek kullanımlık; ayarlar değiştiyse yazılmaz", () => {
  const connect = read("src/server/parasut/connect.ts");
  const finish = connect.slice(connect.indexOf("export async function finishParasutConnect"), connect.indexOf("// ----------------------------------------------------------------"));
  // Karar, belirteç yazılmadan önce; soru varsa belirteç onay kaydına (şifreli) gider ve fonksiyon döner
  assert.ok(finish.indexOf("connectTaxVerdict(cfg, token.access_token)") < finish.indexOf("await saveParasutToken(cfg, token)"));
  assert.match(finish, /if \(verdict\.kind !== "clear"\) \{[\s\S]*seal\(JSON\.stringify\(held\), "parasut-connect"\)[\s\S]*return \{ by: pending\.by, account, question: verdict \};\s*\}/);
  // Onay: kayıt alınırken silinir; istemci, kimlik sunucusu ya da firma değiştiyse yazılmaz
  assert.match(connect, /async function takeHeld\([^)]*\)[^{]*\{\s*const \[row\] = await getDb\(\)\.delete\(s\.integrationState\)\.where\(eq\(s\.integrationState\.key, heldKey\(account\)\)\)\.returning\(\);/);
  assert.match(connect, /cfg\.clientId !== h\.clientId \|\| cfg\.issuer !== h\.issuer \|\| cfg\.companyId !== h\.companyId/);
  assert.match(connect, /h\.userId === undefined \|\| h\.userId === userId/, "başka yöneticinin sorusu gösterilmez, onaylanamaz");
  // Sıfırlama / ayar değişimi onay bekleyeni de siler
  assert.match(connect, /export async function forgetParasutConnect[\s\S]*heldKey\(account\)/);
  // Dönüş yolu soruyu ekrana bırakır; eylemler yönetici ister, hesabı doğrular, işlem geçmişine yazar
  assert.match(read("src/app/panel/parasut/baglan/geri/route.ts"), /if \(question\) return back\(\{ baglanti: "onay" \}\);/);
  const actions = read("src/server/actions/parasut.ts");
  for (const fn of ["confirmParasutConnection", "cancelParasutConnection"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
    assert.match(body.slice(0, 400), /const me = await requireAdmin\(\);\s*const account = await parasutAccountInput\(accountRaw\);/, fn);
    assert.match(body.slice(0, 1400), /logActivity\(me, "Paraşüt hesabı (bağlandı|bağlanmadı)"/, fn);
  }
  // Sayfa soruyu yalnız bu yöneticinin kaydından okur; belirteç ekrana gitmez
  const page = read("src/app/panel/parasut/page.tsx");
  assert.match(page, /parasutConnectQuestion\(me\.id\)/);
  assert.match(page, /connectQuestion = held && heldCopy \? \{ account: held\.account, kind: held\.question\.kind, title: heldCopy\.title, description: heldCopy\.description, confirmLabel: heldCopy\.confirmLabel \}/);
  // Tek hesaplı kurulumda Paraşüt'e fazladan istek yok
  assert.match(read("src/server/parasut/company.ts"), /if \(!others\.length\) return \{ kind: "clear" \};/);
  // Onay kaydı yedeğe girmez (önek)
  assert.match(read("src/lib/backup/format.ts"), /"parasut\.connect": /);
});

test("kaynak: soru penceresi tek yanıt verir; kapanış yanıttan sonra ikinci bir 'vazgeç' göndermez", () => {
  const dialog = read("src/app/panel/parasut/connect-question.tsx");
  // <dialog> `open` false olunca da onClose'u çağırır: onaydan sonra cancelParasutConnection gitmemeli
  assert.match(dialog, /if \(answered\.current \|\| inFlight\.current\) return;/, "yanıt verildiyse ya da giderken kapanış yok sayılır");
  assert.match(dialog, /answered\.current = true;\s*setOpen\(false\);/, "pencere ancak yanıt kaydedildikten sonra kapanır");
  assert.match(dialog, /finally \{\s*inFlight\.current = false;\s*\}/, "başarısız yanıt yeniden denenebilir");
});
