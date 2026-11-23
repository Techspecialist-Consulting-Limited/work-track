// Full logical backup of every table in the public schema -> gzip JSON.
// Usage:  node --env-file=.env.local scripts/backup-db.mjs [--out backups] [--keep 30] [--upload]
//   --out     directory for backup files (default ./backups, gitignored)
//   --keep    keep only the newest N local backups (default 30)
//   --upload  also copy the file to the private Supabase Storage bucket `worktrack-backups`
//             (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; create the bucket once, NOT public)
// Restore with scripts/restore-missing.mjs. Read-only against the database.
import postgres from "postgres";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const outDir = arg("out", "backups");
const keep = Number(arg("keep", 30));
const upload = process.argv.includes("--upload");

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, max_pipeline: 1 });

try {
  const tables = (
    await sql`select table_name from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`
  ).map((r) => r.table_name);

  const data = {};
  const counts = {};
  // One repeatable-read transaction so every table is from the same instant.
  await sql.begin("isolation level repeatable read read only", async (tx) => {
    for (const t of tables) {
      data[t] = await tx.unsafe(`select * from "${t}"`);
      counts[t] = data[t].length;
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = { format: 1, createdAt: new Date().toISOString(), counts, tables: data };
  const gz = gzipSync(Buffer.from(JSON.stringify(payload)));

  mkdirSync(outDir, { recursive: true });
  const name = `worktrack-backup-${stamp}.json.gz`;
  writeFileSync(join(outDir, name), gz);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Backup written: ${join(outDir, name)} (${(gz.length / 1024).toFixed(0)} KB, ${tables.length} tables, ${total} rows)`);

  // Retention: delete the oldest local backups beyond --keep.
  const files = readdirSync(outDir).filter((f) => /^worktrack-backup-.*\.json\.gz$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(outDir, f));

  if (upload) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("--upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    const res = await fetch(`${url}/storage/v1/object/worktrack-backups/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/gzip" },
      body: gz,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
    console.log("Uploaded to Supabase Storage bucket worktrack-backups");
  }
} finally {
  await sql.end();
}
