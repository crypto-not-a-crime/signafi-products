import type { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  return proxyToWorker(request, "/api/admin/stream-start", () => ({
      mock: true,
      started: true,
      subscribed: []
    }));
}
