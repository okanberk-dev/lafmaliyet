# oneri-fiyat: personel önerirken fiyat yazar, reçetedeki eksik malzemeyi formdan çıkmadan ekler

Owner requests, 23 Oct 2026:

> ayrıca personel de onaya ürün ekleyip gönderdiğinde fiyat girilebilsin.
> ve ürün eklerken onun reçetesini de eklesinler

This plan is self-contained: there is no CRITIQUE.md §3 entry; §5 "Decisions" below is authoritative. CRITIQUE.md §1
(R1–R7) and CRITIQUE2.md §1 (R8–R19) still apply. Staff never see costs, margins, salaries, profit or karaoke amounts;
the owner explicitly allows staff to *type* prices here (input only, never shown back as costs).

## 1. Today (main)
- Reçete defteri › **Yeni ürün öner** (src/app/panel/receteler/new-product-sheet.tsx → `proposeNewProduct` in
  src/server/actions/recipe-requests.ts): name, category, sizes (M / L / Tek), a recipe per size (at least one line,
  `newProductIssue`), a note. One `recipe_change_requests` row per size (`kind = 'new'`, `proposed` jsonb
  `{ name, size, categoryId }`). No price: the admin types the sale price in Reçete onayları (src/app/panel/onaylar/
  review-list.tsx, `approveNewProduct`, price required).
- Recipe lines may only use existing active ingredients. A missing ingredient must first be added in Stok sayımı ›
  **Listeye ekle** (src/app/panel/sayim/actions.ts `addCountItem`: opens the ingredient at once, package price 0,
  `is_estimate`, the admin types the price in Hammaddeler; bell "Fiyatı girilmemiş N hammadde").

So the recipe part of the request exists, but a staff member cannot finish a recipe whose ingredient is not in the list
without leaving the form, and cannot type any price.

## 2. Scope
1. **Sale price in the proposal (per size, optional)**
   - New product sheet: under each chosen size, `Satış fiyatı (₺, KDV dahil)` with the hint `Biliyorsanız yazın;
     yönetici onaylarken değiştirebilir.` Parsed with the shared Turkish money parser (R: `parseNumberTR` /
     `zMoney`), > 0 and ≤ 10.000 ₺, empty allowed.
   - Stored additively in `proposed` jsonb: `ProposedProduct` gains `price?: number | null` (no migration; old rows
     have no price).
   - Reçete onayları: the price input is pre-filled with the proposed price, the label adds
     `Personelin önerisi: {₺}`; the admin can change it; approval still requires a price. The live margin preview uses
     the typed value as today.
   - Staff's "Önerilerim" (my-requests.tsx) may show the price they typed while the proposal is pending (their own
     input; it is a menu price, not a cost). Bell / log text for a new proposal may include it.
2. **Missing ingredient, without leaving the recipe** (both "Yeni ürün öner" and "Değişiklik öner", shared
   recipe-lines.tsx): when the ingredient search finds nothing, the list shows
   `Listede yok: “{typed}” ekle`. It opens a compact form with the same fields and rules as Stok sayımı › Listeye ekle
   (name, sayım grubu, sayım birimi KG / LT / ADET / DİLİM, paket bilgisi, paket içeriği) plus
   `Paket fiyatı (₺, biliyorsanız)`. Saving creates the ingredient through the same server rules (refactor
   `addCountItem`'s core into a shared function; same duplicate check, advisory lock, `count_from`, staff month rule),
   then selects it in the line. If the name already exists, the message offers to pick the existing one.
3. **Package price at Listeye ekle (optional)**: the same `Paket fiyatı (₺, biliyorsanız)` field on Stok sayımı ›
   Listeye ekle. When given: `package_price` = typed value, `is_estimate` stays true, `price_source` "manual", and
   the first price row is written to the price history only if the existing rules allow (today: no 0 row; a typed
   first price is a start, not a "zam"; keep `ingredientChanges` treating the first row as the baseline). The note says
   `Sayım listesine {ad} ekledi (tarih); paket fiyatını personel yazdı.`
   - The staff never see the price after saving (the sayım list and recipe views show no prices to staff, as today).
   - Admin: Hammaddeler › Tahmini shows it (existing filter); the bell's "Fiyatı girilmemiş" no longer counts it; add a
     soft line to the existing estimates surface if one exists, otherwise nothing new.
4. **Approval page shows what staff typed**: in a new-product proposal, recipe lines whose ingredient was created from
   the proposal (or is `is_estimate`) carry the existing "Tahmini" mark; unpriced ingredients keep `UnpricedNote`.

## 3. Texts (Turkish, exact)
- Proposal sheet: `Satış fiyatı (₺, KDV dahil)`, hint as above; error `Satış fiyatı 0'dan büyük olmalı`,
  `Satış fiyatı çok büyük`.
- Approval: `Personelin önerisi: {₺}` under the price input.
- Ingredient search empty state: `Listede yok: “{typed}” ekle`; form title `Yeni malzeme`; button `Ekle ve seç`;
  price field `Paket fiyatı (₺, biliyorsanız)` with hint `Bilmiyorsanız boş bırakın; yönetici girer.`
- Toast after creating: `“{ad}” eklendi ve seçildi`.

## 4. Files and tests
- src/app/panel/receteler/new-product-sheet.tsx, recipe-lines.tsx, change-editor.tsx (only if the shared picker needs
  it), my-requests.tsx; src/server/actions/recipe-requests.ts (schema + store price); src/lib/recipe-change.ts
  (`ProposedProduct` type, price validation helper); src/server/db/schema.ts (type only); src/app/panel/onaylar/
  review-list.tsx; src/app/panel/sayim/actions.ts (+ the form) with the shared ingredient-creation core.
- Tests: proposal price validation and storage (pure helper), the shared count-item core (optional price, estimate
  flag, note text), the role rule (staff create ingredients only in allowed months), `newProductIssue` unchanged.
- Browser: staff at 390 px proposes "Çilekli Matcha · Medium" with a new ingredient created inline and a sale price;
  admin at 1440 sees the price pre-filled and approves; Hammaddeler shows the new ingredient as Tahmini with the typed
  price; staff never see a cost anywhere on the way.
- No migration expected.

## 5. Decisions (authoritative)
- Prices typed by staff are hints/estimates: sale price pre-fills the admin's approval; package price is an estimate
  (`is_estimate` stays true until the admin or an invoice confirms it — fatura-okuma.md B clears it on approval).
- The recipe stays required (at least one line per size), as today.
- No new approval queue for ingredients: creation stays immediate like Listeye ekle.
