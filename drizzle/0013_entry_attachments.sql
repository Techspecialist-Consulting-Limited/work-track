CREATE TABLE "time_entry_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid,
	"employee_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry_attachments" ADD CONSTRAINT "time_entry_attachments_entry_id_time_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_attachments" ADD CONSTRAINT "time_entry_attachments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_attachments" ADD CONSTRAINT "time_entry_attachments_uploaded_by_membership_id_memberships_id_fk" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entry_attachments_entry_idx" ON "time_entry_attachments" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "time_entry_attachments_employee_idx" ON "time_entry_attachments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "time_entry_attachments_pending_idx" ON "time_entry_attachments" USING btree ("employee_id","created_at") WHERE "entry_id" IS NULL;
