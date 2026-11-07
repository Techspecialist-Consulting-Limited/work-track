import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Single shared pool for the server runtime (Vercel serverless safe).
const client = postgres(connectionString, {
  ssl: "require",
  max: 5,
  idle_timeout: 20,
  connect_timeout: 15,
  // Supabase's transaction pooler (port 6543) does not support pipelining
  // several statements on one backend; postgres.js v4 pipelines by default
  // and concurrent reads then hang indefinitely. One query per connection.
  max_pipeline: 1,
});

export const db = drizzle(client, { schema });
export { schema };
