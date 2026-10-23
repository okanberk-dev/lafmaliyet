# Suggestion 5: match suppliers by tax number (VKN / TCKN)

Branch base: `claude/oneriler` (= main). Read `AGENTS.md` first. Next 16 docs are in `node_modules/next/dist/docs/`.

## 1. Goal

Today an invoice reaches a supplier only by **name**. `supplierMatchKey` compares the invoice's `supplier` text with the
card's name or aliases (`src/app/panel/tedarikciler/logic.ts` `cardIndex` / `cardFor` / `groupSuppliers`). Names for
the same company come in different forms. Excel rows use the owner's short names ("Kaldi"). Paraşüt bills carry the
Paraşüt contact name, which `ctx.alias` sometimes shortens. Inbound e-invoices carry the GİB legal name
("KALDI KAHVE TİC. A.Ş."). So one company can show up as two or three suppliers, and the owner has to add aliases by hand.

The fix: store the supplier's tax number on every Paraşüt invoice. That covers bills (contact `tax_number`, or the
e-document's `from_vkn`), e-invoices (`from_vkn`) and UBL (`AccountingSupplierParty`). Existing rows are backfilled.
Tedarikçiler then groups invoices by name **and** by tax number.

The same resolution must drive every place that maps an invoice to a supplier card: the grouping, slugs, ⌘K, the
"Tedarikçinin sayfası" link in Faturalar, the estimated due date (Ödemeler, bell, digest, postpone) and the
paid-on-delivery rule in sync. Otherwise screens disagree.

These rules keep it free of surprises:
- An explicit name or alias always wins over the tax number.
- Invalid and placeholder numbers never merge anything.
- Card data is never written silently.
- Conflicts are shown to the owner, who has one tap to merge.

## 2. Matching rules (the core decision)

Every invoice is resolved from its pair `(name key K, tax key T)`. `K = supplierMatchKey(supplier)`.
`T = taxKey(supplierTaxNumber)`: digits only, 10 or 11 digits, a valid VKN/TCKN checksum and not a dummy number, else
null. The resolution is a pure function of the pair, the cards and the whole set of pairs. So every caller that passes
the same pairs gets the same groups and slugs.

1. **Name first (today's rule).** If K is a card's name or alias, the invoice goes to that card (`via: "ad"`). This is
   the owner's escape hatch: an explicit alias can always pull an invoice to a card, and can always keep two firms apart.
2. **Card's own tax number.** If T equals the `taxNumber` of exactly one card, the invoice goes to that card
   (`via: "vergi"`). If two or more cards carry the same number, the number is ambiguous: it is not used for either
   card, and both cards show a conflict note.
3. **Linked through other invoices (union-find).** Nodes are name keys `n:K`, tax keys `t:T` and cards `c:id`.
   - Edges: card ↔ its name and aliases; card ↔ its own tax key (only when the number is unique to that card, as in step
     2); `n:K ↔ t:T` for every invoice pair where both exist and K is not the placeholder.
   - The invoice's node is `t:T` if it has T, otherwise `n:K`.
   - If the component holds **one** card, the invoice goes to that card (`via: "vergi"`). Example: card "Kaldi" with no
     VKN on the card. One Paraşüt "Kaldi" invoice carries VKN X, so "KALDI KAHVE TİC. A.Ş." with X joins Kaldi.
   - If it holds **no** card but at least one name, it joins one cardless group per component.
   - If it holds **two or more** cards (a conflict): when the invoice's VKN-carrying siblings with the same name all went
     to one card in step 2 (`nameTaxCards[K]` has size 1), the invoice follows them. Otherwise step 4.
4. **Fallback (today's rule).** A cardless group by its own name key (`ad:K`). This includes the placeholder
   "Paraşüt tedarikçisi" when its VKN links to no named invoice.

Consequences, which the tests must pin:
- With no tax numbers anywhere, the output is identical to today's `groupSuppliers`. Excel-only data cannot regress.
- An Excel row without a VKN joins the VKN group when its name matches a name used with that VKN (the name bridge).
- A name already used with two VKNs (for example via `ctx.alias` prefix aliasing: "Metro" ← "Metro Turizm") stays one
  group, as today. The page lists both numbers so the owner can spot it. Nothing is split.
- A placeholder invoice ("Paraşüt tedarikçisi") that carries a VKN moves to its real supplier right away. The
  placeholder name never bridges anything.
- Invalid-checksum and dummy numbers are stored but never used for matching. Dummy list: `1234567890`, `1111111111`,
  `11111111111`, `2222222222`, `22222222222`, `0000000000`, `00000000000`, `9999999999`, `99999999999`. `1234567890`
  passes the VKN checksum, which is why it is listed. The local seed card "Sütaş" uses it, so it is a no-op locally.

**Group key and slug** (stable, the same for every caller):
- Card group: `supplierMatchKey(card.name)`, unchanged.
- Cardless group: the alphabetically **smallest** non-placeholder name key among its invoices. It needs no dates, so
  `slugGroups` and `search.ts` get the same slug as the ledger. A single-name group is exactly as today.
- Placeholder-only group: the placeholder key, as today.
- Display name is unchanged: `card?.name ?? names[0]` (the spelling on the newest invoice).
- A cardless group's key can change when a new name with a smaller key joins. That is rare. It is covered by the slug
  redirect in §6.4 and by `keys` matching in `findGroup` (§6.3).

## 3. User-facing behaviour (Turkish UI texts)

Mobile first (390 px): every notice is a wrapping flex row and its button becomes full width (`max-sm:w-full`), like
`ReviewNotice`. Desktop keeps the same row.

### 3.1 Tedarikçiler list (`/panel/tedarikciler`)
- No new controls. Suppliers whose invoices share a VKN show as **one row**. The names line lists every name.
- `missingInfo` no longer shows the "Vergi no yok" badge when the invoices carry a single valid VKN.
- Search (`supplierHaystack`) and ⌘K also match the VKNs found on invoices, not only the card's number.

### 3.2 Supplier page (`/panel/tedarikciler/<slug>`)

**CariPanel with a card:**
- Vergi no row: if the card has no `taxNumber` but the invoices carry exactly one valid VKN, show
  `7810030532 · faturalardan` with the copy button. The card is **not** written; Düzenle prefills it (§3.3).
- New row **"Aynı vergi no"**: the names that joined only through the tax number (`viaTax`), for example
  `KALDI KAHVE TİC. A.Ş., Kaldi Kahve Ltd`. Hidden when empty.
- Note (text-xs, warn colour) when the card's number differs from the single VKN on the invoices:
  "Faturalardaki vergi no farklı: 4567890128 (8 fatura). Karttaki numarayı kontrol edin."
- Note (text-xs, muted) when the invoices carry 2 or more VKNs: "Faturalarda 2 ayrı vergi no var: 7810030532
  (12 fatura), 4567890128 (1 fatura). Biri başka firmaysa o faturanın tedarikçi adını Faturalar'dan düzeltin."

**Cardless page:**
- Header description: `Faturalardaki adı: Kaldi, KALDI KAHVE TİC. A.Ş. (aynı vergi no)`. "(aynı vergi no)" appears
  only when `viaTax` is non-empty.
- The empty CariPanel text gets "Vergi no faturalardan: 7810030532." when one VKN is known.

**Shared-VKN banner** (above the stats, the same style as the "listeden kaldırıldı" strip; `role="status"`):
- Other side is a card: "“Kaldi Kahve” de aynı vergi nosunu (7810030532) taşıyor; faturaları ayrı duruyor. Aynı
  firmaysa birleştirin." Button **Birleştir** opens a ConfirmDialog:
  - Title: "“Kaldi Kahve” buraya katılsın mı?"
  - Bullet: "Adı ve diğer adları buraya diğer ad olarak eklenir; faturaları bu sayfada toplanır."
  - Bullet: "Burada boş olan bilgiler (unvan, IBAN, telefon…) ondan doldurulur; dolu olanlar değişmez."
  - Bullet, only if both IBANs exist and differ: "İki IBAN farklı: buradaki (TR12 …) kalır, onunki (TR34 …) alınmaz."
  - Bullet: "“Kaldi Kahve” ayrı tedarikçi olarak kalkar; bildirimdeki Geri al ile geri alınır."
  - Confirm label: "Birleştir".
  - After merging, a success toast: "“Kaldi Kahve” buraya katıldı" with a **Geri al** action (10 s). Undo toast: "Birleştirme geri alındı".
- Other side is cardless (rare: only when two cards carry the same explicit number): "“X” adıyla gelen faturalarda da
  bu vergi no var. Aynı firmaysa Düzenle'den diğer adlara ekleyin." with a link **Sayfasına git →**. No merge button.
- One banner per other supplier. At most 3 are shown, followed by "+N" text.

**Empty invoices section text** (line ~613 of supplier-client.tsx), replace with: "Bu tedarikçinin faturası Paraşüt'e
gelince her sabah kendiliğinden buraya düşer; eskileri “Geçmiş faturaları al” getirir. Faturalar adla ve vergi
numarasıyla eşleşir: aynı vergi noyla başka adla gelen fatura da buraya düşer. Kâğıt ya da e-Arşiv faturayı
Faturalar'dan elle ekleyebilirsiniz."

**Payment request:** the "Vergi no:" line falls back to the group's inferred VKN. This also works without a card.

### 3.3 Card dialog (Düzenle / Tedarikçi ekle / Bilgileri ekle)
- **Prefill:** when a card is opened from a cardless page that has one inferred VKN, the VKN field is prefilled and
  marked with the existing "Faturadan dolduruldu; kontrol edin" hint (it goes into the `filled` set).
- **Preview** under the VKN field (text-xs; computed live from `taxPreview` and the server-passed `taxIndex`; shown only
  for a valid `taxKey`):
  - When invoices would join: "Bu vergi noyla gelen 9 fatura da bu tedarikçide toplanır: KALDI KAHVE TİC. A.Ş. (8),
    Kaldi Kahve Ltd (1)."
  - When invoices stay with another card: "“Opera AVM” adıyla eşleşen faturalar orada kalır (ad önce gelir)."
  - When another card already carries the number: "Bu vergi no “Kaldi Kahve” tedarikçisinde de kayıtlı: vergi noyla
    eşleşme ikisinde de çalışmaz, faturalar adlarına göre ayrılır. Aynı firmaysa birleştirin."
  - When the checksum fails, the existing warning gains: " · faturalar bu numarayla eşleşmez".
- **Diğer adlar** hint gains: "Aynı vergi noyla gelen faturalar ad farklı olsa da kendiliğinden buraya düşer."
- **After save:** if another card has the same `taxKey`, the success toast description adds "Bu vergi no “A”
  tedarikçisinde de kayıtlı; faturalar adlarına göre ayrılır." It is a warning only and the save is not blocked.

### 3.4 Faturalar
- In the invoice dialog, the link "Tedarikçinin sayfası →" now resolves by `(name, VKN)`, so it opens the merged
  supplier. Before the link, add `Vergi no 7810030532 · ` when the invoice has a number.
- Totals, breakdowns, the "N tedarikçi" count and Gelir-gider "Mal alışları" rows stay name-based (owner decision D3).

### 3.5 Paraşüt page
- The sync summary line (history list and activity log) adds "N faturaya vergi no yazıldı". N counts both new captures
  and backfill.
- No new button: the backfill runs inside every sync until it is done (§5.4).

## 4. Data model

`src/server/db/schema.ts`, table `invoices`, one new nullable column:

```ts
/**
 * Tedarikçinin VKN / TCKN'si (yalnız rakam, 10 ya da 11 hane): Paraşüt gider faturasında e-belgenin `from_vkn`'i ya da
 * kişi kartının `tax_number`'ı, gelen e-faturada `from_vkn`, UBL'de satıcının kimliği. Elle ve Excel'den girilen
 * faturada boş. Tedarikçiler aynı (geçerli) vergi nolu faturaları tek tedarikçide toplar (logic.ts supplierResolver).
 * Kontrol hanesi tutmayan ya da yer tutucu numara saklanır ama eşleşmede kullanılmaz (taxKey).
 */
supplierTaxNumber: text("supplier_tax_number"),
```

- Migration: `npx drizzle-kit generate --name fatura_vergi_no`, which produces `drizzle/00NN_fatura_vergi_no.sql` with
  `ALTER TABLE "invoices" ADD COLUMN "supplier_tax_number" text;` plus the meta snapshot. Never hand-write it. Other
  groups also add migrations, so regenerate at integration time if the numbers collide.
- No index: every reader scans the invoices table, which is small.
- No change to `suppliers`. The card's `tax_number` already exists and stays owner-entered.
- Why store a column instead of resolving at read time: the number comes from Paraşüt payloads that are not kept, and
  e-invoice rows have no contact id.

## 5. Server logic

### 5.1 Pure logic: `src/app/panel/tedarikciler/logic.ts`
Add a section "Vergi no ile eşleşme".
- `DUMMY_TAX_NUMBERS` (the set in §2).
- `cleanTaxNumber(raw): string | null`: `normalizeTaxNumber`, kept only if 10 or 11 digits. This is the storage form;
  every capture path uses it.
- `taxKey(raw): string | null`: `cleanTaxNumber`, then `isValidVkn` / `isValidTckn`, then not in the dummy set. This
  is the matching form.
- A small internal `UnionFind` class (Map-based, path compression, no dependency).
- `export interface SupplierRef { supplier: string; supplierTaxNumber?: string | null; date?: string }`.
- `export function supplierResolver<C extends CardNames & { taxNumber?: string | null }>(cards, refs)` returns
  `{ resolve(supplier, taxNumber): { id: string; card: C | null; via: "ad" | "vergi" | null } }`. It implements §2:
  `byName = cardIndex(cards)`, `byTax` (cards with a unique `taxKey`), the union-find, `compCards`, `compHasName`,
  `nameTaxCards`. Cardless ids are `ad:<root>` and fallbacks are `ad:<K>`. Ids are internal; only membership matters.
- `LedgerInvoice` gains `supplierTaxNumber?: string | null`.
- `groupSuppliers(invoices, cards, opts)` builds the resolver over `invoices` and groups by `resolve(...).id`. Card
  groups exist even with no invoices, as today. New fields on `SupplierGroup`:
  - `keys: string[]`: all name keys of the group's invoices, plus the card's name and alias keys.
  - `viaTax: string[]`: display names whose key is not one of the group's own keys. Own keys are the card's
    name and aliases, or `[key]` when cardless.
  - `taxNumbers: { taxNumber: string; count: number }[]`: distinct `taxKey`s on its invoices, by count descending,
    then by number.
  - `taxNumber: string | null`: `card?.taxNumber || (taxNumbers.length === 1 ? taxNumbers[0].taxNumber : null)`.
  - `sharedTax: { taxNumber: string; others: { name: string; slug: string; cardId: number | null }[] }[]`: computed
    after all groups exist. Map each `taxKey` to the groups holding it, either through invoices or through the card's
    `taxNumber`; report the other groups.
  - `names` excludes the placeholder unless the group is the placeholder group, because `supplierInfoFromParasut(names)`
    must never match every placeholder invoice.
  - `key`: as in §2.
- `missingInfo(card, inferredTaxNumber?: string | null)`: "vergi" is missing only when neither exists.
- `SupplierListRow` gains `taxNumbers: string[]`. `supplierHaystack` includes them.
- `paymentRequestText(opts)` gains optional `taxNumber`. The line reads `card?.taxNumber || opts.taxNumber`.
- `supplierPairKey(name, taxNumber) => \`${supplierMatchKey(name)}|${taxKey(taxNumber) ?? ""}\`` is the key for the
  Faturalar slug map.
- `taxNameIndex(groups)` returns `Record<taxKey, { group: string; cardId: number | null; names: { name: string; count: number }[] }[]>`
  plus `cardTax: Record<taxKey, { id: number; name: string }[]>`. This is plain data for the dialog.
- `taxPreview(index, taxNumber, cardId)` returns `{ join: { names: { name; count }[]; count: number }; stay: string[]; sharedCards: string[] }`.
  It feeds the dialog texts in §3.3.
- `mergeCards(into, from)` returns `{ values, dropped: ("iban" | …)[] }`:
  - `aliases = cleanAliases(into.name, [...into.aliases, from.name, ...from.aliases])`.
  - Every info field (legalName, taxNumber, taxOffice, iban, bankName, accountHolder, contactName, phone, email,
    address, paymentTermDays, paymentMethod) is `into ?? from`. `dropped` lists the fields where both had different
    non-empty values.
  - `note`: the non-empty notes joined with "\n".
  - `paidOnDelivery = into.paidOnDelivery`.
  - `hiddenOn`: null if either card is visible, otherwise the later of the two dates.
- `isHiddenSupplier`, `nameConflict`, `cleanAliases`, `aliasCandidates`: unchanged.

### 5.2 Data loaders: `src/server/data/suppliers.ts`
- `LEDGER_COLUMNS` adds `supplierTaxNumber`.
- New `loadSupplierRefs()`: `select supplier, supplier_tax_number, max(date) as date from invoices group by 1,2`. It is
  the single source for every name-only caller.
- `loadTermDays()` returns `(supplier: string, taxNumber?: string | null) => number | null`, built from
  `supplierResolver(cards incl. taxNumber, refs)`. Callers (§6.5) pass the invoice's number.
- `loadPaidOnDelivery()`: same resolver. Type `PaidOnDelivery = (supplier, taxNumber) => …`.
- `slugGroups()`, `supplierSlugOf`, `supplierSlugOfKey` use `loadSupplierRefs()`. `supplierSlugOfKey(key)` matches
  `!g.card && g.keys.includes(key)`.
- `loadSupplierLedger()` is unchanged apart from the new column flowing through.

### 5.3 Capture: `src/server/parasut/mapping.ts`, `sync.ts`, `lines.ts`
- `BillDraft` gains `eDocumentTaxNo: string | null`. In `billToDraft`, read it from the included `active_e_document`
  resource's `attributes.from_vkn` (`relOne(bill, "active_e_document", index)`). `INCLUDES[0]` already requests it.
- New pure `nextTaxNumber(stored, incoming, { from: "bill" | "einvoice"; hasEInvoice: boolean }): string | null`.
  `null` means "no change". The rule is:
  1. `t = cleanTaxNumber(incoming)`. If it is empty or equal to `stored`, no change.
  2. If `stored` is empty, write `t`.
  3. If `from === "einvoice"`, the signed document wins: write `t`.
  4. A bill's contact number does not overwrite a row linked to an e-invoice. Otherwise write `t`, since the contact was
     corrected in Paraşüt.
- `sync.ts`:
  - `Existing` gains `supplierTaxNumber`, and the `loadCtx` select adds it. `Ctx` gains `taxFilled: number`.
  - New `fillTaxNumber(ctx, row, raw, from)` runs `nextTaxNumber`, then
    `update invoices set supplier_tax_number = t where id = row.id`, sets `row.supplierTaxNumber`, and does
    `ctx.taxFilled++`. It is not counted in `counts.updated`.
  - `applyDraft`:
    - Source: `const raw = d.eDocumentTaxNo ?? d.supplierTaxNo; const from = d.eDocumentTaxNo ? "einvoice" : "bill"`.
    - New row: `supplierTaxNumber: cleanTaxNumber(raw)` in the insert, plus `ctx.taxFilled++` when it is set.
    - Matched row: call `fillTaxNumber` after the update (`hasEInvoice = Boolean(match.eInvoiceId)`).
    - `ctx.paidOnDelivery(supplier, raw)`. The `supplierFix` path uses
      `ctx.paidOnDelivery(supplierFix.supplier, raw ?? match.supplierTaxNumber)`.
  - `applyEInvoice`:
    - New row: `supplierTaxNumber: cleanTaxNumber(d.supplierTaxNo)`.
    - After `verdict.ok`, call `fillTaxNumber(ctx, row, d.supplierTaxNo, "einvoice")` on every path where a row is known
      before returning: the `d.importedBillId` branch (on `match`), the `findByEInvoiceNo` branch (on `bill`), and the
      `if (match)` branch **before** the early `return "skipped"`.
    - `paidOnDelivery(supplier, d.supplierTaxNo)` on create.
  - `ctx.existing.push(...)`: include `supplierTaxNumber`.
  - Summary part: `ctx.taxFilled + backfill.filled ? \`${n} faturaya vergi no yazıldı\` : ""`.
  - `syncSupplierHistory` goes through `applyDraft`, so it is covered with no extra code.
- `lines.ts` `readEInvoiceLines`: select `supplierTaxNumber`. Set
  `patch.supplierTaxNumber = nextTaxNumber(row.supplierTaxNumber, inv.supplierTaxId, { from: "einvoice", hasEInvoice: true })`
  when it is non-null.
- `actions/invoices.ts`: `snapshotOf` adds `supplierTaxNumber`. `snapshotSchema` adds
  `supplierTaxNumber: z.string().max(20).nullable().optional()` (old copies lack it). Delete, restore and
  `unignoreParasutBill` keep the number.

### 5.4 Backfill: new `src/server/parasut/tax-backfill.ts` (server-only)
Existing rows have no number. The daily sync re-reads only the last 75 days of bills and e-invoices, and those pass
through `applyDraft`/`applyEInvoice`, so recent rows fill on the first run. Older rows need this one-off, resumable pass.

```ts
export const TAX_BACKFILL_KEY = "parasut.taxBackfill";
interface State { bills: { page: number; done: boolean }; eInvoices: { page: number; done: boolean }; filled: number; finishedAt?: string }
export async function backfillSupplierTaxNumbers(client: ParasutClient, opts: { until: number }): Promise<{ filled: number; done: boolean }>
```
1. If `state.finishedAt` is set, return `{ filled: 0, done: true }`. It never runs again: new rows get their number
   at creation.
2. Load the missing rows: `supplier_tax_number is null and (external_id is not null or e_invoice_id is not null)`,
   keyed by externalId and by eInvoiceId. If there are none, finish. `oldest = min(date)`.
3. **Bills phase.** Use `client.pages("purchase_bills", { sort: "-issue_date", include: "supplier,active_e_document" }, 200, state.bills.page)`.
   - For each bill: `d = billToDraft(...)`. If `missingByExt` has `bill.id` and
     `t = cleanTaxNumber(d.eDocumentTaxNo ?? d.supplierTaxNo)`, then
     `update … set supplier_tax_number = t where id = ? and supplier_tax_number is null` (the guard against races with a
     concurrent write), and `filled++`.
   - After each page set `bills.page = page + 1`.
   - Mark done when the page's oldest date is before `oldest`, the page is empty, or it is the last page.
   - Stop when `Date.now() > until`.
   - On 400/422 (include rejected), mark bills done and log with `console.error`.
   - On `ParasutDeadlineError`, stop.
4. **E-invoices phase**, after bills are done. Use `client.pages("e_invoices", { sort: "-issue_date" }, 200, state.eInvoices.page)`.
   - `d = eInvoiceToDraft(r)`. Fill rows found by `missingByEi.get(r.id)` **and** by
     `missingByExt.get(d.importedBillId)`. The second case covers imported bills whose contact had no number.
   - Same stop rules as the bills phase.
5. Persist the state after each phase. When both phases are done, set `finishedAt`.

Hook it into `syncParasut` after `readEInvoiceLines`, inside its own try/catch. Failures are non-fatal and only logged:
`if (Date.now() - started < deadline - 6_000) backfill = await backfillSupplierTaxNumbers(client, { until: started + deadline - 3_000 })`.
Add `TAX_BACKFILL_KEY` to `PARASUT_STATE_KEYS`, so "Oturumu sıfırla" restarts it. `db:reset` already deletes
`parasut.%`, so it restarts after a reset too.

Cost: 25 rows per page (`PAGE_SIZE`) at about 1 req/s. A few hundred older bills take 10–20 pages, which finish over a
few daily runs. Pressing "Şimdi eşitle" speeds it up.

### 5.5 Sync extras (small, separable; same PR recommended)
- **Category history by VKN.** In `loadCtx`, build `taxHistory = supplierHistoryByTax(existingRows.filter(feedsSupplierHistory))`,
  keyed by `taxKey(supplierTaxNumber)`.
  - `pickCategory(d, rules, history, allowed, taxHistory?)`: after the name history, try
    `taxHistory.get(taxKey(d.supplierTaxNo))` with reason `"tedarikçinin önceki faturaları (vergi no)"`.
  - `categoryNeedsReview` in `einvoice.ts` changes to `reason.startsWith("tedarikçinin önceki faturaları")`, so this
    is a trusted guess (fewer "kontrol bekleyen" for name variants).
  - Pass the e-invoice's `supplierTaxNo` in `applyEInvoice`'s `pickCategory` call.
- **Alias guard.** Move `supplierAliases` from `sync.ts` into `mapping.ts` (pure) so it can be tested. Give it
  `taxOf: (name) => Set<string>` (known `taxKey`s per short name, from existing rows).
  - `alias(name, taxNo)`: if `taxKey(taxNo)` is valid, the chosen short name already has known numbers, and none of
    them is this one, keep the Paraşüt name (do not alias). Otherwise behave as today.
  - This stops new wrong merges such as "Metro Turizm" → "Metro". Existing rows are not renamed.

## 6. Exact files

### 6.1 Add
- `drizzle/00NN_fatura_vergi_no.sql` + `drizzle/meta/*` (generated).
- `src/server/parasut/tax-backfill.ts` (§5.4).
- `src/app/panel/tedarikciler/[cari]/tax-notice.tsx` (client): the shared-VKN banner, the merge ConfirmDialog and the
  undo toast. Props: `{ cardId, name, shared: SupplierGroup["sharedTax"], here: { iban: string | null } , others: Record<number, { iban: string | null }> }`.
  Close the dialog before calling `router.replace` (hidden routes are preserved).

### 6.2 Change: logic and data
- `src/server/db/schema.ts`: the column (§4).
- `src/app/panel/tedarikciler/logic.ts`: §5.1.
- `src/server/data/suppliers.ts`: §5.2.
- `src/server/data/search.ts`: use `loadSupplierRefs()`. The hint uses `g.taxNumbers` instead of `card.taxNumber`.

### 6.3 Change: server actions (`src/server/actions/suppliers.ts`)
- `findGroup`: cardless matches `!x.card && x.keys.includes(key)`.
- `removeSupplier` (cardless): insert `key: supplierMatchKey(g.name)`, not `g.key`, since the key can be another name.
  The hidden card's name pulls the rest of the VKN component through the resolver.
- `importSupplierHistory`: `taxNumber: g.taxNumber`, so contact lookup also works with an inferred number.
- `saveSupplier`: after the save, compute `sharedTax`: other cards whose `taxKey(taxNumber)` equals the new one.
  Return it for the toast (§3.3). It never blocks.
- New `mergeSuppliers({ intoId, fromId })`:
  - `requireAdmin` and zod ids (distinct).
  - In a transaction: select both rows `for update`. If one is missing, throw
    `UserError("Tedarikçi bulunamadı; sayfayı yenileyin.")`.
  - Run `mergeCards`, update `into`, delete `from`.
  - `logActivity(me, "Tedarikçiler birleştirildi", "B → A · diğer adlar: … · alınmayan: IBAN")`. If `into`'s IBAN
    changed (it was empty), also log "Tedarikçi IBAN'ı değişti", as `saveSupplier` does.
  - `refresh()`. Return `{ slug, undo: { intoId, into: snapshot+hiddenOn, from: snapshot+hiddenOn } }`.
- New `unmergeSuppliers(undo)`:
  - `requireAdmin`; `cleanCard` both snapshots.
  - In a transaction: restore `into` from the snapshot. Run `nameConflict` for `from` against all other cards. On a
    conflict, throw `UserError("“B” adları bu arada başka bir tedarikçiye verildi; birleştirme geri alınamadı.")`.
  - Insert `from` with its `hiddenOn`. `logActivity("Tedarikçi birleştirmesi geri alındı")`, then `refresh()`.

### 6.4 Change: Tedarikçiler UI
- `src/app/panel/tedarikciler/page.tsx`:
  - Rows: `taxNumber: g.taxNumber`, `taxNumbers`, `missing: missingInfo(g.card, g.taxNumber)`.
  - Pass `taxIndex = taxNameIndex(groups)` to `SuppliersClient`.
- `src/app/panel/tedarikciler/suppliers-client.tsx`: forward `taxIndex` to `SupplierCardDialog`.
- `src/app/panel/tedarikciler/[cari]/page.tsx`:
  - Slug fallback: if no group has the slug, find a group with a name whose `supplierSlug(supplierMatchKey(name))`
    equals the slug, then `redirect(supplierHref(g.slug))`. A streaming redirect is fine (see
    `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`). Otherwise `notFound()`.
  - Pass `taxNumber`, `taxNumbers`, `viaTax`, `sharedTax`, the other cards' IBANs and `taxIndex`.
- `src/app/panel/tedarikciler/[cari]/supplier-client.tsx`:
  - CariPanel rows and notes (§3.2), the header description and the empty-section text.
  - Render `TaxNotice`.
  - `RequestDialog` gets `taxNumber`; `SupplierCardDialog` gets `taxIndex` and `inferredTaxNumber`.
- `src/app/panel/tedarikciler/card-dialog.tsx`:
  - `blankForm(card, name, inferredTaxNumber)`: prefill it and add it to `filled`.
  - Preview via `taxPreview`, the hint text and the `sharedTax` toast.
- `src/app/panel/tedarikciler/request-dialog.tsx`: pass `taxNumber` to `paymentRequestText`.

### 6.5 Change: Faturalar, reminders and digest
- `src/app/panel/faturalar/rules.ts`: `InvoiceRow` gains `supplierTaxNumber?: string | null`.
- `src/app/panel/faturalar/page.tsx`:
  - Load `select id, supplier_tax_number from invoices where supplier_tax_number is not null` and merge it into
    `invoices`. This avoids touching the shared `lib/calc` `Invoice` type.
  - Build `supplierSlugs` keyed by `supplierPairKey(inv.supplier, inv.supplierTaxNumber)` for every invoice.
- `src/app/panel/faturalar/invoices-client.tsx`: `supplierHref={(inv) => …supplierSlugs[supplierPairKey(inv.supplier, inv.supplierTaxNumber)]}`.
- `src/app/panel/faturalar/invoice-dialog.tsx`:
  - `supplierHref?: (i: { supplier: string; supplierTaxNumber?: string | null }) => string | null`.
  - Call it with `invoice`. Add `Vergi no … ·` before the link.
- `src/server/notify/digest.ts` `loadUpcoming`: select `supplierTaxNumber`; `termDays(i.supplier, i.supplierTaxNumber)`.
- `src/server/actions/reminders.ts` `postponeInvoice`: select `supplierTaxNumber`; `termDays(inv.supplier, inv.supplierTaxNumber)`.

### 6.6 Change: Paraşüt
- `src/server/parasut/mapping.ts`: `eDocumentTaxNo`, `nextTaxNumber`, `pickCategory` + `supplierHistoryByTax`,
  `supplierAliases` (moved) + guard.
- `src/server/parasut/einvoice.ts`: the `categoryNeedsReview` prefix.
- `src/server/parasut/sync.ts`: §5.3, the backfill hook, `PARASUT_STATE_KEYS`.
- `src/server/parasut/lines.ts`: UBL VKN.
- `src/server/actions/invoices.ts`: snapshot (§5.3).

## 7. Edge cases and interactions (no regressions)

| Case | Behaviour |
|---|---|
| No VKNs (local DB, Excel-only, before backfill) | Groups, keys and slugs are identical to today. The seed test stays green. |
| Excel/manual row (never has a VKN) | Joins through its name: the card's name or alias, or the name bridge to a VKN group. |
| Placeholder "Paraşüt tedarikçisi" with VKN | Goes to the real supplier now. With no named partner it stays in the placeholder group. Never a bridge. |
| Invalid checksum or dummy number | Stored, shown in the invoice dialog, never used for matching. |
| Name of card B, VKN of card A | Goes to card B (name wins). Both cards show the banner and can merge. |
| Same explicit VKN on 2 cards | The number is ignored for matching. Saving warns (not blocked). Both pages show the banner. |
| One name, 2 VKNs (prefix alias) | Stays one group as today. The note lists both numbers. The alias guard stops new cases. |
| Hidden card gets a VKN-joined invoice dated after `hiddenOn` | Returns to the list (`isHiddenSupplier`), the same rule as a name-joined invoice. |
| Peşin card, new invoice joins via VKN | Arrives paid (fatura günü, the card's method): the same resolver as the grouping. Existing invoices' payment state is untouched. |
| Ödemeler, bell, digest, postpone | The estimated due date uses the card that Tedarikçiler shows (resolver with VKN). |
| Cardless group key changes (new smaller name key) | Old slug redirects; actions match `keys`. |
| "Sil" on a cardless VKN group | Hidden card by display name; the other names follow it via VKN. Unhide drops the card if it has no info (`supplierSlugOfKey` via `keys`). |
| Card created from a cardless VKN page | All names become explicit aliases (existing `fromPage`), and the VKN is prefilled. |
| Owner renames a VKN invoice's supplier in Faturalar | To a card's name or alias: goes there (name wins). To a new name: that name joins the VKN group. |
| Paraşüt contact VKN corrected later | Bill rows without an e-invoice update on the next touch. E-invoice-backed rows keep the document's number. |
| Bill contact VKN ≠ e-document `from_vkn` | The e-document number wins (`eDocumentTaxNo`, `nextTaxNumber`). |
| Deleted invoice restore / old snapshot | Keeps the number. An old copy restores with null: it is refilled if it falls in the 75-day sync window; otherwise it stays null after the backfill has finished. It still groups by name, so this is acceptable. |
| `db:reset` / "Oturumu sıfırla" | Backfill state is cleared and it re-runs. |
| Concurrent writers | The backfill update has `where supplier_tax_number is null`. Sync writes run under the sync advisory lock. |
| `include=supplier` rejected | The sync falls back to the contacts cache (it already reads `tax_number`). The backfill's bills phase stops cleanly. |
| Merge when either card is hidden | The merged card is visible if either was. Undo restores both exactly. |
| Merge undo after the names were reused | `UserError`, the same pattern as `restoreSupplier`. |

Nearby features checked: ⌘K, `aliasCandidates`, "Faturadan doldur" (names exclude the placeholder), "Geçmiş faturaları
al", ödeme talebi, the delete/hide flow, Ödemeler/digest due estimate, the Faturalar dialog link, and Gelir-gider
(unchanged, name-based).

## 8. Tests (`npx tsx --test tests/*.test.ts`)

Use valid VKNs that are not dummies: `7810030532`, `4567890128`, `1122334455`, `9988776658`, `3456789014`. Valid
TCKN: `10000000146`.

`tests/tedarikciler.test.ts`:
1. `cleanTaxNumber` / `taxKey`: spaces and dots are stripped; wrong length gives null; a bad checksum gives null from
   `taxKey` only; `1234567890` and the other dummies give null.
2. Two cardless names with the same VKN form one group. `key` is the smallest name key, `name` is the newest
   spelling, and `viaTax` and `keys` are correct.
3. Name bridge: an Excel "Kaldi" (no VKN) and a Paraşüt "Kaldi" plus "KALDI KAHVE TİC. A.Ş." (both VKN X) form one group.
4. A card by name only, with no number on the card: a variant name carrying X joins the card (`via: "vergi"`).
5. A card with an explicit VKN: an unknown name with that VKN joins it.
6. Name wins: an invoice named as card B's alias with card A's VKN goes to B. Both groups' `sharedTax` point at each
   other.
7. Two cards with the same explicit VKN: it is unused for matching; an unnamed VKN invoice falls back to its own name
   group; `sharedTax` is set.
8. Placeholder with VKN joins the real group. Placeholder with an unlinked VKN stays in the placeholder group. Two
   placeholder invoices with different VKNs never merge two named groups.
9. Dummy or invalid numbers on two different names keep the names apart.
10. A name with 2 VKNs stays one group, and `taxNumbers` holds both with counts.
11. Determinism: shuffled input gives the same groups, keys and slugs. Ledger rows with dates and `loadSupplierRefs`-style
    rows (`date` = max) give the same slugs.
12. Conflict "name follows its VKN siblings" (`nameTaxCards`).
13. The existing seed test still passes, and a variant with no VKN equals the old output (snapshot of keys and slugs).
14. `missingInfo(card, inferred)`; `supplierHaystack` with `taxNumbers`; `paymentRequestText` with the `taxNumber`
    fallback.
15. `taxPreview` covers the join, stay and shared texts' data; `taxNameIndex` shape.
16. `mergeCards` fills blanks, unions aliases (the source name becomes an alias), keeps the target's IBAN and reports
    it in `dropped`, joins notes, and applies the `hiddenOn` rule.
17. Resolver for due days: `resolve(name, vkn).card.paymentTermDays` equals the group's `termDays` (keeps Ödemeler and
    Tedarikçiler consistent).
18. `supplierPairKey` map from groups resolves every invoice to its group's slug.

`tests/parasut.test.ts`:
19. `billToDraft` reads `eDocumentTaxNo` from the included `active_e_document` (`from_vkn`). `supplierTaxNo` still
    comes from the included contact.
20. `nextTaxNumber`: a bill fills an empty row; a bill does not overwrite an e-invoice-linked row; an e-invoice
    overwrites; invalid or empty input means no change.
21. `pickCategory` with `taxHistory`: a different name with the same VKN gives the past category with reason
    "… (vergi no)", and `categoryNeedsReview` is false.
22. `supplierAliases` guard: a prefix alias with a different known VKN keeps the Paraşüt name; with the same or an
    unknown VKN it aliases as before.

`tests/einvoice.test.ts`: assert `supplierTaxNo` and that `cleanTaxNumber` keeps it (the fixture uses `1234567890`;
storage keeps it, matching ignores it).

The backfill and the sync are server-only. Verify them manually against local Postgres. Set
`supplier_tax_number = null` with SQL, run "Şimdi eşitle" against a test Paraşüt or with a mocked client, and check the
summary text. Run `npm run lint` and `npx tsc --noEmit`.

## 9. Docs
- `docs/TEDARIKCILER.md`:
  - Rewrite **Eşleşme**: name first, then the card's VKN, then VKN through other invoices; invalid and placeholder
    numbers; conflicts and **Birleştir**; slug redirect.
  - **Bilgiler**: the preview under VKN, the prefill, and "faturalardan" display.
  - **Tedarikçi sayfası**: the "Aynı vergi no" row and the banner.
  - **Dosyalar**: the migration and `tax-backfill.ts`.
- `docs/PARASUT.md`:
  - Where the number comes from (bill contact `tax_number`, e-document `from_vkn`, e-invoice `from_vkn`, UBL).
  - The priority rule and the backfill (`parasut.taxBackfill`, summary text).
  - Category history by VKN; the alias guard.
- `README.md`: the Tedarikçiler row adds "vergi noyla eşleşme, birleştirme".

## 10. Owner decisions (recommended default in **bold**; do not block)
- **D1.** Should new Paraşüt invoices be **renamed** at sync time to the name of the card their VKN resolves to, so
  Faturalar and Gelir-gider show one name? **No for now.** Grouping is done in Tedarikçiler and Faturalar links to it.
  This can be added later in `ctx.alias` in about 20 lines.
- **D2.** Same VKN typed on two cards: block or warn? **Warn.** A sole trader can legitimately run two shops; the
  banner offers a merge.
- **D3.** Should Gelir-gider "Mal alışları" rows, Faturalar breakdowns and the "N tedarikçi" count group by VKN?
  **No.** They stay name-based, mirroring the Excel layout. Revisit together with D1.
- **D4.** When merging, which IBAN, peşin flag and vade win? **The target's (the page you merge into).** The other
  card's differing IBAN is named in the confirm dialog and the log.
- **D5.** Should an inferred VKN be written to the card automatically? **No.** Show it as "faturalardan" and prefill
  it in Düzenle. The owner saves it.
- **D6.** The backfill runs inside every sync until done, with no button: **yes**.
- **D7.** Treat `1234567890` as a dummy (it passes the checksum): **yes**.

## 11. Implementation order (each step shippable)
1. Schema and migration; capture in sync, lines and e-invoice; snapshot; backfill (data starts flowing, no UI change).
2. Resolver and `groupSuppliers` v2, plus every caller switched to refs with VKN (suppliers data, search, Faturalar
   slug map, termDays, paidOnDelivery), plus tests 1–18.
3. UI: CariPanel rows and notes, header, card dialog prefill and preview, invoice dialog VKN, payment request.
4. Merge and undo (`mergeCards`, actions, `tax-notice.tsx`).
5. Sync extras (§5.5) and tests 19–22.
6. Docs.
