import { afterEach, describe, expect, it, vi } from "vitest";
import { DeribitClient } from "../src/deribit";

describe("Deribit private RPC", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses the proxy bearer for Vercel and forwards Deribit auth separately for margin checks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { access_token: "deribit-access-token", expires_in: 900, token_type: "bearer" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { buy: 0.0123, sell: 0.4567, min_price: 0.0001, max_price: 0.25 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeribitClient(
      "https://signafi-products.vercel.app/api/deribit",
      "proxy-token",
      "client-id",
      "client-secret"
    );
    const result = await client.getMargins("BTC-25DEC26-70000-P", 6.1, 0.08);

    expect(result.sell).toBe(0.4567);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://signafi-products.vercel.app/api/deribit/",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer proxy-token"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://signafi-products.vercel.app/api/deribit/",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer proxy-token",
          "x-deribit-authorization": "Bearer deribit-access-token"
        })
      })
    );
  });

  it("retries Deribit JSON-RPC rate-limit errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: 10028, message: "too_many_requests" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { instrument_name: "BTC_USDC", timestamp: 1779156600000, best_bid_price: 100, best_ask_price: 102 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeribitClient("https://www.deribit.com/api/v2");
    const resultPromise = client.ticker("BTC_USDC");
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result.instrument_name).toBe("BTC_USDC");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient HTTP failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { instrument_name: "BTC_USDC", timestamp: 1779156600000, best_bid_price: 100, best_ask_price: 102 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeribitClient("https://www.deribit.com/api/v2");
    const resultPromise = client.ticker("BTC_USDC");
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result.best_bid_price).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
