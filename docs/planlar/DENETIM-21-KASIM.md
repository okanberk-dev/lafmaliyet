# 21 Kasım 2026 denetimi: doğrulanmış bulgular

Sistem geneli tarama (12 alan; her bulgu bağımsız bir denetçiyle kod yolu ve niyet açısından çürütülmeye çalışıldı).
35 bulgu doğrulandı; 35, 10'un ve 24, 19'un tekrarıdır (aynı hatanın başka yerden görünüşü; birlikte düzeltilir). Durum sütunu düzeltildikçe güncellenir. 21 Kasım: 35'in hepsi düzeltildi (iki dalga).

| # | Önem | Alan | Bulgu | Yer | Durum |
|---|------|------|-------|-----|-------|
| 1 | high | sube | Kapalı gün Z no / açılış sürekliliği şubeler arası karşılaştırılıyor: onaylı kapalı gün silinebiliyor ya da onay engelleniyor | `src/server/closed-days.ts:248` | düzeltildi (a8b5ef9) |
| 2 | high | kasa | Kasa e-postasında ve WhatsApp metninde şube yazmıyor; e-postadaki 'Panelde aç' bağlantısı başka şubenin raporunu açabiliyor | `src/server/notify/cash-report-template.ts:226` | düzeltildi (312ed98) |
| 3 | high | fatura | A Paraşüt invoice deleted in the panel comes back on the next sync when the record carries both a bill id and an e-invoice id | `src/server/actions/invoices.ts:714` | düzeltildi (17b64ff) |
| 4 | high | maliyet | Su + buz litre fiyatı şube seçiliyken işletmenin su faturasını yalnız o şubenin litresine bölüyor: reçete maliyetleri şubeye göre şişiyor | `src/lib/calc/engine.ts:1176` | düzeltildi (9bc3f6c) |
| 5 | high | pos | AsilPOS geçiş günü şubesiz (tek ayar): Tuzla AsilPOS'a geçince Marina'nın ModPOS kasası da AsilPOS sayılır, föy çekimi, Kasa karşılaştırması ve satış listesi durur | `src/server/modpos/sync.ts:165` | düzeltildi (d5c9120) |
| 6 | high | rapor | Gelir-gider: ciro, açık gün and month-note edits ignore the selected şube and always overwrite Tuzla's month row | `src/server/actions/pnl.ts:101` | düzeltildi (c55b5a2) |
| 7 | high | rapor | Satışlar 'Ayı temizle' deletes every şube's sales list and manual ay bilgisi, not just the selected branch's | `src/server/actions/sales.ts:569` | düzeltildi (c55b5a2) |
| 8 | high | arayuz | The stock count draft key leaves out the branch, so one branch's unsaved counts are offered on another branch's count and saved there | `src/app/panel/sayim/stock-form.tsx:1402` | düzeltildi (d5180bc) |
| 9 | high | veri | Backups taken before 0053 (before 4 Nov 2026) cannot be restored: migration 0056 adds branch FKs while the branches table is still empty | `drizzle/0056_sube_kirilimi.sql:51` | düzeltildi (fe7cf05) |
| 10 | medium | kontrol | Staff locked to one branch can still open and fill (and upload photos to) the other branch's checklist | `src/server/checklists/store.ts:472` | düzeltildi (f587119) |
| 11 | medium | sube | Nakit planı günlük satış: yeni açılan ya da eksik raporlu şubenin cirosu 28 güne yayılıyor (Tümü'de düşük tahmin) | `src/lib/cash-plan.ts:760` | düzeltildi (c55b5a2) |
| 12 | medium | sube | Kasa raporu ve kasadan çıkan, formun gösterdiği şubeye değil gönderim anındaki çereze yazılıyor | `src/server/cash/report-store.ts:426` | düzeltildi (312ed98) |
| 13 | medium | cikis | Zayi gün kilidi (wasteLock) şubeye bakmıyor: iki şube rapor girince dün personele hiç kapanmıyor, ya da başka şubenin raporu günü kapatıyor | `src/server/waste/core.ts:64` | düzeltildi (2bfbd2e) |
| 14 | medium | guvenlik | Staff locked to one branch can still edit, delete or view another branch's records by passing that record's ID | `src/server/cash-outs/guard.ts:47` | düzeltildi (2622fca) |
| 15 | medium | bildirim | Snoozing a recurring personal reminder by an hour permanently moves the time of every later occurrence | `src/server/actions/user-reminders.ts:178` | düzeltildi (76ed965) |
| 16 | medium | bildirim | Stock-count push and the morning e-mail's past-month count line only check Tuzla's count, never Marina's | `src/server/data/count-progress.ts:20` | düzeltildi (76ed965) |
| 17 | medium | bildirim | Postponing a branch-specific recurring payment creates the one-off copy without its branch, so Marina's payment leaks into Tuzla's views | `src/server/actions/reminders.ts:441` | düzeltildi (76ed965) |
| 18 | medium | bildirim | Manual e-mail paths (send now, preview, weekly preview and sample) use the admin's branch selection; the cron uses all branches | `src/server/weekly/collect.ts:304` | düzeltildi (76ed965) |
| 19 | medium | maliyet | "Listede olmayanlar" (stock_extras) şubesiz: Marina'nın sayım formu Tuzla'nın ek kalemlerini gösterip üzerine yazıyor ya da siliyor | `src/server/data/dataset.ts:117` | düzeltildi (d5180bc) |
| 20 | medium | maliyet | Sayım sayfası hep şube kapsamıyla yükleniyor: Gelir-giderde elle yazılan devir ve açılış uyarıları (E-30) artık hiç görünmüyor | `src/app/panel/sayim/page.tsx:78` | düzeltildi (d5180bc) |
| 21 | medium | rapor | A newly opened şube's first month is treated as 'kasa raporları ay ortasında başladı': ciro and açık gün are dropped in its branch view | `src/lib/cash-month.ts:232` | düzeltildi (c55b5a2) |
| 22 | medium | arayuz | Branch picker deep-link (?sube=) adoption is keyed to the last adopted value, not the link, so links open the wrong branch or undo the user's choice | `src/components/panel/branch-picker.tsx:42` | düzeltildi (5884cbc) |
| 23 | medium | arayuz | The admin bell's 'Personel özel gün ekledi/düzeltti/sildi' row links to the deleted /panel/tahmin page (404) | `src/server/bell/kasa.ts:321` | düzeltildi (76ed965) |
| 24 | medium | veri | stock_extras ('Listede olmayanlar') has no branch_id, so branches share and overwrite each other's month-end extra items | `src/server/db/schema.ts:814` | düzeltildi (d5180bc) |
| 25 | low | kontrol | Hourly staff e-mail reminders keep firing on a day the admin has marked 'Kafe kapalı' | `src/server/notify/checklist-alerts.ts:161` | düzeltildi (f587119) |
| 26 | low | sube | Bugün: laffogato.net kanalı seçiliyken yöneticinin kasa satırları online kanalı okuyor; Kasa sayfası ve zil Tuzla'yı gösteriyor | `src/server/data/today.ts:148` | düzeltildi (c55b5a2) |
| 27 | low | sube | Genel bakış 'Yaklaşan ödemeler' kartı şube seçimini yok sayıyor; Bugün'deki aynı kart süzüyor | `src/app/panel/page.tsx:579` | düzeltildi (c55b5a2) |
| 28 | low | cikis | Onaylar › Zayi kartlarının bağlamı isteğin şubesini yok sayıyor: Z ödenmez, rapor gönderildi mi ve kayıtlı ikram yanlış şubeden | `src/server/data/waste-requests.ts:253` | düzeltildi (2bfbd2e) |
| 29 | low | cikis | Kasadan çıkan ve fotoğraf kaldırma onay kartları şubeyi göstermiyor, 'Günü aç' bağlantısı şubesiz | `src/server/data/cash-out-requests.ts:198` | düzeltildi (2bfbd2e) |
| 30 | low | bildirim | Weekly summary counts short cash reports as days, so one day short at both branches reads as '2 gun eksik' | `src/lib/weekly/items.ts:154` | düzeltildi (76ed965) |
| 31 | low | fatura | A 'Kasadan' supplier payment made with 'Tümü' selected silently creates its cash line in Tuzla's till; the dialog never shows which branch's till it uses | `src/server/cari/entries.ts:249` | düzeltildi (17b64ff) |
| 32 | low | maliyet | Ayarlar › Stok değerleme önizlemesi seçili şubenin sayımıyla hesaplanıyor; ayar ise işletme genelinin kâr-zararını değiştiriyor | `src/app/panel/ayarlar/page.tsx:395` | düzeltildi (9bc3f6c) |
| 33 | low | pos | Karaoke eşitlemesi okunamayan (atlanan) rezervasyonu 'sitede silinmiş' sayıp panelden siliyor | `src/server/karaoke/sync.ts:223` | düzeltildi (d5c9120) |
| 34 | low | arayuz | 'Kasaya işle' rows hidden on tap are not restored when the save fails with a network or stale error | `src/components/panel/pos-checklist.tsx:85` | düzeltildi (d5c9120) |
| 35 | low | arayuz | Staff locked to a branch can open and fill another branch's checklist by URL | `src/app/panel/kontrol/[id]/page.tsx:56` | düzeltildi (f587119) |

## Sonraki işler (düzeltmeler sırasında görülen, bulgu listesinde olmayan)

| Konu | Yer | Not | Durum |
|------|-----|-----|-------|
| Sayım kaydı şubeyi formdan değil çerezden alır | `src/app/panel/sayim/actions.ts` | #12'nin sayım karşılığı: başka sekmede şube değişince açık sayım formu öbür şubeye kaydedebilir (kasa formları artık kasasını taşıyor; `formTillBranch`) | düzeltildi (539f474) |
| Şube seçici kaydedilmemiş sayımda sormadan geçer | `src/components/panel/branch-picker.tsx` | Taslak şube başına saklandığı için veri kaybolmaz (#8), yalnız uyarı yok | düzeltildi (539f474) |
| Z fotoğrafı boyut denetimi iki şubenin 28 günlük toplamını karıştırır | `src/server/photo-read/read.ts` (`okcTypical`) | "Alışılmışın dışında" uyarısı Tümü toplamına göre; Z no karşılaştırması #1'de şubeye bağlandı | düzeltildi (539f474) |
| Eski veritabanı testleri düşüyor (21 Kasım'dan önce de) | `tests/cari-db.test.ts` (2), `tests/ekim-sayimi.test.ts` (18) | `ekim-sayimi`: 0047'nin `ON CONFLICT ("month","ingredient_id")`'i 0056'dan beri eşleşen tekil dizin bulamıyor. Bu testler yalnız ortam değişkeniyle çalışır; `npm test`'te atlanır | düzeltildi (9628201): iki test de eskimişti, kodda hata yok |

## Ayrıntı

### 1. Kapalı gün Z no / açılış sürekliliği şubeler arası karşılaştırılıyor: onaylı kapalı gün silinebiliyor ya da onay engelleniyor

- **Yer:** `src/server/closed-days.ts:248` (ayrıca: `src/server/cash/report-store.ts:314`, `src/server/closed-days.ts:119`, `src/server/closed-day-requests.ts:85`, `src/lib/closed-days.ts:168`)
- **Senaryo:** Each branch has its own ModPOS, so Z counters are independent (for example, Tuzla is around 1240 and Marina around 30). The admin approves a single-day closure for 18 Nov: a `kapali` row. On 17 Nov only Marina reported (Z 0030), or both reported and Marina's row wins the tie, since the query has no secondary order. On 19 Nov Tuzla saves its first report (Z 1241). writeCashReport then calls onNextReport. prev is the latest report before 18 Nov in any branch, which is Marina's Z 0030. zGapOf gives 1241-30-1 = 1210 missing Z, which is red. dropClosedMark deletes the approved closed-day row, sets the approving request to `revoked` with the note "Z no boşluğu", and writes an activity log entry. 18 Nov becomes a missing-report day again in Bugün/zil, ay bilgisi and the forecast. When the Z order is reversed (the new report's Z is lower), the gap is negative. Instead, Tuzla's carry is compared with Marina's opening, and a false "Kapalı gün: açılış devirle tutmuyor" entry goes to the activity log and the zil. The same cross-branch prev/next lookup in closedDayEvidence (lines 119-130) can produce a red Z gap. reviewClosedDayCore then throws CLOSED_TEXT.red, so the admin cannot approve a real closure, and a staff request is refused as "kafe açık görünüyor".
- **Kanıt:** onNextReport(tx, report: { date, zNo, openingCash }) has no branch: `.from(s.cashReports).where(lt(s.cashReports.date, day)).orderBy(desc(s.cashReports.date)).limit(1)` (l.252-257), then `zGapOf(day, prev, {date: report.date, zNo: report.zNo}, others)` and `if (gap?.level === "red") ... dropClosedMark(...)`. It is called from report-store.ts:314 `await onNextReport(tx, row)`, where row carries branchId but the value is not used. closedDayEvidence has the same problem: prev `.where(lt(s.cashReports.date, date))` and next `.where(gt(s.cashReports.date, date))` read any branch. docs/KASA-RAPORU.md describes Z no continuity as the continuity between the previous and next report of the same till. The 1c9dbb3 commit made the other single-till reads branch-scoped but missed this one.
- **Önerilen düzeltme:** 1. In src/server/closed-days.ts `onNextReport`, take `report: { date; zNo; openingCash; branchId }`. In the `prev` query, use `.where(and(lt(s.cashReports.date, day), eq(s.cashReports.branchId, report.branchId)))`. The existing `others` loop is then correct per branch. report-store.ts:314 already passes the whole row, so it carries `branchId`.
2. In `closedDayEvidence`, compute prev/next, `others`, `zGapOf` and `openingText` separately for each branch that has reports around the date, scoping both queries with `eq(s.cashReports.branchId, b)`. Then combine the results: zGap is red if any branch is red, otherwise the first warn; opening is the first `!ok`, otherwise the first `ok`. The ClosedEvidence shape stays the same, so `proposeClosedDay`, `reviewClosedDayCore` and kasa/page.tsx need no changes.
3. Optionally, add a tie-breaker (`asc`/`desc` on `branchId`) to any query that must stay unscoped.
- **Denetçi:** The finding holds. I traced both the code path and the stated intent.

Code path:
- `writeCashReport` (src/server/cash/report-store.ts:310-315) calls `onNextReport(tx, row)` for every new report. `row` carries `branchId` (it was inserted with `branchId: o.branchId`), but the function never uses it.
- In `onNextReport` (src/server/closed-days.ts:248-275), `prev` comes from `.where(lt(s.cashReports.date, day)).orderBy(desc(date)).limit(1)`. That query has no branch filter and no tie-breaker.
- `zGapOf` then compares the new report's Z no with whichever branch's report came back. A red result leads to `dropClosedMark`, which deletes the approved `kapali` row, revokes the approving request and writes the activity log. A non-red result leads to `openingText`, which can compare one branch's carry with the other branch's opening.
- `closedDayEvidence` (lines 119-130) has the same unscoped prev/next. It feeds `proposeClosedDay`, where a red Z gap means `hasPanelEvidence` refuses the staff request, and `reviewClosedDayCore`, where red means it throws `CLOSED_TEXT.red`.
- Nothing upstream guards against this. Closed days are global (`special_days` has no `branch_id`), so one `kapali` row covers both branches. Tuzla and Marina each have their own ModPOS with its own key (docs/MODPOS-API.md §1a), so their Z counters are independent.

Concrete failure:
1. A global closed day D is approved.
2. Marina's D-1 report exists (Z 30), but Tuzla's D-1 report is still missing or late. Alternatively, both exist and the unordered tie returns Marina's row.
3. Tuzla saves its D+1 report with Z 1241.
4. The gap is 1241-30-1 = 1210, which is more than others = 0, so the result is red. The approved closed mark is deleted and the request is revoked, so D becomes a missing-report day again.

The opposite direction also happens: Marina's D+1 report is checked against Tuzla's report. The negative gap is silent, but the opening check compares Tuzla's carry with Marina's opening and logs a false "Kapalı gün: açılış devirle tutmuyor".

Intent:
- docs/SUBE.md (20 Kasım) says the carry-over chain, the till's Z order and the other single-till reads all belong to each branch's own till. `carryBefore` in the same file was scoped with `eq(branchId)` in commit 1c9dbb3; these two reads were missed.
- docs/KASA-RAPORU.md defines Z no continuity as the gap between the previous and next report's Z numbers.
- No doc, plan or test says cross-branch comparison is intended. tests/kapali-gun*.test.ts never mention branches.

### 2. Kasa e-postasında ve WhatsApp metninde şube yazmıyor; e-postadaki 'Panelde aç' bağlantısı başka şubenin raporunu açabiliyor

- **Yer:** `src/server/notify/cash-report-template.ts:226` (ayrıca: `src/lib/cash-report.ts:884`, `src/lib/cash-report.ts:938`, `src/lib/cash-report.ts:944`, `src/server/cash/report-email.ts:85`, `src/server/bell/kasa.ts:79`, `src/app/panel/kasa/page.tsx:217`)
- **Senaryo:** Tuzla ve Marina 20 Kasım raporlarını girer. Alıcılar iki e-posta alır, ikisinin konusu da 'Kasa raporu KR-20261120 · 20 Kasım Cuma · 120 ₺ eksik' biçimindedir. Başlıkta ve gövdede şube adı yoktur, rapor numarası da iki şubede aynıdır. Hangi şubenin kasasının eksik olduğu anlaşılmaz. Yönetici Marina'nın e-postasındaki 'Panelde aç'a basar ve /panel/kasa?gun=2026-11-20 açılır. Çerezi 'Tümü' ise ?gun= olduğu için sayfa currentTillBranch() ile Tuzla'nın formunu açar; çerezi Tuzla'da kaldıysa yine Tuzla'nınki açılır. Yönetici Marina'nın e-postasına bakıp Tuzla'nın rakamlarını görür, düzeltmeyi de yanlış rapora yapabilir. WhatsApp'ta durum aynı: iki şubenin metni aynı sohbete '*L'Affogato · Gün sonu kasa raporu KR-20261120*' başlığıyla, şubesiz düşer.
- **Kanıt:** cash-report-template.ts:226 `const link = `${APP_URL}/panel/kasa?gun=${f.date}`` ile bağlantıda &sube= yok. Aynı dosyanın 247. satırı ve cash-report.ts reportSubject/cashReportText (884, 944) yalnız `reportNo(f.date)`, longDateTR ve byLine yazar; şube adı hiçbir yerde geçmiyor. reportNo yalnız tarihten üretiliyor: `KR-${date.replaceAll("-", "")}`. Doc 'Gün başına tek rapor olduğu için numara benzersizdir' diyor, iki şubede bu artık doğru değil. Aynı veriyi gösteren zil satırları şubeyi taşıyor: bell/kasa.ts kasaHref `&sube=` ekler, titleOf şube adını yazar. İki yol tutarsız. report-email.ts:85'teki notification_log anahtarı `cash:${row.date}:r${row.revision}` de iki şubede çakışıyor; onConflictDoUpdate bir şubenin kaydını ötekiyle eziyor.
- **Önerilen düzeltme:** 1. `src/server/cash/report-email.ts` `emailReport`:
   - Load `listBranches()`.
   - `named = tillBranches(branches).length > 1`.
   - Pass `branch: named ? { id: row.branchId, name } : null` in the meta to `renderCashReport`.
   - Make the `notification_log` key branch-specific for non-Tuzla rows: ``cash:${row.date}:r${row.revision}${row.branchId !== DEFAULT_BRANCH_ID ? `:${row.branchId}` : ""}``. This keeps the existing Tuzla keys that tests assert.
2. `src/server/notify/cash-report-template.ts` `renderCashReport`:
   - Accept `meta.branch`.
   - Build the link as ``${APP_URL}/panel/kasa?gun=${f.date}${meta.branch ? `&sube=${encodeURIComponent(meta.branch.id)}` : ""}``, the same as `bell/kasa.ts` `kasaHref`.
   - Add ` · ${meta.branch.name}` after `reportNo` in the header line.
3. `src/lib/cash-report.ts`:
   - Give `reportSubject(f, revision, branchName?)` an optional branch name and insert ` · Marina` after the number when it is given.
   - Add an optional `branchName` to `cashReportText`'s meta and append it to the first line.
   - Have the `whatsappText` callers pass the branch name when more than one till is open: `actions/cash-report.ts:71` and `:219`, `app/panel/kasa/page.tsx:300` (from `view.branch`), and `cash-history.tsx:161`.
4. Update the `KASA-RAPORU.md` sentence about the report number: it is unique per branch, and the branch name is shown next to it when more than one till is open.
- **Denetçi:** The finding holds up on both the code path and the documentation check. I would rate it medium rather than high.

Code path:
- `emailReport(reportId)` in `src/server/cash/report-email.ts` runs for every saved report of every branch. It sends to one global recipient list (`loadCashSettings` reads a single `integration_state` key, so both branches go to the same people and the same WhatsApp number).
- `renderCashReport` (`src/server/notify/cash-report-template.ts`) has no branch input at all. The subject comes from `reportSubject` and `reportNo(f.date)`, the header shows `reportNo` plus `longDateTR`, and the text comes from `cashReportText`, whose `head` (`src/lib/cash-report.ts:884`) is also built from the date only.
- So on a day when both Tuzla and Marina report, the recipients get two emails with the same format and no branch name, e.g. "Kasa raporu KR-20261120 · 20 Kasım Cuma · …". The two can only be told apart by their numbers. The WhatsApp text (`whatsappText` → `cashReportText`) has the same problem.
- The "Panelde aç" link is `${APP_URL}/panel/kasa?gun=${f.date}` with no `&sube=`. `requestBranchScope` reads only the cookie; `?sube=` reaches the cookie only through `BranchPicker`, so here the cookie decides. In `CashContent` (`page.tsx`), the per-branch "Tümü" view is skipped whenever `?gun=` is present. The page then calls `currentTillBranch()`, which returns Tuzla when the cookie is "Tümü" or tuzla, and Marina when the cookie is marina.
- Result: Marina's email opens Tuzla's report, and with a marina cookie Tuzla's email opens Marina's. The page header does name the branch, so a careful reader can notice, but the link still opens the wrong report.
- The bell builds the same link with `&sube=` and puts the branch name in the title (`bell/kasa.ts` `kasaHref`/`titleOf`; tests `modpos-sube.test.ts:355` assert `&sube=marina`). The two paths are inconsistent.
- The `notification_log` key `cash:${row.date}:r${row.revision}` collides between branches. `onConflictDoUpdate` overwrites the first branch's `ok`/`error`/`sentAt` with the second's, while the first branch's subject and recipients stay. This is a log-only effect.

Intent:
- `KASA-RAPORU.md` ("Gün başına tek rapor olduğu için numara benzersizdir") and the `cashEmailKey` comment ("güne göre kalır") were written before per-branch tills. `SUBE.md` "Kasa raporu Tümü'de" (20 Kasım) only says the email and WhatsApp text use the report's own branch data. It says nothing about identifying the branch.
- Nothing in `docs/planlar` accepts or defers this.
- The tests assert the subject only for a single branch (`kasa-raporu.test.ts:236`, `kasa-raporu-sade.test.ts:40`). Adding the branch name only when more than one till is open keeps them passing.

### 3. A Paraşüt invoice deleted in the panel comes back on the next sync when the record carries both a bill id and an e-invoice id

- **Yer:** `src/server/actions/invoices.ts:714` (ayrıca: `src/server/actions/invoices.ts:846`, `src/server/parasut/sync.ts:1321`, `src/server/parasut/sync.ts:1371`, `src/server/parasut/mapping.ts:507`, `src/server/actions/invoices.ts:933`)
- **Senaryo:** This follows PARASUT.md §6: the accountant enters an incoming e-fatura into Paraşüt by hand as a purchase bill B instead of using 'içeri al', so the e-invoice E has no `invoice` relationship. On the sync, applyDraft opens record R with externalId=B. applyEInvoice then finds R by the full invoice number and writes eInvoiceId=E onto it (sync.ts:1371-1374). The same two-key state also occurs when an Excel record already linked to E is later matched to a manual bill. The admin deletes R in Faturalar. deleteInvoice adds only parasutKeyOf(R)=B to parasut.ignore, because externalId takes precedence over `ei:<E>`. On the next morning sync, bill B is skipped as ignored. But applyEInvoice(E) checks only `ei:E` (sync.ts:1321), which is not in the list. E has no importedBillId, R is gone, and findByEInvoiceNo finds nothing. So a brand-new record is created from the e-invoice, marked 'ödenmedi'. The deleted invoice reappears in Faturalar, Gelir-gider and Ödemeler & hatırlatıcılar, and goes into the reminder e-mail. This contradicts PARASUT.md ('Panelde silinen Paraşüt faturaları bir sonraki eşitlemede geri gelmez'). The same thing happens if bill B is later re-imported as B2 with active_e_document E: eInvoiceDeleted only checks `ei:E`.
- **Kanıt:** `function parasutKeyOf(r) { return r.externalId ?? (r.eInvoiceId ? `ei:${r.eInvoiceId}` : null); }` adds only one key. deleteInvoice (line 846): `const key = parasutKeyOf(d); ... writeState(tx, IGNORE_KEY, [...ignore, key])`. sync.ts:1320-1321: `const key = `ei:${d.eInvoiceId}`; if (ctx.ignored.has(key) || ...) return "skipped";`. After that, nothing stops the create path (sync.ts:1385 onward) when there is no match and no importedBillId.
- **Önerilen düzeltme:** In src/server/actions/invoices.ts:
- deleteInvoice: build both keys, `keys = [d.externalId, d.eInvoiceId ? `ei:${d.eInvoiceId}` : null].filter(Boolean)`, and append every key not already in IGNORE_KEY. Keep `key` (externalId first) as the DeletedEntry.externalId. Optionally also store the extra key on the entry, e.g. `alsoIgnored: ["ei:<E>"]`.
- unignoreParasutBill: once the entry is found, remove the extra key too: `ei:${entry.row.eInvoiceId}` when entry.row.externalId and entry.row.eInvoiceId are both set (or use entry.alsoIgnored). The IGNORE_KEY filter should drop every key of that invoice. The `existing` check should also look for a row holding entry.row.eInvoiceId, so it returns 'exists' instead of hitting the unique-index error.
No change is needed in sync.ts: applyEInvoice's `ctx.ignored.has('ei:E')` and applyDraft's eInvoiceDeleted already honour the second key.
- **Denetçi:** I traced the path end to end and nothing blocks it.

1) How a record gets both keys. In syncParasut, bills are written first and e-invoices after (sync.ts ~842). Say the accountant enters bill B by hand in Paraşüt, so it has no active_e_document. applyDraft opens record R with externalId=B and no eInvoiceId. Then applyEInvoice(E) runs. E has no importedBillId and no record has eInvoiceId E, so the match is null. findExisting looks only at records with no eInvoiceId and no externalId, so it finds nothing. Then findByEInvoiceNo, filtered to rows with an externalId and no eInvoiceId (sync.ts:1371), finds R and writes eInvoiceId=E onto it. PARASUT.md §6 documents exactly this flow. The Excel path gives the same state: the Excel row is linked to E first, then findExisting/findByEInvoiceNo in applyDraft puts externalId=B on it.

2) What deletion records. deleteInvoice (invoices.ts:846) uses parasutKeyOf(d), which returns `externalId ?? ei:<id>`. Only "B" goes into parasut.ignore and into the DELETED_BILLS entry.

3) What the next sync does. applyDraft(B) is skipped because B is ignored. The e-invoice window reaches back 75 days from the cursor (LOOKBACK_DAYS), so E is read again. applyEInvoice(E) checks only `ei:E` (sync.ts:1321), which is not in the list. No record holds E, importedBillId is null so the 'skipped' branch at 1352 never runs, and R is gone, so both findExisting and findByEInvoiceNo come back empty. The create path (1413+) inserts a new origin='parasut' record, normally marked unpaid.

The case where E was imported properly in Paraşüt is safe: there importedBillId=B and the code returns 'skipped' at 1360. That is why only the hand-entered-bill / Excel-linked case breaks.

Intent: PARASUT.md:150-152 says deleted Paraşüt invoices do not come back on the next sync, and §6:438 says the same for e-invoices. Nothing in docs/planlar accepts this, and no test covers deleting a record with both keys. tests/parasut.test.ts only tests eInvoiceDeleted with a single key.

Side effect: restoring R later from "Silinen Paraşüt faturaları" fails. unignoreParasutBill('B') checks only externalId=B and then inserts the snapshot with eInvoiceId=E, which collides with the unique index invoices_e_invoice_id_uq because the record the sync re-created already holds E.

### 4. Su + buz litre fiyatı şube seçiliyken işletmenin su faturasını yalnız o şubenin litresine bölüyor: reçete maliyetleri şubeye göre şişiyor

- **Yer:** `src/lib/calc/engine.ts:1176` (ayrıca: `src/server/data/dataset.ts:91`, `src/server/data/dataset.ts:141`, `src/server/data/dataset.ts:162`, `src/lib/branches.ts:161`, `src/server/actions/products.ts:85`, `src/server/actions/products.ts:118`)
- **Senaryo:** Eylül su faturası "manual:su" = 3.000 ₺. Bu satır işletme genelidir (tests/sube-maliyet.test.ts: "su, doğalgaz: işletme geneli") ve her şubede görünür. Tuzla + Marina birlikte 315 L su/buz kullanıyor, Marina tek başına 111 L. Tümü'nde perLiter = 9,53 ₺/L. Yönetici soldan Marina'yı seçince yükleyici salesLines'ı Marina'ya süzüyor (dataset.ts:91) ve fiziksel şubede site satışlarını hiç okumuyor (dataset.ts:141). computeWater faturanın tamamını yalnız Marina'nın litresine bölüyor: perLiter = 27,05 ₺/L. Excel tohumuyla motorda doğruladım: Americano M maliyeti Tümü'nde 27,23 ₺, şube görünümünde 30,55 ₺. Su ya da buz içeren her üründe Ürünler, reçete kartı ve Hammaddeler'deki maliyet, maliyet oranı, durum ve önerilen fiyat seçili şubeye göre değişiyor; oysa menü ve reçete ortak. Şube kâr-zararının "sube" mal maliyeti (cogsConsumption → monthSales.cost → ürün maliyeti) suyu şişirilmiş fiyatla sayıyor: iki şubenin su payı toplamı faturanın yaklaşık 2 katı. Ayrıca acknowledgePriceAlert ve updateProductPrice(ack) loadModel()'in şubeye göre maliyetini işletme geneli PRICE_ACK'e yazıyor: Marina seçiliyken kapatılan zam uyarısı, Tümü'nde gerçek zam o eşiğe kadar artsa da geri gelmiyor.
- **Kanıt:** engine.ts:1176 `const listLiters = waterLiters(ingredientUsage(m));` ve :1181 `perLiter: bill / liters`. ingredientUsage(m) yalnız ds.salesLines'tan (şubeye süzülmüş) gelir; bill ise `pnlByMonth.get(m)!.get("manual:su")`: pnl_entries'in şube sütunu yok, branchPnlEntry manual:* satırını her şubede tutar. :1191 `if (ing.priceSource === "water") return water.perLiter / 1000;` bu fiyatı her reçete satırına taşır. E-57 (denetim-2026-10-26) ilkesi: "Fatura kafede kullanılan bütün suyu kapsar".
- **Önerilen düzeltme:** Compute the water price per liter for the whole business, whatever branch is selected.

1. In src/server/data/dataset.ts readDataset(): when `branch !== null`, also load the all-branches inputs for the water calculation. These are the unfiltered sales_lines (or the merged sales of an ALL_BRANCHES read) and loadSiteSales(). From them, compute water liters per bill month. A simpler alternative is to compute `createModel(await loadDataset({ scope: ALL_BRANCHES })).water` and pass it on the Dataset as a new optional field, e.g. `companyWater?: WaterCost`.

2. In src/lib/calc/engine.ts computeWater(): if `ds.companyWater` is set (branch view), return it instead of dividing by the branch's own ingredientUsage/onlineUsage. Keep `st.suBirimLTOverride` first.

3. Hammaddeler's waterBreakdown takes its liter rows from model.ingredientUsage(w.month), which is filtered by branch. Give it the business-wide liters too, or the breakdown will no longer match the card.

With this, product cost, the sube COGS and the PRICE_ACK values written by acknowledgePriceAlert and updateProductPrice(ack) no longer depend on the selected branch.
- **Denetçi:** I could not refute this. The code path and the docs both support it.

CODE PATH: The Ürünler, reçete, Hammaddeler, Gelir-gider and Genel bakış pages, and the products.ts actions (lines 76 and 116), all call loadModel() with no scope. So readDataset() uses the branch picked in the selector (currentBranchScope).

With a physical branch selected, three things happen together:
- salesLines are filtered to that branch (dataset.ts:91, branchWhere).
- siteSales is [] (dataset.ts:141).
- pnlInScope keeps every manual:* row (branchPnlEntry returns true for "manual:", branches.ts:161), and pnl_entries has no branch column (schema.ts:781), so manual:su is the whole business's bill.

In engine.ts computeWater (about line 1165), listLiters = waterLiters(ingredientUsage(m)), and ingredientUsage reads linesByMonth, which is built from the filtered ds.salesLines. onlineLiters = 0 because siteSales is empty. The result is perLiter = whole bill / one branch's liters. unitCostOf passes this to every water or ice ingredient, then to ProductCalc.cost, monthSales cost and cogsConsumption (the "sube" COGS method). No guard anywhere uses the all-branches liters.

I reproduced it with the Excel seed and manual:su = 3000 for 2026-09:
- Tümü: 9.53 ₺/L over 314.89 L.
- Simulated branch with 1/3 of the sales: 28.58 ₺/L over 104.96 L.
- Americano M: 27.23 → 30.84. Ice Americano M: 29.78 → 36.98.

Each branch's sube COGS therefore carries the full water bill, so two branches together count about twice the bill. With the laffogato.net channel selected, or a branch that has no sales lines in any month with a water bill, listLiters is 0 and water costs 0 instead.

acknowledgePriceAlert and the updateProductPrice ack path write this branch-dependent cost into the business-wide PRICE_ACK. A dismissal made while a branch is selected stores an inflated threshold, so the alert stays hidden in Tümü until the real cost passes it.

INTENT: docs/SUBE.md says "Menü, reçete, hammadde ... Ortak". Denetim E-57 and SITE-SATIS.md:129 say the water bill covers all the café's water. No doc, plan or test makes the water price per liter branch-specific. tests/sube-maliyet.test.ts only says manual:su is business-wide, which is exactly why one bill must not be divided by one branch's liters.

### 5. AsilPOS geçiş günü şubesiz (tek ayar): Tuzla AsilPOS'a geçince Marina'nın ModPOS kasası da AsilPOS sayılır, föy çekimi, Kasa karşılaştırması ve satış listesi durur

- **Yer:** `src/server/modpos/sync.ts:165` (ayrıca: `src/server/data/modpos-day.ts:41`, `src/server/data/asilpos-day.ts:31`, `src/server/data/asilpos-day.ts:42`, `src/lib/asilpos/sales.ts:88`, `src/lib/asilpos/sales.ts:246`, `src/server/actions/sales.ts:158`, `src/lib/modpos/zil.ts:68`, `src/lib/calc/engine.ts:1018`, `src/lib/modpos/plan.ts:76`)
- **Senaryo:** Marina (Ayarlar › Şubeler: kasası ModPOS, kendi MODPOS_API_KEY_MARINA'sı var) açık. Yönetici Tuzla'nın AsilPOS'a geçişi için Ayarlar › AsilPOS'ta geçiş gününü 2026-12-01 yapar (ASILPOS.md'deki açılış sırasının 3. adımı). 1 Aralık'tan itibaren: (1) Sabah işi Marina'yı da `planFoyDays({..., until: switchDay})` ile planlar, Marina'nın 1 Aralık ve sonrası föyleri hiç çekilmez. (2) Marina'nın Kasa raporu `loadKasaAsilpos(date, db, 'marina')` → `{asilpos:true, day:null}` döner: form 'AsilPOS gün sonu (Z)' başlığıyla ve 'AsilPOS'un bu günün sonu gelmedi' metniyle açılır, ModPOS föy karşılaştırması `loadKasaModpos` → NO_MODPOS, zil ve e-postanın 'ModPOS'tan farklı' denetimi `modposMismatches` içinde atlanır; geç raporda ModPOS Z yerine yazarkasa Z fotoğrafı istenir (`kasaEvidence` → 'okc-z'). (3) Satışlar'da Marina'nın Aralık ModPOS listesi yüklenemez (`modposImportRule` → 'Aralık 2026 AsilPOS'tan geliyor; ModPOS listesi yüklenmez'), daha önce yüklenmiş liste de `mergeSalesSources` içinde düşer (`kept` filtresi). AsilPOS satırları yalnız Tuzla'da olduğundan Marina'nın Aralık ürün satışı, tüketimi ve reçeteye göre mal maliyeti sıfıra iner. (4) 'Tümü'de Marina'nın panelden girilen ürün ikramı, Tuzla'nın AsilPOS gün sonu gelen günlerde `panelWasteCounts` (yalnız tarihe bakar) tarafından sayılmaz.
- **Kanıt:** Geçiş günü tek bir ayar (`settings.asilposGecisGunu`, `loadAsilposSwitchDay(db)`) ve okuyan her yer şubeye bakmadan `isAsilposDay(day, switchDay)` kullanıyor. sync.ts:156 `loadAsilposSwitchDay(db)` her şubenin çalışmasında okunuyor, :165 `planFoyDays({ now, from, have, left, until: switchDay, failed })`. modpos-day.ts:41 `if (isAsilposDay(date, await loadAsilposSwitchDay(db))) return NO_MODPOS;` (branchId'ye bakmıyor). asilpos-day.ts:31 `if (!isAsilposDay(date, await loadAsilposSwitchDay(db))) return { asilpos: false, day: null };`. asilpos/sales.ts:88 `const kept = input.salesLines.filter((l) => modposListCounts(l.month, S));` ve :246 `if (src === "asilpos") return { ok: false, ... }` (importSales sales.ts:158'de şubesiz çağırıyor). zil.ts:68 `if (isAsilposDay(report.date, switchDay)) continue;`. engine.ts:1016-1018 `panelWasteCounts(w, asilposIkramDays)`: waste satırında şube yok. `branches.pos_source` yalnız `modposBranchIds`'te kullanılıyor, AsilPOS kararlarında hiç okunmuyor. SUBE.md: 'Marina'nın kasası ModPOS (Tuzla gibi)'.
- **Önerilen düzeltme:** Make "is this a AsilPOS day" depend on the branch as well as the date. Add a helper to src/lib/asilpos/switch.ts, for example `isAsilposBranchDay(day, switchDay, branchId, asilposBranches)`, that is true only if `isAsilposDay(day, switchDay)` holds and the branch's `pos_source` is 'asilpos' (for now that is `DEFAULT_BRANCH_ID`, since ingest writes only to tuzla). Then pass the branch through each of these places:

- src/server/modpos/sync.ts `runSync`: pass `until: switchDay` to `planFoyDays` only when the branch is a AsilPOS branch, otherwise `until: null`.
- src/server/data/modpos-day.ts `loadKasaModpos` / `loadKasaModposDays`: check with the given or resolved branch. In the range query, cut `end` only for AsilPOS branches.
- src/server/data/asilpos-day.ts `loadKasaAsilpos`, `loadKasaAsilposDays`, `kasaEvidence`: check with the branch. src/app/panel/kasa/page.tsx:260 should pass the till branch.
- src/lib/modpos/zil.ts `modposMismatches`: skip a report only if `report.branchId` is a AsilPOS branch.
- src/lib/asilpos/sales.ts:
  - `mergeSalesSources`: drop a ModPOS line only if its branch is a AsilPOS branch, using `kept` filtered on `l.branchId`. Do the same for the coverage records.
  - `modposImportRule`: take the write branch. Pass `currentWriteBranch()` from `importSales` in src/server/actions/sales.ts, and the same for `saveLine`.
- `panelWasteCounts` (src/lib/asilpos/ikram.ts) and the engine's `asilposIkramDays`: key by (branchId, date) instead of date only. This needs branchId on the dataset's waste rows.

Each reader gets its `asilposBranches` set from `listBranches()`.
- **Denetçi:** I could not refute it. The code path and the intent check both support the finding.

CODE PATH. There is one business-wide setting, `settings.asilposGecisGunu`, read by `loadAsilposSwitchDay(db)` in src/server/asilpos/status.ts:38. Every reader passes it straight to `isAsilposDay(day, switchDay)` (src/lib/asilpos/switch.ts), which takes no branch. `branches.pos_source` is read only in `modposBranchIds` (src/lib/modpos/sube.ts:162). `writeAsilposSwitchDay` in src/server/asilpos/admin.ts has no branch guard. I checked each effect the finding claims:

1. Sync: `runSync` in src/server/modpos/sync.ts:156/165 runs once per ModPOS branch, including Marina. It loads the switch day and calls `planFoyDays({..., until: switchDay})`. In src/lib/modpos/plan.ts:68, `add()` drops every day with d >= until. From the switch day on, the morning job never fetches Marina's föy (ModPOS cash sheet).
2. Kasa: src/app/panel/kasa/page.tsx:260 calls `loadKasaAsilpos(date)`, which falls back to `currentTillBranch()`, so Marina for a Marina-locked staff member or a Marina selection. That returns `{asilpos: true}` with `day` = null, because AsilPOS ingest writes only to `DEFAULT_BRANCH_ID` (src/server/asilpos/ingest.ts:82, comment: "Bugün yalnız Tuzla'da AsilPOS var"). The result is a AsilPOS form with no day-end. Also:
   - `loadKasaModpos` / `loadKasaModposDays` return `NO_MODPOS` without looking at the branch.
   - `kasaEvidence` returns "okc-z" (asks for the yazarkasa Z photo) instead of "modpos-z".
   - `modposMismatches` (src/lib/modpos/zil.ts:68) skips the comparison by date alone, so the zil (in-app alert) and e-mail "different from ModPOS" checks stop.
3. Sales: `importSales` (src/server/actions/sales.ts:158) applies `modposImportRule(month, switchDay, …)`, which takes no branch, so Marina's list for a full AsilPOS month is rejected. `mergeSalesSources` (src/lib/asilpos/sales.ts:88) filters out every ModPOS line of that month in all branches, including lists already uploaded. AsilPOS lines exist only for Tuzla, so Marina's sales, consumption and recipe-based cost of goods drop to zero.
4. Waste: `panelWasteCounts(w, asilposIkramDays)` (src/lib/asilpos/ikram.ts:62, called from src/lib/calc/engine.ts:1018) matches on date only. On days when Tuzla's AsilPOS day-end arrived, Marina's product ikram (complimentary items) entered in the panel is dropped.

INTENT. docs/SUBE.md's decision table says "Marina'nın kasası: ModPOS (Tuzla gibi)". The register has a per-branch `pos_source` (modpos / asilpos). docs/planlar/sube.md says that if AsilPOS is later installed in one branch, nothing should be left to do on the panel side. That is the opposite of a business-wide switch. docs/ASILPOS.md (written as if there were one till) makes setting the switch day step 3 of the opening sequence. Nothing in docs/*.md, docs/planlar/ or the tests accepts or asserts that the switch day also applies to a ModPOS branch. The only test that mixes Marina with these helpers (tests/bugun.test.ts) does not cover it.

The defect stays dormant until the admin sets the switch day, but that is the documented next step. After that it follows deterministically for any open ModPOS branch.

### 6. Gelir-gider: ciro, açık gün and month-note edits ignore the selected şube and always overwrite Tuzla's month row

- **Yer:** `src/server/actions/pnl.ts:101` (ayrıca: `src/server/actions/pnl.ts:74`, `src/server/actions/sales.ts:100`, `src/app/panel/gelir-gider/pnl-grid.tsx:762`, `src/server/db/schema.ts:302`, `src/lib/cash-month.ts:341`)
- **Senaryo:** The admin selects Marina on the left, opens Gelir-gider and types Kasım ciro = 250.000 ₺ into the 'AYLIK CİRO (KDV dahil – POS)' cell. This is the cell the page asks them to fill for a month whose kasa started mid-month (see finding 3). setMonthField inserts { month: '2026-11', posRevenue: 250000 } with no branchId, so the column default 'tuzla' is used, and ON CONFLICT (month, branch_id) updates Tuzla's row. After refresh, Marina's cell is still empty or kasa-derived, so the entry looks lost. Tuzla's November ciro is now 250.000 ₺, a manual value that overrides Tuzla's real kasa total. In Tümü, mergeMonthEntries keeps the first non-null manual value, so the business total also becomes 250.000 ₺ instead of Tuzla + Marina. That wrong number feeds Genel bakış, Gelir-gider, Vergi (yönetim verisi) and the Excel export. The 'Açık gün' row and the month-note dialog (setMonthNote) behave the same way. Selecting the laffogato.net channel also writes into Tuzla.
- **Kanıt:** pnl.ts setMonthField: `.insert(s.months).values({ month: m, [field]: v }).onConflictDoUpdate({ target: [s.months.month, s.months.branchId], ... })`. setMonthNote (line 74) does the same with `.values({ month: m, note: n })`. Neither passes branchId, and schema.ts:302 gives months.branchId `.default(DEFAULT_BRANCH_ID)` ('tuzla'). The Satışlar path does it correctly: sales.ts saveMonthInfo uses `.values({ ...data, branchId: await currentWriteBranch(), ... })`. The revenue row is `editable: true` in every branch view (engine.ts ~2393), and pnl-grid.tsx:762-779 calls setMonthField for both 'revenue' and 'openDays'. The row hint says it is the same data as Satışlar' ay bilgisi.
- **Önerilen düzeltme:** In src/server/actions/pnl.ts, import currentWriteBranch from "@/server/branch-scope" (the file already imports currentBranchScope from there). Then pass the branch in both inserts:
- setMonthNote: `.values({ month: m, branchId: await currentWriteBranch(), note: n })`
- setMonthField: `.values({ month: m, branchId: await currentWriteBranch(), [field]: v })`
Keep the existing conflict target [s.months.month, s.months.branchId]. This matches the rule saveMonthInfo uses in sales.ts: the selected şube, or Tuzla when Tümü is selected.
- **Denetçi:** I traced the code path and it holds. The Gelir-gider grid sends the 'revenue' and 'openDays' cells to setMonthField (pnl-grid.tsx:762-779), and MonthNoteDialog sends the month note to setMonthNote (pnl-grid.tsx:545). Both actions use requireAdmin, but neither one reads the şube selection. Their inserts are `.values({ month: m, [field]: v })` and `.values({ month: m, note: n })`, so months.branchId falls back to the column default 'tuzla' (schema.ts branchId(), DEFAULT_BRANCH_ID). ON CONFLICT (month, branch_id) then updates Tuzla's row.

Nothing upstream stops this. The 'revenue' row is `editable: true` without condition (engine.ts ~2393). Only the devir, personel and POS komisyonu rows depend on companyCell. The grid has no şube lock for these cells. setPnlCell has a şube guard, but it covers companyPnlKey keys only.

The read side is filtered by şube: dataset.ts:90 `branchWhere(s.months.branchId, scope)`. So with Marina selected, the cell keeps showing Marina's own row or the kasa value, and the entry seems lost. Tuzla's row now holds a manual ciro, açık gün or note that overrides its kasa value. Clearing a cell (null) in Marina view also clears Tuzla's field and leaves Marina's unchanged. In Tümü, resolveMonths/mergeMonthEntries (cash-month.ts:297) keeps the first non-null manual value, so the stray Tuzla value also replaces the combined kasa-derived ciro.

This contradicts the docs. docs/SUBE.md › Şube görünümünde maliyet says that with one şube selected, 'Ciro, kasa, ödenmez' come from 'Şubenin kasa raporları / ay satırı'. It also contradicts the Satışlar path for the same data: saveMonthInfo (sales.ts:101) writes `branchId: await currentWriteBranch()`. Both the row hint and the note dialog say this is the same field as in Satışlar.

I found nothing in docs/planlar that accepts this. sube.md only says the pnl.ts conflict targets were fixed to (month, branch_id); it says nothing about the inserted branchId. The only test guards are the onConflict target check in subeler.test.ts and the companyPnlKey check in sube-maliyet.test.ts, and neither asserts Tuzla-only writes.

### 7. Satışlar 'Ayı temizle' deletes every şube's sales list and manual ay bilgisi, not just the selected branch's

- **Yer:** `src/server/actions/sales.ts:569` (ayrıca: `src/server/actions/sales.ts:575`, `src/server/actions/sales.ts:178`, `src/app/panel/satislar/sales-client.tsx:1766`)
- **Senaryo:** Marina is selected, and Satışlar › Kasım shows Marina's 40 lines (the model is branch-filtered). The admin presses 'Ayı temizle' and the dialog says '40 satırı sil'. clearMonthSales runs `delete from sales_lines where month = '2026-11'` with no branch filter, so Tuzla's uploaded ModPOS list (e.g. 180 lines) is deleted too. The toast reports '220 satır silindi'. With 'ay bilgileri de' ticked, it also nulls the manual ciro, açık gün, indirim, ödenmez and note of every branch's months row. It wipes the global sales coverage for the month as well, so Tuzla's running-month list period is lost. Tuzla's net satış, brüt kâr, menu analysis and theoretical profit for November disappear without warning. The 'Yenisiyle değiştir' import path in the same file correctly deletes only the write branch's lines, so the two actions disagree.
- **Kanıt:** sales.ts:569 `db.delete(s.salesLines).where(eq(s.salesLines.month, m))`, :570 `setCoverage(db, m, null)`, :572-575 `db.update(s.months).set({ openDays: null, posRevenue: null, ... }).where(eq(s.months.month, m))`. Compare importSales replace (~:176-186): `.where(and(eq(s.salesLines.month, month), eq(s.salesLines.branchId, sube)))`, and dropEmptyMonth (~:61-63), which is scoped to `currentWriteBranch()`. The dialog count comes from the branch-filtered `lineCount` (sales-client.tsx:2106).
- **Önerilen düzeltme:** In src/server/actions/sales.ts › clearMonthSales, filter by the branch the page shows (the read scope):
  const where = andWhere(eq(s.salesLines.month, m), await currentBranchWhere(s.salesLines.branchId));
  const gone = await db.delete(s.salesLines).where(where).returning({ id: s.salesLines.id });
Use the same condition on the withInfo update:
  .where(andWhere(eq(s.months.month, m), await currentBranchWhere(s.months.branchId)))
Coverage is one key per month, not per branch, so clear it (`setCoverage(db, m, null)`) only when no `sales_lines` remain for that month in any branch. Otherwise a single-branch clear also drops the other branch's running-month list period. Optionally run it all in one transaction. When "Tümü" is selected, `currentBranchWhere` returns undefined, so the current behaviour of clearing every branch is kept, which matches the "Tümü" view.
- **Denetçi:** I traced the whole path and the bug is real. The Satışlar page uses `loadModel()`, which filters `sales_lines` and `months` by the selected branch (dataset.ts:90-91). So when Marina is selected, `lineCount` and `hasInfo` count only Marina's data, and the dialog shows that number. The ImportCard's "Ayı temizle" then calls `clearMonthSales(month, { withInfo })` (sales-client.tsx:1766). Its only guard is `requireAdmin()`, and there is no branch condition anywhere:
- sales.ts:569 deletes from `sales_lines` filtered only by `eq(month, m)`.
- sales.ts:570 clears the coverage entry, which is a single global key per month.
- sales.ts:572-575, when withInfo is ticked, nulls the manual fields of every branch's `months` row for that month.

So with Marina selected, the action also deletes Tuzla's ModPOS list and, if ticked, wipes Tuzla's manual ay bilgisi. The returned and logged count is the cross-branch total, so it doesn't match the number the dialog showed.

The same file is scoped correctly elsewhere: `importSales` replace (sales.ts:176-186), `dropEmptyMonth` (sales.ts:61-63) and `saveLine` all filter by `currentWriteBranch()`. The `sales_lines` and `months` keys are (month, branch_id) (schema.ts:312, 330-336; docs/planlar/sube.md). docs/SUBE.md › Neyi süzer lists "ay satırı" and "satış satırı" among the branch-filtered data and says the rule applies "ekranlar kadar sunucu eylemleri için de". Marina is planned to run ModPOS too (sube.md Dalga 4 / Kararlar), so both branches can have lists.

Nothing in docs/planlar or the tests says a branch-wide clear is intended. The only test that covers this code (satis-donemi.test.ts:83) checks just the `setCoverage(db, m, null)` call.

When "Tümü" is selected, clearing every branch matches what the screen shows, so the defect only happens with a single branch selected. It is still reachable by any admin, and it loses data.

### 8. The stock count draft key leaves out the branch, so one branch's unsaved counts are offered on another branch's count and saved there

- **Yer:** `src/app/panel/sayim/stock-form.tsx:1402` (ayrıca: `src/app/panel/sayim/page.tsx:151`, `src/server/actions/stock.ts:51`, `src/components/panel/branch-picker.tsx:76`, `src/app/panel/sayim/logic.ts:427`)
- **Senaryo:** An admin, or a staff member not locked to a branch, types about 40 counts into Tuzla's November count. The draft is written to localStorage as `laf:sayim-taslak:2026-11`. They then switch the sidebar branch picker to Marina, or close the tab and later open Marina's count on the same phone. The picker change goes straight to chooseBranchScope with no leave-guard prompt. StockCountForm remounts with key `marina:2026-11`, reads the same month-only draft key and shows 'Bu cihazda kaydedilmemiş 40 kalemlik sayım var · Kasım sayımı' with no branch named. Ingredient ids are shared between branches and Marina is still uncounted, so draftConflicts flags nothing. Pressing 'Geri yükle' and 'Kaydet' saves Tuzla's counts into Marina's stock_counts, because saveStockCounts takes the branch from the cookie via currentPhysicalBranch. Saving or 'Sil' then removes the draft, so Tuzla's unsaved work is lost too.
- **Kanıt:** stock-form.tsx:1402 `const draftKey = `laf:sayim-taslak:${month}`;` has no branch. page.tsx:151 remounts the form per branch: `key={`${branch.id}:${month}`}`. countDraftJson (sayim/logic.ts:427) stores no branch. server/actions/stock.ts:51 `const sube = (await currentPhysicalBranch()).id;`. branch-picker.tsx:76 `onChange={(e) => { ... run(() => chooseBranchScope({ scope: secim }) ...` bypasses useLeaveGuard, which only intercepts <a> clicks and the month event.
- **Önerilen düzeltme:** 1. In `src/app/panel/sayim/page.tsx`, pass the branch to the form: add `branchId={branch.id}` to `<StockCountForm>`.
2. In `src/app/panel/sayim/stock-form.tsx`, add `branchId: string` to the props and change line 1402 to ``const draftKey = `laf:sayim-taslak:${branchId}:${month}`;``.
3. Optional hardening: store the branch in the draft (`countDraftJson` / `parseCountDraft` in `sayim/logic.ts`) and ignore a draft whose branch differs. Also have `BranchPicker`'s onChange fire a cancelable leave event, as `CountMonthPicker` does with `MONTH_LEAVE`, so a form with unsaved changes asks before the branch switch.
- **Denetçi:** I traced the code path and it holds up.

1. **The draft key has no branch.** In `src/app/panel/sayim/stock-form.tsx:1402` the key is built from the month alone: ``const draftKey = `laf:sayim-taslak:${month}`;``. The saved draft (`countDraftJson`, `sayim/logic.ts:427`) holds values, prefilled, extras, base, extrasBase and the author, but no branch. `parseCountDraft` has no branch to check either.

2. **The form is rebuilt per branch.** `page.tsx` gets the branch from the cookie through `currentPhysicalBranch()` and mounts `StockCountForm` with ``key={`${branch.id}:${month}`}``. When the branch changes, a new form instance is created. Its `wroteDraft` and `openingDraft` refs start empty, and it reads the same month-only key. The old instance's effect has no cleanup, so Tuzla's draft is still in localStorage.

3. **The other branch picks up the draft.** Ingredient ids are global, so `draftEntries` keeps every id that exists in Marina's sheet, is not archived, and differs from Marina's saved value. If Marina is uncounted, that is all of them. The banner reads "Bu cihazda kaydedilmemiş N kalemlik sayım var" with "Kasım 2026 sayımı" and never names a branch.

4. **The conflict check does not catch it.** `draftConflicts` compares the draft's base with Marina's saved qty. Tuzla lines that were uncounted have base null, and Marina's are null too, so nothing is flagged.

5. **The save goes to the wrong branch.** `persist` → `saveStockCounts(month, {..., base: l.qty})`. Here `l.qty` is Marina's value (null), so the server's stale check passes. The server writes to `(await currentPhysicalBranch()).id`, which is Marina's id from the cookie (`stock.ts:51`).

6. **Tuzla's work is lost even without "Geri yükle".** Typing anything on Marina's form makes it dirty, and the effect then writes Marina's draft over the same key. Saving or pressing "Sil" removes the key.

7. **The branch picker skips the leave guard.** In `branch-picker.tsx` the onChange calls `chooseBranchScope` directly. `useLeaveGuard(dirty, MONTH_LEAVE)` only intercepts links and the month picker's event. Closing the tab and opening the other branch later reaches the same state anyway.

**Who can hit it:** an admin, or a staff member not locked to a branch. Staff locked to one branch can only ever see their own branch's draft.

**Intent check:** nothing marks this as intended.
- `docs/SUBE.md` says stock counts are kept separately per branch, keyed `(ay, şube, malzeme)`.
- The earlier audit's E-25 (`docs/planlar/denetim-2026-10-26.md`) flagged that the key carried no user, and the fix added the author's name. Nothing in it accepts a key without a branch, and `docs/planlar/sube.md` does not mention drafts.
- `tests/sayim-kayit.test.ts` only matches on the identifier `draftKey`, not on what the key contains, so a key with the branch in it would not break any test.

The data impact is real: one branch's closing stock lands in the other branch's `stock_counts`, or one branch's unsaved work is silently overwritten.

### 9. Backups taken before 0053 (before 4 Nov 2026) cannot be restored: migration 0056 adds branch FKs while the branches table is still empty

- **Yer:** `drizzle/0056_sube_kirilimi.sql:51` (ayrıca: `drizzle/0053_subeler.sql:1`, `drizzle/0057_sabit_gider_subesi.sql:8`, `src/server/backup/restore.ts:376`, `tests/yedek-geri-yukleme.test.ts:386`)
- **Senaryo:** The owner restores the monthly backup from late October (schema 0047 to 0052) with `npm run db:restore -- laffogato-yedek-2026-10-28-….json.gz`, either to an empty prova DB or with --sil on live. restoreBackup applies migrations up to the backup's version, loads the data (months, sales_lines, staff, cash_reports and so on all have rows), then applies the rest: 0053 creates an empty `branches` table, and 0056 adds `branch_id DEFAULT 'tuzla' NOT NULL` to months, cash_outs and the other tables, then runs `ADD CONSTRAINT … FOREIGN KEY (branch_id) REFERENCES branches(id)`. Postgres checks the existing rows, finds 'tuzla' missing from branches and throws a foreign key violation. The whole restore is rolled back. Every backup file from 22 Oct to 4 Nov 2026 is therefore unusable, which contradicts docs/YEDEK.md §4 ('Eski bir sürümle alınmış yedek… sonraki migration'lar veriden sonra uygulanır'). The same failure hits `db:migrate` on any pre-0053 database that holds data (for example a Neon branch restored to an earlier point), because the seed that adds branches runs only after migrations.
- **Kanıt:** 0053_subeler.sql only runs `CREATE TABLE "branches"` and inserts no row. 0056 step 2: `ALTER TABLE "months" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL;` Step 6 (line 56): `ALTER TABLE "months" ADD CONSTRAINT "months_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")`. The 'tuzla' row is first inserted in 0057 (`INSERT INTO "branches" … ('tuzla', …) ON CONFLICT DO NOTHING`), which runs after 0056. restore.ts applies the remaining migrations with `await applyMigrations(tx, rest)` after `insertRows`. The live DB only passed because PR #83 (0053 plus seed `branches_seeded`) was deployed before PR #87 (0056). The old-version restore test (tests/yedek-geri-yukleme.test.ts:386-399) inserts only categories, products, users and push_subscriptions, with no months, so it does not catch this.
- **Önerilen düzeltme:** In drizzle/0056_sube_kirilimi.sql, insert the default branch before step 6 (the foreign keys), for example right after step 3:
`INSERT INTO "branches" ("id", "name", "kind", "pos_source", "sort_order") VALUES ('tuzla', 'Tuzla', 'fiziksel', 'modpos', 1) ON CONFLICT ("id") DO NOTHING;`
These values pass branches_source_kind_ck because the branch is fiziksel with pos_source modpos. The statement can also go in 0053 right after CREATE TABLE. The live database is unaffected, because drizzle compares only created_at. Keep the 0057 insert, which is idempotent. In tests/yedek-geri-yukleme.test.ts, extend the old-version restore test so the old-schema source gets a months row (and ideally a staff row) before it is backed up. Then assert that the restore succeeds and the row ends up with branch_id 'tuzla'.
- **Denetçi:** I traced the restore path and could not refute the finding.

1. `restoreBackup` (src/server/backup/restore.ts) splits the migrations at the backup's schema version (`plan.upTo`). It applies the first group, loads the file's rows with `insertRows`, and then calls `applyMigrations(tx, rest)` inside the same transaction. Before that point nothing inserts a branch: the `src`, `scripts` and `lib/backup` code has no special case for `branches` or 'tuzla', and the seed (`branches_seeded`) only runs from predeploy after `migrate`.
2. 0053 only creates `branches` and its index. 0054 and 0055 do not touch it. 0056 step 2 adds `branch_id DEFAULT 'tuzla' NOT NULL` to months, sales_lines, staff, stock_counts, cash_reports, cash_outs, waste_entries, pos_daily_sales, pos_day_reports and modpos_cash_sheets. Step 6 then runs a plain `ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES branches(id)` with no NOT VALID. Postgres checks the existing rows and raises a foreign-key violation. The first 'tuzla' row appears only in 0057 line 8, which runs after 0056. The comment in 0057 shows the authors fixed the empty-database case but missed existing data at migration time.
3. All of these tables exist long before 0053: months, sales_lines, staff and stock_counts are in 0000, cash_reports in 0014, waste_entries in 0015 and cash_outs in 0025. Any real backup at schema 0052 or older therefore has rows in them (the Excel seed alone fills months, sales_lines and staff). Even a 0018–0046 backup with ingredients would hit it, because 0047 inserts a months row.
4. The whole restore is one `sql.begin` transaction, so it rolls back and the restore cannot complete. The same thing happens with `db:migrate` / predeploy on any pre-0053 database that holds data.
5. Intent: docs/YEDEK.md §4 step 2 says an old-version backup is loaded at its own version and the later migrations run after the data. §1 tells the owner to keep monthly backups, and §9 describes restore drills. Nothing in docs/planlar (sube.md, CRITIQUE*.md) or the tests accepts this limitation. The old-version test (tests/yedek-geri-yukleme.test.ts, the "eski sürümde alınmış yedek" test) only inserts categories, products, users and push_subscriptions. users.branch_id from 0058 is nullable with no default, and 0047's insert is guarded by `EXISTS (SELECT 1 FROM ingredients)`, so the test never reaches the failing path.
6. Editing 0056 is safe for databases that are already migrated: drizzle's migrator and verifyMigrations / migrationReport decide by created_at (folderMillis), not by file hash, and no test pins migration hashes.

### 10. Staff locked to one branch can still open and fill (and upload photos to) the other branch's checklist

- **Yer:** `src/server/checklists/store.ts:472` (ayrıca: `src/server/checklists/store.ts:612`, `src/app/panel/kontrol/[id]/page.tsx:54`, `src/app/api/kontrol/foto/route.ts:55`, `src/server/data/checklists.ts:62`, `src/lib/checklists.ts:641`)
- **Senaryo:** Ayşe's account is set to Marina (users.branch_id='marina'), so her panel is locked to Marina. Bugün, the bell and Geçmiş only show Marina lists and lists with no branch, which is correct. But if she opens /panel/kontrol/<id of Tuzla's 'Tuvalet çizelgesi' or 'Açılış'> (ids are small sequential integers; a link could also be shared or come from a session another user left open on a tablet), the page loads that list with all of today's answers, names and notes. She can then sign items, enter temperatures and upload photos to it. Tuzla's record then holds entries from someone who was not at Tuzla. Her answers also count toward completion and can stop Tuzla's 'gecikti' bell and e-mail alerts.
- **Kanıt:** docs/KONTROL-LISTELERI.md › Şubeler: "Şubesi belirlenmiş personel ... yalnız o şubenin ve bütün şubelerin listelerini görür ve doldurur." docs/SUBE.md: "Kasa raporu, kasadan çıkan, zayi ve kontrol listeleri o şubeye yazılır ve o şubeden okunur." Only the listing paths apply the branch scope (loadTemplates gets `branch` through listCtxOf). The fill paths check only role and staffAllowed: writeAnswer has `if (me.role !== "admin" && !tpl.staffAllowed) throw ...` and no tpl.branchId check. checkPhotoTarget (store.ts:612-617) is the same. RunContent in src/app/panel/kontrol/[id]/page.tsx:54-56 calls loadRunView(tid, today, now), which uses ctxOf(now) with no branch, then only does `if (!admin && !view.template.staffAllowed) redirect(...)`. The proxy and requireUser do not check branch either. kontrolPhotoRules/photoAccess (src/lib/checklists.ts:641) also ignore branch, so /api/foto/<id> shows the other branch's checklist photos to that staff member.
- **Önerilen düzeltme:** Enforce the staff branch lock on the three entry points, using the rule the lists already use (the list's branch is empty or equals the lock):

1. src/server/checklists/store.ts: give `Me` (or WriteDeps) an optional field `lock: string | null`. In writeAnswer, after the staffAllowed check, and in checkPhotoTarget, add:
   `if (me.role !== "admin" && me.lock && tpl.branchId && tpl.branchId !== me.lock) throw new ChecklistError("Bu liste başka şubenin.", 403);`

2. src/server/data/checklists.ts: in writeChecklistAnswer and checkPhotoTarget, set `lock: await staffBranchLock()` from src/server/branch-scope.ts. This makes both functions async. Their callers already await them.

3. src/app/panel/kontrol/[id]/page.tsx RunContent: after loadRunView, add `const lock = admin ? null : await staffBranchLock(); if (lock && view.template.branchId && view.template.branchId !== lock) redirect("/panel/kontrol");`

4. Optionally return the template's branchId from store.photoRun and give photoAccess the same check (pass the lock from kontrolPhotoRules.canView), so /api/foto/<id> does not show the other branch's checklist photos to locked staff.
- **Denetçi:** Confirmed by tracing the code. The docs say a staff member locked to one branch sees and fills only that branch's lists and the all-branch lists (docs/KONTROL-LISTELERI.md › Şubeler: "yalnız o şubenin ve bütün şubelerin listelerini görür ve doldurur"; docs/SUBE.md:162-164). Only the listing paths enforce this. They go through listCtxOf, which uses currentBranchScope (locked), and then loadTemplates({branch}).

The paths that open and fill a list ignore the branch:
- RunContent (src/app/panel/kontrol/[id]/page.tsx:46-56): requireUser, then loadRunView(tid, ...). loadRunView (src/server/data/checklists.ts:62-64) uses ctxOf(now), which has no branch. store.loadRunView (store.ts:316) calls loadTemplates with ids only. The page's only guard is `!admin && !view.template.staffAllowed`.
- answerChecklistItem (src/server/actions/checklists.ts:49-57): requireUser, then writeChecklistAnswer, then store.writeAnswer. The only checks (store.ts:470-473) are active, staffAllowed and date. There is no tpl.branchId check.
- POST /api/kontrol/foto: getCurrentUser, then checkPhotoTarget (store.ts:612-627) with the same checks and no branch, then writeChecklistAnswer.
- src/proxy.ts and dal.ts have no branch check. staffBranchLock() is used only in chooseBranchScope. photoRun and photoAccess do not consider branch either.

Nothing in the tests or docs/planlar accepts this. The only branch test (kontrol-listeleri-db.test.ts:285) covers listing only. The branch-scope.ts comment "Seçim veriyi süzer, YETKİ VERMEZ" ("the selection filters data, it grants no authority") is about the free picker. The staff lock is deliberately enforced on the server in chooseBranchScope, so it is a real restriction and not just a UI filter.

Example: a staff member locked to Marina opens /panel/kontrol/<Tuzla template id>. Ids are small integers, or the link may have been shared. The page shows Tuzla's answers and lets her answer, sign and upload photos. Her answers are written to Tuzla's run and can complete it, which stops Tuzla's 'gecikti' bell and e-mail alerts.

Why confidence is medium and not high: the normal UI never links to another branch's list, so she has to open the URL on purpose or follow a shared link. It is still a documented authorization rule that the server never checks.

### 11. Nakit planı günlük satış: yeni açılan ya da eksik raporlu şubenin cirosu 28 güne yayılıyor (Tümü'de düşük tahmin)

- **Yer:** `src/lib/cash-plan.ts:760` (ayrıca: `src/server/data/cash-plan.ts:134`, `src/lib/cash-plan.ts:767`)
- **Senaryo:** Marina started reporting in November. In the last 28 days Tuzla has 28 reports at 10,000 TL and Marina has 7 reports at 6,000 TL. days = 28 distinct dates, so daily = (280,000 + 42,000) / 28 = 11,500 TL. The business's real going-forward daily sales are 16,000 TL. The plan under-forecasts incoming money by about 4,500 TL a day, about 190k TL over 6 weeks. firstNegative / "para yetmeyebilir" then shows up early or falsely on the Nakit planı page, the Genel bakış card, the weekly summary and Claude's odemeler. The same dilution happens whenever one branch is closed or misses its report on some days: that day counts as a full business day with only one branch's sales.
- **Kanıt:** `const days = new Set(reports.map((r) => r.date)).size; ... daily: z / days` where z is the sum of both branches' Z totals. loadCashPlan passes `cashReports: reports.map((r) => ({ date, zTotal, card, mealCard, online }))`, dropping branchId, so the plan cannot average per branch. The tests only cover two branches reporting on the same 10 days.
- **Önerilen düzeltme:** 1. src/server/data/cash-plan.ts (loadCashPlan): keep the branch in each row: cashReports: reports.map(r => ({ branchId: r.branchId, date, zTotal, card, mealCard, online })). Add an optional branchId to the cashReports input type.
2. src/lib/cash-plan.ts (buildCashPlan, sales block around lines 757-765): group the filtered reports by branchId, with a missing branchId treated as one group. Set daily = Σ_b (Z_b / distinctDays_b), where the sum runs over branches with at least one report. For a single branch this is the same as today. Keep the MIN_SALES_REPORTS check on the overall distinct days, or on each branch's days. Keep cardShare and platformShare as total card or platform ÷ total Z. Store per-branch day counts in basis.sales if the note needs them.
3. Update the planNotes sales text (around line 1781), for example "Tuzla 28 gün, Marina 10 gün; şube ortalamalarının toplamı", and update docs/NAKIT-PLANI.md:18 to match.
4. Add a test case to tests/nakit-plani.test.ts: Tuzla reports on 28 days and Marina on 7 days, and daily should equal TuzlaAvg + MarinaAvg.
- **Denetçi:** I traced the code path and found nothing that blocks it. The Nakit planı page (src/app/panel/hatirlaticilar/nakit/page.tsx), the Genel bakış card (src/app/panel/page.tsx:210), the weekly summary (src/server/weekly/collect.ts:94) and the MCP tool (src/server/mcp/tools.ts:143) all call loadCashPlan under ALL_BRANCHES scope. So cashReportsBetween (src/server/data/cash-reports.ts:159) returns both branches' reports for the last 28 days. loadCashPlan (src/server/data/cash-plan.ts:134) maps them to { date, zTotal, card, mealCard, online } and drops branchId. buildCashPlan (src/lib/cash-plan.ts:757-765) then uses days = the number of distinct dates and daily = the summed Z of both branches ÷ days. A day on which only one branch reported still counts as a full business day. The sum is therefore diluted whenever one branch reports on fewer days than the other. That happens with a newly opened branch, a missed report or one branch closing for a day.

The scenario is happening now. docs/SUBE.md says branch support began on 4 Nov 2026. Marina's checklists were seeded on 16 Nov. Today is 21 Nov, so the 28-day window (24 Oct to 20 Nov) holds about 28 Tuzla days but only a fraction of that for Marina. Marina's contribution to the daily sales figure is scaled down by about reportedDays/28. This understates salesPerDay, so the plan can show a first negative day too early or a false "para yetmeyebilir" warning.

On intent: commit df1b07c switched to dividing by distinct days only to fix halving when both branches report on the same day ("iki şubede yarıya düşüyordu"). Its test (tests/nakit-plani.test.ts:1869) covers only the case where both branches report on the same 10 days. Nothing in docs/*.md or docs/planlar accepts the staggered case. docs/NAKIT-PLANI.md:18 still describes the single-branch rule (Z ÷ number of reports), which gives the correct per-till average. The current code gives a different number as soon as the branches' reported days differ. branches.opened_on exists but the plan does not read it.

### 12. Kasa raporu ve kasadan çıkan, formun gösterdiği şubeye değil gönderim anındaki çereze yazılıyor

- **Yer:** `src/server/cash/report-store.ts:426` (ayrıca: `src/server/cash-outs/write.ts:172`, `src/app/panel/kasa/page.tsx:383`, `src/server/actions/branches.ts:139`)
- **Senaryo:** The admin (or an unlocked staff member) has Kasa open in tab A for Tuzla, with no report yet for the day (form revision 0). In tab B they switch the picker to Marina. chooseBranchScope rewrites the shared laf_sube cookie, and refresh() only refreshes tab B. Back in tab A, the admin submits Tuzla's figures. saveCashReport takes `branchId = await currentTillBranch()`, which is now Marina, and inserts a Marina report with Tuzla's Z, cash and card. The only guard is the opening carry check: if the opening happens to match or a note is written, the save goes through. A new kasadan çıkan line has no such guard: writeCashOut uses `branchId: o.branchId ?? (await currentTillBranch())`, so it lands in Marina's till and changes Marina's report math. The same happens within one tab: switching the picker while a no-report form is half filled keeps the typed values, because the CashForm key `${date}:${revision}` is unchanged, and the next submit writes them to the new branch.
- **Kanıt:** report-store.ts:426 `const branchId = await currentTillBranch();` with the comment "Raporun şubesi: panelde seçili olan". reportSchema / submitCashReport carry no branch. cash-outs/write.ts:172 inserts with `branchId: o.branchId ?? (await currentTillBranch())`. The form is keyed only by `${date}:${report?.revision ?? 0}` (kasa/page.tsx), so a branch switch does not remount it.
- **Önerilen düzeltme:** 1. src/app/panel/kasa/page.tsx: pass the till the page rendered (`till` / view.branch.id) into CashForm and CashOutsCard as a `branchId` prop. Also add it to the CashForm key: `${till}:${date}:${report?.revision ?? 0}`.
2. Add an optional `branchId` field to reportSchema (src/server/actions/cash-report.ts) and to the input of saveCashOut (src/server/actions/cash-outs.ts). The client sends it on submit and on new-line add.
3. On the server, in saveCashReport and in persist for new lines: `const till = await currentTillBranch(); if (input.branchId && input.branchId !== till) throw new UserError("Şube seçimi başka bir sekmede değişti; sayfayı yenileyin");`.
   - Alternative: accept `knownBranchId(input.branchId, branches)` and, for staff, also require it to equal `staffBranchLock()` when that is non-null.
   - Rejecting is the minimal safe choice. It keeps the 'seçili şube' (selected branch) rule and stops the silent misfile.
4. Late-report submit and the staff cash-out request path (src/server/cash/late.ts:60, src/server/cash-outs/requests.ts:129) also read currentTillBranch at submit time and should get the same check.
- **Denetçi:** The two-tab scenario is real and traced end to end. The same-tab part is weak.

Code path:
- The picker calls chooseBranchScope, which overwrites the shared `laf_sube` cookie and only runs refresh() for the calling tab. No cross-tab sync exists: no BroadcastChannel, and no visibilitychange listener that reloads the branch.
- submitCashReport's reportSchema carries no branch. saveCashReport (report-store.ts:426) takes `branchId = await currentTillBranch()`, which reads the cookie at submit time.
- saveCashOut → persist → writeCashOut passes no branchId for a new line, so write.ts:172 inserts with `o.branchId ?? (await currentTillBranch())`.
- Result: tab A rendered Tuzla's till, tab B switched the cookie to Marina, and tab A's submit writes to Marina. The e-mail and WhatsApp text then go out as Marina's report.

Guards that exist but do not close it:
- Report save:
  - assertRevision blocks it only when Marina's revision for that day differs from the one the form carries.
  - writeCashReport's carry check blocks it only when the opening differs from Marina's carry and the note is empty.
  - Otherwise it goes through: Marina has no prior report, the amounts match, or a note is present. In edit mode with equal revisions (both 1) and a note, Tuzla's figures overwrite Marina's existing report as a new revision.
- New cash-out line: no guard at all. It silently lands in Marina's till, Marina's expense and Marina's report math.
- Staff locked to a branch are not affected. Only the admin and unlocked staff are.

Intent:
- docs/SUBE.md makes the cookie the single source of the selection and says kasa writes go to the selected branch. Nothing in docs, plans or tests accepts stale-tab writes.
- The code states the opposite goal. branch-scope.ts says the page reads with currentTillBranch "ki form gösterdiği kasaya yazsın" (so the form writes to the till it shows). The kasa page comment and SUBE.md list "Marina'nın raporu görünürken kayıt Tuzla'ya iniyordu" (Marina's report was showing while the save went to Tuzla) as a bug they fixed. This is the same class of bug.
- knownBranchId exists for exactly this check but has no callers.

Caveats:
- The same-tab part (picker switched while a half-filled form stays mounted) writes to the branch the page then shows: TillBadge updates, and the client-side carry check asks for a note when the opening differs. That part is a form-reset glitch, not a write to the wrong branch.
- Every cookie-scoped write in the panel has the same stale-tab limit. Kasa matters most because the comment above promises form = till.
- Severity is closer to low-medium: it needs two tabs, and the report path is partly guarded. The cash-out path is not guarded.

### 13. Zayi gün kilidi (wasteLock) şubeye bakmıyor: iki şube rapor girince dün personele hiç kapanmıyor, ya da başka şubenin raporu günü kapatıyor

- **Yer:** `src/server/waste/core.ts:64` (ayrıca: `src/server/photo-read/rules.ts:29`, `src/app/panel/zayi/page.tsx:94`, `src/lib/waste-requests.ts:34`)
- **Senaryo:** Bugün 21 Kasım. Tuzla ve Marina 20 Kasım raporunu girdi, 23:30'da ikisi de 21 Kasım raporunu da girdi. wasteLock('2026-11-20') şubesiz sorgu yapıyor: `where date >= '2026-11-20' order by date limit 2`. Sonuç iki tane 20 Kasım satırı, yani laterReport=false. staffWasteMode bu yüzden 'direct' dönüyor (çalıştırdım: {hasReport:true, laterReport:false} -> direct). Sonuç: Marina personeli 05:00'e kadar kilitli dünün zayisini onaysız ekleyip kendi kaydını silebiliyor. Aynı gün kasadan çıkan kapısı (staffDayOpen, şubeye göre) o günü kapalı sayıyor. Ters durum da var: Marina 20 Kasım raporunu unuttu, Tuzla 20 ve 21 Kasım'ı girdi. Sorgu [20 (tuzla), 21] döndüğü için Marina personelinin dünü kilitlenir ve personel geç kayıt isteğine itilir. Oysa Marina'nın kasası o gün hâlâ açık.
- **Kanıt:** core.ts:65 `db.select({ date: s.cashReports.date }).from(s.cashReports).where(gte(s.cashReports.date, date)).orderBy(asc(s.cashReports.date)).limit(2)` sorgusunda branchId koşulu yok. addWaste (93), removeWaste (119), proposeLateWaste (141), proposeWasteDelete (198) ve zayi sayfası (page.tsx:94) bunu kullanıyor. Kasadaki eşi photo-read/rules.ts:31-36 staffDayOpen ise `eq(s.cashReports.branchId, sube)` ile süzüyor (1c9dbb3 commit'inde şubeye taşındı, wasteLock unutulmuş). docs/SUBE.md: 'Personelin yetkisi (günü hâlâ düzenleyebilir mi…): başka şubenin raporu bu şubenin gününü açmaz ya da kapatmaz'. ZAYI-IKRAM.md: 'dünün raporu da bugünün raporu da girildiyse dün kapanır'.
- **Önerilen düzeltme:** Give src/server/waste/core.ts `wasteLock(db, date, branchId: string)` a branch condition: `.where(and(gte(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))`.

Callers:
- addWaste: compute `const branchId = (await currentPhysicalBranch()).id` before the staff check, pass it to wasteLock and reuse it for the insert.
- proposeLateWaste: pass `(await currentPhysicalBranch()).id`, the same value it stores in payload.branchId.
- removeWaste and proposeWasteDelete: pass `row.branchId`, the branch of the entry itself.
- src/app/panel/zayi/page.tsx:94: call `wasteLock(getDb(), date, await currentTillBranch())`. For delete modes on per-entry rows, the entry's own branchId would be strictly correct; staff are locked to one branch, so the till branch is enough.

Update the source-shape regexes in tests/zayi-ikram.test.ts:141-142 to the new signature.
- **Denetçi:** The code path is as the finding says. src/server/waste/core.ts:64-66 `wasteLock` runs `select date from cash_reports where date >= D order by date limit 2` with no branch condition. Every staff path goes through it with no other branch guard: addWaste (93), removeWaste (119), proposeLateWaste (141), proposeWasteDelete (198) and the staff mode on /panel/zayi (page.tsx:94). The schema allows one report per (date, branch) (`cash_reports_date_uq` on date, branchId), so two branches can each have a report for D.

Case 1: Tuzla and Marina both have D-1 reports. Then the first two rows are both D-1, so `laterReport` is false and `staffWasteMode` returns "direct" even after both branches enter today's report. Staff can still add, or delete their own, yesterday's waste with no approval until 05:00. The cash page and staffDayOpen (src/server/photo-read/rules.ts:29-40, filtered by `eq(cashReports.branchId, sube)`) treat that day as closed.

Case 2: Marina has no D-1 report, but Tuzla has D-1 and D. Then rows are [D-1 Tuzla, D], so Marina's yesterday shows as locked and staff are pushed to a late request. The docs say a forgotten day with no report stays open.

Intent: ZAYI-IKRAM.md says the waste lock follows the cash register's rule, `staffDayEditable`, and that a forgotten yesterday with no report stays open. docs/SUBE.md (commit 1c9dbb3) says staff permission is per branch: another branch's report neither opens nor closes this branch's day (`staffDayOpen`, `staffLateDayOpen`). That commit moved the cash-side checks to per-branch and missed wasteLock. Nothing in docs/planlar accepts a branch-agnostic waste lock. tests/zayi-ikram.test.ts:141-142 only check that the staff gate calls wasteLock (source shape), not that it ignores the branch. tests/zayi-istek.test.ts tests the pure mode function with hand-made lock objects.

Impact: two screens disagree about the same day, and staff can add or remove yesterday's waste without approval after the till is locked. That waste is part of the day's cash report summary.

### 14. Staff locked to one branch can still edit, delete or view another branch's records by passing that record's ID

- **Yer:** `src/server/cash-outs/guard.ts:47` (ayrıca: `src/server/actions/cash-outs.ts:76`, `src/server/photo-read/rules.ts:46`, `src/server/checklists/store.ts:467`, `src/app/api/foto/[id]/route.ts:31`, `src/server/branch-scope.ts:62`, `docs/SUBE.md:162`)
- **Senaryo:** Two branches are open: Tuzla and Marina. A staff account is locked to Tuzla (users.branchId='tuzla'). (1) The person calls the server action deleteCashOut(<Marina cash_outs.id>) or saveCashOut({id: <Marina id>, amount: …}) for today's or yesterday's Marina cash-out row. staffCashOutGate runs staffDayOpen(date, tx, now, row.branchId) against Marina's till, the Marina day is open, and the result is 'direct', so the Marina row is deleted or changed. (2) GET /api/foto/<Marina Z photo id> works the same way: cashPhotoRules.canView calls staffDayOpen(row.date, …, row.branchId='marina') and returns true, so the Tuzla-locked person sees Marina's Z report photo. (3) answerChecklistItem or /api/kontrol/foto with a Marina-only templateId: writeAnswer checks only tpl.active, tpl.staffAllowed and the day, never tpl.branchId, so the person writes answers into Marina's checklist. IDs are sequential integers, and the action IDs are in the client bundle. The branch lock only filters what the screens show. docs/SUBE.md says these records are written to and read from that branch only.
- **Kanıt:** src/server/branch-scope.ts lockedBranch() is used only to choose the scope: `const chosen = locked ?? fromUrl ?? cookie`. No action or route compares a row's branch with me.branchId. Running `grep -rn "me.branchId\|user.branchId"` finds only branches.ts (chooseBranchScope) and checklist-alerts. guard.ts: `staffDayOpen(date, tx, now, target.op === "ekle" ? undefined : target.row.branchId)` opens the other branch's day for an existing row, and cashOutNeedsApproval has no ownership or branch check. photo-read/rules.ts cashPhotoRules.canView: `return Boolean(row && (await staffDayOpen(row.date, undefined, undefined, row.branchId)))`. checklists/store.ts writeAnswer: `if (me.role !== "admin" && !tpl.staffAllowed) throw …` and nothing compares tpl.branchId. docs/SUBE.md › Personel hesabının şubesi: "Kasa raporu, kasadan çıkan, zayi ve kontrol listeleri o şubeye yazılır ve o şubeden okunur."
- **Önerilen düzeltme:** Add one helper in `src/server/branch-scope.ts`, e.g. `export async function staffOtherBranch(me: { role: string }, branchId: string | null): Promise<boolean>`. It returns true when `me.role === "staff"`, `staffBranchLock()` is non-null and `branchId` is non-null and differs from that lock. Use it in these places:
1. `src/server/cash-outs/guard.ts` `staffCashOutGate`: for every op other than `ekle` (which covers save, delete, receipt and request), throw `new UserError("Satır bulunamadı; silinmiş olabilir")` when `target.row.branchId` is another branch.
2. `src/server/photo-read/rules.ts` `cashPhotoRules.canView` and `receiptPhotoRules.canView`: return false when `row.branchId` is another branch. `okcPhotoRules` spreads `cashPhotoRules`, so it is covered too.
3. Checklists:
   - Pass the user's branch lock into `store.writeAnswer` and `store.checkPhotoTarget` (`src/server/checklists/store.ts`), for example by extending `Me` with `branchLock: string | null` set by `writeChecklistAnswer`/`checkPhotoTarget` in `src/server/data/checklists.ts`.
   - Throw `ChecklistError("Liste bulunamadı.", 404)` when `tpl.branchId !== null && tpl.branchId !== branchLock`.
   - In `src/app/panel/kontrol/[id]/page.tsx`, call `notFound()` under the same condition.
   - Apply the same check in the kontrol photo view rule.
- **Denetçi:** The finding is real. I found no guard anywhere on the path that compares a record's branch with the staff member's locked branch.

**Code path**
- **Where the lock is used:** `lockedBranch`/`staffBranchLock` (`src/server/branch-scope.ts:62-71`) only pick the read scope and the scope used for new writes. Outside those, the only server-side use is in `chooseBranchScope` (`src/server/actions/branches.ts:145`), which only refuses changing the selection.
- **Cash-outs:** `saveCashOut` → `persist` → `staffCashOutGate`, and `deleteCashOut` → `staffCashOutGate` (`src/server/actions/cash-outs.ts:47-52`, `76-80`). The gate calls `staffDayOpen(date, tx, now, target.row.branchId)` (`src/server/cash-outs/guard.ts:47`), which checks the day against the other branch's own till. Nothing compares `row.branchId` with the user's branch. So a Tuzla-locked staff member can edit or delete a Marina row whose day is still open.
- **Photos:** `GET /api/foto/[id]` → `canViewPhoto`. Both `cashPhotoRules.canView` and `receiptPhotoRules.canView` (`src/server/photo-read/rules.ts:44-66`) only ask `staffDayOpen(row.date, …, row.branchId)`. The other branch's Z report and receipt photos are therefore visible while that branch's day is open.
- **Checklists:** `writeAnswer` (`src/server/checklists/store.ts:460-470`) checks only `active`, `staffAllowed` and the day. Its `Me` type does not even carry `branchId`. The page `/panel/kontrol/[id]` → `loadRunView` (`src/app/panel/kontrol/[id]/page.tsx`) checks only `staffAllowed`. So a locked staff member does not even need to call a server action by hand: typing `/panel/kontrol/<Marina template id>` in the browser opens Marina's list and lets them fill it.

**Intent**
- `docs/SUBE.md:162-164` says that for staff with a branch, "Kasa raporu, kasadan çıkan, zayi ve kontrol listeleri o şubeye yazılır ve o şubeden okunur" (written to and read from that branch).
- `docs/KONTROL-LISTELERI.md:72-73` says the person "yalnız o şubenin ve bütün şubelerin listelerini görür ve doldurur" (sees and fills only that branch's lists and the all-branches lists).
- Nothing in `docs/planlar/` accepts cross-branch access by ID. The "Seçim … YETKİ VERMEZ" comments are about the branch selector not granting rights; they do not say the staff lock is display-only.
- I found no test asserting cross-branch access is allowed. The existing tests only cover how lists are filtered for display.

**Limits**
- The cash-out and photo cases only work while the other branch's day is open (today, or yesterday until its next report). Rows linked to a supplier payment or in an admin category still go through the request or locked rules.
- Waste deletion was not traced; staff appear limited to their own records there.

### 15. Snoozing a recurring personal reminder by an hour permanently moves the time of every later occurrence

- **Yer:** `src/server/actions/user-reminders.ts:178` (ayrıca: `src/lib/user-reminders.ts:92`, `src/server/actions/user-reminders.ts:132`, `src/components/panel/live/reminder-alerts.tsx:1`)
- **Senaryo:** Daily reminder 'Kasayı aç' at 09:00 (repeat=daily, anchorDate 2026-11-21). At 09:02 the user taps '1 saat sonra hatirlat' in the popup. postponeTarget returns {dueDate:'2026-11-21', dueTime:'10:05'} and that is written to the row. At 10:06 the user taps 'Yaptim'. completeUserReminder only advances dueDate, so the reminder now rings every day at 10:05. Each further snooze pushes it another hour. I reproduced this with the pure functions: after the snooze and completion the next occurrence is {dueDate:'2026-11-22', dueTime:'10:05'}. A snooze at 23:31 moves the series to 00:35 the same way. The docs say a postponed recurring reminder keeps its anchor ('ertelense de capa gunu korunur'), but the clock time has no anchor at all.
- **Kanıt:** postponeUserReminder: `const target = postponeTarget(r, step, new Date()); await db.update(s.userReminders).set({ ...target, updatedAt: new Date() })`. postponeTarget 'hour' returns `{ dueDate: at.date, dueTime: at.time }` (src/lib/user-reminders.ts:97). completeUserReminder sets only `{ dueDate: next, doneAt, updatedAt }` (line 132), so dueTime is never restored. The schema has anchorDate but no anchor time.
- **Önerilen düzeltme:** Store the series time separately:
1. Add a nullable anchor_time text column to userReminders (src/server/db/schema.ts, with a migration).
2. In saveUserReminder (src/server/actions/user-reminders.ts), set anchorTime = data.dueTime on both insert and update.
3. In completeUserReminder, restore the time when the series advances: `.set(next ? { dueDate: next, dueTime: r.anchorTime ?? r.dueTime, doneAt: new Date(), updatedAt: new Date() } : {...})`.
4. Leave postponeUserReminder writing only dueDate and dueTime. It does not touch anchorTime, so the "hour" snooze affects only the current occurrence.
5. "Geri al" needs no change: restoreUserReminder writes dueTime from the snapshot, and anchorTime is never changed by a postpone.

Existing rows can be backfilled with anchor_time = due_time.
- **Denetçi:** I traced the code and the drift is real. I could find nothing that marks it as intended.

How the code reaches it:
- Callers: the popup (src/components/panel/live/reminder-alerts.tsx:161) and the list's "1 saat ertele" (my-reminders.tsx:71, offered only when the reminder has a time) both call postponeUserReminder(id, "hour").
- postponeUserReminder (src/server/actions/user-reminders.ts:177-178) writes the result of postponeTarget into the row. For "hour", postponeTarget returns {dueDate: at.date, dueTime: at.time} (src/lib/user-reminders.ts:95-97), so the stored dueTime is overwritten with the snoozed time.
- completeUserReminder ("Yaptım" in the popup, the list and /panel/bugun) writes only {dueDate: next, doneAt, updatedAt} (line 132). It never restores dueTime.
- The user_reminders schema (src/server/db/schema.ts:1149-1154) has anchorDate but no anchor time, so nothing can put the original time back.
- restoreUserReminder ("Geri al") only works from the toast right after the snooze.

Result: a daily 09:00 reminder snoozed once at 09:02 becomes 10:05, and after "Yaptım" every later occurrence rings at 10:05. Each further snooze moves it again. A snooze near midnight (23:31 -> 00:35 the next day) also moves the date, so the next occurrence lands at 00:35.

Intent check:
- docs/BILDIRIMLER.md:394 says "ertelense de çapa günü korunur": the series keeps its anchor day when a reminder is postponed.
- The postponeTarget comment says "Tekrarın çapası değişmez; sıradaki dönem çapaya göre hesaplanır": the series anchor does not change and the next occurrence is computed from it.
- docs/HATIRLATICILAR.md:51 describes "1 saat sonra hatırlat" as ringing again in an hour for this occurrence.
- Taken together, postponing is meant to affect only the current occurrence, not the series.
- No test asserts that the time carries over after completion. The tests (hatirlaticilarim.test.ts:66-73, 174-177) cover only postponeTarget's output and the corner card.
- docs/planlar does not accept this behaviour. KALAN-ISLER even lists Hatırlatıcılarım as an area the audit never read.

### 16. Stock-count push and the morning e-mail's past-month count line only check Tuzla's count, never Marina's

- **Yer:** `src/server/data/count-progress.ts:20` (ayrıca: `src/server/notify/count-push.ts:18`, `src/server/bell/ops.ts:229`, `src/server/branch-scope.ts:144`)
- **Senaryo:** The cron (/api/cron/gunluk) has no branch cookie and no user, so currentBranchScope() gives 'hepsi' and currentPhysicalBranch() falls back to Tuzla. On 1 December: Tuzla's November count is 72/72, Marina's is 10/72. pastCountDigestLines -> countProgress('2026-11') sees Tuzla only, so the morning e-mail to admins and the accountant says nothing about the half-finished count. Marina's uncounted items are then 0 in the 'Tumu' closing stock and November COGS is inflated. On the last day of the month, pushMonthEndCount sends Tuzla's progress ('kalan 42 kalemi sayin (30/72)') to every device, Marina staff included, or sends nothing at all when Tuzla is already done and Marina is not. Stock counts are kept per branch (docs/SUBE.md: 'Stok ve sayim: Sube basina ayri').
- **Kanıt:** count-progress.ts:20 `const sube = eq(sc.branchId, (await currentPhysicalBranch()).id);` with the comment '("Tumu"de Tuzla)'. count-push.ts:18 `monthEndCountPush(day, await countProgress(day.slice(0, 7)))` and ops.ts:229 `countProgress(shiftMonth(day.slice(0, 7), -1))` are both called from the cron with no branch. branch-scope.ts currentPhysicalBranch: `chosen ?? branches.find((b) => b.id === DEFAULT_BRANCH_ID)`.
- **Önerilen düzeltme:** 1. src/server/bell/ops.ts, pastCountDigestLines: load the active physical branches (activePhysicalBranches(await listBranches()) in src/lib/branches.ts, or the same filter: kind === "fiziksel" && active). For each branch run `await withBranchScope(b.id, () => countProgress(prev))` and pass the result to pastCountReminder. Return one warn line per incomplete branch. Prefix the branch name when more than one physical branch is open (e.g. "Marina: Kasım 2026 sayımı yarım: 10 / 72"). Point href at that branch's count page, or at /panel/sayim?ay=… when only one branch is incomplete.

2. src/server/notify/count-push.ts, pushMonthEndCount: loop the same way. Build monthEndCountPush per branch. Then either send each branch's push with userIds set to that branch's staff plus the admins and the staff who have no branch, or, at minimum, send one push when any branch is incomplete and name the incomplete branches in the text.

3. Optional, for admins in "Tümü": apply the same per-branch loop in pastCountNotifications.

4. Update the regex assertions in tests/sayim-kayit.test.ts (lines 171 and 188) to match the new code.
- **Denetçi:** I traced the code and the finding holds. The e-mail half is solid. The push half is real but will matter less often in practice.

Code path:
- /api/cron/gunluk (route.ts:124) calls pushMonthEndCount(). runReminderDigest calls staff-requests/digest.ts:23, which calls pastCountDigestLines(now) in bell/ops.ts:229.
- Neither path wraps anything in withBranchScope, so countProgress() runs with whatever scope the request has.
- In count-progress.ts:20, countProgress filters `sc.branchId = (await currentPhysicalBranch()).id`.
- The cron request carries no laf_sube cookie and no staff user. requestBranchScope returns "hepsi", and so does its catch branch when it runs outside a request. currentPhysicalBranch then falls back to DEFAULT_BRANCH_ID, which is Tuzla.
- Result: only Tuzla's count is checked. Marina is never looked at.
- sendPush("reminders") goes to every subscribed device with no branch filter. Marina staff get Tuzla's numbers, or no push at all when Tuzla is already done.

Intent check:
- docs/SUBE.md says stock and counts are kept separately per branch ("Stok ve sayım: Şube başına ayrı"). Marina is a seeded, active physical branch that opened on 4 Nov 2026.
- docs/BILDIRIMLER.md says the morning e-mail lists last month's count when it is incomplete. It also says the last-day push goes out when the month's count is not finished.
- The comment "(\"Tümü\"de Tuzla), Stok sayımı ekranıyla aynı şube" explains matching the screen. That makes sense for screen and bell readers. Nothing in docs/planlar accepts this behaviour for the cron e-mail or push.
- tests/sube-maliyet.test.ts:142 only checks that countProgress filters by the current physical branch. tests/sayim-kayit.test.ts:171/188 regex-match the call shape (last-day gate, pastCountReminder use). They predate branches and do not say that only Tuzla should be checked.

Concrete failure: on 1–10 December, Tuzla's November count is 72/72 and Marina's is 10/72. The admin and accountant morning e-mail has no count line, and if nothing else is pending the e-mail is not sent at all. Marina's uncounted items count as 0 in the "Tümü" closing stock, so November cost of goods (mal maliyeti) comes out too high.

Weaker part: the last-day push goes out in the morning, before the counts done after closing. At that point both branches are usually at 0/72, so the wrong-numbers or no-push case happens less often.

The same Tuzla-only view also applies to the admin bell in "Tümü" (pastCountNotifications, ops.ts:163). That one at least matches the screen's documented "Tümü"de Tuzla behaviour.

### 17. Postponing a branch-specific recurring payment creates the one-off copy without its branch, so Marina's payment leaks into Tuzla's views

- **Yer:** `src/server/actions/reminders.ts:441` (ayrıca: `src/server/notify/digest.ts:61`, `src/server/notify/digest.ts:86`)
- **Senaryo:** 'Kira' is a monthly reminder with branchId='marina', due 1 December. The admin taps Ertele +1 hafta. postponeReminder inserts a one-off copy for 8 December with no branchId (null, i.e. business-wide) and moves the series to 1 January. With Tuzla selected, the Payments list, the bell and Bugun now show Marina's rent, because single-branch views include null-branch reminders. In 'Tumu' the title loses its ' · Marina' label, and the edit form shows 'Isletme geneli'. The docs say a branch's payment shows only in that branch and in Tumu (docs/SUBE.md › Odemeler).
- **Kanıt:** postponeReminder copy: `.insert(s.reminders).values({ title: r.title, kind: r.kind, amount: r.amount, dueDate: target, anchorDate: target, repeat: "none", remindDaysBefore: r.remindDaysBefore, note: ... })` has no branchId, and the column is nullable. loadUpcoming filters single-branch views with `or(eq(s.reminders.branchId, single), isNull(s.reminders.branchId))` and labels only when `r.branchId` is set.
- **Önerilen düzeltme:** In `src/server/actions/reminders.ts`, in `postponeReminder`, add `branchId: r.branchId,` to the `.values({...})` of the one-off copy inserted inside `db.transaction` (next to `remindDaysBefore: r.remindDaysBefore`). Undo needs no change: `restoreReminder(item.sourceId, prev, createdId)` already deletes the copy by id.
- **Denetçi:** The finding holds on both checks.

Code path: `postponeReminder` (admin-only, called from Ertele in `src/app/panel/hatirlaticilar/payment-ui.tsx`) handles a recurring reminder (`next` set) by inserting a one-off copy into `s.reminders`. That insert sets title, kind, amount, dueDate, anchorDate, repeat, remindDaysBefore and note, but never `branchId`. The column is `branchIdNullable()` with no default (schema.ts around line 1019), so the copy is stored as null, which means business-wide ("isletme geneli"). After that, the series row keeps `branchId='marina'` and moves to `next`, while the postponed period now lives in a null-branch row.

`loadUpcoming` (`src/server/notify/digest.ts`) filters single-branch views with `or(eq(branchId, single), isNull(branchId))`. So with Tuzla selected, the Ödemeler list, the bell and Bugün all show Marina's rent copy. In "Tümü" the " · Marina" label is added only when `r.branchId` is set, so the copy shows without its branch, and the edit form shows İşletme geneli. No guard or later step restores the branch. The other insert in the same file (from a fixed expense, around line 542) does copy `branchId`, so the postpone path is the inconsistent one.

Intent: `docs/SUBE.md` › Ödemeler says that with a single branch selected you see only that branch's and business-wide reminders, and that a branch's reminder is labelled with its branch in "Tümü". Nothing in `docs/planlar` or `tests/reminders.test.ts` says the postponed copy should drop its branch. The commit that added the branch column (#96) simply missed this insert.

Impact: a display and scoping leak (wrong branch views, missing label). Totals in the email, cash plan and tax views are unaffected because those load all branches.

### 18. Manual e-mail paths (send now, preview, weekly preview and sample) use the admin's branch selection; the cron uses all branches

- **Yer:** `src/server/weekly/collect.ts:304` (ayrıca: `src/server/notify/digest.ts:225`, `src/server/actions/weekly.ts:37`, `src/server/actions/reminders.ts:640`, `src/server/data/checklists.ts:136`)
- **Senaryo:** The admin last selected 'Marina' in the sidebar (laf_sube cookie). On Odemeler they click 'Haftalik ozeti onizle' or 'Ornegi bana gonder'. collectWeekly runs loadModel() and cashReportsBetween() inside the server action, so both read the cookie. The cash-plan item uses Marina's till revenue and staff but all business payments, so it can warn 'para yetmeyebilir' when Monday's real e-mail (cron, all branches) will not. The kasa items and the revenue line cover Marina only. The same happens with 'Bugunkuleri simdi gonder' (runDigestNow): loadDigestPrices() -> loadModel() measures the zam loss ('ayda ≈ X ₺') with Marina's sales only, the e-mail goes to the accountant, and the `prices:` log row it writes stops the 08:00 cron from reporting those price rises again with business-wide figures. The approvals box's count line (countProgress) also switches to Marina's count. loadKontrolDigest already wraps its reads in withBranchScope(ALL_BRANCHES, ...) ('E-posta isletmenin tamamı icindir'), and tests require cash-plan screens to read ALL_BRANCHES.
- **Kanıt:** collect.ts:304-305 `model: () => (modelP ??= loadModel())`, `cashWeeks: () => (cashP ??= cashReportsBetween(...))`. digest.ts:225 `const model = await loadModel();`. dataset.ts loadModel: `opts.scope === undefined ? readDataset() : ...` and readDataset uses currentBranchScope(). The cash-reports subeKosulu is `currentBranchWhere(...)`. Compare checklists.ts:136 `withBranchScope(ALL_BRANCHES, () => ...)` and nakit/page.tsx `withBranchScope(ALL_BRANCHES, ...)`.
- **Önerilen düzeltme:** Make the e-mail builders independent of the selected branch, so every caller (cron and manual) gets the same data:
- src/server/weekly/collect.ts, collectWeekly (or buildWeekly): run the collectors inside `withBranchScope(ALL_BRANCHES, ...)`. This covers loadModel, cashReportsBetween, loadCashPlan, firstCashReportDate and the other reads. At minimum, use `loadModel({ scope: ALL_BRANCHES })` and `withBranchScope(ALL_BRANCHES, () => cashReportsBetween(...))`.
- src/server/notify/digest.ts: in loadDigestPrices, use `loadModel({ scope: ALL_BRANCHES })`. Better still, wrap the body of runReminderDigest in `withBranchScope(ALL_BRANCHES, ...)` so that loadDigestExtras is covered too. Do the same in previewDigest in src/server/actions/reminders.ts.

Alternatively, wrap the bodies of previewWeekly, sendWeeklySample, previewDigest and runDigestNow in `withBranchScope(ALL_BRANCHES, ...)`. Fixing it inside the builders is safer.
- **Denetçi:** The finding holds on both checks.

1) Code path. The manual buttons call server actions: previewWeekly and sendWeeklySample (src/server/actions/weekly.ts), and previewDigest and runDigestNow (src/server/actions/reminders.ts). Each one only calls requireAdmin() and does not wrap its work in withBranchScope. In collectWeekly (src/server/weekly/collect.ts:304-305) the model comes from `loadModel()` with no scope, and cashWeeks comes from `cashReportsBetween(...)`. loadModel without a scope runs readDataset(), which calls currentBranchScope(). With no override, that falls through to requestBranchScope(), which reads the `laf_sube` cookie. cookies() works inside server actions; pnl.ts relies on the same thing and a test asserts it. An admin is never branch-locked, so with Marina selected the scope is 'marina'. Two things then follow:
- months, sales lines, staff and waste are filtered to Marina.
- loadCashPlan's cashReportsBetween uses currentBranchWhere, so the till revenue is Marina's only. loadUpcoming has no branch, so payments are business-wide, and tillsCarry uses explicit IDs for all branches.

The nakit, kasa, zam, kasa-fiyat, zayi, stok and kontrol collectors therefore see Marina data only. The comments in the kasa and kontrol collectors ('iki şubenin raporları birlikteyken…', 'herhangi bir kasanın raporu var') show they expect reports from all branches.

The morning e-mail has the same problem. runReminderDigest calls loadDigestPrices(), which calls `loadModel()` with no scope (digest.ts:225). The 'ayda ≈ X ₺' figure from priceLoss(model, fresh, latestSalesMonth(model)) is then built from Marina's sales only. A successful send writes a `prices:` log row, and the next cron run only reports price rises newer than that row. So the business-wide figure is never sent for those price rises.

The cron path is runWeeklyStep / runReminderDigest('cron') through /api/cron/gunluk. That request has no `laf_sube` cookie, so parseBranchScope(null) returns ALL_BRANCHES. The manual output therefore differs from what the cron sends.

2) Intent.
- docs/SUBE.md (Neyi süzer) says business-wide screens and server actions read ALL_BRANCHES, and it names the nakit planı explicitly.
- The table in docs/SUBE.md lists 'Sabah e-postası, Nakit planı, Vergi, haftalık özet' as business-wide.
- docs/KONTROL-LISTELERI.md says 'Sabah e-postası işletmenin tamamı içindir'.
- checklists.ts:135-136 wraps its reads in ALL_BRANCHES for this reason.
- docs/planlar/haftalik.md describes the preview as 'Pazartesi giden e-posta böyle görünür'.
- tests/nakit-plani.test.ts asserts that the cash-plan screens use ALL_BRANCHES.

No test or plan accepts manual e-mail paths following the branch selection.

### 19. "Listede olmayanlar" (stock_extras) şubesiz: Marina'nın sayım formu Tuzla'nın ek kalemlerini gösterip üzerine yazıyor ya da siliyor

- **Yer:** `src/server/data/dataset.ts:117` (ayrıca: `src/server/db/schema.ts:814`, `src/server/data/stock-extras.ts:25`, `src/app/panel/sayim/actions.ts:60`, `src/server/actions/stock.ts:181`, `src/app/panel/sayim/page.tsx:177`, `src/server/data/today.ts:122`)
- **Senaryo:** 31 Ekim'de Tuzla baristası "Listede olmayanlar"a fiyatsız "Peçete · 5 KOLİ" ekliyor. Marina'ya kilitli barista "Marina · Ekim 2026" başlıklı Stok sayımı'nı açıyor ve aynı satırı kendi listesinde görüyor ("Geçen aydan doldur"un prevExtras'ında da Tuzla'nınkiler var). Marina'da 2 koli peçete var. Yeni "Peçete" satırı eklemek "iki kez yazılmış" hatasıyla reddediliyor; bu yüzden satırı 2 yapıyor. planStaffExtras eşleşen satırın miktarını güncelliyor ve Tuzla'nın 5 kolisi kayboluyor. Barista tanımadığı fiyatsız satırı silerse planStaffExtras onu siliyor. Sonuç: işletmenin Ekim kapanış stoğu eksik, Ekim mal maliyeti yüksek çıkıyor. Ayrıca Marina'nın sayım toplamı ve hasData değeri Tuzla'nın ek kalemlerini içeriyor. docs/SUBE.md "Stok ve sayım: Şube başına ayrı" diyor; sayım satırları şubeye yazılırken ek kalemler ortak kalıyor.
- **Kanıt:** schema.ts:814 stockExtras'ta branch_id yok. dataset.ts:117 `db.select().from(s.stockExtras)` şube süzgeçsiz okuyor, oysa stockCounts :100'de `branchWhere(s.stockCounts.branchId, scope)` ile süzülüyor. stock-extras.ts:25 lockExtras yalnız `eq(s.stockExtras.month, month)`; sayim/actions.ts:60-73 ve stock.ts:181-198 de yalnız ayla yazıyor ve siliyor. sayim/page.tsx:177 `extras={sheet.extras...}` şube modelinden ama bütün şubelerin ek kalemleriyle geliyor.
- **Önerilen düzeltme:** 1. Schema: add `branchId: branchId()` to stockExtras in src/server/db/schema.ts. Add a migration that sets branch_id = 'tuzla' on existing rows, the same way 0056 did for the other tables.
2. Reading (src/server/data/dataset.ts:117): read with `.where(branchWhere(s.stockExtras.branchId, scope))`. In "Tümü" this returns every branch's extras, and stockSheet already adds them up.
3. Writing:
   - src/server/data/stock-extras.ts: give lockExtras a `sube` parameter, filter its select with `and(eq(month), eq(branchId, sube))`, and put the branch in the advisory-lock key (`sayim-ek-${month}-${sube}`).
   - src/app/panel/sayim/actions.ts saveStaffStockExtras and src/server/actions/stock.ts saveStockExtras: get `sube = (await currentPhysicalBranch()).id` and add `eq(s.stockExtras.branchId, sube)` to every update, delete and reread. Insert rows with `branchId: sube`. Insert the months row with branchId too (saveStaffStockExtras currently inserts `{ month: m }` without one).
   - The `history` price lookup can stay business-wide.
   - dropEmptyStockMonth (stock.ts:163) should count extras for that branch only.
4. Other readers: scope by currentPhysicalBranch in src/server/data/today.ts:122 (prevExtra) and src/server/data/count-item.ts:176 (extraTwin). count-alerts.ts can stay business-wide or be scoped to match the admin's selected scope.
- **Denetçi:** I traced the code and checked the docs, and the defect holds up.

Code path:
- /panel/sayim (page.tsx) gets the branch from currentPhysicalBranch(). A staff member tied to Marina therefore gets Marina. The page then calls loadModel({ scope: branch.id }).
- In readDataset, stockCounts is filtered with branchWhere(s.stockCounts.branchId, scope). stockExtras is read with no filter at all: `db.select().from(s.stockExtras).orderBy(...)` at dataset.ts:117. It can't be filtered, because schema.ts:814 gives stock_extras no branch_id column.
- engine.ts:1553-1718 (stockSheet) groups the extras by month only. They go into extras, extrasTotal, total and hasData for whatever branch the model was loaded for.
- So Marina's form gets every branch's extras: page.tsx:177 passes `extras` and `prevExtras` from that sheet.
- On save, saveStaffStockExtras (sayim/actions.ts) locks, reads and writes by month only. So do lockExtras (stock-extras.ts:25, where the advisory-lock key is also month-only) and saveStockExtras (stock.ts:181-198).
- planStaffExtras (logic.ts:243-287) rejects two rows with the same name and unit ("iki kez yazılmış"). When a row matches, it overwrites the quantity. It deletes any unmatched row that has no price.
- Result: Marina staff who type their own count of a Tuzla extra either get rejected or end up replacing Tuzla's quantity. If they remove a row they don't recognise, Tuzla's unpriced row is deleted. In both cases the business's closing stock is understated and the month's cost of goods comes out too high.
- The same gap shows up elsewhere. today.ts:120 filters stockCounts by branch, but the very next query at :122 checks stockExtras by month only. count-item.ts:176 (extraTwin) is also unscoped.

Intent:
- docs/SUBE.md:56 says "Stok ve sayım: Şube başına ayrı". SUBE.md:125 says the count is written to the selected physical branch.
- Nothing in docs/planlar or the branch commits (#87, #89) says stock_extras is meant to stay business-wide.
- tests/sube-maliyet.test.ts:108 checks branchWhere only for months, salesLines, staff, stockCounts and wasteEntries. No test says extras are intentionally shared.
- The earlier audit items E-02, E-22 and E-23 deal with concurrency, pricing and duplicates. None of them covers branch scoping.

Caveat: the cost-of-goods effect is at the business level ("Tümü"). A single branch's cost of goods is recipe-based, so it does not use the count. The data loss and the cross-branch leak on the form are still real.

### 20. Sayım sayfası hep şube kapsamıyla yükleniyor: Gelir-giderde elle yazılan devir ve açılış uyarıları (E-30) artık hiç görünmüyor

- **Yer:** `src/app/panel/sayim/page.tsx:78` (ayrıca: `src/server/data/dataset.ts:162`, `src/lib/branches.ts:161`, `src/lib/calc/engine.ts:2093`, `src/lib/calc/engine.ts:2314`, `src/app/panel/sayim/page.tsx:122`, `src/app/panel/sayim/page.tsx:182`)
- **Senaryo:** Sahip Gelir-giderde (Tümü) Ekim'in "SONRAKİ AYA DEVREDEN MAL"ını elle 85.000 ₺ yazıyor. Sayım tamamlanınca toplam 92.000 ₺ çıkıyor. /panel/sayim?ay=2026-10 her zaman bir fiziksel şubeyle yükleniyor ("Tümü"de de Tuzla). Şube kapsamında yükleyici bütün stock:* gelir-gider hücrelerini atıyor, motor da branchView'da stock:opening hücresini {value:null, overridden:false} yapıyor. Bu yüzden closingOverride hep null: "Gelir-giderde bu ayın stoğu elle 85.000 ₺ girildi; kâr-zarar o tutarı kullanır" uyarısı hiç çıkmıyor. Kasım kartı "Açılış"ı 92.000 ₺ gösteriyor, "elle girildi" ipucu yok; kâr-zarar ise 85.000 ₺ kullanıyor. Sahip sayımı düzeltmenin kârı değiştirdiğini sanıyor. Bu, denetim E-30 düzeltmesinin dalga 3 (#89) ile sessizce geri alınması. Gelir-gider'in kendi ipucu (engine.ts:2314) hâlâ "Elle yazılırsa Stok sayımı kartındaki açılış da bu tutarı gösterir" diyor.
- **Kanıt:** page.tsx:78 `const model = await loadModel({ scope: branch.id });` → dataset.ts:162 `pnlInScope = branch === null ? pnlEntries : pnlEntries.filter((e) => branchPnlEntry(...))`; branchPnlEntry stock:* için false döner (branches.ts:161-169). engine.ts:2093 branchView'da `cells.set("stock:opening", { value: null, computed: null, overridden: false, ... })`. page.tsx:122 countOpening(...) bu yüzden hep source "sayim"; :182 `closingOverride={isAdmin && closing.overridden ? ...}` hep null. tests/gelir-gider-baglanti.test.ts countOpening'i şubesiz modelle sınadığı için açığı yakalamıyor.
- **Önerilen düzeltme:** Fix it in src/app/panel/sayim/page.tsx and keep the branch model for the count list and its amounts. For admins only, read the company-wide K/Z overrides from outside the branch scope. You can load `loadModel({ scope: ALL_BRANCHES })` (as Tutarlılık does), or, more cheaply, query `pnl_entries` directly for `(month, 'stock:closing')`, `(prevMonth, 'stock:closing')` and `(month, 'stock:opening')`.

- `closingOverride`: use `closingOverride = isAdmin && ovClosing(month) !== undefined ? ovClosing(month) : null`.
- `opening`: use `opening = countOpening(ovOpening(month) !== undefined ? { value: ovOpening(month), overridden: true } : { value: 0, overridden: false }, { value: ovClosing(prevMonth) ?? branchPrevClosing.computed, computed: branchPrevClosing.computed, overridden: ovClosing(prevMonth) !== undefined }, prev.hasData)`, where `branchPrevClosing = model.closingStock(prevMonth)` comes from the branch model.

This keeps the branch's own count as the count value and brings back the E-30 "elle girildi" hint and the "kâr-zarar bu sayımı kullanmaz" warning whenever K/Z uses a manually typed company-wide amount. Also add a test that runs a branch-scoped model or page with a `stock:closing` / `stock:opening` entry and expects the hint and warning to appear.
- **Denetçi:** I traced the code path and it holds. Since #89 (fd5cf34), sayim/page.tsx:78 loads `loadModel({ scope: branch.id })`, and `currentPhysicalBranch()` always returns a physical branch (Tuzla when "Tümü" is selected). So `readDataset` always has a non-null `branch` (dataset.ts:53). With a branch set, dataset.ts:162 keeps only the pnl entries that `branchPnlEntry` accepts, and that function returns false for every `stock:*` row key (branches.ts:161-169). Because no override reaches the engine, `closingStock(month)` (engine.ts:1854-1857) always returns `overridden: false`. In branchView, `pnlMonth` also hard-codes the `stock:opening` cell as `{ value: null, overridden: false }` (engine.ts:2093). On the page this means `countOpening(...)` (page.tsx:122) always returns source "sayim": no "elle girildi" hint, and the "Açılış" card shows the branch's own count. `closingOverride` (page.tsx:182) is always null, so the stock-form's "kâr-zarar bu sayımı kullanmaz" warning (stock-form.tsx:1064-1073, risk="para") and the matching sentence in the breakdown (:976) can never appear.

Nothing documents this as intended. The E-30 audit fix (docs/planlar/denetim-2026-10-26.md:62) asks for the count card to show pnlMonth's opening with an "elle girildi" hint. The Gelir-gider hint for "ÖNCEKİ AYDAN DEVİR" (engine.ts:2314) still promises "Elle yazılırsa Stok sayımı kartındaki açılış da bu tutarı gösterir". docs/SUBE.md only says the stock carry-over is company-wide and cannot be entered while a single branch is selected. It does not say the count page should stop warning when the company K/Z overrides the count. The tests are no counter-evidence: gelir-gider-baglanti.test.ts runs countOpening on a model without a branch and only regex-checks the page source, and sube-maliyet.test.ts only checks that the page loads the branch scope. No test asserts that the warnings are suppressed.

Concrete result: the owner types a manual "SONRAKİ AYA DEVREDEN MAL" or "Önceki aydan devir" in Gelir-gider (Tümü). The Stok sayımı page then shows the count total and the count-based opening with no warning, while K/Z uses the typed amount. The two screens contradict each other, and the explicit promise in the Gelir-gider hint is broken. There is no data corruption, but it is a money-risk notice that silently disappeared.

### 21. A newly opened şube's first month is treated as 'kasa raporları ay ortasında başladı': ciro and açık gün are dropped in its branch view

- **Yer:** `src/lib/cash-month.ts:232` (ayrıca: `src/server/data/dataset.ts:268`, `src/lib/cash-month.ts:241`, `src/lib/calc/engine.ts:429`, `docs/SUBE.md:27`)
- **Senaryo:** Marina opened in November 2026 and has reported every day since its first report (say 5 Kasım). With Marina selected, readDataset calls tillMonths over Marina's rows only, with no firstEver, so first = 2026-11-05 and partialFrom = '2026-11-05'. kasaValues then returns null for openDays, posRevenue, discounts and offRevenue. I ran a scratch check with 26 daily Marina rows of 10.000 ₺: tillMonths gives openDays 26 and posRevenue 260.000, but resolveMonths gives openDays null, posRevenue null and prorationDays 0. As a result, Marina's Genel bakış and Gelir-gider show no ciro for its opening month ('ciro girilmedi'). Personel and fixed costs get ratio 0 in the P&L column, the daily chart and break-even progress disappear, and Kasa says 'bu ayın açık gün ve cirosu elle girilir'. This happens even though the reports cover the whole period the branch existed. The month never self-heals after it closes, and typing the value in Gelir-gider then hits finding 1. The branches.opened_on column exists for this purpose ('Açılış günü') but no calculation reads it.
- **Kanıt:** cash-month.ts:232 `partialFrom: first > start && first.slice(0, 7) === month ? first : null`, with `first = firstEver ?? earliest(rows)`. kasaValues: `const sums = t.partialFrom === null && t.openDays > 0` → totals null. dataset.ts:268 calls `tillMonths(till, through, undefined, …)` with branch-filtered till, and readDataset has `branch` (with openedOn) in hand but never passes it. grep shows openedOn is used only in branch-day.ts (Bugün), not in cash-month, dataset or engine.
- **Önerilen düzeltme:** Have the branch's opening day suppress partialFrom.
1) src/lib/cash-month.ts `tillMonths`: add an optional `openedOn?: string | null` parameter and set `partialFrom: first > start && first.slice(0,7) === month && !(openedOn != null && first <= openedOn) ? first : null`. Optionally clamp `from` to `max(start, openedOn)` so prorationDays counts from the opening day.
2) src/server/data/dataset.ts: pass the selected branch's opening day (`branch?.openedOn ?? null`) in the tillMonths call at line ~268 and in the salesCoverage call at line ~213. Do the same in src/app/panel/kasa/page.tsx:537 (read the branch via listBranches/currentBranchScope) and in the month-line check of src/server/data/cash-late.ts `monthLineOf`, so all screens agree.
3) For a non-default branch whose `opened_on` is null (the seed leaves Marina's null), either have the owner set it in Ayarlar › Şubeler or treat the branch's own first row as its opening day. Tuzla and "Tümü" keep the current rule (openedOn null, or no branch).
- **Denetçi:** I traced the code path and it holds. `tillRows()` (src/server/data/cash-reports.ts:312) filters by the selected şube (`subeKosulu` / `currentBranchWhere`). With Marina selected, readDataset (src/server/data/dataset.ts:268) calls `tillMonths(till, through, undefined, …)` on Marina's rows only, with no firstEver. In tillMonths (src/lib/cash-month.ts:164,232), `first` becomes Marina's first report, so `partialFrom` is set whenever that day is after the 1st. kasaValues (cash-month.ts:243) then returns null for openDays, posRevenue, discounts and offRevenue.

I ran a scratch script with 16 Marina rows (5–20 Kasım, 10.000 ₺ each). tillMonths gives openDays 16 and posRevenue 160.000 with partialFrom '2026-11-05'. resolveMonths then gives openDays null and posRevenue null (both sources 'none'), and prorationDays is 0. Nothing guards this path. The Kasa page (kasa/page.tsx:537, where `firstCashReportDate` is branch-scoped) and the cash-late monthLineOf (cash-late.ts:261) behave the same way, so every screen tells the owner to type Marina's opening-month ciro by hand.

Intent check: the rule exists for the case where the kasa feature started partway through a month, so the reports miss part of a month the café was already open. docs/planlar/kasa.md:33 says "the feature started mid-month", and KASA-RAPORU.md › Ay bilgisine aktarım says "o ayın toplamları ayın yalnız bir kısmıdır". For a branch that opens mid-month, the reports cover every day it existed, so that premise does not hold. docs/SUBE.md › Şube görünümünde maliyet says that in a single-branch view, ciro comes from that branch's kasa reports. SUBE.md:27 defines `opened_on` (Açılış günü), but only branch-day.ts reads it; cash-month, dataset and engine do not. No test or plan document accepts branch-scoped partialFrom. tests/kasa-ay-bilgisi.test.ts has no single-branch first-month case. Marina is a real branch that opened in November 2026 (SUBE.md, 4 Kasım: "şimdi açılıyor"), so its current month is affected now.

Impact: in Marina's view, the November ciro, açık gün and kasa-derived prorationDays are null or 0. As a result, Genel bakış and Gelir-gider show no ciro, and fixed costs and personnel are prorated to 0 until someone types the values. This does not fix itself after the month closes.

Uncertainty: the documentation's literal sentence ("Kasa raporları bir ayın ortasında başladıysa … elle girilir") could be read to cover this case. That is why confidence is medium rather than high.

### 22. Branch picker deep-link (?sube=) adoption is keyed to the last adopted value, not the link, so links open the wrong branch or undo the user's choice

- **Yer:** `src/components/panel/branch-picker.tsx:42` (ayrıca: `src/app/panel/bugun/today-branches.tsx:41`, `src/server/bell/kasa.ts:79`, `src/app/panel/kasa/page.tsx:218`)
- **Senaryo:** (a) The admin is on 'Tümü' on Bugün and clicks the Marina row (`/panel/kasa?gun=D&sube=marina`). The picker adopts marina, sets ref=marina and drops the param. Back on Bugün they switch the picker to Tümü, then click the Marina row again. Now farkli is true but `benimsenen.current === istenen`, so the effect returns. The cookie stays 'hepsi', ?sube=marina stays in the URL, and the kasa page opens Tuzla's form for day D through currentTillBranch, even though the link was for Marina. A report typed there is saved to Tuzla. Bell links built with `&sube=` (bell/kasa.ts:79, modpos.ts:100) behave the same way. (b) The cookie is already marina and the user opens a `&sube=marina` link. farkli is false, so the param is never dropped. If the user then picks Tuzla in the picker on that page, farkli becomes true with ref still null. The effect calls chooseBranchScope('marina') and silently reverts the user's choice.
- **Kanıt:** line 40 `const farkli = !locked && params.has(BRANCH_PARAM) && istenen !== scope;` line 42 `if (!farkli || benimsenen.current === istenen) return;`. The ref is never reset. BranchPicker lives in the layout's Sidebar, so it stays mounted across navigations. The param is only removed when it differs from the scope.
- **Önerilen düzeltme:** Only src/components/panel/branch-picker.tsx needs to change. Track adoption per URL instead of per value, and always remove the param:

```ts
const raw = params.get(BRANCH_PARAM);
useEffect(() => {
  if (locked || raw === null) { benimsenen.current = null; return; }
  const key = params.toString();
  if (benimsenen.current === key) return;
  benimsenen.current = key;
  run(async () => {
    if (istenen !== scope) await chooseBranchScope({ scope: istenen });
    const kalan = new URLSearchParams(params);
    kalan.delete(BRANCH_PARAM);
    const qs = kalan.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  });
}, [locked, raw, istenen, scope, params, pathname, router, run]);
```

The ref is reset whenever the URL has no param. The param is removed even when it already equals the scope, so a later change in the picker can no longer be undone by a stale `?sube=`.
- **Denetçi:** I traced the code and confirmed the finding. Nothing in the docs or tests says the current behaviour is intended.

How the code gets there:
- BranchPicker sits in the desktop panel of Sidebar. That panel is always mounted and only hidden with CSS. Sidebar is rendered by app/panel/layout.tsx, which stays mounted across soft navigations and across `refresh()`. So the `benimsenen` ref keeps its value for the whole session, and nothing ever sets it back to null.
- The kasa page never reads `?sube=`. CashContent calls currentBranchScope() and currentTillBranch(), and both read only the cookie. When the scope is "Tümü" and `gun` is set, the page falls through to currentTillBranch(), which returns Tuzla. Only the picker effect can make a `?sube=` link work.

Scenario (a): stale ref, link not adopted.
1. The admin is on "Tümü" and opens `/panel/kasa?gun=D&sube=marina`. The link can come from the Bugün row, a bell link, or a Marina day link in the "Tümü" kasa sections (cash-history.tsx:174).
2. The effect stores `ref = 'marina'`, sets the cookie to marina and strips the param.
3. The admin then picks Tümü or Tuzla in the picker. The URL has no param, so the ref stays 'marina'.
4. They follow another `&sube=marina` link. Now `farkli` is true, but `benimsenen.current === istenen`, so the effect returns early.
5. The cookie stays hepsi/tuzla and the page renders Tuzla's kasa form for day D. A report saved from that form goes to Tuzla.

Scenario (b): param not stripped, user's choice reverted.
1. The cookie is marina. The admin clicks a link that carries `&sube=marina`. Every day link in a Marina kasa page does this (cash-history.tsx:174 and page.tsx:642), as do bell links.
2. `farkli` is false, so the param stays in the URL.
3. The admin picks Tuzla in the picker. chooseBranchScope calls `refresh()`, so the scope prop becomes tuzla while the URL still has `sube=marina`. `farkli` turns true.
4. If the ref is not already 'marina' (for example it is null), the effect calls chooseBranchScope('marina') and silently undoes the admin's choice.

Intent: docs/SUBE.md › Seçici says a link's `?sube=` is adopted into the cookie on opening and removed from the address, so the link still works. Both scenarios break that rule. Nothing in tests/ or docs/planlar/ marks this as accepted.

### 23. The admin bell's 'Personel özel gün ekledi/düzeltti/sildi' row links to the deleted /panel/tahmin page (404)

- **Yer:** `src/server/bell/kasa.ts:321` (ayrıca: `src/server/closed-days.ts:442`, `src/lib/roles.ts:60`)
- **Senaryo:** A staff member adds, edits or deletes a special day on /panel/ozel-gunler. Within 3 days the admin's bell shows 'Ahmet özel gün ekledi'. Clicking it goes to /panel/tahmin#ozel-gunler. That screen was removed in commit e6670f6 ('/panel/tahmin 404'), and neither proxy.ts nor next.config redirects it, so the admin gets a 404 instead of the special-days screen.
- **Kanıt:** `href: verb ? "/panel/tahmin#ozel-gunler" : "/panel/kasa",`. src/app/panel/tahmin does not exist. RETIRED_PATHS in src/lib/roles.ts only covers hizli-sayim and mal-siparisi. Special days now live at /panel/ozel-gunler (nav.ts).
- **Önerilen düzeltme:** In src/server/bell/kasa.ts (requestNotifications, admin info loop, line ~321) change `href: verb ? "/panel/tahmin#ozel-gunler" : "/panel/kasa"` to `href: verb ? "/panel/ozel-gunler#ozel-gunler" : "/panel/kasa"`. Plain "/panel/ozel-gunler" also works. Optionally, as a safety net for old bookmarks or links, add a redirect from /panel/tahmin to /panel/ozel-gunler in src/proxy.ts or next.config.ts. Separately, the logIn detail texts at src/server/closed-days.ts:212, 239 and 267 still say "Satış tahmini › Özel günler"; they could be reworded to "Kafe › Özel günler".
- **Denetçi:** The broken link is real. Staff actions in src/server/actions/special-days-staff.ts:41 and :54 write "Özel gün", "Özel gün güncellendi" and "Özel gün silindi" to the activity log. closedInfoRows in src/server/closed-days.ts:442-447 picks up "Özel gün%" rows written by staff users. requestNotifications in src/server/bell/kasa.ts:273 reads them for admins with a 3-day window. At line 321 each staff row gets href "/panel/tahmin#ozel-gunler".

Commit e6670f6 ("Satış tahminini tamamen kaldır", #84) deleted src/app/panel/tahmin. Its message says the browser check showed "/panel/tahmin 404" and that the special days moved to /panel/ozel-gunler. src/app/panel has no tahmin folder and no catch-all route. src/proxy.ts only redirects RETIRED_PATHS (hizli-sayim, mal-siparisi) via src/lib/roles.ts:61-66. The redirects in next.config.ts only cover the vercel.app host. So an admin who clicks the bell row reaches canOpen (admins pass) and then gets a 404.

Nothing documents this as intentional. docs/OZEL-GUNLER.md says the screen is /panel/ozel-gunler and that the bell reads special days. The old personel-yetki.md note about /panel/tahmin#ozel-gunler predates the removal. No test asserts the tahmin href: grepping tests for "panel/tahmin" finds nothing. The page at src/app/panel/ozel-gunler/special-days.tsx:316 still renders Card id="ozel-gunler", so the fragment still works on the new route.

### 24. stock_extras ('Listede olmayanlar') has no branch_id, so branches share and overwrite each other's month-end extra items

- **Yer:** `src/server/db/schema.ts:814` (ayrıca: `src/server/data/dataset.ts:117`, `src/server/data/stock-extras.ts:25`, `src/app/panel/sayim/actions.ts:72`, `src/server/actions/stock.ts:191`, `drizzle/0056_sube_kirilimi.sql:1`)
- **Senaryo:** Tuzla staff save November's count with the extra item 'Çöp torbası 3 KOLİ'. Marina staff, locked to Marina, open Sayım for November and see Tuzla's 'Çöp torbası 3 KOLİ' prefilled under Listede olmayanlar. Marina's stock value also includes it. They change it to their own 2 KOLİ and save. planStaffExtras matches the existing row by name and unit and updates qty to 2, so Tuzla's 3 is lost and the business ('Tümü') closing stock is understated, which raises the counted cost of goods. If Marina removes the row, Tuzla's unpriced item is deleted. The staff path also opens the month row with the default branch: `insert(s.months).values({ month: m })` creates a 'tuzla' month for a Marina count. This contradicts docs/SUBE.md ('Stok ve sayım | Şube başına ayrı'), and stock_counts became per-branch in 0056 while stock_extras did not.
- **Kanıt:** schema.ts:814 `stockExtras = pgTable("stock_extras", { id, month, name, unit, qty, unitPrice })` has no branchId, and 0056 did not add one. dataset.ts:117 runs `db.select().from(s.stockExtras)` unfiltered, while stockCounts uses `branchWhere(...)` at line 100. lockExtras (stock-extras.ts:25) reads `where(eq(s.stockExtras.month, month))`. sayim/actions.ts:72 runs `tx.insert(s.months).values({ month: m })`, whereas the admin path stock.ts:191 uses `{ month: m, branchId: sube }`.
- **Önerilen düzeltme:** 1. Migration: `ALTER TABLE stock_extras ADD COLUMN branch_id text NOT NULL DEFAULT 'tuzla' REFERENCES branches(id);`. In schema.ts, add `branchId: branchId()` to `stockExtras`.
2. src/server/data/dataset.ts:117: add `.where(branchWhere(s.stockExtras.branchId, scope))`.
3. src/server/data/stock-extras.ts `lockExtras(tx, month, branch, base)`: use the lock key `sayim-ek-${month}-${branch}` and filter with `where(and(eq(month), eq(branchId, branch)))`.
4. src/app/panel/sayim/actions.ts `saveStaffStockExtras` and src/server/actions/stock.ts `saveStockExtras`:
   - Compute `sube = (await currentPhysicalBranch()).id` and pass it to `lockExtras`.
   - Add `eq(s.stockExtras.branchId, sube)` to every update/delete/select where clause.
   - Insert with `{ ...x, month: m, branchId: sube }`.
   - In the staff action, insert the months row as `{ month: m, branchId: sube }`.
   - The price history used by `planStaffExtras` can stay business-wide, since prices are shared.
5. Filter the remaining extras reads by branch:
   - `today.ts` `stockProgress`: prevExtra.
   - `stock.ts` `dropEmptyStockMonth`: extras count.
   - `count-item.ts:176`: the extraTwin lookup.
6. Add `stockExtras` to `branchUsageCount` in src/server/branches.ts. The subeler test requires every table with a branch column to be counted there.
- **Denetçi:** The code path checks out from start to finish. `/panel/sayim` (page.tsx:76-78) loads the model for the chosen physical branch, `loadModel({ scope: branch.id })`. In dataset.ts, `stockCounts` is filtered with `branchWhere(s.stockCounts.branchId, scope)`, but `stockExtras` is read with no filter (`db.select().from(s.stockExtras)`, line 117). `stock_extras` has no `branch_id` column in schema.ts:814, and 0056 did not add one (no later migration does either). So the `sheet.extras` / `prevExtras` sent to Marina's StockCountForm are the same month list Tuzla sees.

Both save paths work on that one list keyed only by month:
- `lockExtras` locks `sayim-ek-${month}` and reads `where month = m`.
- `saveStaffStockExtras` runs `planStaffExtras`, which matches incoming rows to existing ones by `extraKey(name, unit)`. A same-named row therefore becomes an UPDATE of qty, which overwrites the other branch's quantity. A row the other branch left unpriced is DELETEd when this branch removes it.
- `saveStockExtras` (admin) does the same through `planAdminExtras`.

The result: the 'Tümü' closing stock (engine stockSheet, extras counted once per month) holds only one branch's quantity, so business-level cost of goods (COGS) rises. Marina's sayım page also shows Tuzla's items and includes them in its total.

The staff action also inserts `months` with only `{ month: m }`, so the row takes `branch_id` DEFAULT 'tuzla' even for a Marina count. The admin path uses `branchId: sube`. That part is minor.

Intent check: nothing says extras are meant to be business-wide.
- docs/SUBE.md and docs/planlar/sube.md say "Stok ve sayım | Şube başına ayrı" and that sayım is written to the selected physical branch.
- The header of tests/sube-maliyet.test.ts says "sayım ve zayi o şubenin".
- No doc, comment or test makes stock_extras an exception. The sube tests only check `stockCounts`, so the gap was never covered, not accepted.

Related spots read extras without a branch too: `today.ts` `stockProgress` (prevExtra) and `dropEmptyStockMonth` (extras count).

### 25. Hourly staff e-mail reminders keep firing on a day the admin has marked 'Kafe kapalı'

- **Yer:** `src/server/notify/checklist-alerts.ts:161` (ayrıca: `src/server/checklists/store.ts:266`, `src/server/data/checklists.ts:139`, `src/server/actions/notifications.ts:99`, `src/server/closed-days.ts:49`)
- **Senaryo:** The admin adds a 'Kafe kapalı' special day in advance under Özel günler (for example a holiday or renovation; up to one year ahead is allowed). On that day no one fills a list. Every GitHub run (08:07–02:07) and every open panel poll sends e-mails anyway: 'Açılış listesi zamanı geldi/gecikti', 'Tuvalet çizelgesi · 10:00 zamanı geldi' then '· 10:00 gecikti' for each hour, and 'Kapanış ...'. That is about 19 or more e-mails per staff member, sent to all active Tuzla staff and staff with no branch, on a day the business itself recorded as closed.
- **Kanıt:** runChecklistAlerts does `const lists = await loadAlertLists(db, day, {...}); const due = checklistAlerts(day, now, lists);` and never checks isClosedDay(day). loadAlertLists/expectedOn look only at weekdays and active/activeFrom. Other checklist warnings do respect the closed flag: loadKontrolDigest checks `isClosedDay(day)` (src/server/data/checklists.ts:139), the bell filters `!closedYesterday || l.run` (src/server/actions/notifications.ts:101), and Bugün's checklistYesterday returns null when the day is approved closed. docs/planlar/personel-yetki.md:76 says the closed-day flag "Eksik kasa raporu ve kontrol listesi uyarısını susturur".
- **Önerilen düzeltme:** In src/server/notify/checklist-alerts.ts runChecklistAlerts, after `const day = checklistDay(now);` and loading lists, add `import { isClosedDay } from "@/server/closed-days";` and drop lists that were never opened when the day is marked closed:

  const closed = await isClosedDay(day, db);
  const lists = (await loadAlertLists(db, day, {...})).filter((l) => !closed || l.hasRun);

To do this, give AlertList a `hasRun: boolean` field, set in loadAlertLists (src/server/checklists/store.ts) as `hasRun: Boolean(run)`. This matches the bell's `!closedYesterday || l.run` rule. A simpler fix is to return `{ skipped: "kafe kapalı işaretli", alerts: [], sent: 0, failed: 0 }` early when isClosedDay(day) is true. Add one line to docs/KONTROL-LISTELERI.md §6: 'Kapalı işaretli günde (Özel günler › Kafe kapalı) açılmamış listeler için e-posta gitmez.'
- **Denetçi:** I traced the code and the defect holds. Both entry points call runChecklistAlerts with no closed-day guard: /api/cron/kontrol/route.ts:18 (the GitHub run every hour, 08:07–02:07) and /api/canli/route.ts:53 (the open-panel poll, at most every 5 minutes). runChecklistAlerts (src/server/notify/checklist-alerts.ts:36-44) checks only that Resend is set up and that e-mail is switched on in settings. It then calls loadAlertLists(db, checklistDay(now), ...) and checklistAlerts(...). loadAlertLists (store.ts:266) filters only on t.active, t.staffAllowed and expectedOn (weekday plus active). It never reads special_days.

A future closed day is easy to create. The admin action src/server/actions/special-days.ts:35/72 accepts kind "kapali" up to SPECIAL_MAX_AHEAD_DAYS (1 year) ahead, and the Özel günler dialog suggests "Tadilat" (renovation) as the title for that kind. So on an admin-marked closed day no runs or answers exist and every required item counts as missing. Each hourly run then claims new due/late keys and sends one e-mail per active staff member who can fill the list. That covers Tuzla, Marina (which has its own opening and closing lists since 4b3fb05) and staff with no branch, all day long.

Intent check: docs/KASA-RAPORU.md:356 states the general rule "Kapalı işaretli gün eksik rapor ve kontrol listesi uyarılarına girmez" (a day marked closed is left out of missing-report and checklist warnings). personel-yetki.md (row 9b) says the closed mark silences the checklist warning. KONTROL-LISTELERI.md §6, which describes the staff e-mail reminder, gives no closed-day exception. No test or plan records sending on closed days as intended: tests/kontrol-hatirlatma.test.ts has no closed-day case, and neither commit message for this feature (c21c24a, 750a152) mentions closed days.

One caveat weakens the finding's 'inconsistent with other paths' argument. Today's bell rows and Bugün rows also ignore a closed mark on today; only the paths about yesterday (bell, Bugün's yesterday rows, morning digest) honour it. Even so, e-mail is the only one of these channels that reaches staff away from the café. It contradicts the documented general rule, and nothing guards against it. So it is a real, low-severity defect.

### 26. Bugün: laffogato.net kanalı seçiliyken yöneticinin kasa satırları online kanalı okuyor; Kasa sayfası ve zil Tuzla'yı gösteriyor

- **Yer:** `src/server/data/today.ts:148` (ayrıca: `src/server/bell/kasa.ts:63`, `src/app/panel/kasa/page.tsx:217`, `src/server/branch-scope.ts:158`)
- **Senaryo:** The admin selects "laffogato.net" in the picker and opens Bugün in the evening. cashView returns `{ till: null, tills: null }`, so cashReportsBetween and firstCashReportDate run with the online scope and find nothing. The "Dünkü kasa raporu" row disappears even if Tuzla did not report yesterday, because firstDate is null. "Bugünkü kasa raporu" says "Henüz girilmedi" even after Tuzla has submitted. Kasa-farkı and integrity flags are never shown. Under the same scope, the zil (bellTills → currentTillBranch) and the Kasa page (currentTillBranch) read Tuzla, and the stock row (currentPhysicalBranch) also uses Tuzla. The screens contradict each other, and the row's link opens a Kasa page that shows the report as entered.
- **Kanıt:** `if (!admin) return { till: await currentTillBranch(), tills: null }; ... return { till: null, tills: scope === ALL_BRANCHES && tills.length > 1 ? ... : null };` For the admin, `till` is always null, so tillScoped runs the reads unscoped: currentBranchWhere gives `branch_id = 'online'`. currentTillBranch maps the online channel to Tuzla (docs/SUBE.md: "Tümü ya da online kanal seçiliyken Tuzla").
- **Önerilen düzeltme:** In src/server/data/today.ts, make cashView give the admin a single till whenever the per-branch "Tümü" view is not used. This copies the rule bellTills/cashNotifications already use in src/server/bell/kasa.ts.

```ts
async function cashView(admin: boolean): Promise<CashView> {
  if (!admin) return { till: await currentTillBranch(), tills: null };
  const [scope, branches, till] = await Promise.all([currentBranchScope(), listBranches(), currentTillBranch()]);
  const tills = tillBranches(branches);
  const many = scope === ALL_BRANCHES && tills.length > 1;
  return { till: many ? null : till, tills: many ? tills.map(({ id, name }) => ({ id, name })) : null };
}
```

With the online channel selected, tillScoped then runs cashReportsBetween and firstCashReportDate under withBranchScope("tuzla"), the same till the Kasa page and the bell use. A selected physical branch reads exactly as before. "Tümü" with several open tills still gets the per-branch view.
- **Denetçi:** I traced the path from loadToday and confirmed the finding. For an admin, cashView (src/server/data/today.ts:145-150) always returns `till: null`. With the laffogato.net scope, `tills` is also null, because the scope is not ALL_BRANCHES. tillScoped therefore calls cashReportsBetween and firstCashReportDate without withBranchScope. Both use subeKosulu, which is currentBranchWhere on cash_reports.branchId, so the query becomes `branch_id = 'online'`.

No report is ever stored under 'online'. Cash reports are written through currentTillBranch, which maps the online channel to Tuzla (branch-scope.ts:158; docs/SUBE.md: "Online kanalın kasası olmaz" and "online kanal seçiliyken Tuzla"). The online read therefore always returns `reports = []` and `firstDate = null`. In bugun/logic.ts:
- cashYesterdayOf returns null (`!till.firstDate`), so a missing Tuzla report for yesterday is never flagged.
- cashTodayOf shows "Akşam", or in the evening "Henüz girilmedi", even after Tuzla has submitted.
- adminFacts gets an empty list, so the cash-difference and integrity flags never appear.

Under the same cookie, three other screens read Tuzla through currentTillBranch: the bell (bell/kasa.ts bellTills and cashNotifications use `till = tills.many ? null : tills.till`), the Kasa page (kasa/page.tsx:217), and the row's `/panel/kasa?gun=` link target. The Bugün row and the Kasa page it links to disagree.

The online channel is reachable: the picker lists every active branch, including the seeded `online` row, and parseBranchScope accepts it. Nothing on the Bugün page or in the layout redirects or resets the online scope. No doc or plan marks this as intended. The CashView comment only says "tek şube seçiliyken okumalar zaten o şubenin", which is true for a physical branch but not for the channel. No test pins the cashView body; tests/bugun.test.ts only checks that the `safe(tillScoped(...))` wrappers exist.

Impact is limited to admins who leave the online channel selected, so severity is low, but the wrong output is concrete.

### 27. Genel bakış 'Yaklaşan ödemeler' kartı şube seçimini yok sayıyor; Bugün'deki aynı kart süzüyor

- **Yer:** `src/app/panel/page.tsx:579` (ayrıca: `src/server/data/today.ts:202`, `src/server/notify/digest.ts:47`, `docs/BUGUN.md:19`)
- **Senaryo:** The admin selects Marina. Bugün's "Yaklaşan ödemeler" card, built with loadUpcoming(undefined, { branch }), lists only Marina's and business-wide payments. Genel bakış, under the same selection, shows the same DashboardPayments card unfiltered, including Tuzla's items titled "Kira · Tuzla". Its overdue banner and the payment facts in "Bu ayın işleri" also count Tuzla's overdue payments inside Marina's branch view. BUGUN.md says the two cards are the same, and SUBE.md › Ödemeler says lists are filtered to the branch plus business-wide when a branch is selected.
- **Kanıt:** loadPayments() calls `loadUpcoming()` with no branch (page.tsx:149-151). `{upcoming ? <DashboardPayments items={upcoming.items} /> : null}` (l.579) and `paymentFacts(upcoming.items, ...)` use it directly. In today.ts adminFacts: `safe(loadUpcoming(undefined, { branch: await currentBranchScope() }))`. The unfiltered list is needed only for the cash-plan card, which must be business-wide.
- **Önerilen düzeltme:** In src/app/panel/page.tsx, keep the unscoped loadPayments() result for the cash plan (loadCashPlan inside withBranchScope(ALL_BRANCHES)) and for cariAlerts, which are business-wide either way. Build a separate branch-scoped list for the "Yaklaşan ödemeler" card and for paymentFacts/overdueNotice. When a branch is selected (model.ds.branchView is set, or currentBranchScope() !== ALL_BRANCHES), call `loadUpcoming(undefined, { branch: scope })` in the same Promise.all, or filter `upcoming.items` with a sourceId→branchId map built from `upcoming.reminders`, keeping non-reminder items and reminders whose branchId is null or the selected branch. Pass the scoped items to `<DashboardPayments items={...} />` and to `paymentFacts(scopedItems, ...)`. A second scoped loadUpcoming call is the better option, because it also drops the " · Marina" suffix the unscoped read adds, so the titles match Bugün.
- **Denetçi:** I traced the code path and it holds. DashboardContent in src/app/panel/page.tsx (admin only) calls loadPayments() at lines 149-151, which calls loadUpcoming() with no scope. In src/server/notify/digest.ts, loadUpcoming then sets `single = null`, so it reads every reminder and adds the branch name to each branch-owned title ("Kira · Tuzla"). That one result feeds three things:
- the DashboardPayments card (line 579),
- paymentFacts at line 299, which drives the red overdue banner (overdueNotice),
- the nakit planı card.

Every other screen that shows the same payments passes the selected branch to loadUpcoming:
- Bugün: today.ts:188, `loadUpcoming(undefined, { branch: await currentBranchScope() })`
- the zil: notifications.ts:492
- Ödemeler: hatirlaticilar/page.tsx:52

So with Marina selected, Genel bakış lists Tuzla's overdue rent and counts it in "N ödeme gecikti · X ₺". Bugün, the zil and Ödemeler leave it out. Genel bakış also shows its own notice in the same view: "Marina seçili: yalnız bu şube ve işletme geneli giderler".

I also checked whether this is intended, and nothing says it is:
- Commit 76d238d added branch filtering to "Ödemeler, Bugün ve zil" and did not touch panel/page.tsx.
- SUBE.md › Ödemeler names Ödemeler/Bugün/zil as filtered and sabah e-postası/Nakit planı/Vergi/haftalık özet as unfiltered. Genel bakış's payments card is in neither list.
- SUBE.md's "İşletme geneli ekranlar" exception covers only "Genel bakış'ın nakit planı kartı", not the payments card.
- BUGUN.md:19 says Bugün's card is "Genel bakış'taki kartın aynısı".
- No test asserts that Genel bakış uses the unscoped list.

The unscoped read exists only so the business-wide cash plan card can reuse it. Impact is display-only (wrong overdue count and list in a branch view), so severity is low.

### 28. Onaylar › Zayi kartlarının bağlamı isteğin şubesini yok sayıyor: Z ödenmez, rapor gönderildi mi ve kayıtlı ikram yanlış şubeden

- **Yer:** `src/server/data/waste-requests.ts:253` (ayrıca: `src/app/panel/onaylar/ops-cards.tsx:121`, `src/lib/waste-requests.ts:124`)
- **Senaryo:** Marina personeli 18 Kasım için geç ikram ister: 2× Latte M (payload.branchId='marina'). Marina'nın 18 Kasım raporu yok. Tuzla'nınki var: offRevenue 450 ₺, e-postası gitmiş. Yönetici 'Tümü'de Onaylar'ı açıyor. Kart 'Z ödenmez 450 ₺ · kayıtlı ikram menü değeri <iki şubenin ikramı>' yazıyor ve 'O günün kasa raporu gönderilmiş' diyor. Oysa isteğin kasasının raporu yok. Zayi silme kartında 'Kayıt o günün kasa raporu e-postasına girdi' uyarısı da öteki şubenin emailedAt'ına göre çıkabiliyor. 'O gün aynı kalemden N kayıt' satırı da iki şubenin kayıtlarını sayıyor. Yönetici onay kararını yanlış rakamlarla veriyor.
- **Kanıt:** 254: `db.select().from(s.wasteEntries).where(inArray(s.wasteEntries.date, days))` ve 255-258: cashReports `inArray(date, days)`. İkisinde de şube koşulu yok. 265: `const reportOf = new Map(reports.map((r) => [r.date, r]))`: aynı günün iki raporundan biri ötekini ezer. ikramValueOf (274) loadModelOnce modelinden, yani yöneticinin o anki şube seçiminden okuyor. p.branchId yükte olduğu hâlde kullanılmıyor. Kasa kartları ise isteğin şubesiyle okuyor (cash-out-requests.ts:269 `const sube = p.branchId ?? ...`).
- **Önerilen düzeltme:** In src/server/data/waste-requests.ts, loadWasteRequestQueue:
(1) Select branchId in both the wasteEntries and cashReports queries. Key the report map by `${date}|${branchId}` instead of date.
(2) Choose the branch per card. Late request: `const sube = p.branchId ?? DEFAULT_BRANCH_ID`. Delete request: `current?.branchId` (inReportMail already requires !gone, so a row exists).
(3) Read the report as `reportOf.get(`${date}|${sube}`)`.
(4) Filter dayEntries with `e.branchId === sube`.
(5) Filter otherPending to payloads with the same `(branchId ?? DEFAULT_BRANCH_ID)`.
(6) Compute ikramRecorded from a model scoped to that branch. WasteEntry carries no branch, so build one model per distinct request branch, e.g. `cache((b) => loadModel({ scope: b }))`, or pass a branch-to-model map from OpsRequests. asilposDays / asilposRefusal for the request should come from that same model.
(7) Optionally put the branch name on the card when more than one branch is open, as the cash cards do (docs/SUBE.md).
- **Denetçi:** I could not refute this. The card can be wrong, but only in what it shows. Approval still writes the entry to the right branch (core.ts:277 uses p.branchId ?? DEFAULT_BRANCH_ID), so the impact is wrong context for the admin's decision, not wrong data.

Code path: /panel/onaylar runs OpsRequests (ops-section.tsx), which calls loadModelOnce() and then loadWasteRequestQueue(model, now). loadModelOnce is loadModel() with no arguments, so the model follows the admin's current branch selection (dataset.ts:52 currentBranchScope; wasteEntries filtered by branchWhere at :138).

What goes wrong in loadWasteRequestQueue (src/server/data/waste-requests.ts):
- Line 254 reads wasteEntries by date only, and lines 255-258 read cashReports by date only. Neither filters by branch, although both tables have branch_id and cash_reports is unique on (date, branch_id) (schema.ts:1356).
- Line 265 keys reports by date alone, so when Tuzla and Marina both have a report that day, one silently replaces the other. When only Tuzla has one, a Marina request sees Tuzla's report.
- The report feeds report.exists and offRevenue (shown as "Z ödenmez", and ops-cards.tsx:121 prints "O günün kasa raporu gönderilmiş") and inReportMail on the delete card (line 340).
- sameDay (lines 296/313) counts entries from both branches, and otherPending (297) does too.
- ikramValueOf (274) reads model.countedWaste, which is the admin's selected scope (both branches under "Tümü", or the other branch), not the request's branch.
- The payload's branchId exists (lib/waste-requests.ts:124, set by proposeLateWaste from currentPhysicalBranch) but is never read here.

Intent: nothing in the docs or tests accepts this.
- docs/SUBE.md (Kasa raporu "Tümü"de) says single-till reads, explicitly including zayi, use the given branch or the till's branch. It says staff requests follow the request's own branch, not the admin's selection, and that the Onaylar card shows the branch by name when more than one is open.
- The sibling cash-out card does exactly that (cash-out-requests.ts:269 `const sube = p.branchId ?? ...`, with the report read `and(eq(date, day), eq(branchId, sube))`).
- The only test that uses the loader (tests/asilpos-komisyon-ikram-db.test.ts:359-403) runs with a single branch and asserts nothing about cross-branch behaviour.
- No branch test exempts this file, and nothing in docs/planlar marks it as accepted.

Scenario: a Marina-locked staff member requests a late ikram for 18 Nov. Marina has no report that day; Tuzla's report exists and has been emailed. The admin opens Onaylar on "Tümü" and sees Tuzla's Z ödenmez and the "rapor gönderilmiş" line, and the recorded-ikram figure mixes both branches. Any delete request for a Marina entry can likewise show the "kasa e-postasında" warning based on Tuzla's emailedAt. Severity: low.

### 29. Kasadan çıkan ve fotoğraf kaldırma onay kartları şubeyi göstermiyor, 'Günü aç' bağlantısı şubesiz

- **Yer:** `src/server/data/cash-out-requests.ts:198` (ayrıca: `src/server/data/cash-requests.ts:297`, `src/app/panel/onaylar/kasa-out-cards.tsx:209`, `src/app/panel/onaylar/kasa-cards.tsx:89`)
- **Senaryo:** Marina ve Tuzla açık. Yönetici panelde Tuzla seçiliyken Onaylar'da '21 Kasım kasadan çıkan ekleme · 400 ₺' kartını görüyor. Kart bu satırın hangi şubenin kasasına yazılacağını söylemiyor (onay payload.branchId ile Marina'ya yazar). 'Günü aç' bağlantısı `/panel/kasa?gun=2026-11-21` olduğu için Tuzla'nın gününü açıyor. Yönetici yanlış kasanın farkına ve satırlarına bakarak onaylıyor. Aynı ekrandaki düzeltme ve geç rapor kartları ise BranchBadge ile şubeyi yazıyor ve `&sube=` ile açılıyor.
- **Kanıt:** cash-requests.ts:297: `[...day.map(named), ...late.map(named), ...outs, ...closed]`: `outs` (cashOutCards) `named` ile şube adı almıyor. CashOutCard ve PhotoRemovalCard tiplerinde branch alanı yok. kasa-out-cards.tsx:209 ve 287: `href={`/panel/kasa?gun=${card.date}`}`; kasa-cards.tsx:89 kasaDayHref ise `&sube=` ekliyor. docs/SUBE.md: 'Personel istekleri (düzeltme, silme, geç rapor, kasadan çıkan) … Onaylar kartı birden çok şube açıkken şubeyi adıyla gösterir.'
- **Önerilen düzeltme:** 1) src/server/data/cash-out-requests.ts: add `branchId: string | null` to CardBase, or to both CashOutCard and PhotoRemovalCard. In cashOutCard, return `branchId: sube`. In photoCard, return `branchId: report?.branchId ?? null`.
2) src/server/data/cash-requests.ts, loadCashRequestQueue: run `outs` through the same branch mapping as the other cards, e.g. `...outs.map((c) => c.branchId ? named(c as typeof c & { branchId: string }) : { ...c, branch: null })`. Alternatively, loosen `named` so it accepts `branchId: string | null`.
3) Move BranchBadge and kasaDayHref out of src/app/panel/onaylar/kasa-cards.tsx into a small shared module, so kasa-out-cards.tsx can import them without a circular import (kasa-cards already imports kasa-out-cards). In kasa-out-cards.tsx, add `<BranchBadge branch={card.branch} />` to both Head badge sets. Change both links to `href={kasaDayHref(card)}`.
- **Denetçi:** I traced the code and the finding holds. In src/server/data/cash-out-requests.ts, cashOutCard works out the request's own branch (`sube`, line 269: payload.branchId, otherwise the row's branch, otherwise Tuzla) and uses it to load the card's lines, report and dayOpen. It never puts that branch on the returned card, and neither the CashOutCard nor the PhotoRemovalCard type has a branch field. photoCard has report.branchId in hand and drops it too. In src/server/data/cash-requests.ts:297, loadCashRequestQueue passes `day` and `late` through `named`, which adds `branch` when more than one till branch is open, but `outs` goes through unchanged. In src/app/panel/onaylar/kasa-out-cards.tsx, CashOutItem and PhotoRemovalItem show no BranchBadge. Their links are hard-coded as `/panel/kasa?gun=${card.date}` at lines 209 and 287. The sibling cards in kasa-cards.tsx use BranchBadge and kasaDayHref, which adds `&sube=`. Following the link without `sube`, src/app/panel/kasa/page.tsx shows the admin's current till branch: Tuzla when "Tümü" is selected (the per-branch overview only appears when `gun` is absent) or whichever branch is selected. So the link to a Marina request opens Tuzla's day when Tuzla or "Tümü" is selected, and the reverse happens for a Tuzla request while Marina is selected. Approval itself writes correctly: reviewCashOutRequestCore passes payload.branchId to writeCashOut. So there is no data corruption. The effect is a card that does not say which register it changes, plus a link to the wrong register's day. This contradicts docs/SUBE.md:150-153, which lists kasadan çıkan among the staff requests and says the Onaylar card names the branch when more than one branch is open. Nothing in docs/planlar/ or tests/ marks this as intentional. Commit 1c9dbb3 added branch display to the day and late cards only.

### 30. Weekly summary counts short cash reports as days, so one day short at both branches reads as '2 gun eksik'

- **Yer:** `src/lib/weekly/items.ts:154` (ayrıca: `src/server/weekly/collect.ts:150`, `src/lib/weekly/items.ts:183`)
- **Senaryo:** Last week Tuzla was 300 TL short on 20 October and Marina was 340 TL short on the same day. The cron reads both branches' reports, so `short` has 2 entries. The e-mail title says 'Kasa gecen hafta 2 gun eksik: toplam 640 ₺ · en cok 20 Ekim Sali: 340 ₺', although only one day was short. With one short report the title '20 Ekim Sali kasasi 640 ₺ eksik' does not name the branch. The 'N gun fazla' text has the same problem. salesLine in the same file was already fixed to count distinct dates ('iki subenin ayni gunku raporlari bir gun'); kasaItem was not.
- **Kanıt:** items.ts:139 `const short = last.filter((r) => r.cashDiff <= -CASH_TOLERANCE)`; :154 `Kasa gecen hafta ${short.length} gun eksik`; :148 `${over.length} gun fazla`. salesLine uses `new Set(rs.map((r) => r.date)).size`. The weekly kasa collector passes reports from all branches (collect.ts:132-150).
- **Önerilen düzeltme:** In src/lib/weekly/items.ts kasaItem, count distinct dates instead of report rows for the "gün" wording:

const shortDays = new Set(short.map((r) => r.date)).size;
const overDays = new Set(over.map((r) => r.date)).size;

- Title: `shortDays === 1 ? `${longDateTR(worst.date)} kasası ${tl(total)} eksik` : `Kasa geçen hafta ${shortDays} gün eksik: toplam ${tl(total)}``
- "en çok" part: show it only when `shortDays >= 2`.
- Over part: `overDays ? `${overDays} gün fazla: ${tl(sum(over.map((r) => r.cashDiff)))}` : null`

For consistency, the "en çok" day could be picked after summing shortages per date rather than per report. Add a test in tests/haftalik-ozet.test.ts with two reports on the same date, e.g. [rep("2026-10-20", -300), rep("2026-10-20", -340)], and expect the title "20 Ekim Salı kasası 640 ₺ eksik".
- **Denetçi:** I traced the path and it holds. The Monday cron (src/app/api/cron/gunluk/route.ts:133) calls runWeeklyStep, which calls buildWeekly and then collectWeekly. Nothing in that chain wraps the call in withBranchScope.

ctx.cashWeeks() calls cashReportsBetween, which filters with subeKosulu(), and subeKosulu() comes from currentBranchWhere. In the cron there is no branch cookie and no logged-in user, so requestBranchScope falls back to ALL_BRANCHES (parseBranchScope(null) returns "all"). It falls back the same way when cookies() throws. As a result the reports of both Tuzla and Marina reach kasaItem, one row per branch per day.

kasaItem (src/lib/weekly/items.ts:139-154) counts report rows, not days:
- `short.length === 1` chooses between the one-day title and the multi-day title.
- `Kasa geçen hafta ${short.length} gün eksik` uses the row count.
- `${over.length} gün fazla` uses the row count.

So if both branches were short on 20 Ekim (-300 and -340), the e-mail says "Kasa geçen hafta 2 gün eksik: toplam 640 ₺ · En çok 20 Ekim Salı: 340 ₺", although only one day was short.

Nothing marks this as intended:
- docs/HAFTALIK-OZET.md:38 and docs/planlar/haftalik.md:157 describe the count as days ("N gün eksik", "tek gün").
- The tests in tests/haftalik-ozet.test.ts:279-298 only use one report per day.
- Commit df1b07c ("haftalık özet ... şube başına") made the weekly summary handle two branches. It changed salesLine to count distinct dates, with the comment "iki şubenin aynı günkü raporları bir gün", and made the carry check per branch. It left kasaItem's day count unchanged.

The impact is real but small. One number in the weekly e-mail is wrong, so a single day reads as several. No money amounts are wrong.

The second half of the finding is not a defect. The one-report title ("20 Ekim Salı kasası 640 ₺ eksik") does not name the branch, but that is only wording.

### 31. A 'Kasadan' supplier payment made with 'Tümü' selected silently creates its cash line in Tuzla's till; the dialog never shows which branch's till it uses

- **Yer:** `src/server/cari/entries.ts:249` (ayrıca: `src/app/panel/tedarikciler/cari-payment-dialog.tsx:171`, `src/server/actions/cari-options.ts:68`, `src/server/branch-scope.ts:166`)
- **Senaryo:** Tedarikçiler is a business-wide screen, so the admin is usually on 'Tümü'. They record a Marina supplier delivery paid from Marina's till: Ödeme ekle › Kasadan › 'Bu ayrı bir ödeme, kasaya yeni satır ekle'. writePayment inserts a Teslim cash_outs row with branchId = currentTillBranch(), which is Tuzla under Tümü or online. Tuzla's kasa report for that day now expects that much less cash, and Marina's does not. Both branches' cash counts are off by the payment amount, and nobody is told. The same path runs for 'Borç ekle › Ödendi › Kasadan' (writeDebt → writePayment). The 'existing line' picker (loadKasaLines) also lists both branches' Teslim lines with no branch label. SUBE.md requires that when 'Tümü' falls back to Tuzla, 'form kullanıcıya hangi şubeye yazdığını gösterir'.
- **Kanıt:** entries.ts:249: `.values({ date: input.date, kind: "teslim", amount, store: card.name, ..., branchId: await currentTillBranch(), ... })`. cari-payment-dialog.tsx:171 shows only 'Bu ayrı bir ödeme, kasaya yeni satır ekle', with no branch in the props or text. cari-options.ts loadKasaLines selects cash_outs by date only and returns no branch.
- **Önerilen düzeltme:** Minimal fix (disclosure, matching the Kasa page):
- Compute the till branch on the server for the Tedarikçiler card page: currentTillBranch() + listBranches(), plus whether more than one physical branch is active and whether the scope is not that branch.
- Pass the branch name through supplier-client.tsx into CariPaymentDialog, debt-dialog.tsx and KasaLinePicker.
- Under the 'kasaya yeni satır ekle' option, show '<Şube> kasasına yazılır; başka şubenin kasası için soldan o şubeyi seçin'. Show it only when more than one physical branch is active and the scope is 'Tümü' or online.
- In loadKasaLines, also select s.cashOuts.branchId and show the branch name on each existing line in KasaLinePicker when more than one branch is active.

Better fix (choice):
- Extend cashOutSchema in src/server/actions/cari.ts to {mode:'new', branchId?: string}.
- Validate branchId with knownBranchId(listBranches()) and allow physical branches only.
- In writePayment (entries.ts:249), use `branchId: choice.branchId ?? await currentTillBranch()`.
- Add a till selector to the Kasadan option. It defaults to the selected physical branch and requires an explicit choice under 'Tümü' when more than one physical branch is active.
- **Denetçi:** I traced the path and could not refute it. The defect is the missing disclosure. Sending the line to Tuzla under 'Tümü' is the documented rule, so that part is not a defect.

Code path:
- saveSupplierPayment (src/server/actions/cari.ts) accepts cashOut {mode:'new'} with no branch field (cashOutSchema, line 48).
- Borç ekle › Ödendi takes the same route: it passes d.paid.cashOut to writePayment.
- writePayment (src/server/cari/entries.ts:245-249) inserts the Teslim cash_outs row with branchId = await currentTillBranch().
- currentTillBranch (src/server/branch-scope.ts) returns Tuzla when the scope is 'Tümü' or online.
- The scope defaults to 'Tümü' when there is no cookie (parseBranchScope returns ALL_BRANCHES for null), so an admin is often on 'Tümü'.
- The endpoints are requireAdmin-only. Staff locked to a branch never reach this path, and nothing else stops the 'Tümü' case.

Intent:
- SUBE.md 'Yazarken hangi şube' does say kasadan çıkan para goes to Tuzla under 'Tümü'.
- The same rule comes with a duty to show the branch to the user:
  - branch-scope.ts BranchScopeState.writeId: 'form kullanıcıya hangi şubeye yazdığını gösterir'
  - currentWriteBranch: 'ekranlar hangi şubeye yazdıklarını kullanıcıya gösterir'
  - docs/planlar/sube.md: 'Yazma formlarında hangi şubeye yazıldığı kullanıcıya gösterilecek'
  - SUBE.md 'Kasa raporu Tümü'de': 'sayfa bunu not olarak yazar'
- The Kasa page meets this duty for exactly the same kind of cash_outs row (ScopeNote/TillBadge in src/app/panel/kasa/page.tsx:715-735: '... kasadan çıkanlar Tuzla'nın kasasına yazılır. Başka bir şubenin kasası için soldan o şubeyi seçin').
- The cari path does not:
  - Nothing under src/app/panel/tedarikciler mentions a branch or şube.
  - KasaLinePicker shows only 'Bu ayrı bir ödeme, kasaya yeni satır ekle'.
  - loadKasaLines (src/server/actions/cari-options.ts) filters by date only and returns no branchId.

TEDARIKCILER.md says the new line shows in 'personelin Kasa'sında' so the staff counting that till see the outflow. When the admin meant Marina's till, the line lands in Tuzla's till instead. Tuzla's staff then see an outflow that never happened, Marina's do not see the real one, and both branches' cash differences are off by the amount.

No test asserts otherwise, and nothing in docs/planlar accepts the silent behaviour. Severity is low: data lands where the documented rule says, but the user cannot see it, which is inconsistent with the Kasa screen for the same record.

### 32. Ayarlar › Stok değerleme önizlemesi seçili şubenin sayımıyla hesaplanıyor; ayar ise işletme genelinin kâr-zararını değiştiriyor

- **Yer:** `src/app/panel/ayarlar/page.tsx:395` (ayrıca: `src/app/panel/ayarlar/page.tsx:372`, `src/server/data/dataset.ts:100`, `src/server/data/dataset.ts:162`)
- **Senaryo:** Yöneticinin seçicisi Marina'da kalmış (çerez bir yıl yaşar). Ayarlar › Stok değerleme'yi açıyor: valuationRows yalnız Marina'nın sayılmış aylarını ve miktarlarını kullanıyor. stock:* elle girişleri süzüldüğü için her satırda overridden=false, openingOverrides boş. "Şimdi / Seçilenle / Kâr etkisi" sütunları Marina'nın kısmi stoğundan hesaplanıyor; elle kapanışı girilmiş ay da etkilenmiş gibi görünüyor. Oysa Kaydet işletme genelini değiştiriyor: Tümü'nün kapanış stoğunu ve kârını. Sahip FIFO başlangıcını yanlış önizlemeye bakarak seçiyor.
- **Kanıt:** ayarlar/page.tsx:395 `loadModel()` kapsam verilmeden çağrılıyor (currentBranchScope → çerez); :372-375 `model.valuationPreview(m, from)` ve `model.closingStock(m).overridden`, :384 `model.ds.pnlEntries.filter((e) => e.rowKey === "stock:opening")`. Şube kapsamında dataset.ts:100 sayımları süzüyor, :162 stock:* satırlarını atıyor. Stok değerleme işletme geneli bir ayar (settings.stokFifoBaslangic).
- **Önerilen düzeltme:** In src/app/panel/ayarlar/page.tsx › SettingsContent, build the valuation card from a Tümü model, using the same pattern as src/app/panel/page.tsx:209. Load `const all = model.ds.branchView ? await loadModel({ scope: ALL_BRANCHES }) : model;` (import ALL_BRANCHES from "@/lib/branches"). Then use `all` for fifoMonthOptions(all.countedMonths, all.fifoStart, ...), valuationRows(all, fifoOptions) and `all.ds.pnlEntries.filter((e) => e.rowKey === "stock:opening")` passed to StockValuationCard. Optionally note on the card that the preview is business-wide.
- **Denetçi:** Code path confirmed. SettingsContent in src/app/panel/ayarlar/page.tsx:395 calls loadModel() with no scope, so it follows the sidebar selector cookie (currentBranchScope → requestBranchScope). The selector is shown on /panel/ayarlar too: BranchPicker sits in the sidebar on every page. With Marina (or Tuzla) selected, readDataset does three things:
- It filters stockCounts by branch (dataset.ts:100), so model.countedMonths and valuationPreview see only that branch's counts.
- It drops every stock:* pnl entry through branchPnlEntry (branches.ts:161-169, which returns false for anything that is not manual/fixed/stopaj). So closingStock(m).overridden is always false and no row gets the "Elle" badge.
- Because of that, the openingOverrides filter for "stock:opening" (page.tsx:414) is always empty.

fifoMonthOptions also starts from the branch's first counted month, so earlier start months drop out of the dropdown unless one is already saved.

In branch view the P&L does not use stock at all. stockFlow returns method "sube" with opening 0 and closing 0 (engine.ts:1951-1962), and pnlMonth sets opening and closing to 0 (engine.ts:2090-2098). The saved setting (settings.stokFifoBaslangic) changes the Tümü P&L, which uses the combined counts of both branches. So the card's "Kâr etkisi" column under a branch scope matches neither the branch's P&L (always 0 change) nor the business's (computed from combined counts). It also hides months whose closing was entered by hand.

On intent, docs/SUBE.md lists the business-wide screens that always read Tümü (Vergi, Nakit planı, Tutarlılık, Excel). Ayarlar is not on that list, and nothing in docs/STOK-DEGERLEME.md, docs/planlar or the tests says the preview should be per branch. STOK-DEGERLEME.md §4 says "Gelir-giderde açılışı elle girilmiş ay etkilenmez" and that the preview shows each month's profit effect. Both statements fail under a branch scope. The line "FIFO değerleme şube içinde" in SUBE.md is about the per-branch stock count screen, not about the profit effect of the business-wide setting.

Impact is low: the screen misleads but no data is written wrongly.

### 33. Karaoke eşitlemesi okunamayan (atlanan) rezervasyonu 'sitede silinmiş' sayıp panelden siliyor

- **Yer:** `src/server/karaoke/sync.ts:223` (ayrıca: `src/lib/karaoke/site.ts:66`)
- **Senaryo:** Site eksiksiz (`complete: true`) bir yanıt gönderiyor ama bir rezervasyon satırı panelin şemasından geçmiyor. Örneğin `hours` tamsayı değil, `startHour` 30'dan büyük ya da `endsAt <= startsAt`. `parseSiteResponse` satırı atlayıp `skipped++` yapıyor. `seen` yalnız okunan satırlardan kurulduğu için o rezervasyonun paneldeki satırı `gone` listesine giriyor ve siliniyor. Bu satırla birlikte sayacın uzatması ve 'bitti' işareti, doluluk haritasının cancelledAt/bookedAt alanları ve rezervasyon bar ekranından gidiyor. Satır bir sonraki çekmede okunursa `prev` yok sayılıp 'created' olayı doğuyor: cihazlara sahte bir 'Yeni rezervasyon' bildirimi ve zil gidiyor.
- **Kanıt:** sync.ts:223-228: `if (snapshot.complete) { const seen = new Set(snapshot.reservations.map((r) => r.id)); const gone = existing.filter((r) => r.externalId && !seen.has(r.externalId))...; await tx.delete(s.karaokeSessions)...` Atlanan satır sayısı (`snapshot.skipped`) bu karara girmiyor. site.ts parseSiteResponse: `if (r.success && ...) reservations.push(...) else skipped++;`. Modülün kendi notuna göre bozuk satır 'eşitlemeyi durdurmaz'; KARAOKE kuralı ise yalnız 'sitede artık olmayan' rezervasyonun kalkmasını söylüyor.
- **Önerilen düzeltme:** In src/server/karaoke/sync.ts (around line 223), delete rows only when the panel read every row in the response: `if (snapshot.complete && snapshot.skipped === 0) { ... }`. A more precise option: in src/lib/karaoke/site.ts `parseSiteResponse`, also return the ids of skipped rows whose `id` field is still a readable non-empty string (e.g. `skippedIds: string[]`). Then in sync.ts add them to `seen`: `const seen = new Set([...snapshot.reservations.map((r) => r.id), ...snapshot.skippedIds])`. With that, an unreadable row keeps its existing panel copy instead of being deleted. Optionally, add `skipped` to the manual-sync toast in src/app/panel/karaoke/karaoke-board.tsx.
- **Denetçi:** I traced the code path and it reaches the delete. On a ping, page, manual, cron or screen sync, `syncKaraoke` calls `parseSiteResponse` (src/lib/karaoke/site.ts:51-61). Any row that fails `reservationSchema`, or has endsAt <= startsAt, only increments `skipped` and is left out of `snapshot.reservations`. The panel expects such rows: the module comment and docs/KARAOKE.md:212-213 both say a bad row is skipped. In src/server/karaoke/sync.ts:223-229, `seen` is built only from the parsed reservations. Any panel row with a matching externalId in the window [yesterday, +90d] is then deleted whenever `snapshot.complete` is true. Nothing checks `snapshot.skipped` first, and the row's id is never kept. So a reservation that still exists on the site, but that the panel could not read this time, is deleted.

This contradicts the stated rule. The function's own doc comment (sync.ts:106), docs/KARAOKE.md:42 and the finding's citation all say only a reservation that is no longer on the site should be removed. No test sets deletion of skipped rows as intended. tests/karaoke.test.ts:101 only checks the skipped count, and tests/karaoke-baglanti.test.ts:146 only checks the version bump. Nothing in docs/planlar accepts this behaviour.

Consequences:
- The panel-only columns of that row are lost: extraMinutes, endedAt/endedBy, lastEvent, and the cancelledAt that was worked out.
- When the row parses again later, `prev` is null, so detectEvent reports 'created'. If the reservation has not ended yet, devices get a false "Yeni karaoke rezervasyonu" push and the bell rings.
- The skipped count is never shown. The manual-sync toast (karaoke-board.tsx:557) only says "N kaldırılan".
- If the site ever changes a field type (for example startHour sent as a string), every site row in the window is skipped. All of them are then deleted together, and each one is announced again later.

Why low severity and medium confidence: it only happens when the external site sends a row the panel's schema rejects. That breaks the contract between the two projects, but the panel is clearly written to expect it.

### 34. 'Kasaya işle' rows hidden on tap are not restored when the save fails with a network or stale error

- **Yer:** `src/components/panel/pos-checklist.tsx:85` (ayrıca: `src/components/ui/action-error.ts:120`, `src/app/panel/kasa/fiyatlar/page.tsx:48`)
- **Senaryo:** On 'Kasadaki fiyatlar', staff tap 'işaretle' on 'Latte Medium' while the connection drops, or after a redeploy that makes the action id stale. setDone hides the row before the action runs. markPosDone throws, and useActionTransition only toasts 'Kaydedilemedi…'. `forget(ids)` only runs on `{ok:false}`, so the row stays hidden although nothing was marked. The props are unchanged and state survives navigation, so the change that still has to go into ModPOS disappears from the list and cannot be retried until a full reload. undo() has the mirror problem: on a throw the row comes back although it is still marked.
- **Kanıt:** line 85 `setDone((m) => new Map([...m, ...list.map(...)]));` then `start(async () => { const r = await markPosDone(...); if (!r.ok) { forget(ids); ...`. useActionTransition (ui/action-error.ts) catches throws with toastUnreachable and runs no rollback. Its own doc says callers must undo optimistic changes on throw (tryAction).
- **Önerilen düzeltme:** In src/components/panel/pos-checklist.tsx, add the rollback inside the transitions and re-throw the error so useActionTransition still shows the toast.

mark():
  start(async () => {
    let r: Awaited<ReturnType<typeof markPosDone>>;
    try { r = await markPosDone(list.map((i) => ({ productId: i.productId, price: i.price }))); }
    catch (e) { forget(ids); throw e; }
    if (!r.ok) { forget(ids); return void toast.error(r.error); }
    ...
  });

undo():
  start(async () => {
    let u: Awaited<ReturnType<typeof undoPosMarks>>;
    try { u = await undoPosMarks(marks.map((m) => m.markId)); }
    catch (e) { setUndone((s) => new Set([...s].filter((id) => !marks.some((m) => m.markId === id)))); throw e; }
    ...
  });

As an alternative, use tryAction (action-error.ts) and run the same rollback when it returns undefined. action-error.ts needs no change.
- **Denetçi:** I could not refute it. The bug is real and low severity.

Code path: in pos-checklist.tsx, mark() hides the rows before the action runs. Line 85 does `setDone(...)`, then `start(async () => { const r = await markPosDone(...); if (!r.ok) { forget(ids); ... } })`. `start` is useActionTransition (src/components/ui/action-error.ts:120-134). When markPosDone throws, that wrapper only calls toastUnreachable and does no rollback, so the `forget(ids)` line is never reached. markPosDone throws on a network drop, or with an unrecognized-action error when the action id is stale after a redeploy. The action never reached the server, so `refresh()` never ran and the `items` props do not change. `done` still holds the same productId→since pair, so the row stays filtered out of `visible`.

next.config sets `cacheComponents: true`. Per node_modules/next/dist/docs/.../preserving-ui-state.md, useState then survives client navigation (Activity hidden mode). So the row stays hidden until a full reload.

Failure scenarios:
- Staff on the 'Kasadaki fiyatlar' page tick 'Latte Medium' while offline. They see 'Kaydedilemedi … yeniden deneyin', but the row is gone, so there is nothing to retry.
- An admin uses 'Hepsini işaretle' and the action throws. The page shows the 'Kasa güncel' empty state, although nothing was marked.
- undo() has the mirror problem. `setUndone` removes the mark from 'Son işaretledikleriniz', but on a throw it is not restored. The mark is still in the DB and cannot be undone again from the page.

Intent: none of the docs or tests says this is intended.
- tryAction's doc comment (action-error.ts:61-66) says the caller rolls back its optimistic change on a throw.
- KALAN-ISLER.md (B20/E-51) and the action guard aim to stop optimistic changes from being lost or left wrong on a throw.
- tests/arayuz-duzeltmeleri.test.ts:178 asserts this rollback for the karaoke alarm ('bitiş geri alınır').
- No test asserts the pos-checklist behaviour. The guard only checks that the rejection is caught somewhere, and useActionTransition does catch it.

Restoring the row is also safe if the request did reach the server: tapping it again returns the product in `already` ('zaten işaretlenmiş').

### 35. Staff locked to a branch can open and fill another branch's checklist by URL

- **Yer:** `src/app/panel/kontrol/[id]/page.tsx:56` (ayrıca: `src/server/data/checklists.ts:61`, `src/server/checklists/store.ts:472`, `docs/KONTROL-LISTELERI.md:72`)
- **Senaryo:** A staff member locked to Marina opens /panel/kontrol/<id of a Tuzla-only list>, for example from a bookmark or an id taken from a shared link. loadRunView has no branch filter, and writeAnswer only checks active/staffAllowed. They can therefore answer and complete Tuzla's opening checklist, which then shows as done for Tuzla. docs/KONTROL-LISTELERI.md says locked staff only see and fill their own branch's and all-branch lists.
- **Kanıt:** server/data/checklists.ts:61 `loadRunView(...) { return store.loadRunView(getDb(), templateId, day, ctxOf(now)); }`: ctxOf has no branch, unlike listCtxOf. store.ts:472 checks only `me.role !== "admin" && !tpl.staffAllowed`. docs/KONTROL-LISTELERI.md:72-73 says '…yalnız o şubenin ve bütün şubelerin listelerini görür ve doldurur'.
- **Önerilen düzeltme:** Add a branch guard for staff whose account is locked to a branch. CurrentUser already carries branchId for staff (src/server/auth/dal.ts:68). Use staffBranchLock() from src/server/branch-scope.ts, which also drops the lock when the branch is inactive.
1) src/app/panel/kontrol/[id]/page.tsx: after loading the view, add `const lock = admin ? null : await staffBranchLock(); if (lock && view.template.branchId && view.template.branchId !== lock) notFound();`. Alternatively, redirect to /panel/kontrol, as line 56 does.
2) src/server/checklists/store.ts: give writeAnswer and checkPhotoTarget a `lock: string | null` parameter, or put it on WriteDeps. After the staffAllowed check, add `if (me.role !== "admin" && lock && tpl.branchId && tpl.branchId !== lock) throw new ChecklistError("Bu liste başka şubenin.", 403);`.
3) src/server/data/checklists.ts: in writeChecklistAnswer and checkPhotoTarget, pass `await staffBranchLock()` into those store calls. Both callers (the server action and /api/kontrol/foto) run inside a request, so the lock resolves.
- **Denetçi:** I traced the code path and found no guard anywhere on it. In src/app/panel/kontrol/[id]/page.tsx, RunContent calls loadRunView. That goes through src/server/data/checklists.ts:62, which passes ctxOf(now). ctxOf has no `branch`, unlike listCtxOf. It then reaches store.loadRunView (store.ts:316), which calls loadTemplates with only `ids` and no branch filter. The page's only role check is line 56 (`!admin && !view.template.staffAllowed`). There is no layout under /panel/kontrol, and the proxy only checks the session cookie.

The write paths have the same gap. The answerChecklistItem server action calls writeChecklistAnswer, which reaches store.writeAnswer. That function checks only active, staffAllowed and the date (store.ts:470-473). POST /api/kontrol/foto calls checkPhotoTarget (store.ts:612-616), which also has no branch check. So a Marina-locked staff member can open, answer and complete a Tuzla-only list (template.branchId = 'tuzla') by its numeric id. The run is then marked completed for Tuzla, with completedBy set to that person.

Every other entry point is branch-scoped, so the URL is the only way in:
- the list page, Bugün, the bell and Geçmiş use listCtxOf / currentBranchScope;
- e-mail alerts use alertReaches;
- the Geçmiş link at gecmis/page.tsx:168 only covers lists that are already scoped.

Intent check: docs/KONTROL-LISTELERI.md (Şubeler section) says a locked staff member 'yalnız o şubenin ve bütün şubelerin listelerini görür ve doldurur'. docs/SUBE.md:164 says kontrol listeleri 'o şubeye yazılır ve o şubeden okunur'. I found nothing in docs/planlar accepting this gap. No test asserts unscoped run views: tests/kontrol-listeleri-db.test.ts:285 only covers the scoped list and history loaders.

Severity is low. It needs an authenticated staff member with a direct URL, for example a bookmark from before their account was locked to a branch, or a link someone shared.
