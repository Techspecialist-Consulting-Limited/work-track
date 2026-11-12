-- 0006: teams, employee-team membership, per-team project library and config admins.
-- Additive only: existing tasks keep their data. Tasks created after this migration
-- may reference a team and a catalog project; legacy tasks stay project-less and are
-- still readable everywhere (the UI falls back to the task title).

CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'admin' NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_key" ON "teams" USING btree (lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_default_key" ON "teams" USING btree ("is_default") WHERE "is_default";
--> statement-breakpoint
CREATE INDEX "teams_active_idx" ON "teams" USING btree ("is_active");
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_origin_check" CHECK ("origin" IN ('admin', 'backfill'));
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "employee_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_teams_employee_team_key" ON "employee_teams" USING btree ("employee_id","team_id");
--> statement-breakpoint
CREATE INDEX "employee_teams_team_idx" ON "employee_teams" USING btree ("team_id");
--> statement-breakpoint
ALTER TABLE "employee_teams" ADD CONSTRAINT "employee_teams_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_teams" ADD CONSTRAINT "employee_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_teams" ADD CONSTRAINT "employee_teams_created_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "team_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'admin' NOT NULL,
	"created_by_employee_id" uuid,
	"created_by_membership_id" uuid,
	"promoted_at" timestamp with time zone,
	"promoted_by_membership_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_projects_team_name_key" ON "team_projects" USING btree ("team_id", lower("name")) WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "team_projects_team_idx" ON "team_projects" USING btree ("team_id","is_active");
--> statement-breakpoint
ALTER TABLE "team_projects" ADD CONSTRAINT "team_projects_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "team_projects" ADD CONSTRAINT "team_projects_origin_check" CHECK ("origin" IN ('admin', 'staff'));
--> statement-breakpoint
ALTER TABLE "team_projects" ADD CONSTRAINT "team_projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_projects" ADD CONSTRAINT "team_projects_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_projects" ADD CONSTRAINT "team_projects_created_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_projects" ADD CONSTRAINT "team_projects_promoted_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("promoted_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tasks" ADD COLUMN "team_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_team_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."team_projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_team_idx" ON "tasks" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_employee_project_key" ON "tasks" USING btree ("employee_id","project_id") WHERE "project_id" IS NOT NULL AND "archived_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "worktrack_memberships" ADD COLUMN "is_config_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "worktrack_memberships" ADD COLUMN "active_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "worktrack_memberships" ADD CONSTRAINT "memberships_active_team_id_teams_id_fk" FOREIGN KEY ("active_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "memberships_active_team_idx" ON "worktrack_memberships" USING btree ("active_team_id");
--> statement-breakpoint

-- Backfill: one team per distinct department, explicitly marked as auto-created
-- and unverified. Names are not merged or guessed beyond case/whitespace.
INSERT INTO "teams" ("name", "description", "origin")
SELECT DISTINCT btrim("department"), 'Auto-created from the employee department. Verify the name and assignments before relying on it.', 'backfill'
FROM "employees"
WHERE btrim("department") <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A default team keeps staff without a department (including auto-provisioned
-- accounts) able to log work. It is visible as backfilled and can be renamed.
INSERT INTO "teams" ("name", "description", "is_default", "origin")
SELECT 'General', 'Default team for staff without a department. Reassign members as needed.', true, 'backfill'
WHERE NOT EXISTS (SELECT 1 FROM "teams" WHERE "is_default")
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "employee_teams" ("employee_id", "team_id")
SELECT e."id", t."id"
FROM "employees" e
JOIN "teams" t ON lower(btrim(e."department")) = lower(t."name")
WHERE btrim(e."department") <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "employee_teams" ("employee_id", "team_id")
SELECT e."id", t."id"
FROM "employees" e
CROSS JOIN "teams" t
WHERE btrim(e."department") = '' AND t."is_default"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Give staff an initial active team so the selector starts on a valid choice.
UPDATE "worktrack_memberships" m
SET "active_team_id" = et."team_id"
FROM (
	SELECT DISTINCT ON ("employee_id") "employee_id", "team_id"
	FROM "employee_teams"
	ORDER BY "employee_id", "created_at", "team_id"
) et
WHERE m."employee_id" = et."employee_id"
	AND m."role" = 'staff'
	AND m."active_team_id" IS NULL;
