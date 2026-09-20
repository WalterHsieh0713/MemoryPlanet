# Accounts and cloud journals

Supabase Auth manages email addresses, password hashing, confirmation, recovery and sessions.
`public.memory_planet_saves` holds one JSON library per user: every journal, memory, photo,
character, and saved world setting. Its foreign key points to `auth.users`; row-level security
limits reads and writes to that user. No service-role or secret key is used by this app.

## Connect a Supabase project

1. Create a project at https://supabase.com/dashboard (or use the team's existing project).
2. In the SQL editor, run `supabase/migrations/202609200001_journal_accounts.sql` once.
3. Copy `.env.example` to `.env` if needed, preserving any existing values. Set
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using the project's URL and **publishable** key.
   A legacy anon key also works via `SUPABASE_ANON_KEY`. Do not use `sb_secret_` or service-role keys.
4. In Authentication → URL Configuration, set the Site URL to your deployed site. Add
   `http://localhost:8000/` and the exact deployed origin with `/` as allowed redirect URLs.
   Keep email confirmation enabled. Configure email delivery for production in Supabase.
5. Restart `node server.js`. On Vercel, set those same two environment variables and redeploy.
   `/api/config` returns only the public URL/key. A static file server without API support
   still supports guest mode, but cannot load account configuration.

Without these settings the forms explain that accounts are not connected; they never pretend
to sign anyone in. Guest journals continue to work.

## Behavior

- Sign up → confirm email → log in → existing journal list/create flow.
- A stored session can reopen journals through “Open my journals”. Forgotten passwords send
  a recovery email; its link opens a new-password form on the landing page.
- Guest saves keep their original storage keys. Each account has separate local keys. Guest
  entries are **not automatically uploaded** into the next person's account.
- Cloud changes include creating/deleting/reordering journals, writing memories and photos,
  and changing the existing game settings. Saves are debounced by 800 ms and serialized.
- Failed saves remain pending on the device and retry when connectivity returns or through
  Account → Retry cloud save. Opening an account requires a successful cloud read.
- Revision checks prevent stale devices silently overwriting a newer cloud save. The account
  panel offers a JSON device backup and an explicit “Use cloud copy instead” action. Downloaded
  library backups contain complete worlds; each world can also be restored through the existing
  `MI.store.importJSON(JSON.stringify(backup.worlds[index]))` interface while in the desired account.
- Sign out ends this browser's session and returns to the cover. Pending device edits are kept
  under that account's key for its next login. Other accounts and guests do not load them.
- This first version writes a whole-library JSON snapshot, including inline photos. It suits a
  small project; large photo libraries should move to private Supabase Storage objects later.

## Checks

- `node scripts/test-journals.js` — existing local journal behavior.
- `node scripts/test-accounts.js` — account isolation, restore, offline retry, conflicts, and config.
- Run `supabase/tests/ownership.sql` in the SQL editor after setup. It checks real ownership
  policies and stale-revision rejection using temporary users inside a rolled-back transaction.
- With the live project connected, test signup + confirmation, login, recovery, creating a
  journal, signing out/in, and loading that journal in a second browser. Use two different
  accounts to confirm each starts with its own library.

## Files and dependencies

`src/ui/auth.js` owns account UI; `src/store/cloud.js` owns sync; `src/store/store.js` scopes the
existing persistence keys. The official Supabase JS SDK 2.116.0 is vendored in `vendor/supabase.js`
from https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js (MIT).
There is no bundler or package-install step.

References: https://supabase.com/docs/guides/auth and
https://supabase.com/docs/guides/database/postgres/row-level-security
