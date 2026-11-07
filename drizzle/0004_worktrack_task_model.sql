-- 0004: task/subtask model, progress updates with revision history, and
-- task-level status. Additive first, then a deliberate enum conversion.
--
-- Legacy status mapping (documented, not silent):
--   not_started -> ongoing
--   completed   -> done
--   ongoing / blocked / dropped unchanged
-- Work entries no longer own a status. The legacy task_status_snapshot column
-- is retained read-only for rollback, but the application stops writing it.

CREATE TABLE "task_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "task_categories_name_key" ON "task_categories" USING btree ("name");
--> statement-breakpoint
INSERT INTO "task_categories" ("name") VALUES
	('Development'),
	('Design'),
	('Analysis'),
	('Operations'),
	('Support'),
	('Administration')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- Report table: preserved alongside the migration for audit/rollback.
CREATE TABLE "worklog_reconciliation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
INSERT INTO "worklog_reconciliation_log" ("report")
SELECT jsonb_build_object(
	'tasks', (SELECT count(*) FROM "tasks"),
	'statuses', (SELECT jsonb_object_agg(s, c) FROM (SELECT "current_status"::text AS s, count(*) AS c FROM "tasks" GROUP BY 1) x),
	'notStartedMappedToOngoing', (SELECT count(*) FROM "tasks" WHERE "current_status" = 'not_started'),
	'completedMappedToDone', (SELECT count(*) FROM "tasks" WHERE "current_status" = 'completed'),
	'entryStatusSnapshots', (SELECT count(*) FROM "time_entries" WHERE "task_status_snapshot" IS NOT NULL),
	'entrySnapshotConflicts', (
		SELECT count(*) FROM "time_entries" te
		JOIN "tasks" t ON t."id" = te."task_id"
		WHERE te."task_status_snapshot" IS NOT NULL
		  AND te."task_status_snapshot" <> t."current_status"
	),
	'breaks', (SELECT count(*) FROM "time_entries" WHERE "entry_type" = 'break'),
	'note', 'Entry-level statuses are legacy snapshots; task status is authoritative and work entries no longer own status.'
);
--> statement-breakpoint

ALTER TABLE "tasks" ADD COLUMN "category_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status_updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_membership_id" uuid;
--> statement-breakpoint
UPDATE "tasks" SET "status_updated_at" = "updated_at" WHERE "status_updated_at" IS NULL;
--> statement-breakpoint

CREATE TABLE "task_subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'ongoing' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_subtasks_title_not_blank" CHECK (length(btrim(title)) > 0)
);
--> statement-breakpoint
CREATE INDEX "task_subtasks_task_order_idx" ON "task_subtasks" USING btree ("task_id","display_order");
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_created_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "task_progress_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"subtask_id" uuid,
	"author_employee_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"edited_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_progress_updates_body_not_blank" CHECK (length(btrim(body)) > 0),
	CONSTRAINT "task_progress_updates_body_length" CHECK (char_length(body) <= 2000)
);
--> statement-breakpoint
CREATE INDEX "task_progress_updates_task_idx" ON "task_progress_updates" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "task_progress_updates_subtask_idx" ON "task_progress_updates" USING btree ("subtask_id");
--> statement-breakpoint
ALTER TABLE "task_progress_updates" ADD CONSTRAINT "task_progress_updates_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_progress_updates" ADD CONSTRAINT "task_progress_updates_subtask_id_task_subtasks_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."task_subtasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_progress_updates" ADD CONSTRAINT "task_progress_updates_author_employee_id_employees_id_fk" FOREIGN KEY ("author_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_progress_updates" ADD CONSTRAINT "task_progress_updates_edited_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("edited_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "task_progress_update_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"progress_update_id" uuid NOT NULL,
	"previous_body" text NOT NULL,
	"revised_by_membership_id" uuid,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_reason" text
);
--> statement-breakpoint
CREATE INDEX "task_progress_update_revisions_update_idx" ON "task_progress_update_revisions" USING btree ("progress_update_id");
--> statement-breakpoint
ALTER TABLE "task_progress_update_revisions" ADD CONSTRAINT "task_progress_update_revisions_progress_update_id_task_progress_updates_id_fk" FOREIGN KEY ("progress_update_id") REFERENCES "public"."task_progress_updates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_progress_update_revisions" ADD CONSTRAINT "task_progress_update_revisions_revised_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("revised_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "subtask_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subtask_id" uuid NOT NULL,
	"previous_status" "task_status",
	"new_status" "task_status" NOT NULL,
	"changed_by_membership_id" uuid,
	"change_note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "subtask_status_history_subtask_idx" ON "subtask_status_history" USING btree ("subtask_id");
--> statement-breakpoint
ALTER TABLE "subtask_status_history" ADD CONSTRAINT "subtask_status_history_subtask_id_task_subtasks_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."task_subtasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subtask_status_history" ADD CONSTRAINT "subtask_status_history_changed_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("changed_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_task_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."task_categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_category_idx" ON "tasks" USING btree ("category_id");
--> statement-breakpoint

ALTER TABLE "time_entries" ADD COLUMN "subtask_id" uuid;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "updated_by_membership_id" uuid;
--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "time_entries" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "time_entries_subtask_idx" ON "time_entries" USING btree ("subtask_id");
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_subtask_id_task_subtasks_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."task_subtasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_updated_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_break_fields";
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_break_fields" CHECK (entry_type <> 'break' OR (task_id IS NULL AND subtask_id IS NULL AND work_location IS NULL AND work_type IS NULL));
--> statement-breakpoint

-- Status enum conversion. Done deliberately so no invalid status remains.
ALTER TYPE "public"."task_status" RENAME TO "task_status_legacy";
--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('ongoing', 'done', 'blocked', 'dropped');
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "current_status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "current_status" TYPE "public"."task_status" USING (
	CASE "current_status"::text
		WHEN 'not_started' THEN 'ongoing'
		WHEN 'completed' THEN 'done'
		ELSE "current_status"::text
	END
)::"public"."task_status";
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "current_status" SET DEFAULT 'ongoing';
--> statement-breakpoint
ALTER TABLE "task_status_history" ALTER COLUMN "previous_status" TYPE "public"."task_status" USING (
	CASE "previous_status"::text
		WHEN 'not_started' THEN 'ongoing'
		WHEN 'completed' THEN 'done'
		ELSE "previous_status"::text
	END
)::"public"."task_status";
--> statement-breakpoint
ALTER TABLE "task_status_history" ALTER COLUMN "new_status" TYPE "public"."task_status" USING (
	CASE "new_status"::text
		WHEN 'not_started' THEN 'ongoing'
		WHEN 'completed' THEN 'done'
		ELSE "new_status"::text
	END
)::"public"."task_status";
--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "task_status_snapshot" TYPE "public"."task_status" USING (
	CASE "task_status_snapshot"::text
		WHEN 'not_started' THEN 'ongoing'
		WHEN 'completed' THEN 'done'
		ELSE "task_status_snapshot"::text
	END
)::"public"."task_status";
--> statement-breakpoint
-- New tables were created before the enum conversion, so convert them too.
ALTER TABLE "task_subtasks" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ALTER COLUMN "status" TYPE "public"."task_status" USING ("status"::text)::"public"."task_status";
--> statement-breakpoint
ALTER TABLE "task_subtasks" ALTER COLUMN "status" SET DEFAULT 'ongoing';
--> statement-breakpoint
ALTER TABLE "subtask_status_history" ALTER COLUMN "previous_status" TYPE "public"."task_status" USING ("previous_status"::text)::"public"."task_status";
--> statement-breakpoint
ALTER TABLE "subtask_status_history" ALTER COLUMN "new_status" TYPE "public"."task_status" USING ("new_status"::text)::"public"."task_status";
--> statement-breakpoint
DROP TYPE "public"."task_status_legacy";
--> statement-breakpoint
