import type { NextRequest } from "next/server";
import { proxyToWorker } from "@/lib/server/backend";
import { requireAdminApi } from "@/lib/server/admin";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth) return auth;
  return proxyToWorker(request, "/api/admin/stream-status", () => ({
      mock: true,
      connected: false,
      lastConnectAt: null,
      subscribed: [],
      memoryQuoteCount: 0
    }));
}
