CREATE TABLE "complaints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference" text NOT NULL,
  "employee_id" uuid NOT NULL,
  "category" text NOT NULL,
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "unread_by_management" boolean DEFAULT true NOT NULL,
  "unread_by_staff" boolean DEFAULT false NOT NULL,
  "assigned_to_membership_id" uuid,
  "assigned_to_label" text,
  "resolved_at" timestamp with time zone,
  "reopened_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaint_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id" uuid NOT NULL,
  "sender_type" text NOT NULL,
  "sender_membership_id" uuid,
  "sender_employee_id" uuid,
  "sender_name" text NOT NULL,
  "sender_role" text,
  "body" text NOT NULL,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaint_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "changed_by_membership_id" uuid,
  "changed_by_name" text NOT NULL,
  "changed_by_role" text NOT NULL,
  "note" text,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaint_message_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id" uuid NOT NULL,
  "message_id" uuid,
  "employee_id" uuid,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_path" text NOT NULL,
  "uploaded_by_membership_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assigned_to_membership_id_memberships_id_fk" FOREIGN KEY ("assigned_to_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_sender_membership_id_memberships_id_fk" FOREIGN KEY ("sender_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_sender_employee_id_employees_id_fk" FOREIGN KEY ("sender_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_status_history" ADD CONSTRAINT "complaint_status_history_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_status_history" ADD CONSTRAINT "complaint_status_history_changed_by_membership_id_memberships_id_fk" FOREIGN KEY ("changed_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_message_attachments" ADD CONSTRAINT "complaint_message_attachments_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_message_attachments" ADD CONSTRAINT "complaint_message_attachments_message_id_complaint_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."complaint_messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_message_attachments" ADD CONSTRAINT "complaint_message_attachments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "complaint_message_attachments" ADD CONSTRAINT "complaint_message_attachments_uploaded_by_membership_id_memberships_id_fk" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_reference_key" ON "complaints" USING btree ("reference");
--> statement-breakpoint
CREATE INDEX "complaints_employee_idx" ON "complaints" USING btree ("employee_id", "submitted_at");
--> statement-breakpoint
CREATE INDEX "complaints_status_idx" ON "complaints" USING btree ("status", "last_message_at");
--> statement-breakpoint
CREATE INDEX "complaint_messages_complaint_idx" ON "complaint_messages" USING btree ("complaint_id", "created_at");
--> statement-breakpoint
CREATE INDEX "complaint_status_history_complaint_idx" ON "complaint_status_history" USING btree ("complaint_id", "changed_at");
--> statement-breakpoint
CREATE INDEX "complaint_message_attachments_complaint_idx" ON "complaint_message_attachments" USING btree ("complaint_id");
--> statement-breakpoint
CREATE INDEX "complaint_message_attachments_message_idx" ON "complaint_message_attachments" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "complaint_message_attachments_pending_idx" ON "complaint_message_attachments" USING btree ("complaint_id", "created_at") WHERE "message_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_status_check" CHECK ("status" IN ('new', 'in_progress', 'awaiting_staff', 'resolved', 'reopened'));
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_category_check" CHECK ("category" IN ('payroll', 'workplace', 'scheduling', 'equipment', 'policy', 'other'));
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_subject_not_blank" CHECK (length(btrim("subject")) > 0);
--> statement-breakpoint
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_sender_type_check" CHECK ("sender_type" IN ('staff', 'management', 'system'));
--> statement-breakpoint
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_body_not_blank" CHECK (length(btrim("body")) > 0);
--> statement-breakpoint
ALTER TABLE "complaint_status_history" ADD CONSTRAINT "complaint_status_history_to_check" CHECK ("to_status" IN ('new', 'in_progress', 'awaiting_staff', 'resolved', 'reopened'));
