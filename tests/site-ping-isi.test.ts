// laffogato.net pinglerinin arka plan işi (src/lib/ping-work.ts): 202'den sonra site pingi yinelemez, iş kaybolmamalı.
// Kayıt yazılamasa da çekilir; çekme hata verir ya da fırlatırsa bir kez daha denenir. Üç ping ucu da bunu kullanır,
// imzayı 202'den önce ortak denetimle sınar.
// Çalıştırma: npx tsx --test tests/site-ping-isi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PING_RETRY_DELAY_MS, runPingWork, type PingPullResult } from "../src/lib/ping-work";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/** Sahte bağımlılıklar: `pulls` sırayla döner (Error fırlatılır), bekleme ve günlük kaydedilir */
function deps(pulls: (PingPullResult | Error)[], opts: { noteFails?: boolean } = {}) {
  const calls = { note: 0, pull: 0, waits: [] as number[], warn: [] as string[], error: [] as string[] };
  return {
    calls,
    d: {
      note: async () => {
        calls.note++;
        if (opts.noteFails) throw Object.assign(new Error("write CONNECTION_CLOSED ep-x-pooler:5432"), { code: "CONNECTION_CLOSED" });
      },
      pull: async () => {
        const r = pulls[calls.pull++];
        if (r instanceof Error) throw r;
        return r;
      },
      wait: async (ms: number) => {
        calls.waits.push(ms);
      },
      log: {
        warn: (...a: unknown[]) => void calls.warn.push(a.join(" ")),
        error: (...a: unknown[]) => void calls.error.push(a.join(" ")),
      },
    },
  };
}

test("kayıt yazılamasa da çekme yapılır (uyuyan bağlantının ilk yazımı pingi kaybettirmez)", async () => {
  const { d, calls } = deps([{ status: "ok" }], { noteFails: true });
  assert.deepEqual(await runPingWork("[karaoke]", d), { status: "ok" });
  assert.equal(calls.note, 1);
  assert.equal(calls.pull, 1);
  assert.equal(calls.waits.length, 0);
  assert.match(calls.warn[0], /\[karaoke\] ping kaydı yazılamadı; çekme yine yapılıyor: write CONNECTION_CLOSED/);
});

test("çekme bir kez fırlatıp sonra başarırsa çekme yapılmış olur (4 sn bekleyip yeniden)", async () => {
  const { d, calls } = deps([new Error("write CONNECTION_CLOSED"), { status: "ok" }]);
  assert.deepEqual(await runPingWork("[siparis]", d), { status: "ok" });
  assert.equal(calls.pull, 2);
  assert.deepEqual(calls.waits, [PING_RETRY_DELAY_MS]);
  assert.equal(PING_RETRY_DELAY_MS, 4000);
  assert.deepEqual([calls.warn, calls.error], [[], []]);
});

test("çekme hata dönerse (site 8 sn'de yanıt vermedi) bir kez daha denenir; ikincisi de olmazsa günlüğe", async () => {
  const ok = deps([{ status: "error", error: "Site 8 saniyede yanıt vermedi" }, { status: "fresh" }]);
  assert.deepEqual(await runPingWork("[menu]", ok.d), { status: "fresh" });
  assert.equal(ok.calls.pull, 2);

  const bad = deps([
    { status: "error", error: "Siteye ulaşılamadı" },
    { status: "error", error: "Siteye ulaşılamadı" },
  ]);
  assert.deepEqual(await runPingWork("[menu]", bad.d), { status: "error", error: "Siteye ulaşılamadı" });
  assert.equal(bad.calls.pull, 2, "en çok iki deneme");
  assert.match(bad.calls.warn[0], /\[menu\] ping çekmesi: Siteye ulaşılamadı/);

  const thrown = deps([new Error("write ETIMEDOUT"), new Error("write ETIMEDOUT")]);
  assert.equal(await runPingWork("[karaoke]", thrown.d), null);
  assert.match(thrown.calls.error[0], /\[karaoke\] ping çekmesi iki kez düştü: write ETIMEDOUT/);
});

test("ilk çekme başarılıysa bekleme ve ikinci deneme yok; 'off' ve 'fresh' hata değildir", async () => {
  for (const status of ["ok", "fresh", "off"]) {
    const { d, calls } = deps([{ status }]);
    assert.deepEqual(await runPingWork("[karaoke]", d), { status });
    assert.equal(calls.pull, 1, status);
    assert.equal(calls.waits.length, 0, status);
  }
});

test("üç ping ucu: önce anahtar, boyut ve imza (ortak denetim), sonra 202; iş yanıttan sonra ortak yardımcıyla", () => {
  for (const [file, check, note, pull] of [
    ["src/app/api/karaoke/ping/route.ts", "checkSitePing(", "notePing", 'syncKaraoke("ping")'],
    ["src/app/api/orders/ping/route.ts", "checkSitePing(", "noteOrdersPing", 'syncSiteOrders("ping")'],
    ["src/app/api/menu/ping/route.ts", "checkMenuPing(", "notePing", 'syncSiteMenu("ping")'],
  ] as const) {
    const src = read(file);
    assert.match(src, /if \(length > 4096\) return Response\.json\(\{ error: "too_large" \}, \{ status: 413 \}\)/, file);
    assert.ok(src.indexOf(check) > 0 && src.indexOf(check) < src.indexOf("after("), `${file}: 202'den önce imza`);
    assert.ok(src.includes(`runPingWork("[`) && src.includes(`note: ${note}, pull: () => ${pull} }`), `${file}: ortak yardımcı`);
    assert.doesNotMatch(src, /setTimeout/, `${file}: yeniden deneme yardımcıda`);
  }
});
