// Drops and recreates the public schema, then applies all migrations.
// DESTRUCTIVE — only for a fresh/empty database.
// Usage: node --env-file=.env.local scripts/reset-db.mjs
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
await client`DROP SCHEMA public CASCADE`;
await client`CREATE SCHEMA public`;
await client`GRANT ALL ON SCHEMA public TO postgres`;
await client`GRANT ALL ON SCHEMA public TO public`;
console.log("Schema reset.");
await client.end();
