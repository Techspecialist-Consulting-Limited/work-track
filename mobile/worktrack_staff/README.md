# WorkTrack Staff (Flutter prototype)

Prototype **Support / Complaints** experience for the Flutter Staff mobile application.

By default the app runs in **mock-only mode**: no production employee records are touched and no real complaints are created.

## Included
- Support/Complaints section entry point
- Submit complaint (subject, description, image/document attachments)
- My complaints list with status
- Complaint conversation view (employee and management messages, timestamps, attachments)
- Reply with additional message/evidence
- Status visibility (New, In Progress, Awaiting Staff, Resolved, Reopened)
- Acknowledge or reopen a resolved complaint
- Optional connected mode against the shared WorkTrack complaints backend for an end-to-end conversation with web Admin

## Connecting the shared backend (end-to-end conversation)

The web Admin complaints inbox and the Flutter app use the same records when the mobile app is built/run with:

```bash
flutter run \
  --dart-define=WORKTRACK_API_BASE_URL=https://<your-worktrack-host> \
  --dart-define=WORKTRACK_ACCESS_TOKEN=<Entra access token> \
  --dart-define=WORKTRACK_ROLE=staff
```

- `WORKTRACK_ACCESS_TOKEN` is a Microsoft Entra access token accepted by the existing `/api/mobile/*` bearer flow. The API resolves the staff membership and employee server-side.
- `WORKTRACK_ROLE` is passed as `x-worktrack-role`; it is validated server-side, not trusted.
- Connected mode uses `/api/complaints`, `/api/complaints/[id]`, and `/api/complaints/attachments`. Attachments go to the private `worktrack-evidence` Supabase bucket and are downloaded through authorised, short-lived signed URLs.
- The conversation screen refreshes every 15 seconds while connected so staff see management replies and status changes.

Leave the `WORKTRACK_API_BASE_URL` dart-define empty to keep the isolated mock experience.

## Architecture notes
- `lib/models/` mirrors the shared complaint entities (complaint, message, attachment, status history) and parses API payloads.
- `lib/data/complaints_repository.dart` exposes one repository interface with a mock implementation and an API-backed implementation.
- `lib/data/complaints_api.dart` is the bearer-authenticated HTTP client for the shared complaints API.
- Employees can only access their own complaints; the server enforces this for both list and detail requests.
- Attachments are never stored as binaries in Postgres; metadata is stored in `complaint_message_attachments` and binaries live in private object storage.

## Prerequisites on the server
- Apply migration `0014_complaints` (`node --env-file=.env.local scripts/migrate.mjs`).
- Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and create the private `worktrack-evidence` bucket.
- Grant the signed-in employee a staff membership linked to an employee record.

## Later integration
Replace the prototype Entra token wiring with the production mobile sign-in flow. The complaint models, repository interface, and API endpoints are already shaped for that swap.
