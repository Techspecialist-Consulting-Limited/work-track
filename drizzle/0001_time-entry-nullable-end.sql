ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_end_after_start";--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_work_fields";--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "end_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "duration_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "normal_minutes" integer;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "overtime_minutes" integer;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_end_after_start" CHECK (end_at IS NULL OR end_at > start_at);--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_work_fields" CHECK (entry_type <> 'work' OR (task_id IS NOT NULL AND work_location IS NOT NULL AND work_type IS NOT NULL AND end_at IS NOT NULL AND duration_minutes IS NOT NULL));