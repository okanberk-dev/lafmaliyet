// Şube ayrımının bağımsız doğrulaması, gerçek Postgres'te (docs/SUBE.md › Şube ayrımı; sahibin isteği 27 Kasım 2026:
// "ladmin'de bir şube seçince sadece o şubeye ait bilgiler çıksın, diğerleri çıkmasın; tüm her yerde bu ayrımı yap").
//
// Veritabanı: başlangıç verisi (scripts/seed.ts; eski verinin hepsi Tuzla'nın ya da şubesiz) ve üstüne
// tests/helpers/sube-ayrimi-tohum.ts: şube sütunu olan her tabloda Marina'nın ve Tuzla'nın ayrı kaydı. Tuzla'nın metinleri
// "TZMARK", tutarları 91.9xx biçiminde.
//
// Dört bakış:
// 1. İşaret: yönetici, Marina seçili, varsayılan şube görünümü: ekranların yükleyicileri, zil, panel asistanının okuma
//    araçları, bağlantının (MCP) cevapları, dışa aktarım, muhasebeci paketi ve sabah e-postasının önizlemesi Tuzla'nın
//    işaretini ya da tutarını göstermemeli.
// 2. Firma kipi: aynı yönetici bütün alanlarda "Firma geneli" seçince alanların ekranı "Tümü"nün toplamlarını göstermeli.
// 3. Müdür (Marina'ya kilitli): firma tercihi yazılı olsa da Tuzla yok.
// 4. Fark: Tuzla'nın bütün satırları silinir, Marina'nın görünümü yeniden okunur. Fark varsa Marina'nın ekranı Tuzla'nın
//    verisinden etkileniyordur (tutar toplamı, sayı, liste); tasarımın bilerek firmanın bıraktığı yerler (ortak veri,
//    "öbür şubelerde N" sayıları) `ORTAK` listesinde gerekçesiyle.
//
// 5. Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026): Vergi'nin okuması ve dışa aktarımın Vergi sekmesi Marina
//    seçiliyken de Tümü'nünkiyle aynı; nakit planının şube kipinde vergi ve SGK hiç yok (İşletme geneli satırında da),
//    bu yüzden Marina'nın nakit akışı Tuzla'nın satışından ve personelinden etkilenmez (fark bakışında istisnası yok).
//
// Bilinen sızıntılar `todo` ile işaretlenir (düzelince işaret kalkar): koşu düşmez, TODO olarak listelenir. İlk koşunun
// sekiz sızıntısı (Faturalar'ın cari bağları, sabah e-postasının fatura bölümü, Mutabakat POS'un şube karoları, Maaşlar'ın
// hesap seçicisi, Kullanıcılar & roller, Site menüsü ve Reçete defterinin bekleyen yeni ürün önerileri, ekstre yükleme
// penceresinin tedarikçileri) 27 Kasım 2026'da kapandı ("Şube ayrımı: doğrulama düzeltmeleri"); bugün işaretli yok.
// Mutabakat bölümü 28 Kasım 2026'da kaldırıldı: ekranları ve ekstre tohumu bu listeden çıktı.
//
// SUBE_AYRIMI_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları ve başlangıç verisini uygular, sonunda siler.
// Çalıştırma: SUBE_AYRIMI_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-ayrimi-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import postgres from "postgres";

import type { BranchViewPrefs, ViewArea } from "../src/lib/branch-view";
import { VIEW_AREA_KEYS } from "../src/lib/branch-view";
import { ALL_BRANCHES, BRANCH_COOKIE } from "../src/lib/branches";
import { addDays, todayTR } from "../src/lib/reminders";
import { businessDate } from "../src/lib/cash-report";
import * as s from "../src/server/db/schema";

import { deleteBranchRows, seedSubeAyrimi, type SubeTohum, tzLeaks } from "./helpers/sube-ayrimi-tohum";

const SERVER_URL = process.env.SUBE_AYRIMI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_ayrimi_${process.pid}`;
const SECRET = "sube-ayrimi-dogrulama-testi-icin-otuz-iki-karakterlik-anahtar";

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

/** Karşılaştırma için: Map/Set dizi, tutar kuruşa yuvarlı, zaman damgası ve işlev düşer */
function norm(v: unknown): unknown {
  const text = JSON.stringify(v ?? null, (_k, x) => {
    if (x instanceof Map) return [...x].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (x instanceof Set) return [...x].sort();
    if (typeof x === "number") return Math.round(x * 100) / 100;
    if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x)) return "<zaman>";
    return x;
  });
  return JSON.parse(text ?? "null");
}

/** Tasarımın firmanın bıraktığı yolları "<ortak>" yapar (işaret bakışı da onları aramaz) */
function prune(v: unknown, skip: readonly RegExp[], path = ""): unknown {
  if (skip.some((r) => r.test(path))) return "<ortak>";
  if (Array.isArray(v)) return v.map((x, i) => prune(x, skip, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prune(x, skip, `${path}.${k}`)]));
  return v;
}

/** İki ağacın farklı yolları (en çok `max`); `skip` yolun bir parçasına uyarsa yol atlanır */
function diffPaths(a: unknown, b: unknown, skip: readonly RegExp[], path = "", out: string[] = [], max = 12): string[] {
  if (out.length >= max) return out;
  if (skip.some((r) => r.test(path))) return out;
  if (a === b) return out;
  if (typeof a === "string" && typeof b === "string") {
    // Uzun metinde (e-posta, çalışma kitabı) ilk farklı yerin çevresi
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    out.push(`${path || "."}: …${a.slice(Math.max(0, i - 60), i + 100)}… → …${b.slice(Math.max(0, i - 60), i + 100)}…`);
    return out;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    out.push(`${path || "."}: ${JSON.stringify(a)?.slice(0, 120)} → ${JSON.stringify(b)?.slice(0, 120)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: dizi/nesne`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: ${a.length} öğe → ${b.length} öğe (${JSON.stringify(a).slice(0, 160)})`);
      return out;
    }
    a.forEach((x, i) => diffPaths(x, b[i], skip, `${path}[${i}]`, out, max));
    return out;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  for (const k of new Set([...ka, ...kb])) diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], skip, `${path}.${k}`, out, max);
  return out;
}

/** Çalışma kitabının bütün hücreleri ve notları (metin) */
function workbookText(wb: ExcelJS.Workbook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ws of wb.worksheets) {
    const cells: string[] = [];
    ws.eachRow((r) =>
      r.eachCell((c) => {
        const v = c.value;
        cells.push(String(typeof v === "object" && v && "result" in v ? v.result : typeof v === "object" && v && "richText" in v ? v.richText.map((t) => t.text).join("") : (v ?? "")));
        if (c.note) cells.push(typeof c.note === "string" ? c.note : JSON.stringify(c.note));
      }),
    );
    out[ws.name] = cells.join("\n");
  }
  return out;
}

/**
 * Tasarımın bilerek firmanın bıraktığı yerler (docs/SUBE.md › Şube ayrımı; COMPANY_WIDE_READS), gerekçesiyle. Bunlar
 * sızıntı sayılmaz; yine de Tuzla'nın verisinden etkilenirler (rapor ayrıca yazar)
 */
const ORTAK = {
  /** dataset.companyMonths (ortak-veri): işletme geneli giderin günü Tümü'nün açık günüyle; ekrana çıkmaz */
  companyMonths: /\.ds\.companyMonths$/,
  /** Onay bekleyen hammadde fiyatları (ortak veri: hammaddenin fiyatı); maliyeti eksik ürün uyarısının metni */
  pendingPriceHolds: /\.ds\.pendingPriceHolds$/,
  /** "Öbür şubelerde N öneri daha" sayısı (parça 5) */
  elsewhere: /\.elsewhere$/,
  /** loadUpcoming'in iç eşlemesi (fatura → şube); ekrana çıkmaz, nakit planının işletme geneli kimlikleri için */
  invoiceBranches: /\.invoiceBranches$/,
  /** Tedarikçi kütüğü (ortak veri) ve cari takibi (firmanın tek hesabı) */
  cariIndex: /^\.(cards|tracked|credit|entries|refs)$/,
} as const;

interface Screen {
  /** Ekran ya da yüzey ve okuyan dosya */
  name: string;
  run: () => Promise<unknown>;
  /** Fark bakışında atlanan yollar (tasarımın firmanın bıraktığı yer, gerekçesiyle `ORTAK`ta) */
  shared?: readonly RegExp[];
  /** Bilinen sızıntı (todo): dosya:satır ve kısa açıklama */
  leak?: string;
  /** Bilinen fark (yalnız fark bakışında; todo) */
  diffLeak?: string;
}

describe("şube ayrımı doğrulaması: Marina seçiliyken Tuzla'nın verisi hiçbir yerde yok", { skip: !SERVER_URL && "SUBE_AYRIMI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let jar = new Jar();
  let seed: SubeTohum;
  const today = todayTR();

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    delete process.env.RESEND_API_KEY;
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
    const { runMigrations } = await import("../scripts/migrate");
    await runMigrations(url.href);
    const { runSeed } = await import("../scripts/seed");
    const log = console.log;
    console.log = () => {};
    try {
      await runSeed({ url: url.href });
    } finally {
      console.log = log;
    }
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    seed = await seedSubeAyrimi(db, today);
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
  const FIRMA = Object.fromEntries(VIEW_AREA_KEYS.map((a) => [a, "firma"])) as BranchViewPrefs;
  const me = async () => (await dal.getCurrentUser())!;
  const area = (a: ViewArea) => scope.areaScope(a);
  const sel = () => scope.currentBranchScope();
  const month = () => seed.month;

  const mcp = async (name: string, args: Record<string, unknown>) => {
    const { TOOLS } = await import("../src/server/mcp/tools");
    const t = TOOLS.find((x) => x.name === name)!;
    // Bağlantının ucu gibi: anahtar sahibinin tercihi (src/server/mcp/server.ts)
    const prefs = await scope.userBranchViewOf(seed.users.admin);
    return scope.withBranchView(prefs, () => (t.run as (a: unknown, c: unknown) => Promise<unknown>)(t.inputSchema.parse(args), { base: "https://panel.test", now: new Date() }));
  };
  const assistant = async (name: string, args: Record<string, unknown>) => {
    const { ASSISTANT_TOOLS } = await import("../src/server/ai/assistant/tools");
    const t = ASSISTANT_TOOLS.find((x) => x.name === name)!;
    assert.ok(t, `asistan aracı yok: ${name}`);
    // Panel asistanının ucu gibi: seçili şubenin kapsamında (src/server/ai/assistant/service.ts › scoped)
    const cookie = await scope.branchScope();
    return scope.withBranchScope(cookie.scope, () => (t.run as (a: unknown, c: unknown) => Promise<unknown>)(t.inputSchema.parse(args), { base: "", now: new Date() }));
  };
  const exportBook = async (q: string) => {
    const { GET } = await import("../src/app/api/export/route");
    const res = await GET({ nextUrl: new URL(`http://panel.test/api/export?ay=${month()}${q}`) } as never);
    assert.equal(res.status, 200, await res.clone().text().catch(() => ""));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    return workbookText(wb);
  };

  // ------------------------------------------------------------------ Ekranların okumaları (sayfanın verdiği kapsamla)
  const SCREENS: Screen[] = [
    // Genel bakış (src/app/panel/page.tsx)
    {
      name: "Genel bakış › model (loadModel)",
      run: async () => {
        const { loadModel } = await import("../src/server/data/dataset");
        const m = await loadModel();
        return { ds: m.ds, fixedList: m.fixedList, pnl: m.pnlMonth(month()) };
      },
      shared: [ORTAK.companyMonths, ORTAK.pendingPriceHolds],
    },
    {
      name: "Genel bakış › Yaklaşan ödemeler (loadUpcoming, alan.odemeler)",
      run: async () => {
        const { loadUpcoming } = await import("../src/server/notify/digest");
        return loadUpcoming(today, { branch: await area("odemeler") });
      },
      shared: [ORTAK.invoiceBranches],
    },
    {
      name: "Genel bakış / Nakit planı (loadAreaCashPlan, alan.nakit)",
      run: async () => {
        const { loadAreaCashPlan } = await import("../src/server/data/cash-plan");
        return loadAreaCashPlan(await area("nakit"));
      },
      // İşletme geneli satırında vergi ve SGK yok (vergi şubeye bölünmez): satır Tuzla'nın satışından ve personelinden
      // etkilenmez, istisnası yok
      shared: [/\.model\.ds\.companyMonths$/, /\.model\.ds\.pendingPriceHolds$/],
    },
    {
      name: "Genel bakış › günlük ciro (tillRows)",
      run: async () => (await import("../src/server/data/cash-reports")).tillRows(),
    },
    {
      name: "Genel bakış › kasadan faturalı alımlar (scopeCashOutInvoiceState)",
      run: async () => {
        const m = await import("../src/server/data/cash-out-invoices");
        return m.scopeCashOutInvoiceState(await m.loadCashOutInvoiceState(), await sel());
      },
    },
    {
      name: "Genel bakış / Hammaddeler › onay bekleyen fiyatlar (pendingHoldSummary)",
      run: async () => (await import("../src/server/data/price-holds")).pendingHoldSummary(await sel()),
      shared: [ORTAK.elsewhere],
    },
    {
      name: "Genel bakış › zam uyarısı (loadPriceAlerts)",
      run: async () => {
        const { loadModel } = await import("../src/server/data/dataset");
        const { loadPriceAlerts } = await import("../src/server/data/price-alerts");
        return loadPriceAlerts(await loadModel());
      },
    },
    // Bugün (src/app/panel/bugun/page.tsx)
    {
      name: "Bugün (loadToday)",
      run: async () => {
        const { loadToday } = await import("../src/server/data/today");
        const d = await loadToday(await me());
        return { facts: d.facts, reminders: d.reminders, cafe: d.cafe };
      },
    },
    { name: "Bugün › Şubelerde gün (loadBranchDay)", run: async () => (await import("../src/server/data/branch-day")).loadBranchDay() },
    { name: "Bugün › vardiya (todayShifts)", run: async () => (await import("../src/server/vardiya/store")).todayShifts() },
    { name: "Bugün / Genel bakış › kritik stok (loadStockAlert)", run: async () => (await import("../src/server/data/stock-estimate")).loadStockAlert() },
    // Zil
    { name: "Zil (loadPanelNotifications)", run: async () => (await import("../src/server/actions/notifications")).loadPanelNotifications() },
    // Ödemeler (src/app/panel/hatirlaticilar/page.tsx)
    { name: "Ödemeler › Son ödenenler (loadRecentPaid)", run: async () => (await import("../src/server/data/recent-paid")).loadRecentPaid(await area("odemeler")) },
    { name: "Ödemeler › Son gönderimler (recentNotifications)", run: async () => (await import("../src/server/notify/digest")).recentNotifications(12, await area("odemeler")) },
    { name: "Ödemeler › bildirim adresleri (loadRecipientsInScope)", run: async () => (await import("../src/server/notify/recipients")).loadRecipientsInScope(db, await area("odemeler")) },
    {
      // Ekranda yalnız adaylar; `all` tutar karşılaştırması için bütün kalemler (tasarım; kapsam C P1-3)
      name: "Ödemeler › Sabit giderlerden ekle (loadFixedForReminders)",
      run: async () => ({ candidates: (await (await import("../src/server/data/fixed-reminders")).loadFixedForReminders(db, today.slice(0, 7), await sel())).candidates }),
    },
    // Hatırlatıcılarım
    { name: "Hatırlatıcılarım › Kime (assignablePeople)", run: async () => (await import("../src/server/data/user-reminders")).assignablePeople(seed.users.admin, await sel()) },
    // Sabit giderler, Aylık harcamalar
    { name: "Sabit giderler › yatırımlar (loadInvestments)", run: async () => (await import("../src/server/data/investments")).loadInvestments(await sel()) },
    { name: "Aylık harcamalar › ekler (expenseExtras)", run: async () => (await import("../src/server/data/expense-extras")).expenseExtras(month()) },
    // Gelir-gider
    { name: "Gelir-gider › faturası beklenen alımlar (loadExpectedDebtsInYear)", run: async () => (await import("../src/server/data/cari")).loadExpectedDebtsInYear(Number(month().slice(0, 4))) },
    // Hammaddeler
    { name: "Hammaddeler › onay bekleyen fiyatlar (loadPriceHolds)", run: async () => (await import("../src/server/data/price-holds")).loadPriceHolds(await sel()), shared: [ORTAK.elsewhere] },
    // Kasa
    {
      name: "Kasa › ayın raporları (cashReportsBetween, admin)",
      run: async () => {
        const { cashReportsBetween } = await import("../src/server/data/cash-reports");
        const till = await scope.currentTillBranch();
        return scope.withBranchScope(till, () => cashReportsBetween(`${month()}-01`, today, "admin", "admin"));
      },
    },
    {
      name: "Kasa › kasadan çıkanlar (cashOutsBetween)",
      run: async () => {
        const { cashOutsBetween } = await import("../src/server/data/cash-outs");
        const till = await scope.currentTillBranch();
        return scope.withBranchScope(till, () => cashOutsBetween(`${month()}-01`, today));
      },
    },
    {
      name: "Kasa › günün zayisi (dayWaste)",
      run: async () => {
        const { dayWaste } = await import("../src/server/data/waste");
        const till = await scope.currentTillBranch();
        return scope.withBranchScope(till, () => dayWaste(seed.d1));
      },
    },
    {
      name: "Kasa › AsilPOS günü (loadKasaAsilposDays)",
      run: async () => {
        const { loadKasaAsilposDays } = await import("../src/server/data/asilpos-day");
        const till = await scope.currentTillBranch();
        const f = await scope.withBranchScope(till, () => loadKasaAsilposDays(`${month()}-01`, today));
        return [f(seed.d1), f(seed.d1, till)];
      },
    },
    { name: "Kasa › Teslim defteri (handoverLedger)", run: async () => (await import("../src/server/data/handover-ledger")).handoverLedger(month()) },
    { name: "Kasa › Teslim defterinin ilk günü (handoverFirstDate)", run: async () => (await import("../src/server/data/handover-ledger")).handoverFirstDate() },
    { name: "Kasa › kasa kapsamları (loadTillScopes)", run: async () => (await import("../src/server/data/till-scope")).loadTillScopes() },
    // Onaylar
    {
      name: "Onaylar › kasa istekleri (loadCashRequestQueue)",
      run: async () => (await import("../src/server/data/cash-requests")).loadCashRequestQueue(new Date(), await sel(), false, true),
    },
    { name: "Onaylar › reçete önerileri (loadReviewQueue)", run: async () => (await import("../src/server/data/recipe-requests")).loadReviewQueue(30, await sel()) },
    { name: "Onaylar › bekleyen reçete önerisi sayısı (countPendingRequests)", run: async () => (await import("../src/server/data/recipe-requests")).countPendingRequests(await sel()) },
    {
      name: "Onaylar › Son kararlar (recentDecisions)",
      run: async () => {
        // src/app/panel/onaylar/recent-decisions.tsx: okuma ve şubeyle süzme
        const { recentDecisions } = await import("../src/server/staff-requests/core");
        const { requestsInScope } = await import("../src/server/staff-requests/branch");
        const sc = await sel();
        return (await requestsInScope(db, await recentDecisions(db as never, 30, new Date(), sc === ALL_BRANCHES ? 40 : 200), sc)).slice(0, 40);
      },
    },
    // Özel günler
    { name: "Özel günler (loadSpecialDays)", run: async () => (await import("../src/server/special-days")).loadSpecialDays(today, await sel()) },
    // Komisyon
    {
      name: "Komisyon & hakediş (loadCommissionReports)",
      run: async () => {
        const r = await (await import("../src/server/data/commission")).loadCommissionReports();
        // Firmanın raporu (katlı ek) tasarımda firmanın: yalnız ana görünüm
        return { branch: r.branch, scope: r.scope, mode: r.mode };
      },
    },
    // Kontrol listeleri
    { name: "Kontrol listeleri › gün (loadChecklistDay)", run: async () => (await import("../src/server/data/checklists")).loadChecklistDay(seed.d1, "admin") },
    { name: "Kontrol listeleri › Geçmiş (loadChecklistHistory)", run: async () => (await import("../src/server/data/checklists")).loadChecklistHistory(`${month()}-01`, today, "admin") },
    { name: "Kontrol listeleri › düzenle (loadChecklistTemplates scoped)", run: async () => (await import("../src/server/data/checklists")).loadChecklistTemplates({ scoped: true }) },
    // Raporlar
    { name: "Raporlar › Şube karşılaştırma (loadBranchCompare)", run: async () => (await import("../src/server/data/sube-karsilastirma")).loadBranchCompare(month(), 3) },
    { name: "Raporlar › İşçilik / ciro (loadLaborReport)", run: async () => (await import("../src/server/data/iscilik")).loadLaborReport(month()) },
    { name: "Raporlar › Kayıp önleme (loadLossSummary)", run: async () => (await import("../src/server/data/kayip-onleme")).loadLossSummary(month(), 3) },
    { name: "Raporlar › Kaçak raporu (loadLeakReport)", run: async () => (await import("../src/server/data/kacak")).loadLeakReport(month()) },
    // Reçeteler
    { name: "Reçete defteri › bekleyen (countPendingByKind)", run: async () => (await import("../src/server/data/recipe-requests")).countPendingByKind(await sel()) },
    {
      // Sayfa seçimle çağırır (src/app/panel/urunler/site/page.tsx)
      name: "Site menüsü › bekleyen yeni ürün önerileri (pendingNewProposalRows)",
      run: async () => (await import("../src/server/data/recipe-requests")).pendingNewProposalRows(db, await sel()),
    },
    {
      // Personel ve müdür görünümü (yönetici boş liste alır; src/app/panel/receteler/page.tsx): müdürde kilitli şube
      name: "Reçete defteri › bekleyen yeni ürün adları (pendingNewProposals, personel ve müdür)",
      run: async () => (await import("../src/server/data/recipe-requests")).pendingNewProposals(await sel()),
    },
    // Sayım, tahmini stok
    { name: "Tahmini stok (loadStockEstimate)", run: async () => (await import("../src/server/data/stock-estimate")).loadStockEstimate() },
    {
      name: "Tahmini stok › faturalar (loadReceiptInvoices)",
      run: async () => (await import("../src/server/data/stock-estimate")).loadReceiptInvoices(`${seed.prevMonth}-01`, today, db, 50, await sel()),
      // "N fatura başka şubede, M fatura işletme geneli" sayısı (parça 5)
      shared: [/\.elsewhere\.branches$/],
    },
    // Tedarikçiler
    { name: "Tedarikçiler › bakiyeler (loadSupplierLedger, alan.tedarikciler)", run: async () => (await import("../src/server/data/suppliers")).loadSupplierLedger(await area("tedarikciler")) },
    { name: "Tedarikçiler › cari (loadCariIndex)", run: async () => (await import("../src/server/data/cari")).loadCariIndex(today), shared: [ORTAK.cariIndex] },
    // Tutarlılık
    {
      name: "Tutarlılık › model (loadModel, alan.tutarlilik)",
      run: async () => {
        const { loadModel } = await import("../src/server/data/dataset");
        const m = await scope.withBranchScope(await area("tutarlilik"), () => loadModel());
        return { ds: m.ds };
      },
      shared: [ORTAK.companyMonths, ORTAK.pendingPriceHolds],
    },
    {
      name: "Tutarlılık › şubenin alımı (loadBranchPurchases)",
      run: async () => {
        const a = await area("tutarlilik");
        if (a === ALL_BRANCHES) return null;
        const { loadBranchPurchases } = await import("../src/server/data/purchase-lots");
        return loadBranchPurchases(a);
      },
    },
    { name: "Tutarlılık / Zayi › bekleyen zayi istekleri (pendingWasteSummary)", run: async () => (await import("../src/server/data/waste-requests")).pendingWasteSummary({ month: month(), scope: await area("tutarlilik") }) },
    // Vergi: şubeye bölünmez (sahibin kararı 27 Kasım 2026); her kipte firmanın, ayrı bakışta (5)
    // Maaşlar (Personel)
    { name: "Maaşlar › Vardiya / hesap seçicisi (loadStaffLinkOptions)", run: async () => (await import("../src/server/data/staff-links")).loadStaffLinkOptions() },
    // Kullanıcılar & roller (src/app/panel/kullanicilar/page.tsx): parola özeti karşılaştırmadan düşer (her okumada aynı)
    {
      name: "Kullanıcılar & roller (loadUserRows)",
      run: async () => {
        const r = await (await import("../src/server/data/users")).loadUserRows(await sel());
        return { rows: r.rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branchId, active: u.active })), elsewhere: r.elsewhere };
      },
      // "Öbür şubelerin N hesabı" sayısı (Tümü'de görünürler)
      shared: [ORTAK.elsewhere],
    },
    // Vardiya
    {
      name: "Vardiya (loadShiftWeek)",
      run: async () => {
        const { loadShiftWeek } = await import("../src/server/vardiya/store");
        const { weekStart } = await import("../src/lib/vardiya");
        const t = await scope.currentPhysicalBranch();
        return loadShiftWeek(db, { id: t.id, name: t.name }, weekStart(today), { roster: true });
      },
    },
    // Zayi
    {
      name: "Zayi › kayıtlar (wasteEntriesBetween)",
      run: async () => {
        const { wasteEntriesBetween } = await import("../src/server/data/waste");
        return wasteEntriesBetween(`${month()}-01`, today);
      },
    },
    // Ürünler
    { name: "Ürünler › şube fiyatı (loadBranchPrices)", run: async () => (await import("../src/server/data/branch-prices")).loadBranchPrices(await sel()) },
    { name: "Ürünler › kasadaki fiyatlar (posPendingSummaries)", run: async () => (await import("../src/server/data/prices")).posPendingSummaries() },
    // Ürünler › Kasadaki fiyatlar (src/app/panel/urunler/fiyatlar/page.tsx:97–114)
    {
      name: "Ürünler › Kasadaki fiyatlar (loadPosChecklist, loadRecentPosMarks)",
      run: async () => {
        const { loadTillScopes } = await import("../src/server/data/till-scope");
        const { loadPosChecklist, loadRecentPosMarks } = await import("../src/server/data/prices");
        const tills = await loadTillScopes();
        const now = new Date();
        return { lists: await Promise.all(tills.map((t) => loadPosChecklist(t))), marks: await loadRecentPosMarks({ days: 14, now, tills }) };
      },
    },
    // Faturalar
    { name: "Faturalar › faturaların cari bağları (loadInvoiceCariLinks)", run: async () => (await import("../src/server/data/cari")).loadInvoiceCariLinks() },
    { name: "Faturalar › şubesi seçilmemiş kutusu (loadUnassignedBox)", run: async () => (await import("../src/server/data/invoice-branch")).loadUnassignedBox() },
    // Panel asistanı (okuma araçları) ve bağlantı (MCP)
    { name: "Asistan › bugun_ozeti", run: () => assistant("bugun_ozeti", {}) },
    { name: "Asistan › bekleyen_isler", run: () => assistant("bekleyen_isler", {}) },
    { name: "Asistan › gun_sonu", run: () => assistant("gun_sonu", { baslangic: seed.d1 }) },
    // Asistan bugünü iş gününe göre sayar (05:00'te başlar): gece 00:00–05:00 arası takvimin dünü (d1) asistanın
    // "bugün"üdür ve reddedilir. Bitiş iş gününden önceki son tohum günü (CI gece de koşar)
    { name: "Asistan › gunluk_satislar", run: () => assistant("gunluk_satislar", { baslangic: seed.d2, bitis: seed.d1 < businessDate() ? seed.d1 : seed.d2 }) },
    { name: "Asistan › vardiya", run: () => assistant("vardiya", {}) },
    { name: "Asistan › menu_durumu", run: () => assistant("menu_durumu", {}) },
    { name: "Asistan › stok_tahmini", run: () => assistant("stok_tahmini", { hepsi: true }) },
    { name: "Asistan › asilpos_durumu", run: () => assistant("asilpos_durumu", {}) },
    { name: "Asistan › ay_ozeti", run: () => assistant("ay_ozeti", { ay: month() }) },
    { name: "Asistan › odemeler", run: () => assistant("odemeler", {}) },
    { name: "Asistan › tedarikci_ozeti", run: () => assistant("tedarikci_ozeti", {}) },
    { name: "Asistan › kasa_raporlari", run: () => assistant("kasa_raporlari", { baslangic: `${month()}-01`, bitis: today }) },
    { name: "Asistan › urun_karliligi", run: () => assistant("urun_karliligi", { ay: month() }) },
    { name: "Asistan › ara (Latte)", run: () => assistant("ara", { metin: "Latte" }) },
    { name: "Asistan › parasut_bekleyenler", run: () => assistant("parasut_bekleyenler", {}) },
    { name: "Bağlantı › ara", run: () => mcp("ara", { metin: "Latte" }) },
    { name: "Bağlantı › ay_ozeti (sube=marina)", run: () => mcp("ay_ozeti", { ay: month(), sube: "marina" }) },
    { name: "Bağlantı › odemeler (sube=marina)", run: () => mcp("odemeler", { sube: "marina" }) },
    { name: "Bağlantı › odemeler, nakit planı (sube=marina)", run: () => mcp("odemeler", { sube: "marina", nakitPlani: true }) },
    { name: "Bağlantı › tedarikci_ozeti (sube=marina)", run: () => mcp("tedarikci_ozeti", { sube: "marina" }) },
    { name: "Bağlantı › kasa_raporlari (sube=marina)", run: () => mcp("kasa_raporlari", { baslangic: `${month()}-01`, bitis: today, sube: "marina" }) },
    { name: "Bağlantı › urun_karliligi (sube=marina)", run: () => mcp("urun_karliligi", { ay: month(), sube: "marina" }) },
    { name: "Bağlantı › zam_etkisi (sube=marina)", run: () => mcp("zam_etkisi", { sube: "marina" }) },
    // Dışa aktarım, muhasebeci paketi, sabah e-postasının önizlemesi
    { name: "Dışa aktarım (?sube=marina)", run: () => exportBook("&sube=marina") },
    { name: "Muhasebeci paketi (Marina)", run: async () => (await import("../src/server/muhasebe/paket")).loadPackageData(month(), new Date(), "marina") },
    {
      name: "Sabah e-postasının önizlemesi (previewDigest)",
      run: async () => {
        const r = await (await import("../src/server/actions/reminders")).previewDigest();
        return r.ok ? { group: r.data.group, html: r.data.html } : r;
      },
    },
  ];

  const results = new Map<string, unknown>();
  /** "Tümü"nün okuması (silmeden önce): ekran Tuzla'nın verisini görebiliyor mu (bakışın boş olmadığının kanıtı) */
  const allBefore = new Map<string, unknown>();
  const insensitive: string[] = [];

  test("tohum: iki şubenin kayıtları var, Tümü'de ikisi de görünür", async () => {
    await signIn(seed.users.admin, ALL_BRANCHES);
    const { loadModel } = await import("../src/server/data/dataset");
    const all = await loadModel();
    assert.ok(tzLeaks(all.ds), "Tümü'de Tuzla'nın işareti görünmeli (tohum yazıldı mı?)");
  });

  describe("1. işaret: yönetici, Marina seçili, varsayılan şube görünümü", () => {
    for (const sc of SCREENS) {
      test(sc.name, sc.leak ? { todo: sc.leak } : {}, async () => {
        await signIn(seed.users.admin, "marina");
        const out = await sc.run();
        const shown = prune(norm(out), sc.shared ?? []);
        results.set(sc.name, norm(out));
        const hit = tzLeaks(shown);
        await signIn(seed.users.admin, ALL_BRANCHES);
        allBefore.set(sc.name, norm(await sc.run().catch((e: Error) => ({ hata: e.message }))));
        assert.equal(hit, null, `Tuzla'nın verisi görünüyor: …${hit}…`);
      });
    }
  });

  describe("3. müdür (Marina'ya kilitli), firma tercihi yazılı olsa da", () => {
    for (const sc of SCREENS.filter((x) => !/^(Bağlantı|Asistan|Sabah|Muhasebeci|Dışa)/.test(x.name))) {
      test(sc.name, sc.leak ? { todo: sc.leak } : {}, async () => {
        await signIn(seed.users.marinaManager, "tuzla", FIRMA);
        const out = prune(norm(await sc.run().catch((e: Error) => ({ hata: e.message }))), sc.shared ?? []);
        const hit = tzLeaks(out);
        assert.equal(hit, null, `Tuzla'nın verisi görünüyor: …${hit}…`);
      });
    }
  });

  test("yeni ürünün aynı ad + boy denetimi bütün şubelere bakar, öbür şubenin önereni adsız (Ürünler, Site menüsü)", async () => {
    await signIn(seed.users.admin, "marina");
    const { pendingNewProposalRows } = await import("../src/server/data/recipe-requests");
    const { pendingProposalIssue } = await import("../src/lib/recipe-change");
    const rows = await pendingNewProposalRows(db, await sel(), "adsiz");
    const issue = pendingProposalIssue("TZMARK Can Latte", ["M"], rows, "önce karar verin");
    assert.ok(issue?.includes("öbür şubede bekleyen"), `öbür şubenin önerisi de engeller: ${issue}`);
    assert.equal(issue?.includes("Can'ın"), false, "önerenin adı yok");
    assert.ok(pendingProposalIssue("Ayşe Marina Latte", ["M"], rows, "x")?.includes("Ayşe Marina'nın"), "şubenin önerisi önereniyle");
    await signIn(seed.users.admin, ALL_BRANCHES);
    const all = await pendingNewProposalRows(db, await sel(), "adsiz");
    assert.ok(pendingProposalIssue("TZMARK Can Latte", ["M"], all, "x")?.includes("TZMARK Can'ın"), "Tümü'de önereniyle");
  });

  describe("2. firma kipi: alanların ekranı Tümü'nün toplamını gösterir", () => {
    const same = async (label: string, read: () => Promise<unknown>, pick: (v: never) => unknown, expectTuzla = true) => {
      await signIn(seed.users.admin, ALL_BRANCHES);
      const all = norm(pick((await read()) as never));
      await signIn(seed.users.admin, "marina", FIRMA);
      const firm = norm(pick((await read()) as never));
      assert.deepEqual(firm, all, `${label}: firma kipi Tümü'yle aynı değil`);
      if (expectTuzla) assert.ok(tzLeaks(firm) || JSON.stringify(firm).includes("tuzla"), `${label}: firma kipinde Tuzla da görünmeli`);
    };
    test("Ödemeler (loadUpcoming)", () =>
      same(
        "odemeler",
        async () => (await import("../src/server/notify/digest")).loadUpcoming(today, { branch: await area("odemeler") }),
        (u: { items: { title: string; amount: number | null }[] }) => u.items.map((i) => [i.title, i.amount]).sort(),
      ));
    test("Nakit planı (loadAreaCashPlan)", () =>
      same(
        "nakit",
        async () => (await import("../src/server/data/cash-plan")).loadAreaCashPlan(await area("nakit")),
        (p: unknown) => p,
      ));
    test("Tedarikçi bakiyeleri (loadSupplierLedger)", () =>
      same(
        "tedarikciler",
        async () => (await import("../src/server/data/suppliers")).loadSupplierLedger(await area("tedarikciler")),
        (l: unknown) => l,
      ));
    test("Tutarlılık (veri kümesi)", () =>
      same(
        "tutarlilik",
        async () => {
          const { loadModel } = await import("../src/server/data/dataset");
          return scope.withBranchScope(await area("tutarlilik"), async () => (await loadModel()).pnlMonth(month()));
        },
        (p: { revenue?: unknown; cogs?: unknown }) => p,
      ));
    test("Komisyon (loadCommissionReports)", () =>
      same(
        "komisyon",
        async () => (await import("../src/server/data/commission")).loadCommissionReports(),
        (r: { branch: unknown; all: unknown; mode: string }) => (r.mode === "firma" ? r.all : r.branch),
        // Kanal kanal toplam: şube adı ya da işareti taşımaz (Tümü'yle eşitlik yeter)
        false,
      ));
    test("Şubeleri yan yana (loadLaborReport)", () =>
      same(
        "karsilastirma",
        async () => (await import("../src/server/data/iscilik")).loadLaborReport(month()),
        (r: { branches: unknown }) => r?.branches,
      ));
    test("İşletme geneli giderler (Gelir-gider ayı)", async () => {
      const { loadModel } = await import("../src/server/data/dataset");
      await signIn(seed.users.admin, "marina", FIRMA);
      const shown = (await loadModel()).pnlMonth(month());
      assert.ok(shown.shared.total > 0, "Tutarla göster: işletme geneli payı");
    });
    test("Stok değeri (FIFO havuzu, alan.stok_degeri)", () =>
      same(
        "stok_degeri",
        async () => (await import("../src/server/data/purchase-lots-query")).queryPurchaseLots(db, await area("stok_degeri")),
        (l: unknown) => l,
      ));
    test("Ödemeler › Son ödenenler (loadRecentPaid)", () =>
      same(
        "odemeler",
        async () => (await import("../src/server/data/recent-paid")).loadRecentPaid(await area("odemeler")),
        (l: unknown) => l,
      ));
    test("Dışa aktarım › Cari hareketleri (Marina dosyası firma kipinde = Tümü dosyası)", async () => {
      await signIn(seed.users.admin, ALL_BRANCHES);
      const all = (await exportBook(""))["Cari hareketleri"];
      await signIn(seed.users.admin, "marina", FIRMA);
      const firm = (await exportBook("&sube=marina"))["Cari hareketleri"];
      // Şube dosyasının firma kipinde başta tek açıklama satırı var ("Firma geneli: …"); hareketler aynı
      assert.equal(firm.replace(/^Firma geneli:[^\n]*\n/m, ""), all);
      assert.ok(tzLeaks(firm), "firma kipinde Tuzla'nın ödemesi de");
    });
  });

  describe("5. vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026)", () => {
    test("Vergi alanı yok: eski sürümün yazdığı tercih okunmaz", async () => {
      assert.equal((VIEW_AREA_KEYS as readonly string[]).includes("vergi"), false);
      await signIn(seed.users.admin, "marina", { vergi: "sube", nakit: "firma" } as unknown as BranchViewPrefs);
      assert.deepEqual(await scope.userBranchView(), { nakit: "firma" });
    });

    test("Vergi bölümü kaldırıldı (27 Kasım 2026): dışa aktarımın Vergi sekmesi Tümü ve Marina dosyasında yok", async () => {
      await signIn(seed.users.admin, ALL_BRANCHES);
      assert.equal((await exportBook(""))["Vergi"], undefined);
      await signIn(seed.users.admin, "marina");
      assert.equal((await exportBook("&sube=marina"))["Vergi"], undefined);
    });

    test("nakit planı şube kipinde: vergi ve SGK hatırlatıcıları ve SGK tahmini yok, tek not; Tümü'de hepsi", async () => {
      const { loadAreaCashPlan } = await import("../src/server/data/cash-plan");
      const { planNotes, FIRM_TAX_NOTE } = await import("../src/lib/cash-plan");
      const soon = addDays(today, 3);
      // Şubesiz KDV ve Marina'nın SGK hatırlatıcısı (tutarlı): ikisi de şubenin akışına ve İşletme geneli satırına girmez
      const rems = await db
        .insert(s.reminders)
        .values([
          { title: "KDV beyannamesi ve ödemesi", amount: 91_931.31, dueDate: soon, anchorDate: soon, branchId: null, kind: "vergi" },
          { title: "SGK prim ödemesi", amount: 91_932.32, dueDate: soon, anchorDate: soon, branchId: "marina", kind: "vergi" },
        ])
        .returning({ id: s.reminders.id });
      try {
        await signIn(seed.users.admin, "marina");
        const branch = await loadAreaCashPlan(await area("nakit"));
        assert.ok(branch.flow, "şube kipi");
        const lines = branch.view.plan.weeks.flatMap((w) => w.lines);
        assert.deepEqual(lines.filter((l) => l.kind === "sgk" || /^(kdv|vergi|damga)/.test(l.key) || rems.some((r) => l.key.startsWith(`reminder:${r.id}@`))), []);
        assert.equal(tzLeaks(branch.flow), null, "İşletme geneli satırında KDV ve SGK hatırlatıcısı yok (tutarları 919xx)");
        assert.deepEqual(branch.view.plan.estimates.filter((e) => ["kdv", "vergi", "sgk"].includes(e.key)), []);
        const notes = planNotes(branch.view.plan, { komisyon: 0.02, acikGun: 30, invoiceTermDays: 30 });
        assert.ok(notes.some((n) => n.text === `${FIRM_TAX_NOTE}.`));
        assert.equal(notes.some((n) => n.key === "sgk" || n.key === "kdv"), false);
        // Bağlantının nakit planı da aynı notu taşır, vergi ve SGK tutarı yok (hatırlatıcılar Ödemeler listesinde kalır:
        // şubenin ve işletme genelinin hatırlatıcısı, tutarı bölünmeden)
        const answer = (await mcp("odemeler", { sube: "marina", nakitPlani: true })) as { nakitPlani?: unknown; isletmeGeneli?: unknown };
        const plan = JSON.stringify(answer.nakitPlani);
        assert.ok(plan.includes(FIRM_TAX_NOTE), "bağlantı: vergi ve SGK firma geneli");
        assert.equal(/9193[12]|91\.93[12]/.test(plan + JSON.stringify(answer.isletmeGeneli)), false, "nakit planında ve İşletme geneli toplamında vergi ve SGK yok");
        // Tümü: firmanın planında vergi ve SGK hatırlatıcıları
        await signIn(seed.users.admin, ALL_BRANCHES);
        const firm = await loadAreaCashPlan(await area("nakit"));
        const firmLines = firm.view.plan.weeks.flatMap((w) => w.lines);
        assert.ok(rems.every((r) => firmLines.some((l) => l.key.startsWith(`reminder:${r.id}@`))), "Tümü'de KDV ve SGK");
        assert.equal(firm.view.plan.taxFirmWide, undefined);
      } finally {
        await db.delete(s.reminders).where(inArray(s.reminders.id, rems.map((r) => r.id)));
      }
    });

    test("nakit planı şube kipinde: bordro saklı bordro ayarıyla (eski Vergi ayarları; hesap dönemi), varsayılanla değil", async () => {
      const { loadAreaCashPlan } = await import("../src/server/data/cash-plan");
      const { PAYROLL_SETTINGS_KEY: TAX_SETTINGS_KEY } = await import("../src/lib/bordro/settings");
      const salary = async () => (await loadAreaCashPlan(await area("nakit"))).view.plan.estimates.find((e) => e.key === "salary")?.monthly ?? null;
      await signIn(seed.users.admin, "marina");
      const before = await salary();
      assert.ok(before !== null && before > 0, `Marina'nın personeli varsayılan hesap döneminde maaş tahmini taşır (${before})`);
      const [old] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY));
      const value = { periodStart: "2099-01-01" };
      await db.insert(s.integrationState).values({ key: TAX_SETTINGS_KEY, value }).onConflictDoUpdate({ target: s.integrationState.key, set: { value } });
      try {
        assert.equal(await salary(), null, "hesap dönemi başlamadan bordro yok: şubenin akışı saklı bordro ayarını okur");
      } finally {
        if (old) await db.update(s.integrationState).set({ value: old.value }).where(eq(s.integrationState.key, TAX_SETTINGS_KEY));
        else await db.delete(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY));
      }
      assert.equal(await salary(), before);
    });
  });

  describe("6. ürün ve fatura KDV'si şubede doğru (sahibin açıklaması 27 Kasım 2026)", () => {
    // "KDV olayları site genelinde kalsın ama ben sana gelir vergisi matrah vs o kısımdan bahsettim; ürün KDV'si falan
    // hesaplansın, nasıl doğruysa öyle olsun": beyan, matrah ve takvim firma geneli (5. bakış); ürünün ve faturanın KDV'si
    // şubenin kayıtlarının gerçeği, şube seçiliyken Tümü'deki gibi hesaplanır ve dosyalarda durur.
    const book = async (q: string) => {
      const { GET } = await import("../src/app/api/export/route");
      const res = await GET({ nextUrl: new URL(`http://panel.test/api/export?ay=${month()}${q}`) } as never);
      assert.equal(res.status, 200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      return wb;
    };
    const valueOf = (c: ExcelJS.Cell) => {
      const v = c.value;
      return typeof v === "number" ? v : v && typeof v === "object" && "result" in v ? Number(v.result ?? 0) : null;
    };

    test("veri kümesi: Marina'nın ve işletme genelinin faturalarının KDV'si, ürünün KDV dahil ve hariç fiyatı Tümü'dekiyle aynı", async () => {
      const { loadModel } = await import("../src/server/data/dataset");
      const { purchaseVat } = await import("../src/lib/kdv");
      const read = async () => {
        const m = await loadModel();
        const inv = new Map(m.ds.invoices.map((i) => [i.id, { amount: i.amount, discount: i.discount, vat: i.vat, payable: i.payable, purchaseVat: purchaseVat(i) }]));
        const products = new Map(m.products.map((p) => [p.product.id, { price: p.price, net: p.net, suggestedPrice: p.suggestedPrice }]));
        return { inv, products, kdv: m.settings.kdv, kdvHizmet: m.settings.kdvHizmet };
      };
      await signIn(seed.users.admin, ALL_BRANCHES);
      const all = await read();
      await signIn(seed.users.admin, "marina");
      const marina = await read();
      assert.equal(marina.inv.get(seed.invoices.marina)?.vat, 130, "Marina'nın faturasının KDV'si");
      assert.equal(marina.inv.get(seed.invoices.marina)?.purchaseVat, 130);
      for (const id of [seed.invoices.marina, seed.invoices.shared]) assert.deepEqual(marina.inv.get(id), all.inv.get(id), `fatura ${id}`);
      assert.equal(marina.inv.has(seed.invoices.tuzla), false, "Tuzla'nın faturası yok");
      assert.deepEqual([marina.kdv, marina.kdvHizmet], [all.kdv, all.kdvHizmet], "satışın KDV oranları");
      assert.ok(marina.products.size > 0);
      assert.deepEqual(marina.products, all.products, "ürünün KDV dahil fiyatı, net (KDV hariç) fiyatı ve önerilen fiyatı");
    });

    test("kasa raporları ve muhasebeci paketi: Marina'nın Z KDV dökümü ve faturalarının KDV'si kendi kayıtlarından, Tümü'nün aynı satırlarıyla birebir; toplamların altında not", async () => {
      const { cashReportsBetween } = await import("../src/server/data/cash-reports");
      const { loadPackageData } = await import("../src/server/muhasebe/paket");
      const { BRANCH_PACKAGE_VAT_NOTE, buildPackageWorkbook, packageSummary } = await import("../src/lib/muhasebe/paket");
      const now = new Date();
      await signIn(seed.users.admin, ALL_BRANCHES);
      const all = await loadPackageData(month(), now);
      await signIn(seed.users.admin, "marina");
      const till = await scope.currentTillBranch();
      const reports = await scope.withBranchScope(till, () => cashReportsBetween(`${month()}-01`, today, "admin", "admin"));
      assert.deepEqual(
        reports.filter((r) => r.okcVat?.length).map((r) => ({ branch: r.branchId, vat: r.okcVat })),
        [{ branch: "marina", vat: [{ rate: 10, total: 2_100, vat: 190.91 }] }],
        "kasa raporlarında yalnız Marina'nın Z KDV dökümü",
      );
      const marina = await loadPackageData(month(), now, "marina");
      assert.equal(marina.branchFile, true);
      assert.deepEqual(marina.vat, all.vat.filter((v) => v.branch === "Marina"), "Z KDV dökümü Tümü'nün Marina satırlarıyla aynı");
      assert.deepEqual(marina.vat.map((v) => [v.rate, v.total, v.vat]), [[10, 2_100, 190.91]]);
      const own = marina.invoices.find((i) => i.supplier === "Marina Süt AŞ");
      assert.ok(own, "Marina'nın faturası pakette");
      assert.equal(own.vat, all.invoices.find((i) => i.supplier === "Marina Süt AŞ")?.vat);
      assert.equal(own.vat, 130);
      const sum = packageSummary(marina);
      assert.ok(Math.abs(sum.invoiceVat - marina.invoices.filter((i) => !i.held && i.accountDate.slice(0, 7) === month()).reduce((t, i) => t + i.vat, 0)) < 0.01, "Özet'in KDV'si paketin faturalarından");
      assert.deepEqual(sum.vatByRate, [{ rate: 10, total: 2_100, vat: 190.91 }]);
      const wb = buildPackageWorkbook(marina);
      assert.ok(wb.getWorksheet("Z KDV dökümü"), "Z KDV dökümü sekmesi");
      const text = (name: string) => {
        const out: string[] = [];
        wb.getWorksheet(name)!.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ""))));
        return out;
      };
      assert.ok(text("Faturalar").includes("KDV") && text("Faturalar").includes(BRANCH_PACKAGE_VAT_NOTE));
      assert.ok(text("Z KDV dökümü").includes(BRANCH_PACKAGE_VAT_NOTE));
      assert.ok(text("Özet").includes("Faturaların KDV'si") && text("Özet").includes("Yazarkasa KDV %10"));
      assert.equal(tzLeaks(marina), null);
    });

    test("dışa aktarım: Marina dosyasının Faturalar'ında satır satır KDV Tümü dosyasıyla aynı, TOPLAM KDV'yi taşır, altında not", async () => {
      const { BRANCH_INVOICE_VAT_NOTE } = await import("../src/app/api/export/workbook");
      const rows = (wb: ExcelJS.Workbook) => {
        const ws = wb.getWorksheet("Faturalar")!;
        const col = (h: string) => {
          let n = 0;
          ws.getRow(1).eachCell((c, i) => (c.value === h ? (n = i) : null));
          assert.ok(n, `sütun: ${h}`);
          return n;
        };
        const [sup, vat, pay] = [col("Tedarikçi"), col("KDV"), col("Ödenecek (KDV dahil)")];
        const out = new Map<string, number | null>();
        let total: ExcelJS.Row | null = null;
        ws.eachRow((r, i) => {
          if (i === 1) return;
          if (r.getCell(1).value === "TOPLAM") total = r;
          else if (!total && r.getCell(sup).value) out.set(`${r.getCell(sup).value}|${valueOf(r.getCell(pay))}`, valueOf(r.getCell(vat)));
        });
        assert.ok(total, "TOPLAM satırı");
        const t = total as ExcelJS.Row;
        return { ws, out, total: valueOf(t.getCell(vat)), totalRow: t.number };
      };
      await signIn(seed.users.admin, ALL_BRANCHES);
      const all = rows(await book(""));
      await signIn(seed.users.admin, "marina");
      const marina = rows(await book("&sube=marina"));
      assert.equal(marina.out.get("Marina Süt AŞ|1430"), 130, "Marina'nın faturasının KDV'si");
      for (const [k, v] of marina.out) assert.equal(v, all.out.get(k), `satır: ${k}`);
      const sum = [...marina.out.values()].reduce<number>((t, v) => t + (v ?? 0), 0);
      assert.ok(marina.total !== null && Math.abs(marina.total - sum) < 0.01, `TOPLAM KDV satırların toplamı (${marina.total} / ${sum})`);
      assert.equal(marina.ws.getRow(marina.totalRow + 1).getCell(1).value, BRANCH_INVOICE_VAT_NOTE);
      assert.notEqual(all.ws.getRow(all.totalRow + 1).getCell(1).value, BRANCH_INVOICE_VAT_NOTE, "Tümü dosyasında not yok");
    });
  });

  describe("4. fark: Tuzla'nın satırları silinince Marina'nın görünümü değişmez", () => {
    test("Tuzla'nın satırları silinir", async () => {
      await deleteBranchRows(db, "tuzla");
      await signIn(seed.users.admin, ALL_BRANCHES);
      const { loadModel } = await import("../src/server/data/dataset");
      assert.equal(tzLeaks((await loadModel()).ds), null, "Tuzla'nın satırı kalmamalı");
    });
    for (const sc of SCREENS) {
      test(sc.name, sc.leak || sc.diffLeak ? { todo: sc.diffLeak ?? sc.leak } : {}, async () => {
        const before = results.get(sc.name);
        if (before === undefined) return; // ilk bakışta okunamadı (hatası orada)
        await signIn(seed.users.admin, "marina");
        const out = norm(await sc.run());
        const diffs = diffPaths(before, out, sc.shared ?? []);
        // Tümü silmeden sonra: değişmiyorsa ekran Tuzla'nın verisini hiç okumuyor (bakış boş; tohumu genişletmek gerekir)
        await signIn(seed.users.admin, ALL_BRANCHES);
        const all = norm(await sc.run().catch((e: Error) => ({ hata: e.message })));
        if (!diffPaths(allBefore.get(sc.name), all, []).length) insensitive.push(sc.name);
        assert.deepEqual(diffs, [], `Marina'nın görünümü Tuzla'nın verisine göre değişiyor:\n  ${diffs.join("\n  ")}`);
      });
    }
    test("bakışın kapsamı: Tümü'de Tuzla'nın verisinden etkilenmeyen ekranlar (bilgi)", (t) => {
      t.diagnostic(`Tümü'de de Tuzla'dan bağımsız (${insensitive.length}): ${insensitive.join(" | ")}`);
    });
  });
});
