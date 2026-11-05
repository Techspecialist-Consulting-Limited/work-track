// Creates an employee record (no login yet — link a Microsoft identity with
// scripts/provision-member.mjs afterwards).
// Usage: node --env-file=.env.local scripts/create-employee.mjs <code> "<full name>" "<job title>" "<department>"
import postgres from "postgres";

const [code, fullName, jobTitle, department] = process.argv.slice(2);
if (!code || !fullName || !jobTitle) {
  console.error('Usage: create-employee.mjs <code> "<full name>" "<job title>" "<department>"');
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const existing = await client`SELECT id FROM employees WHERE employee_code = ${code}`;
if (existing.length) {
  console.error(`Employee code "${code}" already exists.`);
  process.exit(1);
}
const rows = await client`
  INSERT INTO employees (employee_code, full_name, job_title, department)
  VALUES (${code}, ${fullName}, ${jobTitle}, ${department ?? ""})
  RETURNING id
`;
console.log(`Created employee ${rows[0].id} — ${fullName} (${code})`);
await client.end();
