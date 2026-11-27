// Şube ayrımı parça 6, gerçek Postgres'te (docs/SUBE.md › Şube ayrımı › Şubeleri yan yana, İşletme geneli giderler,
// dışa aktarım): Tuzla'nın kayıtları "IZ-TUZLA" işaretini ya da 77.777,77 tutarını taşır, işletme geneli sabit gider
// "IZ-ORTAK" işaretini. Marina seçili ve yöneticinin varsayılanıyla (Yalnız seçili şube, Yalnız not, alanlar şube kipinde)
// Şube karşılaştırma, İşçilik / ciro, Bugün'ün Şubelerde gün kartı, dışa aktarım, muhasebeci paketi ve sabah e-postasının
// önizlemesi Tuzla'yı göstermemeli; firma kipinde ve "Tümü"de göstermeli; müdürde firma tercihi yazılı olsa da
// göstermemeli. Oturum gerçek src/server/auth/dal.ts'le, çerezler taklit edilerek.
//
// SUBE_ALANLAR6_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_ALANLAR6_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-ayrimi-alanlar-6-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import ExcelJS from "exceljs";
import postgres from "postgres";

import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import type { BranchViewPrefs } from "../src/lib/branch-view";
import { ALL_BRANCHES, BRANCH_COOKIE, DEFAULT_BRANCHES } from "../src/lib/branches";
import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_ALANLAR6_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_alanlar6_${process.pid}`;
const SECRET = "sube-alanlar-6-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const MARK = "IZ-TUZLA";
const SHARED = "IZ-ORTAK";
const AMOUNT = 77777.77;

class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts: { maxAge?: number } = {}) {
    if (opts.maxAge === 0 || value === "") this.values.delete(name);
    else this.values.set(name, value);
  }
}

/** Çıktıda Tuzla'nın işareti (adı ya da tutarı, her biçimde) var mı */
const leaks = (v: unknown) => {
  const text = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x));
  return text.includes(MARK) || text.includes("77777") || text.includes("77.777");
};

/** Çalışma kitabının bir sekmesinin bütün hücreleri ve notları (metin) */
function sheetText(wb: ExcelJS.Workbook, name: string): string {
  const ws = wb.worksheets.find((w) => w.name === name || w.name.startsWith(name));
  assert.ok(ws, `sekme yok: ${name}`);
  const out: string[] = [];
  ws.eachRow((r) =>
    r.eachCell((c) => {
      out.push(String(typeof c.value === "object" && c.value && "result" in c.value ? c.value.result : (c.value ?? "")));
      if (c.note) out.push(typeof c.note === "string" ? c.note : JSON.stringify(c.note));
    }),
  );
  return out.join("\n");
}

describe("şube ayrımı parça 6: veritabanında", { skip: !SERVER_URL && "SUBE_ALANLAR6_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let jar = new Jar();
  const ids = { ali: 0, mert: 0 };
  const today = todayTR();
  // Dün: Bugün'ün kartının dönemi; ayı karşılaştırmanın ve işçiliğin ayı (ayın ilk günüyse geçen ay)
  const day = addDays(today, -1);
  const month = day.slice(0, 7);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => new Headers() });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
      unstable_rethrow: (e: unknown) => {
        if ((e as Error)?.message === "NEXT_REDIRECT" || (e as Error)?.message === "NEXT_NOT_FOUND") throw e;
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const user = async (name: string, email: string, role: "admin" | "manager", branchId: string | null) =>
      (await db.insert(s.users).values({ name, email, role, branchId, passwordHash: "x" }).returning({ id: s.users.id }))[0].id;
    ids.ali = await user("Ali", "ali@ornek.com", "admin", null);
    ids.mert = await user("Mert", "mert@ornek.com", "manager", "marina");

    // Kasa raporları (dün): Marina'nın ve Tuzla'nın işaretli tutarlı raporu
    await db.insert(s.cashReports).values([
      { date: day, branchId: "marina", zTotal: 2_000, cash: 1_000, card: 1_000, receipts: 40, submittedByName: "Arda" },
      { date: day, branchId: "tuzla", zTotal: AMOUNT, cash: AMOUNT, card: 0, receipts: 70, submittedByName: "Can" },
    ]);
    // Personel: Tuzla'nınki işaretli
    await db.insert(s.staff).values([
      { name: "Arda", netSalary: 30_000, branchId: "marina", startMonth: `${month}` },
      { name: `${MARK} Barista`, netSalary: 40_000, branchId: "tuzla", startMonth: `${month}` },
    ]);
    // Sabit giderler: işletme geneli (işaretli) ve Marina'nın
    await db.insert(s.fixedExpenses).values([
      { name: `${SHARED} internet`, section: "faturalar" as const, amount: 1_234, period: "aylik" as const, branchId: null },
      { name: "Marina güvenlik", section: "faturalar" as const, amount: 2_500, period: "aylik" as const, branchId: "marina" },
    ]);
    // Faturalar: Marina'nın, Tuzla'nın (işaretli tedarikçi), işletme geneli
    const [sutas] = await db.insert(s.suppliers).values({ name: "Sütaş", key: supplierMatchKey("Sütaş") }).returning({ id: s.suppliers.id });
    const invoice = async (supplier: string, amount: number, branchId: string | null, companyWide = false) =>
      (
        await db
          .insert(s.invoices)
          .values({ date: day, supplier, category: "Hammadde & İçecek", amount, payable: amount, vat: 0, unpaid: true, branchId, companyWide })
          .returning({ id: s.invoices.id })
      )[0].id;
    const marinaInv = await invoice("Sütaş", 1_000, "marina");
    const tuzlaInv = await invoice(`${MARK} Gıda`, 500, "tuzla");
    await invoice("Ortak Tedarik", 300, null, true);
    // Cari: faturasız borç (işletme geneli), Marina'nın faturasına ve Tuzla'nın faturasına sayılan iki havale
    await db.insert(s.supplierEntries).values({ supplierId: sutas.id, kind: "borc", date: day, amount: 250, costMode: "fatura", createdByName: "Ali" });
    const pay = async (amount: number, note: string, invoiceId: number) => {
      const [p] = await db
        .insert(s.supplierEntries)
        .values({ supplierId: sutas.id, kind: "odeme", date: day, amount, method: "havale", note, createdByName: "Ali" })
        .returning({ id: s.supplierEntries.id });
      await db.insert(s.supplierAllocations).values({ paymentId: p.id, invoiceId, amount, createdByName: "Ali" });
    };
    await pay(600, "Marina ödeme", marinaInv);
    await pay(400, `${MARK} ödeme`, tuzlaInv);
    // Bugün haber verilecek hatırlatıcılar: Tuzla'nın (işaretli) ve Marina'nın
    const reminder = (title: string, amount: number, branchId: string | null) =>
      db.insert(s.reminders).values({ title, amount, dueDate: addDays(today, 2), anchorDate: addDays(today, 2), branchId, kind: "kira", remindDaysBefore: 3 });
    await reminder(`${MARK} Kira`, 9_000, "tuzla");
    await reminder("Marina Kira", 8_000, "marina");
    await db.insert(s.findings).values({ section: "Fiyat", title: "Firma bulgusu" });

    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Oturum (`kim`), seçicide `secim`, hesabın şube görünümü tercihi `prefs` (veritabanına yazılır) */
  const signIn = async (kim: number, secim: string, prefs: BranchViewPrefs = {}) => {
    jar = new Jar();
    await db.update(s.users).set({ branchView: prefs }).where(eq(s.users.id, kim));
    const [u] = await db.select().from(s.users).where(eq(s.users.id, kim));
    await dal.startSession(u);
    jar.set(BRANCH_COOKIE, secim);
  };
  const FIRMA: BranchViewPrefs = { karsilastirma: "firma", ortak_gider: "firma", tutarlilik: "firma", tedarikciler: "firma", vergi: "firma" };

  test("Şubeleri yan yana: Yalnız seçili şube kipinde yalnız Marina; Yan yana ve Tümü'de iki şube; müdürde hep Marina", async () => {
    const { loadBranchCompare } = await import("../src/server/data/sube-karsilastirma");
    const { loadLaborReport } = await import("../src/server/data/iscilik");
    const { loadBranchDay } = await import("../src/server/data/branch-day");
    const idsOf = (rows: { id: string }[] | undefined) => (rows ?? []).map((r) => r.id).sort();

    await signIn(ids.ali, "marina");
    assert.equal(await scope.areaScope("karsilastirma"), "marina");
    const compare = await loadBranchCompare(month, 1);
    assert.ok(compare);
    assert.deepEqual(idsOf(compare.branches), ["marina"]);
    assert.equal(compare.only, "Marina");
    assert.equal(leaks(compare), false);
    const labor = await loadLaborReport(month);
    assert.ok(labor);
    assert.deepEqual(idsOf(labor.branches), ["marina"]);
    assert.equal(labor.total, null, "tek şubede toplam satırı yok");
    assert.equal(leaks(labor), false);
    const branchDay = await loadBranchDay();
    assert.ok(branchDay);
    assert.deepEqual(idsOf(branchDay.rows), ["marina"]);
    assert.equal(leaks(branchDay), false);

    await signIn(ids.ali, "marina", FIRMA);
    const side = await loadBranchCompare(month, 1);
    assert.deepEqual(idsOf(side?.branches), ["marina", "tuzla"]);
    assert.equal(side?.only, null);
    assert.equal(leaks(await loadBranchDay()), true, "Yan yana: Tuzla'nın günü");
    await signIn(ids.ali, ALL_BRANCHES);
    assert.deepEqual(idsOf((await loadLaborReport(month))?.branches), ["marina", "tuzla"]);

    // Müdür: firma tercihi yazılı olsa da yalnız kendi şubesi (Şube karşılaştırma yöneticinin)
    await signIn(ids.mert, "marina", FIRMA);
    assert.deepEqual(idsOf((await loadLaborReport(month))?.branches), ["marina"]);
    const mDay = await loadBranchDay();
    assert.deepEqual(idsOf(mDay?.rows), ["marina"]);
    assert.equal(leaks(mDay), false);
  });

  test("İşletme geneli giderler: Yalnız not kipinde işletme geneli kalem ve tutarı yok, Tutarla göster'de var; kâr aynı", async () => {
    const { loadModel } = await import("../src/server/data/dataset");
    await signIn(ids.ali, "marina");
    const noted = await loadModel();
    assert.equal(noted.ds.sharedCostsHidden, true);
    assert.equal(noted.fixedList.some((f) => f.name.includes(SHARED)), false);
    assert.equal(noted.pnlMonth(month).shared.total, 0);
    await signIn(ids.ali, "marina", FIRMA);
    const shown = await loadModel();
    assert.equal(shown.ds.sharedCostsHidden, undefined);
    assert.ok(shown.fixedList.some((f) => f.name.includes(SHARED)));
    assert.ok(shown.pnlMonth(month).shared.total > 0);
    assert.equal(Math.round(shown.pnlMonth(month).profit), Math.round(noted.pnlMonth(month).profit), "şubenin kârı iki kipte aynı");
    // Müdürün kilidi: işletme geneli giderler de "Yalnız not"
    await signIn(ids.mert, "marina", FIRMA);
    assert.equal((await loadModel()).ds.sharedCostsHidden, true);
  });

  test("dışa aktarım: Marina dosyası sekmeleri alanlarının kipiyle; firma kipinde Cari, Tutarlılık ve işletme geneli kalem firmanın", async () => {
    const { GET } = await import("../src/app/api/export/route");
    const exportFile = async (q: string) => {
      const res = await GET({ nextUrl: new URL(`http://panel.test/api/export?ay=${month}${q}`) } as never);
      assert.equal(res.status, 200, await res.clone().text().catch(() => ""));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      return wb;
    };
    await signIn(ids.ali, "marina");
    const sube = await exportFile("&sube=marina");
    const cari = sheetText(sube, "Cari hareketleri");
    assert.equal(leaks(cari), false, "Tuzla'nın faturasına sayılan ödeme yok");
    assert.match(cari, /Marina ödeme/);
    assert.match(cari, /Faturasız alım \(faturası gelecek\) · İşletme geneli/);
    assert.equal(leaks(sheetText(sube, "Faturalar")), false);
    assert.equal(leaks(sheetText(sube, "Personel")), false);
    assert.doesNotMatch(sheetText(sube, "Sabit Giderler"), new RegExp(SHARED), "Yalnız not: işletme geneli kalem yok");
    const tut = sheetText(sube, "Tutarlılık ");
    assert.match(tut, /Tutarlılık kontrolü – .* · Marina/);
    assert.match(tut, /BULGULAR VE NOTLAR · Firma geneli/);
    assert.match(tut, /Firma bulgusu/, "bulgular her dosyada firmanın");
    assert.match(sheetText(sube, "Nasıl Okunur"), /Marina şubesi: satış, kasa, personel[\s\S]*tutarları bu dosyada yok/);

    await signIn(ids.ali, "marina", FIRMA);
    const firma = await exportFile("&sube=marina");
    assert.equal(leaks(sheetText(firma, "Cari hareketleri")), true, "firma kipinde Tuzla'nın ödemesi de");
    assert.match(sheetText(firma, "Sabit Giderler"), new RegExp(SHARED));
    assert.match(sheetText(firma, "Tutarlılık "), /Tutarlılık kontrolü – .* · Firma geneli/);
    assert.equal(leaks(sheetText(firma, "Faturalar")), false, "faturalar dosyanın şubesinin (seçimle)");

    // "Tümü" dosyası: hepsi
    await signIn(ids.ali, ALL_BRANCHES);
    const all = await exportFile("");
    assert.equal(leaks(sheetText(all, "Faturalar")), true);
    assert.equal(leaks(sheetText(all, "Cari hareketleri")), true);
  });

  test("muhasebeci paketi: Marina'nın paketi şubenin; işletme geneli kip ile; bütün şubeler firmanın", async () => {
    const { loadPackageData } = await import("../src/server/muhasebe/paket");
    await signIn(ids.ali, "marina");
    const marina = await loadPackageData(month, new Date(), "marina");
    assert.equal(marina.scope, "Marina");
    assert.equal(leaks(marina), false);
    assert.deepEqual(
      marina.invoices.map((i) => i.supplier),
      ["Sütaş"],
      "Yalnız not: işletme geneli fatura yok",
    );
    assert.deepEqual(
      marina.cash.map((c) => c.branch),
      ["Marina"],
    );
    assert.equal(
      marina.fixed.some((f) => f.name.includes(SHARED)),
      false,
    );
    await signIn(ids.ali, "marina", FIRMA);
    const shown = await loadPackageData(month, new Date(), "marina");
    assert.equal(leaks(shown), false);
    assert.deepEqual(shown.invoices.map((i) => i.supplier).sort(), ["Ortak Tedarik", "Sütaş"]);
    assert.ok(shown.fixed.some((f) => f.name.includes(SHARED)));
    const all = await loadPackageData(month, new Date());
    assert.equal(all.scope, "Bütün şubeler");
    assert.equal(leaks(all), true);
  });

  test("sabah e-postasının önizlemesi: Marina seçiliyken Marina'ya bağlı alıcıların e-postası; Tümü'de firmanınki", async () => {
    const { previewDigest } = await import("../src/server/actions/reminders");
    await signIn(ids.ali, "marina");
    const m = await previewDigest();
    assert.ok(m.ok, !m.ok ? m.error : "");
    assert.equal(m.data.group, "Marina");
    assert.match(m.data.html, /Marina Kira/);
    assert.equal(leaks(m.data.html), false);
    await signIn(ids.ali, ALL_BRANCHES);
    const all = await previewDigest();
    assert.ok(all.ok);
    assert.equal(all.data.group, null);
    assert.equal(leaks(all.data.html), true);
  });
});
