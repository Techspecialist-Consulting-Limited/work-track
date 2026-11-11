import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb(connectionString: string) {
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
  return drizzle(client, { schema });
}

type Db = ReturnType<typeof createDb>;

let instance: Db | undefined;

function getDb(): Db {
  if (instance) return instance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  instance = createDb(connectionString);
  return instance;
}

// Lazily initialized so importing this module during `next build` (page-data
// collection) does not require DATABASE_URL. The error surfaces on first
// real query if the variable is missing at runtime.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const value = Reflect.get(getDb(), prop);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});
export { schema };
