ALTER TABLE "complaints" ADD COLUMN "withdrawn_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "withdrawn_by_membership_id" uuid;
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_withdrawn_by_membership_id_memberships_id_fk" FOREIGN KEY ("withdrawn_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "complaints_withdrawn_idx" ON "complaints" USING btree ("withdrawn_at");
