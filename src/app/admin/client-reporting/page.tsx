import { redirect } from "next/navigation";

/** Client-site reporting configuration moved into Admin → Teams. */
export default function ClientReportingRedirect() {
  redirect("/admin/teams");
}
