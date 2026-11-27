// Muhasebecinin ekranları gerçek sayfalarla ve gerçek Postgres'te (denetim, 28 Kasım 2026; docs/ROLLER.md › Muhasebeci):
// Faturalar, Gelir-gider, Aylık harcamalar ve Kasa raporu muhasebecinin oturumuyla çağrılır, döndürdükleri ağaç
// taranır. Ağaçta (sunucunun çizdiği bağlantılar ve istemci bileşenlerine giden veri) muhasebecinin açamayacağı ekrana
// tek bağlantı yoktur; yazan bileşenler (şube atama kutusu, rapor formu) yoktur ya da salt okunur kurulur. Aynı sayfalar
// yöneticinin oturumunda o bağlantıları ve bileşenleri taşır (karşılaştırma boşa geçmesin).
//
// İstemci bileşenlerinin kendi çizimi (düğmeler) tests/muhasebeci-salt-okunur.test.ts'te; burada sayfanın onlara verdiği
// rol ve sunucuda çizilenler denetlenir: Kasa raporunda zayi "Ekle" (Zayi & ikram muhasebeciye kapalı), raporu olmayan
// günde rapor formu, Gelir-gider'de "Sayım gir", Faturalar'da şube atama kutusu.
//
// MUHASEBECI_EKRAN_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: MUHASEBECI_EKRAN_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/muhasebeci-ekran-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { BRANCH_COOKIE, DEFAULT_BRANCHES } from "../src/lib/branches";
import { currentMonthTR, daysInMonth, shiftMonth } from "../src/lib/calc/engine";
import { businessDate } from "../src/lib/cash-report";
import { GOODS_CATEGORIES } from "../src/lib/constants";
import { addDays } from "../src/lib/reminders";
import { openableHref } from "../src/lib/roles";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MUHASEBECI_EKRAN_TEST_DATABASE_URL;
const DB_NAME = `laffogato_muhasebeci_ekran_${process.pid}`;
const SECRET = "muhasebeci-ekran-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const TODAY = businessDate();
/** Raporu olan gün (dün) ve raporu olmayan gün (evvelsi gün) */
const REPORTED = addDays(TODAY, -1);
const EMPTY = addDays(TODAY, -2);
/** Cirosu girilmiş, sayımı olmayan ay (Gelir-gider "sayımı yok" uyarısını çizer) */
const MONTH = shiftMonth(currentMonthTR(), -1);

/** Tarayıcının çerez kutusu: dal.ts ve şube seçimi cookies() ile bunu okur */
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

interface Seen {
  /** Ağaçtaki bütün bağlantılar: çizilen öğelerin `href`'i ve bileşenlere giden verideki `href` alanları */
  hrefs: string[];
  /** Ağaçtaki bileşenler (adı ve prop'ları) */
  components: { name: string; props: Record<string, unknown> }[];
  /** Ağaçtaki bütün metinler */
  texts: string[];
}

/**
 * Sayfanın ağacını tarar. Sunucu bileşenleri (async) çağrılır ve döndürdükleri taranır; kancasız düz bileşenler de
 * çağrılır. Kanca kullanan istemci bileşeni çağrılamaz (çizim dışında kanca fırlatır): onun yerine prop'ları taranır
 * (tarayıcıya giden veri). Yükleme iskeleti (`fallback`) içerik değildir, taranmaz.
 */
async function walk(node: unknown, out: Seen, seen = new WeakSet<object>()): Promise<void> {
  if (typeof node === "string") {
    out.texts.push(node.replace(/ /g, " "));
    return;
  }
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (node instanceof Promise) return walk(await node, out, seen);
  if (Array.isArray(node) || node instanceof Set) {
    for (const v of node) await walk(v, out, seen);
    return;
  }
  if (node instanceof Map) {
    for (const v of node.values()) await walk(v, out, seen);
    return;
  }
  const el = node as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
  if (typeof el.$$typeof === "symbol" && el.props && typeof el.props === "object") {
    if (typeof el.type === "function") {
      const fn = el.type as (p: unknown) => unknown;
      out.components.push({ name: fn.name, props: el.props });
      if (fn.constructor.name === "AsyncFunction") return walk(await fn(el.props), out, seen);
      let rendered: unknown;
      let called = false;
      try {
        rendered = fn(el.props);
        called = true;
      } catch {
        // İstemci bileşeni (kanca): prop'ları aşağıda taranır
      }
      if (called) return walk(rendered, out, seen);
    }
    for (const [k, v] of Object.entries(el.props)) {
      if (k === "fallback") continue;
      if (k === "href" && typeof v === "string") out.hrefs.push(v);
      await walk(v, out, seen);
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("_")) continue;
    if (k === "href" && typeof v === "string") out.hrefs.push(v);
    await walk(v, out, seen);
  }
}

const pathOf = (href: string) => href.split(/[?#]/, 1)[0];

describe("Muhasebecinin ekranları: yazma bileşeni ve kapalı ekrana bağlantı yok", { skip: !SERVER_URL && "MUHASEBECI_EKRAN_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let jar = new Jar();
  const ids = { ali: 0, zeynep: 0 };
  const pages: Record<"faturalar" | "gelir-gider" | "harcamalar" | "kasa", (props: never) => unknown> = {} as never;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    delete process.env.KARAOKE_SYNC_SECRET;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => new Headers() });
    stub("next/navigation", {
      ...require("next/navigation"),
      redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to });
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    stub("next/server", { ...require("next/server"), connection: async () => {}, after: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    // İki fiziksel şube açık (Tuzla, Marina): Faturalar'ın şube rozetleri ve "şubesi seçilmemiş" kutusu çizilir
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ name: "Ali", email: "ali@ornek.com", passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    const [z] = await db.insert(s.users).values({ name: "Zeynep", email: "zeynep@ornek.com", passwordHash: "x", role: "accountant" }).returning({ id: s.users.id });
    Object.assign(ids, { ali: a.id, zeynep: z.id });

    // Geçen ay: ciro ve açık gün var, sayım yok. Şubesi seçilmemiş bir fatura. Dünün kasa raporu (Tuzla); evvelsi gün boş
    await db.insert(s.months).values({ month: MONTH, branchId: "tuzla", openDays: daysInMonth(MONTH), posRevenue: 400_000 });
    await db.insert(s.invoices).values({ date: `${MONTH}-10`, supplier: "Sütaş", category: GOODS_CATEGORIES[0], amount: 1_000, payable: 1_010, unpaid: true });
    await db.insert(s.cashReports).values({ date: REPORTED, branchId: "tuzla", zTotal: 5_000, cash: 2_000, card: 3_000, countedCash: 2_000, submittedByName: "Ayşe", submittedBy: a.id });

    dal = await import("../src/server/auth/dal");
    pages.faturalar = (await import("../src/app/panel/faturalar/page")).default as never;
    pages["gelir-gider"] = (await import("../src/app/panel/gelir-gider/page")).default as never;
    pages.harcamalar = (await import("../src/app/panel/harcamalar/page")).default as never;
    pages.kasa = (await import("../src/app/panel/kasa/page")).default as never;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Bu tarayıcıda (yeni çerez kutusu) oturum; `scope` soldaki şube seçimi (verilmezse "Tümü") */
  const signIn = async (k: keyof typeof ids, scope?: string) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids[k]));
    await dal.startSession(u);
    if (scope) jar.set(BRANCH_COOKIE, scope);
  };

  /** Sayfa oturumdaki kişi için çağrılır ve ağacı taranır */
  const view = async (page: keyof typeof pages, who: keyof typeof ids, opts: { query?: Record<string, string>; scope?: string } = {}): Promise<Seen> => {
    await signIn(who, opts.scope);
    const out: Seen = { hrefs: [], components: [], texts: [] };
    await walk(pages[page]({ searchParams: Promise.resolve(opts.query ?? {}) } as never), out);
    return out;
  };
  const component = (seen: Seen, name: string) => seen.components.find((c) => c.name === name)?.props;
  const panelPaths = (seen: Seen) => [...new Set(seen.hrefs.filter((h) => h.startsWith("/panel")).map(pathOf))].sort();
  const assertOpenable = (seen: Seen, where: string) => {
    for (const href of seen.hrefs.filter((h) => h.startsWith("/panel"))) assert.ok(openableHref("accountant", href) !== null, `${where}: muhasebeci ${href} adresini açamaz, bağlantısı ağaçta`);
  };

  test("oturum: Zeynep muhasebeci", async () => {
    await signIn("zeynep");
    assert.equal((await dal.getCurrentUser())?.role, "accountant");
  });

  test("Faturalar: muhasebeciye şube atama kutusu çizilmez, liste rolüyle kurulur; yöneticide kutu durur", async () => {
    const adminView = await view("faturalar", "ali");
    assert.ok(component(adminView, "UnassignedBox"), "yöneticide şubesi seçilmemiş kutusu (karşılaştırmanın dayanağı)");
    assert.equal(component(adminView, "InvoicesClient")?.role, "admin");

    const seen = await view("faturalar", "zeynep");
    assert.equal(component(seen, "UnassignedBox"), undefined, "muhasebecide şube atama kutusu yok");
    assert.equal(component(seen, "DeletedBills"), undefined);
    const list = component(seen, "InvoicesClient");
    assert.ok(list, "fatura listesi ağaçta");
    assert.equal(list.role, "accountant");
    assert.equal((list.invoices as unknown[]).length, 1, "fatura muhasebeciye de gelir");
    assert.ok(!seen.texts.some((t) => t.includes("elle de ekleyebilirsiniz")), "başlık eklemeyi önermez");
    assertOpenable(seen, "Faturalar");
  });

  test("Gelir-gider: muhasebeciye 'Sayım gir' ve Satışlar bağlantısı yok, tablo rolüyle kurulur; uyarının kendisi durur", async () => {
    const year = MONTH.slice(0, 4);
    const adminView = await view("gelir-gider", "ali", { query: { yil: year } });
    assert.ok(panelPaths(adminView).includes("/panel/sayim"), "yöneticide 'Sayım gir' bağlantısı (karşılaştırmanın dayanağı)");
    assert.ok(panelPaths(adminView).includes("/panel/satislar"), "yöneticide ciro dökümü Satışlar'a gider");
    assert.equal(component(adminView, "PnlGrid")?.role, "admin");

    const seen = await view("gelir-gider", "zeynep", { query: { yil: year } });
    assert.equal(component(seen, "PnlGrid")?.role, "accountant");
    assert.equal(component(seen, "SiteSalesCard")?.readOnly, true);
    assert.ok(seen.texts.some((t) => t.includes("sayımı yok")), "sayım uyarısı muhasebecide de okunur");
    assert.ok(!seen.texts.some((t) => t.includes("tutarları yazın")), "başlık tutar yazmayı önermez");
    assertOpenable(seen, "Gelir-gider");
  });

  test("Aylık harcamalar: sayfa muhasebecinin rolüyle kurulur, sekmelerde kapalı ekran yok", async () => {
    const adminView = await view("harcamalar", "ali");
    assert.equal(component(adminView, "MonthlyExpenses")?.role, "admin");
    assert.ok(panelPaths(adminView).includes("/panel/giderler"), "yöneticinin sekmelerinde Sabit giderler (karşılaştırmanın dayanağı)");

    const seen = await view("harcamalar", "zeynep");
    assert.equal(component(seen, "MonthlyExpenses")?.role, "accountant");
    assertOpenable(seen, "Aylık harcamalar");
  });

  test("Kasa raporu › ay: muhasebecide liste salt okunur, ayar kartı ve Teslim defteri yok", async () => {
    const adminView = await view("kasa", "ali", { scope: "tuzla" });
    assert.equal(component(adminView, "CashHistory")?.readOnly, false);
    assert.ok(component(adminView, "CashSettingsCard"), "yöneticide kasanın rapor ayarları (karşılaştırmanın dayanağı)");
    assert.ok(panelPaths(adminView).includes("/panel/kasa/teslim"));

    const seen = await view("kasa", "zeynep", { scope: "tuzla" });
    const history = component(seen, "CashHistory");
    assert.ok(history, "ay listesi ağaçta");
    assert.equal(history.readOnly, true);
    assert.equal(component(seen, "CashSettingsCard"), undefined);
    assert.ok((history.days as { report: unknown }[]).some((d) => d.report), "raporlar rakamlarıyla muhasebeciye gelir");
    assertOpenable(seen, "Kasa raporu › ay");
  });

  test("Kasa raporu › raporu olan gün: muhasebeciye zayi 'Ekle' çizilmez (Zayi & ikram ona kapalı), rapor salt okunur", async () => {
    const adminView = await view("kasa", "ali", { scope: "tuzla", query: { gun: REPORTED } });
    assert.ok(panelPaths(adminView).includes("/panel/zayi"), "yöneticide zayi 'Ekle' bağlantısı (karşılaştırmanın dayanağı)");
    assert.equal(component(adminView, "CashForm")?.canEdit, true);

    const seen = await view("kasa", "zeynep", { scope: "tuzla", query: { gun: REPORTED } });
    assert.ok(!panelPaths(seen).includes("/panel/zayi"), "muhasebecide Zayi & ikram'a bağlantı yok");
    const form = component(seen, "CashForm");
    assert.ok(form, "kayıtlı rapor ağaçta");
    assert.equal(form.canEdit, false);
    assert.equal(form.readOnly, true);
    assert.equal((form.report as { zTotal: number }).zTotal, 5_000, "rapor rakamlarıyla gelir");
    assert.equal(component(seen, "CashOutsCard")?.canEdit, false);
    assertOpenable(seen, "Kasa raporu › gün");
  });

  test("Kasa raporu › raporu olmayan gün: muhasebeciye rapor formu çizilmez, yöneticiye çizilir", async () => {
    const adminView = await view("kasa", "ali", { scope: "tuzla", query: { gun: EMPTY } });
    const adminForm = component(adminView, "CashForm");
    assert.ok(adminForm, "yöneticide boş günün formu (karşılaştırmanın dayanağı)");
    assert.equal(adminForm.report, null);

    const seen = await view("kasa", "zeynep", { scope: "tuzla", query: { gun: EMPTY } });
    assert.equal(component(seen, "CashForm"), undefined, "muhasebecide rapor formu yok");
    assert.ok(seen.texts.some((t) => t.includes("Bu günün kasa raporu girilmedi")), "yerinde tek satır");
    assert.ok(!panelPaths(seen).includes("/panel/zayi"));
    assertOpenable(seen, "Kasa raporu › boş gün");
  });
});
