# WorkTrack — agent notes

## Stack

Next.js 16 (App Router, `cacheComponents` + partial prerendering), React 19, Tailwind 4, Drizzle ORM + `postgres` driver, Auth.js v5 (`next-auth@beta`) with Microsoft Entra ID, zod, exceljs.

## Database

- Supabase Postgres. `DATABASE_URL` in `.env.local` (gitignored) uses the **transaction pooler** (port 6543).
- Schema: `src/lib/db/schema.ts`. Migrations in `drizzle/` are the source of truth — apply with `node --env-file=.env.local scripts/migrate.mjs`. `drizzle-kit push` is broken by a check-constraint introspection bug; do not use it. `scripts/reset-db.mjs` wipes the public schema (destructive, dev only).
- Seed: `node --env-file=.env.local --import tsx scripts/seed.mts` (5 employees, tasks, hourly entries, breaks for the exercise window).
- Provision a login: `node --env-file=.env.local scripts/provision-member.mjs <staff|hr|chairman> <employee-code|""> <entra-oid>`.

## Auth

- `/login` → role selection → Microsoft Entra sign-in → `/auth/complete` validates the `wt_login_role` cookie against the membership role, then redirects (`staff` → `/`, `hr`/`chairman` → `/executive`).
- Memberships live in `worktrack_memberships` keyed by `(microsoft_tenant_id, microsoft_object_id)`; staff rows must link an `employee_id`.
- Server guards: `requirePageAccess(roles)` in `src/lib/auth/authorize.ts` for pages; `requireStaff`/`requireManagement` for actions. JWT sessions carry `oid`/`tid` claims.
- The "No WorkTrack access" screen shows the user's `oid`/`tid` for provisioning.

## Data flow

- Server: `src/lib/db/worklog-data.ts` loads Postgres into the existing `WorkLogDatabase` shape (UUIDs are opaque ids — all UI selectors/calculations unchanged). `src/lib/db/worklog-actions.ts` implements mutations with authz + audit events.
- Client: `src/lib/worklog/repository.ts` is now a fetch-backed store — `GET /api/worklog/state` on subscribe, optimistic local mutation + `POST /api/worklog/action`, then reconciles with the returned snapshot. localStorage persistence is gone.
- Staff scope returns only the signed-in employee; management scope returns everyone.

## Gotchas

- `cacheComponents` is on: no `export const dynamic`; dynamic pages need `await connection()` inside a `<Suspense>` boundary (see existing page pattern).
- Do not run `next build` while `next dev` is running — they share `.next` and cause EPERM rename errors on Windows.
- Entries/breaks are hourly-aligned per `WORKTRACK_SCHEDULE`; the DB enforces non-overlap via a `tstzrange` exclusion constraint (`btree_gist`).
