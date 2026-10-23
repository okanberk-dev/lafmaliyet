export const meta = {
  name: 'implement-wave',
  description: 'Implement planned feature groups in isolated worktrees, review each branch, then fix confirmed findings',
  phases: [
    { title: 'Implement', detail: 'one engineer per group in its own git worktree, own DB and dev server' },
    { title: 'Review', detail: 'independent reviewer per branch (read-only)' },
    { title: 'Fix', detail: 'fix confirmed findings on the same branch' },
  ],
}

const SCRATCH = '<scratchpad>'
const PLANS = `${SCRATCH}/plans`

const COMMON = `Repository: /home/user/lafmaliyet (the main checkout; do NOT modify it or its branches). Next.js 16 App Router with cacheComponents, React 19, Drizzle/Postgres, Vercel. Turkish UI for a cafe's owner and staff; read AGENTS.md (this Next.js differs from training data; docs in node_modules/next/dist/docs/). Base branch: claude/oneriler. ${args.baseNote || ''} Note what main already has: scripts/predeploy-guard.ts (previews skip migrations; MIGRATE_ON_PREVIEW=1), the laffogato.net menu price sync (docs/SITE-MENU.md), app orders on the bar screen (docs/SITE-SIPARIS.md), CASH_REPORT_RECIPIENTS env, a service-sales VAT setting.
Plans: ${PLANS}/<key>.md, cross-plan rules and corrections: ${PLANS}/CRITIQUE.md (section 1 rules R1-R7 and section 3 per-plan corrections OVERRIDE the plan). R1 is already satisfied on main by scripts/predeploy-guard.ts: adapt to it, do not duplicate it. Owner decisions: implement the recommended defaults stated in the plan/critique.
Conventions: Turkish UI text, plain and short; Turkish code comments that explain why, matching the density of surrounding code; server actions return attempt(...) with UserError, requireAdmin/requireUser, zod, refresh(), logActivity; pure logic with unit tests (tests/*.test.ts, npx tsx --test); no prettier (the repo is not prettier-formatted: never run prettier on existing files); no new npm dependencies unless the plan requires one; never skip or weaken existing tests.
Local Postgres: postgres://postgres:postgres@localhost (user postgres, password postgres). Browser: Playwright is installed at ${SCRATCH}/node_modules (put your .mjs scripts under ${SCRATCH}/agents/<key>/ so "import { chromium } from 'playwright'" resolves; launch with executablePath "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"). Local admin login after seeding: admin@laffogato.net / yerel-deneme-parola-123 (from .env.local ADMIN_EMAIL/ADMIN_PASSWORD; the first login creates the admin).`

const SETUP = (g) => `Setup inside your worktree (your current working directory):
1. git checkout -b impl/${g.key}
2. cp -al /home/user/lafmaliyet/node_modules ./node_modules   (hard-link copy; do not npm install)
3. Create your own database: PGPASSWORD=postgres psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS laffogato_${g.key}" -c "CREATE DATABASE laffogato_${g.key}"; then copy /home/user/lafmaliyet/.env.local to ./.env.local and set DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_${g.key}; run npm run db:migrate and npm run db:seed.
4. When you need the app: npx next dev -p ${g.port} (in the background, logs to ${SCRATCH}/agents/${g.key}/dev.log). Stop it before you finish.`

const IMPL_RESULT = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    worktree: { type: 'string', description: 'absolute path of the worktree' },
    branch: { type: 'string' },
    commit: { type: 'string' },
    summary: { type: 'string' },
    migration: { type: 'string', description: 'generated migration file name, or none' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'where and why the implementation differs from plan/critique' },
    verified: { type: 'array', items: { type: 'string' }, description: 'what was checked (tests, tsc, lint, browser flows with viewport)' },
    screenshots: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['key', 'worktree', 'branch', 'commit', 'summary', 'migration', 'deviations', 'verified', 'screenshots', 'openIssues'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'file', 'scenario', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const FIX_RESULT = {
  type: 'object',
  properties: {
    commit: { type: 'string' },
    fixed: { type: 'array', items: { type: 'string' } },
    notFixed: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'why'] } },
    verified: { type: 'array', items: { type: 'string' } },
  },
  required: ['commit', 'fixed', 'notFixed', 'verified'],
}

const groups = args.groups

const results = await pipeline(
  groups,
  (g) =>
    agent(`${COMMON}\n\nYou are the IMPLEMENTER for group "${g.key}" (${g.title}). Your plan: ${PLANS}/${g.planFile}. Read it fully, then the CRITIQUE.md rules and the corrections for your group (heading: ${g.critique}). ${g.extra || ''}\n\n${SETUP(g)}\n\nThen implement the plan completely (code, tests, docs, Yardım texts where the plan says). ${g.migration ? `Schema changes: after editing src/server/db/schema.ts run npm run db:generate -- --name ${g.migration} and npm run db:migrate on your DB; commit the generated files (they will be regenerated at merge time per R2).` : 'This group must not change the database schema.'}\nBefore committing: npx tsc --noEmit, npm run lint and npm test must all pass; exercise every changed screen in the browser at 1440x900 and 390x844 (log in as admin; also as a staff user if the feature has staff UI: create one through the app or SQL) and fix console errors, layout overflow and broken flows; save a few screenshots under ${SCRATCH}/shots/${g.key}/. Re-read your diff adversarially (git diff claude/oneriler...HEAD) for bugs, regressions in neighbouring features and leftover debug code.\nCommit on branch impl/${g.key} with a Turkish message (subject line plus bullet body) ending with these two lines exactly:\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01GMUTt3CmELPDBL31cVobaH\nDo not push. Stop your dev server. Keep your database (the reviewer uses it). Return the structured result.`, {
      label: `impl:${g.key}`,
      phase: 'Implement',
      isolation: 'worktree',
      schema: IMPL_RESULT,
    }),
  (impl, g) => {
    if (!impl) return null
    return agent(`${COMMON}\n\nYou are an independent REVIEWER for group "${g.key}" (${g.title}). The implementation is on branch ${impl.branch} in worktree ${impl.worktree} (commit ${impl.commit}); its database is laffogato_${g.key}. Plan: ${PLANS}/${g.planFile}; corrections: CRITIQUE.md heading "${g.critique}". Implementer's summary: ${JSON.stringify(impl)}\nYou are READ-ONLY: do not edit or commit; you may run tests, tsc, lint and the app from that worktree (npx next dev -p ${g.port + 50}, stop it afterwards) and use the browser.\nReport only real problems: bugs (trace a concrete path), regressions to existing features, security issues, missing parts of the plan that the owner would notice, UI that breaks at 390px, misleading Turkish text, missing tests for tricky logic, convention violations that matter. Skip style nits. Severity blocker/major/minor.`, {
      label: `review:${g.key}`,
      phase: 'Review',
      schema: FINDINGS,
    }).then((rev) => ({ impl, rev }))
  },
  (x, g) => {
    if (!x) return null
    const list = (x.rev && x.rev.findings) || []
    if (!list.length) return { key: g.key, impl: x.impl, findings: [], fix: null }
    return agent(`${COMMON}\n\nYou are the FIXER for group "${g.key}" (${g.title}). Work in the existing worktree ${x.impl.worktree} on branch ${x.impl.branch} (cd there; do not create another worktree). Its database is laffogato_${g.key}. A reviewer reported the findings below. For each: verify it in the code first; fix every real one (blockers and majors always; minors when the fix is small and safe); for any you reject, say why. Keep fixes minimal and in scope. Then run npx tsc --noEmit, npm run lint, npm test, re-check affected screens in the browser (npx next dev -p ${g.port}, stop it afterwards), and commit on the same branch (Turkish message, same two trailer lines as before: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com> and Claude-Session: https://claude.ai/code/session_01GMUTt3CmELPDBL31cVobaH). Do not push.\n\nFindings:\n${JSON.stringify(list, null, 2)}`, {
      label: `fix:${g.key}`,
      phase: 'Fix',
      schema: FIX_RESULT,
    }).then((fix) => ({ key: g.key, impl: x.impl, findings: list, fix }))
  },
)

return results.filter(Boolean)
