# WorkTrack — agent notes

## Stack

Next.js 16 (App Router, `cacheComponents` + partial prerendering), React 19, Tailwind 4, Drizzle ORM + `postgres` driver, Auth.js v5 (`next-auth@beta`) with Microsoft Entra ID, zod, exceljs.

## Database

- Supabase Postgres. `DATABASE_URL` in `.env.local` (gitignored) uses the **transaction pooler** (port 6543).
- Schema: `src/lib/db/schema.ts`. Migrations in `drizzle/` are the source of truth — apply with `node --env-file=.env.local scripts/migrate.mjs`. `drizzle-kit push` is broken by a check-constraint introspection bug; do not use it. `scripts/reset-db.mjs` wipes the public schema (destructive, dev only). Handwritten migrations 0003–0004 have no `meta/*_snapshot.json`, so `drizzle-kit generate` cannot diff from them — add SQL plus a `_journal.json` entry by hand instead.
- Seed: `node --env-file=.env.local --import tsx scripts/seed.mts` (categories, 5 employees, tasks, subtasks, progress updates, hourly entries and breaks for the exercise window). It runs in one transaction and upserts employees so memberships survive.
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
- `postgres` v4 pipelines statements by default; the Supabase transaction pooler hangs when several are in flight. Keep `max_pipeline: 1` in `src/lib/db/index.ts`, `scripts/migrate.mjs` and `scripts/seed.mts`.

## Evidence attachments

- Work-entry evidence files live in a **private Supabase Storage bucket** `worktrack-evidence`; Postgres stores only metadata in `time_entry_attachments` (migration 0013). Never store binaries in Postgres.
- Required env (add to `.env.local`): `SUPABASE_URL` (e.g. `https://<ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY` (server-only). Create the private bucket once: Supabase dashboard → Storage → New bucket `worktrack-evidence`, **uncheck public**.
- Routes: `POST /api/worklog/attachments` (staff upload, validates ext/MIME/10 MB, stores pending row with `entry_id NULL`), `GET|DELETE /api/worklog/attachments/[id]` (authz: owner staff or hr/chairman; GET 302s to a 120 s signed URL; DELETE only for unlinked pending uploads). `addWorkEntry`/`editWorkEntry` accept `attachmentIds` and link only the caller's own pending rows. Pending rows older than 24 h are reaped on upload.
- File rules are isomorphic in `src/lib/worklog/attachment-rules.ts` (unit-tested); storage calls are server-only in `src/lib/worklog/attachments.ts`.

## Complaints (shared staff ↔ management conversation)

- One shared conversation per complaint: `complaints`, `complaint_messages`, `complaint_status_history`, `complaint_message_attachments` (migration `0014_complaints`). Statuses: `new`, `in_progress`, `awaiting_staff`, `resolved`, `reopened`.
- Web admin inbox: `/admin/complaints` (`src/components/admin/ComplaintsAdmin.tsx`). Access is server-enforced to `isConfigAdmin || hr || chairman` in `src/app/admin/complaints/page.tsx`; staff only ever see their own records.
- APIs: `GET|POST /api/complaints`, `GET|POST /api/complaints/[id]`, `POST /api/complaints/attachments`, `GET|DELETE /api/complaints/attachments/[id]`. Reply/status mutations insert both the visible message and a `complaint_status_history` row; resolving requires a resolution response.
- Complaint attachments reuse the private `worktrack-evidence` bucket under `complaints/<complaintId>/…`, with metadata in `complaint_message_attachments`. Uploads are pending (`message_id NULL`) until linked by the reply/create call; abandoned rows are reaped after 24 h. Downloads are authorised 302 redirects to 120 s signed URLs.
- Mobile: `mobile/worktrack_staff/` is a Flutter prototype. It defaults to mock data. Connected mode (same backend/API as web) is enabled with `--dart-define=WORKTRACK_API_BASE_URL=… --dart-define=WORKTRACK_ACCESS_TOKEN=… --dart-define=WORKTRACK_ROLE=staff`; the token is the existing Entra bearer token resolved by `getRequestMembership`.
