import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const DERIBIT_RPC_URL = "https://www.deribit.com/api/v2/";

export async function POST(request: NextRequest) {
  const expected = process.env.DERIBIT_PROXY_TOKEN;
  if (expected) {
    const authorization = request.headers.get("authorization") ?? "";
    if (authorization !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.text();
  const deribitAuthorization = request.headers.get("x-deribit-authorization");
  const response = await fetch(DERIBIT_RPC_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SignafiDeribitProxy/1.0",
      ...(deribitAuthorization ? { authorization: deribitAuthorization } : {})
    },
    body,
    cache: "no-store"
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
}
