-- 0018: reusable main tasks with per-date subtask cycles.
-- Existing subtasks are assigned to the day of their latest linked work entry,
-- latest settled status change, completion, or creation (in that order).
CREATE TABLE "task_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "task_cycles_task_date_key" ON "task_cycles" USING btree ("task_id","work_date");
--> statement-breakpoint
ALTER TABLE "task_cycles" ADD CONSTRAINT "task_cycles_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD COLUMN "cycle_id" uuid;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD COLUMN "work_date" date;
--> statement-breakpoint
CREATE TEMP TABLE "task_subtask_cycle_backfill" ON COMMIT DROP AS
SELECT
	s."id" AS "subtask_id",
	s."task_id",
	COALESCE(
		(SELECT max((te."start_at" AT TIME ZONE 'Africa/Lagos')::date) FROM "time_entries" te WHERE te."subtask_id" = s."id"),
		(SELECT max((h."changed_at" AT TIME ZONE 'Africa/Lagos')::date) FROM "subtask_status_history" h WHERE h."subtask_id" = s."id" AND h."new_status" IN ('done', 'dropped')),
		(s."completed_at" AT TIME ZONE 'Africa/Lagos')::date,
		(s."created_at" AT TIME ZONE 'Africa/Lagos')::date
	) AS "work_date"
FROM "task_subtasks" s;
--> statement-breakpoint
INSERT INTO "task_cycles" ("task_id", "work_date")
SELECT DISTINCT b."task_id", b."work_date" FROM "task_subtask_cycle_backfill" b
ON CONFLICT ("task_id", "work_date") DO NOTHING;
--> statement-breakpoint
INSERT INTO "task_cycles" ("task_id", "work_date")
SELECT DISTINCT te."task_id", (te."start_at" AT TIME ZONE 'Africa/Lagos')::date
FROM "time_entries" te
WHERE te."task_id" IS NOT NULL AND te."voided_at" IS NULL
ON CONFLICT ("task_id", "work_date") DO NOTHING;
--> statement-breakpoint
INSERT INTO "task_cycles" ("task_id", "work_date")
SELECT
	t."id",
	COALESCE(
		(t."completed_at" AT TIME ZONE 'Africa/Lagos')::date,
		(SELECT max((h."changed_at" AT TIME ZONE 'Africa/Lagos')::date) FROM "task_status_history" h WHERE h."task_id" = t."id" AND h."new_status" IN ('done', 'dropped')),
		(t."created_at" AT TIME ZONE 'Africa/Lagos')::date
	)
FROM "tasks" t
ON CONFLICT ("task_id", "work_date") DO NOTHING;
--> statement-breakpoint
UPDATE "task_subtasks" s
SET "cycle_id" = c."id", "work_date" = b."work_date"
FROM "task_subtask_cycle_backfill" b
JOIN "task_cycles" c ON c."task_id" = b."task_id" AND c."work_date" = b."work_date"
WHERE s."id" = b."subtask_id";
--> statement-breakpoint
ALTER TABLE "task_subtasks" ALTER COLUMN "cycle_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ALTER COLUMN "work_date" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_cycle_id_task_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."task_cycles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_subtasks_task_date_idx" ON "task_subtasks" USING btree ("task_id","work_date");
