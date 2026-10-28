# Bench-Suite — GHI Benchmark

A focused, Figma-inspired workspace for editing one illustrative GHI benchmark case, its processes and subprocesses, and the workflow graph. The default case is named `example-insurer`; its seeded process template is illustrative and contains no real company findings.

## Run locally

```sh
npm install
npm run dev
```

For local preview, sign in with any of `pankaj`, `sakshi`, `dheeraj`, or `vaibhav`. The shared demo password is `1234`. The workspace is stored in IndexedDB and updates between tabs in the same browser. Browser cache alone does not sync across devices or people.

## Share updates across users

1. Create a Supabase project and apply [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).
2. Disable public signups in Supabase Auth.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.example` in local development and in Vercel.
4. In a private shell, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run `npm run seed:users`. This creates the four accounts with password `1234`; the service role key is only used by this one-time script.
5. Redeploy. Supabase Auth, the shared Postgres workspace row, revision checks, and Realtime updates then let all four users see edits.

The four accounts intentionally share the requested demo password. Replace it with individual passwords before using non-demo data.

## Vercel

The app is a Vite SPA. `vercel.json` configures the build, output, and fallback route. Import the GitHub repository into Vercel and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before deploying if the team needs shared updates. A deployment without those values remains local-preview mode, with a separate IndexedDB copy in each browser.

## Included

- One example case: `example-insurer`.
- Editable processes and subprocesses, with add, edit, and archive controls.
- Benchmark status, automation, and a simple notes field per step.
- Plain pain-point notes per step, without severity scoring or a separate analysis page.
- Editable workflow graph with directed links and a process filter.
- IndexedDB local preview, optional Supabase shared storage, and four requested logins.

## Checks and demo

```sh
npm run test
npm run build
npm run record:demo
```

The demo recorder only accepts localhost and refuses to run when Supabase credentials are present. It uses an isolated browser context and records clearly illustrative edits to the example case.