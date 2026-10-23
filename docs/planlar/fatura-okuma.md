# fatura-okuma: paket boyu faturadan (addan ve PDF'ten, Claude Haiku), fiyat onayında kanıtsız çarpan önerisi yok

Owner request, 23 Oct 2026 (with a screenshot of Hammaddeler › Onay bekleyen fiyatlar):

> ekteki gibi hataların da ilerleyen zamanlarda önüne geç mesela yenilebilir bardak aldım 150 adet daha başka firma ve
> maliyeti düşük ama burda artırıyor burda pdf içini okuma mekanizması yap ve claude api vermiştim sana onu da entegre
> edebilirsin haiku ile vs. okuyabilirsin. … bu ve bunun gibi hataların önüne geç

This plan is self-contained: there is no CRITIQUE.md §3 entry; §6 "Decisions" below is authoritative. CRITIQUE.md §1
(R1–R7) and CRITIQUE2.md §1 (R8–R19) still apply.

## 1. The two live cases (production, 23 Oct)

1. **Yenilebilir bardak** (ingredient unit `adet`). Paraşüt line "LİVİ YENİLEBİLİR BARDAK 150 AD." (ECOLİVİNG, 21.10.2026,
   ECE2026000000031): 1 Adet × 3.000,00 ₺. The owner linked it to the ingredient with factor 1 (the link form guessed
   "1"). Current price 41,65 ₺/adet (Sinan Siner, 11.10.2026). Hold card: "↑ %7.103", "Fiyat şimdikinin yaklaşık 72
   katı: çarpan yanlış olabilir (1 Adet = 72 adet mi?)", button "Çarpanı 72 yap". **Truth:** 1 Adet = 150 adet →
   20,00 ₺/adet, 52 % cheaper. Clicking the offered button would have written 41,67 ₺: the real price drop disappears.
2. **Klips kapak**. Current 1,165 ₺/adet is the seed assumption of `0023_sayim_yeni_kalemler` ("VARSAYIM: Faturada yok,
   Kapak 8-12oz ile aynı", `is_estimate`). Wrong: Serendi Ambalaj's invoice SER2026000000495 (24.07.2026) has
   "PLASTİK KAPAK KLIPS · 1.000 Adet" at 12,02 ₺. Hold card: "↑ %932", "Çarpanı 10 yap". The ratio against a guess is no
   evidence at all.

Root causes (code on main):
- `guessLinkFactor` (src/lib/product-match.ts) returns "1" whenever the invoice unit is a single unit (Adet) for an
  adet/dilim ingredient, although `parsePack` finds `count: 150` in the name.
- `factorHint` + `suggestedFactor` (src/lib/price-hold.ts, used in src/app/panel/hammaddeler/page.tsx) propose the
  multiplier that makes the new price equal the current one. That is only evidence when the *same product* used to cost
  the current price under the same factor (a supplier switching koli ↔ adet). For a new supplier or product, or for an
  estimate, it hides real price changes.
- An estimate (`ingredients.is_estimate`) is compared like a real price; the card does not say so.

## 2. Scope

### A. Pack evidence (pure, tested)
- New `packEvidence(line: { name: string; description?: string | null; unit: string | null }, ingredientUnit)` in
  src/lib/product-match.ts (or src/lib/pack-evidence.ts): `{ factor: number; source: "unit" | "name"; text: string } |
  null`.
  - Measure unit on the invoice (KG, LT, gr, ml, UBL KGM/LTR/GRM/MLT): conversion (1 kg = 1000 gr), `source: "unit"`.
  - Package unit (Koli, Kutu, Paket…): count × size from the name (as `guessLinkFactor` does today).
  - **Single unit (Adet, C62, AD, ADT, Tane) with a pack count in the name or description** ("150 AD.", "150 ADET",
    "150'Lİ", "100 LÜ", "X150", "150 PCS"): factor = count for adet/dilim ingredients, count × size for gr/ml when a size is
    also present. `text` is the matched fragment ("150 AD.") for the UI.
  - No count and no measure: null (unknown, not "1").
- `guessLinkFactor` uses `packEvidence` (the Adet + "150 AD." case now gives "150"). Existing tests in
  tests/product-match.test.ts stay green; add the live names above plus negatives that must NOT count: "BARDAK 8OZ",
  "KAPAK 90 MM", "PİPET 23 CM", "%35 YAĞLI KREMA 1 LT", "2 KAT PEÇETE", "SÜT 1 L".
- Paraşüt › link form (src/app/panel/parasut/parasut-client.tsx): when the typed factor differs from the evidence, show
  under the input: `Adında “150 AD.” yazıyor: 1 Adet = 150 adet olabilir.` with a small "150 yap" button. The form never
  pre-fills "1" for a single unit when the name has a count.

### B. Hold card suggestions (Hammaddeler › Onay bekleyen fiyatlar)
Order of evidence, first match wins; at most one suggestion button per card:
1. **Name / unit evidence** (A) with a factor different from the link's:
   `Adında “150 AD.” yazıyor: 1 Adet = 150 adet olmalı. Öyle olursa adet başı 20,00 ₺ (şimdikinden %52 ucuz).`
   Button: `Çarpanı 150 yap`.
2. **Invoice reading** (C) with `confidence` high or medium and a factor different from the link's:
   `Faturada: “…kanıt…”. 1 Adet = 150 adet → adet başı 20,00 ₺ (şimdikinden %52 ucuz).` Button: `Çarpanı 150 yap`.
3. **Ratio hint, only with history**: the same `productKey` has an earlier paid invoice under the *same* factor whose
   unit price is within ±10 % of the current price (pure helper next to `repeatCount`). Then the existing text and
   button stay. Without that history the ratio text and button are not shown.
4. Otherwise: no suggestion button; the card shows the reading (C) or its button.
- The resulting per-unit price and its % against the current one are always shown next to a suggested factor, so the
  owner sees whether it is a real price change ("ucuz" / "pahalı" / "aynı").
- **Estimate**: when the ingredient `is_estimate`, the card says
  `Şimdiki fiyat tahmini (varsayım), faturadan gelmedi. Faturadaki fiyat ilk gerçek fiyat olabilir.` and the percent
  badge reads `tahmini fiyata göre`. **Onayla** also clears `is_estimate` (one transaction, logged). `priceStep` is
  unchanged (a >40 % jump still waits for one click: the factor may still be wrong).
- `factorHint`, `suggestedFactor` and their tests stay; selection logic is a new pure function with tests
  (tests/fiyat-onayi.test.ts): the bardak case gives 150, the klips case gives no ratio button, a same-product koli ↔
  adet switch still gives the ratio button.

### C. Invoice reading with Claude ("Faturayı oku")
- **What is read**: the invoice document the card's "Faturayı aç" already opens (src/server/parasut/documents.ts:
  e-document PDF via `eDocumentPdfUrl` → `downloadDocument`, or the bill's Paraşüt photo). PDF goes as a `document`
  content block (base64, `application/pdf`); a photo as an image block. The target line's own data (name, quantity,
  unit, net total from our DB) and the ingredient's name and unit go in the text part.
- **Model**: Claude Haiku 5.5 (`claude-haiku-5-5`, the owner asked for Haiku; cheap for clean e-invoice PDFs). Before
  writing code, check the model's id, pricing, PDF input, JSON-schema output and which parameters it accepts (effort,
  thinking) with the `claude-api` skill (or https://platform.claude.com/docs). Extend src/server/ai/run.ts so a request
  can name its model and carry a PDF document instead of an image; the photo path keeps Opus 5.5 and its exact request
  shape (tests/ai-istemci.test.ts stays green). Add Haiku 5.5 to src/server/ai/pricing.ts.
- **Output (JSON schema)**: `{ found: boolean, line: { name, quantity, unit, unitPrice, lineTotal } | null,
  perPackage: { count: number, unit: "adet" | "gr" | "ml" | "dilim" } | null, factor: number | null, confidence:
  "high" | "medium" | "low", evidence: string /* ≤ 120 chars, quoted from the document */, note: string | null }`.
  `factor` = how many ingredient units one invoice unit holds. Validate with zod; the per-unit price shown is recomputed
  from **our** line data (net ÷ (quantity × factor)), never taken from the model.
- **Gate and log**: the same gate as photos (src/server/ai/claude.ts: key, Ayarlar › Fotoğraftan okuma on/off, daily
  cap, `ai_calls` row with feature `fatura`, cost). The reading is admin-only.
- **Cache**: new table `invoice_readings` (id, invoice_id → invoices.id on delete cascade, product_key, status,
  result jsonb, model, ai_call_id, cost_usd, created_by, created_at; unique (invoice_id, product_key)). A card or form
  shows the stored reading; "Yeniden oku" replaces it (counts toward the cap).
- **When it runs**:
  - Hold card: automatically the first time an admin opens a card whose hold has no reading and no name/unit evidence
    (client triggers one request per hold; shows "Fatura okunuyor…"); a "Faturayı oku" / "Yeniden oku" button
    otherwise. Never inside the daily cron (R15 job budget).
  - Paraşüt › link form: a "Faturadan oku" button next to the factor input (uses the product's newest invoice); fills
    the factor and shows the evidence.
- **Failure**: any error keeps the card as today and shows the Turkish error text of `aiErrorText`; nothing is written
  to prices.
- **Privacy (KVKK)**: the invoice PDF goes to Anthropic (USA). It is a business document, but a sole-proprietor
  supplier's invoice carries a person's name, TCKN and address. Document it in docs/FATURA-OKUMA.md (what is sent, what
  is stored: only the JSON result, not the PDF), mention it on Ayarlar › Fotoğraftan okuma (same switch turns invoice
  reading off) and in docs/FOTOGRAF.md §6.

### D. Similar errors, found before they cost money
- Paraşüt page: a small "Kontrol edilecek bağlantılar" box listing links whose factor differs from the name/unit
  evidence (A) — for example "LİVİ YENİLEBİLİR BARDAK 150 AD. → Yenilebilir bardak: 1 Adet = 1 adet; adında 150 AD." —
  each with "Düzelt" opening the link form. Admin only. Nothing changes automatically.
- Changing a factor already re-evaluates the newest invoice (existing behaviour, `appliedKeyOf`); keep it.

## 3. Texts (Turkish, exact)
- Card, evidence: `Adında “{text}” yazıyor: 1 {invoiceUnit} = {factor} {unit} olmalı. Öyle olursa {unit} başı {price}
  ({pct}).` where `{pct}` is `şimdikinden %52 ucuz` / `şimdikinden %18 pahalı` / `şimdikiyle aynı`.
- Card, reading: `Faturada: “{evidence}”. 1 {invoiceUnit} = {factor} {unit} → {unit} başı {price} ({pct}).`; low
  confidence adds `Emin değil; faturayı açıp bakın.` and shows no button.
- Buttons: `Faturayı oku`, `Yeniden oku`, `Çarpanı {n} yap`; busy text `Fatura okunuyor…`.
- Estimate line as in B.
- Link form warning as in A.

## 4. Files
- src/lib/product-match.ts (packEvidence, guessLinkFactor), src/lib/price-hold.ts (selection helper),
  src/app/panel/hammaddeler/page.tsx + price-holds.tsx, src/app/panel/parasut/parasut-client.tsx (+ page.tsx box),
  src/server/ai/run.ts, claude.ts, pricing.ts, new src/server/invoice-reading/*.ts (fetch document, call, store),
  src/server/actions/price-holds.ts (approve clears is_estimate) and a new action file for readings, src/server/db/schema.ts
  (`invoice_readings`), tests, docs (PARASUT.md 5b, FATURA-OKUMA.md new, FOTOGRAF.md §6, Yardım FAQ, README line).
- Migration: one, `npm run db:generate -- --name fatura_okuma` (regenerated by the lead at merge time, R2).

## 5. Checks beyond the usual
- Unit tests for packEvidence (live names + negatives), the suggestion selection (bardak 150, klips no ratio button,
  same-product koli ↔ adet keeps the ratio button), the reading's validation and recomputed price, run.ts request shape
  for a PDF + Haiku request (and the unchanged photo request).
- No real Claude call locally (no key): use the replay mechanism (src/server/ai/replay.ts) with a synthetic reading for
  the bardak invoice; screenshots of the card before/after at 1440 and 390.

## 6. Decisions (authoritative)
- Haiku 5.5 for invoices; photos stay on Opus 5.5.
- No automatic price writes from a reading or from name evidence: the owner still clicks (one click with the right
  factor). Readings never run in cron.
- The ratio hint survives only with same-product history.
- Estimate approval clears `is_estimate`.
- Existing holds in production need no migration: the new card logic applies on deploy; the bardak card will show
  "Çarpanı 150 yap", the klips card the estimate line and no ratio button.
