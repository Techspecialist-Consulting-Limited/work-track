ALTER TABLE "worktrack_invitations" ADD COLUMN "email_status" text;
ALTER TABLE "worktrack_invitations" ADD COLUMN "email_attempted_at" timestamp with time zone;
ALTER TABLE "worktrack_invitations" ADD COLUMN "email_last_error" text;
