# Brief for the second batch of features (planning)

You are planning ONE feature group for the L'Affogato panel. Write a complete, implementation-ready plan in the same
spirit as the existing plans in this folder (read at least `today.md` and `kasa.md` to see the expected depth and
format: goal, decisions already made, user-facing behaviour per screen with exact Turkish texts, data model and
migration, server actions, pure logic + tests, files to touch, docs/Yardım updates, risks, test plan).

## Repository and stack

- Repo `/home/user/lafmaliyet`, branch `claude/oneriler` (= origin/main 71ac11f). Do NOT modify the repo; read only.
  Write your plan to `docs/planlar/<key>.md`.
- Next.js 16.4 App Router with cacheComponents (read `AGENTS.md`; this Next.js differs from training data, its docs are
  in `node_modules/next/dist/docs/` — cite the doc files you rely on), React 19, Drizzle 0.45 + Postgres (Neon in prod),
  Vercel Hobby (region fra1; crons: `/api/cron/parasut` 04:30 UTC and `/api/cron/gunluk` 05:00 UTC, once a day each —
  Hobby allows only daily crons, so weekly work runs inside the daily job on the right weekday), Resend e-mail, Web Push.
- Conventions: Turkish UI text, plain and short; server actions return `attempt(...)` with `UserError`,
  `requireAdmin`/`requireUser`, zod, `refresh()`, `logActivity`; pure logic in `src/lib/**` with unit tests
  (`tests/*.test.ts`, `npx tsx --test`); roles in `src/lib/roles.ts` (admin / staff; staff never sees costs, salaries,
  profit or karaoke amounts); docs in `docs/*.md`, help page `src/app/panel/yardim/page.tsx`, README screen table.
- Previews share the production DB; `scripts/predeploy-guard.ts` stops previews from migrating. Migrations are
  generated at merge time (do not hand-number them); just describe schema changes precisely.
- Local Postgres for inspection: `PGPASSWORD=postgres psql -h localhost -U postgres -d laffogato` (seeded dev data; the
  Excel seed has real-looking history: suppliers, invoices, months, products, recipes). Use it to check real shapes.

## Work already planned or in progress (do not duplicate; integrate with it)

Plans in this folder are being implemented in waves on branch `claude/oneriler`. Read the ones your feature touches:
`adminstepup.md` (password step-up for admin actions), `ops.md` (backup + daily job health), `vkn.md` (supplier tax
number matching), `pricing.md` (price holds for big Paraşüt price jumps; per-ingredient supplier price comparison),
`insight.md` (price-rise impact in ₺/month; 6-week cash plan at `/panel/hatirlaticilar/nakit`), `kasa.md` (month
fields derived from cash reports; cash-drawer integrity), `menu.md` (bulk price change, ModPOS checklist, price
history), `today.md` (the new "Bugün" screen `/panel/bugun` and new mobile nav). `CRITIQUE.md` holds the cross-plan
rules R1–R7 and per-plan corrections; follow it. Assume those plans WILL be on the branch before yours is implemented
unless your group's section says otherwise; when you depend on one of their modules, name the exact module/function
from that plan and give a fallback if it is absent.

## Owner answers and decisions (final)

- ModPOS will soon provide a daily product-sales export (format not known yet). Do not build the import now; where your
  feature would benefit from daily product data, design a clear seam for it and degrade gracefully without it.
- No couriers: the café does not deliver; platform orders are pick-up/at-table or not used. Do not plan courier models.
- Paraşüt bank accounts are NOT connected: no bank feed. Anything that needs bank data must work from manual marks.
- Claude API: `ANTHROPIC_API_KEY` is set in Vercel Production only (sensitive). Use the official `@anthropic-ai/sdk`
  (new dependency allowed), model `claude-opus-5-5`, `output_config: {effort: "low"}` for extraction, structured outputs
  via `output_config.format` (JSON schema) where you need JSON, no `temperature`/`top_p`, no assistant prefill, no
  `thinking: {type:"disabled"}` (400 on this model), handle `stop_reason: "refusal"`. Server-only; when the key is absent
  (local dev without it, previews) the feature must hide or show one calm line, never crash. For local testing an
  implementer may export the key from `(yerel deneme: ANTHROPIC_API_KEY ortam değişkeni; anahtar depoda yok)` — never commit it, never print it.
- Photos: store in **Vercel Blob** (a store will be created and `BLOB_READ_WRITE_TOKEN` added by the lead at deploy
  time). New dependency `@vercel/blob` allowed. Photos are business-sensitive: prefer private blobs if the library
  supports them (check `npm view @vercel/blob` versions/README via the network if available); otherwise random,
  unguessable paths served only through an authenticated panel route — never put raw blob URLs in e-mails or to staff
  who should not see them. Compress on the phone before upload (long edge ~1600 px, JPEG ~0.7) and set a retention
  policy. Local dev/test must work without Blob (a filesystem or DB driver behind one small interface).
- No paid third-party APIs. Free sources only where the plan needs them, and say what they cost and their terms.
- Keep features simple to understand for a non-technical owner; avoid jargon in UI ("KDV tahmini", not "net VAT
  position"). The owner explicitly asked the KDV estimate to be "basit, anlaşılır, aşırı detaylı değil".

## What to return

Write the plan file, then reply with: the path, a 5-line summary, the schema changes (tables/columns), new dependencies,
the plans/modules it depends on, and open questions you resolved by assumption (state the assumption).
