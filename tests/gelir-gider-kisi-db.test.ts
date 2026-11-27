// Gelir-gider'in personel hücreleri muhasebeciye kişi kişi ücret vermez (docs/ROLLER.md › Muhasebeci: "kişi başı maaş yok;
// gelir-gider ve vergide personel giderleri toplam olarak durur"), gerçek Postgres'te ve gerçek sayfayla. Sayfa
// (src/app/panel/gelir-gider/page.tsx) oturumla çağrılır; döndürdüğü ağacın bütün prop'ları istemciye giden veridir (PnlGrid
// ve ay görünümü "use client": hücrelerin ipucu `info` ve uyarısı `warn` RSC yüküne yazılır). Part-time'ın Vardiya'ya bağlı
// satırı "<ad>: <gün> gün × <günlük ücret> + ek <ek ödeme>" ipucunu, bağlantısız kişinin adı uyarıyı taşırdı. Yöneticide
// aynı hücreler kişi kişi (kanal gerçek); muhasebecide tutarlar aynı, metin kişi sayısıyla (src/lib/calc/engine.ts ›
// ModelOptions.personal, `can(rol, "maas")`).
//
// GELIR_GIDER_KISI_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: GELIR_GIDER_KISI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/gelir-gider-kisi-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { ReactElement } from "react";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { currentMonthTR, daysInMonth, shiftMonth } from "../src/lib/calc/engine";
import { nameRef } from "../src/lib/vardiya";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.GELIR_GIDER_KISI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_gelir_gider_kisi_${process.pid}`;
const SECRET = "gelir-gider-kisi-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
/** Geçen ay (biten ay: Vardiya'nın bütün günleri sayılır) ve tablonun yılı */
const MONTH = shiftMonth(currentMonthTR(), -1);
const YEAR = MONTH.slice(0, 4);
/** Part-time kişiler: Vardiya'ya adıyla bağlı Defne (7 gün), bağlantısız Bora. Ücretler başka hiçbir tutara benzemesin */
const DEFNE = { name: "Defne Yıldırım", dailyWage: 1_737, extras: 2_113, days: 7 };
const BORA = { name: "Bora Kaya", dailyWage: 1_919 };

/** Tarayıcının çerez kutusu: dal.ts cookies() ile bunu okur ve yazar */
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

/** Ağaçtaki bütün metin ve sayılar (istemciye giden prop'lar; React'in iç alanları `_…` ve fonksiyonlar hariç) */
function payload(node: unknown, out: { strings: string[]; numbers: number[] } = { strings: [], numbers: [] }, seen = new WeakSet<object>()) {
  if (typeof node === "string") out.strings.push(node.replace(/\u00a0/g, " "));
  else if (typeof node === "number") out.numbers.push(node);
  else if (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    if (node instanceof Map || node instanceof Set) for (const v of node instanceof Map ? [...node.entries()] : [...node]) payload(v, out, seen);
    else for (const [k, v] of Object.entries(node)) if (!k.startsWith("_") && k !== "$$typeof" && k !== "type") payload(v, out, seen);
  }
  return out;
}

/** Ağaçta `sections` prop'u olan öğe (PnlGrid) */
function findGrid(node: unknown, seen = new WeakSet<object>()): { sections: { rows: { def: { key: string }; cells: { value: number | null; info?: string; warn?: string }[] }[] }[] } | null {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && Array.isArray(props.sections)) return props as never;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("_")) continue;
    const hit = findGrid(v, seen);
    if (hit) return hit;
  }
  return null;
}

describe("Gelir-gider: muhasebeciye personel hücreleri kişisiz", { skip: !SERVER_URL && "GELIR_GIDER_KISI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let Page: typeof import("../src/app/panel/gelir-gider/page").default;
  let jar = new Jar();
  const ids = { ali: 0, zeynep: 0 };

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
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
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
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ name: "Ali", email: "ali@ornek.com", passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    const [z] = await db.insert(s.users).values({ name: "Zeynep", email: "zeynep@ornek.com", passwordHash: "x", role: "accountant" }).returning({ id: s.users.id });
    Object.assign(ids, { ali: a.id, zeynep: z.id });

    // Geçen ay: açık gün ve ciro (ay tabloda etkin), Defne Tuzla'da 7 gün çalıştı (yemek kartı da işaretli), Bora'nın
    // Vardiya bağlantısı yok. İkisi de yalnız o ay (bu ayda tek kişinin ek ödemesi satırın toplamı olurdu: toplam görünür)
    await db.insert(s.months).values({ month: MONTH, branchId: "tuzla", openDays: daysInMonth(MONTH), posRevenue: 400_000 });
    await db.insert(s.staff).values([
      { name: DEFNE.name, kind: "part_time", dailyWage: DEFNE.dailyWage, extras: DEFNE.extras, mealCard: true, personRef: nameRef(DEFNE.name), branchId: "tuzla", startMonth: MONTH, endMonth: MONTH },
      { name: BORA.name, kind: "part_time", dailyWage: BORA.dailyWage, branchId: "tuzla", startMonth: MONTH, endMonth: MONTH },
    ]);
    await db.insert(s.shifts).values(
      Array.from({ length: DEFNE.days }, (_, i) => ({
        branchId: "tuzla",
        date: `${MONTH}-${String(i * 3 + 1).padStart(2, "0")}`,
        personRef: nameRef(DEFNE.name),
        personName: DEFNE.name,
        kind: "work" as const,
        startMin: 540,
        endMin: 1_020,
      })),
    );

    dal = await import("../src/server/auth/dal");
    Page = (await import("../src/app/panel/gelir-gider/page")).default;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Bu tarayıcıda (yeni çerez kutusu) oturum */
  const signIn = async (k: keyof typeof ids) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids[k]));
    await dal.startSession(u);
  };

  /** Sayfanın içeriği: <Suspense> içindeki sunucu bileşeni oturumla çağrılır, döndürdüğü ağaç (istemciye giden prop'lar) */
  const render = async (): Promise<unknown> => {
    const outer = Page({ searchParams: Promise.resolve({ yil: YEAR }) } as never) as ReactElement<{ children: ReactElement }>;
    const inner = outer.props.children;
    return await (inner.type as (p: unknown) => Promise<unknown>)(inner.props);
  };

  const personnelCells = (tree: unknown) => {
    const grid = findGrid(tree);
    assert.ok(grid, "PnlGrid ağaçta");
    const rows = grid.sections.flatMap((x) => x.rows).filter((r) => r.def.key.startsWith("personnel:"));
    return new Map(rows.map((r) => [r.def.key, r.cells]));
  };
  const monthIdx = Number(MONTH.slice(5, 7)) - 1;

  test("yönetici: part-time hücresinin ipucu kişi kişi, uyarısı bağlantısız kişinin adıyla (kanal gerçek)", async () => {
    await signIn("ali");
    const tree = await render();
    const text = payload(tree).strings.join("\n");
    assert.match(text, /Defne Yıldırım: 7 gün × 1\.737 ₺ \+ ek 2\.113 ₺/);
    assert.match(text, /Bora Kaya: Vardiya kişisi bağlı değil/);
    const cells = personnelCells(tree);
    assert.equal(cells.get("personnel:parttime")?.[monthIdx].value, DEFNE.dailyWage * DEFNE.days + DEFNE.extras);
  });

  test("muhasebeci: sayfanın hiçbir prop'unda kişinin adı, günlük ücreti ve eki yok; tutarlar yöneticininkiyle aynı", async () => {
    await signIn("ali");
    const adminCells = personnelCells(await render());
    await signIn("zeynep");
    const me = await dal.getCurrentUser();
    assert.equal(me?.role, "accountant");
    const tree = await render();
    const { strings, numbers } = payload(tree);
    const text = strings.join("\n");
    for (const name of ["Defne", "Yıldırım", "Bora", "Kaya"]) assert.ok(!text.includes(name), `${name} sayfada`);
    for (const v of ["1.737", "2.113", "1.919", "7 gün ×"]) assert.ok(!text.includes(v), `${v} sayfada`);
    for (const v of [DEFNE.dailyWage, DEFNE.extras, BORA.dailyWage]) assert.ok(!numbers.includes(v), `${v} sayfada`);
    // Satır ve tutar yerinde (toplam olarak durur), metin kişi sayısıyla
    const cells = personnelCells(tree);
    const part = cells.get("personnel:parttime")?.[monthIdx];
    assert.equal(part?.value, DEFNE.dailyWage * DEFNE.days + DEFNE.extras);
    assert.match(part?.info ?? "", /^1 part-time kişi:/);
    assert.match(part?.warn ?? "", /^1 part-time kişinin Vardiya kişisi bağlı değil/);
    assert.deepEqual(
      [...cells].map(([k, list]) => [k, list.map((c) => c.value)]),
      [...adminCells].map(([k, list]) => [k, list.map((c) => c.value)]),
      "personel satırlarının tutarları aynı",
    );
  });
});
