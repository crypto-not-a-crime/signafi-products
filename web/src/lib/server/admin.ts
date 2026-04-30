import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function isAdminSession() {
  const cookieStore = await cookies();
  return cookieStore.get("signafi_admin")?.value === "1";
}

export async function requireAdminApi() {
  if (await isAdminSession()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
