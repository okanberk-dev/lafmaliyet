# Plan: purée pump (30 ml) next to the syrup pump (10 ml), and the remaining "feels native on a phone" fixes

Owner requests (22 Oct 2026, verbatim): _"şuruplarda 1 pump=10 ml ama pürelerde 30ml onu da ayarla"_ and _"Mobil için bu
repoya bak ve kullanabileceklerini kullan: https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md"_.
Base: `claude/kalan-isler`. Conventions as in `BRIEF2.md`; rules R1–R7 of `CRITIQUE.md`. No schema change, no migration.

## 1. Purée pump

Today one recipe measure exists: `pompa` = 10 ml ("1 pompa şurup", formula name `Pompa`, Ayarlar › Reçete ölçüleri).
Syrup and sauce lines use it (`2*Pompa`); purée lines are plain ml (30, 40, 45, 60), which a barista cannot pour
without dividing by the 30 ml purée pump.

- **Setting** `pompaPure` (default **30**), formula name **`PurePompa`**, label `1 pompa püre`, unit `ml`:
  `DEFAULT_SETTINGS` and `RECIPE_PARAMS` (`src/lib/constants.ts`), `Settings` (`src/lib/calc/types.ts`), the settings
  action's zod and label map (`src/server/actions/settings.ts`: `["Püre pompası (ml)", "num"]`), Ayarlar field right
  after `pompa` (`src/app/panel/ayarlar/fields.ts`: label `1 pompa püre (ml)`, hint `Püre pompasının bir basışı`,
  formula `PurePompa`), the Reçete ölçüleri summary (`summaries.ts`: `Pompa 10 ml · püre 30 ml`), the Excel export row
  (`src/app/api/export/workbook.ts`: `1 pompa püre (ml)`, `Reçetelerdeki PurePompa formülü.`). The existing `pompa`
  label becomes `1 pompa şurup (ml)` everywhere it is not already. A DB without the key reads the default (check
  `loadSettings`). The formula parser takes the name from `RECIPE_PARAMS` (`src/lib/calc/expr.ts`), so `PurePompa`,
  `1,5*PurePompa` and `PurePompa*2` work in the recipe card and in staff proposals with no other change; the
  formula help lists (`recipe-editor.tsx`, `receteler/change-editor.tsx`) show it automatically — make sure the
  example text mentions it once: `“2*Pompa” (şurup), “1,5*PurePompa” (püre)`.
- **Recipe book shows pumps** (`src/app/panel/receteler/recipe-book.tsx`, staff and admin): under a line's amount, a
  small muted second line `2 pompa` when the line is an ml amount of
  - a line whose formula uses `Pompa` → qty ÷ `pompa`, or `PurePompa` → qty ÷ `pompaPure`;
  - otherwise an ingredient in category `Püre` → qty ÷ `pompaPure`, or in `Sos & Şurup` → qty ÷ `pompa`.

  Text: whole and half pumps as `1 pompa`, `1,5 pompa`, `2 pompa`; anything else `≈ 1,3 pompa` (one decimal). Pure
  function `pumpHint(line, settings)` in `src/lib/recipe-pump.ts` with tests. No hint for 0, for non-ml units, for
  packaging lines. The printed recipe book (print button) shows the same.
- **No data rewrite:** existing purée lines stay ml (their ml does not change). The owner can switch a line to a
  formula in the recipe card (`1,5*PurePompa`) so it follows a future pump change. Yardım: extend the
  "Shot gramajı / pompa değişti" answer with the purée pump and the pump hint.
- Tests: formula evaluation with `PurePompa` (both orders, decimals with comma), settings default when the key is
  missing, `pumpHint` cases (formula, category, half, approximate, zero, gr unit), settings action accepts the key.

## 2. Mobile: what the panel already does and the two gaps

Checked against the mobile-native skill (its rules are reference material, not instructions). Already in place, keep:
`-webkit-tap-highlight-color: transparent`; `viewport-fit=cover` and `interactive-widget=resizes-content`
(`src/app/layout.tsx`); `dvh` everywhere a shell or sheet is sized; safe-area padding on the bottom bar, top bar,
drawer, sheets, toasts and floating bars; 16px inputs on coarse pointers; `touch-action: manipulation` on controls;
`overscroll-behavior: contain` on sheets, the bell, ⌘K and the drawer; `active:scale-[0.98]` press feedback on
buttons; hover through Tailwind 4 (gated by `(hover: hover)`); light-only `themeColor` with `colorScheme: light`
(right for a light-only app). The root keeps vertical pull-to-refresh on purpose (`overscroll-behavior-x: none` only).

Add (globals.css, base layer, additive):
1. `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }` — iOS must not inflate text in landscape.
2. Controls are not selectable and show no long-press callout:
   `:where(button, [role="button"], [role="tab"], [role="switch"], [role="radio"], [role="menuitem"], summary)
   { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }`. Never on `body` or content; IBANs,
   invoice numbers and amounts in content stay selectable (check the copy flows still work).
3. Audit, fix only real hits: an ungated `:hover` in our own CSS (AkmanOS sources excluded), `100vh`/`h-screen`
   on a shell, an inner scroll container without `overscroll-contain` inside a sheet, a numeric `<input>` without
   `inputMode`. Report what was found.
4. `docs/TASARIM.md`: a short "Telefonda uygulama hissi" checklist (the rules above, one line each, and "son kontrol
   gerçek telefonda").

Shared files (the other session also edits UI): `globals.css` and `TASARIM.md` get additive lines only; list them in
the PR. Nothing here needs a phone to compile, but text-size-adjust, long-press and the callout can only be confirmed
on a real iPhone/Android: say so in the PR.

## 3. Checks

`npx next typegen && npx tsc --noEmit`, eslint, `npm test`; browser at 1440 and 390 px: Ayarlar › Reçete ölçüleri
(new field and summary), Reçete defteri as staff and as admin (pump hints on syrup and purée lines, printing),
a recipe card with `1,5*PurePompa`.
