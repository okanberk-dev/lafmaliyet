# Suggestion 1: admin step-up ("Parolayla onay")

## Goal

Today any open admin session can create another admin, promote a staff account to admin, set another admin's
password or e-mail, issue a reset link for another admin, reset another admin's 2FA, or delete or deactivate another
admin. Nothing more is asked. The code says so itself (`saveUser` doc comment in `src/server/actions/settings.ts`,
and `docs/DEPLOY.md` §6a: "açık kalmış bir yönetici oturumu yeni bir yönetici açıp onunla her şeyi
değiştirebilir"). The fix: every user-management action that **creates admin power or acts on an admin account**
asks for the **acting admin's own password**. The check reuses Hesabım's existing parola onayı (same rate limit,
same audit log), and the server checks it again on every call. Routine staff management stays one tap, as today.
There is no schema change, no new dependency and no new Next.js API.

## Decision: which actions ask for the password

The rule lives in one place, the pure function `needsStepUp()` in `src/lib/step-up.ts`. The client uses it to decide
whether to show the password dialog. The server uses it to enforce, with the "before" state read from the DB.

| Action (server function) | Target is staff, or the new user is staff | Target is admin, or the action makes someone admin |
|---|---|---|
| Add user `createUser` (password or invite) | no | **YES** (role = admin, active or not) |
| Edit user `saveUser`: name only | no | no |
| `saveUser`: role staff → admin (promote) | — | **YES** |
| `saveUser`: role admin → staff (demote) | — | **YES** |
| `saveUser`: active ↔ passive (list switch or edit dialog) | no | **YES**, both directions (re-activating a dormant admin gives admin login back) |
| `saveUser`: login e-mail change | no | **YES** (e-mail + "Parolamı unuttum" would hand over the account) |
| `saveUser`: set a password | no | **YES** (also when the admin is still an invitee) |
| Reset or invite link `createAccessLink` | no | **YES** (whoever gets the link sets the admin's password) |
| Reset 2FA `resetUserTwoFactor` | no | **YES** (2FA is what still protects an admin after a reset link; removing it opens a takeover) |
| Delete `deleteUser` | no | **YES** (irreversible; also covers invitees and passive admins) |
| Sign out everywhere `signOutUserEverywhere` | no | **no**: a defensive tool that grants nothing; at worst the admin logs in again; must stay quick for a lost phone |
| Unlock `unlockUser` | no | **no**: only clears the brute-force lock and grants nothing |
| E-mail access `emailAccess` | no | **no**: it needs a sealed handle or a raw token that only a step-up-checked action (or the user's own "forgot password") can produce, and it sends only to the account's own e-mail |
| Own row (self) | — | no: self can only change their name here; e-mail, password and 2FA already go through Hesabım with the password |

The combined `saveUser` rule:
`adminInvolved = before.role === "admin" || after.role === "admin"`, and step-up is needed when
`adminInvolved && (role changed || active changed || normEmail(before) !== normEmail(after) || password set)`.

**Also close a bypass.** `saveUser` still contains a dead "create" branch (`id: null` → insert with a password). The
UI never uses it, but the server action is callable directly, and it would create an admin without going through
`createUser`. Make `id` required in `userSchema` and delete that branch.

## User-facing behaviour (Turkish UI, phone first)

### The dialog
- Reuse Hesabım's `ConfirmPasswordDialog`. **Move** it from `src/app/panel/hesap/confirm-password.tsx` to
  `src/components/panel/confirm-password-dialog.tsx` with `git mv`, so that kullanıcılar (and group 3, backup restore)
  import it without a cross-route import. Changes to it:
  - `description: ReactNode` instead of `string`.
  - Phone tap targets: input `className="h-11 pointer-coarse:h-11"`, and footer buttons `max-sm:h-11` with
    `max-sm:bg-panel` on Vazgeç, like `ConfirmDialog`.
  - Otherwise unchanged: a single field "Parolanız", `type=password`, `autoComplete="current-password"`,
    `data-autofocus` (the keyboard does not pop up by itself on touch, so the description stays readable), error
    under the field, buttons "Vazgeç" / `confirmLabel` (danger variant when `danger`), "Bekleyin…" while pending,
    and `onConfirm(password) => Promise<string | null>` (a non-null return value stays in the dialog as the error).
  - Phone: it is the existing `Dialog` (`size="sm"`), so it opens as a bottom sheet and can stack over an open
    user dialog or sheet. `Dialog` already reopens stacked dialogs in order after an Esc.
- It is always rendered as a **sibling** of the user dialog (inside the component's fragment), never inside its
  children. This is the same rule as the existing `ConfirmDialog` comment: React forwards close/cancel events from an
  inner `<dialog>` to the outer one.

### Texts (pure builder `stepUpText()` in `src/app/panel/kullanicilar/step-up-text.ts`)
Every description ends with: **"Onaylamak için kendi parolanızı girin."**

- **Add admin** (new-user dialog, role = Yönetici, on submit)
  - title `"{ad} yönetici olarak eklensin mi?"`
  - description "Yönetici maliyet, kâr, ayarlar ve kullanıcılar dahil her şeyi görür ve değiştirir. Onaylamak için kendi parolanızı girin."
  - button "Yöneticiyi ekle" (password mode) / "Ekle ve bağlantı oluştur" (invite mode)
- **Edit an admin, or promote someone** (edit dialog, on Kaydet)
  - title "Değişiklikleri onaylayın", button "Kaydet"
  - `danger` when the changes include deactivate or demote
  - description: one sentence per change, in this order, then the closing sentence:
    - promote: `"{ad} yönetici olacak: maliyet, kâr, ayarlar ve kullanıcılar dahil her şeyi görür."`
    - demote: `"{ad} artık yönetici olmayacak (personel)."`
    - deactivate: `"{ad} pasif olacak: giriş yapamaz, açık oturumları kapanır."`
    - activate: `"{ad} yeniden giriş yapabilecek."`
    - e-mail: `"Giriş e-postası {eski} yerine {yeni} olacak."`
    - password: `"{ad} kullanıcısının parolası değişecek; açık oturumları kapanır."`; for an invitee:
      `"{ad} için parola belirlenecek; davet bağlantısı çalışmaz olur."`
- **List switch on an admin row**: when the only change is `active`, the title is specialised:
  - off: title `"{ad} pasif yapılsın mı?"`, description "Bu kullanıcı bir daha giriş yapamaz, açık oturumları kapanır. Bilgileri silinmez; istediğiniz zaman yeniden aktif yapabilirsiniz. Onaylamak için kendi parolanızı girin.", button "Pasif yap", danger
  - on: title `"{ad} yeniden aktif yapılsın mı?"`, description "Bu yönetici hesabıyla yeniden giriş yapılabilir. Onaylamak için kendi parolanızı girin.", button "Aktif yap"
- **Link for an admin** (edit dialog › Güvenlik, or the list's Send icon on a pending admin invite)
  - With a live link: title = `relinkText(u).title`, description = `relinkText(u).description` + the sentence below.
    This one dialog replaces the existing relink `ConfirmDialog`, so there is no double prompt.
  - Without one: title `"{ad} için parola sıfırlama bağlantısı oluşturulsun mu?"` (invitee:
    `"{ad} için yeni davet bağlantısı oluşturulsun mu?"`).
  - Sentence: reset → "Bağlantıyı alan kişi bu yönetici hesabına yeni parola belirleyebilir."; invite → "Bağlantıyı alan kişi yönetici olarak giriş yapabilir."
  - button "Bağlantı oluştur"
- **Reset an admin's 2FA**
  - title "İki adımlı doğrulama sıfırlansın mı?"
  - description "Telefonunu kaybeden kullanıcı için. Girişte yalnızca parola istenir; kişi Hesabım'dan yeniden kurabilir. Onaylamak için kendi parolanızı girin."
  - button "Sıfırla", danger
- **Delete an admin**
  - title `"{ad} silinsin mi?"`
  - description: the existing text + " Onaylamak için kendi parolanızı girin."
  - button "Kalıcı olarak sil", danger
- **Fallback** (the server asked for the password but the client rule did not expect it, e.g. a stale row)
  - title "Parolanızla onaylayın"
  - description "Bu işlem bir yönetici hesabını etkiliyor. Onaylamak için kendi parolanızı girin."
  - button "Onayla"

Inline hints, so the extra step is not a surprise:
- New-user dialog: when role = Yönetici, show `text-xs text-ink-mute` under the role cards: "Yönetici eklerken kendi
  parolanız sorulur."
- Edit dialog: when `needsStepUp(...)` is true for the current form state, show above the Güvenlik block: "Bu
  değişiklik bir yönetici hesabını etkiliyor; kaydederken kendi parolanız sorulur."
- `RolesCard` description gets a sentence appended: "Yönetici eklemek ya da bir yöneticinin rolünü, parolasını,
  e-postasını değiştirmek kendi parolanızı ister."

Errors (constants in `src/lib/step-up.ts`):
- `STEP_UP_REQUIRED = "Bu işlem için kendi parolanızı girin"`
- `WRONG_PASSWORD = "Parola hatalı"`
- `TOO_MANY_REAUTH = "Çok fazla hatalı parola. 15 dakika sonra yeniden deneyin."`

All three are today's Hesabım texts, except the first, which is new. `isStepUpError(msg)` returns true for these
three and for "Parolanızı girin". Those errors stay in the dialog under the field. **Any other error** (duplicate
e-mail, last admin, not found…) closes the dialog and goes where it goes today: toast, or the e-mail field error in
the new-user dialog.

Empty and edge states: the staff-only flows look and behave exactly as today. A cafe with one admin (the owner) sees
the dialog only when adding a second admin.

## Server logic

### New: `src/server/auth/step-up.ts` (`import "server-only"`, NOT `"use server"`)
Move here from `src/server/actions/auth.ts`: `reauthFails` (`createLimiter({ limit: 5, windowMs: 15 min })`) and
`confirmPassword`. **They must not be exported from a `"use server"` file**: that would make a client-callable
password oracle. This is why they move rather than get exported. Exports:

```ts
type Where = "Hesabım" | "Kullanıcılar";
/** Deneme doğrulamadan önce sayılır (Hesabım ve Kullanıcılar aynı payı kullanır: kişi başına 15 dakikada 5 hata) */
export async function confirmPassword(me: CurrentUser, password: string, where: Where, what?: string)
  : Promise<{ ok: true; user: typeof s.users.$inferSelect } | { ok: false; error: string }>;
/** attempt() içinde: parola boşsa "Parolanızı girin", tutmazsa UserError */
export async function requirePassword(me: CurrentUser, password: string, where: Where, what?: string);
/** Kullanıcılar: kural onay istiyorsa çağrılır; onay yoksa STEP_UP_REQUIRED */
export async function requireStepUp(me: CurrentUser, confirm: unknown, what: string): Promise<void>;
```

- `confirmPassword` keeps today's logic: `reauthFails.hit(String(me.id))` → `TOO_MANY_REAUTH`; select the user row;
  `verifyPassword`; on success `undo` and return the row. On failure it calls
  `logActivity(me, \`Hatalı parola onayı (${where})\`, what ? \`${me.email} · ${what}\` : me.email)` and returns
  `WRONG_PASSWORD`. The Hesabım log line stays byte-identical, because Hesabım passes no `what`.
- `requireStepUp` parses `confirm` with `z.object({ password: z.string().max(200) }).optional()`. If it is missing or
  the password is empty, it throws `new UserError(STEP_UP_REQUIRED)`. Otherwise it calls
  `requirePassword(me, password, "Kullanıcılar", what)`.
- The confirm input is an object (`{ password }`), so a later code field can be added without changing signatures.

### `src/server/actions/auth.ts` (Hesabım, no behaviour change)
- Delete the local `reauthFails`, `confirmPassword` and `requirePassword`, and import them from
  `@/server/auth/step-up`.
- Call sites pass `"Hesabım"`: `changePasswordAction` (keeps the `"Mevcut parola hatalı"` mapping against
  `WRONG_PASSWORD`), `updateProfile`, `signOutOtherSessions`, `beginTotpSetup`, `disableTotp`,
  `regenerateRecoveryCodes`.
- `MAX_FAILED`, `LOCK_MINUTES` and the login limiters stay where they are.

### `src/lib/step-up.ts` (pure, shared by client and server; importable by tests)

```ts
import type { Role } from "./constants";
export type StepUpCase =
  | { kind: "create"; role: Role }
  | { kind: "save"; before: { role: Role; active: boolean; email: string };
                    after: { role: Role; active: boolean; email: string; password: boolean } }
  | { kind: "link" | "2fa" | "delete"; targetRole: Role };
export type StepUpChange = "promote" | "demote" | "deactivate" | "activate" | "email" | "password";
export function stepUpChanges(c: Extract<StepUpCase, { kind: "save" }>): StepUpChange[]; // empty when not admin-involved
export function needsStepUp(c: StepUpCase): boolean;
export function stepUpWhat(c: StepUpCase): string; // audit text: "yönetici ekleme", "yönetici hesabı değişikliği",
                                                    // "yönetici için bağlantı", "yöneticinin iki adımlısını sıfırlama", "yönetici silme"
export const STEP_UP_REQUIRED, WRONG_PASSWORD, TOO_MANY_REAUTH; export function isStepUpError(m: string): boolean;
```

E-mail comparison normalises with `trim().toLowerCase()`, the same normalisation the zod schemas apply.

### `src/server/actions/settings.ts` (user section only; `saveSettings` is untouched)
Every action gets an optional last parameter `confirm?: { password: string }`, so existing call sites still
type-check. Step-up runs **after** every validation and DB check (so nobody types a password for an action that would
fail anyway) and **before** the first write.
- `saveUser(input, confirm?)`
  - `id` becomes required; the create branch and the `if (data.id)` wrapper go.
  - Read `before` right after the duplicate e-mail check, keeping the existing self, last-admin and self
    password/e-mail guards.
  - Then: `if (needsStepUp({ kind: "save", before, after: { role: data.role, active: data.active, email: data.email, password: Boolean(data.password) } })) await requireStepUp(me, confirm, \`${stepUpWhat(...)}: ${before.email}\`)`.
  - Keep the line `if (data.password || before.email !== data.email || (before.active && !data.active)) await expireUserTokens(data.id);`
    verbatim: `tests/roller.test.ts` matches it.
  - Update the doc comment: remove the "açık kalmış bir yönetici oturumu… her şeyi değiştirebilir" sentence and
    describe the step-up instead.
- `createUser(input, confirm?)`: after the duplicate check,
  `if (needsStepUp({ kind: "create", role: data.role })) await requireStepUp(me, confirm, \`yönetici ekleme: ${data.email}\`)`.
- `deleteUser(id, confirm?)`: after the not-found and last-admin checks, use `{ kind: "delete", targetRole: u.role }`.
- `resetUserTwoFactor(id, confirm?)`: first `select { id, email, role }` (throw "Kullanıcı bulunamadı" if missing),
  then step-up with `{ kind: "2fa", targetRole }`, then the existing update.
- `unlockUser` and `signOutUserEverywhere`: unchanged.

### `src/server/actions/invites.ts`
- `createAccessLink(id, confirm?)`: add `role` to the select. After the `!u.active` check and **before**
  `issueUserToken`, run step-up with `{ kind: "link", targetRole: u.role }`.
- `emailAccess` and the public actions: unchanged.

## Client wiring: `src/app/panel/kullanicilar/users-client.tsx`
- A small local hook,
  `useStepUp(): { ask(req: StepUpRequest): void; dialog: ReactNode }`, where
  `StepUpRequest = { title; description; confirmLabel; danger?; run(confirm: { password: string }) => Promise<string | null> }`.
  `run` returns a step-up error string to keep the dialog open, or `null` when it is done. On `null` the dialog
  closes; `run` itself toasts any non-step-up error before returning `null`. Each component that needs the dialog
  calls the hook and renders `{dialog}` as a fragment sibling: `UsersEditor`, `NewUserDialog` (wrap its return in
  `<>…</>`) and `UserDialog`.
- **Fallback.** Wherever a call made without `confirm` returns `res.error === STEP_UP_REQUIRED`, open the fallback
  request and retry the same call with `confirm`.
- `UsersEditor`
  - Replace `onToggle={(next) => (next ? setActive(u, true) : setConfirmOff(u))}` with `toggle(u, next)`. Admin rows
    → `ask(...)` with the toggle texts, and `run` calls `saveUser({ id, name, email, role, active: next }, confirm)`
    (no optimistic update; the switch keeps its state until the server refreshes). Staff rows → today's path
    (optimistic, and `ConfirmDialog` for "off").
  - `createLink(u, keepEditor, confirm?)` returns `Promise<string | null>` instead of toasting on step-up errors.
  - `newLink(u, keepEditor)`: admin → `ask(...)` with the link text (this includes the relink text when
    `u.liveLink`); staff → today's path (`ConfirmDialog` when there is a live link).
- `NewUserDialog.submit`: after local validation, if `role === "admin"` → `ask(...)` with the "add admin" text, and
  `run` calls `createUser(payload, confirm)`. On success → `onCreated(...)`, exactly as today, which unmounts both
  dialogs and opens `AccessSheet`. On an e-mail error → close the dialog, set the e-mail field error and focus it,
  as today. Staff → unchanged.
- `UserDialog`
  - `submit` computes
    `needsStepUp({ kind: "save", before: user, after: { role, active, email, password: password !== "" } })`.
    True → `ask(...)` with the edit texts built from `stepUpChanges`; `run` calls `saveUser(payload, confirm)` and
    then continues with today's success branch (`onAccess` for a new password, otherwise toast "Kullanıcı
    kaydedildi" and `onClose`). False → unchanged.
  - Güvenlik: for an admin target, "İki adımlıyı sıfırla" and "Sil" call `ask(...)` instead of
    `setConfirm("2fa" | "delete")`. `run` calls `resetUserTwoFactor(user.id, confirm)` or
    `deleteUser(user.id, confirm)`, then today's toast and `onClose`. Staff targets keep `ConfirmDialog`. "Kilidi aç"
    and "Tüm oturumlarını kapat" are unchanged.
- Add the hint lines and the `RolesCard` sentence listed above.
- `src/app/panel/hesap/sessions.tsx` and `two-factor.tsx`: only the import path changes.

## Files

Add
- `src/lib/step-up.ts`: the rule, change list, audit text and error constants (pure).
- `src/server/auth/step-up.ts`: the shared limiter, `confirmPassword`, `requirePassword` and `requireStepUp`
  (`server-only`).
- `src/app/panel/kullanicilar/step-up-text.ts`: the Turkish dialog texts (pure; reuses `relinkText` from `./access`).
- `src/components/panel/confirm-password-dialog.tsx`: moved from `src/app/panel/hesap/confirm-password.tsx`
  (`git mv`, small edits listed above).
- `tests/yonetici-onayi.test.ts`.

Change
- `src/server/actions/auth.ts`: move the helpers out; call sites pass `"Hesabım"`.
- `src/server/actions/settings.ts`: user-management section only.
- `src/server/actions/invites.ts`: `createAccessLink` only.
- `src/app/panel/kullanicilar/users-client.tsx`: the wiring above.
- `src/app/panel/hesap/sessions.tsx` and `src/app/panel/hesap/two-factor.tsx`: import path.
- Docs: `README.md`, `docs/DEPLOY.md`, `src/app/panel/yardim/page.tsx`.

No change
- `src/server/db/schema.ts` and drizzle (no migration), `src/app/panel/kullanicilar/page.tsx`, nav, dashboard,
  notifications, digest.

## Edge cases and interactions (no regressions)
- **Owner is the only admin.** Nothing changes for staff work. Only "add admin" asks for the password.
- **Two admins.** A editing B: anything beyond a name change asks for A's password. A can still sign B out and
  unlock B without a password.
- **Self row.** Never asks. The existing guards already block self role, active, e-mail and password changes here.
- **Invitee admin** (`passwordHash = "!davet-bekliyor"`, can't log in yet): link, password, e-mail, delete and
  passive all ask, because an invite link to an admin seat is admin access.
- **Passive admin.** Name only → no. Activate, password, link, delete → yes.
- **Last-admin guards** ("En az bir aktif yönetici kalmalı", "Kendi yönetici yetkinizi kaldıramazsınız") run before
  step-up, so their errors come out without a password prompt.
- **Wrong password, too many attempts.** The shared in-memory limiter (5 wrong per 15 minutes per person) covers
  Hesabım and Kullanıcılar together, so an intruder cannot get 5 tries in each. It is first-line and per instance,
  as today. Every wrong attempt is written to the activity log with what was attempted.
- **Stale UI** (the role changed in another tab): the server decides from DB state. The client gets
  `STEP_UP_REQUIRED`, shows the fallback dialog and retries with the password.
- **`emailAccess` after creating an admin**: unchanged. The handle or token came from a step-up-checked call.
- **`AccessSheet` close guard and `CloseGuardFooter`**: unchanged. The step-up dialog closes before `AccessSheet`
  opens, because `onCreated` and `onAccess` unmount the dialogs.
- **Dialog stacking**: step-up over `UserDialog` or `NewUserDialog` works like today's `ConfirmDialog` over
  `UserDialog`. Esc closes the top dialog first, and `UserDialog`'s own discard guard still protects unsaved edits.
- **No navigation is involved** (router refresh only via `refresh()` in the actions), so the "close dialogs before
  navigation" rule is not affected.
- **Password manager**: the field is the only password input in its form and uses `current-password`. It is not
  mixed into the new-user form, whose new-user password is `new-password`. Mixing them could make browsers treat it
  as a change-password form.
- **Known limitation, documented.** If the acting admin's password is saved in the shared PC's browser, autofill
  satisfies this check too. The docs say not to save it there (see owner decision 3). Persistent **staff** access
  (an intruder adds a staff account) stays possible by design and is logged (owner decision 1).
- **Group 3 (backup restore)** can and should reuse `requireStepUp` / `requirePassword` and `ConfirmPasswordDialog`:
  a restore can rewrite the `users` table.

## Tests: `tests/yonetici-onayi.test.ts` (npx tsx --test)
1. `needsStepUp`, as a table:
   - create: admin yes, staff no
   - save:
     - promote and demote: yes
     - admin password set: yes
     - admin e-mail change: yes; case/space-only difference: no
     - admin deactivate and activate: yes
     - admin name-only: no
     - staff password, e-mail or active: no
   - link, 2fa and delete: admin yes, staff no
2. `stepUpChanges` order and contents, e.g. promote + password → `["promote", "password"]`; staff → `[]`.
3. `stepUpText`:
   - Every case's description ends with "Onaylamak için kendi parolanızı girin." and contains the name.
   - Titles are distinct across the cases.
   - Link + live link contains the `relinkText` description ("hemen çalışmaz olur").
   - Invitee + password uses the "davet bağlantısı çalışmaz olur" sentence.
   - The single active toggle uses the specialised titles.
   - Danger is set for deactivate, demote, 2fa and delete.
4. `isStepUpError`: true for the constants and "Parolanızı girin"; false for "Bu e-posta başka bir kullanıcıda
   kayıtlı" and "En az bir aktif yönetici kalmalı".
5. Source guards (`readFileSync`, the same style as `tests/sayim-guvenlik.test.ts` and `tests/roller.test.ts`):
   - `src/server/auth/step-up.ts` starts with `import "server-only"` and does not contain `"use server"`.
   - `auth.ts` has no `createLimiter(` for reauth (no `const reauthFails`) and imports from `@/server/auth/step-up`.
   - In each body of `createUser`, `saveUser`, `deleteUser` and `resetUserTwoFactor` (settings.ts) and
     `createAccessLink` (invites.ts), sliced from `export async function NAME` to the next `export async function`:
     `requireStepUp(` is present, and its index is smaller than the first `.insert(`, `.update(`, `.delete(` or
     `issueUserToken(`.
   - The `saveUser` body has no `.insert(s.users)` (the create bypass is gone).
6. Existing suites must stay green: `tests/roller.test.ts` (its `expireUserTokens` regex),
   `tests/kullanicilar-erisim.test.ts`, `tests/kullanici-davet.test.ts` and `tests/giris-guvenlik.test.ts`.

Manual check at 390px and on desktop:
- Add an admin (password mode and invite mode).
- Promote and demote.
- Turn the list switch off and on for an admin row.
- Admin link with and without a live link.
- 2FA reset and delete on an admin.
- Wrong password: the error stays in the dialog; 6 wrong → the limit message.
- Staff flows: no dialog.
- Hesabım: 2FA on/off, sessions and profile still work.

## Docs to update
- `docs/DEPLOY.md` §6a:
  - Replace "Yöneticiler bütün kullanıcıları yönetir: açık kalmış bir yönetici oturumu yeni bir yönetici açıp onunla
    her şeyi değiştirebilir." with a new bullet, **Parolayla onay (yönetici işlemleri)**. It lists the YES rows of the
    table, says staff work, name changes, unlock and sign-out do not ask, and says the rule lives in
    `src/lib/step-up.ts` and is re-checked by the server.
  - Same limit as Hesabım (5 wrong per 15 minutes, shared); failures are logged as "Hatalı parola onayı
    (Kullanıcılar)".
  - Add: "Ortak bilgisayarda tarayıcıya parolanızı kaydettirmeyin; kaydedilmiş parola bu onayı da doldurur."
  - Keep the existing "Ortak cihazda işiniz bitince çıkış yapın…" sentence.
- `README.md` "Oturum" bullet: add "yönetici hesaplarını etkileyen işlemler (yönetici ekleme ya da yapma, bir
  yöneticinin parolası, e-postası, iki adımlısı, bağlantısı, pasif yapma, silme) işlemi yapanın kendi parolasıyla
  onaylanır".
- `src/app/panel/yardim/page.tsx`, FAQ "Personele hesap açmak": append "Yönetici eklerken ya da bir yöneticinin
  rolünü, parolasını, e-postasını değiştirirken kendi parolanız sorulur." Use `&apos;` escapes and keep the `<Path>`
  line-break rule that `tests/yardim.test.ts` checks.

## Owner decisions (recommended defaults are what the plan implements)
1. Should staff changes (add staff, set a staff password, staff reset link, delete staff) also ask for the password?
   **Default: no.** It is routine (barista turnover). Staff cannot see costs, finance, settings or users, and every
   change is logged.
2. Should "Tüm oturumlarını kapat" and "Kilidi aç" on an admin ask? **Default: no.** Both are defensive, grant
   nothing, and need to be fast.
3. If the acting admin has 2FA, should the dialog also ask for the 6-digit code? **Default: not in this change.**
   Done properly, it also needs Hesabım's "İki adımlıyı kapat" and "Yeni kurtarma kodları" to ask for the code, with
   a recovery-code fallback for a lost phone; otherwise someone could just turn 2FA off first. Possible follow-up.
   The `{ password }` confirm object leaves room for a `code` field.
4. Should a "remember for N minutes" step-up window skip the repeat prompts? **Default: no; ask every time.**
   Admin-level actions are rare, and a window reopens the walk-away gap on a shared PC.
5. Should other admins get a bell or e-mail notice when an admin is added or promoted, or an admin's password or
   e-mail changes? **Default: no** (the activity log records it). It could be added later on top of group 4's
   notification work.

## Shared files (integration conflicts)
- `src/server/actions/settings.ts`: other groups may add settings keys in `saveSettings`; this plan only touches the
  "Kullanıcılar" section below it.
- `docs/DEPLOY.md` (§6a here; groups 2 and 3 edit §7 "Güncelleme ve yedek"), `README.md`, and
  `src/app/panel/yardim/page.tsx` (other groups add FAQ entries).
- `src/server/actions/auth.ts` (login and Hesabım).
- `src/components/panel/confirm-password-dialog.tsx` (new, moved) and `src/server/auth/step-up.ts` (new): offered for
  group 3 to reuse.
- Not touched: `schema.ts`, `nav.ts`, dashboard, notifications, digest.
