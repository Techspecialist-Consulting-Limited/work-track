CREATE TYPE "public"."entry_type" AS ENUM('work', 'break');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('staff', 'hr', 'chairman');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('not_started', 'ongoing', 'blocked', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."work_location" AS ENUM('office', 'home');--> statement-breakpoint
CREATE TYPE "public"."work_type" AS ENUM('normal', 'overtime');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"old_values" jsonb,
	"new_values" jsonb,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" text,
	"full_name" text NOT NULL,
	"job_title" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktrack_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid,
	"role" "membership_role" NOT NULL,
	"microsoft_tenant_id" text NOT NULL,
	"microsoft_object_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_staff_requires_employee" CHECK (role <> 'staff' OR employee_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "task_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"previous_status" "task_status",
	"new_status" "task_status" NOT NULL,
	"changed_by_membership_id" uuid,
	"change_note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"current_status" "task_status" DEFAULT 'not_started' NOT NULL,
	"blocker_reason" text,
	"dropped_reason" text,
	"completed_at" timestamp with time zone,
	"management_review" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"task_id" uuid,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"work_location" "work_location",
	"work_type" "work_type",
	"task_status_snapshot" "task_status",
	"evidence_link" text,
	"is_reported_overtime" boolean DEFAULT false NOT NULL,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"created_by_membership_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_end_after_start" CHECK (end_at > start_at),
	CONSTRAINT "time_entries_work_fields" CHECK (entry_type <> 'work' OR (task_id IS NOT NULL AND work_location IS NOT NULL AND work_type IS NOT NULL)),
	CONSTRAINT "time_entries_break_fields" CHECK (entry_type <> 'break' OR (task_id IS NULL AND work_location IS NULL AND work_type IS NULL))
);
--> statement-breakpoint
CREATE TABLE "worktrack_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktrack_memberships" ADD CONSTRAINT "worktrack_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_changed_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("changed_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_by_membership_id_worktrack_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_oid_key" ON "worktrack_memberships" USING btree ("microsoft_tenant_id","microsoft_object_id");--> statement-breakpoint
CREATE INDEX "memberships_employee_idx" ON "worktrack_memberships" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "task_status_history_task_idx" ON "task_status_history" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_employee_idx" ON "tasks" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "time_entries_employee_start_idx" ON "time_entries" USING btree ("employee_id","start_at");--> statement-breakpoint
CREATE INDEX "time_entries_start_idx" ON "time_entries" USING btree ("start_at");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_no_overlap" EXCLUDE USING gist (
	"employee_id" WITH =,
	tstzrange("start_at", "end_at") WITH &&
) WHERE ("voided_at" IS NULL);
