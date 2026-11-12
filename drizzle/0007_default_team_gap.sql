-- 0007: guarantee a default team exists.
-- 0006's department backfill can claim the name "General" before the default-team
-- insert runs; ON CONFLICT then skips it and no team has is_default = true, so
-- employees without a department end up with no team at all. This fills that gap
-- without renaming or merging anything: prefer an existing "General" team,
-- otherwise create one, then attach department-less employees and set their
-- staff memberships' active team.

UPDATE "teams"
SET "is_default" = true, "updated_at" = now()
WHERE NOT EXISTS (SELECT 1 FROM "teams" WHERE "is_default")
	AND lower(btrim("name")) = 'general';
--> statement-breakpoint

INSERT INTO "teams" ("name", "description", "is_default", "origin")
SELECT 'General', 'Default team for staff without a department. Reassign members as needed.', true, 'backfill'
WHERE NOT EXISTS (SELECT 1 FROM "teams" WHERE "is_default")
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "employee_teams" ("employee_id", "team_id")
SELECT e."id", t."id"
FROM "employees" e
CROSS JOIN "teams" t
WHERE btrim(e."department") = '' AND t."is_default"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

UPDATE "worktrack_memberships" m
SET "active_team_id" = et."team_id"
FROM (
	SELECT DISTINCT ON ("employee_id") "employee_id", "team_id"
	FROM "employee_teams"
	ORDER BY "employee_id", "created_at", "team_id"
) et
WHERE m."employee_id" = et."employee_id"
	AND m."role" = 'staff'
	AND m."active_team_id" IS NULL;
