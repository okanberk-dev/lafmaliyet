// Onay isteklerinin telefon bildirimi (Dalga 2; docs/ONAYLAR.md › Bildirimler): personel yeni bir istek açınca push
// aboneliği olan yöneticilere kısa bildirim (kim, ne istedi, şube). Metnin saf hâli (src/lib/staff-requests.ts
// requestPushText) ve kaynak denetimleri: isteği açan her yol bildirimi işlemden sonra ve yalnız yeni istekte çağırır,
// gönderim isteği yeniden okur (hâlâ bekliyorsa), metinde personelin nedeni ve tutar yok.
// Çalıştırma: npx tsx --test tests/onay-bildirimi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { KIND_LABEL, requestPushText, RETIRED_REQUEST_KINDS, STAFF_REQUEST_KINDS, type StaffRequestKind } from "../src/lib/staff-requests";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));

test("bildirim metni: başlıkta türün adı, gövdede kim ve ne istedi, birden çok şubede şube; adres karta iner", () => {
  const p = requestPushText({ id: 42, kind: "kasa-duzeltme", title: "22 Ekim kasa düzeltmesi", requestedByName: "Mehmet", branchName: "Tuzla" });
  assert.deepEqual(p, {
    title: "Onay isteği · Kasa düzeltmesi",
    body: "Mehmet: 22 Ekim kasa düzeltmesi · Tuzla",
    url: "/panel/onaylar#istek-42",
    tag: "istek-42",
  });
  const single = requestPushText({ id: 7, kind: "zayi-gec", title: " Latte M ×2 · 15 Eki ", requestedByName: "  ", branchName: null });
  assert.equal(single.body, "Personel: Latte M ×2 · 15 Eki", "şube yokken (tek şube) gövde yalnız kim ve ne; adsız isteyen 'Personel'");
  assert.equal(single.title, "Onay isteği · Geç zayi / ikram");
});

test("her canlı türün bildirim başlığı var; etiket isteğe özel (aynı isteğin bildirimi öncekinin yerine geçer)", () => {
  const retired: readonly StaffRequestKind[] = RETIRED_REQUEST_KINDS;
  for (const kind of STAFF_REQUEST_KINDS.filter((k) => !retired.includes(k))) {
    const p = requestPushText({ id: 1, kind, title: "x", requestedByName: "Ayşe", branchName: null });
    assert.ok(p.title.endsWith(KIND_LABEL[kind]), `${kind}: başlık türün adıyla biter`);
    assert.ok(!/₺|\d+[.,]\d{2}/.test(p.title + p.body), `${kind}: bildirimde tutar yok`);
  }
  assert.notEqual(requestPushText({ id: 1, kind: "kasa-silme", title: "x", requestedByName: "A", branchName: null }).tag, requestPushText({ id: 2, kind: "kasa-silme", title: "x", requestedByName: "A", branchName: null }).tag);
});

test("gönderim: yalnız yeni istek (güncelleme ve çift dokunuş göndermez), yanıttan sonra; istek yeniden okunur, yalnız yöneticilere", () => {
  const push = read("src/server/staff-requests/push.ts");
  assert.match(push, /^import "server-only";/);
  assert.match(push, /if \(!out\.created\) return;/, "güncellenen istek (sürüm artar) ve aynı istemci anahtarı yeniden bildirmez");
  assert.match(push, /after\(\(\) =>/, "bildirim yanıttan sonra: personelin isteği beklemez");
  assert.match(push, /eq\(r\.status, "pending"\)/, "arada geri çekilen ya da karara bağlanan istek bildirilmez");
  assert.match(push, /eq\(s\.users\.role, "admin"\), eq\(s\.users\.active, true\)/);
  assert.match(push, /sendPush\("approvals", \{ kind: "approvals", \.\.\.text \}/);
  assert.match(push, /requestPushText\(\{ id: row\.id, kind: row\.kind as StaffRequestKind, title: row\.title, requestedByName: row\.requestedByName, branchName \}\)/);
  assert.doesNotMatch(push, /r\.message/, "personelin nedeni okunmaz, bildirime girmez");
});

test("isteği açan her yolun eylemi bildirimi çağırır (yeni bir istek yolu eklenince burası da güncellenir)", () => {
  // createOrUpdateRequest'i çağıran alan çekirdekleri: yeni biri eklenirse eylemi pushNewRequest'i çağırmalı
  const cores = walk("src/server")
    .filter((f) => f !== "src/server/staff-requests/core.ts" && /createOrUpdateRequest\(/.test(read(f)))
    .sort();
  assert.deepEqual(cores, [
    "src/server/cash-outs/requests.ts",
    "src/server/cash/late.ts",
    "src/server/cash/requests.ts",
    "src/server/closed-day-requests.ts",
    "src/server/karaoke/timer.ts",
    "src/server/waste/core.ts",
  ]);
  const calls: Record<string, number> = {
    "src/server/actions/cash-requests.ts": 3,
    "src/server/actions/closed-days.ts": 1,
    "src/server/actions/waste-requests.ts": 2,
    "src/server/actions/cash-out-requests.ts": 2,
    "src/server/actions/karaoke.ts": 1,
  };
  for (const [file, n] of Object.entries(calls)) {
    const src = read(file);
    assert.equal((src.match(/pushNewRequest\(/g) ?? []).length, n, `${file}: her istek yolu bir kez`);
  }
  // Her çağrı alanın çekirdeğinden hemen sonra (işlem bitmiş, istek yazılmış)
  assert.match(read("src/server/actions/cash-requests.ts"), /const \{ row, changes, created \} = await inFormTill\(parsed\.branchId, \(\) => proposeCashCorrection\(getDb\(\), asActor\(me, "staff"\), data\)\);\n\s+pushNewRequest\(\{ row, created \}\);/);
  assert.match(read("src/server/actions/karaoke.ts"), /const out = await proposeKaraokeDelete\(getDb\(\), me, data\);\n\s+pushNewRequest\(out\);/);
});

test("cihazdaki 'Onay bildirimleri' anahtarı yalnız yöneticide", () => {
  const device = read("src/components/panel/live/device-alerts.tsx");
  assert.match(device, /\{role === "admin" \? \(\s+<ToggleRow\s+title="Onay bildirimleri"/);
  assert.match(device, /onChange=\{\(v\) => void changeTopic\("approvals", v\)\}/);
});
