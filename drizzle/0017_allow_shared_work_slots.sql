-- Work entries may now share the same time slot. Keep breaks exclusive so a
-- break can never overlap another break, even though work may overlap work.
ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_no_overlap";
ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_breaks_no_overlap";
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_breaks_no_overlap" EXCLUDE USING gist (
	"employee_id" WITH =,
	tstzrange("start_at", "end_at") WITH &&
) WHERE ("voided_at" IS NULL AND "entry_type" = 'break');
