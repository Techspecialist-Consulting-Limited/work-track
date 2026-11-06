import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const cons = await sql`
  select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'time_entries'::regclass
  order by conname`;
console.log("TIME_ENTRIES CONSTRAINTS:");
for (const c of cons) console.log(" -", c.conname, ":", c.def);

const excl = await sql`
  select indexname, indexdef from pg_indexes
  where tablename = 'time_entries'`;
console.log("INDEXES:", excl.map((i) => i.indexname).join(", "));

const orphanTasks = await sql`
  select count(*) as n from tasks t left join employees e on e.id = t.employee_id where e.id is null`;
console.log("Orphan tasks:", orphanTasks[0].n);

const orphanEntries = await sql`
  select count(*) as n from time_entries te left join employees e on e.id = te.employee_id where e.id is null`;
console.log("Orphan entries:", orphanEntries[0].n);

const badEntries = await sql`
  select count(*) as n from time_entries
  where entry_type = 'work' and (task_id is null or work_location is null or work_type is null or end_at is null or duration_minutes is null)`;
console.log("Work entries missing required fields:", badEntries[0].n);

const overlaps = await sql`
  select count(*) as n from (
    select employee_id, tstzrange(start_at, coalesce(end_at, now())) as r
    from time_entries where voided_at is null
  ) s group by employee_id, r having count(*) > 1`;
console.log("Overlapping entry groups:", overlaps.length);

await sql.end();
