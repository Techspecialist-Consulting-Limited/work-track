-- 0008: client-site reporting — organisations, employee work arrangement,
-- per-client category/subcategory catalogue with approval workflow, and
-- client fields on time_entries.
--
-- Additive only: every new column is nullable or defaulted, no existing row
-- is modified except employees.employer_organisation_id / work_arrangement,
-- which are backfilled to safe defaults. All existing tasks, subtasks,
-- progress updates, entries, breaks and reports are untouched.
--
-- Pre-migration validation (run 2026-10-12 against the live dev database):
--   12 time_entries total (6 active, 6 voided) — every work entry has
--   task_id NOT NULL and all required work fields; the single break has no
--   work fields. The rewritten time_entries_work_fields constraint is safe.
--
-- ROLLBACK NOTE: this migration is only cheaply reversible while no
-- client-site data exists. Once client-site entries/categories have been
-- created, dropping the new tables/columns destroys those records. Before
-- any rollback, take a backup:
--   pg_dump "$DATABASE_URL" -t organisations -t client_categories
--     -t client_subcategories --data-only > client_site_backup.sql
-- and export affected time_entries rows. Rollback then = restore backup,
-- drop triggers/functions, drop new columns/tables, restore the original
-- time_entries_work_fields check.

-- ---------------------------------------------------------------------------
-- Organisations: employers (kind='employer') and client organisations
-- (kind='client'). Employing organisation is never replaced by the client.
-- Names dedupe case- and whitespace-insensitively (internal runs of spaces
-- collapse to one).
-- ---------------------------------------------------------------------------
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_kind_name_key" ON "organisations" USING btree ("kind", regexp_replace(lower(btrim("name")), '\s+', ' ', 'g'));
--> statement-breakpoint
CREATE INDEX "organisations_kind_idx" ON "organisations" USING btree ("kind", "is_active");
--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_kind_check" CHECK ("kind" IN ('employer', 'client'));
--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_membership_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- An organisation's kind is fundamental (employer vs client) and cannot be
-- changed after creation — references throughout the schema rely on it.
CREATE OR REPLACE FUNCTION "organisations_kind_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."kind" IS DISTINCT FROM OLD."kind" THEN
		RAISE EXCEPTION 'organisation kind cannot be changed';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "organisations_kind_immutable" BEFORE UPDATE ON "organisations"
	FOR EACH ROW EXECUTE FUNCTION "organisations_kind_immutable"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Employee profile: work arrangement + organisation relationships.
-- in_house is the default so every existing employee keeps the current flow.
-- client_site REQUIRES a client organisation; in_house must NOT have one.
-- ---------------------------------------------------------------------------
ALTER TABLE "employees" ADD COLUMN "work_arrangement" text DEFAULT 'in_house' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employer_organisation_id" uuid;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "client_organisation_id" uuid;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_arrangement_check" CHECK ("work_arrangement" IN ('in_house', 'client_site'));
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_arrangement_client_check" CHECK (
	("work_arrangement" = 'in_house' AND "client_organisation_id" IS NULL)
	OR ("work_arrangement" = 'client_site' AND "client_organisation_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_employer_organisation_id_organisations_id_fk" FOREIGN KEY ("employer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "employees_client_organisation_idx" ON "employees" USING btree ("client_organisation_id");
--> statement-breakpoint
CREATE INDEX "employees_employer_organisation_idx" ON "employees" USING btree ("employer_organisation_id");
--> statement-breakpoint

-- FK constraints cannot express "must reference kind='employer'/'client'",
-- so triggers enforce the kind on every write.
CREATE OR REPLACE FUNCTION "employees_validate_organisation_kinds"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."employer_organisation_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "organisations" o WHERE o."id" = NEW."employer_organisation_id" AND o."kind" = 'employer'
	) THEN
		RAISE EXCEPTION 'employer_organisation_id must reference an employer organisation';
	END IF;
	IF NEW."client_organisation_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "organisations" o WHERE o."id" = NEW."client_organisation_id" AND o."kind" = 'client'
	) THEN
		RAISE EXCEPTION 'client_organisation_id must reference a client organisation';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "employees_validate_organisation_kinds" BEFORE INSERT OR UPDATE ON "employees"
	FOR EACH ROW EXECUTE FUNCTION "employees_validate_organisation_kinds"();
--> statement-breakpoint

-- Backfill: one employer organisation for all existing staff. The employing
-- company is the same for every current employee record; no client
-- organisation is assigned (nobody is client-site yet). The check and the
-- employee link both key on the exact normalised name (same expression as
-- the organisations_kind_name_key unique index), so a pre-existing employer
-- organisation with a different name does not satisfy or receive the link.
INSERT INTO "organisations" ("name", "kind", "description")
SELECT 'TechSpecialist Consult Limited', 'employer', 'Employing organisation backfilled for existing staff during the client-site reporting migration.'
WHERE NOT EXISTS (
	SELECT 1 FROM "organisations"
	WHERE "kind" = 'employer'
		AND regexp_replace(lower(btrim("name")), '\s+', ' ', 'g') = 'techspecialist consult limited'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "employees" e
SET "employer_organisation_id" = o."id"
FROM "organisations" o
WHERE e."employer_organisation_id" IS NULL
	AND o."kind" = 'employer'
	AND regexp_replace(lower(btrim(o."name")), '\s+', ' ', 'g') = 'techspecialist consult limited';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Client category catalogue. Admin-created rows are 'approved'; staff
-- suggestions are inserted as 'pending' by the application. Rejected rows are
-- kept for audit but excluded from the per-client unique name index, so a
-- rejected name can be suggested again later. Name uniqueness ignores case
-- and collapses all whitespace runs.
-- ---------------------------------------------------------------------------
CREATE TABLE "client_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"approval_status" text DEFAULT 'approved' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_employee_id" uuid,
	"reviewed_by_membership_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_categories_name_key" ON "client_categories" USING btree ("client_organisation_id", regexp_replace(lower(btrim("name")), '\s+', ' ', 'g')) WHERE "approval_status" <> 'rejected';
--> statement-breakpoint
CREATE INDEX "client_categories_client_idx" ON "client_categories" USING btree ("client_organisation_id", "approval_status", "is_active");
--> statement-breakpoint
ALTER TABLE "client_categories" ADD CONSTRAINT "client_categories_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "client_categories" ADD CONSTRAINT "client_categories_status_check" CHECK ("approval_status" IN ('approved', 'pending', 'rejected'));
--> statement-breakpoint
ALTER TABLE "client_categories" ADD CONSTRAINT "client_categories_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_categories" ADD CONSTRAINT "client_categories_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_categories" ADD CONSTRAINT "client_categories_reviewed_by_membership_fk" FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "client_categories_client_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "organisations" o WHERE o."id" = NEW."client_organisation_id" AND o."kind" = 'client'
	) THEN
		RAISE EXCEPTION 'client_categories.client_organisation_id must reference a client organisation';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "client_categories_client_kind" BEFORE INSERT OR UPDATE ON "client_categories"
	FOR EACH ROW EXECUTE FUNCTION "client_categories_client_kind"();
--> statement-breakpoint

-- Composite uniqueness lets subcategories prove they belong to the same
-- client as their parent category at the database level.
CREATE UNIQUE INDEX "client_categories_id_client_key" ON "client_categories" USING btree ("id", "client_organisation_id");
--> statement-breakpoint

CREATE TABLE "client_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_organisation_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"approval_status" text DEFAULT 'approved' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_employee_id" uuid,
	"reviewed_by_membership_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_subcategories_name_key" ON "client_subcategories" USING btree ("category_id", regexp_replace(lower(btrim("name")), '\s+', ' ', 'g')) WHERE "approval_status" <> 'rejected';
--> statement-breakpoint
CREATE INDEX "client_subcategories_client_idx" ON "client_subcategories" USING btree ("client_organisation_id", "approval_status", "is_active");
--> statement-breakpoint
CREATE INDEX "client_subcategories_category_idx" ON "client_subcategories" USING btree ("category_id", "approval_status", "is_active");
--> statement-breakpoint
-- FK target for the time_entries pairing check below.
CREATE UNIQUE INDEX "client_subcategories_id_category_key" ON "client_subcategories" USING btree ("id", "category_id");
--> statement-breakpoint
ALTER TABLE "client_subcategories" ADD CONSTRAINT "client_subcategories_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "client_subcategories" ADD CONSTRAINT "client_subcategories_status_check" CHECK ("approval_status" IN ('approved', 'pending', 'rejected'));
--> statement-breakpoint
ALTER TABLE "client_subcategories" ADD CONSTRAINT "client_subcategories_category_client_fk" FOREIGN KEY ("category_id", "client_organisation_id") REFERENCES "public"."client_categories"("id", "client_organisation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_subcategories" ADD CONSTRAINT "client_subcategories_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_subcategories" ADD CONSTRAINT "client_subcategories_reviewed_by_membership_fk" FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "public"."worktrack_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "client_subcategories_client_kind"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "organisations" o WHERE o."id" = NEW."client_organisation_id" AND o."kind" = 'client'
	) THEN
		RAISE EXCEPTION 'client_subcategories.client_organisation_id must reference a client organisation';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "client_subcategories_client_kind" BEFORE INSERT OR UPDATE ON "client_subcategories"
	FOR EACH ROW EXECUTE FUNCTION "client_subcategories_client_kind"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- time_entries: client-site work references. Nullable FKs keep every
-- existing in-house entry valid; historical references survive later
-- rejection/deactivation because rows are never deleted.
-- ---------------------------------------------------------------------------
ALTER TABLE "time_entries" ADD COLUMN "client_category_id" uuid;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "client_subcategory_id" uuid;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_category_id_client_categories_id_fk" FOREIGN KEY ("client_category_id") REFERENCES "public"."client_categories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_subcategory_id_client_subcategories_id_fk" FOREIGN KEY ("client_subcategory_id") REFERENCES "public"."client_subcategories"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Pairing guarantee: the entry's category must be the subcategory's own
-- category — a mismatched category/subcategory combination cannot be stored.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_pair_fk" FOREIGN KEY ("client_subcategory_id", "client_category_id") REFERENCES "public"."client_subcategories"("id", "category_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "time_entries_client_category_idx" ON "time_entries" USING btree ("client_category_id");
--> statement-breakpoint
CREATE INDEX "time_entries_client_subcategory_idx" ON "time_entries" USING btree ("client_subcategory_id");
--> statement-breakpoint

-- A work entry is now either in-house (task_id set, no client fields) or
-- client-site (no task_id, both client fields set). Breaks are unaffected.
-- Verified against all 12 existing rows before applying.
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_work_fields";
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_work_fields" CHECK (
	"entry_type" <> 'work' OR (
		"work_location" IS NOT NULL
		AND "work_type" IS NOT NULL
		AND "end_at" IS NOT NULL
		AND "duration_minutes" IS NOT NULL
		AND (
			("task_id" IS NOT NULL AND "client_category_id" IS NULL AND "client_subcategory_id" IS NULL)
			OR ("task_id" IS NULL AND "client_category_id" IS NOT NULL AND "client_subcategory_id" IS NOT NULL)
		)
	)
);
