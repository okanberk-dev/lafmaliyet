// Denetim B20 (sağlamlık süpürmesi): zaman damgalarının günü İstanbul saatiyle (E-70), zilin maliyet modeli
// yüklenemeyince öbür maddeleri göstermesi (E-49) ve atılan eylemi yakalayan yardımcılar (E-51: tryAction,
// catchingFormAction, actionErrorText; incelemeden: kayıt yapılmış olabilir, gönderilemedi, girişte e-posta kalır). Eylem hatalarının bekçisi tests/arayuz-duzeltmeleri.test.ts'te.
// Çalıştırma: npx tsx --test tests/saglamlik.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { redirect } from "next/navigation";
import { toast } from "sonner";

import {
  actionErrorText,
  catchingFormAction,
  MAYBE_SAVED_TEXT,
  OFFLINE_TEXT,
  SEND_OFFLINE_TEXT,
  STALE_TEXT,
  tryAction,
  UNREACHABLE_TEXT,
} from "../src/components/ui/action-error";
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

test("zil: maliyet modeli düşünce öbür maddeler gelir; menü okuma hatasını 'Dikkat isteyen bir şey yok'tan ayırır (E-49)", () => {
  const bell = read("src/server/actions/notifications.ts");
  const action = bell.slice(bell.indexOf("export async function loadPanelNotifications"));
  // Yöneticinin Promise.all'ında catch'siz üye yok; model kendi satırını koyar
  assert.match(action, /modelNotifications\(\)\.catch\(modelFailed\),/);
  assert.doesNotMatch(action, /\bloadModel\(\)/);
  const all = action.slice(action.indexOf("await Promise.all(["), action.indexOf("]);", action.indexOf("await Promise.all([")));
  for (const line of all.split("\n").slice(1).filter((l) => l.trim())) assert.match(line, /\.catch\(/, line);
  const menu = read("src/components/panel/notifications.tsx");
  assert.match(menu, /failure === "stale"\s+\? "Panel güncellendi; bildirimler için sayfayı yenileyin\."/);
  // Son okuma boş döndüyse "son okunan liste gösteriliyor" denmez (altında liste yok)
  assert.match(menu, /items === null \|\| items\.length === 0\s+\? "Bildirimler okunamadı; bağlantıyı kontrol edip yeniden deneyin\."\s+: "Bildirimler yenilenemedi; son okunan liste gösteriliyor\."/);
  // Okunamayınca boş liste metni yok
  assert.match(menu, /failure && !\(filter === "unread" && list\.length\) \? null : \(/);
  assert.match(menu, /list\.length \? "Hepsi okundu" : failure \? "Okunamadı" : "Dikkat isteyen bir şey yok"/);
  const shell = read("src/components/panel/sidebar.tsx");
  assert.doesNotMatch(shell, /setAlerts\(\[\]\)|setAlerts\(\(a\) => a \?\? \[\]\)/);
  assert.match(shell, /\.catch\(\(e: unknown\) => setAlertsFailure\(actionFailure\(e\)\)\)/);
});

test("tryAction: atan eylem bildirim çıkarır ve undefined döner; yanıt olduğu gibi geçer; yönlendirme geri atılır (E-51)", async () => {
  const shown: unknown[][] = [];
  const t = toast as unknown as { error: (...a: unknown[]) => unknown };
  const realError = t.error;
  const realLog = console.error;
  t.error = (...a: unknown[]) => void shown.push(a);
  console.error = () => {};
  try {
    // Ağ kesildi: Chrome "Failed to fetch", Safari "Load failed"
    assert.equal(await tryAction(() => Promise.reject(new TypeError("Failed to fetch"))), undefined);
    assert.equal(shown.at(-1)?.[0], OFFLINE_TEXT);
    // Eylemin kendi hatası yanıt olarak gelir: bildirimi çağıran gösterir
    assert.deepEqual(await tryAction(async () => ({ ok: false as const, error: "Reddedildi" })), { ok: false, error: "Reddedildi" });
    assert.equal(shown.length, 1);
    // Panel güncellendi (eski eylem kimliği): "Yenile" düğmeli bildirim
    assert.equal(await tryAction(() => Promise.reject(new UnrecognizedActionError("Server Action not found"))), undefined);
    assert.equal(shown.at(-1)?.[0], STALE_TEXT);
    assert.equal(actionErrorText(new UnrecognizedActionError("x")), STALE_TEXT);
    // Next'in yönlendirmesi yutulmaz
    await assert.rejects(
      tryAction(async () => redirect("/panel")),
      (e: unknown) => typeof (e as { digest?: string }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
    );
  } finally {
    t.error = realError;
    console.error = realLog;
  }
  assert.equal(STALE_TEXT, "Panel güncellendi; sayfayı yenileyip yeniden deneyin.");
});

test("tryAction: yeni kayıt açan eylemde kopan bağlantı 'Kaydedilemedi' demez; gönderen eylemde 'Gönderilemedi' (B20 inceleme)", async () => {
  const shown: { kind: string; args: unknown[] }[] = [];
  const t = toast as unknown as { error: (...a: unknown[]) => unknown; warning: (...a: unknown[]) => unknown };
  const real = { error: t.error, warning: t.warning };
  t.error = (...a: unknown[]) => void shown.push({ kind: "error", args: a });
  t.warning = (...a: unknown[]) => void shown.push({ kind: "warning", args: a });
  try {
    // Yanıt yolda kayboldu: kayıt yapılmış olabilir; yenileyip bakması söylenir, "Yenile" düğmesiyle
    assert.equal(await tryAction(() => Promise.reject(new TypeError("Failed to fetch")), { maybeSaved: true }), undefined);
    const last = shown.at(-1)!;
    assert.equal(last.kind, "warning");
    assert.equal(last.args[0], MAYBE_SAVED_TEXT);
    assert.equal((last.args[1] as { action?: { label: string } }).action?.label, "Yenile");
    assert.doesNotMatch(MAYBE_SAVED_TEXT, /Kaydedilemedi/);
    // Eski eylem kimliği: istek eyleme ulaşmadı, yine "Panel güncellendi"
    await tryAction(() => Promise.reject(new UnrecognizedActionError("x")), { maybeSaved: true });
    assert.equal(shown.at(-1)!.args[0], STALE_TEXT);
    // Gönderen eylem: kaydedilen bir şey yok
    await tryAction(() => Promise.reject(new TypeError("Load failed")), { offline: SEND_OFFLINE_TEXT });
    assert.deepEqual([shown.at(-1)!.kind, shown.at(-1)!.args[0]], ["error", SEND_OFFLINE_TEXT]);
    assert.match(SEND_OFFLINE_TEXT, /^Gönderilemedi: /);
    // Yalnız kimlik verilirse eskisi gibi; kimlik bildirime gider
    await tryAction(() => Promise.reject(new TypeError("Failed to fetch")), "kayit");
    assert.deepEqual([shown.at(-1)!.args[0], (shown.at(-1)!.args[1] as { id?: string }).id], [OFFLINE_TEXT, "kayit"]);
    await tryAction(() => Promise.reject(new TypeError("Failed to fetch")), { id: "x", maybeSaved: false });
    assert.equal(shown.at(-1)!.args[0], OFFLINE_TEXT);
  } finally {
    t.error = real.error;
    t.warning = real.warning;
  }
});

test("tekrarı ikinci kayıt yazan eylemler maybeSaved ile, gönderen ve çeken eylemler kendi metniyle çağrılır (B20 inceleme)", () => {
  const sites: [string, RegExp][] = [
    ["src/app/panel/satislar/sales-client.tsx", /importSales\(\{ month, lines: rows, mode, through: running \? through : null \}\), \{ maybeSaved: mode === "append" \}\)/],
    ["src/app/panel/satislar/sales-client.tsx", /saveLine\(\{ id: line\.id \?\? null, month, posName, qty: qtyNum, revenue: revNum, note \}\), \{ maybeSaved: !line\.id \}\)/],
    ["src/app/panel/personel/staff-editor.tsx", /tryAction\(\(\) => saveStaff\(list\), \{ maybeSaved: !row \}\)/],
    ["src/app/panel/personel/staff-editor.tsx", /itibarıyla devam ediyor`,\s+true,\s+\);/],
    ["src/app/panel/giderler/expenses-client.tsx", /effectiveFrom: !row \|\| amountChanged \? eff : row\.valueMonth,\s+\}\),\s+\/\/[^\n]*\n\s+\{ maybeSaved: !row \},/],
    ["src/app/panel/giderler/expenses-client.tsx", /saveInvestment\(\{ id: row\?\.id \?\? null, name, amount: parsed, date, note \}\), \{ maybeSaved: !row \}\)/],
    ["src/app/panel/giderler/expenses-client.tsx", /itibarıyla devam ediyor`,\s+true,\s+\);/],
    ["src/app/panel/tutarlilik/consistency-client.tsx", /saveFinding\(\{ id: item\?\.id \?\? null, section, title, detail \}\), \{ maybeSaved: !item \}\)/],
    ["src/app/panel/kontrol/duzenle/templates-client.tsx", /createChecklistTemplate\(draftOf\(draft\)\), \{ maybeSaved: true \}\)/],
    // PR #62 incelemesi ve aynı sınıftan olanlar: yeni kontrol maddesi, hatırlatıcı, cari ödeme ve borç, zayi, Ödendi / Ertele
    ["src/app/panel/kontrol/duzenle/[id]/template-editor.tsx", /item\?\.id \?\? null,\s+\),\s+\/\/[^\n]*\n\s+\{ maybeSaved: !item \},/],
    ["src/app/panel/hatirlaticilarim/my-reminders.tsx", /saveUserReminder\(\{[\s\S]*?\}\),\s+\{ maybeSaved: !initial \},\s+\);/],
    ["src/app/panel/hatirlaticilarim/my-reminders.tsx", /await after\(\);\s+\/\/[^\n]*\n\s+\}, \{ maybeSaved: true \}\);/],
    ["src/app/panel/tedarikciler/cari-payment-dialog.tsx", /onSaved\?\.\(\{ slug: d\.slug \}\);\s+\/\/[^\n]*ikinci ödemeyi yazar\n\s+\}, \{ maybeSaved: !edit \}\);/],
    ["src/app/panel/tedarikciler/[cari]/debt-dialog.tsx", /onSaved\?\.\(\{ slug: d\.slug \}\);\s+\/\/[^\n]*ikinci borcu yazar\n\s+\}, \{ maybeSaved: !edit \}\);/],
    ["src/app/panel/zayi/waste-board.tsx", /setReason\(null\);\s+(?:\/\/[^\n]*\n\s+)+\}, \{ maybeSaved: !late \}\);/],
    ["src/app/panel/hatirlaticilar/payment-ui.tsx", /await run\(\);\s+\} catch \(e\) \{\s+(?:\/\/[^\n]*\n\s+)+toastUnreachable\(e, \{ maybeSaved: true \}\);/],
    ["src/components/panel/live/device-alerts.tsx", /sendTestPush\(\), \{ offline: SEND_OFFLINE_TEXT \}\)/],
    ["src/app/panel/kasa/cash-form.tsx", /resendCashReportEmail\(report\.id\), \{ offline: SEND_OFFLINE_TEXT \}\)/],
    ["src/app/panel/kullanicilar/access-sheet.tsx", /emailAccess\(\{[^}]*\}\), \{ offline: SEND_OFFLINE_TEXT \}\)/],
    ["src/app/panel/gelir-gider/site-sales-card.tsx", /refreshSiteSales\(months\), \{ offline: UNREACHABLE_TEXT \}\)/],
  ];
  for (const [f, re] of sites) assert.match(read(f), re, f);
  // Ortak "run" yardımcıları seçeneği tryAction'a geçirir
  for (const f of ["src/app/panel/personel/staff-editor.tsx", "src/app/panel/giderler/expenses-client.tsx"]) {
    assert.match(read(f), /fallback: string, maybeSaved = false\)[^{]*\{\s+setPending\(true\);\s+const res = await tryAction\(\(\) => p, \{ maybeSaved \}\);/, f);
  }
  assert.equal(UNREACHABLE_TEXT, "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.");
});

test("catchingFormAction / actionErrorText: form önceki durumunda kalır, neden formun hata satırında (E-51)", async () => {
  const realLog = console.error;
  console.error = () => {};
  try {
    type State = { error?: string; step?: string };
    const throwing = async (state: State, payload: FormData): Promise<State> => {
      throw new TypeError(payload instanceof FormData && state ? "Load failed" : "x");
    };
    const failing = catchingFormAction(throwing);
    assert.deepEqual(await failing({ step: "password" }, new FormData()), { step: "password", error: "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin." });
    const answering = async (state: State, size: number): Promise<State> => ({ ...state, error: size > 1 ? "Büyük" : undefined });
    assert.deepEqual(await catchingFormAction(answering)({ step: "password" }, 2), { step: "password", error: "Büyük" });
    // recover: React formu boşaltır; gönderilen e-posta duruma geri konur, alan ondan dolar (giriş formu)
    type Login = { error?: string; email?: string };
    const offline = async (state: Login, payload: FormData): Promise<Login> => {
      throw new TypeError(state && payload ? "Failed to fetch" : "x");
    };
    const login = catchingFormAction(offline, (fd: FormData) => ({ email: String(fd.get("email") ?? "") }));
    const fd = new FormData();
    fd.set("email", "ayse@laffogato.net");
    fd.set("password", "gizli");
    assert.deepEqual(await login({}, fd), { email: "ayse@laffogato.net", error: UNREACHABLE_TEXT });
    assert.match(read("src/app/giris/login-form.tsx"), /catchingFormAction\(loginAction, \(fd: FormData\) => \(\{ email: String\(fd\.get\("email"\) \?\? ""\) \}\)\)/);
    assert.equal(actionErrorText(new Error("beklenmedik")), "İşlem tamamlanamadı; sayfayı yenileyip yeniden deneyin.");
    assert.throws(() => actionErrorText((() => { try { redirect("/giris"); } catch (e) { return e; } })()));
  } finally {
    console.error = realLog;
  }
});
