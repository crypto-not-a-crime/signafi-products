import type { DeribitOrderBook } from "./deribit";

export type CachedOrderBookSource = "cache" | "live" | "stale_fallback";

export interface CachedOrderBookResult {
  book: DeribitOrderBook;
  source: CachedOrderBookSource;
  fetchedAt: number;
  ageMs: number;
  stale: boolean;
  error?: string;
}

interface CacheEntry {
  book: DeribitOrderBook;
  fetchedAt: number;
}

export class OrderBookCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CachedOrderBookResult>>();

  constructor(
    private readonly fetcher: (instrumentName: string, depth: number) => Promise<DeribitOrderBook>,
    private readonly now = () => Date.now()
  ) {}

  async get(instrumentName: string, depth: number, maxAgeMs: number): Promise<CachedOrderBookResult> {
    const key = cacheKey(instrumentName, depth);
    const cached = this.cache.get(key);
    const nowMs = this.now();
    if (cached && nowMs - cached.fetchedAt <= maxAgeMs) {
      return {
        book: cached.book,
        source: "cache",
        fetchedAt: cached.fetchedAt,
        ageMs: Math.max(0, nowMs - cached.fetchedAt),
        stale: false
      };
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = this.fetchAndStore(key, instrumentName, depth, cached, maxAgeMs);
    this.inFlight.set(key, request);
    request.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    return request;
  }

  status(maxAgeMs: number): { depthCacheCount: number; freshDepthCacheCount: number; pendingDepthRequests: number } {
    const nowMs = this.now();
    let freshDepthCacheCount = 0;
    for (const entry of this.cache.values()) {
      if (nowMs - entry.fetchedAt <= maxAgeMs) freshDepthCacheCount += 1;
    }
    return {
      depthCacheCount: this.cache.size,
      freshDepthCacheCount,
      pendingDepthRequests: this.inFlight.size
    };
  }

  private async fetchAndStore(
    key: string,
    instrumentName: string,
    depth: number,
    cached: CacheEntry | undefined,
    maxAgeMs: number
  ): Promise<CachedOrderBookResult> {
    const startedAt = this.now();
    try {
      const book = await this.fetcher(instrumentName, depth);
      const fetchedAt = this.now();
      this.cache.set(key, { book, fetchedAt });
      return {
        book,
        source: "live",
        fetchedAt,
        ageMs: Math.max(0, fetchedAt - startedAt),
        stale: false
      };
    } catch (error) {
      if (cached) {
        const nowMs = this.now();
        return {
          book: cached.book,
          source: "stale_fallback",
          fetchedAt: cached.fetchedAt,
          ageMs: Math.max(0, nowMs - cached.fetchedAt),
          stale: nowMs - cached.fetchedAt > maxAgeMs,
          error: error instanceof Error ? error.message : "Order book refresh failed"
        };
      }
      throw error;
    }
  }
}

function cacheKey(instrumentName: string, depth: number): string {
  return `${instrumentName}:${depth}`;
}
