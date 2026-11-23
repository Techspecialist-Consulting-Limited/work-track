// Re-inserts rows that exist in a backup but are missing from the live database.
// NEVER updates or deletes existing rows (INSERT ... ON CONFLICT DO NOTHING), so it is safe
// to run after an accidental deletion without losing anything entered since.
// Usage:
//   node --env-file=.env.local scripts/restore-missing.mjs <backup.json.gz>                 # dry run
//   node --env-file=.env.local scripts/restore-missing.mjs <backup.json.gz> --apply         # do it
//   add --tables tasks,time_entries to limit which tables are restored
import postgres from "postgres";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("Usage: restore-missing.mjs <backup.json.gz> [--apply] [--tables a,b]");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const ti = process.argv.indexOf("--tables");
const only = ti === -1 ? null : new Set(process.argv[ti + 1].split(","));

const backup = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, max_pipeline: 1 });

try {
  // Insert parents before children: topological order over foreign keys.
  const fks = await sql`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'`;
  const names = Object.keys(backup.tables);
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of fks) {
    const c = child.replace(/"/g, ""), p = parent.replace(/"/g, "");
    if (c !== p && deps.has(c) && deps.has(p)) deps.get(c).add(p);
  }
  const ordered = [];
  const seen = new Set();
  const visit = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const d of deps.get(n)) visit(d);
    ordered.push(n);
  };
  names.forEach(visit);

  const run = async (tx) => {
    // Several tables reference each other circularly (e.g. subtasks <-> cycles); defer FK checks.
    await tx`set constraints all deferred`;
    for (const t of ordered) {
      const rows = backup.tables[t];
      if (!rows?.length || (only && !only.has(t))) continue;
      const cols = (
        await tx`select column_name from information_schema.columns
                 where table_schema = 'public' and table_name = ${t}
                   and is_generated = 'NEVER' and column_name = any(${Object.keys(rows[0])})
                 order by ordinal_position`
      ).map((r) => r.column_name);
      const list = cols.map((c) => `"${c}"`).join(", ");
      const before = (await tx.unsafe(`select count(*)::int c from "${t}"`))[0].c;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        const res = await tx.unsafe(
          `insert into "${t}" (${list}) select ${list} from json_populate_recordset(null::"${t}", $1::text::json)
           on conflict do nothing`,
          [chunk],
        );
        inserted += res.count;
      }
      if (inserted) console.log(`${t.padEnd(36)} live ${before}  restoring ${inserted} missing of ${rows.length} in backup`);
    }
    if (!apply) throw new Error("DRY_RUN");
  };

  console.log(`Backup from ${backup.createdAt}. ${apply ? "APPLYING" : "DRY RUN (nothing is written)"}\n`);
  try {
    await sql.begin(run);
    console.log("\nRestore committed.");
  } catch (e) {
    if (e.message !== "DRY_RUN") throw e;
    console.log("\nDry run complete — rolled back. Re-run with --apply to restore.");
  }
} finally {
  await sql.end();
}
