import { describe, expect, it, vi } from "vitest";
import worker, { __test__ } from "../src/index";

function freshSyncDb() {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(async () => ({
        results: [
          { key: "last_instrument_sync_at", value: String(Date.now()) },
          { key: "last_summary_sync_at", value: String(Date.now()) }
        ]
      }))
    }))
  };
}

describe("market data Durable Object guardrails", () => {
  it("does not start the Durable Object stream from the scheduled sync", async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const env = {
      DB: freshSyncDb(),
      MARKET_DATA: {
        idFromName: vi.fn(),
        get: vi.fn()
      }
    };
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      })
    };

    await worker.scheduled({} as ScheduledEvent, env as never, ctx as never);
    await Promise.all(waitUntilPromises);

    expect(env.MARKET_DATA.idFromName).not.toHaveBeenCalled();
    expect(env.MARKET_DATA.get).not.toHaveBeenCalled();
  });

  it("routes admin stream-stop to the Durable Object stop endpoint", async () => {
    const durableFetch = vi.fn(async () => Response.json({ stopped: true, connected: false, subscribed: [] }));
    const env = {
      DB: freshSyncDb(),
      MARKET_DATA: {
        idFromName: vi.fn(() => "btc-options-id"),
        get: vi.fn(() => ({ fetch: durableFetch }))
      }
    };
    const ctx = { waitUntil: vi.fn() };

    const response = await worker.fetch(
      new Request("https://worker.test/api/admin/stream-stop", { method: "POST" }),
      env as never,
      ctx as never
    );
    const payload = await response.json() as { stopped?: boolean };

    expect(payload.stopped).toBe(true);
    expect(env.MARKET_DATA.idFromName).toHaveBeenCalledWith("btc-options");
    expect(durableFetch).toHaveBeenCalledWith("https://durable-object/stop", { method: "POST" });
  });

  it("keeps stale D1 fallback books non-fresh and exposes degraded metadata", () => {
    const state = __test__.createPricingMarketDataState();
    __test__.markMarketDataSource(state, "stale_d1_fallback", "BTC live depth unavailable.");
    const metadata = __test__.marketDataMetadata(state);
    const book = __test__.orderBookFromFallback(
      {
        instrument_name: "BTC-31JUL26-75000-P",
        bid_price: 0.08,
        bid_amount: 3,
        ask_price: 0.09,
        ask_amount: 2
      },
      "BTC-31JUL26-75000-P"
    );

    expect(metadata.marketDataSource).toBe("stale_d1_fallback");
    expect(metadata.degradedReason).toContain("BTC live depth unavailable");
    expect(book.timestamp).toBe(0);
    expect(book.bids).toEqual([[0.08, 3]]);
    expect(__test__.isCloudflareLimitError("Durable Object daily request limit exceeded 1027")).toBe(true);
  });
});
