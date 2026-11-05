// Links a Microsoft identity (Entra tenant ID + object ID) to a WorkTrack
// role and, for staff, an employee record.
//
// Usage:
//   node --env-file=.env.local scripts/provision-member.mjs staff alex <oid>
//   node --env-file=.env.local scripts/provision-member.mjs hr "" <oid>
//   node --env-file=.env.local scripts/provision-member.mjs chairman "" <oid>
//
// <oid> is the user's Microsoft object ID (Entra portal → Enterprise
// applications → Users and groups, or the `oid` claim in a sign-in token).
// Tenant defaults to ENTRA_TENANT_ID.
import postgres from "postgres";

const [role, employeeCode, oid, tenantOverride] = process.argv.slice(2);
const tenantId = tenantOverride || process.env.ENTRA_TENANT_ID;

if (!["staff", "hr", "chairman"].includes(role) || !oid || !tenantId) {
  console.error('Usage: provision-member.mjs <staff|hr|chairman> <employee-code|""> <oid> [tenant-id]');
  process.exit(1);
}
if (role === "staff" && !employeeCode) {
  console.error("staff role requires an employee code (e.g. alex)");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });

const emp = employeeCode
  ? (await client`SELECT id FROM employees WHERE employee_code = ${employeeCode} LIMIT 1`)[0]
  : null;
if (employeeCode && !emp) {
  console.error(`No employee with code "${employeeCode}". Seed first (scripts/seed.mts).`);
  process.exit(1);
}

const existing = await client`
  SELECT id, role, is_active FROM worktrack_memberships
  WHERE microsoft_tenant_id = ${tenantId} AND microsoft_object_id = ${oid} AND role = ${role}
`;

if (existing.length) {
  await client`
    UPDATE worktrack_memberships
    SET role = ${role}, employee_id = ${emp?.id ?? null}, is_active = true, updated_at = now()
    WHERE id = ${existing[0].id}
  `;
  console.log(`Updated existing membership ${existing[0].id} → role=${role}`);
} else {
  const rows = await client`
    INSERT INTO worktrack_memberships (employee_id, role, microsoft_tenant_id, microsoft_object_id)
    VALUES (${emp?.id ?? null}, ${role}, ${tenantId}, ${oid})
    RETURNING id
  `;
  console.log(`Created membership ${rows[0].id} → role=${role}${emp ? ` employee=${employeeCode}` : ""}`);
}
await client.end();
