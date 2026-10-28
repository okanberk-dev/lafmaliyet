// Denetim B20 (sağlamlık süpürmesi): zaman damgalarının günü İstanbul saatiyle (E-70) ve zilin maliyet modeli
// yüklenemeyince öbür maddeleri göstermesi (E-49). Eylem hatalarının bekçisi tests/arayuz-duzeltmeleri.test.ts'te.
// Çalıştırma: npx tsx --test tests/saglamlik.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dateTR, dayTR } from "../src/lib/format";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("dayTR: zaman damgasının günü İstanbul saatiyle; gece 00:40'taki değişiklik o güne yazılır (E-70)", () => {
  assert.equal(dayTR("2026-10-31T21:40:00.000Z"), "2026-11-01");
  assert.equal(dateTR(dayTR("2026-10-31T21:40:00.000Z")), "01.11.2026");
  assert.equal(dayTR(new Date("2026-10-31T21:40:00.000Z")), "2026-11-01");
  // 03:00'ten (UTC 00:00) önce de sonra da aynı gün
  assert.equal(dayTR("2026-11-01T20:59:59.000Z"), "2026-11-01");
  assert.equal(dayTR("2026-11-01T21:00:00.000Z"), "2026-11-02");
  // Yalnız gün olan metin aynen; çözülemeyen metin ilk on harfiyle
  assert.equal(dayTR("2026-11-01"), "2026-11-01");
  assert.equal(dayTR("bilinmiyor"), "bilinmiyor");
});

test("gün etiketleri ve zil kimlikleri UTC'den kesilmez (E-70)", () => {
  const files = [
    "src/server/actions/notifications.ts",
    "src/app/panel/hammaddeler/ingredients-client.tsx",
    "src/app/panel/urunler/price-impact-panel.tsx",
    "src/app/panel/tutarlilik/consistency-client.tsx",
    "src/lib/mcp/answers/prices.ts",
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /toISOString\(\)\.slice\(0, 10\)/, f);
    assert.doesNotMatch(src, /(?:At|\.at)\.slice\(0, 10\)/, f);
  }
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /const lastChange = prices\?\.changes\.map\(\(c\) => dayTR\(c\.changedAt\)\)\.sort\(\)\.at\(-1\) \?\? "";/);
  assert.match(bell, /id: `fatura-yeni-\$\{todayTR\(\)\}-\$\{fresh\.n\}`/);
});
