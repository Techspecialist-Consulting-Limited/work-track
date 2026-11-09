-- 0005: provenance for the 2026-11-06 recovery import.
-- Additive only: no existing column, row or constraint is dropped or rewritten.
--
-- 'unknown' work_location is a deliberate, visible value for records whose
-- location was never captured. It must not be presented as office/home.
ALTER TYPE "public"."work_location" ADD VALUE IF NOT EXISTS 'unknown';
--> statement-breakpoint

CREATE TABLE "recovery_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_key" text NOT NULL,
	"source_file" text NOT NULL,
	"source_sha256" text NOT NULL,
	"source_exported_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_imports_key_key" ON "recovery_imports" USING btree ("import_key");
--> statement-breakpoint

CREATE TABLE "recovery_import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid,
	"canonical_source_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_import_records_unique" ON "recovery_import_records" USING btree ("import_id","entity_type","source_id");
--> statement-breakpoint
CREATE INDEX "recovery_import_records_target_idx" ON "recovery_import_records" USING btree ("entity_type","target_id");
--> statement-breakpoint
ALTER TABLE "recovery_import_records" ADD CONSTRAINT "recovery_import_records_import_id_recovery_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."recovery_imports"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tasks" ADD COLUMN "status_source" text DEFAULT 'recorded' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "details_source" text DEFAULT 'recorded' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recovery_import_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_source_check" CHECK ("status_source" IN ('recorded', 'recovery_default'));
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_details_source_check" CHECK ("details_source" IN ('recorded', 'recovery_default', 'recovery_provisional'));
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recovery_import_id_recovery_imports_id_fk" FOREIGN KEY ("recovery_import_id") REFERENCES "public"."recovery_imports"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_recovery_import_idx" ON "tasks" USING btree ("recovery_import_id");
--> statement-breakpoint

ALTER TABLE "task_subtasks" ADD COLUMN "status_source" text DEFAULT 'recorded' NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD COLUMN "details_source" text DEFAULT 'recorded' NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD COLUMN "recovery_import_id" uuid;
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_status_source_check" CHECK ("status_source" IN ('recorded', 'recovery_default'));
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_details_source_check" CHECK ("details_source" IN ('recorded', 'recovery_default', 'recovery_provisional'));
--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_recovery_import_id_recovery_imports_id_fk" FOREIGN KEY ("recovery_import_id") REFERENCES "public"."recovery_imports"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_subtasks_recovery_import_idx" ON "task_subtasks" USING btree ("recovery_import_id");
--> statement-breakpoint

ALTER TABLE "time_entries" ADD COLUMN "recovery_import_id" uuid;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recovery_import_id_recovery_imports_id_fk" FOREIGN KEY ("recovery_import_id") REFERENCES "public"."recovery_imports"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "time_entries_recovery_import_idx" ON "time_entries" USING btree ("recovery_import_id");
