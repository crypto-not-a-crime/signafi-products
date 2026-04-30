import { AdminConsole } from "@/components/AdminConsole";
import { AdminLogin } from "@/components/AdminLogin";
import { isAdminSession } from "@/lib/server/admin";

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  if (!(await isAdminSession())) {
    return <AdminLogin hasError={params.error === "1"} />;
  }
  return <AdminConsole />;
}
