// Mutabakat gerçek Postgres'te (docs/MUTABAKAT.md): ekstre yükleme (önizleme, kayıt, aynı hareketin ikinci kez
// yazılmaması), banka ekstresinin harcama / tedarikçi ödemesi / kasadan teslim ile eşleşmesi, POS satırının ayrılması,
// elle eşleştirme ve denetimi (başka satıra elle bağlı kayıt), tedarikçi ekstresinin fatura numarasıyla eşleşmesi, POS
// hakediş karşılaştırması (kasa raporunun kartı, şubenin oranı, bloke günü), ekstre silme ve saklama süresinin dolması.
// Panel kayıtlarına hiçbir şey yazılmadığı da sınanır.
//
// MUTABAKAT_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: MUTABAKAT_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/mutabakat-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MUTABAKAT_TEST_DATABASE_URL;
const DB_NAME = `laffogato_mutabakat_${process.pid}`;

describe("mutabakat: veritabanında", { skip: !SERVER_URL && "MUTABAKAT_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let actions: typeof import("../src/server/actions/mutabakat");
  let load: typeof import("../src/server/mutabakat/load");
  let store: typeof import("../src/server/mutabakat/store");
  let categoryId = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "mutabakat-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    actions = await import("../src/server/actions/mutabakat");
    load = await import("../src/server/mutabakat/load");
    store = await import("../src/server/mutabakat/store");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE recon_statements, recon_lines, expense_entries, expense_categories, supplier_entries, supplier_allocations, suppliers, invoices, cash_outs, cash_reports, activity_log RESTART IDENTITY CASCADE`,
    );
    await db.delete(s.settings).where(eq(s.settings.key, "mutabakatPosBlokeGunu"));
    const [c] = await db.insert(s.expenseCategories).values({ name: "Bakım onarım" }).returning();
    categoryId = c.id;
  });

  const csv = (name: string, rows: string[][]) => new File([rows.map((r) => r.join(";")).join("\r\n")], name, { type: "text/csv" });
  const form = (fields: Record<string, string | File>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const BANK_HEAD = ["Tarih", "Açıklama", "Tutar", "Bakiye"];

  test("banka ekstresi: önizleme hiçbir şey yazmaz; kayıt satırları yazar, aynı hareket ikinci kez yazılmaz; IBAN örtülür", async () => {
    const rows = [BANK_HEAD, ["03.11.2026", "HAVALE TR12 0006 2000 0001 2345 6789 01 TAMIRCI", "-500,00", "9.500,00"], ["04.11.2026", "NAKIT YATAN", "2.000,00", "11.500,00"]];
    const pre = await actions.previewStatement(form({ kind: "banka", account: "Garanti TL", file: csv("ekstre.csv", rows) }));
    assert.ok(pre.ok, JSON.stringify(pre));
    assert.equal(pre.ok && pre.data.status, "ready");
    if (pre.ok && pre.data.status === "ready") {
      assert.equal(pre.data.count, 2);
      assert.deepEqual([pre.data.plus, pre.data.minus, pre.data.duplicates], [2000, -500, 0]);
    }
    assert.equal((await db.select().from(s.reconStatements)).length, 0, "önizleme yazmaz");

    const saved = await actions.saveStatement(form({ kind: "banka", account: " Garanti  TL ", file: csv("ekstre.csv", rows) }));
    assert.ok(saved.ok, JSON.stringify(saved));
    assert.deepEqual(saved.ok && [saved.data.inserted, saved.data.duplicates], [2, 0]);
    const [st] = await db.select().from(s.reconStatements);
    assert.deepEqual([st.kind, st.account, st.periodFrom, st.periodTo, st.lineCount, st.uploadedOn, st.expiresOn], ["banka", "Garanti TL", "2026-11-03", "2026-11-04", 2, todayTR(), addDays(todayTR(), 90)]);
    const lines = await db.select().from(s.reconLines).orderBy(asc(s.reconLines.id));
    assert.equal(lines[0].description, "HAVALE TR••8901 TAMIRCI");
    assert.deepEqual(
      lines.map((l) => l.amount),
      [-500, 2000],
    );

    // Aynı dosya: hepsi önceden var, ekstre açılmaz
    const again = await actions.saveStatement(form({ kind: "banka", account: "garanti tl", file: csv("ekstre.csv", rows) }));
    assert.equal(again.ok, false);
    assert.match(!again.ok ? again.error : "", /daha önce yüklenmiş/);
    // Bir hareket fazla: yalnız o yazılır
    const more = await actions.saveStatement(form({ kind: "banka", account: "Garanti TL", file: csv("ekstre2.csv", [...rows, ["05.11.2026", "EFT", "-75,50", "11.424,50"]]) }));
    assert.ok(more.ok, JSON.stringify(more));
    assert.deepEqual(more.ok && [more.data.inserted, more.data.duplicates], [1, 2]);
    // Başka hesap: aynı hareketler yazılır
    const other = await actions.saveStatement(form({ kind: "banka", account: "Akbank", file: csv("ekstre.csv", rows) }));
    assert.ok(other.ok, JSON.stringify(other));
    assert.equal((await db.select().from(s.reconLines)).length, 5);
    const log = await db.select({ detail: s.activityLog.detail }).from(s.activityLog).orderBy(asc(s.activityLog.id));
    assert.match(log[0].detail ?? "", /Banka ekstresi yüklendi: Garanti TL, 03\.11\.2026–04\.11\.2026, 2 hareket/);
  });

  test("banka eşleşmesi: harcama, tedarikçi ödemesi (adıyla), kasadan teslim; POS satırı ayrı; panel kayıtlarına dokunulmaz", async () => {
    const [sup] = await db.insert(s.suppliers).values({ name: "Kahveci", key: supplierMatchKey("Kahveci"), legalName: "KAHVECİ GIDA LTD ŞTİ" }).returning();
    await db.insert(s.supplierEntries).values([
      { supplierId: sup.id, kind: "odeme", date: "2026-11-05", amount: 1200, method: "havale", createdByName: "Yönetici" },
      // Kasadan ödeme bankada görünmez: aday değil
      { supplierId: sup.id, kind: "odeme", date: "2026-11-05", amount: 1200, method: "elden", createdByName: "Yönetici" },
    ]);
    await db.insert(s.expenseEntries).values([
      { date: "2026-11-04", categoryId, amount: 500, paymentMethod: "kart", description: "Tamirci" },
      { date: "2026-11-04", categoryId, amount: 500, paymentMethod: "nakit", description: "Nakit tamirci" },
      { date: "2026-11-20", categoryId, amount: 80, paymentMethod: "havale", description: "Ekstrede yok" },
    ]);
    await db.insert(s.cashOuts).values({ date: "2026-11-06", kind: "teslim", amount: 3000, store: "Banka", createdByName: "Ayşe" });
    const rows = [
      BANK_HEAD,
      ["04.11.2026", "KREDI KARTI TAMIRCI", "-500", ""],
      ["06.11.2026", "HAVALE KAHVECI GIDA", "-1.200,00", ""],
      ["06.11.2026", "NAKIT YATAN", "3.000,00", ""],
      ["07.11.2026", "UYE ISYERI POS HAKEDIS", "9.800,00", ""],
      ["08.11.2026", "BILINMEYEN EFT", "-42,00", ""],
      ["30.11.2026", "HESAP ISLETIM UCRETI", "-10,00", ""],
    ];
    const saved = await actions.saveStatement(form({ kind: "banka", account: "Garanti TL", file: csv("e.csv", rows) }));
    assert.ok(saved.ok, JSON.stringify(saved));
    const before = await db.select().from(s.expenseEntries).orderBy(asc(s.expenseEntries.id));

    const { statements } = await load.loadRecon();
    assert.equal(statements.length, 1);
    const st = statements[0];
    const by = Object.fromEntries(st.rows.map((r) => [r.line.description, r]));
    assert.deepEqual([by["KREDI KARTI TAMIRCI"].status, by["KREDI KARTI TAMIRCI"].candidate?.kind, by["KREDI KARTI TAMIRCI"].candidate?.id], ["eslesti", "harcama", 1]);
    assert.deepEqual([by["HAVALE KAHVECI GIDA"].status, by["HAVALE KAHVECI GIDA"].basis, by["HAVALE KAHVECI GIDA"].candidate?.kind], ["eslesti", "ad", "odeme"]);
    assert.deepEqual([by["NAKIT YATAN"].status, by["NAKIT YATAN"].candidate?.kind], ["eslesti", "teslim"]);
    assert.equal(by["UYE ISYERI POS HAKEDIS"].pos, true);
    assert.equal(by["BILINMEYEN EFT"].status, "yok");
    assert.deepEqual([st.summary.eslesti, st.summary.yok, st.summary.pos], [3, 2, 1]);
    // Dönemde ekstrede olmayan havale harcaması
    assert.deepEqual(
      st.missing.map((c) => [c.kind, c.id]),
      [["harcama", 3]],
    );
    assert.deepEqual(await db.select().from(s.expenseEntries).orderBy(asc(s.expenseEntries.id)), before, "panel kaydı değişmez");

    // Elle eşleştirme: seçenekler, kayıt ve denetim
    const eft = by["BILINMEYEN EFT"].line.id;
    const fee = by["HESAP ISLETIM UCRETI"].line.id;
    const opts = await actions.manualOptions(eft);
    assert.ok(opts.ok, JSON.stringify(opts));
    assert.deepEqual(opts.ok && opts.data.options.map((c) => `${c.kind}:${c.id}`), ["harcama:3"]);
    assert.ok((await actions.decideLine({ lineId: eft, decision: "elle", match: { kind: "harcama", id: 3 } })).ok);
    const taken = await actions.decideLine({ lineId: fee, decision: "elle", match: { kind: "harcama", id: 3 } });
    assert.equal(taken.ok, false);
    assert.match(!taken.ok ? taken.error : "", /başka bir satırla elle eşleştirildi/);
    // Yön tutmaz: giriş çıkış kaydıyla eşleşmez
    const wrong = await actions.decideLine({ lineId: by["NAKIT YATAN"].line.id, decision: "elle", match: { kind: "harcama", id: 3 } });
    assert.equal(wrong.ok, false);
    // Panelde olmayan kayıt
    assert.equal((await actions.decideLine({ lineId: fee, decision: "elle", match: { kind: "harcama", id: 999 } })).ok, false);
    assert.ok((await actions.decideLine({ lineId: fee, decision: "yoksay" })).ok);
    const after = (await load.loadRecon()).statements[0];
    const a = Object.fromEntries(after.rows.map((r) => [r.line.id, r]));
    assert.deepEqual([a[eft].status, a[eft].basis, a[eft].diff], ["fark", "elle", -38]);
    assert.equal(a[fee].status, "yoksay");
    assert.deepEqual(after.missing, []);
    // POS değil: kendiliğinden eşleşmeye ya da elle eşleştirmeye açılır
    const pos = by["UYE ISYERI POS HAKEDIS"].line.id;
    assert.ok((await actions.decideLine({ lineId: pos, decision: "ayir" })).ok);
    assert.equal((await load.loadRecon()).statements[0].rows.find((r) => r.line.id === pos)?.pos, false);
    // Geri al
    assert.ok((await actions.decideLine({ lineId: pos, decision: null })).ok);
    assert.equal((await load.loadRecon()).statements[0].rows.find((r) => r.line.id === pos)?.pos, true);
    const [line] = await db.select().from(s.reconLines).where(eq(s.reconLines.id, pos));
    assert.deepEqual([line.decision, line.matchKind, line.decidedByName], [null, null, null]);
  });

  test("tedarikçi ekstresi: Borç / Alacak, fatura numarasıyla eşleşir; ödeme cari kayıtla; POS kararı reddedilir", async () => {
    const [sup] = await db.insert(s.suppliers).values({ name: "Sütaş", key: supplierMatchKey("Sütaş") }).returning();
    await db.insert(s.invoices).values([
      { date: "2026-11-02", supplier: "Sütaş", invoiceNo: "STS2026000000011", category: "Hammadde & İçecek", amount: 1000, payable: 1100, unpaid: true },
      { date: "2026-11-09", supplier: "Sütaş", invoiceNo: "STS2026000000012", category: "Hammadde & İçecek", amount: 900, payable: 990, unpaid: true },
      { date: "2026-11-09", supplier: "Pınar", invoiceNo: "PNR2026000000001", category: "Hammadde & İçecek", amount: 900, payable: 990, unpaid: true },
    ]);
    await db.insert(s.supplierEntries).values({ supplierId: sup.id, kind: "odeme", date: "2026-11-12", amount: 1100, method: "havale", createdByName: "Yönetici" });
    const options = await load.loadSupplierOptions();
    const slug = options.find((o) => o.name === "Sütaş")?.slug;
    assert.ok(slug, "Sütaş listede");
    const rows = [
      ["Sütaş Süt Ürünleri A.Ş. cari hesap ekstresi"],
      [],
      ["Tarih", "Evrak No", "Açıklama", "Borç", "Alacak", "Bakiye"],
      ["02.11.2026", "STS2026000000011", "Satış faturası", "1.100,00", "", "1.100,00"],
      ["09.11.2026", "STS2026000000012", "Satış faturası", "1.000,00", "", "2.100,00"],
      ["12.11.2026", "", "Havale tahsilatı", "", "1.100,00", "1.000,00"],
      ["", "", "Toplam", "2.100,00", "1.100,00", ""],
    ];
    const saved = await actions.saveStatement(form({ kind: "tedarikci", supplier: slug!, file: csv("sutas.csv", rows) }));
    assert.ok(saved.ok, JSON.stringify(saved));
    const [st] = await db.select().from(s.reconStatements);
    assert.deepEqual([st.kind, st.account, st.supplierCardId], ["tedarikci", "Sütaş", sup.id]);
    const view = (await load.loadRecon()).statements[0];
    assert.deepEqual(
      view.rows.map((r) => [r.status, r.basis, r.candidate?.kind ?? null, r.candidate?.id ?? null, r.diff]),
      [
        ["eslesti", "belge", "fatura", 1, 0],
        ["fark", "belge", "fatura", 2, 10],
        ["eslesti", "tutar", "odeme", 1, 0],
      ],
    );
    assert.equal(view.supplierHref, `/panel/tedarikciler/${slug}`);
    const posTry = await actions.decideLine({ lineId: view.rows[0].line.id, decision: "pos" });
    assert.equal(posTry.ok, false);
    // Tedarikçi seçilmeden kayıt yok
    const none = await actions.saveStatement(form({ kind: "tedarikci", file: csv("sutas.csv", rows) }));
    assert.equal(none.ok, false);
  });

  test("POS hakedişi: kasa raporunun kartı (banka fişi önce) × (1 − şubenin oranı), bloke günüyle valör; geciken ve tamam", async () => {
    await db.update(s.branches).set({ posRate: 0.02 }).where(eq(s.branches.id, "tuzla"));
    await db.update(s.branches).set({ posRate: 0.03 }).where(eq(s.branches.id, "marina"));
    // Pazartesi 2 Kasım ve salı 3 Kasım 2026
    await db.insert(s.cashReports).values([
      { date: "2026-11-02", branchId: "tuzla", zTotal: 2000, card: 1000, bankPos: 990, submittedByName: "Ayşe" },
      { date: "2026-11-02", branchId: "marina", zTotal: 2000, card: 1000, submittedByName: "Ali" },
      { date: "2026-11-03", branchId: "tuzla", zTotal: 2000, card: 500, submittedByName: "Ayşe" },
    ]);
    const rows = [
      BANK_HEAD,
      // 3 Kasım valörü: 990 × 0,98 + 1000 × 0,97 = 970,20 + 970 = 1940,20
      ["03.11.2026", "POS HAKEDIS", "1.940,20", ""],
      ["05.11.2026", "MASRAF", "-5,00", ""],
    ];
    assert.ok((await actions.saveStatement(form({ kind: "banka", account: "Garanti TL", file: csv("e.csv", rows) }))).ok);
    const view = await load.loadPosView("2026-11-10");
    assert.equal(view.blockDays, 1);
    assert.deepEqual(view.coverage, { from: "2026-11-03", to: "2026-11-05" });
    assert.deepEqual(
      view.result.rows.map((r) => [r.due, r.status, r.expected, r.received]),
      [
        ["2026-11-03", "tamam", 1940.2, 1940.2],
        // 3 Kasım satışı 4 Kasım'da gelmeliydi, ekstrenin son günü 5 Kasım: gecikti
        ["2026-11-04", "gecikti", 490, 0],
      ],
    );
    assert.equal(view.result.rows[0].sales.find((x) => x.branchId === "tuzla")?.source, "banka-fisi");
    // Bloke günü 2: 3 Kasım valörü yok, giriş beklenmeyen; ekstrenin son günündeki valör henüz gecikmiş sayılmaz
    const bad = await actions.savePosBlockDays(99);
    assert.equal(bad.ok, false);
    assert.ok((await actions.savePosBlockDays(2)).ok);
    const two = await load.loadPosView("2026-11-10");
    assert.deepEqual(
      two.result.rows.map((r) => [r.due, r.status]),
      [
        ["2026-11-03", "beklenmeyen"],
        ["2026-11-04", "gecikti"],
        ["2026-11-05", "bekleniyor"],
      ],
    );
  });

  test("Excel: kapak satırları, tarih hücresi ve sayı hücresi okunur; .xls ve bilinmeyen biçim anlaşılır hatayla reddedilir", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Kapak").addRow(["Hesap özeti"]);
    const ws = wb.addWorksheet("Hareketler");
    ws.addRow(["Müşteri: L'Affogato"]);
    ws.addRow([]);
    ws.addRow(["İşlem Tarihi", "Açıklama", "Borç", "Alacak", "Bakiye"]);
    ws.addRow([new Date(Date.UTC(2026, 10, 3)), "POS HAKEDIS", null, 980, 1980]);
    ws.addRow([new Date(Date.UTC(2026, 10, 4)), "FATURA ODEMESI", 250.5, null, 1729.5]);
    const bytes = await wb.xlsx.writeBuffer();
    const file = new File([new Uint8Array(bytes as ArrayBuffer)], "hareketler.xlsx");
    const pre = await actions.previewStatement(form({ kind: "banka", account: "İş Bankası", file }));
    assert.ok(pre.ok && pre.data.status === "ready", JSON.stringify(pre));
    if (pre.ok && pre.data.status === "ready") {
      assert.deepEqual(
        pre.data.sample.map((l) => [l.date, l.amount, l.balance]),
        [
          ["2026-11-03", 980, 1980],
          ["2026-11-04", -250.5, 1729.5],
        ],
      );
      assert.equal(pre.data.map.headerRow, 2);
    }
    const xls = await actions.previewStatement(form({ kind: "banka", account: "x", file: new File(["x"], "eski.xls") }));
    assert.match(!xls.ok ? xls.error : "", /\.xls/);
    const pdf = await actions.previewStatement(form({ kind: "banka", account: "x", file: new File(["x"], "ekstre.pdf") }));
    assert.match(!pdf.ok ? pdf.error : "", /Desteklenen dosyalar/);
    // Sütunları tanınmayan dosya: elle seçim istenir, ilk satırlar gelir
    const odd = await actions.previewStatement(form({ kind: "banka", file: csv("odd.csv", [["A", "B"], ["03.11.2026", "12,50"]]) }));
    assert.ok(odd.ok && odd.data.status === "map", JSON.stringify(odd));
    const mapped = await actions.previewStatement(
      form({ kind: "banka", file: csv("odd.csv", [["A", "B"], ["03.11.2026", "12,50"]]), map: JSON.stringify({ headerRow: 0, date: 0, description: null, amount: 1, debit: null, credit: null, balance: null, ref: null }) }),
    );
    assert.ok(mapped.ok && mapped.data.status === "ready" && mapped.data.count === 1, JSON.stringify(mapped));
  });

  test("silme ve saklama: ekstre silinince satırları gider; süresi dolan ekstreyi günlük iş siler", async () => {
    const rows = [BANK_HEAD, ["03.11.2026", "EFT", "-50", ""]];
    const a = await actions.saveStatement(form({ kind: "banka", account: "Garanti TL", file: csv("a.csv", rows) }));
    const b = await actions.saveStatement(form({ kind: "banka", account: "Akbank", file: csv("b.csv", rows) }));
    assert.ok(a.ok && b.ok);
    assert.ok((await actions.deleteStatement(a.ok ? a.data.id : 0)).ok);
    assert.equal((await actions.deleteStatement(a.ok ? a.data.id : 0)).ok, false, "ikinci kez silinmez");
    assert.equal((await db.select().from(s.reconLines)).length, 1);
    const today = todayTR();
    assert.equal(await store.purgeExpiredStatements(db, today), 0);
    await db.update(s.reconStatements).set({ expiresOn: addDays(today, -1) });
    assert.equal(await store.purgeExpiredStatements(db, today), 1);
    assert.equal((await db.select().from(s.reconStatements)).length, 0);
    assert.equal((await db.select().from(s.reconLines)).length, 0);
  });
});
