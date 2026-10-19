# Paraşüt API v4: implementation spec for the café purchase-bill sync (TypeScript)

Confidence tags: **[docs]** means verified in the official spec or docs. **[client]** means seen in community client code, some of it run against the live API. **[secondary]** means help pages, READMEs or changelogs. **[unverified]** means a guess or something still to test. Conflicts are resolved in that order: docs, then client, then secondary.

Re-checked on 2026-10-19:
- I downloaded `https://apidocs.parasut.com/swagger.json` again (v4.0.0, 81 paths) and confirmed the `purchase_bills` list parameters and the e-invoice paths.
- I read three community clients, two of which were tested against a live account:
  - [ebruoymak parasut-sync](https://github.com/ebruoymak/eclipsemuhendislik.com/blob/HEAD/supabase/functions/parasut-sync/index.ts)
  - [bedizoymak resource-registry](https://github.com/bedizoymak/dayandisli.com/blob/HEAD/server/parasut/resource-registry.ts)
  - [mrzcn Zoho-Parasut-Sync](https://github.com/mrzcn/Zoho-Parasut-Sync/blob/095a28fd803bd1d657c6b4c273c4d96ae2d6b066/classes/ParasutService.php)

These are the facts that change the design. Everything else is detailed in the sections below.
- **`include=supplier` works on the purchase_bills list endpoint,** even though the docs do not list it. One live-tested client uses `supplier,spender,pay_to,details,details.product,active_e_document`. [client]
- **The live API rejects some filters on purchase_bills and names the accepted ones.** It returns 400 "'archived' is not a valid filter. Acceptable: issue_date, due_date, spender_id, supplier_id, currency, remaining, item_type". So filtering by `updated_at` is not possible on purchase bills. [client]
- **Rate limiting was observed live.** The 11th request inside 10 s returns `429` with `x-ratelimit-limit: 10`, `x-ratelimit-remaining: 0` and `Retry-After: 8`. A `page[size]` above 25 returns 422 "Page size is too big. page[size] can be maximum 25". [client]
- **There is an undocumented `GET /{company_id}/e_invoices` list endpoint.** Two independent clients read it in full (1626 rows over 66 pages, and 1693 rows). One client's earlier phase got a 500 from it. [client]

---

## 1. Auth

**Protocol.** OAuth2. Spec `securityDefinitions.parasut_auth`: flow `accessCode`, no scopes. [docs] ([apidocs](https://apidocs.parasut.com/), [swagger.json](https://apidocs.parasut.com/swagger.json))

| Item | Value |
|---|---|
| Token endpoint | `POST https://api.parasut.com/oauth/token` |
| Authorize endpoint | `GET https://api.parasut.com/oauth/authorize?client_id=…&redirect_uri=…&response_type=code` (without a session it 302-redirects to `https://uygulama.parasut.com/kullanici-girisi`) |
| Default redirect URI | `urn:ietf:wg:oauth:2.0:oob`. A custom https callback has to be registered by emailing destek@parasut.com. [docs] |
| Token lifetime | `expires_in: 7200` (2 h) [docs] |
| API call header | `Authorization: Bearer <access_token>` |

**Grant types**
1. `authorization_code` [docs]: send `grant_type, client_id, client_secret, code, redirect_uri`.
2. `password` [docs]: send `grant_type=password, client_id, client_secret, username=<email>, password, redirect_uri=urn:ietf:wg:oauth:2.0:oob`.
3. `refresh_token` [docs]: send `grant_type=refresh_token, client_id, client_secret, refresh_token`.
4. `client_credentials` is **not documented**. One Postman collection claims it works ([ubden](https://github.com/ubden/Parasut.com-API-Postman-Collection)). theYahia's changelog says its v1.x used it and never authenticated ([parasut-mcp](https://github.com/theYahia/parasut-mcp)). **Do not use it.**

**Recommended for a single-café, server-only integration:** use the `password` grant with a **dedicated Paraşüt user for the API** (suggested in the [AvvaMobile README](https://github.com/AvvaMobile/AvvaMobile.Core.Parasut/blob/1c7684e83298ee8df1535eabd6c42a290adb03b6/README.md)). Keep the credentials in Vercel env vars. Use `authorization_code` only if you can get an https callback such as `https://<app>.vercel.app/api/parasut/callback` registered through support.

**Body encoding.** The docs' curl examples use multipart (`-F`). Working clients send `application/x-www-form-urlencoded` (theYahia, ebruoymak, Zoho) or JSON (leventcz, AvvaMobile). **Default: form-urlencoded.** [client]

```http
POST https://api.parasut.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=…&client_secret=…&username=api%40cafe.com.tr&password=…&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob
```

**Token response.** The documented form is below. [docs] In practice the response also carries `created_at` (unix seconds). [client] ([leventcz](https://github.com/leventcz/parasut-php/blob/2598da25cd73fb8a95a38f7961abf10e83516131/src/Http/GuzzleHttpClient.php#L63-L112))
```json
{ "access_token": "XYZXYZXYZ", "token_type": "bearer", "expires_in": 7200, "refresh_token": "ABCABCABC" }
```

**Refresh rotation.** Every refresh returns a **new** `refresh_token`. The next refresh must use the new one. [docs]

Implementation rules:
- Store the token in a single Postgres row: `parasut_oauth(id, access_token, refresh_token, expires_at timestamptz, updated_at)`.
- Refresh when `expires_at < now() + 60s`. This matches the 60 s buffer used by theYahia, yigitkonur, AvvaMobile and Zoho. [client]
- **Serialize refreshes.** Open a transaction, then take `SELECT … FOR UPDATE` on the token row or `pg_advisory_xact_lock(<const>)`. Re-read the row; another invocation may already have refreshed. Then refresh and write the new pair before committing. Without this, two parallel serverless runs can each use the same refresh_token, and one of them will invalidate the other.
- If the refresh fails (400/401 `invalid_grant`), fall back to a new password grant. theYahia and ebruoymak both do this. [client]
- On a 401 from an API call, refresh once and retry the request once.
- Errors from `/oauth/token` are OAuth-style: `{ "error": "...", "error_description": "..." }`. Parse `error_description`. [client]

## 2. Base URL & conventions

- **Base URL:** `https://api.parasut.com/v4`. The spec has host `api.parasut.com`, basePath `/v4`, scheme https. [docs]
- **company_id:** company resources are under `/v4/{company_id}/…`. company_id is an integer, also called "Firma ID" or firma_no; the docs' example is `/v4/115/contacts`. [docs]
  - Find it with `GET https://api.parasut.com/v4/me?include=companies`. Read `relationships.companies.data[].id`, or the `included` companies, which carry `name, legal_name, tax_number, tax_office, e_invoicing_activated_at, inventory_enabled, has_active_subscription`. [docs]
  - The web app URL also shows it: `https://uygulama.parasut.com/{company_id}/…`. A purchase bill opens at `https://uygulama.parasut.com/{company_id}/fis-faturalar/{id}`, which is useful as a deep link in the admin panel. [client]
  - `/v4/me` is the only call that does not need a company_id.
- **Headers:** send `Content-Type: application/vnd.api+json` (or `application/json`). Responses come back as `application/vnd.api+json; charset=utf-8`, served behind Cloudflare with an `x-request-id` header. Log `x-request-id`. [docs]
- **JSON:API style, "mostly" by Paraşüt's own description** [docs]:
  - Shape: `{ data, included, meta }`. Each resource is `{ id, type, attributes, relationships }`.
  - **IDs are JSON strings** in response bodies but integers in paths.
  - `include` takes a comma-separated list of relationship paths, including dotted ones (`details.product`, `payments.transaction`). Included resources are **not nested**: join them from `included[]` by `type:id`.
  - `sort` takes one field; a `-` prefix means descending.
  - Filters are written `filter[field]=value`. The live API also accepts operator suffixes: `filter[field][gteq|lteq|gt|lt|eq|not_eq]=value`. This comes from an API error message quoted in Zoho-Parasut-Sync's code. [client]
  - No sparse fieldsets (`fields[...]`) are documented.
- **Relationship linkage may be empty unless you include it.** Without `include=invoice`, `GET /e_invoices` returns `relationships.invoice` as `{"meta":{}}` with no `data` key. [client] Always `include` every relationship whose ID you need, for example `supplier` and `category`.
- **Documented paths with `#basic` / `#detailed`** (e.g. `POST /purchase_bills#basic`) are URL fragments the docs use to show two request-body variants. On the wire both are the same URL. [docs]
- **The docs and the live API differ in places.** The spec's last changelog entry is 2021-10-11, but the file was modified 2026-02-26. Clients have found documented endpoints that 404 live ("No route matches.": bank_fees and others), undocumented endpoints that work (the e_invoices list), and documented includes the API rejects (`details.warehouse` on sales_invoices returns 400). [client] Treat the spec as a strong hint, not a contract. Store each raw resource as `jsonb` alongside the parsed columns.

## 3. Pagination

- **Parameters:** `page[number]` (default 1) and `page[size]` (default 15, min 1, **max 25**). The maximum is 25 on every list endpoint. [docs]
- **Live check:** `page[size]=50` or `100` returns **422** "Page size is too big. page[size] can be maximum 25". [client] One client used 100 on the undocumented `/e_invoices` list and it worked, but **always use 25**.
- **Response meta:** `meta: { current_page, total_pages, total_count }`. These are the only fields in the spec's `ListMeta`. No `links` object is documented; one client reads `links.next`, but do not rely on it. [docs/client]
- **Loop:** request `page[number]=1..meta.total_pages` with `page[size]=25` and a stable `sort`. Stop at `total_pages`, or when a page returns `data.length === 0`.
- **Throughput:** 25 rows per request at 10 requests per 10 s gives at most about 150 rows per 10 s. For example, 767 bills = 31 pages ([bedizoymak registry](https://github.com/bedizoymak/dayandisli.com/blob/HEAD/server/parasut/resource-registry.ts)), so a full pass takes about 35–45 s.
- **Vercel:** keep each run under the function's `maxDuration`. Persist a cursor (`resource, next_page, window`) in Postgres so a run can resume. One Supabase implementation was killed mid-loop syncing 137 pages and left orphaned "running" rows. [client]

## 4. purchase_bills ("Giderler > Fiş / Fatura")

### Endpoints [docs]
| Method | Path | Use |
|---|---|---|
| GET | `/v4/{company_id}/purchase_bills` | list (`listPurchaseBills`) |
| GET | `/v4/{company_id}/purchase_bills/{id}` | show (`showPurchaseBill`) |
| POST / PUT | `/v4/{company_id}/purchase_bills[/{id}]` | create/update (basic or detailed body). **Not needed for this integration.** |
| DELETE | `/purchase_bills/{id}`; `DELETE /{id}/cancel`; `PATCH /{id}/recover`, `/archive`, `/unarchive`; `POST /{id}/payments` | write operations; **do not call** |

### List query parameters

| Parameter | Status | Notes |
|---|---|---|
| `filter[issue_date]` | [docs] | string. **Range syntax:** `filter[issue_date][gteq]=YYYY-MM-DD&filter[issue_date][lteq]=YYYY-MM-DD` [client, Zoho]. theYahia uses `FROM...TO`, which it labels unverified. **Default: use `[gteq]`/`[lteq]`.** Probe once; if the API rejects them, fall back to a full scan sorted `-issue_date`. |
| `filter[due_date]` | [docs] | same syntax |
| `filter[supplier_id]` | [docs] | integer (contact id) |
| `filter[item_type]` | [docs] | `purchase_bill \| refund \| cancelled` |
| `filter[spender_id]` | [docs] | integer (employee id) |
| `filter[currency]`, `filter[remaining]` | [client] | accepted by the live API (named in its 400 message), not documented |
| `filter[updated_at]`, `filter[archived]`, `filter[payment_status]` | **rejected** | 400 [client]. `[updated_at][gteq]` was only seen working on `/products`. |
| `sort` | [docs] | `id, issue_date, due_date, remaining, remaining_in_trl`, `-` prefix allowed; default `id`. No `updated_at` sort. |
| `include` (documented) | [docs] | `category, spender, details, details.product, details.warehouse, payments, payments.transaction, tags, recurrence_plan, active_e_document, pay_to` |
| `include` (also works) | [client] | **`supplier`**, live-verified on the list endpoint ([ebruoymak](https://github.com/ebruoymak/eclipsemuhendislik.com/blob/HEAD/supabase/functions/parasut-sync/index.ts)); Zoho, theYahia and yigitkonur also use it. Avoid `details.warehouse` unless you need it, because the API rejects it on sales_invoices; untested on purchase_bills. |

### Example requests
```
# discover the company
GET https://api.parasut.com/v4/me?include=companies

# incremental window sync (recommended)
GET https://api.parasut.com/v4/{company_id}/purchase_bills
    ?filter[issue_date][gteq]=2026-07-21&filter[issue_date][lteq]=2026-10-20
    &sort=-issue_date&page[size]=25&page[number]=1
    &include=supplier,category,details,details.product,tags,active_e_document

# one bill with payments
GET https://api.parasut.com/v4/{company_id}/purchase_bills/123456789
    ?include=supplier,category,details,details.product,payments,payments.transaction,tags,active_e_document
```
Build query strings with `URLSearchParams`. It percent-encodes the brackets (`filter%5Bissue_date%5D%5Bgteq%5D=…`) and the commas, which is fine.

### Attributes (`PurchaseBillAttributes`) [docs]; "ro" means read-only
| Field | Spec type | Use as (TS) | Notes |
|---|---|---|---|
| `item_type` | enum `purchase_bill \| cancelled \| recurring_purchase_bill \| refund` | string | For cost: exclude `cancelled` and `recurring_purchase_bill` templates; count `refund` as negative |
| `description` | string | string \| null | Turkish text, UTF-8 |
| `issue_date`, `due_date` | string (date) | `"YYYY-MM-DD"` | Store as `date` |
| `invoice_no` | string | string \| null | e-invoice number, e.g. `ABC2026000000123` |
| `currency` | enum `TRL \| USD \| EUR \| GBP` | string | **TRL, not TRY** |
| `exchange_rate` | number | Decimalish | for non-TRL bills |
| `net_total` | number | Decimalish | see the totals note below |
| `gross_total` (ro) | number | Decimalish | |
| `total_vat` | number | Decimalish | |
| `total_discount`, `total_invoice_discount` (ro) | number | Decimalish | line discounts and invoice-level discount |
| `invoice_discount_type` | `percentage \| amount` | string | `invoice_discount` is a number |
| `total_excise_duty`, `total_communications_tax`, `total_vat_withholding` (ro) | number | Decimalish | ÖTV, ÖİV, KDV tevkifatı |
| `withholding_rate` | number | Decimalish | |
| `total_paid`, `remaining`, `remaining_in_trl` (ro) | number | Decimalish | |
| `remaining_reimbursement[_in_trl]` (ro) | number | Decimalish | for employee-paid expenses |
| `payment_status` (ro) | enum `paid \| overdue \| unpaid \| partially_paid` | string | |
| `is_detailed` (ro) | bool | boolean | `false` means a basic bill (hızlı fiş): **no lines** |
| `archived` (ro) | bool | boolean | archived bills are returned by the list; they cannot be filtered out server-side |
| `sharings_count`, `e_invoices_count` (ro) | int | number | |
| `created_at`, `updated_at` (ro) | "date" in spec, **actually a timestamp** | string | e.g. `2021-03-08T17:50:33.000+03:00` [client]; store as `timestamptz` |

Undocumented attributes seen in [bigoen/parasut](https://github.com/bigoen/parasut/blob/de21d7f6315f47abc504cda51881db692b5b5c34/src/Model/PurchaseBill.php) [client, 2021]: `net_total_in_trl`, `before_taxes_total`, `withholding`, `vat_withholding`, `days_overdue`, `days_till_due_date`, `sharing_preview_url`. Read them if they are present; do not depend on them.

**Totals semantics are [unverified].** The spec has no descriptions. The likely Paraşüt convention is:
- `net_total` = genel toplam, VAT included. For an unpaid bill it should equal `remaining`.
- `gross_total` = brüt, before discounts and taxes.

One client (theYahia) describes basic-bill `net_total` as "excluding VAT", which contradicts this. **Check the first real bill against these invariants:** `remaining == net_total` when unpaid, and `net_total ≈ gross_total − total_discount − total_invoice_discount + total_vat + total_excise_duty + total_communications_tax`.

For the café's cost basis, use the pre-VAT amount, since KDV is deductible:
- If the invariant holds: `cost_ex_vat = net_total − total_vat` (+ excise/ÖİV if not deductible).
- Cross-check against the sum of line net totals for detailed bills.
- Convert with `exchange_rate` when `currency !== 'TRL'`.

### Relationships [docs]
`supplier → contacts`, `category → item_categories`, `spender → employees`, `details → purchase_bill_details[]`, `payments → payments[]`, `tags → tags[]`, `recurrence_plan → recurrence_plans`, `active_e_document → e_invoices` (the polymorphic `type` may also be `e_archives` [client]), `pay_to → contacts | employees` (polymorphic: store both id and type).

### Sync strategy for purchase bills
There is no `updated_at` filter and there are no webhooks, so incremental sync is not possible server-side.
1. **Frequent run (e.g. Vercel Cron every 30–60 min):**
   - Pull a sliding window: `issue_date gteq (today − 90 days)` and `lteq (tomorrow)`, `sort=-issue_date`, with the includes above.
   - Upsert by `parasut_id`.
   - Compare `attributes.updated_at` with the stored value to detect edits.
   - This is the pattern Zoho-Parasut-Sync uses. [client]
2. **Nightly or weekly full re-scan:**
   - Use `sort=id` over all pages to catch edits to older bills and deletions.
   - Mark rows that were not seen as `deleted_in_parasut` (soft delete, `last_seen_at`).
   - **Do not hard-delete** rows.
3. **Line items:**
   - Resolve every `relationships.details.data[].id` against `included` (`purchase_bill_details:<id>`).
   - If one is missing, fail the run for that bill rather than silently skipping it. ebruoymak treats this as an error. [client]
4. **Store** `raw jsonb` for the bill and for each line.

## 5. purchase_bill details (`purchase_bill_details`) [docs]

- There is **no standalone list endpoint.** Get the lines through `include=details,details.product` on list or show, and read them from `included`.
- **Attributes:**
  - `quantity`, `unit_price`, `vat_rate` (required on create)
  - `net_total` (ro), `vat_withholding` (ro), `vat_withholding_rate`
  - `discount_type` (`percentage|amount`) + `discount_value`. **There is no plain `discount` field**; Zoho's code reads `discount`, which is a bug.
  - `excise_duty_type` (`percentage|amount`) + `excise_duty_value`, `communications_tax_rate`
  - `description`, `created_at`, `updated_at`
- **There is no per-line VAT amount.** Compute it as `line_net × vat_rate / 100`, with rounding differences of up to a few kuruş per bill.
- **Relationships:** `product → products`, `warehouse → warehouses`.
- **[unverified]** Line `net_total` is probably `quantity × unit_price − line discount`, excluding VAT and before the invoice-level discount. If `total_invoice_discount > 0`, allocate it pro rata across the lines for unit-cost purposes.
- **Unit cost for the café** = `line_net / quantity` in TRL. Map `product.code` or `product.name` to your recipe ingredients, and keep a manual mapping table for lines without a product (`product.data == null`, free-text `description`).
- **Basic bills** (`is_detailed=false`) have no lines. Cost them at the category level, or let an admin split them in your panel.

## 6. contacts (suppliers) [docs]

- **Endpoints:** `GET /v4/{company_id}/contacts`, `GET /v4/{company_id}/contacts/{id}`.
- **Filters:** `filter[name]`, `filter[email]`, `filter[tax_number]`, `filter[tax_office]`, `filter[city]`, `filter[account_type]=customer|supplier`.
- **Sort:** `id, balance, name, email`; default `-balance`.
- **Include:** `category, contact_portal, contact_people`.
- **Attributes:**
  - `name`, `short_name`, `email`, `phone`, `fax`, `address`, `district`, `city`, `country`, `postal_code`, `iban`
  - `contact_type` = **person|company**
  - `account_type` = **customer|supplier**. **Supplier vs customer is `account_type`, not `contact_type`.** theYahia had to fix this mix-up.
  - `tax_number` (string, VKN 10 digits or TCKN 11 digits), `tax_office`
  - `is_abroad`, `archived`, `untrackable`, `invoicing_preferences`
  - `balance` / `trl_balance` / `usd_balance` / `eur_balance` / `gbp_balance` (ro), `created_at`, `updated_at`
- Usually the bills' `include=supplier` covers what you need. Also run a periodic `GET /contacts?filter[account_type]=supplier&sort=id&page[size]=25`.
- `filter[archived]` works on contacts but is undocumented. [client]

## 7. products [docs]

- **Endpoints:** `GET /v4/{company_id}/products`, `GET /v4/{company_id}/products/{id}`.
- **Filters:** `filter[name]`, `filter[code]`. `filter[updated_at][gteq]=…` works on products although undocumented. [client, Zoho]
- **Sort:** `id, name`; default `-id`. **Include:** `inventory_levels, category`.
- **Attributes:**
  - `name`, `code` (ürün/hizmet kodu), `unit` (free-text birim, e.g. "Adet", "Kg", "Lt"; normalize it yourself)
  - `vat_rate`, `buying_price` (alış fiyatı), `buying_currency`, `buying_price_in_trl` (ro), `list_price`, `currency`, `list_price_in_trl` (ro)
  - `barcode`, `gtip`, `archived`, `inventory_tracking`, `initial_stock_count`, `stock_count` (ro)
  - `purchase_invoice_details_count`, `sales_invoice_details_count` (ro)
  - `purchase_excise_duty[_type]`, `communications_tax_rate`, `created_at`, `updated_at`
- `GET /products?page[size]=1` is a cheap connection test. `/home` does not exist. [client]

## 8. item_categories [docs]

- **Endpoints:** `GET /v4/{company_id}/item_categories`, `GET /v4/{company_id}/item_categories/{id}`.
- **Filters:** `filter[name]`, `filter[category_type]`. **Sort:** `id, name, category_type`. **Include:** `parent_category, subcategories`.
- **Attributes:** `name`, `category_type` (`Product|Contact|Employee|SalesInvoice|Expenditure`), `parent_id`, `full_path` (ro, e.g. "Mutfak > Süt Ürünleri"), `bg_color`, `text_color`, `created_at`, `updated_at`.
- Purchase-bill and expense categories are **`category_type=Expenditure`**. This is an inference: it is the only expense-like enum value.
  ```
  GET https://api.parasut.com/v4/{company_id}/item_categories?filter[category_type]=Expenditure&sort=id&page[size]=25
  ```

## 9. payments / payment_status

- `payment_status` on a bill is one of `paid | overdue | unpaid | partially_paid`. [docs] It **cannot be used as a filter** on purchase_bills; the live API rejects it. [client] Filter in Postgres instead. yigitkonur's `not_due`/`unscheduled` statuses and `payment_status` filter do not match the spec; ignore them.
- Use `total_paid`, `remaining` and `remaining_in_trl` for payable balances.
- **Payments have no company-level list.** Get them with `include=payments,payments.transaction` on purchase_bills. [docs/client]
- `PaymentAttributes` [docs]: `date` (Ödeme tarihi), `amount` (Ödeme tutarı), `currency` (typed "number" in the spec, which is a spec bug; treat it as a string), `notes`, `created_at`, `updated_at`.
- `POST /purchase_bills/{id}/payments` **records** a payment. Not needed here.

## 10. e-invoices, e-archives, and how they become purchase bills

**Incoming e-Fatura (from e-Fatura-registered suppliers)**
- They arrive automatically in the UI under **Giderler > Gelen e-Faturalar** as "içeri alınmayı bekleyen" (waiting to be imported). [secondary] ([help](https://www.parasut.com/kullanim-kilavuzu/gelen-e-faturalarin-yonetilmesi))
- **They do not become purchase bills automatically.** A user has to open the invoice and click **"içeri al"**, matching the supplier and the product lines. Only then does a purchase bill exist, and only then can `/purchase_bills` see it.
- Commercial (`ticari`) e-invoices can be accepted or rejected within 7 days. Basic (`temel`) ones show as already approved.
- **Bulk import** ("Faturaları İçeri Al") [secondary] ([help](https://www.parasut.com/kullanim-kilavuzu/parasut-toplu-e-fatura-iceri-alma)):
  - At most 100 invoices per run, started by the user with the browser tab kept open.
  - The button appears only when exactly one warehouse exists.
  - It skips invoices whose supplier or product lines are not registered, and invoices whose total or VAT do not match.
- No setting for automatic import is documented, and **there is no API call that triggers "içeri al"**.

**API surface** [docs]
- `POST /{company_id}/e_invoices` creates an outgoing e-invoice. `GET /{company_id}/e_invoices/{id}?include=invoice` shows one. `GET /{company_id}/e_invoices/{id}/pdf` returns `204` until the PDF is ready, then `{url, expires_at}` (URL valid for 1 h).
- `EInvoice` attributes:
  - `direction` (`inbound|outbound`), `uuid`, `env_uuid`
  - `from_vkn`, `from_address`, `to_vkn`, `contact_name`
  - `scenario` (`basic|commercial`), `status` (`waiting|failed|successful`)
  - `response_type` (`accepted|rejected|refunded`), `is_answerable`, `is_expired`
  - `issue_date`, `net_total`, `currency`, `item_type` (`invoice|refund`)
- The `invoice` relationship points to `sales_invoices` **or** `purchase_bills`. The reverse link is `PurchaseBill.active_e_document`.
- **For imported invoices:** `GET purchase_bills?include=active_e_document` gives you the e-invoice's `uuid` and `from_vkn`. Store them for de-duplication and audit.

**Undocumented `GET /v4/{company_id}/e_invoices` list** [client, two independent live accounts]
- [bedizoymak](https://github.com/bedizoymak/dayandisli.com/blob/HEAD/server/parasut/resource-registry.ts): 1626 rows over 66 pages.
- [ebruoymak](https://github.com/ebruoymak/eclipsemuhendislik.com/blob/HEAD/supabase/functions/parasut-sync/index.ts): 1693 rows. With `include=invoice`, 811 were linked to purchase_bills, 431 to sales_invoices, and **451 had `invoice.data = null`**.
- An earlier phase of the same client recorded a 500 from this endpoint.
- **Hypothesis [unverified]:** `direction=inbound` plus `invoice.data == null` marks incoming e-invoices that are not imported yet. Use the list only to show a warning in the admin panel ("N gelen e-fatura Paraşüt'te içeri alınmayı bekliyor"). Do **not** count these invoices as costs; they have no lines through this path.
- Request:
  ```
  GET https://api.parasut.com/v4/{company_id}/e_invoices?include=invoice&page[size]=25&page[number]=1
  ```
- The e-document mapper also reads undocumented attributes such as `pdf_url`, `signed_ubl_url`, `html_url`, `status_code`, `total_vat`. [client]

**`e_invoice_inboxes` is NOT an inbox of received invoices.** `GET /{company_id}/e_invoice_inboxes?filter[vkn]=1234567890` checks whether a tax number is a registered GİB e-Fatura user (alias/etiket), so you know whether to issue an e-Fatura or an e-Arşiv. Attributes: `vkn, e_invoice_address, name, inbox_type, address_registered_at, registered_at`. [docs]

**e-Arşiv.** The `e_archives` endpoints (`POST`, `GET /{id}`, `GET /{id}/pdf`) cover **outgoing** sales documents only; their only relationship is `sales_invoice`. [docs] An incoming e-Arşiv from a supplier, sent as PDF or email, never comes through the API. A user has to enter it as a purchase bill or upload its XML through the UI. After that it is a normal purchase bill. Market receipts (fiş) work the same way, usually as basic bills.

**Async jobs (outgoing documents only).** `GET /{company_id}/trackable_jobs/{id}`; the id is valid for 15 min. Statuses: `running|done|error` (the docs also mention `pending`), with `errors: string[]`. Not needed here. [docs]

## 11. Rate limits & errors

**Rate limit**
- Official: **"10 saniyede 10 adet istek gönderebilirsiniz"**, i.e. 10 requests per 10 s. [docs] Before commit [b78b679](https://github.com/parasutcom/api-doc/commit/b78b679231c4797f6267507f0ab75d2a95b8b001) (2023-02-02) it was 60/min, so ignore older blog posts.
- Observed live: the 11th request inside a window returns **429** with `x-ratelimit-limit: 10`, `x-ratelimit-remaining: 0` and `Retry-After: 8`. [client] One client parses `errors[0].detail` for `/(\d+)\s+seconds/`. [client, Zoho]
- **Unknown:** whether the limit is per token, user, client_id or IP. **Assume it is shared across all your invocations**, including `/oauth/token`.

**Client policy**
- **Throttle:** a single shared limiter of 1 request per 1.1 s, serial (no concurrency), across the whole sync run. Never fan out with `Promise.all`.
- **429:** sleep `Retry-After` seconds (default 10 s) plus jitter, then retry, up to 5 times.
- **5xx:** transient 500s were observed and succeeded on retry. Use exponential backoff of 2/4/8 s, at most 3 tries.
- **Other 4xx:** do not retry, except 401, which gets one refresh and one retry.
- **Timeout:** 15–20 s per request.

**Error format**
- `400/401/403/404/422` → `{"errors":[{"title":string,"detail"?:string}]}`. [docs]
- Live examples:
  - `GET /v4/me` without a token → `401 {"errors":[{"title":"Unauthorized"}]}` (no `detail`).
  - Unknown filter → `400` with "'X' is not a valid filter. Acceptable: …".
  - Page too big → `422`.
  - Missing route → `404 {"errors":[{"title":"Not Found","detail":"No route matches."}]}`.
- Some 500s come back in Rails shape: `{"status":500,"error":"Internal Server Error"}`. [client] Parse defensively.
- OAuth errors use `{error, error_description}`.
- Success codes: 200/201/202/204. Treat 204 as an empty body, e.g. a PDF that is not ready yet.

## 12. Getting credentials

- **There is no self-serve developer portal.** Email **destek@parasut.com** to get `CLIENT_ID`, `CLIENT_SECRET` and a registered `REDIRECT_URL`. [docs] `parasut.com/api`, `/developer` and `/gelistiriciler` return 404. The footer's "Geliştiriciler için" link goes to apidocs.parasut.com. [secondary]
- **Which plan includes API access is not published.** The pricing page lists e-Fatura Programı at 150 TL+KDV/month and e-Fatura + Ön Muhasebe at 940 TL+KDV/month, with a 14-day trial. [secondary] ([pricing](https://www.parasut.com/on-muhasebe-fiyatlari)) One sikayetvar complaint (2025-12-17) reports slow answers from support about the API.
- **Questions for the support email:**
  1. Does our plan include API access?
  2. Please issue client_id and client_secret.
  3. Please register an https redirect URI (only if we use authorization_code).
  4. Confirm the scope of the rate limit.
  5. Is there an endpoint for not-yet-imported Gelen e-Faturalar?
  6. Is a sandbox available?
- **Sandbox:** none is documented.
  - `api.heroku-staging.parasut.com` is hard-coded in old clients (parasut-python `sandbox=True`, yedincisenol, ekoseoglu) and still returns 401 to `/v4/me`.
  - theposeidonas' changelog (March 2024) says staging is "no longer used". [secondary]
  - **Default:** use a separate trial company, or a test company id, in production.

## 13. Webhooks

- **There are none for purchase bills.** Webhook docs existed from 2023-02-02 to 2026-02-26 and were then removed: commit [392e495](https://github.com/parasutcom/api-doc/commit/392e495d1f0755e63c9203fa996423ec4ea4d082), "Remove webhook endpoints from public API documentation", marked BREAKING. [docs]
- The removed endpoints were `GET/POST /{company_id}/webhooks` and `PUT/DELETE /{company_id}/webhooks/{id}`, configured with `model` (shipment_document, employee, product, contact, stock_movement, sales_invoice; **never purchase_bill**), `action` (create|update|delete) and `uri`.
- Deliveries carried a `Signature` header (SHA256 of the event data plus a key) and a form-encoded body `{company_id, resource, action, event_date, data}`.
- **Decision: poll** (section 4, sync strategy).

## 14. Gotchas

1. **Decimals probably arrive as JSON strings.** The spec says `number`, but:
   - [go-parasut](https://github.com/yuexcom/go-parasut/blob/HEAD/parasut/sales_invoice_models.go), which has integration tests, models `net_total`, `gross_total`, `total_vat`, `remaining`, `exchange_rate` and others as Go **strings**.
   - AvvaMobile enables `AllowReadingFromString`.
   - PHP clients cast with `(float)`.
   - The backend is Rails, where BigDecimal serializes as a string.

   **Default:** type every number as `string | number` and parse with `decimal.js` or `big.js`, never JS floats. Write Postgres `numeric(18,4)`.
2. **The Turkish lira is `TRL`** (enum `TRL|USD|EUR|GBP`), not ISO `TRY`. Map it explicitly. Zoho's code defaults to `TRY`, which is a bug.
3. **Dates:** `issue_date` and `due_date` are `YYYY-MM-DD` with no timezone; store them as `date`. `created_at` and `updated_at` are ISO timestamps with an offset, despite "format: date" in the spec; store them as `timestamptz`. Compute "today" for window filters in `Europe/Istanbul`.
4. **IDs are strings** in bodies (`"id": "123"`) and integers in paths. Store them as `bigint` and convert with `Number(id)` after validating.
5. **page[size] max is 25 everywhere.** Larger values return 422.
6. **The include list in the docs is not what the API does.** Use `supplier` even though it is undocumented, and avoid `details.warehouse`. Always include the relationships you need, or the linkage may come back as `{"meta":{}}`.
7. **purchase_bills has no updated_at, archived or payment_status filter.** Use issue_date windows plus periodic full scans, and filter in Postgres.
8. **Basic bills have no lines** (`is_detailed=false`). Refund and cancelled bills need sign or exclusion handling. Whether cancelled bills appear in the default list is [unverified]: on sales_invoices, cancelled invoices came back from neither archived filter, and `filter[item_type]=cancelled` returned 0 rows. [client]
9. **Discounts:** there are two levels (line `discount_type`/`discount_value`, and invoice-level `invoice_discount`), plus withholding (tevkifat) and ÖTV/ÖİV. Do not compute costs from `unit_price` alone.
10. **Refresh-token rotation and serverless:** lock the token row (section 1), or concurrent crons will log each other out.
11. **Turkish characters:** responses are UTF-8. URL-encode filter values (`filter[name]=Süt Dünyası` becomes `%C3%BC…`). Compare names with `localeCompare('tr')` and Turkish casing (`İ/i`, `I/ı`): use `toLocaleLowerCase('tr-TR')`.
12. **Encode brackets with `URLSearchParams`.** Do not hand-concatenate.
13. **Bugs in community clients to avoid:**
    - Sergeant61 builds `/v4/v4/` URLs.
    - Zoho reads `relationships.purchase_bill_details` (the real name is `details`), reads `attributes.discount`, and defaults to `TRY`.
    - yigitkonur declares filters that do not exist (`contact_id`, `payment_status`).
14. **Docs drift:** the changelog has not been updated since 2021, and support has called doc examples "illustrative". Keep `raw jsonb` and alert on unknown enum values instead of crashing.
15. **Never call write endpoints** (POST/PUT/DELETE/PATCH) from the sync. Mirror read-only.

## 15. TypeScript sketch

```ts
type Decimalish = string | number;              // parse with decimal.js
type Ref = { id: string; type: string };
type Rel = { data?: Ref | Ref[] | null; meta?: Record<string, unknown> };
interface Resource<A, T extends string = string> {
  id: string; type: T; attributes: A; relationships?: Record<string, Rel>;
}
interface ListResponse<A> {
  data: Resource<A>[]; included?: Resource<Record<string, unknown>>[];
  meta?: { current_page: number; total_pages: number; total_count: number };
}
interface PurchaseBillAttrs {
  item_type: 'purchase_bill' | 'cancelled' | 'recurring_purchase_bill' | 'refund';
  description: string | null; issue_date: string; due_date: string | null;
  invoice_no: string | null; currency: 'TRL' | 'USD' | 'EUR' | 'GBP';
  exchange_rate: Decimalish | null; net_total: Decimalish; gross_total: Decimalish;
  total_vat: Decimalish; total_discount: Decimalish; total_invoice_discount: Decimalish;
  total_excise_duty: Decimalish; total_communications_tax: Decimalish; total_vat_withholding: Decimalish;
  total_paid: Decimalish; remaining: Decimalish; remaining_in_trl: Decimalish;
  payment_status: 'paid' | 'overdue' | 'unpaid' | 'partially_paid';
  is_detailed: boolean; archived: boolean; e_invoices_count: number;
  invoice_discount_type: 'percentage' | 'amount' | null; invoice_discount: Decimalish | null;
  withholding_rate: Decimalish | null; created_at: string; updated_at: string;
}
interface PurchaseBillDetailAttrs {
  quantity: Decimalish; unit_price: Decimalish; vat_rate: Decimalish; net_total: Decimalish;
  discount_type: 'percentage' | 'amount' | null; discount_value: Decimalish | null;
  vat_withholding_rate: Decimalish | null; vat_withholding: Decimalish | null;
  excise_duty_type: 'percentage' | 'amount' | null; excise_duty_value: Decimalish | null;
  communications_tax_rate: Decimalish | null; description: string | null;
  created_at: string; updated_at: string;
}
// Client: BASE='https://api.parasut.com/v4'; serial limiter 1 req / 1.1 s;
// retry 429 (Retry-After || 10s), 5xx (2/4/8s); 401 -> refresh once (row lock) -> retry;
// listAll(path, params) loops page[number] 1..meta.total_pages with page[size]=25,
// merges included into Map<`${type}:${id}`, Resource>.
```

## 16. Example JSON:API response (ILLUSTRATIVE, not verbatim)

The shape follows the spec and client code. The values are invented. Decimals are shown as strings, the safest assumption. `net_total` is shown as VAT-inclusive, which is unverified.

```json
{
  "data": [
    {
      "id": "123456789",
      "type": "purchase_bills",
      "attributes": {
        "item_type": "purchase_bill",
        "description": "Süt ve krema alımı - Ekim",
        "issue_date": "2026-10-14",
        "due_date": "2026-11-13",
        "invoice_no": "SDA2026000004512",
        "currency": "TRL",
        "exchange_rate": "1.0",
        "gross_total": "2000.0",
        "total_discount": "100.0",
        "total_invoice_discount": "0.0",
        "total_vat": "190.0",
        "total_excise_duty": "0.0",
        "total_communications_tax": "0.0",
        "total_vat_withholding": "0.0",
        "net_total": "2090.0",
        "total_paid": "0.0",
        "remaining": "2090.0",
        "remaining_in_trl": "2090.0",
        "payment_status": "unpaid",
        "is_detailed": true,
        "archived": false,
        "sharings_count": 0,
        "e_invoices_count": 1,
        "invoice_discount_type": null,
        "invoice_discount": null,
        "withholding_rate": null,
        "created_at": "2026-10-15T09:12:44.000+03:00",
        "updated_at": "2026-10-15T09:12:44.000+03:00"
      },
      "relationships": {
        "supplier": { "data": { "id": "5551", "type": "contacts" } },
        "category": { "data": { "id": "77", "type": "item_categories" } },
        "details": { "data": [
          { "id": "9001", "type": "purchase_bill_details" },
          { "id": "9002", "type": "purchase_bill_details" }
        ] },
        "active_e_document": { "data": { "id": "4401", "type": "e_invoices" } },
        "spender": { "data": null },
        "pay_to": { "data": { "id": "5551", "type": "contacts" } },
        "tags": { "data": [] },
        "payments": { "meta": {} }
      }
    }
  ],
  "included": [
    { "id": "5551", "type": "contacts",
      "attributes": { "name": "Süt Dünyası Gıda Ltd. Şti.", "contact_type": "company",
        "account_type": "supplier", "tax_number": "1234567890", "tax_office": "Kadıköy",
        "city": "İstanbul", "archived": false } },
    { "id": "77", "type": "item_categories",
      "attributes": { "name": "Süt Ürünleri", "category_type": "Expenditure", "full_path": "Mutfak > Süt Ürünleri" } },
    { "id": "9001", "type": "purchase_bill_details",
      "attributes": { "quantity": "40.0", "unit_price": "30.0", "vat_rate": "10.0",
        "discount_type": "amount", "discount_value": "100.0", "net_total": "1100.0",
        "description": "Tam yağlı süt 1 L" },
      "relationships": { "product": { "data": { "id": "321", "type": "products" } } } },
    { "id": "9002", "type": "purchase_bill_details",
      "attributes": { "quantity": "20.0", "unit_price": "40.0", "vat_rate": "10.0",
        "discount_type": "percentage", "discount_value": "0.0", "net_total": "800.0",
        "description": "Krema 1 L" },
      "relationships": { "product": { "data": { "id": "322", "type": "products" } } } },
    { "id": "321", "type": "products", "attributes": { "name": "Tam Yağlı Süt 1L", "code": "SUT-1L", "unit": "Adet" } },
    { "id": "322", "type": "products", "attributes": { "name": "Krema 1L", "code": "KRM-1L", "unit": "Adet" } },
    { "id": "4401", "type": "e_invoices",
      "attributes": { "direction": "inbound", "uuid": "8f1c…", "from_vkn": "1234567890",
        "scenario": "commercial", "response_type": "accepted", "issue_date": "2026-10-14" } }
  ],
  "meta": { "current_page": 1, "total_pages": 1, "total_count": 1 }
}
```

## 17. Open questions (to check with one real account, or with destek@parasut.com)

1. **Number encoding:** do `net_total`, `unit_price` and `quantity` arrive as JSON strings or numbers? Log one raw response. The parser accepts both either way.
2. **Totals semantics:** is `net_total` VAT-inclusive (genel toplam)? What exactly is `gross_total`, and is line `net_total` before the invoice-level discount? Check the invariants in section 4.
3. **Date-range filter:** does `filter[issue_date][gteq]/[lteq]` work on purchase_bills? Only Zoho's code and its quoted error message show it. Test it against the `FROM...TO` form.
4. **Cancelled and recurring bills:** are `item_type=cancelled` and `recurring_purchase_bill` bills returned by the default list?
5. **Edit detection:** does `updated_at` change when a bill or its lines are edited after import? This decides whether the 90-day window plus `updated_at` comparison is enough.
6. **Rate-limit scope:** is the limit per token, user, client_id or IP? Does `/oauth/token` count against it?
7. **Undocumented e_invoices list:** is `GET /e_invoices` stable? Do `direction=inbound` rows with `invoice.data == null` reliably mean "waiting to be imported"? Is there an official endpoint for Gelen e-Faturalar, or an API trigger for "içeri al"?
8. **Plan and credentials:** which plans include API access? Are credentials issued per integrator or per customer? Can an https redirect URI be registered on Vercel?
9. **Sandbox:** is `api.heroku-staging.parasut.com` usable at all, and how would one get credentials for it?
10. **Webhooks:** do the webhooks removed from the docs in 2026-02 still work server-side? This does not affect purchase bills, which they never covered.
11. **Supplier include on show:** `include=supplier` is verified on the list endpoint only. Confirm it also works on show.