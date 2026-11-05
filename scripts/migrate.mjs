// Applies pending Drizzle migrations. Safe to re-run (tracks applied migrations).
// Usage: node --env-file=.env.local scripts/migrate.mjs
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const client = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await client.end();
