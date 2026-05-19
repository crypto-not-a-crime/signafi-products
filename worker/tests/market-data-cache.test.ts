import { describe, expect, it, vi } from "vitest";
import { OrderBookCache } from "../src/market-data-cache";
import type { DeribitOrderBook } from "../src/deribit";

function book(instrumentName: string, timestamp: number, bid = 0.1): DeribitOrderBook {
  return {
    instrument_name: instrumentName,
    timestamp,
    best_bid_price: bid,
    best_bid_amount: 10,
    best_ask_price: bid + 0.01,
    best_ask_amount: 10,
    bids: [[bid, 10]],
    asks: [[bid + 0.01, 10]]
  };
}

describe("OrderBookCache", () => {
  it("serves fresh cached books without refetching", async () => {
    let now = 1_000;
    const fetcher = vi.fn().mockResolvedValue(book("BTC-TEST", 1_000));
    const cache = new OrderBookCache(fetcher, () => now);

    const first = await cache.get("BTC-TEST", 100, 5_000);
    now = 2_000;
    const second = await cache.get("BTC-TEST", 100, 5_000);

    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(second.ageMs).toBe(1_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent misses into one Deribit fetch", async () => {
    let resolveFetch!: (value: DeribitOrderBook) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<DeribitOrderBook>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const cache = new OrderBookCache(fetcher, () => 1_000);

    const first = cache.get("BTC-TEST", 100, 5_000);
    const second = cache.get("BTC-TEST", 100, 5_000);
    resolveFetch(book("BTC-TEST", 1_000));

    expect((await first).source).toBe("live");
    expect((await second).source).toBe("live");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale depth when refresh fails", async () => {
    let now = 1_000;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(book("BTC-TEST", 1_000, 0.1))
      .mockRejectedValueOnce(new Error("Deribit public/get_order_book error 10028: too_many_requests"));
    const cache = new OrderBookCache(fetcher, () => now);

    await cache.get("BTC-TEST", 100, 500);
    now = 2_000;
    const fallback = await cache.get("BTC-TEST", 100, 500);

    expect(fallback.source).toBe("stale_fallback");
    expect(fallback.stale).toBe(true);
    expect(fallback.book.best_bid_price).toBe(0.1);
    expect(fallback.error).toContain("too_many_requests");
  });
});
