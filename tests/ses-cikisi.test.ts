// Uyarıların çalacağı hoparlör: seçilebilir hoparlörler, kayıtlı seçimin yeniden bulunması, Bluetooth / bilgisayar
// hoparlörü tahmini (src/lib/audio-output.ts) ve sesin Bluetooth hoparlöre kaçmaması için kurallar.
// Çalıştırma: npx tsx --test tests/ses-cikisi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { looksBuiltIn, looksWireless, needsLabelPermission, resolveOutput, selectableOutputs, suggestedOutput } from "../src/lib/audio-output";

const out = (deviceId: string, label: string, kind = "audiooutput") => ({ kind, deviceId, label, groupId: "" });

// Chrome'un Windows'ta mikrofon izninden sonra verdiği liste
const windows = [
  out("default", "Varsayılan - Hoparlör (JBL Charge 5)"),
  out("communications", "İletişim - Hoparlör (Realtek(R) Audio)"),
  out("a1", "Hoparlör (Realtek(R) Audio)"),
  out("b2", "Hoparlör (JBL Charge 5)"),
  out("c3", "Kulaklık (AirPods Pro) (Bluetooth)"),
  out("m1", "Mikrofon (Realtek(R) Audio)", "audioinput"),
  out("a1", "Hoparlör (Realtek(R) Audio)"),
];

test("seçilebilir hoparlörler: takma adlar, mikrofonlar ve tekrarlar çıkar", () => {
  assert.deepEqual(
    selectableOutputs(windows).map((d) => d.id),
    ["a1", "b2", "c3"],
  );
  // İzin yokken Chrome adları boş verir: seçilecek bir şey yok, izin gerekir
  const locked = [out("", ""), out("", "", "audioinput")];
  assert.deepEqual(selectableOutputs(locked), []);
  assert.equal(needsLabelPermission(locked), true);
  assert.equal(needsLabelPermission(windows), false);
  assert.equal(needsLabelPermission([]), true);
});

test("kayıtlı seçim: önce kimlikle, kimlik değiştiyse adla bulunur; varsayılan seçimde null", () => {
  const list = selectableOutputs(windows);
  assert.equal(resolveOutput({ id: "a1", label: "eski ad" }, list)?.id, "a1");
  // Tarayıcı verisi silinince kimlik değişir, ad aynı kalır (büyük/küçük harf ve boşluk fark etmez)
  assert.equal(resolveOutput({ id: "eski-kimlik", label: "  hoparlör (realtek(r)  audio) " }, list)?.id, "a1");
  assert.equal(resolveOutput({ id: "eski-kimlik", label: "Hoparlör (Yok)" }, list), null);
  assert.equal(resolveOutput({ id: "", label: "Hoparlör (Realtek(R) Audio)" }, list), null);
});

test("Bluetooth ve bilgisayarın kendi hoparlörü tahmini", () => {
  for (const label of ["Hoparlör (JBL Charge 5)", "Kulaklık (AirPods Pro) (Bluetooth)", "Headset (Bose QC35 Hands-Free AG Audio)", "Marshall Emberton"]) {
    assert.equal(looksWireless(label), true, label);
    assert.equal(looksBuiltIn(label), false, label);
  }
  for (const label of ["Hoparlör (Realtek(R) Audio)", "Speakers (Realtek High Definition Audio)", "MacBook Pro Speakers", "Built-in Output", "Dahili Hoparlörler"]) {
    assert.equal(looksBuiltIn(label), true, label);
    assert.equal(looksWireless(label), false, label);
  }
  assert.equal(suggestedOutput(selectableOutputs(windows))?.id, "a1");
  assert.equal(suggestedOutput([{ id: "x", label: "Hoparlör (JBL Charge 5)" }]), null);
});

test("ses seçilen hoparlöre çalar; çalamazsa varsayılana döner, sessiz kalmaz", () => {
  const sounds = readFileSync(join(process.cwd(), "src/components/panel/live/sounds.ts"), "utf8");
  assert.match(sounds, /await c\.setSinkId\(id\)/);
  assert.match(sounds, /await c\.setSinkId\(""\)\.catch/);
  // Yüksek ama kırpılmayan çıkış: sınırlayıcı
  assert.match(sounds, /createDynamicsCompressor\(\)/);
  assert.match(sounds, /master\.connect\(limiter\)\.connect\(ctx\.destination\)/);
  const prefs = readFileSync(join(process.cwd(), "src/components/panel/live/prefs.ts"), "utf8");
  assert.match(prefs, /outputId: "", outputLabel: "" \}/);
});

test("sesi sekme çalıyorsa sistem bildirimi sessiz (işletim sisteminin sesi Bluetooth hoparlöre giderdi)", () => {
  const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  assert.match(sw, /const pageRings = await tellPanels\(panels,/);
  assert.match(sw, /silent: pageRings,/);
  assert.match(sw, /new MessageChannel\(\)/);
  assert.match(sw, /setTimeout\(\(\) => resolve\(false\), 800\)/);
  const center = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  assert.match(center, /e\.ports\[0\]\?\.postMessage\(\{ willRing \}\)/);
  assert.match(center, /const silent = prefs\.sound && audioState\(\) === "ready";/);
});

test("mikrofon izni yalnız panel sayfalarında ve yalnız bu site için", () => {
  const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
  assert.match(config, /\{ key: "Permissions-Policy", value: "camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)" \}/);
  assert.match(config, /const PANEL_PERMISSIONS = \{ key: "Permissions-Policy", value: "camera=\(\), microphone=\(self\), geolocation=\(\), payment=\(\), usb=\(\)" \}/);
  assert.match(config, /\{ source: "\/panel\/:path\*", headers: \[PANEL_PERMISSIONS\] \}/);
  // Açılan mikrofon hemen kapatılır
  const client = readFileSync(join(process.cwd(), "src/components/panel/live/output-client.ts"), "utf8");
  assert.match(client, /for \(const t of stream\.getTracks\(\)\) t\.stop\(\);/);
});
