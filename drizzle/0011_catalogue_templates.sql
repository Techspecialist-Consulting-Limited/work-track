-- Catalogue template library: reusable client-site category/subcategory
-- structures. Templates are independent snapshots — applying one creates new
-- client_categories/client_subcategories rows; editing or deleting a template
-- never touches catalogue records already applied to clients.
CREATE TABLE "catalogue_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "created_by_membership_id" uuid REFERENCES "worktrack_memberships"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_templates_name_key"
  ON "catalogue_templates" (regexp_replace(lower(btrim("name")), '\s+', ' ', 'g'));
--> statement-breakpoint
CREATE TABLE "catalogue_template_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "catalogue_templates"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_template_categories_name_key"
  ON "catalogue_template_categories" ("template_id", regexp_replace(lower(btrim("name")), '\s+', ' ', 'g'));
--> statement-breakpoint
CREATE INDEX "catalogue_template_categories_template_idx"
  ON "catalogue_template_categories" ("template_id");
--> statement-breakpoint
CREATE TABLE "catalogue_template_subcategories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_category_id" uuid NOT NULL REFERENCES "catalogue_template_categories"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_template_subcategories_name_key"
  ON "catalogue_template_subcategories" ("template_category_id", regexp_replace(lower(btrim("name")), '\s+', ' ', 'g'));
--> statement-breakpoint
CREATE INDEX "catalogue_template_subcategories_category_idx"
  ON "catalogue_template_subcategories" ("template_category_id");
--> statement-breakpoint
ALTER TABLE "catalogue_templates" ADD CONSTRAINT "catalogue_templates_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "catalogue_template_categories" ADD CONSTRAINT "catalogue_template_categories_name_not_blank" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint
ALTER TABLE "catalogue_template_subcategories" ADD CONSTRAINT "catalogue_template_subcategories_name_not_blank" CHECK (length(btrim("name")) > 0);
