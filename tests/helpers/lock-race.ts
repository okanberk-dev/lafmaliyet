// Kilit sırası yarışı (onay kuyruğunun veritabanı testleri): personelin isteği açan ya da güncelleyen yolu ve
// yöneticinin kararı aynı anda. İstek açan yol önce konu nesnesini (kasadan çıkan satırı, kasa raporu, günün danışma
// kilidi, zayi kaydı) sonra istek satırını kilitler; karar da aynı sırayla kilitlemeli (src/server/staff-requests/core.ts
// peekForReview). Ters sıra kilitlenmeye (40P01, kullanıcıya "İşlem tamamlanamadı") düşer.
//
// Yarış rastlantıya bırakılmaz: üçüncü bir bağlantı istek satırını kilitler; önce karar başlar ve bir kilitte bekler,
// sonra öteki yol başlar ve bekler; kilit bırakılınca ikisi sırayla ilerler. Eski sırada karar istek satırını önce alır,
// konu nesnesinde öteki yolu bekler, öteki yol istek satırında kararı bekler: Postgres her seferinde birini 40P01 ile
// düşürür. Yeni sırada karar konu nesnesini önce alır, öteki yol orada bekler, karar bitince ilerler.

import assert from "node:assert/strict";

import postgres from "postgres";

import { UserError } from "../../src/server/user-error";

/** Hata zincirinde (drizzle `cause`'a sarar) Postgres'in SQLSTATE'i */
export function sqlState(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/**
 * `first` (yöneticinin kararı) ve `second` (aynı konuya dokunan öteki yol) istek satırı üçüncü bir bağlantıda kilitliyken
 * sırayla başlatılır; ikisi de beklemeye girince kilit bırakılır. Sonuçlar Promise.allSettled'ınki gibi döner; kilitlenme
 * (40P01) ya da UserError dışı bir hata testi düşürür. Biri temiz bir UserError alabilir (ör. "İstek siz bakarken değişti").
 */
export async function raceOnRequest(
  url: string,
  requestId: number,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
  o: { timeoutMs?: number } = {},
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  const timeoutMs = o.timeoutMs ?? 10_000;
  const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let holding!: (pid: number) => void;
  const held = new Promise<number>((r) => (holding = r));
  const blocker = sql.begin(async (tx) => {
    const [me] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await tx`select id from staff_requests where id = ${requestId} for update`;
    holding(me.pid);
    await gate;
  });
  /** `blockers` kimliklerinden birini bekleyen, `except` dışındaki ilk bağlantı */
  const waiter = async (blockers: number[], except: number[]): Promise<number> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const rows = await sql<{ pid: number }[]>`
        select pid from pg_stat_activity
        where pg_blocking_pids(pid) && ${blockers}::int[] and not (pid = any(${except.length ? except : [0]}::int[]))
        order by pid limit 1`;
      if (rows[0]) return rows[0].pid;
      if (Date.now() > until) throw new Error(`Yarış kurulamadı: ${blockers.join(", ")} kimliğini bekleyen bağlantı yok`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  let a: Promise<unknown> | null = null;
  let b: Promise<unknown> | null = null;
  try {
    const blockerPid = await held;
    a = first();
    a.catch(() => {});
    const firstPid = await waiter([blockerPid], []);
    b = second();
    b.catch(() => {});
    await waiter([blockerPid, firstPid], [firstPid]);
  } finally {
    release();
    await blocker.catch(() => {});
  }
  const results = (await Promise.allSettled([a!, b!])) as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>];
  await sql.end();
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") continue;
    assert.notEqual(sqlState(r.reason), "40P01", `${i === 0 ? "karar" : "öteki yol"} kilitlenmeye düştü: ${String(r.reason)}`);
    assert.ok(r.reason instanceof UserError, `${i === 0 ? "karar" : "öteki yol"} beklenmeyen hata: ${String(r.reason)}`);
  }
  return results;
}
