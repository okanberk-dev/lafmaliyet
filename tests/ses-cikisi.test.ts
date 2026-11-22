// Uyarıların çalacağı hoparlör: seçilebilir hoparlörler, kayıtlı seçimin yeniden bulunması, Bluetooth / bilgisayar
// hoparlörü tahmini (src/lib/audio-output.ts) ve sesin Bluetooth hoparlöre kaçmaması için kurallar.
// Çalıştırma: npx tsx --test tests/ses-cikisi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  alertAudible,
  deviceBranch,
  isMobileAgent,
  looksBuiltIn,
  looksWireless,
  needsLabelPermission,
  onlyComputerFor,
  osNotificationSilent,
  resolveOutput,
  selectableOutputs,
  suggestedOutput,
  systemDefaultLabel,
} from "../src/lib/audio-output";

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
  assert.match(prefs, /outputId: "", outputLabel: "", onlyComputer: null \}/);
});

test("sesi sekme çalıyorsa sistem bildirimi sessiz (işletim sisteminin sesi Bluetooth hoparlöre giderdi)", () => {
  const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  assert.match(sw, /const pageRings = await tellPanels\(panels,/);
  assert.match(sw, /const quiet = pageRings \|\| \(await quietDevice\(\)\) \|\| !soundHours\(Date\.now\(\)\);/);
  assert.match(sw, /silent: quiet,/);
  assert.match(sw, /e\.data\.willRing \|\| e\.data\.quiet/);
  assert.match(sw, /new MessageChannel\(\)/);
  assert.match(sw, /setTimeout\(\(\) => resolve\(false\), 800\)/);
  const center = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  assert.match(center, /e\.ports\[0\]\?\.postMessage\(\{ willRing, quiet: onlyComputerActive\(\) \}\)/);
  assert.match(center, /const silent = quietOs\(prefs\.sound\);/);
  // Sistem bildirimlerinin hepsi aynı kuraldan: doğrudan "sekme çalıyor mu" kalmadı
  assert.doesNotMatch(center, /silent: prefs\.sound/);
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

// ─── Yalnız bu bilgisayar (Tuzla Köyiçi, 22 Kasım 2026) ──────────────────────────────────────────────────────────

test("yalnız bu bilgisayar: seçilen hoparlör yoksa genel hoparlöre düşmez, susar", () => {
  // Kapalıyken eski davranış: her durumda çalar (seçim yoksa sistemin varsayılanından)
  for (const s of ["default", "active", "missing", "permission", "unsupported"] as const) assert.equal(alertAudible(false, s), true);
  // Açıkken yalnız seçilen hoparlör etkinse
  assert.equal(alertAudible(true, "active"), true);
  assert.equal(alertAudible(true, "default"), false, "hoparlör seçilmemiş: varsayılan çıkış genel hoparlör olabilir");
  assert.equal(alertAudible(true, "missing"), false, "hoparlör çıkarıldı");
  assert.equal(alertAudible(true, "permission"), false, "izin düştü");
  // Tarayıcı seçtirmiyor (Safari): anahtar orada sunulmaz, ses cihazın çıkışından
  assert.equal(alertAudible(true, "unsupported"), true);
  // Sistemin bildirim sesi yönlendirilemez: açıkken hep sessiz
  assert.equal(osNotificationSilent(true, false), true);
  assert.equal(osNotificationSilent(false, false), false);
  assert.equal(osNotificationSilent(false, true), true);
});

test("yalnız bu bilgisayar: Tuzla'da varsayılan açık, Marina'da kapalı, elle seçim her şubede geçerli", () => {
  assert.equal(onlyComputerFor(null, "tuzla"), true);
  assert.equal(onlyComputerFor(null, "marina"), false);
  assert.equal(onlyComputerFor(null, null), false);
  assert.equal(onlyComputerFor(false, "tuzla"), false);
  assert.equal(onlyComputerFor(true, "marina"), true);
  assert.equal(deviceBranch("tuzla"), "tuzla");
  assert.equal(deviceBranch("marina"), "marina");
  // Telefon ve tablette anahtar yok (hoparlör zaten cihazın kendisi)
  assert.equal(isMobileAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"), false);
  assert.equal(isMobileAgent("Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"), true);
  assert.equal(isMobileAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
});

test("yalnız bu bilgisayar: Tümü'de bilgisayarın kendi seçimi; Tuzla'nın varsayılanı yalnız açıkça Tuzla seçiliyken", () => {
  // #101'in ardından (22 Kasım 2026): Marina'daki bilgisayarda soldan "Tümü" seçiliyken Tuzla'nın varsayılanı açılıyor,
  // hoparlör seçilmeden sipariş zili ve alarm susuyordu
  assert.equal(deviceBranch("hepsi"), null, "Tümü'de bilgisayarın şubesi bilinmez");
  assert.equal(onlyComputerFor(null, "hepsi"), false, "seçim yoksa kapalı: ses varsayılan çıkıştan çalar, susmaz");
  assert.equal(alertAudible(onlyComputerFor(null, "hepsi"), "default"), true, "hoparlör seçilmemiş bilgisayarda ses çalar");
  assert.equal(onlyComputerFor(true, "hepsi"), true, "bilgisayarda elle açıldıysa Tümü'de de açık");
  assert.equal(onlyComputerFor(false, "hepsi"), false);
  assert.equal(onlyComputerFor(null, "online"), false);
  // Tuzla'nın bugünkü davranışı aynı: açıkça Tuzla (yöneticinin seçimi ya da personelin kilidi) seçiliyken varsayılan açık
  assert.equal(onlyComputerFor(null, "tuzla"), true);
  assert.equal(alertAudible(onlyComputerFor(null, "tuzla"), "default"), false, "Tuzla'da hoparlör seçilmeden genel hoparlöre gitmez");
});

test("sistemin varsayılan çıkışının adı (genel hoparlör uyarısı için)", () => {
  assert.equal(systemDefaultLabel(windows), "Hoparlör (JBL Charge 5)");
  assert.equal(systemDefaultLabel([out("default", "Default - Speakers (Realtek(R) Audio)")]), "Speakers (Realtek(R) Audio)");
  assert.equal(systemDefaultLabel([out("default", "")]), null, "izin yokken ad yok");
  assert.equal(looksBuiltIn("Speakers (Realtek(R) Audio)"), true);
});

test("seçim bu bilgisayarda saklanır ve geri okunur", async () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g;
  g.window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    const prefs = await import("../src/components/panel/live/prefs");
    // Seçim yokken şubenin varsayılanı: Tuzla'da açık, Marina'da kapalı
    prefs.setBranchScope("tuzla");
    assert.equal(prefs.currentPrefs("staff").onlyComputer, null);
    assert.equal(prefs.onlyComputerOn(prefs.currentPrefs("staff")), true);
    prefs.setBranchScope("marina");
    assert.equal(prefs.onlyComputerOn(prefs.currentPrefs("staff")), false);
    prefs.setBranchScope("hepsi");
    assert.equal(prefs.onlyComputerOn(prefs.currentPrefs("staff")), false, "Tümü'de seçim yoksa kapalı (Tuzla'nın varsayılanı değil)");
    // Elle seçim saklanır; önbellek boşalınca (yeniden açılış) depodan aynısı okunur
    prefs.updatePrefs("staff", { outputId: "a1", outputLabel: "Hoparlör (Realtek(R) Audio)", onlyComputer: true });
    prefs.setBranchScope("tuzla");
    const back = prefs.currentPrefs("staff");
    assert.equal(back.outputId, "a1");
    assert.equal(back.outputLabel, "Hoparlör (Realtek(R) Audio)");
    assert.equal(back.onlyComputer, true);
    prefs.setBranchScope("hepsi");
    assert.equal(prefs.onlyComputerOn(prefs.currentPrefs("staff")), true, "bilgisayarın kendi seçimi Tümü'de de geçerli");
    prefs.updatePrefs("staff", { onlyComputer: false });
    prefs.setBranchScope("marina");
    assert.equal(prefs.currentPrefs("staff").onlyComputer, false, "Tuzla'da da elle kapatılabilir");
    // Bozuk kayıt: şubenin varsayılanına döner
    store.set("laf:cihaz-uyarilari:admin", JSON.stringify({ onlyComputer: "evet", outputId: 5 }));
    prefs.setBranchScope("tuzla");
    assert.equal(prefs.currentPrefs("admin").onlyComputer, null);
    assert.equal(prefs.currentPrefs("admin").outputId, "");
  } finally {
    if (!had) delete g.window;
  }
});

test("paneldeki bütün sesler tek yardımcıdan (sounds.ts) geçer", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?|mjs)$/.test(name)) files.push(p);
    }
  };
  walk(join(process.cwd(), "src"));
  files.push(join(process.cwd(), "public/sw.js"));
  // sounds.ts çalar; audio-output.ts yalnız saf kurallar (açıklamada setSinkId geçer)
  const allowed = [join("src", "components", "panel", "live", "sounds.ts"), join("src", "lib", "audio-output.ts")];
  const offenders = files
    .filter((f) => !allowed.some((a) => f.endsWith(a)))
    .filter((f) => /new Audio\(|\bAudioContext\b|webkitAudioContext|speechSynthesis|SpeechSynthesisUtterance|\.play\(|<audio\b|setSinkId/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(process.cwd().length + 1));
  assert.deepEqual(offenders, [], "ses yalnız src/components/panel/live/sounds.ts'ten çalınır (seçilen hoparlöre, gerekirse susar)");
});
