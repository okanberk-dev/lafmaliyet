// Kontrol listeleri ve personelin şube kilidi (21 Kasım 2026 denetimi #10 = #35; docs/KONTROL-LISTELERI.md › Şubeler):
// şubesine kilitli personel yalnız kendi şubesinin ve bütün şubelerin (şubesiz) listelerini açar, doldurur ve
// fotoğraflarını görür. Listeleme yolları zaten süzüyordu; adresle açılan liste (/panel/kontrol/<id>), yanıt yazımı,
// fotoğraf yüklemesi (POST /api/kontrol/foto) ve fotoğrafın kendisi (/api/foto/<id>) artık kilide bakar.
// Veritabanı tarafı tests/kontrol-listeleri-db.test.ts'te (writeAnswer, checkPhotoTarget, photoRun).
// Çalıştırma: npx tsx --test tests/kontrol-sube-kilidi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchLockAllows, OTHER_BRANCH_TEXT, photoAccess } from "../src/lib/checklists";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const tr = (local: string) => new Date(`${local}:00+03:00`);

test("kural: kilitsiz herkes her listeyi; kilitli personel kendi şubesinin ve şubesiz listeleri", () => {
  // Kilit yok (yönetici, şubesiz personel, şubesi pasife alınmış personel)
  assert.equal(branchLockAllows("tuzla", null), true);
  assert.equal(branchLockAllows("marina", undefined), true);
  assert.equal(branchLockAllows(null, null), true);
  // Marina'ya kilitli: Marina'nın ve bütün şubelerin listesi evet, Tuzla'nın Tuvalet çizelgesi hayır
  assert.equal(branchLockAllows("marina", "marina"), true);
  assert.equal(branchLockAllows(null, "marina"), true);
  assert.equal(branchLockAllows("tuzla", "marina"), false);
  assert.match(OTHER_BRANCH_TEXT, /başka şubenin/);
});

test("fotoğraf: kilitli personel başka şubenin listesinin fotoğrafını görmez; şubesiz liste ve yönetici etkilenmez", () => {
  const now = tr("2026-10-22T14:00");
  const run = (branchId: string | null) => ({ date: "2026-10-22", staffAllowed: true, staffSince: null, branchId });
  const staff = { role: "staff" as const, userId: 2, createdBy: 9, now };
  assert.equal(photoAccess({ ...staff, run: run("tuzla"), lock: "marina" }), false);
  assert.equal(photoAccess({ ...staff, run: run("marina"), lock: "marina" }), true);
  assert.equal(photoAccess({ ...staff, run: run(null), lock: "marina" }), true);
  // Kilitsiz personel (şubesi boş) her şubenin fotoğrafını görür; eski çağrı biçimi (şube ve kilit yok) değişmedi
  assert.equal(photoAccess({ ...staff, run: run("tuzla"), lock: null }), true);
  assert.equal(photoAccess({ ...staff, run: { date: "2026-10-22", staffAllowed: true } }), true);
  // Yönetici hepsini
  assert.equal(photoAccess({ ...staff, role: "admin", run: run("tuzla"), lock: "marina" }), true);
  // Kilit 7 günlük pencereyi ve "Personel doldurabilir"i gevşetmez
  assert.equal(photoAccess({ ...staff, run: { ...run("marina"), date: "2026-10-15" }, lock: "marina" }), false);
  assert.equal(photoAccess({ ...staff, run: { ...run("marina"), staffAllowed: false }, lock: "marina" }), false);
  // Bağlanmamış fotoğrafı yalnız yükleyen görür (kilit buna dokunmaz)
  assert.equal(photoAccess({ ...staff, createdBy: 2, run: null, lock: "marina" }), true);
});

test("kaynak: doldurma ekranı kilitli personeli başka şubenin listesinden geri gönderir", () => {
  const page = read("src/app/panel/kontrol/[id]/page.tsx");
  assert.match(page, /import \{ staffBranchLock \} from "@\/server\/branch-scope";/);
  // Bütün şubelerin listesinde kaydın şubesi önce seçilir (şube ayrımı), kilit aynı anda okunur
  assert.match(page, /Promise\.all\(\[checklistRunBranch\(typeof sube === "string" \? sube : null\), admin \? null : staffBranchLock\(\), listBranches\(\)\]\)/);
  assert.match(page, /const first = await loadRunView\(tid, today, now, runBranch\);/);
  const guard = page.indexOf('if (!admin && !branchLockAllows(view.template.branchId, lock)) redirect("/panel/kontrol");');
  assert.ok(guard > 0, "şube kilidi denetimi");
  // Hiçbir şey çizilmeden ve dünün kaydına bakılmadan önce
  assert.ok(guard < page.indexOf("nowBusinessMinute(now) < ANSWER_GRACE_MIN"));
  assert.ok(guard < page.indexOf("<RunForm"));
});

test("kaynak: yazım ve fotoğraf hedefi kilidi her çağrıda alır; veritabanı katmanı reddeder; fotoğraf kuralı kilide bakar", () => {
  const data = read("src/server/data/checklists.ts");
  const write = data.slice(data.indexOf("export async function writeChecklistAnswer("), data.indexOf("export async function checkPhotoTarget("));
  assert.match(write, /const lock = await staffBranchLock\(\);[\s\S]*return store\.writeAnswer\(getDb\(\), \{ \.\.\.adminActor\(me\), lock, runBranch: await runBranchPick\(branch\) \}/);
  const target = data.slice(data.indexOf("export async function checkPhotoTarget("), data.indexOf("export async function logAnswerActivity("));
  assert.match(target, /const lock = await staffBranchLock\(\);[\s\S]*return store\.checkPhotoTarget\(getDb\(\), \{ \.\.\.adminActor\(me\), lock, runBranch: await runBranchPick\(branch\) \}/);
  assert.match(data, /const \[run, lock\] = await Promise\.all\(\[store\.photoRun\(getDb\(\), photo\.id\), staffBranchLock\(\)\]\);/);
  assert.match(data, /photoAccess\(\{ role: adminLevel\(me\.role\), userId: me\.id, createdBy: photo\.createdBy, run, lock, now: new Date\(\) \}\)/);

  const store = read("src/server/checklists/store.ts");
  const guard = 'if (me.role !== "admin" && !branchLockAllows(tpl.branchId, me.lock)) throw new ChecklistError(OTHER_BRANCH_TEXT, 403);';
  const answer = store.slice(store.indexOf("export async function writeAnswer("), store.indexOf("export async function checkPhotoTarget("));
  // Kayıt açılmadan (anlık görüntü yazılmadan) önce
  assert.ok(answer.includes(guard) && answer.indexOf(guard) < answer.indexOf("insert(s.checklistRuns)"));
  const photo = store.slice(store.indexOf("export async function checkPhotoTarget("), store.indexOf("export async function photoRun("));
  assert.ok(photo.includes('if (me.role !== "admin" && !branchLockAllows(t.branchId, me.lock)) throw new ChecklistError(OTHER_BRANCH_TEXT, 403);'));
  // Fotoğrafın şubesi kaydın şubesi (bütün şubelerin listesinde fotoğrafın çekildiği şube; şube ayrımı)
  assert.match(store, /staffSince: s\.checklistTemplates\.staffSince,\s*branchId: s\.checklistRuns\.branchId,/);

  // Her iki giriş yolu da bu sarmalayıcılardan geçer (eylem ve fotoğraf yolu)
  assert.match(read("src/server/actions/checklists.ts"), /r = await writeChecklistAnswer\(me, op, now\);/);
  const route = read("src/app/api/kontrol/foto/route.ts");
  assert.match(route, /await checkPhotoTarget\(me, target, now\);/);
  assert.match(route, /r = await writeChecklistAnswer\(me, \{ op: "photo", photoId, \.\.\.target \}, now\);/);
});
