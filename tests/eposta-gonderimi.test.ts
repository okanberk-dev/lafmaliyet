// E-posta gönderimi (src/server/notify/resend-http.ts, resend.ts): seçeneksiz çağrı bugünkü gibi (3 deneme, 15 sn,
// 2 ve 4 sn ara), deneme sayısı, deneme süresi, işin son anı (sabah işi: jobStart + 48 sn) ve "belirsiz" sonuç
// (ileti gitmiş olabilir). Ağ ve saat sahte: anahtar gerekmez, bekleme yok.
// Çalıştırma: npx tsx --test tests/eposta-gonderimi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MIN_ATTEMPT_MS, postEmail, SEND_DEFAULTS, type EmailMessage, type SendIo, type SendOptions } from "../src/server/notify/resend-http";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const MSG: EmailMessage = { from: "L'Affogato Panel <bildirim@laffogato.net>", to: ["okan@ornek.com", "kasa@ornek.com"], subject: "Sabah özeti: 2 yeni fatura", html: "<p>x</p>", text: "x", idempotencyKey: "digest-2026-10-23-abc" };

/** Sahte yanıt: HTTP durumu (gövdesiyle), ağ hatası ya da süresi dolana kadar asılı kalan istek */
type Answer = number | { status: number; body: string } | Error | "hang";

const START = 1_000_000;

function fakeIo(answers: Answer[]) {
  let t = START;
  let nextTimeout = -1;
  const calls: { url: string; init: RequestInit; timeoutMs: number; at: number }[] = [];
  const sleeps: number[] = [];
  const io: SendIo = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    timeout: (ms) => {
      nextTimeout = ms;
      return new AbortController().signal;
    },
    fetch: async (url, init) => {
      calls.push({ url, init, timeoutMs: nextTimeout, at: t - START });
      const a = answers.shift();
      if (a === undefined) throw new Error("beklenmeyen istek");
      if (a === "hang") {
        t += nextTimeout;
        throw new Error("The operation was aborted due to timeout");
      }
      if (a instanceof Error) throw a;
      const { status, body } = typeof a === "number" ? { status: a, body: bodyFor(a) } : a;
      return new Response(body, { status });
    },
  };
  return { io, calls, sleeps, elapsed: () => t - START };
}
const bodyFor = (s: number) => (s === 200 ? '{"id":"em_123"}' : `{"message":"durum ${s}"}`);

const send = (answers: Answer[], opts?: SendOptions, msg: EmailMessage = MSG) => {
  const f = fakeIo(answers);
  return postEmail("re_anahtar", msg, opts, f.io).then((r) => ({ r, ...f }));
};

test("seçeneksiz gönderim bugünkü gibi: tek istek, aynı başlıklar ve gövde, 15 sn süre", async () => {
  assert.deepEqual(SEND_DEFAULTS, { timeoutMs: 15_000, attempts: 3 });
  const { r, calls, sleeps } = await send([200]);
  assert.deepEqual(r, { ok: true, id: "em_123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer re_anahtar", "Content-Type": "application/json", "Idempotency-Key": "digest-2026-10-23-abc" });
  assert.equal(calls[0].init.body, JSON.stringify({ from: MSG.from, to: MSG.to, subject: MSG.subject, html: MSG.html, text: MSG.text }));
  assert.equal(calls[0].timeoutMs, 15_000);
  assert.deepEqual(sleeps, []);
  // Tekil anahtarsız ileti başlıksız gider; kimliksiz başarılı yanıt da başarı
  const bare = await send([{ status: 200, body: "tamam" }], undefined, { ...MSG, idempotencyKey: undefined });
  assert.deepEqual(bare.r, { ok: true, id: null });
  assert.deepEqual(bare.calls[0].init.headers, { Authorization: "Bearer re_anahtar", "Content-Type": "application/json" });
});

test("seçeneksiz gönderim bugünkü gibi: 429, 409 ve 5xx üç kez denenir (2 ve 4 sn arayla); öteki hata hemen döner", async () => {
  const down = await send([500, 502, 503]);
  assert.deepEqual(down.r, { ok: false, error: "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin." });
  assert.equal(down.calls.length, 3);
  assert.deepEqual(down.sleeps, [2000, 4000]);
  assert.deepEqual(down.calls.map((c) => c.timeoutMs), [15_000, 15_000, 15_000]);
  // Yeniden denemeler aynı istek (aynı Idempotency-Key)
  assert.deepEqual(down.calls[2].init, down.calls[0].init);

  const later = await send([429, 409, 200]);
  assert.deepEqual(later.r, { ok: true, id: "em_123" });
  assert.equal(later.calls.length, 3);

  const busy = await send([429, 429, 429]);
  assert.deepEqual(busy.r, { ok: false, error: "Resend şu an çok fazla istek alıyor; biraz sonra yeniden deneyin." });

  const domain = await send([{ status: 403, body: '{"message":"The laffogato.com domain is not verified. Please, add and verify your domain."}' }]);
  assert.deepEqual(domain.r, { ok: false, error: "laffogato.com alan adı Resend'de doğrulanmamış; bu adresten e-posta çıkmaz. Doğrulanmış bir gönderen adresi yazın." });
  assert.equal(domain.calls.length, 1);
  assert.deepEqual(domain.sleeps, []);

  const noTo = await send([], undefined, { ...MSG, to: [] });
  assert.deepEqual(noTo.r, { ok: false, error: "Bildirim adresi yok." });
  assert.equal(noTo.calls.length, 0);
});

test("belirsiz: son deneme zaman aşımı, ağ hatası ya da 409 ise ileti gitmiş olabilir", async () => {
  const net = await send([new Error("fetch failed"), new Error("fetch failed"), new Error("getaddrinfo ENOTFOUND api.resend.com")]);
  assert.deepEqual(net.r, { ok: false, error: "Resend'e ulaşılamadı: getaddrinfo ENOTFOUND api.resend.com", uncertain: true });
  assert.deepEqual(net.sleeps, [2000, 4000]);

  const hang = await send(["hang", "hang", "hang"]);
  assert.deepEqual(hang.r, { ok: false, error: "Resend'e ulaşılamadı: The operation was aborted due to timeout", uncertain: true });
  // Seçeneksiz: üç kez 15 sn + 2 + 4 sn = 51 sn (sabah işi bu yüzden son an verir)
  assert.equal(hang.elapsed(), 51_000);

  const conflict = await send([409, 409, 409]);
  assert.deepEqual(conflict.r, { ok: false, error: "Resend iletiyi kabul etmedi (HTTP 409): durum 409", uncertain: true });

  // Önceki deneme belirsizse sonraki 429 / 5xx bunu çürütmez; öteki 4xx çürütür (ileti ilk seferde de reddedilirdi)
  const stillUnsure = (await send(["hang", 500, 503])).r;
  assert.deepEqual(stillUnsure, { ok: false, error: "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin.", uncertain: true });
  const settled = (await send([new Error("fetch failed"), { status: 422, body: '{"message":"Invalid `to` field."}' }])).r;
  assert.deepEqual(settled, { ok: false, error: "Alıcı adresi geçerli biçimde değil." });
  // Kesin hatalar belirsiz değil
  assert.equal("uncertain" in (await send([500, 500, 500])).r, false);
});

test("seçenekler: deneme sayısı ve deneme başına süre", async () => {
  const once = await send([500], { attempts: 1 });
  assert.deepEqual(once.r, { ok: false, error: "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin." });
  assert.equal(once.calls.length, 1);
  assert.deepEqual(once.sleeps, []);
  assert.deepEqual((await send([new Error("fetch failed")], { attempts: 1 })).r, { ok: false, error: "Resend'e ulaşılamadı: fetch failed", uncertain: true });
  assert.deepEqual((await send([409], { attempts: 1 })).r, { ok: false, error: "Resend iletiyi kabul etmedi (HTTP 409): durum 409", uncertain: true });

  const two = await send([500, 500], { attempts: 2, timeoutMs: 4_000 });
  assert.equal(two.calls.length, 2);
  assert.deepEqual(two.sleeps, [2000]);
  assert.deepEqual(two.calls.map((c) => c.timeoutMs), [4_000, 4_000]);
  // Geçersiz deneme sayısı varsayılana, 0 bire döner; geçersiz süre ve son an verilmemiş sayılır
  assert.equal((await send([500, 500, 500], { attempts: Number.NaN })).calls.length, 3);
  assert.equal((await send([500], { attempts: 0 })).calls.length, 1);
  const odd = await send([200], { timeoutMs: Number.NaN, deadlineAt: Number.NaN });
  assert.deepEqual(odd.r, { ok: true, id: "em_123" });
  assert.equal(odd.calls[0].timeoutMs, 15_000);
  // Süresi sıfır ya da eksi deneme hiç başlamaz: gitmediği kesin
  const zero = await send([200], { timeoutMs: 0 });
  assert.equal(zero.calls.length, 0);
  assert.deepEqual(zero.r, { ok: false, error: "Süre yetmedi; e-posta gönderilmedi." });
});

test("son an: hiçbir deneme sınırı aşmaz; kalan süre 1 sn'den azsa yeni deneme başlamaz", async () => {
  assert.equal(MIN_ATTEMPT_MS, 1_000);
  // Sabah işi tipik: gönderim 5. saniyede başlar, sınır 48. saniye → 15 + 2 + 15 + 4 + 7 sn, toplam 43 sn
  const morning = await send(["hang", "hang", "hang"], { deadlineAt: START + 43_000 });
  assert.deepEqual(morning.calls.map((c) => c.timeoutMs), [15_000, 15_000, 7_000]);
  assert.deepEqual(morning.sleeps, [2000, 4000]);
  assert.equal(morning.elapsed(), 43_000);
  assert.equal(morning.r.ok === false && morning.r.uncertain, true);

  // 35 sn'lik Paraşüt denemesinden sonra: 7 sn kalmış → tek deneme, ara verip yeniden denemeye süre yok
  const late = await send(["hang", 200], { deadlineAt: START + 7_000 });
  assert.equal(late.calls.length, 1);
  assert.equal(late.calls[0].timeoutMs, 7_000);
  assert.deepEqual(late.sleeps, []);
  assert.deepEqual(late.r, { ok: false, error: "Resend'e ulaşılamadı: The operation was aborted due to timeout", uncertain: true });

  // Kesin hata sonrası süre yetmezse son hata döner, belirsiz değil
  const down = await send([500, 500], { deadlineAt: START + 2_500 });
  assert.equal(down.calls.length, 1);
  assert.deepEqual(down.r, { ok: false, error: "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin." });

  // Süre baştan yoksa hiç denenmez: gitmediği kesin
  const none = await send([200], { deadlineAt: START + 999 });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(none.r, { ok: false, error: "Süre yetmedi; e-posta gönderilmedi." });

  // Başarılı gönderim sınırdan önce biter
  const ok = await send([500, 200], { deadlineAt: START + 48_000 });
  assert.deepEqual(ok.r, { ok: true, id: "em_123" });
  assert.deepEqual(ok.sleeps, [2000]);
});

test("gerçek ağla (varsayılan): fetch'e AbortSignal verilir; sendEmail anahtarı resend.ts'ten okur, seçenekleri olduğu gibi geçirir", async () => {
  const real = globalThis.fetch;
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push(init ?? {});
    return new Response('{"id":"em_9"}', { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await postEmail("re_anahtar", MSG), { ok: true, id: "em_9" });
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(seen[0].signal instanceof AbortSignal);
  assert.equal(seen[0].signal.aborted, false);

  const http = read("src/server/notify/resend-http.ts");
  assert.doesNotMatch(http, /^import "server-only"|process\.env/m);
  const resend = read("src/server/notify/resend.ts");
  assert.ok(resend.startsWith('import "server-only";'));
  assert.match(resend, /export async function sendEmail\(msg: EmailMessage, opts\?: SendOptions\): Promise<SendResult> \{\s*const key = resendApiKey\(\);\s*if \(!key\) return \{ ok: false, error: "RESEND_API_KEY tanımlı değil; e-posta gönderilemiyor\." \};\s*return postEmail\(key, msg, opts\);/);
});
