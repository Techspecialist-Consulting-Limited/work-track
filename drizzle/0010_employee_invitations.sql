-- Employee invitations: secure single-use tokens, employer/client assignment,
-- work arrangement and optional team. Legacy chairman invitations keep
-- token_hash NULL and continue to redeem by email match.
ALTER TABLE "worktrack_invitations"
  ADD COLUMN "token_hash" text,
  ADD COLUMN "token_cipher" text,
  ADD COLUMN "expires_at" timestamp with time zone,
  ADD COLUMN "revoked_at" timestamp with time zone,
  ADD COLUMN "employer_organisation_id" uuid REFERENCES "organisations"("id"),
  ADD COLUMN "client_organisation_id" uuid REFERENCES "organisations"("id"),
  ADD COLUMN "work_arrangement" text,
  ADD COLUMN "team_id" uuid REFERENCES "teams"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key"
  ON "worktrack_invitations" ("token_hash")
  WHERE "token_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "worktrack_invitations" ("email");
--> statement-breakpoint
ALTER TABLE "worktrack_invitations"
  ADD CONSTRAINT "invitations_work_arrangement_check"
  CHECK ("work_arrangement" IS NULL OR "work_arrangement" IN ('in_house', 'client_site'));
